/* Sample data for trying the app without a backend. Used only when the token is "demo". All tasks are made up. */
(function () {
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function sample() {
    var t = today();
    function task(id, text, days, group, repeat, age) {
      return { id: id, text: text, due: addDays_(t, days), group: group, repeat: repeat || '', status: 'open', raw: text, createdAt: addDays_(t, -(age || 0)) + 'T09:00:00', doneAt: '' };
    }
    var done = task('s6', '买婴儿湿巾', -1, '买东西', '', 2);
    done.status = 'done';
    done.doneAt = addDays_(t, -1) + 'T18:30:00';
    return [
      Object.assign(task('s1', '买维生素D', -2, '买东西', '', 12), { buyEn: 'vitamin D' }),
      task('s2', '转账给房东', 0, '手机办'),
      task('s3', '给车打气', 3, '出门办', '1m'),
      task('s4', '报销保险', 5, '手机办', '', 1),
      task('s5', '把车送去保养', 20, '出门办'),
      done
    ];
  }
  function sampleIdeas() {
    var t = today();
    function idea(id, text, kind, stage, ageDays, notes) {
      var at = addDays_(t, -ageDays) + 'T09:00:00';
      return { id: id, text: text, kind: kind, stage: stage, notes: notes || '', raw: text, createdAt: at, updatedAt: at, stageAt: at };
    }
    return [
      idea('i1', '做个自动给发票分类的流程', '改进', 'doing', 30, addDays_(t, -30) + ' 先从 Gmail 里的电子账单开始'),
      idea('i2', '帮朋友做记账表模板，收一点费用', '赚钱', 'new', 2),
      idea('i3', '待办 app 加一个想法清单', '改进', 'usable', 1, addDays_(t, -1) + ' 补充可以用语音直接加\n' + addDays_(t, -3) + ' 第一版能用了'),
      idea('i4', '宝宝成长相册自动整理', '新东西', 'new', 5),
      idea('i5', '二手婴儿用品转卖', '赚钱', 'shelved', 40)
    ];
  }
  function load() { try { return JSON.parse(localStorage.getItem('td_mock')) || sample(); } catch (e) { return sample(); } }
  function loadIdeas() { try { return JSON.parse(localStorage.getItem('td_mock_ideas')) || sampleIdeas(); } catch (e) { return sampleIdeas(); } }
  function keep() { try { localStorage.setItem('td_mock', JSON.stringify(rows)); localStorage.setItem('td_mock_ideas', JSON.stringify(ideas)); } catch (e) {} }
  function now() { return today() + 'T12:00:00'; }
  /* A stand-in for Google Translate in the backend. */
  function fakeEn(text) {
    var w = buyWord(text), known = { 维生素D: 'vitamin D', 尿布: 'diapers', 婴儿湿巾: 'baby wipes', 湿巾: 'wet wipes', 奶粉: 'milk powder' };
    return /[一-鿿]/.test(w) ? known[w] || 'thing' : w;
  }
  function reply(v) { return new Promise(function (r) { setTimeout(function () { r(JSON.parse(JSON.stringify(v))); }, 150); }); }
  var rows = load(), ideas = loadIdeas();

  window.MockApi = function (req) {
    var a = req.action;
    if (window.__failNext) { window.__failNext = false; return Promise.reject(new Error('no connection')); }
    if (a === 'todoList') return reply({ todos: rows, ideas: ideas });
    if (a === 'ideaAdd') {
      var made = { id: req.id, text: req.text, kind: req.kind || ideaKind(req.text), stage: 'new', notes: '', raw: req.raw || req.text, createdAt: now(), updatedAt: now(), stageAt: now() };
      if (!ideas.some(function (i) { return i.id === req.id; })) ideas.push(made);
      keep();
      return reply({ idea: made });
    }
    if (a === 'ideaUpdate') {
      var it = ideas.filter(function (i) { return i.id === req.id; })[0];
      if (!it) return Promise.reject(new Error('not found'));
      if (req.remove) { ideas = ideas.filter(function (i) { return i.id !== req.id; }); keep(); return reply({ id: req.id }); }
      ['text', 'kind'].forEach(function (k) { if (req[k] !== undefined) it[k] = req[k]; });
      if (req.stage !== undefined && req.stage !== it.stage) { it.stage = req.stage; it.stageAt = now(); }
      if (req.removeNote) it.notes = removeNote(it.notes, req.removeNote);
      if (req.toggleNote) it.notes = toggleNote(it.notes, req.toggleNote);
      if (req.note) it.notes = addNote(it.notes, req.note);
      it.updatedAt = now();
      keep();
      return reply({ idea: it });
    }
    if (a === 'todoAdd') {
      var p = parseTodo(req.text, today());
      var rec = { id: req.id, text: p.text, due: p.due, group: p.group, repeat: p.repeat, status: 'open', raw: req.text, createdAt: today() + 'T12:00:00', doneAt: '', buyEn: p.group === '买东西' ? fakeEn(p.text) : '' };
      if (!rows.some(function (r) { return r.id === req.id; })) rows.push(rec);
      keep();
      return reply({ tasks: [rec], message: '已记下：' + rec.text });
    }
    if (a === 'todoUpdate') {
      var t = rows.filter(function (r) { return r.id === req.id; })[0];
      if (!t) return Promise.reject(new Error('not found'));
      if (req.remove) rows = rows.filter(function (r) { return r.id !== req.id; });
      else {
        if (req.due !== undefined && req.due !== t.due) t.showFrom = '';
        var oldText = t.text, en;
        ['text', 'due', 'group', 'repeat', 'buyEn'].forEach(function (k) { if (req[k] !== undefined) t[k] = req[k]; });
        if (req.buyEn === undefined && t.group === '买东西' && t.text !== oldText) en = t.buyEn = fakeEn(t.text);
        if (req.status === 'done') {
          t.status = 'done';
          t.doneAt = req.doneAt;
          if (t.repeat && req.nextId) { var nd = nextRound(t.repeat, t.due, today()); rows.push({ id: req.nextId, text: t.text, due: nd, group: t.group, repeat: t.repeat, status: 'open', raw: t.raw, createdAt: today() + 'T12:00:00', doneAt: '', showFrom: addDays_(nd, -repeatLead(t.repeat)) }); }
        } else if (req.status === 'open') {
          t.status = 'open';
          t.doneAt = '';
          rows = rows.filter(function (r) { return r.id !== req.removeId; });
        }
      }
      keep();
      return reply(en !== undefined ? { id: req.id, buyEn: en } : { id: req.id });
    }
    return Promise.reject(new Error('unknown action'));
  };
})();
