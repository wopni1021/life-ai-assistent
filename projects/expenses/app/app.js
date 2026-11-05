/* Life Expenses phone app. Plain JS. Talks to the Apps Script web app with POST text/plain JSON. */
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
  var cfg = { url: store.get('le_url') || '', token: store.get('le_token') || '' };
  var state = { tab: store.get('le_tab') || 'home', month: null, query: '', filter: 'all', account: null };
  if (state.tab === 'review') state.tab = 'home';

  /* Saved copy of the last sync. A cache on this phone only; the sheet stays the source of truth. */
  var db = null;
  try { db = JSON.parse(store.get('le_db') || 'null'); } catch (e) { db = null; }
  var monthCache = {};
  var syncing = null, syncProblem = '', lastSyncMs = null;
  var lastSyncAt = Number(store.get('le_synced')) || 0;
  var pending = 0, writeQueue = Promise.resolve();

  /* ---------- helpers ---------- */
  function fmt(n) {
    n = Number(n) || 0;
    return (n < 0 ? '−' : '') + 'S$' + Math.abs(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function parseMoney(s) {
    var n = Number(String(s || '').replace(/[^0-9.\-]/g, ''));
    return isFinite(n) && String(s || '').trim() !== '' ? n : NaN;
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function monthLabel(m) {
    var p = m.split('-').map(Number);
    return new Date(p[0], p[1] - 1, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
  }
  function dayLabel(d) {
    var p = d.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function sinceText(ms) {
    var mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    if (mins < 1440) return Math.round(mins / 60) + ' h ago';
    return Math.round(mins / 1440) + ' days ago';
  }
  function ago(iso) {
    if (!iso) return 'none yet';
    var mins = Math.round((Date.now() - new Date(iso + '+08:00').getTime()) / 60000);
    if (!isFinite(mins)) return iso;
    if (mins < 2) return 'just now';
    if (mins < 60) return mins + ' min ago';
    if (mins < 1440) return Math.round(mins / 60) + ' h ago';
    return Math.round(mins / 1440) + ' days ago';
  }
  var toastTimer;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function api(action, payload) {
    var body = Object.assign({ action: action, token: cfg.token }, payload || {});
    if (cfg.token === 'demo') return window.MockApi(body);
    return fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || 'Something went wrong'); return j.data; });
  }
  var view = $('#view');
  function show() { view.replaceChildren.apply(view, arguments); }
  function loading() { show(h('div', { class: 'stack' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }))); }
  function failed(err) {
    var msg = err && err.message ? err.message : 'Could not reach the server';
    var signedOut = /unauthorized|too many/.test(msg);
    show(h('div', { class: 'card empty' },
      h('p', null, signedOut ? 'The app token was not accepted.' : 'Could not load your data.'),
      h('p', { class: 'small' }, msg),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: function () { render(); } }, 'Try again'),
        signedOut ? h('button', { class: 'btn ghost', onclick: signOut }, 'Re-enter token') : null)));
  }

  /* ---------- shell ---------- */
  var TABS = [
    ['home', 'Home', '<path d="M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z"/>'],
    ['txns', 'Activity', '<path d="M5 7h14M5 12h14M5 17h9"/>'],
    ['vouchers', 'Vouchers', '<path d="M3 8a2 2 0 012-2h14a2 2 0 012 2v2.5a1.5 1.5 0 000 3V16a2 2 0 01-2 2H5a2 2 0 01-2-2v-2.5a1.5 1.5 0 000-3z"/><path d="M14 6v12" stroke-dasharray="2 2.5"/>'],
    ['add', 'Add', '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>']
  ];
  function buildTabs() {
    var nav = $('#tabs'); nav.replaceChildren();
    TABS.forEach(function (t) {
      var b = h('button', { role: 'tab', 'data-tab': t[0], 'aria-selected': String(state.tab === t[0]), onclick: function () { setTab(t[0]); } });
      b.innerHTML = '<svg viewBox="0 0 24 24">' + t[2] + '</svg>';
      b.append(t[1]);
      if (t[0] === 'vouchers' && db) {
        var due = dueVouchers();
        if (due.length) b.append(h('span', { class: 'badge' + (due[0].level === 'urgent' ? ' urgent' : '') }, String(due.length)));
      }
      nav.append(b);
    });
    nav.hidden = !(cfg.token && (cfg.token === 'demo' || cfg.url));
  }
  function setTab(t) {
    state.tab = t; state.account = null; store.set('le_tab', t);
    buildTabs(); render(); window.scrollTo(0, 0);
  }
  function connected() { return !!(cfg.token && (cfg.token === 'demo' || cfg.url)); }
  function render() {
    if (!connected()) return renderSetup();
    $('#tabs').hidden = false;
    if (!db) { loading(); sync(true); return; }
    if (state.tab === 'home' && state.account) return renderTxns(state.account);
    ({ home: renderHome, txns: function () { renderTxns(null); }, vouchers: renderVouchers, add: renderAdd })[state.tab]();
  }
  function signOut() {
    store.del('le_url'); store.del('le_token'); store.del('le_db'); store.del('le_synced');
    cfg = { url: '', token: '' }; db = null; monthCache = {}; lastSyncAt = 0;
    setStatus(); $('#tabs').hidden = true; renderSetup();
  }

  /* ---------- data ---------- */
  function saveDb() { store.set('le_db', JSON.stringify(db)); }
  function setDb(d) { delete d.fetchFailed; db = d; monthCache = {}; saveDb(); buildTabs(); }
  function setStatus() {
    var el = $('#sync-status');
    if (!connected()) { el.textContent = ''; return; }
    if (syncing) el.textContent = 'Updating...';
    else if (syncProblem) el.textContent = syncProblem;
    else el.textContent = lastSyncAt ? 'Updated ' + sinceText(lastSyncAt) : '';
  }
  /** Someone is typing or editing, so a background update must not redraw under them. */
  function busy() {
    var a = document.activeElement;
    return !!document.querySelector('.overlay') || state.tab === 'add' || !!document.querySelector('details.fix[open]') ||
      !!(a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
  }
  function drawNow() { var y = window.scrollY; buildTabs(); render(); window.scrollTo(0, y); }
  /** Fetches new alerts and fresh numbers. force skips the "nothing changed" shortcut. */
  function sync(force) {
    if (syncing) return syncing;
    if (!connected()) return Promise.resolve();
    var t0 = Date.now();
    syncing = api('sync', { version: db ? db.version : '', force: !!force || !db || !db.vouchers }).then(function (d) {
      lastSyncMs = Date.now() - t0; lastSyncAt = Date.now(); store.set('le_synced', String(lastSyncAt));
      syncProblem = d.fetchFailed ? 'Could not check email. Showing what is saved.' : '';
      if (!d.unchanged && pending === 0) {
        var first = !db;
        setDb(d);
        syncing = null;
        if (first || !busy()) drawNow();
      }
    }).catch(function (e) {
      syncProblem = 'Could not update. Showing saved data.';
      syncing = null;
      if (!db || /unauthorized|too many/.test(e.message || '')) failed(e);
    }).then(function () { syncing = null; setStatus(); });
    setStatus();
    return syncing;
  }
  /**
   * Shows a change straight away, then sends it in the background, one at a time.
   * The reply brings fresh totals. If sending fails, the change is undone.
   */
  function mutate(action, payload, applyLocal, onDone) {
    var before = JSON.stringify(db), beforeCache = JSON.stringify(monthCache);
    applyLocal();
    saveDb();
    pending++;
    drawNow();
    writeQueue = writeQueue.then(function () { return api(action, payload); }).then(function (res) {
      pending--;
      if (pending === 0 && res.snapshot) {
        setDb(res.snapshot);
        if (!busy()) drawNow();
      }
      if (onDone) onDone(res);
    }).catch(function (e) {
      pending--;
      db = JSON.parse(before); monthCache = JSON.parse(beforeCache); saveDb();
      drawNow();
      toast('Could not save: ' + (e.message || 'no connection'));
    });
  }
  function findRows(id) {
    var found = db.rows.filter(function (r) { return r.id === id; });
    Object.keys(monthCache).forEach(function (m) {
      found = found.concat(monthCache[m].filter(function (r) { return r.id === id; }));
    });
    return found;
  }
  function retotal() {
    var b = db.balances, money = 0, owed = 0;
    b.accounts.forEach(function (a) { if (a.type === 'card') owed -= a.balance; else money += a.balance; });
    b.totalMoney = Math.round(money * 100) / 100; b.cardOwed = Math.round(owed * 100) / 100;
  }
  function moveBalance(id, delta) {
    db.balances.accounts.forEach(function (a) { if (a.id === id) a.balance = Math.round((a.balance + delta) * 100) / 100; });
    retotal();
  }
  function rowDelta(r, id) {
    return (r.effects || []).reduce(function (sum, e) { return e.account === id ? sum + e.delta : sum; }, 0);
  }
  function makeCtx() {
    var names = {};
    db.balances.accounts.forEach(function (a) { names[a.id] = a.name; });
    return { categories: db.categories, accounts: db.balances.accounts, accountName: function (id) { return names[id] || id; } };
  }

  /* ---------- setup ---------- */
  function renderSetup() {
    $('#tabs').hidden = true;
    var url = h('input', { type: 'text', id: 'cfg-url', placeholder: 'https://script.google.com/macros/s/.../exec', autocomplete: 'off', autocapitalize: 'off', value: cfg.url });
    var tok = h('input', { type: 'text', id: 'cfg-token', placeholder: 'Paste your app token', autocomplete: 'off', autocapitalize: 'off' });
    var msg = h('p', { class: 'small muted' });
    function connect(u, t) {
      cfg = { url: u, token: t };
      msg.textContent = 'Checking...';
      api('sync', { force: true }).then(function (d) {
        store.set('le_url', u); store.set('le_token', t); setDb(d);
        lastSyncAt = Date.now(); store.set('le_synced', String(lastSyncAt));
        state.tab = 'home'; buildTabs(); render(); setStatus();
      }).catch(function (e) { msg.textContent = 'That did not work: ' + e.message; cfg = { url: '', token: '' }; });
    }
    show(h('div', { class: 'card setup' },
      h('h2', null, 'Connect to your sheet'),
      h('p', { class: 'small muted' }, 'Paste the web app address and the token from your Apps Script. They stay on this phone only.'),
      h('label', { class: 'field' }, 'Web app address', url),
      h('label', { class: 'field' }, 'App token', tok),
      h('button', { class: 'btn', onclick: function () { connect(url.value.trim(), tok.value.trim()); } }, 'Connect'),
      h('button', { class: 'btn ghost', onclick: function () { connect('', 'demo'); } }, 'Try with sample data'),
      msg));
  }

  /* ---------- home ---------- */
  function renderHome() { drawHome(db); }
  function drawHome(s) {
    var b = s.balances, m = s.month;
    var banks = b.accounts.filter(function (a) { return a.type !== 'card'; });
    var out = [];
    var banner = voucherBanner();
    if (banner) out.push(banner);
    out.push(h('div', { class: 'card hero' },
      h('div', { class: 'label' }, 'Total money'),
      h('div', { class: 'big num' }, fmt(b.totalMoney)),
      h('div', { class: 'sub' }, 'Across ' + banks.length + ' bank ' + (banks.length === 1 ? 'account' : 'accounts')),
      b.accounts.some(function (a) { return a.type === 'card'; }) ?
        h('div', { class: 'owed' }, h('span', null, 'Owed on cards'), h('b', { class: 'num' }, fmt(b.cardOwed))) : null));
    if (s.banksSeen.indexOf('OCBC') < 0) {
      out.push(h('div', { class: 'notice info' }, 'OCBC is not connected yet, so it is not in these totals.'));
    }
    function accountGroup(title, total, accounts) {
      if (!accounts.length) return;
      out.push(h('div', null, h('div', { class: 'section-head' }, h('h2', null, title), total),
        h('div', { style: 'height:8px' }), h('div', { class: 'card list' }, accounts.map(accountRow))));
    }
    var cards = b.accounts.filter(function (a) { return a.type === 'card'; });
    accountGroup('Bank accounts', h('span', { class: 'num' }, fmt(b.totalMoney)), banks);
    accountGroup('Credit cards', h('span', { class: 'num owed' }, fmt(b.cardOwed) + ' owed'), cards);

    var byId = {};
    s.rows.forEach(function (r) { byId[r.id] = r; });
    var recent = s.recentIds.map(function (id) { return byId[id]; }).filter(Boolean);
    out.push(h('div', null,
      h('div', { class: 'section-head' }, h('h2', null, 'Recent'),
        h('button', { class: 'link', onclick: function () { setTab('txns'); } }, 'See all')),
      recent.length ? h('div', { class: 'recent' }, txnGroups(recent))
        : h('div', { class: 'card empty', style: 'margin-top:8px' }, 'No transactions yet. New bank alerts show up here when you open the app or pull down to refresh.')));

    var bars = h('div', { class: 'card bars' });
    var top = m.byCategory.slice(0, 6), max = top.length ? Math.max.apply(null, top.map(function (c) { return Math.abs(c.total); })) || 1 : 1;
    if (!top.length) bars.append(h('div', { class: 'muted' }, 'No spending yet this month.'));
    top.forEach(function (c) {
      bars.append(h('div', { class: 'bar-row' }, h('span', { class: 'name' }, c.name),
        h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.max(3, Math.round(Math.abs(c.total) / max * 100)) + '%' })),
        h('span', { class: 'num' }, fmt(c.total))));
    });
    if (m.byTag.length) bars.append(h('div', { class: 'chips' }, m.byTag.slice(0, 6).map(function (t) { return h('span', { class: 'tagchip' }, t.name + ' ' + fmt(t.total)); })));
    out.push(h('div', null,
      h('div', { class: 'section-head' }, h('h2', null, monthLabel(m.month)), h('span', { class: 'num' }, fmt(m.total))),
      h('div', { style: 'height:8px' }), bars));
    out.push(h('p', { class: 'small muted' }, 'Last bank alert logged: ' + ago(s.lastAlertAt)));
    show(h('div', { class: 'stack' }, out));
  }
  /** Account choices for a select, in two groups like Home. */
  function accountOptions(accounts, exclude) {
    return [['Bank accounts', false], ['Credit cards', true]].map(function (g) {
      var list = accounts.filter(function (a) { return a.id !== exclude && (a.type === 'card') === g[1]; });
      return list.length ? h('optgroup', { label: g[0] }, list.map(function (a) { return h('option', { value: a.id }, a.name); })) : null;
    });
  }
  function accountRow(a) {
    var isCard = a.type === 'card';
    return h('button', { class: 'acct', onclick: function () {
      state.account = a.id; state.query = ''; render(); window.scrollTo(0, 0);
    } },
      h('div', null, h('div', { class: 'name' }, a.name), h('div', { class: 'small muted' }, a.bank)),
      h('div', { class: 'acct-right' },
        isCard ? h('div', { class: 'amt owed num' }, fmt(-a.balance) + ' owed') : h('div', { class: 'amt num' }, fmt(a.balance)),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  }

  /* ---------- editor ---------- */
  function editor(row, opts) {
    var ctx = makeCtx();
    var isManual = String(row.id).indexOf('m-') === 0;
    var selected = row.category || '';
    var chipBox = h('div', { class: 'chips' });
    var cats = ctx.categories.slice();
    if (row.direction === 'in' && cats.indexOf('Income') < 0) cats.unshift('Income');
    if (selected && cats.indexOf(selected) < 0) cats.unshift(selected);
    var catInput = h('input', { type: 'text', id: 'ed-cat', placeholder: 'Or type a new category', value: selected, autocomplete: 'off' });
    function drawChips() {
      chipBox.replaceChildren();
      cats.forEach(function (c) {
        chipBox.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(c === selected), onclick: function () { selected = c; catInput.value = c; drawChips(); } }, c));
      });
    }
    drawChips();
    catInput.addEventListener('input', function () { selected = catInput.value.trim(); drawChips(); });

    var nameInput = h('input', { type: 'text', id: 'ed-name', value: row.merchant || row.merchantRaw || '', autocomplete: 'off' });
    var tagInput = h('input', { type: 'text', id: 'ed-tag', value: row.tag || '', placeholder: 'e.g. supermarket', autocomplete: 'off' });
    var amountInput = (row.amount === '' || row.amount === null) ? h('input', { type: 'text', id: 'ed-amount', inputmode: 'decimal', placeholder: 'Amount in SGD' }) : null;
    var acctOptions = function (exclude) {
      return accountOptions(ctx.accounts, exclude);
    };
    var acctSelect = row.account ? null : h('select', { id: 'ed-account' }, h('option', { value: '' }, 'Choose account'), acctOptions());
    var canTransfer = row.direction === 'out' || row.direction === 'transfer' || row.direction === 'card_payment' || row.direction === 'in' || row.direction === 'transfer_in';
    var isOut = row.direction === 'out' || row.direction === 'transfer' || row.direction === 'card_payment';
    var xfer = h('input', { type: 'checkbox', id: 'ed-xfer' });
    xfer.checked = row.direction === 'transfer' || row.direction === 'card_payment' || row.direction === 'transfer_in';
    var destSelect = h('select', { id: 'ed-dest' }, h('option', { value: '' }, 'Which account does it go to?'), acctOptions(row.account));
    if (row.toAccount) destSelect.value = row.toAccount;
    destSelect.hidden = !(xfer.checked && isOut);
    xfer.addEventListener('change', function () { destSelect.hidden = !(xfer.checked && isOut); });
    var apply = h('input', { type: 'checkbox', id: 'ed-apply' });
    apply.checked = !!row.merchantRaw && !isManual && !xfer.checked;
    var applyLabel = h('label', { class: 'check' }, apply, 'Use this for every payment to "' + (row.merchantRaw || '') + '"');

    var saveBtn = h('button', { class: 'btn', onclick: function () {
      var payload = { id: row.id, merchant: nameInput.value.trim(), tag: tagInput.value.trim(), applyToMerchant: false };
      if (amountInput) {
        var v = parseMoney(amountInput.value);
        if (isNaN(v) || v <= 0) return toast('Enter the amount');
        payload.amount = v;
      }
      if (acctSelect) { if (!acctSelect.value) return toast('Choose an account'); payload.account = acctSelect.value; }
      if (canTransfer && xfer.checked) {
        if (isOut) {
          if (!destSelect.value) return toast('Choose where the money went');
          payload.direction = 'transfer'; payload.toAccount = destSelect.value;
        } else { payload.direction = 'transfer_in'; }
        payload.category = 'Transfer';
      } else {
        if (!selected) return toast('Pick a category');
        payload.category = selected;
        if (row.direction === 'transfer' || row.direction === 'transfer_in' || row.direction === 'card_payment') {
          payload.direction = isOut ? 'out' : 'in'; payload.toAccount = '';
        }
        payload.applyToMerchant = apply.checked;
      }
      opts.onClose();
      mutate('setCategory', payload, function () {
        findRows(row.id).forEach(function (r) {
          ['category', 'tag', 'merchant', 'amount', 'account', 'toAccount', 'direction'].forEach(function (k) {
            if (payload[k] !== undefined) r[k] = payload[k];
          });
          r.status = 'ok';
        });
      }, function (res) { if (res.ruleAdded) toast('Saved. Used for this merchant from now on.'); });
    } }, 'Save');

    var buttons = [h('button', { class: 'btn ghost', onclick: opts.onClose }, 'Close'), saveBtn];
    if (isManual) buttons.push(h('button', { class: 'btn danger', onclick: function () {
      opts.onClose();
      mutate('deleteRow', { id: row.id }, function () {
        db.rows = db.rows.filter(function (r) { return r.id !== row.id; });
        db.recentIds = db.recentIds.filter(function (id) { return id !== row.id; });
        (row.effects || []).forEach(function (e) { moveBalance(e.account, -e.delta); });
        Object.keys(monthCache).forEach(function (m) { monthCache[m] = monthCache[m].filter(function (r) { return r.id !== row.id; }); });
      });
    } }, 'Delete'));

    return h('div', { class: 'card editor' },
      h('div', { class: 'head' },
        h('div', null, h('div', { class: 'merchant' }, row.merchantRaw || row.merchant || 'Entry'),
          h('div', { class: 'small muted' }, (row.datetime || '').slice(0, 10) + (row.account ? ' · ' + ctx.accountName(row.account) : ''))),
        h('div', { class: 'amount num' }, row.amount === '' ? 'Amount missing' : fmt(row.amount))),
      row.note ? h('div', { class: 'small muted' }, row.note) : null,
      amountInput ? h('label', { class: 'field' }, 'Amount', amountInput) : null,
      acctSelect ? h('label', { class: 'field' }, 'Account', acctSelect) : null,
      canTransfer ? h('label', { class: 'check' }, xfer, isOut ? 'This is a transfer to my own account' : 'This is a transfer from my own account') : null,
      destSelect,
      h('div', { class: 'stack', id: 'ed-cats' }, h('div', { class: 'small muted' }, 'Category'), chipBox, catInput),
      h('label', { class: 'field' }, 'Name', nameInput),
      h('label', { class: 'field' }, 'Keyword', tagInput),
      row.merchantRaw && !isManual ? applyLabel : null,
      h('div', { class: 'btn-row' }, buttons));
  }

  /* ---------- transaction lists (Home, Activity, account screen) ---------- */
  /** One day-grouped list of rows. When accountId is set, signs show what each row did to that account. */
  function txnGroups(rows, accountId) {
    var out = [], card = null, lastDay = '', ctx = makeCtx();
    function accountLabel(r) {
      if (accountId || !r.account) return '';
      return ctx.accountName(r.account) + (r.toAccount ? ' \u2192 ' + ctx.accountName(r.toAccount) : '');
    }
    rows.forEach(function (r) {
      var day = r.datetime.slice(0, 10);
      if (day !== lastDay) {
        if (card) out.push(card);
        out.push(h('div', { class: 'day' }, dayLabel(day)));
        card = h('div', { class: 'card list' }); lastDay = day;
      }
      var change = accountId ? rowDelta(r, accountId) : (r.direction === 'adjust' ? Number(r.amount) : r.direction === 'out' ? -1 : (r.direction === 'in' || r.direction === 'refund') ? 1 : 0);
      var sign = change > 0 ? '+' : change < 0 ? '\u2212' : '';
      var notes = [accountLabel(r), r.category || 'Uncategorised', r.tag, r.status === 'guess' ? 'unsorted' : '',
        r.status === 'review' ? 'needs attention' : '', r.status === 'dup' ? 'duplicate' : ''].filter(Boolean).join(' \u00b7 ');
      card.append(h('button', { class: 'tx', onclick: function () { openSheet(r); } },
        h('div', { class: 'm' }, h('div', { class: 'title' }, r.merchant || r.merchantRaw || 'Entry'), h('div', { class: 'small muted' }, notes)),
        h('div', { class: 'amt num' + (change > 0 ? ' in' : '') }, r.amount === '' ? '?' : sign + fmt(Math.abs(Number(r.amount))))));
    });
    if (card) out.push(card);
    return out;
  }

  /** Correct an account's balance from the bank app. Card: type what you owe. */
  function balanceForm(a) {
    var isCard = a.type === 'card';
    var input = h('input', { type: 'text', inputmode: 'decimal', id: 'bal-' + a.id, placeholder: isCard ? 'Amount owed right now' : 'Balance right now', autocomplete: 'off' });
    var save = h('button', { class: 'btn', onclick: function () {
      var v = parseMoney(input.value);
      if (isNaN(v)) return toast('Enter a number');
      var actual = isCard ? -Math.abs(v) : v;
      mutate('setBalance', { account: a.id, actual: actual }, function () { moveBalance(a.id, actual - a.balance); });
      toast('Balance updated');
    } }, 'Set balance');
    return h('div', { class: 'acct-detail' },
      h('div', { class: 'small muted' }, 'Alerts do not show balances. Type what your bank app says to correct this number.'),
      h('label', { class: 'field' }, isCard ? 'Amount owed' : 'Actual balance', input), save);
  }

  function accountHeader(a) {
    var isCard = a.type === 'card';
    return h('div', { class: 'card acct-head' },
      h('button', { class: 'back', onclick: function () { state.account = null; state.query = ''; render(); window.scrollTo(0, 0); } }, '← Home'),
      h('div', { class: 'label' }, a.name),
      h('div', { class: 'big num' + (isCard ? ' owed' : '') }, isCard ? fmt(-a.balance) + ' owed' : fmt(a.balance)),
      isCard ? h('div', { class: 'small muted' }, 'Spent since last payment: ' + fmt(a.sinceLastPayment || 0)) : null,
      h('details', { class: 'fix' }, h('summary', null, 'Correct this balance'), balanceForm(a)));
  }

  /* ---------- activity ---------- */
  /** accountId null = all accounts (Activity tab); otherwise one account's screen. Reads saved data, so it draws at once. */
  function renderTxns(accountId) {
    var current = db.month.month;
    if (!state.month || db.months.indexOf(state.month) < 0) state.month = current;
    if (accountId) state.filter = 'all';
    var listBox = h('div', { id: 'txn-list' });
    var account = accountId ? db.balances.accounts.filter(function (a) { return a.id === accountId; })[0] : null;
    var monthSel = h('select', { id: 'txn-month', 'aria-label': 'Month' }, db.months.map(function (m) {
      var o = h('option', { value: m }, monthLabel(m)); if (m === state.month) o.selected = true; return o;
    }));
    var search = h('input', { type: 'search', id: 'txn-q', placeholder: 'Search', value: state.query, 'aria-label': 'Search' });
    var guesses = db.rows.filter(function (r) { return r.status === 'guess'; }).length;
    var attention = db.rows.filter(function (r) { return r.status === 'review'; }).length;
    if ((state.filter === 'guess' && !guesses) || (state.filter === 'review' && !attention)) state.filter = 'all';
    function chip(id, label) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.filter === id), onclick: function () { state.filter = id; render(); } }, label);
    }
    var chips = (!accountId && (guesses || attention)) ? h('div', { class: 'chips filters' }, chip('all', 'All'),
      guesses ? chip('guess', 'Unsorted (' + guesses + ')') : null,
      attention ? chip('review', 'Needs attention (' + attention + ')') : null) : null;
    monthSel.hidden = state.filter !== 'all';
    show(h('div', null, account ? accountHeader(account) : null, chips, h('div', { class: 'controls' }, monthSel, search), listBox));

    function matches(r) {
      if (accountId && r.account !== accountId && r.toAccount !== accountId) return false;
      if (!state.query) return true;
      return [r.merchant, r.merchantRaw, r.category, r.tag, r.note].join(' ').toLowerCase().indexOf(state.query.toLowerCase()) >= 0;
    }
    function drawList() {
      var source;
      if (state.filter !== 'all') source = db.rows.filter(function (r) { return r.status === state.filter; });
      else if (state.month === current) source = db.rows.filter(function (r) { return r.datetime.slice(0, 7) === current; });
      else source = monthCache[state.month];
      if (!source) {
        listBox.replaceChildren(h('div', { class: 'skeleton' }));
        var wanted = state.month;
        api('list', { month: wanted }).then(function (d) {
          monthCache[wanted] = d.rows;
          if (state.month === wanted) drawList();
        }).catch(function () { listBox.replaceChildren(h('div', { class: 'card empty' }, 'Could not load that month. Check your connection.')); });
        return;
      }
      var rows = source.filter(matches).sort(function (a, b) { return a.datetime < b.datetime ? 1 : -1; });
      listBox.replaceChildren();
      if (!rows.length) {
        var msg = state.query ? 'Nothing matches that search.' : state.filter !== 'all' ? 'Nothing left here.' : 'No transactions this month.';
        return listBox.append(h('div', { class: 'card empty' }, msg));
      }
      append(listBox, txnGroups(rows, accountId));
    }
    monthSel.addEventListener('change', function () { state.month = monthSel.value; drawList(); });
    search.addEventListener('input', function () { state.query = search.value.trim(); drawList(); });
    drawList();
  }
  function openSheet(row) {
    if (String(row.id).indexOf('tmp-') === 0) return toast('Still saving. Try again in a moment.');
    var overlay = h('div', { class: 'overlay', onclick: function (e) { if (e.target === overlay) close(); } });
    function close() { overlay.remove(); }
    overlay.append(h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'grab' }), editor(row, { onClose: close })));
    document.body.append(overlay);
  }

  /* ---------- vouchers ---------- */
  function voucherList() {
    var today = todayStr(), warn = db.voucherWarnDays || 30;
    return (db.vouchers || []).map(function (v) {
      var u = voucherUrgency(v.expires, today, warn);
      return { voucher: v, level: u.level, daysLeft: u.daysLeft };
    }).sort(function (a, b) {
      if (a.daysLeft === null) return b.daysLeft === null ? 0 : 1;
      return b.daysLeft === null ? -1 : a.daysLeft - b.daysLeft;
    });
  }
  /** Unused vouchers close to expiring, soonest first. */
  function dueVouchers() {
    return voucherList().filter(function (x) {
      return x.voucher.status !== 'used' && (x.level === 'urgent' || x.level === 'soon');
    });
  }
  function voucherBanner() {
    var due = dueVouchers();
    if (!due.length) return null;
    var lines = due.slice(0, 3).map(function (x) {
      return h('div', { class: 'line' }, x.voucher.name + ' ' + fmt(x.voucher.amountLeft) + ' left, ' + voucherDueText(x.daysLeft).toLowerCase());
    });
    return h('button', { class: 'vbanner' + (due[0].level === 'urgent' ? ' urgent' : ''), onclick: function () { setTab('vouchers'); } },
      h('div', { class: 'head' }, due.length === 1 ? 'Voucher expiring soon' : due.length + ' vouchers expiring soon'),
      lines,
      due.length > 3 ? h('div', { class: 'line' }, '+' + (due.length - 3) + ' more') : null);
  }
  function fullDate(ymd) {
    var p = ymd.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function voucherRow(x) {
    var v = x.voucher, used = v.status === 'used';
    return h('button', { class: 'tx', onclick: function () { openVoucher(v); } },
      h('div', { class: 'm' }, h('div', { class: 'title' }, v.name),
        h('div', { class: 'vdue ' + (used ? '' : x.level) }, used ? 'Used' : voucherDueText(x.daysLeft) + (v.expires ? ' \u00b7 ' + fullDate(v.expires) : '')),
        v.note ? h('div', { class: 'small muted' }, v.note) : null),
      h('div', { class: 'amt num' }, fmt(v.amountLeft)));
  }
  function renderVouchers() {
    var all = voucherList();
    var active = all.filter(function (x) { return x.voucher.status !== 'used' && x.level !== 'expired'; });
    var expired = all.filter(function (x) { return x.voucher.status !== 'used' && x.level === 'expired'; });
    var used = all.filter(function (x) { return x.voucher.status === 'used'; });
    var total = active.reduce(function (sum, x) { return sum + x.voucher.amountLeft; }, 0);
    function fold(label, items) {
      if (!items.length) return null;
      return h('details', { class: 'vfold' }, h('summary', null, label + ' (' + items.length + ')'), h('div', { class: 'card list' }, items.map(voucherRow)));
    }
    show(h('div', { class: 'stack' },
      h('div', { class: 'card vtotal' },
        h('div', { class: 'label' }, 'Left on vouchers'),
        h('div', { class: 'big num' }, fmt(total)),
        h('div', { class: 'small muted' }, active.length + (active.length === 1 ? ' voucher' : ' vouchers') + '. Not counted in Total money.')),
      h('button', { class: 'btn', onclick: function () { openVoucher(null); } }, 'Add a voucher'),
      active.length ? h('div', { class: 'card list' }, active.map(voucherRow))
        : h('div', { class: 'card empty' }, 'No vouchers yet. Add one and you will be warned before it expires.'),
      fold('Expired', expired), fold('Used', used)));
  }
  /** voucher null adds a new one. */
  function openVoucher(voucher) {
    var v = voucher || { id: 'v-' + Date.now(), name: '', amountLeft: '', expires: '', note: '' };
    var overlay = h('div', { class: 'overlay', onclick: function (e) { if (e.target === overlay) close(); } });
    function close() { overlay.remove(); }
    function current() { return (db.vouchers || []).filter(function (x) { return x.id === v.id; })[0]; }
    function spend(amount) {
      if (isNaN(amount) || amount <= 0) return toast('Enter the amount used');
      if (amount > v.amountLeft) return toast('That is more than what is left');
      close();
      mutate('voucherUse', { id: v.id, amount: amount }, function () {
        var c = current();
        c.amountLeft = Math.round((c.amountLeft - amount) * 100) / 100;
        c.status = c.amountLeft === 0 ? 'used' : 'active';
      });
    }
    var usedInput = h('input', { type: 'text', id: 'v-used', inputmode: 'decimal', placeholder: 'Amount used', autocomplete: 'off' });
    var name = h('input', { type: 'text', id: 'v-name', value: v.name, placeholder: 'e.g. NTUC', autocomplete: 'off' });
    var amount = h('input', { type: 'text', id: 'v-amount', inputmode: 'decimal', value: v.amountLeft === '' ? '' : String(v.amountLeft), placeholder: '0.00', autocomplete: 'off' });
    var expires = h('input', { type: 'date', id: 'v-expires', value: v.expires });
    var note = h('input', { type: 'text', id: 'v-note', value: v.note, placeholder: 'Code, or where it works', autocomplete: 'off' });
    var save = h('button', { class: 'btn', onclick: function () {
      var left = parseMoney(amount.value);
      if (!name.value.trim()) return toast('Enter a name');
      if (isNaN(left) || left < 0) return toast('Enter the amount left');
      var payload = { id: v.id, name: name.value.trim(), amountLeft: left, expires: expires.value, note: note.value.trim() };
      close();
      mutate('voucherSave', payload, function () {
        var rec = current();
        if (!rec) { rec = { id: v.id }; db.vouchers = (db.vouchers || []).concat([rec]); }
        Object.assign(rec, payload, { status: left === 0 ? 'used' : 'active' });
      });
    } }, voucher ? 'Save' : 'Add voucher');
    var confirmed = false;
    var del = h('button', { class: 'btn danger', onclick: function () {
      if (!confirmed) { confirmed = true; del.textContent = 'Tap again to delete'; return; }
      close();
      mutate('voucherDelete', { id: v.id }, function () {
        db.vouchers = db.vouchers.filter(function (x) { return x.id !== v.id; });
      });
    } }, 'Delete');
    var open = voucher && voucher.status !== 'used' && voucher.amountLeft > 0;
    overlay.append(h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'grab' }),
      h('div', { class: 'card editor' },
        h('h2', null, voucher ? v.name : 'Add a voucher'),
        open ? h('div', { class: 'small muted' }, fmt(v.amountLeft) + ' left') : null,
        open ? h('div', { class: 'vuse' }, usedInput, h('button', { class: 'btn', onclick: function () { spend(parseMoney(usedInput.value)); } }, 'Use')) : null,
        open ? h('button', { class: 'btn ghost', onclick: function () { spend(v.amountLeft); } }, 'Mark fully used') : null,
        h('label', { class: 'field' }, 'Name', name),
        h('label', { class: 'field' }, 'Amount left (SGD)', amount),
        h('label', { class: 'field' }, 'Expires', expires),
        h('label', { class: 'field' }, 'Note', note),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: close }, 'Close'), save),
        voucher ? del : null)));
    document.body.append(overlay);
  }

  /* ---------- add ---------- */
  /**
   * Add screen. Opens on Received, because spending mostly arrives from bank emails.
   * A rebate is saved as a refund: it lowers the month's spending, and on a card it lowers what is owed.
   */
  var RECEIVED = {
    rebate: { label: 'Rebate', direction: 'refund', category: 'Rebate', tag: '', name: 'Rebate' },
    husband: { label: 'From husband', direction: 'in', category: 'Income', tag: 'husband', name: 'From husband' },
    other: { label: 'Other', direction: 'in', category: 'Income', tag: '', name: 'Money in' }
  };
  function renderAdd() {
    var d = { accounts: db.balances.accounts, categories: db.categories };
    var next = state.nextAdd || {};
    state.nextAdd = null;
    var kind = next.kind || 'in', choice = next.choice || 'rebate', selected = '';
    var amount = h('input', { type: 'text', id: 'add-amount', inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off' });
    var merchant = h('input', { type: 'text', id: 'add-merchant', autocomplete: 'off' });
    var tag = h('input', { type: 'text', id: 'add-tag', placeholder: 'e.g. fish', autocomplete: 'off' });
    var date = h('input', { type: 'date', id: 'add-date', value: next.date || todayStr() });
    var acct = h('select', { id: 'add-account' }, accountOptions(d.accounts));
    var acctLabel = h('span'), noteLabel = h('span');
    var kindBox = h('div', { class: 'chips' }), choiceBox = h('div', { class: 'chips' }), chipBox = h('div', { class: 'chips' });
    var more = h('details', { class: 'vfold' }, h('summary', null, 'More: category and keyword'),
      h('div', { class: 'stack' }, chipBox, h('label', { class: 'field' }, 'Keyword', tag)));

    function rememberKey() { return 'le_add_acct_' + (kind === 'out' ? 'out' : choice); }
    function pickAccount() {
      var saved = next.account || store.get(rememberKey());
      next.account = null;
      if (saved && d.accounts.some(function (a) { return a.id === saved; })) acct.value = saved;
    }
    function chip(label, on, click) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(on), onclick: click }, label);
    }
    function draw() {
      kindBox.replaceChildren(
        chip('Received', kind === 'in', function () { kind = 'in'; draw(); pickAccount(); }),
        chip('Spent', kind === 'out', function () { kind = 'out'; draw(); pickAccount(); }));
      choiceBox.replaceChildren.apply(choiceBox, Object.keys(RECEIVED).map(function (k) {
        return chip(RECEIVED[k].label, choice === k, function () { choice = k; draw(); pickAccount(); });
      }));
      choiceBox.hidden = kind !== 'in';
      more.hidden = kind !== 'out';
      acctLabel.textContent = kind === 'out' ? 'Paid from' : 'Into';
      merchant.placeholder = kind === 'out' ? 'e.g. Wet market' : 'Optional note';
      noteLabel.textContent = kind === 'out' ? 'What for' : 'Note';
      chipBox.replaceChildren.apply(chipBox, d.categories.map(function (c) {
        return chip(c, c === selected, function () { selected = selected === c ? '' : c; draw(); });
      }));
    }
    draw(); pickAccount();

    /** Saves, then shows the list with the new entry, or a fresh form when adding several. */
    function submit(another) {
      var v = parseMoney(amount.value);
      if (isNaN(v) || v <= 0) return toast('Enter an amount');
      var r = kind === 'out' ? null : RECEIVED[choice];
      var note = merchant.value.trim();
      var payload = kind === 'out'
        ? { amount: v, direction: 'out', merchant: note, category: selected || 'Other', tag: tag.value.trim(), account: acct.value, date: date.value }
        : { amount: v, direction: r.direction, merchant: note || r.name, category: r.category, tag: r.tag, account: acct.value, date: date.value };
      var delta = kind === 'out' ? -v : v;
      store.set(rememberKey(), payload.account);
      if (another) {
        state.nextAdd = { kind: kind, choice: choice, account: payload.account, date: payload.date };
      } else {
        state.tab = 'txns'; state.account = null; state.filter = 'all'; state.query = '';
        state.month = payload.date.slice(0, 7);
        store.set('le_tab', 'txns'); buildTabs();
      }
      mutate('addManual', payload, function () {
        var id = 'tmp-' + Date.now();
        db.rows.unshift({ id: id, datetime: payload.date + 'T12:00:00', direction: payload.direction, amount: v, account: payload.account, toAccount: '', merchantRaw: payload.merchant,
          merchant: payload.merchant, category: payload.category, tag: payload.tag, note: '', bank: 'manual', status: 'ok', effects: [{ account: payload.account, delta: delta }] });
        db.recentIds.unshift(id);
        moveBalance(payload.account, delta);
      });
      if (!another) window.scrollTo(0, 0);
      toast(another ? 'Added. Enter the next one.' : 'Added');
    }
    show(h('div', { class: 'card editor' },
      h('h2', null, 'Add an entry'),
      h('div', { class: 'small muted' }, 'For rebates, cash and anything the bank did not email about.'),
      kindBox,
      choiceBox,
      h('label', { class: 'field' }, 'Amount (SGD)', amount),
      h('label', { class: 'field' }, acctLabel, acct),
      h('label', { class: 'field' }, noteLabel, merchant),
      h('label', { class: 'field' }, 'Date', date),
      more,
      h('button', { class: 'btn', onclick: function () { submit(false); } }, 'Add entry'),
      h('button', { class: 'btn ghost', onclick: function () { submit(true); } }, 'Add and enter another')));
  }

  /* ---------- settings ---------- */
  $('#settings-btn').addEventListener('click', function () {
    var overlay = h('div', { class: 'overlay', onclick: function (e) { if (e.target === overlay) overlay.remove(); } });
    overlay.append(h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'grab' }),
      h('div', { class: 'card editor' },
        h('h2', null, 'Settings'),
        h('p', { class: 'small muted' }, cfg.token === 'demo' ? 'You are looking at sample data.' : 'Connected to your sheet. The address and token are stored on this phone only.'),
        h('p', { class: 'small muted' }, lastSyncMs === null ? 'Pull down to update and see how long it takes.' : 'Last update took ' + (lastSyncMs / 1000).toFixed(1) + ' seconds.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn ghost', onclick: function () { overlay.remove(); } }, 'Close'),
          h('button', { class: 'btn danger', onclick: function () { overlay.remove(); signOut(); } }, 'Disconnect')))));
    document.body.append(overlay);
  });

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  /* ---------- updating ---------- */
  $('#refresh-btn').addEventListener('click', function () { sync(true); });
  document.addEventListener('visibilitychange', function () {
    setStatus();
    if (document.visibilityState === 'visible' && Date.now() - lastSyncAt > 5 * 60000) sync();
  });

  /* Home Screen web apps on iPhone have no pull to refresh of their own. */
  var PULL_DISTANCE = 110;
  var ptr = $('#ptr'), pullStart = null, pulled = 0;
  document.addEventListener('touchstart', function (e) {
    pullStart = (window.scrollY <= 0 && e.touches.length === 1 && !document.querySelector('.overlay')) ? e.touches[0].clientY : null;
    pulled = 0;
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (pullStart === null) return;
    pulled = Math.max(0, e.touches[0].clientY - pullStart);
    ptr.style.height = Math.min(pulled / 2, 56) + 'px';
    ptr.textContent = pulled > PULL_DISTANCE ? 'Release to update' : 'Pull to update';
  }, { passive: true });
  document.addEventListener('touchend', function () {
    if (pullStart !== null && pulled > PULL_DISTANCE) sync(true);
    pullStart = null; pulled = 0; ptr.style.height = '0';
  }, { passive: true });

  buildTabs();
  render();
  setStatus();
  if (connected() && db) sync();
})();
