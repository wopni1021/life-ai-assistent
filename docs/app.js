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
  var state = { tab: store.get('le_tab') || 'home', reviewCount: 0, month: null, query: '', review: null, catsCache: null, account: null };

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
    ['review', 'Review', '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>'],
    ['txns', 'Activity', '<path d="M5 7h14M5 12h14M5 17h9"/>'],
    ['add', 'Add', '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>']
  ];
  function buildTabs() {
    var nav = $('#tabs'); nav.replaceChildren();
    TABS.forEach(function (t) {
      var b = h('button', { role: 'tab', 'data-tab': t[0], 'aria-selected': String(state.tab === t[0]), onclick: function () { setTab(t[0]); } });
      b.innerHTML = '<svg viewBox="0 0 24 24">' + t[2] + '</svg>';
      b.append(t[1]);
      if (t[0] === 'review' && state.reviewCount) b.append(h('span', { class: 'badge' }, String(state.reviewCount)));
      nav.append(b);
    });
    nav.hidden = !(cfg.token && (cfg.token === 'demo' || cfg.url));
  }
  function setTab(t) {
    state.tab = t; state.account = null; store.set('le_tab', t);
    buildTabs(); render(); window.scrollTo(0, 0);
  }
  function setReviewCount(n) {
    if (n === state.reviewCount) return;
    state.reviewCount = n; buildTabs();
  }
  function render() {
    if (!cfg.token || (cfg.token !== 'demo' && !cfg.url)) return renderSetup();
    $('#tabs').hidden = false;
    if (state.tab === 'home' && state.account) return renderTxns(state.account);
    ({ home: renderHome, review: renderReview, txns: function () { renderTxns(null); }, add: renderAdd })[state.tab]();
  }
  function signOut() {
    store.del('le_url'); store.del('le_token'); cfg = { url: '', token: '' };
    $('#tabs').hidden = true; renderSetup();
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
      api('summary').then(function () {
        store.set('le_url', u); store.set('le_token', t); state.tab = 'home'; buildTabs(); render();
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
  function renderHome() {
    loading();
    api('summary').then(function (s) { state.catsCache = s.categories; setReviewCount(s.month.reviewCount); drawHome(s); }).catch(failed);
  }
  function drawHome(s) {
    var b = s.balances, m = s.month;
    var banks = b.accounts.filter(function (a) { return a.type !== 'card'; });
    var out = [];
    out.push(h('div', { class: 'card hero' },
      h('div', { class: 'label' }, 'Total money'),
      h('div', { class: 'big num' }, fmt(b.totalMoney)),
      h('div', { class: 'sub' }, 'Across ' + banks.length + ' bank ' + (banks.length === 1 ? 'account' : 'accounts')),
      b.accounts.some(function (a) { return a.type === 'card'; }) ?
        h('div', { class: 'owed' }, h('span', null, 'Owed on cards'), h('b', { class: 'num' }, fmt(b.cardOwed))) : null));
    if (s.banksSeen.indexOf('OCBC') < 0) {
      out.push(h('div', { class: 'notice info' }, 'OCBC is not connected yet, so it is not in these totals.'));
    }
    if (m.reviewCount) {
      out.push(h('button', { class: 'notice', onclick: function () { setTab('review'); } }, m.reviewCount + ' to review →'));
    }
    var accts = h('div', { class: 'card list' });
    b.accounts.forEach(function (a) { accts.append(accountRow(a)); });
    out.push(h('div', null, h('div', { class: 'section-head' }, h('h2', null, 'Accounts')), h('div', { style: 'height:8px' }), accts));

    var recent = s.recent || [];
    var ctx = makeCtx({ accounts: b.accounts, categories: s.categories });
    out.push(h('div', null,
      h('div', { class: 'section-head' }, h('h2', null, 'Recent'),
        h('button', { class: 'link', onclick: function () { setTab('txns'); } }, 'See all')),
      recent.length ? h('div', { class: 'recent' }, txnGroups(recent, ctx, renderHome))
        : h('div', { class: 'card empty', style: 'margin-top:8px' }, 'No transactions yet. New bank alerts show up here within about a minute.')));

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
  function accountRow(a) {
    var isCard = a.type === 'card';
    return h('button', { class: 'acct', onclick: function () {
      state.account = a.id; state.query = ''; renderTxns(a.id); window.scrollTo(0, 0);
    } },
      h('div', null, h('div', { class: 'name' }, a.name), h('div', { class: 'small muted' }, isCard ? 'Credit card' : a.bank + ' account')),
      h('div', { class: 'acct-right' },
        isCard ? h('div', { class: 'amt owed num' }, fmt(-a.balance) + ' owed') : h('div', { class: 'amt num' }, fmt(a.balance)),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  }

  /* ---------- editor (used by Review and Activity) ---------- */
  function editor(row, ctx, opts) {
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
      return ctx.accounts.filter(function (a) { return a.id !== exclude; }).map(function (a) { return h('option', { value: a.id }, a.name); });
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
      saveBtn.disabled = true;
      api('setCategory', payload).then(function (r) {
        toast(r.ruleAdded ? 'Saved. Rule added for this merchant.' : 'Saved');
        opts.onSaved(r);
      }).catch(function (e) { toast(e.message); saveBtn.disabled = false; });
    } }, opts.saveLabel || 'Save');

    var buttons = [saveBtn];
    if (opts.onSkip) buttons.unshift(h('button', { class: 'btn ghost', onclick: opts.onSkip }, 'Skip'));
    if (opts.onClose) buttons.unshift(h('button', { class: 'btn ghost', onclick: opts.onClose }, 'Close'));
    if (isManual && opts.onDeleted) buttons.push(h('button', { class: 'btn danger', onclick: function () {
      api('deleteRow', { id: row.id }).then(function () { toast('Deleted'); opts.onDeleted(); }).catch(function (e) { toast(e.message); });
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
  function makeCtx(data) {
    var names = {};
    data.accounts.forEach(function (a) { names[a.id] = a.name; });
    return { categories: data.categories, accounts: data.accounts, accountName: function (id) { return names[id] || id; } };
  }

  /* ---------- review ---------- */
  function renderReview() {
    loading();
    api('reviewQueue').then(function (d) {
      state.review = { rows: d.rows, ctx: makeCtx(d), idx: 0 };
      setReviewCount(d.rows.length); drawReview();
    }).catch(failed);
  }
  function drawReview() {
    var r = state.review;
    if (!r.rows.length) return show(h('div', { class: 'card empty' }, h('p', null, 'Nothing to review.'), h('p', { class: 'small' }, 'New bank alerts that need a category will appear here.')));
    if (r.idx >= r.rows.length) r.idx = 0;
    var row = r.rows[r.idx];
    show(h('div', null,
      h('div', { class: 'progress' }, (r.idx + 1) + ' of ' + r.rows.length + ' to review'),
      editor(row, r.ctx, {
        saveLabel: 'Save and next',
        onSkip: r.rows.length > 1 ? function () { r.idx = (r.idx + 1) % r.rows.length; drawReview(); } : null,
        onSaved: function () { r.rows.splice(r.idx, 1); setReviewCount(r.rows.length); drawReview(); window.scrollTo(0, 0); }
      })));
  }

  /* ---------- transaction lists (Home, Activity, account screen) ---------- */
  /** One day-grouped list of rows. When accountId is set, signs follow the row's delta for that account. */
  function txnGroups(rows, ctx, reload) {
    var out = [], card = null, lastDay = '';
    rows.forEach(function (r) {
      var day = r.datetime.slice(0, 10);
      if (day !== lastDay) {
        if (card) out.push(card);
        out.push(h('div', { class: 'day' }, dayLabel(day)));
        card = h('div', { class: 'card list' }); lastDay = day;
      }
      var hasDelta = r.delta !== undefined && r.delta !== null;
      var isIn = hasDelta ? r.delta > 0 : (r.direction === 'in' || r.direction === 'refund');
      var sign = hasDelta ? (r.delta > 0 ? '+' : r.delta < 0 ? '−' : '') : (isIn ? '+' : (r.direction === 'out' ? '−' : ''));
      var shown = hasDelta ? Math.abs(r.delta) : r.amount;
      card.append(h('button', { class: 'tx', onclick: function () { openSheet(r, ctx, reload); } },
        h('div', { class: 'm' }, h('div', { class: 'title' }, r.merchant || r.merchantRaw || 'Entry'),
          h('div', { class: 'small muted' }, [r.category || (r.status === 'review' ? 'Needs review' : 'Uncategorised'), r.tag ? ' · ' + r.tag : '', r.status === 'dup' ? ' · duplicate' : ''])),
        h('div', { class: 'amt num' + (isIn ? ' in' : '') }, r.amount === '' ? '?' : sign + fmt(shown).replace('−', ''))));
    });
    if (card) out.push(card);
    return out;
  }

  /** Correct an account's balance from the bank app. Card: type what you owe. */
  function balanceForm(a, onDone) {
    var isCard = a.type === 'card';
    var input = h('input', { type: 'text', inputmode: 'decimal', id: 'bal-' + a.id, placeholder: isCard ? 'Amount owed right now' : 'Balance right now', autocomplete: 'off' });
    var save = h('button', { class: 'btn', onclick: function () {
      var v = parseMoney(input.value);
      if (isNaN(v)) return toast('Enter a number');
      save.disabled = true;
      api('setBalance', { account: a.id, actual: isCard ? -Math.abs(v) : v })
        .then(function () { toast('Balance updated'); onDone(); })
        .catch(function (e) { toast(e.message); save.disabled = false; });
    } }, 'Set balance');
    return h('div', { class: 'acct-detail' },
      h('div', { class: 'small muted' }, 'Alerts do not show balances. Type what your bank app says to correct this number.'),
      h('label', { class: 'field' }, isCard ? 'Amount owed' : 'Actual balance', input), save);
  }

  function accountHeader(a, onChanged) {
    var isCard = a.type === 'card';
    return h('div', { class: 'card acct-head' },
      h('button', { class: 'back', onclick: function () { state.account = null; state.query = ''; renderHome(); window.scrollTo(0, 0); } }, '← Home'),
      h('div', { class: 'label' }, a.name),
      h('div', { class: 'big num' + (isCard ? ' owed' : '') }, isCard ? fmt(-a.balance) + ' owed' : fmt(a.balance)),
      isCard ? h('div', { class: 'small muted' }, 'Spent since last payment: ' + fmt(a.sinceLastPayment || 0)) : null,
      h('details', { class: 'fix' }, h('summary', null, 'Correct this balance'), balanceForm(a, onChanged)));
  }

  /* ---------- activity ---------- */
  var searchTimer;
  /** accountId null = all accounts (Activity tab); otherwise one account's screen. */
  function renderTxns(accountId) {
    var listBox = h('div', { id: 'txn-list' });
    var headBox = h('div');
    var monthSel = h('select', { id: 'txn-month', 'aria-label': 'Month' });
    var search = h('input', { type: 'search', id: 'txn-q', placeholder: 'Search', value: state.query, 'aria-label': 'Search' });
    show(h('div', null, headBox, h('div', { class: 'controls' }, monthSel, search), listBox));
    var ctxData = null;
    function load() {
      listBox.replaceChildren(h('div', { class: 'skeleton' }));
      Promise.all([api('list', { month: state.month, query: state.query, account: accountId || undefined }), ctxData ? Promise.resolve(ctxData) : api('reviewQueue')])
        .then(function (res) {
          var d = res[0]; ctxData = res[1]; state.month = d.month;
          monthSel.replaceChildren.apply(monthSel, d.months.map(function (m) { var o = h('option', { value: m }, monthLabel(m)); if (m === d.month) o.selected = true; return o; }));
          if (accountId && d.account) headBox.replaceChildren(accountHeader(d.account, load));
          drawList(d, makeCtx(ctxData), load);
        }).catch(failed);
    }
    function drawList(d, ctx, reload) {
      listBox.replaceChildren();
      if (!d.rows.length) return listBox.append(h('div', { class: 'card empty' }, state.query ? 'Nothing matches that search.' : 'No transactions this month.'));
      append(listBox, txnGroups(d.rows, ctx, reload));
    }
    monthSel.addEventListener('change', function () { state.month = monthSel.value; load(); });
    search.addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(function () { state.query = search.value.trim(); load(); }, 300); });
    load();
  }
  function openSheet(row, ctx, reload) {
    var overlay = h('div', { class: 'overlay', onclick: function (e) { if (e.target === overlay) close(); } });
    function close() { overlay.remove(); }
    overlay.append(h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'grab' }),
      editor(row, ctx, { onClose: close, onSaved: function () { close(); reload(); }, onDeleted: function () { close(); reload(); } })));
    document.body.append(overlay);
  }

  /* ---------- add ---------- */
  function renderAdd() {
    loading();
    api('reviewQueue').then(function (d) {
      var ctx = makeCtx(d), selected = '', kind = 'out';
      var amount = h('input', { type: 'text', id: 'add-amount', inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off' });
      var merchant = h('input', { type: 'text', id: 'add-merchant', placeholder: 'e.g. Wet market', autocomplete: 'off' });
      var tag = h('input', { type: 'text', id: 'add-tag', placeholder: 'e.g. fish', autocomplete: 'off' });
      var date = h('input', { type: 'date', id: 'add-date', value: todayStr() });
      var acct = h('select', { id: 'add-account' }, d.accounts.map(function (a) { return h('option', { value: a.id }, a.name); }));
      var chipBox = h('div', { class: 'chips' });
      var kindBox = h('div', { class: 'chips' });
      function drawKind() {
        kindBox.replaceChildren(
          h('button', { type: 'button', class: 'chip', 'aria-pressed': String(kind === 'out'), onclick: function () { kind = 'out'; drawKind(); } }, 'Spent'),
          h('button', { type: 'button', class: 'chip', 'aria-pressed': String(kind === 'in'), onclick: function () { kind = 'in'; drawKind(); } }, 'Received'));
      }
      function drawChips() {
        chipBox.replaceChildren();
        d.categories.forEach(function (c) { chipBox.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(c === selected), onclick: function () { selected = c; drawChips(); } }, c)); });
      }
      drawKind(); drawChips();
      var save = h('button', { class: 'btn', onclick: function () {
        var v = parseMoney(amount.value);
        if (isNaN(v) || v <= 0) return toast('Enter an amount');
        if (kind === 'out' && !selected) return toast('Pick a category');
        save.disabled = true;
        api('addManual', { amount: v, direction: kind, merchant: merchant.value.trim(), category: kind === 'in' ? 'Income' : selected, tag: tag.value.trim(), account: acct.value, date: date.value })
          .then(function () { toast('Added'); renderAdd(); })
          .catch(function (e) { toast(e.message); save.disabled = false; });
      } }, 'Add entry');
      show(h('div', { class: 'card editor' },
        h('h2', null, 'Add an entry'),
        h('div', { class: 'small muted' }, 'For cash and anything the bank did not email about.'),
        kindBox,
        h('label', { class: 'field' }, 'Amount (SGD)', amount),
        h('label', { class: 'field' }, 'What for', merchant),
        h('div', { class: 'stack' }, h('div', { class: 'small muted' }, 'Category'), chipBox),
        h('label', { class: 'field' }, 'Keyword', tag),
        h('label', { class: 'field' }, 'Paid from', acct),
        h('label', { class: 'field' }, 'Date', date),
        save));
    }).catch(failed);
  }

  /* ---------- settings ---------- */
  $('#settings-btn').addEventListener('click', function () {
    var overlay = h('div', { class: 'overlay', onclick: function (e) { if (e.target === overlay) overlay.remove(); } });
    overlay.append(h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'grab' }),
      h('div', { class: 'card editor' },
        h('h2', null, 'Settings'),
        h('p', { class: 'small muted' }, cfg.token === 'demo' ? 'You are looking at sample data.' : 'Connected to your sheet. The address and token are stored on this phone only.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn ghost', onclick: function () { overlay.remove(); } }, 'Close'),
          h('button', { class: 'btn danger', onclick: function () { overlay.remove(); signOut(); } }, 'Disconnect')))));
    document.body.append(overlay);
  });

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  buildTabs();
  render();
})();
