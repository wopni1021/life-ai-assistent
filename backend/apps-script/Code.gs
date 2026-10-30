/**
 * Expense tracker: reads bank alert emails from Gmail and writes them to this spreadsheet.
 * Run setup() once. After that, checkMail() runs every minute by itself.
 */

var TABS = {
  Transactions: ['id', 'datetime', 'direction', 'amount', 'account', 'toAccount', 'merchantRaw', 'merchant', 'category', 'tag', 'note', 'bank', 'channel', 'ref', 'status', 'createdAt'],
  Accounts: ['id', 'name', 'type', 'bank', 'last4', 'openingBalance', 'currency'],
  Rules: ['pattern', 'name', 'category', 'tag'],
  Settings: ['key', 'value'],
  Unparsed: ['id', 'datetime', 'from', 'subject', 'snippet'],
  Seen: ['id', 'seenAt']
};

var SEARCH_QUERY = 'from:(ibanking.alert@dbs.com OR unialerts@uobgroup.com) newer_than:2d';

var SEED_RULES = [
  ['SHENG SIONG', 'Sheng Siong', 'Groceries', 'supermarket'],
  ['NTUC FP', 'NTUC FairPrice', 'Groceries', 'supermarket'],
  ['BUS/MRT', 'Public transport', 'Transport', 'commute'],
  ['SHOPEEPAY', 'ShopeePay top-up', 'Shopping', 'e-wallet'],
  ['SHOPEE', 'Shopee', 'Shopping', 'online'],
  ['CLASSPASS', 'ClassPass', 'Subscriptions', 'fitness'],
  ['re:^GV\\b', 'Golden Village', 'Entertainment', 'movies'],
  ['JOLLIBEE', 'Jollibee', 'Dining', 'fast food'],
  ['MIXUE', 'Mixue', 'Dining', 'bubble tea'],
  ['BEARD PAPA', "Beard Papa's", 'Dining', 'dessert'],
  ['CHATERAISE', 'Chateraise', 'Dining', 'dessert'],
  ['AYAM PENYET', 'Ayam Penyet President', 'Dining', 'restaurant'],
  ['WHOLLY GREENS', 'Wholly Greens', 'Dining', 'healthy'],
  ['IJOOZ', 'iJooz', 'Dining', 'drinks'],
  ['FOOD PALATE', 'Food Palate', 'Dining', 'food court'],
  ['MINISTRY OF MANPOWER', 'MOM levy', 'Bills', 'levy']
];

/** Run once from the editor. Creates the tabs, starter rules and the one-minute trigger. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  var rules = ss.getSheetByName('Rules');
  if (rules.getLastRow() === 1) rules.getRange(2, 1, SEED_RULES.length, 4).setValues(SEED_RULES);

  var settings = ss.getSheetByName('Settings');
  if (settings.getLastRow() === 1) {
    settings.getRange(2, 1, 2, 2).setValues([
      ['ownNames', 'type your name as it appears in bank alerts, separate several with commas'],
      ['currency', 'SGD']
    ]);
  }
  var accounts = ss.getSheetByName('Accounts');
  if (accounts.getLastRow() === 1) {
    accounts.getRange(2, 1, 3, 7).setValues([
      ['dbs-savings', 'DBS Savings', 'bank', 'DBS', '', 0, 'SGD'],
      ['uob-account', 'UOB Account', 'bank', 'UOB', '', 0, 'SGD'],
      ['uob-card', 'UOB Card', 'card', 'UOB', '', 0, 'SGD']
    ]);
  }

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkMail') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkMail').timeBased().everyMinutes(1).create();
  SpreadsheetApp.getUi().alert('Setup done. Fill in the Accounts tab (last4) and Settings tab (ownNames), then run checkMail once to test.');
}

function rows_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  var n = sh.getLastRow();
  if (n < 2) return [];
  var head = TABS[name];
  return sh.getRange(2, 1, n - 1, head.length).getValues().map(function (r) {
    var o = {};
    head.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}

function loadContext_() {
  var settings = {};
  rows_('Settings').forEach(function (r) { settings[r.key] = r.value; });
  var ownNames = String(settings.ownNames || '').split(',').map(function (s) { return s.trim(); }).filter(function (s) {
    return s && s.indexOf('type your name') !== 0;
  });
  var accounts = rows_('Accounts').map(function (a) { a.last4 = String(a.last4 || '').trim(); return a; });
  return { accounts: accounts, ownNames: ownNames, rules: rows_('Rules') };
}

/** Checks Gmail for new bank alerts. Safe to run any time; already-seen messages are skipped. */
function checkMail() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    ingest_(SEARCH_QUERY);
  } finally {
    lock.releaseLock();
  }
}

/** One-time import of recent history, for example backfill(30). Run from the editor. */
function backfill(days) {
  var d = Number(days) > 0 ? Number(days) : 30;
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    ingest_('from:(ibanking.alert@dbs.com OR unialerts@uobgroup.com) newer_than:' + d + 'd');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Re-reads every row with status "review" and classifies it again with the current Accounts,
 * Settings and Rules tabs. Run it after adding rules or filling in the Accounts tab.
 * Rows you already categorised by hand (category not empty) are left alone, and amounts you typed are kept.
 */
function reapplyRules() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transactions');
  var n = sh.getLastRow();
  if (n < 2) return;
  var head = TABS.Transactions;
  var col = {}; head.forEach(function (h, i) { col[h] = i; });
  var range = sh.getRange(2, 1, n - 1, head.length);
  var vals = range.getValues();
  var ctx = loadContext_();
  var changed = 0;
  vals.forEach(function (row) {
    if (row[col.status] !== 'review') return;
    var oldCategory = row[col.category], oldTag = row[col.tag], oldMerchant = row[col.merchant];
    var msg;
    try { msg = GmailApp.getMessageById(String(row[col.id])); } catch (e) { return; }
    if (!msg) return;
    var p = parseAlert_(msg.getFrom(), msg.getSubject(), msg.getPlainBody());
    if (p.kind !== 'txn') return;
    if (p.amount === '' && row[col.amount] !== '') p.amount = Number(row[col.amount]);
    var r = buildRow_(p, ctx);
    ['direction', 'account', 'toAccount', 'status'].forEach(function (k) { row[col[k]] = r[k]; });
    // Keep what you typed by hand when no rule gives a value.
    row[col.category] = r.category || oldCategory;
    row[col.tag] = r.tag || oldTag;
    row[col.merchant] = r.merchant || oldMerchant;
    if (row[col.status] === 'review' && !r.category && oldCategory && r.account) row[col.status] = 'ok';
    if (!row[col.merchantRaw]) row[col.merchantRaw] = r.merchantRaw;
    if (!row[col.note]) row[col.note] = r.note || '';
    changed++;
  });
  if (changed) {
    range.setValues(vals);
    markDuplicateTransfers_();
  }
}

function ingest_(query) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var txSheet = ss.getSheetByName('Transactions');
  var seenSheet = ss.getSheetByName('Seen');
  var unSheet = ss.getSheetByName('Unparsed');

  var seen = {};
  [txSheet, seenSheet, unSheet].forEach(function (sh) {
    var n = sh.getLastRow();
    if (n > 1) sh.getRange(2, 1, n - 1, 1).getValues().forEach(function (r) { seen[String(r[0])] = true; });
  });

  var msgs = [];
  GmailApp.search(query, 0, 200).forEach(function (th) {
    th.getMessages().forEach(function (m) {
      if (!seen[m.getId()]) msgs.push(m);
    });
  });
  if (!msgs.length) return;
  msgs.sort(function (a, b) { return a.getDate() - b.getDate(); });

  var ctx = loadContext_();
  var txRows = [], seenRows = [], unRows = [];
  var now = new Date();
  msgs.forEach(function (m) {
    var id = m.getId();
    var p = parseAlert_(m.getFrom(), m.getSubject(), m.getPlainBody());
    if (p.kind === 'txn') {
      var r = buildRow_(p, ctx);
      txRows.push(TABS.Transactions.map(function (h) {
        if (h === 'id') return id;
        if (h === 'datetime') return m.getDate();
        if (h === 'createdAt') return now;
        if (h === 'note') return r.note || '';
        return r[h] === undefined ? '' : r[h];
      }));
    } else if (p.kind === 'ignore') {
      seenRows.push([id, now]);
    } else {
      unRows.push([id, m.getDate(), m.getFrom(), m.getSubject(), m.getPlainBody().replace(/\s+/g, ' ').slice(0, 300)]);
    }
  });

  append_(txSheet, txRows);
  append_(seenSheet, seenRows);
  append_(unSheet, unRows);
  if (txRows.length) markDuplicateTransfers_();
  pruneSeen_(seenSheet);
}

function append_(sh, rows) {
  if (!rows.length) return;
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * An incoming "transfer_in", or an incoming payment with no sender name, is a duplicate
 * when an outgoing transfer already credits the same account for the same amount.
 */
function markDuplicateTransfers_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transactions');
  var n = sh.getLastRow();
  if (n < 2) return;
  var start = Math.max(2, n - 300);
  var head = TABS.Transactions;
  var vals = sh.getRange(start, 1, n - start + 1, head.length).getValues();
  var col = {}; head.forEach(function (h, i) { col[h] = i; });
  vals.forEach(function (ri, i) {
    var isIncoming = ri[col.direction] === 'transfer_in' || (ri[col.direction] === 'in' && !ri[col.merchantRaw]);
    if (!isIncoming || ri[col.status] === 'dup') return;
    for (var j = 0; j < vals.length; j++) {
      var ro = vals[j];
      if ((ro[col.direction] === 'transfer' || ro[col.direction] === 'card_payment') &&
          ro[col.toAccount] && ro[col.toAccount] === ri[col.account] &&
          Number(ro[col.amount]) === Number(ri[col.amount]) &&
          Math.abs(new Date(ro[col.datetime]) - new Date(ri[col.datetime])) <= 30 * 60 * 1000) {
        sh.getRange(start + i, col.status + 1).setValue('dup');
        return;
      }
    }
  });
}

function pruneSeen_(sh) {
  var n = sh.getLastRow();
  if (n < 500) return;
  sh.deleteRows(2, n - 300);
}
