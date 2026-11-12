/* Life Todos phone app. Plain JS. Talks to its own Apps Script web app with POST text/plain JSON. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  function h(tag, props) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) append(e, arguments[i]);
    return e;
  }
  function append(e, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { append(e, x); });
    else e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function loadJson(k, fallback) {
    try { return JSON.parse(store.get(k)) || fallback; } catch (e) { return fallback; }
  }

  var GROUP_ICONS = { 买东西: '🛒', 出门办: '🚗', 手机办: '📱', 在家做: '🏠', 未分组: '📌' };
  var PRAISE = ['搞定！', '又少一件！', '干得漂亮！', '这件不用再记着了', '脑子又空出一格', '清爽！', '漂亮！', '一件一件来，真棒'];
  var REPEATS = [['', '不重复'], ['1d', '每天'], ['1w', '每周'], ['2w', '每两周'], ['1m', '每月']];
  var REPEAT_UNITS = [['d', '天'], ['w', '周'], ['m', '个月']];
  var WAITED_DAYS = 3;
  var LEAVE_MS = 520;
  var KIND_ICONS = { 改进: '🛠', 新东西: '✨', 赚钱: '💰' };
  var STAGE_INFO = { new: ['💡', '新想法'], doing: ['🔨', '在做'], usable: ['✅', '能用了'], shelved: ['🗄', '放下'] };
  var STAGE_HINTS = { new: '刚想到，还没动手', doing: '正在做。先做出一个能用的版本', usable: '已经能用了。之后的改进记在补充里', shelved: '先放一放，随时可以拿回来' };

  var cfg = { url: store.get('td_url') || '', token: store.get('td_token') || '' };
  var state = { tab: store.get('td_tab') === 'ideas' ? 'ideas' : 'todo', filter: 'all', kind: 'all', showDone: false, showWaiting: false, showShelved: false };
  /* Saved copy of the list, and changes not yet sent. A cache on this phone; the sheet stays the source of truth. */
  var list = loadJson('td_list', null);
  var queue = loadJson('td_queue', []);
  var ideas = loadJson('td_ideas', []);
  var flushing = false, problem = '', lastRefresh = 0, leaving = 0, lastPraise = '';
  var quiet = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- helpers ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function nowStr() {
    var d = new Date();
    return todayStr() + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function newId() { return 't-' + Date.now() + '-' + Math.floor(Math.random() * 1000); }
  function monthDay(d) { return Number(d.slice(5, 7)) + '月' + Number(d.slice(8)) + '日'; }
  function weekName(d) { return '周' + '一二三四五六日'.charAt(weekday_(d) - 1); }
  function dueLabel(d, today) {
    var n = daysBetween_(today, d);
    if (n < 0) return '过期' + (-n) + '天';
    if (n === 0) return '今天';
    if (n === 1) return '明天';
    if (n === 2) return '后天';
    return n < 7 ? weekName(d) : monthDay(d);
  }
  var toastTimer;
  function toast(msg, undo, label) {
    var t = $('#toast');
    t.replaceChildren();
    append(t, [h('span', null, msg), undo ? h('button', { class: 'undo', onclick: function () { t.hidden = true; undo(); } }, label || '撤销') : null]);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, undo ? 5000 : 3200);
  }
  function connected() { return !!(cfg.token && (cfg.token === 'demo' || cfg.url)); }
  function api(action, payload) {
    var body = Object.assign({ action: action, token: cfg.token }, payload || {});
    if (cfg.token === 'demo') return window.MockApi(body);
    return fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || '出错了'); return j.data; });
  }
  function save() { store.set('td_list', JSON.stringify(list)); store.set('td_queue', JSON.stringify(queue)); store.set('td_ideas', JSON.stringify(ideas)); }
  function open_() { return list.filter(function (t) { return t.status === 'open'; }); }
  /** The next round of a repeating task stays out of sight until a few days before it is due. */
  function isWaiting(t, today) { return !!t.showFrom && t.showFrom > today; }
  function byDue(a, b) { return a.due === b.due ? (a.createdAt < b.createdAt ? -1 : 1) : (a.due < b.due ? -1 : 1); }
  function nowTasks() { var t = todayStr(); return open_().filter(function (x) { return x.due <= t; }); }
  function doneOn(day) { return list.filter(function (t) { return t.status === 'done' && t.doneAt.slice(0, 10) === day; }); }
  function findTask(id) { return list.filter(function (t) { return t.id === id; })[0]; }
  function findIdea(id) { return ideas.filter(function (i) { return i.id === id; })[0]; }
  function short(s) { return s.length > 14 ? s.slice(0, 13) + '…' : s; }
  function busy() { return leaving > 0 || !!document.querySelector('.overlay, .party'); }

  /* ---------- sending ---------- */
  function setStatus() {
    var el = $('#sync-status');
    if (!connected()) { el.textContent = ''; return; }
    if (problem) el.textContent = problem;
    else if (queue.length) el.textContent = '同步中…';
    else el.textContent = '';
  }
  /** Sent one at a time, oldest first. A change stays saved here until the sheet has it, so closing the app loses nothing. */
  function enqueue(action, payload) {
    queue.push({ action: action, payload: payload });
    save();
    flush();
  }
  function flush() {
    if (flushing || !queue.length || !connected()) return;
    flushing = true;
    setStatus();
    (function next() {
      if (!queue.length) { flushing = false; setStatus(); return; }
      var item = queue[0];
      api(item.action, item.payload).then(function (res) {
        queue.shift();
        problem = '';
        if (item.action === 'todoAdd') applyAdded(item.payload.id, res.tasks);
        if (res && res.idea) applyIdea(res.idea);
        save();
        next();
      }).catch(function (e) {
        var msg = e && e.message || '';
        if (/not found|empty text|bad /.test(msg)) {
          // The sheet refused this one and always will, so it must not block the rest.
          queue.shift();
          save();
          toast('有一处改动没存上：' + msg);
          return next();
        }
        flushing = false;
        problem = /unauthorized|too many/.test(msg) ? '令牌不对，请在设置里重新连接' : queue.length + ' 件待同步，有网络时自动发送';
        setStatus();
      });
    })();
  }
  /** The backend may have tidied the task or split it into several, so its version replaces the local guess. */
  function applyAdded(id, tasks) {
    var later = queue.some(function (q) { return q.payload.id === id; });
    if (later || !tasks || !tasks.length) return;
    var at = list.findIndex(function (t) { return t.id === id; });
    if (at < 0) return;
    list.splice.apply(list, [at, 1].concat(tasks.map(function (t, i) {
      return i === 0 ? Object.assign(list[at], t) : t;
    })));
    if (tasks.length > 1) toast('整理成了 ' + tasks.length + ' 件');
    if (!busy()) draw();
  }
  /** The sheet's copy of an idea replaces the local one, unless more changes to it are still waiting to be sent. */
  function applyIdea(idea) {
    if (queue.some(function (q) { return q.payload.id === idea.id; })) return;
    var at = ideas.findIndex(function (i) { return i.id === idea.id; });
    // Updated in place, so a screen that holds this idea keeps working on the live copy.
    if (at >= 0) Object.assign(ideas[at], idea);
  }
  function refresh() {
    if (!connected() || queue.length) return Promise.resolve();
    return api('todoList').then(function (d) {
      lastRefresh = Date.now();
      problem = '';
      setStatus();
      if (queue.length) return;
      var first = !list;
      list = d.todos;
      ideas = d.ideas || [];
      save();
      if (first) return render();
      if (!busy()) draw();
    }).catch(function (e) {
      if (!list) return renderProblem(e);
      problem = '暂时连不上，显示的是保存的内容';
      setStatus();
    });
  }

  /* ---------- finishing a task ---------- */
  var audio = null;
  function soundOn() { return store.get('td_sound') !== 'off'; }
  /* Made inside the tap, because iOS only allows sound that a touch started. */
  function ding(notes) {
    if (!soundOn()) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      notes.forEach(function (freq, i) {
        var osc = audio.createOscillator(), gain = audio.createGain(), at = audio.currentTime + i * 0.09;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.14, at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
        osc.connect(gain).connect(audio.destination);
        osc.start(at);
        osc.stop(at + 0.34);
      });
    } catch (e) {}
  }
  /* Web apps have no vibration on iPhone. Tapping an iOS 18 switch control gives a light tick, so one is tapped out of sight. */
  function haptic() {
    try {
      var label = h('label', { style: 'display:none' }, h('input', { type: 'checkbox', switch: true }));
      document.body.append(label);
      label.click();
      label.remove();
    } catch (e) {}
  }
  function burst(x, y, count, reach) {
    if (quiet) return;
    var colors = ['var(--accent)', 'var(--gold)', 'var(--pink)', 'var(--sky)'];
    for (var i = 0; i < count; i++) {
      (function (i) {
        var size = 5 + Math.random() * 5;
        var spark = h('i', { class: 'spark', style: 'left:' + x + 'px;top:' + y + 'px;width:' + size + 'px;height:' + size + 'px;background:' + colors[i % colors.length] });
        document.body.append(spark);
        var angle = Math.PI * 2 * (i / count) + Math.random() * 0.5, far = reach * (0.55 + Math.random() * 0.6);
        spark.animate([
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
          { transform: 'translate(calc(-50% + ' + Math.cos(angle) * far + 'px),calc(-50% + ' + Math.sin(angle) * far + 'px)) scale(.3)', opacity: 0 }
        ], { duration: 520 + Math.random() * 260, easing: 'cubic-bezier(.15,.7,.3,1)' }).onfinish = function () { spark.remove(); };
      })(i);
    }
  }
  function slideAway(row) {
    if (quiet) return;
    leaving++;
    var height = row.offsetHeight;
    row.animate([
      { height: height + 'px', opacity: 1, transform: 'none', offset: 0 },
      { height: height + 'px', opacity: 1, transform: 'none', offset: 0.45 },
      { height: '0px', opacity: 0, transform: 'translateX(40px)', offset: 1 }
    ], { duration: LEAVE_MS, easing: 'ease-in', fill: 'forwards' });
    setTimeout(function () {
      leaving--;
      if (!leaving) draw();
    }, LEAVE_MS);
  }
  /** Tasks that waited longest earn the most. */
  function praiseFor(waited) {
    if (waited >= WAITED_DAYS) return '拖了' + waited + '天，终于解决了！';
    var pick;
    do { pick = PRAISE[Math.floor(Math.random() * PRAISE.length)]; } while (pick === lastPraise);
    lastPraise = pick;
    return pick;
  }
  function celebrate(count) {
    var party = h('button', { class: 'party', onclick: function () { party.remove(); } },
      h('div', { class: 'party-big' }, '今天清空了 🎉'),
      h('div', { class: 'party-sub' }, '今天完成了 ' + count + ' 件，剩下的时间都是你的'));
    document.body.append(party);
    ding([660, 880, 1100, 1320]);
    burst(innerWidth / 2, innerHeight * 0.42, 60, Math.min(innerWidth, 460) * 0.7);
    setTimeout(function () { party.remove(); }, 2600);
  }
  function complete(t, row, tickBtn) {
    var today = todayStr(), hadNow = nowTasks().length;
    var waited = Math.max(0, daysBetween_((t.createdAt || nowStr()).slice(0, 10), today));
    var box = tickBtn.getBoundingClientRect();
    tickBtn.classList.add('on');
    tickBtn.disabled = true;
    haptic();
    ding(waited >= WAITED_DAYS ? [660, 880, 1100] : [880, 1320]);
    burst(box.left + box.width / 2, box.top + box.height / 2, Math.min(32, 10 + waited * 2), Math.min(120, 60 + waited * 4));

    var nextId = t.repeat ? newId() : '';
    var nextDue = nextId ? nextRound(t.repeat, t.due, today) : '';
    t.status = 'done';
    t.doneAt = nowStr();
    if (nextId) {
      list.push({ id: nextId, text: t.text, due: nextDue, group: t.group, repeat: t.repeat, status: 'open', raw: t.raw, createdAt: nowStr(), doneAt: '', showFrom: addDays_(nextDue, -repeatLead(t.repeat)) });
    }
    enqueue('todoUpdate', { id: t.id, status: 'done', doneAt: t.doneAt, nextId: nextId });
    save();
    drawProgress();
    if (quiet) draw();
    else slideAway(row);

    var note = praiseFor(waited) + (nextId ? ' 下次 ' + monthDay(nextDue) : '');
    toast(note, function () { reopen(t, nextId); });
    if (hadNow && !nowTasks().length) celebrate(doneOn(today).length);
  }
  function reopen(t, nextId) {
    t.status = 'open';
    t.doneAt = '';
    if (nextId) list = list.filter(function (x) { return x.id !== nextId; });
    enqueue('todoUpdate', { id: t.id, status: 'open', removeId: nextId || '' });
    save();
    draw();
  }

  /* ---------- the list ---------- */
  function shopeeLink(t) {
    var word = t.text.replace(/^.*?(?:购买|买)/, '').replace(/^\s*buy\s+/i, '').trim() || t.text;
    return h('a', { class: 'shop', href: 'https://shopee.sg/search?keyword=' + encodeURIComponent(word), target: '_blank', rel: 'noopener', 'aria-label': '在 Shopee 搜 ' + word }, 'Shopee');
  }
  function taskRow(t, today) {
    var tick = h('button', { class: 'tick', 'aria-label': '完成 ' + t.text });
    tick.innerHTML = '<span class="ring"><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg></span>';
    var row = h('div', { class: 'row' }, tick,
      h('button', { class: 'row-main', onclick: function () { openEdit(t); } },
        h('div', { class: 'row-text' }, t.text),
        h('div', { class: 'row-meta' },
          h('span', { class: t.due < today ? 'late' : '' }, dueLabel(t.due, today)),
          isWaiting(t, today) ? ' · ' + monthDay(t.showFrom) + '出现' : null,
          t.repeat ? ' · ' + repeatLabel(t.repeat) : null)),
      t.group === '买东西' ? shopeeLink(t) : null);
    tick.addEventListener('click', function () { complete(t, row, tick); });
    return row;
  }
  function section(title, tasks, today, cls) {
    if (!tasks.length) return null;
    return h('section', { class: cls || '' },
      h('div', { class: 'section-head' }, h('h2', null, title), h('span', { class: 'small muted' }, tasks.length + ' 件')),
      h('div', { class: 'card list' }, tasks.map(function (t) { return taskRow(t, today); })));
  }
  function drawProgress() {
    var box = $('#progress'), today = todayStr();
    if (!box) return;
    var done = doneOn(today).length, total = done + nowTasks().length;
    box.hidden = !list || !total || state.tab !== 'todo';
    if (box.hidden) return;
    $('#progress-text').textContent = done === total ? '今天 ' + done + '/' + total + ' 全部搞定 ✓' : '今天 ' + done + '/' + total;
    $('#progress-bar').style.width = Math.round(done / total * 100) + '%';
  }
  function drawChips(tasks) {
    var box = $('#chips');
    function chip(id, label) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.filter === id), onclick: function () { state.filter = id; draw(); } }, label);
    }
    var used = TODO_GROUPS.concat([TODO_NO_GROUP]).filter(function (g) {
      return g !== TODO_NO_GROUP || tasks.some(function (t) { return t.group === g; });
    });
    box.replaceChildren(chip('all', '全部 ' + tasks.length));
    used.forEach(function (g) { box.append(chip(g, g)); });
  }
  function trophyWall(today) {
    var monday = weekOf_(today, 0, 1);
    var done = list.filter(function (t) { return t.status === 'done'; }).sort(function (a, b) { return a.doneAt < b.doneAt ? 1 : -1; });
    var week = done.filter(function (t) { return t.doneAt.slice(0, 10) >= monday; }).length;
    var head = h('button', { class: 'trophy-head', 'aria-expanded': String(state.showDone), onclick: function () { state.showDone = !state.showDone; draw(); } },
      h('span', null, '🏆 本周完成 ', h('b', null, week), ' 件'), h('span', { class: 'small muted' }, state.showDone ? '收起' : '看看已完成'));
    if (!state.showDone) return h('div', { class: 'card trophy' }, head);
    var body = [], lastDay = '';
    done.forEach(function (t) {
      var day = t.doneAt.slice(0, 10);
      if (day !== lastDay) {
        var n = daysBetween_(day, today);
        body.push(h('div', { class: 'day' }, n === 0 ? '今天' : n === 1 ? '昨天' : monthDay(day) + ' ' + weekName(day)));
        lastDay = day;
      }
      body.push(h('div', { class: 'done-row' }, h('span', { class: 'done-mark' }, '✓'), h('span', { class: 'done-text' }, t.text),
        h('button', { class: 'link', onclick: function () { reopen(t, ''); } }, '恢复')));
    });
    return h('div', { class: 'card trophy' }, head, body.length ? body : h('p', { class: 'small muted' }, '还没有完成的事。勾掉第一件吧。'));
  }
  function waitingRow(tasks, today) {
    if (!tasks.length) return null;
    var head = h('button', { class: 'trophy-head', 'aria-expanded': String(state.showWaiting), onclick: function () { state.showWaiting = !state.showWaiting; draw(); } },
      h('span', null, '安排好了 ', h('b', null, tasks.length), ' 件'), h('span', { class: 'small muted' }, state.showWaiting ? '收起' : '到时候再出现'));
    return h('section', { class: 'waiting' }, h('div', { class: 'card trophy' }, head),
      state.showWaiting ? h('div', { class: 'card list' }, tasks.map(function (t) { return taskRow(t, today); })) : null);
  }
  function draw() {
    if (!list || !$('#list')) return;
    drawTabs();
    if (state.tab === 'ideas') return drawIdeas();
    var today = todayStr(), week = addDays_(today, 7);
    var all = open_().filter(function (t) { return !isWaiting(t, today); }).sort(byDue);
    var waiting = open_().filter(function (t) { return isWaiting(t, today); }).sort(byDue);
    if (state.filter !== 'all' && state.filter !== TODO_NO_GROUP && TODO_GROUPS.indexOf(state.filter) < 0) state.filter = 'all';
    var shown = all.filter(function (t) { return state.filter === 'all' || t.group === state.filter; });
    drawProgress();
    // Groups still pick the Shopee button, but the list is not filtered or labelled by them.
    state.filter = 'all';
    $('#chips').replaceChildren();
    var now = shown.filter(function (t) { return t.due <= today; });
    var soon = shown.filter(function (t) { return t.due > today && t.due <= week; });
    var later = shown.filter(function (t) { return t.due > week; });
    $('#list').replaceChildren.apply($('#list'), [
      section('现在要做', now, today, 'now'), section('这周', soon, today), section('以后', later, today),
      shown.length ? null : h('div', { class: 'card empty' }, state.filter === 'all' ? '没有待办了。想到什么，说一句就记下。' : '这一组没有待办。'),
      waitingRow(waiting, today),
      trophyWall(today)
    ].filter(Boolean));
  }

  /* ---------- ideas ---------- */
  function drawTabs() {
    var box = $('#tabs');
    function tab(id, label) {
      return h('button', { type: 'button', class: 'tab', 'aria-pressed': String(state.tab === id), onclick: function () {
        if (state.tab === id) return;
        state.tab = id;
        store.set('td_tab', id);
        render();
        scrollTo(0, 0);
      } }, label);
    }
    box.replaceChildren(tab('todo', '待办'), tab('ideas', '想法'));
  }
  function addIdea(text, kind, raw) {
    var now = nowStr(), rec = { id: newId(), text: text, kind: kind, stage: 'new', notes: '', raw: raw || text, createdAt: now, updatedAt: now, stageAt: now };
    ideas.push(rec);
    enqueue('ideaAdd', { id: rec.id, text: text, kind: kind, raw: raw || text });
    save();
    return rec;
  }
  function addNoteTo(idea, text) {
    var line = noteLine(todayStr(), text);
    idea.notes = addNote(idea.notes, line);
    idea.updatedAt = nowStr();
    enqueue('ideaUpdate', { id: idea.id, note: line });
    save();
    draw();
    toast('已补充到：' + short(idea.text), function () { moveNote(idea, line); }, '换一个');
  }
  /** The note went to the wrong idea: pick the right one. */
  function moveNote(from, line) {
    var others = ideas.filter(function (i) { return i.id !== from.id; }).sort(byRecent_);
    if (!others.length) return toast('没有别的想法可以放');
    sheet(function (close) {
      return h('div', { class: 'card editor' },
        h('h2', null, '放到哪个想法？'),
        h('div', { class: 'small muted' }, line.slice(11)),
        h('div', { class: 'picks' }, others.map(function (to) {
          return h('button', { class: 'pick', onclick: function () {
            from.notes = removeNote(from.notes, line);
            to.notes = addNote(to.notes, line);
            to.updatedAt = nowStr();
            enqueue('ideaUpdate', { id: from.id, removeNote: line });
            enqueue('ideaUpdate', { id: to.id, note: line });
            save();
            close();
            toast('已移到：' + short(to.text));
          } }, KIND_ICONS[to.kind] + ' ' + to.text);
        })),
        h('button', { class: 'btn ghost', onclick: close }, '不移了'));
    });
  }
  /** Open notes first, newest first; finished ones below, struck through. */
  function noteList(idea, onToggle, onRemove) {
    var lines = idea.notes ? idea.notes.split('\n') : [];
    if (!lines.length) return h('p', { class: 'small muted' }, '还没有补充。想到什么就加上。');
    var open = lines.filter(function (l) { return !noteDone(l); }), done = lines.filter(noteDone);
    return h('div', { class: 'notes' }, open.concat(done).map(function (line) {
      var n = readNote(line);
      var tick = h('button', { class: 'tick small' + (n.done ? ' on' : ''), 'aria-label': (n.done ? '标为没做完 ' : '做完了 ') + n.text, onclick: function () { onToggle(line); } });
      tick.innerHTML = '<span class="ring"><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg></span>';
      return h('div', { class: 'note' + (n.done ? ' done' : '') }, tick,
        h('div', { class: 'note-body' }, h('span', { class: 'note-day' }, monthDay(n.day)), ' ', h('span', { class: 'note-text' }, n.text)),
        h('button', { class: 'link', 'aria-label': '删掉这条', onclick: function () { onRemove(line); } }, '删'));
    }));
  }
  function noteCounts(idea) {
    var lines = idea.notes ? idea.notes.split('\n') : [], done = lines.filter(noteDone).length;
    return { open: lines.length - done, done: done };
  }
  function openQuickNote(idea) {
    var box = h('textarea', { rows: 3, lang: 'zh-CN', enterkeyhint: 'send', placeholder: '按麦克风说补充的内容', 'aria-label': '补充 ' + idea.text });
    sheet(function (close) {
      function addIt() {
        var text = box.value.trim();
        if (!text) return box.focus();
        close();
        addNoteTo(idea, text);
      }
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); addIt(); }
      });
      return h('div', { class: 'card editor' },
        h('div', { class: 'small muted' }, '补充到'),
        h('div', { class: 'row-text' }, KIND_ICONS[idea.kind] + ' ' + idea.text),
        box,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: close }, '取消'), h('button', { class: 'btn', onclick: addIt }, '加上')));
    });
    // Focused inside the tap, so the iPhone keyboard opens.
    box.focus();
  }
  function openIdea(idea) {
    sheet(function (close) {
      var kind = idea.kind, stage = idea.stage, armed = false;
      var text = h('textarea', { rows: 2, 'aria-label': '想法' }, idea.text);
      var kindBox = h('div', { class: 'chips' }), stageBox = h('div', { class: 'chips' }), stageHint = h('div', { class: 'small muted' });
      var notesBox = h('div');
      function drawKinds() {
        kindBox.replaceChildren();
        IDEA_KINDS.forEach(function (k) {
          kindBox.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(k === kind), onclick: function () { kind = k; drawKinds(); } }, KIND_ICONS[k] + ' ' + k));
        });
      }
      function drawStages() {
        stageBox.replaceChildren();
        IDEA_STAGES.forEach(function (st) {
          stageBox.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(st === stage), onclick: function () { stage = st; drawStages(); } }, STAGE_INFO[st][0] + ' ' + STAGE_INFO[st][1]));
        });
        stageHint.textContent = STAGE_HINTS[stage];
      }
      function drawNotes() {
        notesBox.replaceChildren(noteList(idea, function (line) {
          var finishing = !noteDone(line);
          idea.notes = toggleNote(idea.notes, line);
          idea.updatedAt = nowStr();
          enqueue('ideaUpdate', { id: idea.id, toggleNote: line });
          save();
          if (finishing) { haptic(); ding([880, 1320]); }
          drawNotes();
        }, function (line) {
          idea.notes = removeNote(idea.notes, line);
          enqueue('ideaUpdate', { id: idea.id, removeNote: line });
          save();
          drawNotes();
        }));
      }
      var noteBox = h('textarea', { rows: 1, lang: 'zh-CN', enterkeyhint: 'send', placeholder: '加一条补充', 'aria-label': '加一条补充' });
      function addIt() {
        var t = noteBox.value.trim();
        if (!t) return noteBox.focus();
        var line = noteLine(todayStr(), t);
        idea.notes = addNote(idea.notes, line);
        idea.updatedAt = nowStr();
        enqueue('ideaUpdate', { id: idea.id, note: line });
        save();
        noteBox.value = '';
        drawNotes();
      }
      noteBox.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); addIt(); }
      });
      drawKinds();
      drawStages();
      drawNotes();
      var del = h('button', { class: 'btn danger', onclick: function () {
        if (!armed) { armed = true; del.textContent = '再点一次删除'; return; }
        ideas = ideas.filter(function (x) { return x.id !== idea.id; });
        enqueue('ideaUpdate', { id: idea.id, remove: true });
        save();
        close();
      } }, '删除');
      return h('div', { class: 'card editor' },
        h('label', { class: 'field' }, '想法', text),
        h('div', { class: 'stack tight' }, h('div', { class: 'small muted' }, '哪一类'), kindBox),
        h('div', { class: 'stack tight' }, h('div', { class: 'small muted' }, '进展到哪了'), stageBox, stageHint),
        h('div', { class: 'stack tight' }, h('div', { class: 'small muted' }, '补充'),
          h('div', { class: 'capture-row' }, noteBox, h('button', { class: 'btn add', onclick: addIt }, '加')), notesBox),
        idea.raw && idea.raw !== idea.text ? h('div', { class: 'small muted' }, '你说的原话：' + idea.raw) : null,
        h('div', { class: 'btn-row' }, del,
          h('button', { class: 'btn', onclick: function () {
            var newText = text.value.trim();
            if (!newText) return toast('想法不能是空的');
            var change = { id: idea.id };
            if (newText !== idea.text) change.text = idea.text = newText;
            if (kind !== idea.kind) change.kind = idea.kind = kind;
            var reachedUsable = stage === 'usable' && idea.stage !== 'usable';
            if (stage !== idea.stage) { change.stage = idea.stage = stage; idea.stageAt = nowStr(); }
            if (Object.keys(change).length > 1) {
              idea.updatedAt = nowStr();
              enqueue('ideaUpdate', change);
              save();
            }
            close();
            if (reachedUsable) {
              ding([660, 880, 1100]);
              toast('能用了 ✅ 之后的改进记在补充里');
            }
          } }, '保存')));
    });
  }
  function ideaRow(idea, today) {
    var stale = ideaStale(idea, today), counts = noteCounts(idea);
    var doingDays = idea.stage === 'doing' ? Math.max(0, daysBetween_(String(idea.stageAt || idea.createdAt).slice(0, 10), today)) : -1;
    var meta = [doingDays >= 0 ? '在做 ' + doingDays + ' 天' : null, counts.open ? '待改 ' + counts.open : null].filter(Boolean).join(' · ');
    return h('div', { class: 'row idea' + (idea.kind === '赚钱' ? ' money' : '') },
      h('button', { class: 'row-main', onclick: function () { openIdea(idea); } },
        h('div', { class: 'row-text' }, idea.text),
        h('div', { class: 'row-meta' }, kindBadge(idea.kind), meta,
          // A gentle sign that it has sat in 在做 for 3 weeks: time to ship a usable version.
          stale ? h('span', { class: 'tag', title: '好一阵没动了。先做出一个能用的版本？' }, '该推进了') : null)),
      h('button', { class: 'plus', 'aria-label': '补充 ' + idea.text, onclick: function () { openQuickNote(idea); } }, h('span', null, '+')));
  }
  /** The kind with its icon at the start of every idea row. 赚钱 is gold, to pull the eye toward it. */
  function kindBadge(kind) {
    return h('span', { class: 'kind' + (kind === '赚钱' ? ' kind-money' : '') }, KIND_ICONS[kind] + ' ' + kind);
  }
  function ideaSection(stage, items, today) {
    if (!items.length) return null;
    return h('section', { class: stage === 'doing' ? 'now' : '' },
      h('div', { class: 'section-head' }, h('h2', null, STAGE_INFO[stage][1]), h('span', { class: 'small muted' }, items.length + ' 个')),
      h('div', { class: 'card list' }, items.map(function (i) { return ideaRow(i, today); })));
  }
  function drawIdeas() {
    var today = todayStr();
    if (state.kind !== 'all' && IDEA_KINDS.indexOf(state.kind) < 0) state.kind = 'all';
    var shown = ideas.filter(function (i) { return state.kind === 'all' || i.kind === state.kind; });
    var box = $('#chips');
    function chip(id, label) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.kind === id), onclick: function () { state.kind = id; draw(); } }, label);
    }
    var live = ideas.filter(function (i) { return i.stage !== 'shelved'; });
    box.replaceChildren(chip('all', '全部 ' + live.length));
    IDEA_KINDS.forEach(function (k) {
      var n = live.filter(function (i) { return i.kind === k; }).length;
      box.append(chip(k, KIND_ICONS[k] + ' ' + k));
    });
    function of(stage) { return shown.filter(function (i) { return i.stage === stage; }).sort(byRecent_); }
    var doing = of('doing').sort(function (a, b) { return ideaStale(b, today) - ideaStale(a, today); });
    var fresh = of('new'), usable = of('usable'), shelved = of('shelved');
    var shelf = null;
    if (shelved.length) {
      var head = h('button', { class: 'trophy-head', 'aria-expanded': String(state.showShelved), onclick: function () { state.showShelved = !state.showShelved; draw(); } },
        h('span', null, '放下的 ', h('b', null, shelved.length), ' 个'), h('span', { class: 'small muted' }, state.showShelved ? '收起' : '看看'));
      shelf = h('section', null, h('div', { class: 'card trophy' }, head),
        state.showShelved ? h('div', { class: 'card list' }, shelved.map(function (i) { return ideaRow(i, today); })) : null);
    }
    var empty = doing.length + fresh.length + usable.length ? null
      : h('div', { class: 'card empty' }, state.kind === 'all' ? '还没有想法。说一句“想法：……”就记下。' : '这一类还没有想法。');
    $('#list').replaceChildren.apply($('#list'), [
      ideaSection('doing', doing, today), ideaSection('new', fresh, today), ideaSection('usable', usable, today), empty, shelf
    ].filter(Boolean));
  }

  /* ---------- logging ---------- */
  /** In the 想法 tab every sentence is an idea, unless it is a 补充 for one. Elsewhere only 想法… and 补充… are. */
  function readInput(text) {
    var cap = readCapture(text, ideas);
    if (cap.type === 'todo' && state.tab === 'ideas') {
      var plain = fullComma_(halfWidth_(text).trim()).slice(0, 500);
      cap = { type: 'idea', text: plain, kind: ideaKind(plain) };
    }
    return cap;
  }
  function buildInput() {
    var onIdeas = state.tab === 'ideas';
    var box = h('textarea', { id: 'capture', rows: 1, lang: 'zh-CN', enterkeyhint: 'send', placeholder: onIdeas ? '说个想法，或“补充 某想法：…”' : '说一句，如：两周内买维生素D', 'aria-label': onIdeas ? '新想法' : '新待办', autocomplete: 'off' });
    // Only shown while typing, so the top of the screen stays calm.
    var hint = h('div', { class: 'preview small muted', id: 'preview', hidden: true });
    function resize() { box.style.height = 'auto'; box.style.height = box.scrollHeight + 2 + 'px'; }
    function preview() {
      resize();
      var text = box.value.trim();
      hint.hidden = !text;
      if (!text) return;
      var cap = readInput(text);
      if (cap.type === 'note') { hint.textContent = '→ 补充到：' + findIdea(cap.id).text; return; }
      if (cap.type === 'idea') { hint.textContent = '→ 想法 · ' + cap.kind; return; }
      var p = parseTodo(text, todayStr());
      hint.textContent = '→ ' + p.text + ' · ' + monthDay(p.due) + '（' + weekName(p.due) + '）' + (p.dated ? '' : ' 默认一周') + ' · ' + p.group + (p.repeat ? ' · ' + repeatLabel(p.repeat) : '');
    }
    function add() {
      var text = box.value.trim();
      if (!text) return box.focus();
      var cap = readInput(text);
      if (cap.type !== 'todo') {
        box.value = '';
        preview();
        box.focus();
        if (cap.type === 'note') return addNoteTo(findIdea(cap.id), cap.note);
        var idea = addIdea(cap.text, cap.kind, text);
        if (state.kind !== 'all' && state.kind !== idea.kind) state.kind = 'all';
        draw();
        if (state.tab === 'ideas') return toast('已记下想法 · ' + idea.kind);
        return toast('已记下想法 💡', function () { state.tab = 'ideas'; store.set('td_tab', 'ideas'); render(); }, '去看看');
      }
      var today = todayStr(), id = newId(), p = parseTodo(text, today);
      list.push({ id: id, text: p.text, due: p.due, group: p.group, repeat: p.repeat, status: 'open', raw: text, createdAt: nowStr(), doneAt: '' });
      enqueue('todoAdd', { id: id, text: text, plain: true });
      save();
      box.value = '';
      preview();
      box.focus();
      if (state.filter !== 'all' && state.filter !== p.group) state.filter = 'all';
      draw();
      toast('已记下 · ' + dueLabel(p.due, today));
    }
    box.addEventListener('input', preview);
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); add(); }
    });
    return h('div', { class: 'capture' },
      h('div', { class: 'capture-row' }, box, h('button', { class: 'btn add', onclick: add }, '加')), hint);
  }

  /* ---------- editing ---------- */
  function sheet(content) {
    var overlay = h('div', { class: 'overlay', onclick: function (e) { if (e.target === overlay) close(); } });
    function close() { overlay.remove(); draw(); }
    overlay.append(h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'grab' }), content(close)));
    document.body.append(overlay);
  }
  function openEdit(t) {
    sheet(function (close) {
      var today = todayStr(), due = t.due, group = t.group;
      var text = h('textarea', { rows: 2, 'aria-label': '内容' }, t.text);
      var date = h('input', { type: 'date', value: due, 'aria-label': '日期' });
      var dateBox = h('div', { class: 'chips' }), groupBox = h('div', { class: 'chips' });
      var quick = [['今天', today], ['明天', addDays_(today, 1)], ['这周', weekOf_(today, 0, 7)], ['下周', weekOf_(today, 1, 7)], ['两周', addDays_(today, 14)], ['一个月', addMonths_(today, 1)]];
      function drawDates() {
        dateBox.replaceChildren();
        quick.forEach(function (q) {
          dateBox.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(q[1] === due), onclick: function () { due = q[1]; date.value = due; drawDates(); } }, q[0]));
        });
      }
      function drawGroups() {
        groupBox.replaceChildren();
        TODO_GROUPS.concat([TODO_NO_GROUP]).forEach(function (g) {
          groupBox.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(g === group), onclick: function () { group = g; drawGroups(); } }, GROUP_ICONS[g] + ' ' + g));
        });
      }
      drawDates();
      drawGroups();
      date.addEventListener('change', function () { if (date.value) { due = date.value; drawDates(); } });
      // A count like 1.5 months goes in the custom fields; a weekday or day of the month keeps its own option.
      var preset = REPEATS.some(function (r) { return r[0] === t.repeat; });
      var counted = preset ? null : /^(\d+(?:\.\d+)?)([dwm])$/.exec(t.repeat || '');
      var options = REPEATS.concat(preset || counted ? [] : [[t.repeat, repeatLabel(t.repeat)]], [['custom', '自定义…']]);
      var repeat = h('select', { 'aria-label': '重复' }, options.map(function (r) { return h('option', { value: r[0] }, r[1]); }));
      repeat.value = counted ? 'custom' : t.repeat || '';
      var count = h('input', { type: 'text', inputmode: 'decimal', value: counted ? counted[1] : '', placeholder: '1.5', 'aria-label': '每隔多少' });
      var unit = h('select', { 'aria-label': '单位' }, REPEAT_UNITS.map(function (u) { return h('option', { value: u[0] }, u[1]); }));
      unit.value = counted ? counted[2] : 'm';
      var custom = h('div', { class: 'repeat-custom' }, h('span', null, '每'), count, unit);
      custom.hidden = repeat.value !== 'custom';
      repeat.addEventListener('change', function () {
        custom.hidden = repeat.value !== 'custom';
        if (!custom.hidden) count.focus();
      });
      return h('div', { class: 'card editor' },
        h('label', { class: 'field' }, '内容', text),
        h('div', { class: 'stack tight' }, h('div', { class: 'small muted' }, '什么时候'), dateBox, date),
        h('div', { class: 'stack tight' }, h('div', { class: 'small muted' }, '分组'), groupBox),
        h('div', { class: 'stack tight' }, h('label', { class: 'field' }, '重复', repeat), custom),
        t.raw && t.raw !== t.text ? h('div', { class: 'small muted' }, '你说的原话：' + t.raw) : null,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn danger', onclick: function () {
            list = list.filter(function (x) { return x.id !== t.id; });
            enqueue('todoUpdate', { id: t.id, remove: true });
            save();
            close();
          } }, '删除'),
          h('button', { class: 'btn', onclick: function () {
            var newText = text.value.trim();
            if (!newText) return toast('内容不能是空的');
            var every = repeat.value;
            if (every === 'custom') {
              var n = Number(halfWidth_(count.value).trim());
              every = n + unit.value;
              if (!isRepeat(every)) return toast('重复间隔要大于 0，最长一年');
            }
            if (due !== t.due) t.showFrom = '';
            Object.assign(t, { text: newText, due: due, group: group, repeat: every });
            enqueue('todoUpdate', { id: t.id, text: newText, due: due, group: group, repeat: every });
            save();
            close();
          } }, '保存')));
    });
  }

  /* ---------- setup and settings ---------- */
  function renderSetup() {
    $('#tabs').replaceChildren('待办');
    var url = h('input', { type: 'text', placeholder: 'https://script.google.com/macros/s/.../exec', autocomplete: 'off', autocapitalize: 'off', value: cfg.url, 'aria-label': '网址' });
    var tok = h('input', { type: 'text', placeholder: '粘贴令牌', autocomplete: 'off', autocapitalize: 'off', 'aria-label': '令牌' });
    var msg = h('p', { class: 'small muted' });
    function connect(u, t) {
      cfg = { url: u, token: t };
      msg.textContent = '连接中…';
      api('todoList').then(function (d) {
        store.set('td_url', u);
        store.set('td_token', t);
        list = d.todos;
        ideas = d.ideas || [];
        save();
        render();
      }).catch(function (e) { msg.textContent = '没连上：' + e.message; cfg = { url: '', token: '' }; });
    }
    $('#view').replaceChildren(h('div', { class: 'card setup' },
      h('h2', null, '连接你的表格'),
      h('p', { class: 'small muted' }, '粘贴 Apps Script 的网址和令牌。只保存在这部手机上。'),
      h('label', { class: 'field' }, '网址', url),
      h('label', { class: 'field' }, '令牌', tok),
      h('button', { class: 'btn', onclick: function () { connect(url.value.trim(), tok.value.trim()); } }, '连接'),
      h('button', { class: 'btn ghost', onclick: function () { connect('', 'demo'); } }, '先用示例数据试试'),
      msg));
  }
  function renderProblem(e) {
    $('#tabs').replaceChildren('待办');
    $('#view').replaceChildren(h('div', { class: 'card empty' },
      h('p', null, '读取不到你的待办。'), h('p', { class: 'small' }, e && e.message || ''),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: render }, '再试一次'),
        h('button', { class: 'btn ghost', onclick: signOut }, '重新连接'))));
  }
  function signOut() {
    ['td_url', 'td_token', 'td_list', 'td_queue', 'td_mock', 'td_ideas', 'td_mock_ideas'].forEach(store.del);
    cfg = { url: '', token: '' };
    list = null;
    ideas = [];
    queue = [];
    problem = '';
    setStatus();
    renderSetup();
  }
  function render() {
    if (!connected()) return renderSetup();
    if (!list) {
      $('#view').replaceChildren(h('div', { class: 'skeleton' }));
      return void refresh();
    }
    $('#view').replaceChildren(buildInput(),
      h('div', { class: 'progress', id: 'progress', hidden: true },
        h('span', { class: 'progress-text', id: 'progress-text' }),
        h('div', { class: 'bar' }, h('i', { id: 'progress-bar' }))),
      h('div', { class: 'chips filters', id: 'chips' }),
      h('div', { class: 'stack', id: 'list' }));
    draw();
  }
  $('#settings-btn').addEventListener('click', function () {
    sheet(function (close) {
      var sound = h('input', { type: 'checkbox', id: 'sound' });
      sound.checked = soundOn();
      sound.addEventListener('change', function () { store.set('td_sound', sound.checked ? 'on' : 'off'); });
      return h('div', { class: 'card editor' },
        h('h2', null, '设置'),
        h('p', { class: 'small muted' }, cfg.token === 'demo' ? '现在看到的是示例数据。' : '已连接你的表格。网址和令牌只保存在这部手机上。'),
        h('label', { class: 'check' }, sound, '完成时的提示音'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn ghost', onclick: close }, '关闭'),
          h('button', { class: 'btn danger', onclick: function () { close(); signOut(); } }, '断开连接')));
    });
  });

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  $('#refresh-btn').addEventListener('click', function () { flush(); refresh(); });
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !connected()) return;
    if (!busy()) draw();
    flush();
    if (Date.now() - lastRefresh > 60000) refresh();
  });

  render();
  setStatus();
  if (connected()) {
    flush();
    if (list) refresh();
  }
})();
