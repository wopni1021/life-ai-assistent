/**
 * Web API for the phone app. Deployed as a web app (Execute as: me, Access: Anyone).
 * Every request is a POST with a text/plain JSON body: { token, action, ...fields }.
 * The secret token (made by makeToken) is the real protection. Wrong tokens are rate limited.
 */

var DEFAULT_CATEGORIES = ['Dining', 'Groceries', 'Transport', 'Shopping', 'Baby', 'Health', 'Bills', 'Subscriptions',
  'Entertainment', 'Household', 'Personal care', 'Other'];
var DIRECTIONS_ = ['out', 'in', 'refund', 'transfer', 'transfer_in', 'card_payment'];
var MAX_BAD_TOKENS_PER_HOUR = 20;
var MAX_OLD_GUESSES = 300;

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
  if (a === 'sync') return sync_(req);
  if (a === 'list') return list_(req);
  var writes = {
    setCategory: setCategory_, addManual: addManual_, setBalance: setBalance_, deleteRow: deleteRow_,
    voucherSave: voucherSave_, voucherUse: voucherUse_, voucherDelete: voucherDelete_
  };
  if (writes[a]) {
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var res = writes[a](req);
      bumpVersion_();
      res.snapshot = snapshot_();
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
  return rows_('Transactions').map(function (r) {
    r.datetime = dtString_(r.datetime);
    r.createdAt = dtString_(r.createdAt);
    return r;
  });
}

function loadAccounts_() {
  return rows_('Accounts').map(function (a) { a.last4 = String(a.last4 || ''); return a; });
}

function monthNow_() { return Utilities.formatDate(new Date(), 'Asia/Singapore', 'yyyy-MM'); }

/** Includes the month so a saved copy goes out of date when the month rolls over. */
function dataVersion_() {
  return (PropertiesService.getScriptProperties().getProperty('dataVersion') || '0') + '|' + monthNow_();
}

function byNewest_(a, b) { return a.datetime < b.datetime ? 1 : -1; }

/**
 * Checks Gmail, then answers. When nothing changed since the version the app already has,
 * it replies { unchanged: true } without reading the sheet, which is the fast path on open.
 * A busy lock or a Gmail failure does not stop the app getting its data.
 */
function sync_(req) {
  var fetchFailed = false;
  var lock = LockService.getScriptLock();
  if (lock.tryLock(3000)) {
    try {
      fetchNew_();
    } catch (err) {
      console.error(err && err.message);
      fetchFailed = true;
    } finally {
      lock.releaseLock();
    }
  }
  if (!req.force && req.version && req.version === dataVersion_()) return { unchanged: true, fetchFailed: fetchFailed };
  var snap = snapshot_();
  snap.fetchFailed = fetchFailed;
  return snap;
}

/** Everything the app shows without another call: this month, the recent list, and rows waiting to be sorted. */
function snapshot_() {
  var tx = loadTx_(), accounts = loadAccounts_(), month = monthNow_();
  var banks = {}, months = {}, last = '';
  months[month] = true;
  tx.forEach(function (r) {
    if (r.bank) banks[r.bank] = true;
    if (monthOf_(r)) months[monthOf_(r)] = true;
    if (r.bank !== 'manual' && r.createdAt > last) last = r.createdAt;
  });
  var newest = tx.slice().sort(byNewest_);
  var recent = newest.filter(function (r) { return r.status !== 'dup'; }).slice(0, 8);
  var keep = {};
  recent.forEach(function (r) { keep[r.id] = true; });
  var oldGuesses = 0;
  var rows = newest.filter(function (r) {
    if (keep[r.id] || monthOf_(r) === month || r.status === 'review') return true;
    return r.status === 'guess' && oldGuesses++ < MAX_OLD_GUESSES;
  }).map(clientRow_);
  return {
    version: dataVersion_(),
    balances: balances_(accounts, tx),
    month: monthSummary_(tx, month),
    months: Object.keys(months).sort().reverse(),
    banksSeen: Object.keys(banks),
    lastAlertAt: last,
    categories: categories_(tx),
    rows: rows,
    recentIds: recent.map(function (r) { return r.id; }),
    vouchers: loadVouchers_(),
    voucherWarnDays: voucherWarnDays_()
  };
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

/** A row for the app. effects carries the balance rules, so the app needs no copy of them. */
function clientRow_(r) {
  var o = {};
  PUBLIC_FIELDS_.forEach(function (k) { o[k] = r[k]; });
  o.effects = rowEffects_(r);
  return o;
}

/** One older month. The current month comes with sync. */
function list_(req) {
  var month = /^\d{4}-\d{2}$/.test(req.month || '') ? req.month : monthNow_();
  var rows = loadTx_().filter(function (r) { return monthOf_(r) === month; }).sort(byNewest_).map(clientRow_);
  return { month: month, rows: rows };
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

function text_(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 80); }

function setCategory_(req) {
  var f = findRow_(req.id);
  var head = TABS.Transactions;
  var range = f.sh.getRange(f.row, 1, 1, head.length);
  var vals = range.getValues()[0];
  var cur = {};
  head.forEach(function (h, i) { cur[h] = vals[i]; });

  if (req.category !== undefined) cur.category = text_(req.category, 40);
  if (req.tag !== undefined) cur.tag = text_(req.tag, 40);
  if (req.merchant !== undefined) cur.merchant = text_(req.merchant, 80);
  if (req.note !== undefined) cur.note = text_(req.note, 200);
  if (req.account !== undefined) cur.account = text_(req.account, 40);
  if (req.toAccount !== undefined) cur.toAccount = text_(req.toAccount, 40);
  if (req.direction !== undefined) {
    if (DIRECTIONS_.indexOf(req.direction) < 0) throw new Error('bad direction');
    cur.direction = req.direction;
  }
  if (req.amount !== undefined && req.amount !== '') {
    var amt = Number(req.amount);
    if (!isFinite(amt) || amt < 0) throw new Error('bad amount');
    cur.amount = Math.round(amt * 100) / 100;
  }

  var needsDest = (cur.direction === 'transfer' || cur.direction === 'card_payment') && !cur.toAccount;
  var amountMissing = cur.amount === '' || cur.amount === null;
  cur.status = (cur.account && !needsDest && !amountMissing) ? 'ok' : 'review';
  range.setValues([head.map(function (h) { return cur[h]; })]);

  var ruleAdded = false;
  if (req.applyToMerchant && cur.merchantRaw && cur.category) {
    ruleAdded = addRule_(String(cur.merchantRaw), cur.merchant || String(cur.merchantRaw), cur.category, cur.tag);
    if (ruleAdded) reapplyRules();
  }
  return { id: req.id, status: cur.status, ruleAdded: ruleAdded };
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
