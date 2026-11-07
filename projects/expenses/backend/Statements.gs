/**
 * E-statement review. The user emails a statement PDF to herself with the subject "e" or "E".
 * reviewStatement_ and everything above it are pure and tested in tests/run.html;
 * Gmail, Drive and the sheet are only touched in the functions at the bottom.
 */

var MONTHS_ = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
var MONEY_RE_ = /\(?[\d,]+\.\d{2}\)?(?:\s*CR\b)?/g;
var FEE_RE_ = /ANNUAL FEE|MEMBERSHIP FEE|FINANCE CHARGE|INTEREST CHARGE|LATE (?:PAYMENT )?(?:CHARGE|FEE)|OVER ?LIMIT|CASH ADVANCE FEE|FALL[- ]?BELOW|SERVICE (?:CHARGE|FEE)|BANK CHARGES|ADMIN(?:ISTRATIVE)? FEE/i;
var FOREIGN_RE_ = /\b(?:USD|JPY|EUR|GBP|AUD|NZD|MYR|CNY|RMB|HKD|THB|KRW|TWD|IDR|PHP|VND|INR|CHF|CAD)\s*[\d,]+\.\d{2}/;
var STATEMENT_LAG_DAYS = 3;
var STATEMENT_UNPOSTED_DAYS = 5;
var DEFAULT_SUSPICIOUS_AMOUNT = 200;

function isStatementSubject_(subject) { return /^e$/i.test(String(subject || '').trim()); }

function flat_(text) { return String(text || '').replace(/[ ​‌‍﻿]/g, ' ').replace(/\s+/g, ' ').trim(); }

function ymd_(y, m, d) {
  y = Number(y); if (y < 100) y += 2000;
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
}

function daysApart_(a, b) { return Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86400000; }

function monthOfToken_(tok) { return /^\d+$/.test(tok) ? Number(tok) : MONTHS_[String(tok).toUpperCase().slice(0, 3)]; }

function statementBank_(t) {
  if (/Oversea-Chinese Banking|OCBC Bank/i.test(t)) return 'OCBC';
  if (/United Overseas Bank|UOB Card/i.test(t)) return 'UOB';
  if (/DBS Bank|POSB/i.test(t)) return 'DBS';
  return '';
}

/** End date of the statement: the period's last day for accounts, the statement date for cards. */
function statementEnd_(t) {
  var m = /(\d{1,2}) ([A-Z]{3}) (\d{4}) TO (\d{1,2}) ([A-Z]{3}) (\d{4})/i.exec(t);
  if (m) return { from: ymd_(m[3], monthOfToken_(m[2]), m[1]), to: ymd_(m[6], monthOfToken_(m[5]), m[4]) };
  m = /STATEMENT DATE.{0,120}?\b(\d{1,2})[ \-\/]([A-Z]{3}|\d{1,2})[ \-\/](\d{4}|\d{2})\b/i.exec(t);
  if (m) return { from: '', to: ymd_(m[3], monthOfToken_(m[2]), m[1]) };
  return null;
}

/** Bank statements carry a running balance; card statements don't. */
function statementType_(t) { return /BALANCE B\/F|BALANCE BROUGHT FORWARD|OPENING BALANCE/i.test(t) ? 'bank' : 'card'; }

function statementAccount_(t, bank, type, accounts) {
  var cands = [], m, re = /\b\d{4}[- ]\d{4}[- ]\d{4}[- ](\d{4})\b/g;
  while ((m = re.exec(t))) cands.push(m[1]);
  m = /Account (?:No\.?|Number)\s*:?\s*([\d-]{6,})/i.exec(t) || /\b(\d{3}-\d{3}-\d{3}-\d)\b/.exec(t);
  if (m) cands.unshift(lastDigits4_(m[1].replace(/\D/g, '')));
  for (var i = 0; i < cands.length; i++) {
    var a = findAccount_(accounts, bank, cands[i], type) || findAccount_(accounts, bank, cands[i], null);
    if (a) return { account: a, last4: cands[i] };
  }
  return { account: null, last4: cands[0] || '' };
}

function between_(t, startRe, endRe) {
  var s = startRe.exec(t);
  var from = s ? s.index + s[0].length : 0;
  var rest = t.slice(from);
  var e = endRe.exec(rest);
  return rest.slice(0, e ? e.index : rest.length);
}

function moneyValue_(tok) { return num_(String(tok).replace(/[()\sCR]/g, '')); }

function cleanDesc_(s) {
  return String(s || '').replace(/Ref No\.?\s*:?\s*\d+/gi, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * Transaction lines: [{date, desc, amount, delta}]. amount is positive; delta is the change from the account's
 * point of view (a card purchase is negative, a card credit positive, bank money in positive).
 */
function statementLines_(t, bank, type, end) {
  var endMonth = Number(end.slice(5, 7)), endYear = Number(end.slice(0, 4));
  function dateOf(d, mon) {
    var mm = monthOfToken_(mon);
    if (!mm) return '';
    return ymd_(mm > endMonth ? endYear - 1 : endYear, mm, Number(d));
  }
  var section, marker, pick, prev = null;
  if (type === 'bank') {
    var bf = /BALANCE (?:B\/F|BROUGHT FORWARD)\s*([\d,]+\.\d{2})/i.exec(t);
    prev = bf ? num_(bf[1]) : null;
    section = between_(t, /BALANCE (?:B\/F|BROUGHT FORWARD)\s*[\d,]+\.\d{2}/i,
      /BALANCE (?:C\/F|CARRIED FORWARD)|Total Withdrawals|\bTotal\s+[\d,]+\.\d{2}|End of Transaction Details/i);
    marker = /\b(\d{2}) (JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?: (\d{2}) (JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))?\b/gi;
    pick = function (m) { return dateOf(m[1], m[2]); };
  } else if (bank === 'OCBC') {
    section = between_(t, /LAST MONTH'S BALANCE\s*\(?[\d,]+\.\d{2}\)?/i, /\bSUBTOTAL\b|\bSUB TOTAL\b/i);
    marker = /(?:^|\s)(\d{2})\/(\d{2})(?=\s)/g;
    pick = function (m) { return dateOf(m[1], m[2]); };
  } else {
    section = between_(t, /PREVIOUS BALANCE\s*[\d,]+\.\d{2}(?:\s*CR)?/i, /\bSUB ?TOTAL\b|End of Transaction Details/i);
    marker = /\b(\d{2}) ([A-Z]{3}) (\d{2}) ([A-Z]{3})\b/g;
    // UOB lists the posting date first and the purchase date second.
    pick = function (m) { return dateOf(m[3], m[4]); };
  }
  var marks = [], m;
  while ((m = marker.exec(section))) marks.push({ m: m, start: m.index, end: marker.lastIndex });
  var lines = [];
  lines.closing = null;
  marks.forEach(function (k, j) {
    var body = section.slice(k.end, j + 1 < marks.length ? marks[j + 1].start : section.length);
    var toks = [], tm;
    MONEY_RE_.lastIndex = 0;
    while ((tm = MONEY_RE_.exec(body))) toks.push({ text: tm[0], index: tm.index, end: MONEY_RE_.lastIndex });
    if (!toks.length) return;
    var date = pick(k.m);
    if (!date) return;
    var before = body.slice(0, toks[0].index);
    var amount = moneyValue_(toks[0].text), delta;
    // A foreign-currency card line shows the original amount first, then the SGD amount.
    var fx = /\b(USD|JPY|EUR|GBP|AUD|NZD|MYR|CNY|RMB|HKD|THB|KRW|TWD|IDR|PHP|VND|INR|CHF|CAD)\s*$/.exec(before);
    if (type === 'card' && fx && toks.length > 1) {
      before = before.slice(0, fx.index) + fx[1] + ' ' + toks[0].text + ' ';
      toks.shift();
      amount = moneyValue_(toks[0].text);
    }
    var after = type === 'bank' ? body.slice(toks[Math.min(1, toks.length - 1)].end, toks.length > 2 ? toks[2].index : undefined).slice(0, 60) : '';
    var desc = cleanDesc_(before + ' ' + after);
    if (/^(?:BALANCE|PREVIOUS BALANCE|SUB ?TOTAL|TOTAL)/i.test(desc)) return;
    if (type === 'bank') {
      var bal = toks.length > 1 ? moneyValue_(toks[1].text) : null;
      if (bal !== null && prev !== null) {
        delta = cents_(bal - prev);
        if (Math.abs(Math.abs(delta) - amount) > 0.005) delta = /CR\b/.test(toks[0].text) ? amount : -amount;
      } else {
        delta = /CR\b/.test(toks[0].text) ? amount : -amount;
      }
      if (bal !== null) { prev = bal; lines.closing = bal; }
    } else {
      delta = /\(|CR\b/.test(toks[0].text) ? amount : -amount;
    }
    lines.push({ date: date, desc: desc, amount: cents_(amount), delta: cents_(delta) });
  });
  return lines;
}

function closingBalance_(t) {
  var m = /(?:BALANCE C\/F|BALANCE CARRIED FORWARD|CLOSING BALANCE)\s*([\d,]+\.\d{2})/i.exec(t);
  return m ? num_(m[1]) : null;
}

/** OCBC prints when the next annual fee is charged and how much more spending waives it. */
function annualFeeNotice_(t) {
  var m = /S\$([\d,]+\.\d{2})\s*By\s*(\d{1,2} [A-Za-z]{3} \d{4})\s+(\d{1,2} [A-Za-z]{3} \d{4})/.exec(t);
  return m ? { needed: num_(m[1]), by: m[2], feeDate: m[3] } : null;
}

function merchantKey_(s) { return String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 12); }

/**
 * Reads one statement's text and compares it with the logged rows.
 * ctx = { accounts, rows (Transactions, datetime as 'yyyy-MM-ddTHH:mm:ss'), suspiciousAmount }
 * Returns { status, bank, type, account, periodFrom, periodTo, lines, items }.
 * items: [{kind: fee | suspicious | missing | unlogged | balance, date, description, amount, delta, reason}]
 */
function reviewStatement_(text, ctx) {
  var t = flat_(text);
  var bank = statementBank_(t), type = statementType_(t), end = statementEnd_(t);
  var out = { status: 'read', bank: bank, type: type, account: '', periodFrom: '', periodTo: end ? end.to : '', lines: 0, items: [] };
  if (!end) { out.status = 'unreadable'; return out; }
  var found = statementAccount_(t, bank, type, ctx.accounts);
  if (!found.account) { out.status = 'no account'; out.last4 = found.last4; return out; }
  var acct = found.account.id;
  out.account = acct;
  var lines = statementLines_(t, bank, type, end.to);
  out.lines = lines.length;
  if (!lines.length) { out.status = 'unreadable'; return out; }
  out.periodFrom = end.from || lines.reduce(function (min, l) { return l.date < min ? l.date : min; }, lines[0].date);
  var items = out.items;
  function add(kind, l, reason) { items.push({ kind: kind, date: l.date, description: l.desc, amount: l.amount, delta: l.delta, reason: reason }); }

  // Fees, only from the transaction lines, never from the printed terms.
  lines.forEach(function (l) {
    if (l.delta < 0 && FEE_RE_.test(l.desc)) add('fee', l, 'Banks often waive this if you ask.');
  });
  var notice = annualFeeNotice_(t);
  if (notice && notice.needed > 0) {
    items.push({ kind: 'fee', date: '', description: 'Annual fee on ' + notice.feeDate, amount: notice.needed, delta: 0,
      reason: 'Spend S$' + notice.needed.toFixed(2) + ' more by ' + notice.by + ' to have it waived, or ask the bank to waive it.' });
  }

  // Same charge twice on one day, unless a matching credit cancels one.
  var groups = {}, credits = {};
  lines.forEach(function (l) {
    var k = merchantKey_(l.desc) + '|' + l.amount;
    if (l.delta > 0) credits[k] = (credits[k] || 0) + 1;
    else { var g = groups[k + '|' + l.date] = groups[k + '|' + l.date] || { line: l, key: k, n: 0 }; g.n++; }
  });
  Object.keys(groups).forEach(function (gk) {
    var g = groups[gk], left = g.n - (credits[g.key] || 0);
    if (left >= 2) add('suspicious', g.line, 'Charged ' + left + ' times on the same day.');
  });

  // Logged rows on this account, as seen from this account.
  var rows = ctx.rows.filter(function (r) {
    return r.status !== 'dup' && (r.account === acct || r.toAccount === acct);
  }).map(function (r) { return { row: r, delta: deltaFor_(r, acct), date: String(r.datetime).slice(0, 10), used: false }; });
  var trackedFrom = rows.reduce(function (min, x) { return !min || x.date < min ? x.date : min; }, '');
  // A balance correction already counts everything before it, so those lines are not missing.
  var corrected = rows.reduce(function (max, x) { return x.row.direction === 'adjust' && x.date > max ? x.date : max; }, '');
  var correctedLater = corrected > end.to;
  var known = {};
  ctx.rows.forEach(function (r) { if (r.merchantRaw) known[merchantKey_(r.merchantRaw)] = true; });
  var bigAmount = Number(ctx.suspiciousAmount) || DEFAULT_SUSPICIOUS_AMOUNT;

  lines.forEach(function (l) {
    if (FOREIGN_RE_.test(l.desc)) add('suspicious', l, 'Charged in a foreign currency. Check the conversion fee.');
    var match = null;
    rows.forEach(function (x) {
      if (!match && !x.used && x.row.direction !== 'adjust' && Math.abs(x.delta - l.delta) < 0.005 && daysApart_(x.date, l.date) <= STATEMENT_LAG_DAYS) match = x;
    });
    if (match) { match.used = true; return; }
    // Before an account's first logged row it wasn't tracked yet. An account with no rows at all relies on statements.
    if (!correctedLater && (!trackedFrom || l.date >= trackedFrom) && (!corrected || l.date >= corrected)) {
      add('missing', l, 'On the statement but not in the app.');
      if (l.delta < 0 && l.amount >= bigAmount && !known[merchantKey_(l.desc)]) add('suspicious', l, 'First time at this merchant, and over S$' + bigAmount + '.');
    }
  });

  // Logged but not on the statement, leaving out the last few days that may post on the next one.
  var cutoff = new Date(Date.parse(end.to) - STATEMENT_UNPOSTED_DAYS * 86400000).toISOString().slice(0, 10);
  rows.forEach(function (x) {
    if (x.used || x.row.direction === 'adjust' || !x.delta || x.date < out.periodFrom || x.date > cutoff || (corrected && x.date < corrected) || correctedLater) return;
    items.push({ kind: 'unlogged', date: x.date, description: x.row.merchant || x.row.merchantRaw || 'Entry', amount: Math.abs(x.delta), delta: x.delta,
      reason: 'In the app but not on this statement. It may be a duplicate or a reversed charge.', txId: x.row.id });
  });

  // Bank accounts: compare the closing balance with the app on the same day.
  if (type === 'bank' && !correctedLater) {
    var closing = closingBalance_(t);
    if (closing === null) closing = lines.closing;
    if (closing !== null && trackedFrom && trackedFrom <= end.to) {
      var upTo = ctx.rows.filter(function (r) { return String(r.datetime).slice(0, 10) <= end.to; });
      var mine = balances_(ctx.accounts, upTo).accounts.filter(function (a) { return a.id === acct; })[0];
      var appBal = mine ? mine.balance : 0;
      var missingSum = items.filter(function (it) { return it.kind === 'missing'; }).reduce(function (sum, it) { return sum + it.delta; }, 0);
      if (Math.abs(appBal + missingSum - closing) >= 0.01) {
        items.push({ kind: 'balance', date: end.to, description: 'Closing balance', amount: closing, delta: cents_(closing - appBal - missingSum),
          reason: 'The statement says S$' + closing.toFixed(2) + '; the app had S$' + appBal.toFixed(2) + ' that day' +
            (missingSum ? ', before the missing entries above' : '') + '. Add or dismiss those first.' });
      }
    }
  }
  return out;
}

/* ---------- Gmail, Drive and the sheet ---------- */

var STATEMENT_BUDGET_MS = 4 * 60 * 1000;
var STATEMENT_SEARCH = 'from:me to:me has:attachment filename:pdf newer_than:120d';

/** Run once from the editor after the update: asks for the Drive permission used to read PDFs. */
function authorizeStatements() {
  var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  var msg = res.getResponseCode() < 300
    ? 'Statement review is ready. Send a statement to yourself with the subject e, then open the app.'
    : 'Drive did not answer (' + res.getResponseCode() + '). Try again in a minute.';
  // Run from the editor there is no sheet window to show a box in, so the message goes to the log.
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/** The PDF's text, through a temporary Google Doc copy that is deleted straight after. */
function pdfText_(blob) {
  var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  var boundary = 'b' + Utilities.getUuid().replace(/-/g, '');
  var meta = JSON.stringify({ name: 'statement-review-' + Date.now(), mimeType: 'application/vnd.google-apps.document' });
  var head = Utilities.newBlob('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
    '\r\n--' + boundary + '\r\nContent-Type: application/pdf\r\n\r\n').getBytes();
  var tail = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();
  var up = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=en&fields=id', {
    method: 'post', contentType: 'multipart/related; boundary=' + boundary,
    payload: head.concat(blob.getBytes()).concat(tail), headers: auth, muteHttpExceptions: true
  });
  if (up.getResponseCode() >= 300) throw new Error('could not convert the PDF (' + up.getResponseCode() + ')');
  var id = JSON.parse(up.getContentText()).id;
  try {
    var ex = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text/plain', { headers: auth, muteHttpExceptions: true });
    if (ex.getResponseCode() >= 300) throw new Error('could not read the converted statement (' + ex.getResponseCode() + ')');
    return ex.getContentText();
  } finally {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id, { method: 'delete', headers: auth, muteHttpExceptions: true });
  }
}

function sheetFor_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

/**
 * Reads every statement email not read yet, within a time budget. Returns {processed, waiting}.
 * Reading runs without the script lock; only the sheet writes take it.
 */
function checkStatements_() {
  var props = PropertiesService.getScriptProperties();
  if (Date.now() - Number(props.getProperty('statementBusy') || 0) < 5 * 60 * 1000) return { processed: 0, waiting: 0, busy: true };
  props.setProperty('statementBusy', String(Date.now()));
  try {
    var seen = {};
    rows_('Statements').forEach(function (s) { seen[String(s.id)] = true; });
    var todo = [];
    var threads = GmailApp.search(STATEMENT_SEARCH, 0, 50);
    GmailApp.getMessagesForThreads(threads).forEach(function (list) {
      list.forEach(function (m) {
        if (!isStatementSubject_(m.getSubject())) return;
        m.getAttachments().forEach(function (a, k) {
          var id = m.getId() + '-' + k;
          if (!seen[id] && (a.getContentType() === 'application/pdf' || /\.pdf$/i.test(a.getName()))) todo.push({ id: id, att: a });
        });
      });
    });
    if (!todo.length) return { processed: 0, waiting: 0 };
    var started = Date.now(), done = 0;
    var ctx = { accounts: loadAccounts_(), rows: loadTx_(), suspiciousAmount: settingValue_('suspiciousAmount') };
    for (var i = 0; i < todo.length; i++) {
      if (Date.now() - started > STATEMENT_BUDGET_MS) break;
      var r, note = '';
      try { r = reviewStatement_(pdfText_(todo[i].att.copyBlob()), ctx); }
      catch (err) {
        note = String(err && err.message || err).slice(0, 120);
        // Without the Drive permission nothing can be read yet; leave the email for the next try.
        if (/permission|authori[sz]/i.test(note)) throw new Error('Statements need permission: run authorizeStatements in Apps Script');
        r = { status: 'unreadable', account: '', periodFrom: '', periodTo: '', lines: 0, items: [] };
      }
      saveStatement_(todo[i].id, r, note);
      done++;
    }
    if (done) bumpVersion_();
    return { processed: done, waiting: todo.length - done };
  } finally {
    props.deleteProperty('statementBusy');
  }
}

function settingValue_(key) {
  var v = '';
  rows_('Settings').forEach(function (r) { if (r.key === key) v = r.value; });
  return v;
}

function saveStatement_(id, r, note) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var status = r.status;
    var dupOf = rows_('Statements').filter(function (s) {
      return r.account && s.account === r.account && dtString_(s.periodTo).slice(0, 10) === r.periodTo && s.status === 'read';
    })[0];
    if (dupOf) status = 'duplicate';
    var sh = sheetFor_('Statements');
    var rec = { id: id, account: r.account, periodFrom: r.periodFrom, periodTo: r.periodTo, lines: r.lines, status: status, note: note || (r.last4 ? 'no account ending ' + r.last4 : ''), checkedAt: new Date() };
    sh.getRange(sh.getLastRow() + 1, 1, 1, TABS.Statements.length).setValues([TABS.Statements.map(function (h) { return rec[h]; })]);
    if (status !== 'read' || !r.items.length) return;
    var items = sheetFor_('StatementItems');
    var vals = r.items.map(function (it, n) {
      var o = { id: id + '-' + n, statementId: id, account: r.account, kind: it.kind, date: it.date, description: it.description,
        amount: it.amount, delta: it.delta, reason: it.reason, state: 'open', txId: it.txId || '' };
      return TABS.StatementItems.map(function (h) { return o[h]; });
    });
    items.getRange(items.getLastRow() + 1, 1, vals.length, TABS.StatementItems.length).setValues(vals);
  } finally {
    lock.releaseLock();
  }
}

/** For the app: open review items and the latest statements. */
function statementSummary_(accounts) {
  var names = {};
  accounts.forEach(function (a) { names[a.id] = a.name; });
  var statements = rows_('Statements').map(function (s) {
    return { id: String(s.id), account: s.account, accountName: names[s.account] || '', periodTo: dtString_(s.periodTo).slice(0, 10),
      lines: Number(s.lines) || 0, status: s.status, note: s.note };
  });
  var byId = {};
  statements.forEach(function (s) { byId[s.id] = s; });
  var items = rows_('StatementItems').filter(function (it) { return it.state === 'open'; }).map(function (it) {
    var s = byId[String(it.statementId)] || {};
    return { id: String(it.id), kind: it.kind, account: it.account, accountName: names[it.account] || '', statementDate: s.periodTo || '',
      date: dtString_(it.date).slice(0, 10), description: String(it.description), amount: Number(it.amount) || 0, delta: Number(it.delta) || 0, reason: it.reason };
  });
  return { statementItems: items, statements: statements.slice(-12).reverse() };
}

/** add (missing line becomes a transaction), use (statement balance), or dismiss. */
function statementItem_(req) {
  var sh = sheetFor_('StatementItems');
  var n = sh.getLastRow();
  if (n < 2) throw new Error('not found');
  var head = TABS.StatementItems;
  var vals = sh.getRange(2, 1, n - 1, head.length).getValues();
  var idx = -1;
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(req.id)) idx = i;
  if (idx < 0) throw new Error('not found');
  var it = {};
  head.forEach(function (h, k) { it[h] = vals[idx][k]; });
  var txId = '';
  if (req.choice === 'add' && it.kind === 'missing') txId = addFromStatement_(it);
  else if (req.choice === 'use' && it.kind === 'balance') setBalance_({ account: it.account, actual: Number(it.amount), asOf: dtString_(it.date).slice(0, 10) });
  else if (req.choice !== 'dismiss') throw new Error('nothing to do');
  sh.getRange(idx + 2, head.indexOf('state') + 1).setValue(req.choice === 'dismiss' ? 'dismissed' : 'added');
  if (txId) sh.getRange(idx + 2, head.indexOf('txId') + 1).setValue(txId);
  return { id: req.id, txId: txId };
}

function addFromStatement_(it) {
  var ctx = loadContext_();
  var acct = ctx.accounts.filter(function (a) { return a.id === it.account; })[0] || {};
  var delta = Number(it.delta), amt = Math.abs(delta);
  var raw = String(it.description);
  var isPayment = /PAYMENT|CARD RECEIVABLE|CARD CENTRE/i.test(raw);
  var direction = delta < 0 ? (isPayment ? 'transfer' : 'out')
    : acct.type === 'card' ? (isPayment ? 'transfer_in' : 'refund')
    : (isOwnName_(raw, ctx.ownNames) ? 'transfer_in' : 'in');
  var rule = /^transfer/.test(direction) ? null : matchRule_(raw, ctx.rules);
  var rec = {
    id: 'st-' + it.id, datetime: new Date(dtString_(it.date).slice(0, 10) + 'T12:00:00+08:00'), direction: direction, amount: amt,
    account: it.account, toAccount: '', merchantRaw: raw, merchant: rule ? (rule.name || tidyName_(raw)) : tidyName_(raw),
    category: rule ? rule.category : /^transfer/.test(direction) ? 'Transfer' : direction === 'in' ? 'Income' : direction === 'refund' ? 'Rebate' : ctx.defaultTransferCategory || 'Other',
    tag: rule ? rule.tag : '', note: 'from statement', bank: 'statement', channel: 'statement', ref: '',
    status: rule || direction !== 'out' ? 'ok' : 'guess', createdAt: new Date()
  };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transactions');
  sh.getRange(sh.getLastRow() + 1, 1, 1, TABS.Transactions.length).setValues([TABS.Transactions.map(function (h) { return rec[h]; })]);
  return rec.id;
}
