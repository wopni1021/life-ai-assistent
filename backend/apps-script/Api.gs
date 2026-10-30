/**
 * Web API for the phone app. Deployed as a web app (Execute as: me, Access: Anyone).
 * Every request is a POST with a text/plain JSON body: { token, action, ...fields }.
 * The secret token (made by makeToken) is the real protection. Wrong tokens are rate limited.
 */

var DEFAULT_CATEGORIES = ['Dining', 'Groceries', 'Transport', 'Shopping', 'Baby', 'Health', 'Bills', 'Subscriptions',
  'Entertainment', 'Household', 'Personal care', 'Other'];
var DIRECTIONS_ = ['out', 'in', 'refund', 'transfer', 'transfer_in', 'card_payment'];
var MAX_BAD_TOKENS_PER_HOUR = 20;

/** Run once from the editor. Creates (or replaces) the secret token and shows it. */
function makeToken() {
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_TOKEN', token);
  SpreadsheetApp.getUi().alert('Your app token (copy it now, keep it secret):\n\n' + token +
    '\n\nRunning makeToken again creates a new token and signs out every phone.');
}

function doGet() {
  return ContentService.createTextOutput('Life Expenses API').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    var auth = checkToken_(req.token);
    if (auth === 'ok') out = { ok: true, data: handle_(req) };
    else out = { ok: false, error: auth === 'locked' ? 'too many attempts, try again later' : 'unauthorized' };
  } catch (err) {
    console.error(err && err.message);
    out = { ok: false, error: String(err && err.message || 'bad request').slice(0, 120) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function checkToken_(given) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('badTokens') || 0);
  if (fails >= MAX_BAD_TOKENS_PER_HOUR) return 'locked';
  var want = PropertiesService.getScriptProperties().getProperty('API_TOKEN') || '';
  given = String(given || '');
  var same = want.length > 0 && given.length === want.length;
  if (same) {
    var diff = 0;
    for (var i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
    same = diff === 0;
  }
  if (same) return 'ok';
  cache.put('badTokens', String(fails + 1), 3600);
  return 'bad';
}

function handle_(req) {
  var a = req.action;
  if (a === 'summary') return summary_();
  if (a === 'list') return list_(req);
  if (a === 'reviewQueue') return reviewQueue_();
  var writes = { setCategory: setCategory_, addManual: addManual_, setBalance: setBalance_, deleteRow: deleteRow_ };
  if (writes[a]) {
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var res = writes[a](req);
      CacheService.getScriptCache().remove('summary');
      return res;
    } finally {
      lock.releaseLock();
    }
  }
  throw new Error('unknown action');
}

/* ---------- reading ---------- */

function dtString_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Singapore', "yyyy-MM-dd'T'HH:mm:ss");
  return String(v || '');
}

function loadTx_() {
  return rows_('Transactions').map(function (r, i) {
    r.datetime = dtString_(r.datetime);
    r.createdAt = dtString_(r.createdAt);
    r._row = i + 2;
    return r;
  });
}

function loadAccounts_() {
  return rows_('Accounts').map(function (a) { a.last4 = String(a.last4 || ''); return a; });
}

function monthNow_() { return Utilities.formatDate(new Date(), 'Asia/Singapore', 'yyyy-MM'); }

function summary_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('summary');
  if (hit) return JSON.parse(hit);
  var tx = loadTx_(), accounts = loadAccounts_();
  var banks = {};
  tx.forEach(function (r) { if (r.bank) banks[r.bank] = true; });
  var last = tx.reduce(function (m, r) { return r.createdAt > m ? r.createdAt : m; }, '');
  var res = {
    balances: balances_(accounts, tx),
    month: monthSummary_(tx, monthNow_()),
    banksSeen: Object.keys(banks),
    lastAlertAt: last,
    categories: categories_(tx),
    recent: tx.filter(function (r) { return r.status !== 'dup'; })
      .sort(function (a, b) { return a.datetime < b.datetime ? 1 : -1; }).slice(0, 8).map(publicRow_)
  };
  cache.put('summary', JSON.stringify(res), 20);
  return res;
}

function categories_(tx) {
  var seen = {}, out = [];
  DEFAULT_CATEGORIES.concat(rows_('Rules').map(function (r) { return r.category; }), tx.map(function (r) { return r.category; }))
    .forEach(function (c) {
      c = String(c || '').trim();
      if (c && c !== 'Transfer' && c !== 'Income' && c !== 'Adjustment' && !seen[c]) { seen[c] = true; out.push(c); }
    });
  return out;
}

var PUBLIC_FIELDS_ = ['id', 'datetime', 'direction', 'amount', 'account', 'toAccount', 'merchantRaw', 'merchant', 'category', 'tag', 'note', 'bank', 'status'];

function publicRow_(r) {
  var o = {};
  PUBLIC_FIELDS_.forEach(function (k) { o[k] = r[k]; });
  return o;
}

function list_(req) {
  var tx = loadTx_();
  var month = /^\d{4}-\d{2}$/.test(req.month || '') ? req.month : monthNow_();
  var q = String(req.query || '').toLowerCase().trim();
  var months = {};
  tx.forEach(function (r) { months[monthOf_(r)] = true; });
  months[monthNow_()] = true;
  var acct = String(req.account || '');
  var rows = tx.filter(function (r) {
    if (monthOf_(r) !== month) return false;
    if (acct && r.account !== acct && r.toAccount !== acct) return false;
    if (!q) return true;
    return [r.merchant, r.merchantRaw, r.category, r.tag, r.note].join(' ').toLowerCase().indexOf(q) >= 0;
  }).sort(function (a, b) { return a.datetime < b.datetime ? 1 : -1; }).map(function (r) {
    var o = publicRow_(r);
    if (acct) o.delta = deltaFor_(r, acct);
    return o;
  });
  var res = { month: month, months: Object.keys(months).sort().reverse(), rows: rows };
  if (acct) {
    var found = balances_(loadAccounts_(), tx).accounts.filter(function (a) { return a.id === acct; })[0];
    if (found) res.account = found;
  }
  return res;
}

function reviewQueue_() {
  var tx = loadTx_();
  var rows = tx.filter(function (r) { return r.status === 'review'; })
    .sort(function (a, b) { return a.datetime < b.datetime ? 1 : -1; }).slice(0, 100).map(publicRow_);
  return {
    rows: rows,
    categories: categories_(tx),
    accounts: loadAccounts_().map(function (a) { return { id: a.id, name: a.name, type: a.type }; })
  };
}

/* ---------- writing ---------- */

function findRow_(id) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transactions');
  var n = sh.getLastRow();
  if (n < 2) throw new Error('not found');
  var ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return { sh: sh, row: i + 2 };
  throw new Error('not found');
}

function colIndex_(name) { return TABS.Transactions.indexOf(name) + 1; }

function text_(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 80); }

function setCategory_(req) {
  var f = findRow_(req.id);
  var cur = {};
  var vals = f.sh.getRange(f.row, 1, 1, TABS.Transactions.length).getValues()[0];
  TABS.Transactions.forEach(function (h, i) { cur[h] = vals[i]; });

  var set = {};
  if (req.category !== undefined) set.category = text_(req.category, 40);
  if (req.tag !== undefined) set.tag = text_(req.tag, 40);
  if (req.merchant !== undefined) set.merchant = text_(req.merchant, 80);
  if (req.note !== undefined) set.note = text_(req.note, 200);
  if (req.account !== undefined) set.account = text_(req.account, 40);
  if (req.toAccount !== undefined) set.toAccount = text_(req.toAccount, 40);
  if (req.direction !== undefined) {
    if (DIRECTIONS_.indexOf(req.direction) < 0) throw new Error('bad direction');
    set.direction = req.direction;
  }
  if (req.amount !== undefined && req.amount !== '') {
    var amt = Number(req.amount);
    if (!isFinite(amt) || amt < 0) throw new Error('bad amount');
    set.amount = Math.round(amt * 100) / 100;
  }
  Object.keys(set).forEach(function (k) { cur[k] = set[k]; });

  var needsDest = (cur.direction === 'transfer' || cur.direction === 'card_payment') && !cur.toAccount;
  var amountMissing = cur.amount === '' || cur.amount === null;
  set.status = (cur.account && !needsDest && !amountMissing) ? 'ok' : 'review';
  Object.keys(set).forEach(function (k) { f.sh.getRange(f.row, colIndex_(k)).setValue(set[k]); });

  var ruleAdded = false;
  if (req.applyToMerchant && cur.merchantRaw && cur.category) {
    ruleAdded = addRule_(String(cur.merchantRaw), cur.merchant || String(cur.merchantRaw), cur.category, cur.tag);
    if (ruleAdded) reapplyRules();
  }
  return { id: req.id, status: set.status, ruleAdded: ruleAdded };
}

function addRule_(pattern, name, category, tag) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Rules');
  var n = sh.getLastRow();
  if (n > 1) {
    var existing = sh.getRange(2, 1, n - 1, 1).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][0]).toLowerCase() === pattern.toLowerCase()) return false;
    }
  }
  sh.getRange(n + 1, 1, 1, 4).setValues([[pattern, name, category, tag || '']]);
  return true;
}

function addManual_(req) {
  var amt = Number(req.amount);
  if (!isFinite(amt) || amt <= 0) throw new Error('enter an amount above 0');
  var direction = req.direction === 'in' ? 'in' : 'out';
  var when = /^\d{4}-\d{2}-\d{2}$/.test(req.date || '') ? new Date(req.date + 'T12:00:00+08:00') : new Date();
  var id = 'm-' + Date.now();
  var rec = {
    id: id, datetime: when, direction: direction, amount: Math.round(amt * 100) / 100,
    account: text_(req.account, 40), toAccount: '', merchantRaw: text_(req.merchant, 80), merchant: text_(req.merchant, 80),
    category: text_(req.category, 40) || (direction === 'in' ? 'Income' : ''), tag: text_(req.tag, 40), note: text_(req.note, 200),
    bank: 'manual', channel: 'manual', ref: '', status: req.account ? 'ok' : 'review', createdAt: new Date()
  };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transactions');
  sh.getRange(sh.getLastRow() + 1, 1, 1, TABS.Transactions.length).setValues([TABS.Transactions.map(function (h) { return rec[h]; })]);
  return { id: id };
}

function setBalance_(req) {
  var actual = Number(req.actual);
  if (!isFinite(actual)) throw new Error('enter a number');
  var accounts = loadAccounts_();
  var acct = accounts.filter(function (a) { return a.id === req.account; })[0];
  if (!acct) throw new Error('unknown account');
  var current = balances_(accounts, loadTx_()).accounts.filter(function (a) { return a.id === acct.id; })[0].balance;
  var diff = Math.round((actual - current) * 100) / 100;
  if (Math.abs(diff) < 0.005) return { change: 0, balance: current };
  var rec = {
    id: 'm-' + Date.now(), datetime: new Date(), direction: 'adjust', amount: diff, account: acct.id, toAccount: '',
    merchantRaw: '', merchant: 'Balance correction', category: 'Adjustment', tag: '', note: 'was ' + current + ', set to ' + actual,
    bank: 'manual', channel: 'manual', ref: '', status: 'ok', createdAt: new Date()
  };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transactions');
  sh.getRange(sh.getLastRow() + 1, 1, 1, TABS.Transactions.length).setValues([TABS.Transactions.map(function (h) { return rec[h]; })]);
  return { change: diff, balance: actual };
}

function deleteRow_(req) {
  if (String(req.id).indexOf('m-') !== 0) throw new Error('only manual entries can be deleted');
  var f = findRow_(req.id);
  f.sh.deleteRow(f.row);
  return { id: req.id };
}
