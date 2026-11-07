/**
 * Expense tracker: reads bank alert emails from Gmail and writes them to this spreadsheet.
 * Run setup() once. The phone app fetches new alerts when it opens (see fetchNew_ and the sync action in Api.gs).
 */

var TABS = {
  Transactions: ['id', 'datetime', 'direction', 'amount', 'account', 'toAccount', 'merchantRaw', 'merchant', 'category', 'tag', 'note', 'bank', 'channel', 'ref', 'status', 'createdAt'],
  Accounts: ['id', 'name', 'type', 'bank', 'last4', 'openingBalance', 'currency'],
  Rules: ['pattern', 'name', 'category', 'tag'],
  Settings: ['key', 'value'],
  Unparsed: ['id', 'datetime', 'from', 'subject', 'snippet'],
  Seen: ['id', 'seenAt'],
  Vouchers: ['id', 'name', 'amountLeft', 'expires', 'note', 'status', 'createdAt'],
  Statements: ['id', 'account', 'periodFrom', 'periodTo', 'lines', 'status', 'note', 'checkedAt'],
  StatementItems: ['id', 'statementId', 'account', 'kind', 'date', 'description', 'amount', 'delta', 'reason', 'state', 'txId']
};

var ALERT_SENDERS = 'from:(ibanking.alert@dbs.com OR unialerts@uobgroup.com OR notifications@ocbc.com)';
var FETCH_OVERLAP_SECONDS = 3600;
var FIRST_FETCH_DAYS = 3;

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

/** Run once from the editor. Creates the tabs and starter rules. */
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
    settings.getRange(2, 1, 4, 2).setValues([
      ['ownNames', 'type your name as it appears in bank alerts, separate several with commas'],
      ['currency', 'SGD'],
      ['defaultCategory', 'Dining'],
      ['defaultTransferCategory', 'Other']
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

  SpreadsheetApp.getUi().alert('Setup done. Fill in the Accounts tab (last4) and Settings tab (ownNames), then run checkMail once to test.');
}

/** Run once to stop the old every-minute check. The app now fetches when it opens. */
function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkMail') ScriptApp.deleteTrigger(t);
  });
}

/** Any change to the data gets a new version, so the app knows when its saved copy is out of date. */
function bumpVersion_() {
  PropertiesService.getScriptProperties().setProperty('dataVersion', String(Date.now()));
}

/** Simple trigger: hand edits in the sheet also count as a change. */
function onEdit() {
  bumpVersion_();
}

function rows_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) return [];
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
  return {
    accounts: accounts, ownNames: ownNames, rules: rows_('Rules'),
    defaultCategory: String(settings.defaultCategory || 'Dining'),
    defaultTransferCategory: String(settings.defaultTransferCategory || 'Other')
  };
}

/** Checks Gmail for new bank alerts by hand. The app does the same on open. */
function checkMail() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    fetchNew_();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Reads alerts that arrived since the last check, however long ago that was.
 * The overlap covers mail that arrives during a check; seen ids stop any duplicates.
 * Call it while holding the script lock. Returns the number of transactions added.
 */
function fetchNew_() {
  var props = PropertiesService.getScriptProperties();
  var started = Math.floor(Date.now() / 1000);
  var last = Number(props.getProperty('lastCheckedAt')) || started - FIRST_FETCH_DAYS * 86400;
  var since = last - FETCH_OVERLAP_SECONDS;
  var added = ingest_(ALERT_SENDERS + ' after:' + since, new Date(since * 1000));
  props.setProperty('lastCheckedAt', String(started));
  return added;
}

/** One-time import of recent history, for example backfill(30). Run from the editor. */
function backfill(days) {
  var d = Number(days) > 0 ? Number(days) : 30;
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    ingest_(ALERT_SENDERS + ' newer_than:' + d + 'd');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Applies the current Rules tab to "guess" rows, and re-reads "review" rows with the current
 * Accounts, Settings and Rules tabs. Run it after adding rules or filling in the Accounts tab.
 * A category you typed by hand is kept unless a rule matches, and amounts you typed are kept.
 */
function reapplyRules() {
  reapply_(true);
}

/**
 * fullReread also re-reads the email behind every "guess" row, so new accounts or own names turn
 * earlier rows into transfers. Without it (after a save in the app) guesses only get the Rules tab, which is fast.
 */
function reapply_(fullReread) {
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
    var oldStatus = row[col.status];
    if (oldStatus === 'guess' && !fullReread) {
      var rule = matchRule_(row[col.merchantRaw], ctx.rules);
      if (!rule) return;
      row[col.merchant] = rule.name || row[col.merchant];
      row[col.category] = rule.category || row[col.category];
      row[col.tag] = rule.tag || row[col.tag];
      row[col.status] = 'ok';
      changed++;
      return;
    }
    if (oldStatus !== 'review' && oldStatus !== 'guess') return;
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
    var isDefault = r.status === 'guess';
    row[col.category] = (isDefault && oldCategory) ? oldCategory : (r.category || oldCategory);
    row[col.tag] = r.tag || oldTag;
    row[col.merchant] = r.merchant || oldMerchant;
    if (isDefault && oldCategory && oldStatus === 'review') row[col.status] = 'ok';
    if (!row[col.merchantRaw]) row[col.merchantRaw] = r.merchantRaw;
    if (!row[col.note]) row[col.note] = r.note || '';
    changed++;
  });
  if (changed) {
    range.setValues(vals);
    markDuplicateTransfers_();
    bumpVersion_();
  }
}

/** Every thread matching the query. Gmail returns at most 200 per call. */
function searchAll_(query) {
  var all = [], page;
  do {
    page = GmailApp.search(query, all.length, 200);
    all = all.concat(page);
  } while (page.length === 200);
  return all;
}

/** notBefore is optional: Gmail returns whole threads, so older messages in them are skipped. Returns transactions added. */
function ingest_(query, notBefore) {
  var threads = searchAll_(query);
  if (!threads.length) return 0;

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
  GmailApp.getMessagesForThreads(threads).forEach(function (list) {
    list.forEach(function (m) {
      if (!seen[m.getId()] && (!notBefore || m.getDate() >= notBefore)) msgs.push(m);
    });
  });
  if (!msgs.length) return 0;
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
  if (txRows.length) {
    markDuplicateTransfers_();
    bumpVersion_();
  }
  pruneSeen_(seenSheet);
  return txRows.length;
}

function append_(sh, rows) {
  if (!rows.length) return;
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * An incoming "transfer_in", or an incoming payment with no sender name, is a duplicate of an outgoing
 * transfer between own accounts. When that transfer had no destination yet, it gets this account.
 */
function markDuplicateTransfers_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transactions');
  var n = sh.getLastRow();
  if (n < 2) return;
  var start = Math.max(2, n - 300);
  var head = TABS.Transactions;
  var vals = sh.getRange(start, 1, n - start + 1, head.length).getValues();
  var col = {}; head.forEach(function (h, i) { col[h] = i; });
  var rows = vals.map(function (v) {
    var o = {};
    head.forEach(function (h, i) { o[h] = v[i]; });
    return o;
  });
  pairTransfers_(rows).forEach(function (p) {
    sh.getRange(start + p.incoming, col.status + 1).setValue('dup');
    if (p.toAccount) {
      sh.getRange(start + p.outgoing, col.toAccount + 1).setValue(p.toAccount);
      sh.getRange(start + p.outgoing, col.status + 1).setValue('ok');
    }
  });
}

function pruneSeen_(sh) {
  var n = sh.getLastRow();
  if (n < 500) return;
  sh.deleteRows(2, n - 300);
}
