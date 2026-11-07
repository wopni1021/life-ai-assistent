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
  // DBS consolidated statements: "Account Summary as at 31 Oct 2026".
  m = /\bas (?:at|of) (\d{1,2}) ([A-Z]{3}) (\d{4})\b/i.exec(t);
  if (m && monthOfToken_(m[2])) return { from: '', to: ymd_(m[3], monthOfToken_(m[2]), m[1]) };
  return null;
}

/** Card statements start from last month's balance; bank statements carry a running balance. */
function statementType_(t) {
  if (/LAST MONTH'S BALANCE|PREVIOUS BALANCE/i.test(t)) return 'card';
  return /BALANCE B\/F|BALANCE BROUGHT FORWARD/i.test(t) ? 'bank' : 'card';
}

var BANK_START_RE_ = /BALANCE (?:B\/F|BROUGHT FORWARD)\s*(?:SGD\s*)?([\d,]+\.\d{2})/gi;
var BANK_END_RE_ = /BALANCE (?:C\/F|CARRIED FORWARD)|Total Withdrawals|\bTotal\s+[\d,]+\.\d{2}|End of Transaction Details/i;
var ACCOUNT_NO_RE_ = /Account (?:No\.?|Number)\s*:?\s*(\d[\d-]{5,}\d)|\b(\d{3}-\d{3}-\d{3}-\d)\b/gi;

/** Page footers and repeated headers that Google's text puts between transactions. */
function statementNoise_(t) {
  return t.replace(/Please note that you are bound by a duty.*?(?:Transaction Amount Date SGD|Balance SGD|$)/gi, ' ')
    .replace(/SG\d+ \(\d{2}\/\d{4}\) DBS Co\. Reg\. No\..*?POSB Biz Reg No\. \w+/gi, ' ');
}

/**
 * The transaction parts of a statement: [{text, start (bank opening balance), accountNo}].
 * A DBS statement has a part per account and per page; a card statement has one.
 */
function statementParts_(t, bank, type) {
  if (type !== 'bank') {
    var startRe = bank === 'OCBC' ? /LAST MONTH'S BALANCE\s*\(?[\d,]+\.\d{2}\)?/i : /PREVIOUS BALANCE\s*[\d,]+\.\d{2}(?:\s*CR)?/i;
    var endRe = bank === 'OCBC' ? /\bSUB ?TOTAL\b/i : /\bSUB ?TOTAL\b|End of Transaction Details/i;
    var s = startRe.exec(t);
    if (!s) return [];
    return [{ text: between_(t, startRe, endRe), start: null, accountNo: '', opening: num_(String(s[0]).replace(/^\D+/, '').replace(/[()\sCR]/g, '')) }];
  }
  var parts = [], m, re = new RegExp(BANK_START_RE_.source, 'gi');
  while ((m = re.exec(t))) {
    var from = re.lastIndex, rest = t.slice(from);
    var e = BANK_END_RE_.exec(rest), next = new RegExp(BANK_START_RE_.source, 'i').exec(rest);
    var stop = Math.min(e ? e.index : rest.length, next ? next.index : rest.length);
    var before = t.slice(Math.max(0, m.index - 400), m.index), no = '', a, ar = new RegExp(ACCOUNT_NO_RE_.source, 'gi');
    while ((a = ar.exec(before))) no = (a[1] || a[2]).replace(/\D/g, '');
    parts.push({ text: rest.slice(0, stop), start: num_(m[1]), accountNo: no });
  }
  return parts;
}

function statementAccount_(t, bank, type, accounts, parts) {
  var cands = [], m, re = /\b\d{4}[- ]\d{4}[- ]\d{4}[- ](\d{4})\b/g;
  (parts || []).forEach(function (p) { if (p.accountNo) cands.push(lastDigits4_(p.accountNo)); });
  while ((m = re.exec(t))) cands.push(m[1]);
  m = /Account (?:No\.?|Number)\s*:?\s*(\d[\d-]{5,}\d)/i.exec(t) || /\b(\d{3}-\d{3}-\d{3}-\d)\b/.exec(t);
  if (m) cands.push(lastDigits4_(m[1].replace(/\D/g, '')));
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
  return String(s || '').replace(/Ref No\.?\s*:?\s*\d+/gi, '')
    .replace(/^\s*(?:FAST Payment \/ Receipt|FAST Collection|Funds Transfer|Point-of-Sale Transaction)\s*/i, '')
    .replace(/\b(?:PAYNOW TRANSFER|NETS QR PAYMENT)\s+\d+/gi, '')
    .replace(/[A-Z0-9]*\d{8,}[A-Z0-9]*/gi, '').replace(/(?:\s+\d)+(?:\s+Total)?\s*$/, '').replace(/\s+OTHER\s*$/i, '')
    .replace(/\s+/g, ' ').trim().slice(0, 80);
}

var FX_CODES_ = 'USD|JPY|EUR|GBP|AUD|NZD|MYR|CNY|RMB|HKD|THB|KRW|TWD|IDR|PHP|VND|INR|CHF|CAD';

/**
 * Transaction lines: [{date, desc, amount, delta}]. amount is positive; delta is the change from the account's
 * point of view (a card purchase is negative, a card credit positive, bank money in positive).
 * Google's text often lists a page's descriptions first and its amounts after, so entries and amounts are
 * paired in order. A bank line's direction comes from the running balance, which also checks the pairing.
 * lines.problem says why lines were left out; lines.closing is the last balance seen.
 */
function statementLines_(t, bank, type, end, accountNo) {
  var endYear = Number(end.slice(0, 4));
  function dateOf(d, mon, y) {
    var mm = monthOfToken_(mon);
    if (!mm || mm > 12 || Number(d) < 1 || Number(d) > 31) return '';
    if (y) return ymd_(y, mm, Number(d));
    // No year printed: the statement's year, unless that lands well after the statement (a December line in a January statement).
    var same = ymd_(endYear, mm, Number(d));
    return Date.parse(same) - Date.parse(end) > 45 * 86400000 ? ymd_(endYear - 1, mm, Number(d)) : same;
  }
  var MON = '(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)';
  var lines = [];
  lines.closing = null; lines.problem = '';
  var parts = statementParts_(statementNoise_(t), bank, type).filter(function (p) {
    return !accountNo || !p.accountNo || lastDigits4_(p.accountNo) === lastDigits4_(accountNo);
  });
  if (!parts.length) { lines.problem = 'no transaction section found'; return lines; }
  parts.forEach(function (p) {
    var marker, pick;
    if (type === 'bank' && /\b\d{2}\/\d{2}\/\d{4}\b/.test(p.text)) {
      marker = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;
      pick = function (m) { return dateOf(m[1], m[2], m[3]); };
    } else if (type === 'bank') {
      marker = new RegExp('\\b(\\d{2}) ' + MON + '(?: (\\d{2}) ' + MON + ')?\\b', 'gi');
      pick = function (m) { return dateOf(m[1], m[2]); };
    } else if (bank === 'OCBC') {
      marker = /(?:^|\s)(\d{2})\/(\d{2})(?=\s)/g;
      pick = function (m) { return dateOf(m[1], m[2]); };
    } else {
      marker = new RegExp('\\b(\\d{2}) ' + MON + ' (\\d{2}) ' + MON + '\\b', 'gi');
      // UOB lists the posting date first and the purchase date second.
      pick = function (m) { return dateOf(m[3], m[4]); };
    }
    var entries = [], m;
    while ((m = marker.exec(p.text))) {
      var date = pick(m);
      if (date) entries.push({ date: date, start: m.index, end: marker.lastIndex });
    }
    // Amounts in order, except a foreign amount, which belongs to the description.
    var toks = [], tm, re = new RegExp(MONEY_RE_.source, 'g'), fxRe = new RegExp('\\b(?:' + FX_CODES_ + ')\\s*$');
    while ((tm = re.exec(p.text))) {
      if (fxRe.test(p.text.slice(Math.max(0, tm.index - 5), tm.index))) continue;
      toks.push({ text: tm[0], index: tm.index, end: re.lastIndex });
    }
    var per = type === 'bank' ? 2 : 1;
    if (!entries.length) return;
    if (toks.length !== entries.length * per) {
      lines.problem = entries.length + ' entries but ' + toks.length + ' amounts in one part';
      return;
    }
    var prev = p.start, found = [];
    for (var j = 0; j < entries.length; j++) {
      var k = entries[j];
      var body = p.text.slice(k.end, j + 1 < entries.length ? entries[j + 1].start : p.text.length);
      var desc = cleanDesc_(body.replace(new RegExp(MONEY_RE_.source, 'g'), function (x, at) {
        return fxRe.test(body.slice(Math.max(0, at - 5), at)) ? x : ' ';
      }));
      var tok = toks[j * per], amount = moneyValue_(tok.text), delta;
      if (type === 'bank') {
        var bal = moneyValue_(toks[j * per + 1].text);
        delta = cents_(bal - prev);
        if (Math.abs(Math.abs(delta) - amount) > 0.005) {
          lines.problem = 'the running balance does not add up near ' + k.date;
          return;
        }
        prev = bal;
      } else {
        delta = /\(|CR\b/.test(tok.text) ? amount : -amount;
      }
      found.push({ date: k.date, desc: desc, amount: cents_(amount), delta: cents_(delta) });
    }
    found.forEach(function (l) { lines.push(l); });
    if (type === 'bank') lines.closing = prev;
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
  var found = statementAccount_(t, bank, type, ctx.accounts, type === 'bank' ? statementParts_(statementNoise_(t), bank, type) : []);
  if (!found.account) { out.status = 'no account'; out.last4 = found.last4; return out; }
  var acct = found.account.id;
  out.account = acct;
  var lines = statementLines_(t, bank, type, end.to, type === 'bank' ? found.last4 : '');
  out.lines = lines.length;
  out.lineList = lines;
  if (lines.problem) out.note = lines.problem;
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
    : 'Drive said no (' + res.getResponseCode() + ': ' + driveReason_(res) + ').';
  // Run from the editor there is no sheet window to show a box in, so the message goes to the log.
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/** The PDF's text, through a temporary Google Doc copy that is deleted straight after. */
/** Google's short reason for a refused Drive call, such as accessNotConfigured. */
function driveReason_(res) {
  try {
    var e = JSON.parse(res.getContentText()).error;
    return ((e.errors && e.errors[0] && e.errors[0].reason) || e.status || '') + ' ' + String(e.message || '').slice(0, 160);
  } catch (err) { return String(res.getContentText()).slice(0, 160); }
}

/** A refused Drive call (no permission, API off) is not the statement's fault, so the email is tried again later. */
function driveError_(what, res) {
  var code = res.getResponseCode();
  var err = new Error(what + ' (' + code + ': ' + driveReason_(res) + ')');
  if (code === 401 || code === 403) err.retryLater = true;
  return err;
}

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
  if (up.getResponseCode() >= 300) throw driveError_('could not convert the PDF', up);
  var id = JSON.parse(up.getContentText()).id;
  try {
    var ex = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text/plain', { headers: auth, muteHttpExceptions: true });
    if (ex.getResponseCode() >= 300) throw driveError_('could not read the converted statement', ex);
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
        if (err && err.retryLater || /permission|authori[sz]/i.test(note)) throw new Error('Statements could not be read yet: ' + note);
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
    var rec = { id: id, account: r.account, periodFrom: r.periodFrom, periodTo: r.periodTo, lines: r.lines, status: status, note: note || r.note || (r.last4 ? 'no account ending ' + r.last4 : ''), checkedAt: new Date() };
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

/* ---------- tuning the readers (run by hand from the editor) ---------- */

/**
 * Writes the text Google makes from each statement email to a temporary StatementText tab, one row per line,
 * so the per-bank readers can be matched to it. Delete the tab afterwards with restartStatementReview.
 */
function saveStatementText() {
  var out = [['statementId', 'line', 'text']];
  var threads = GmailApp.search(STATEMENT_SEARCH, 0, 50);
  GmailApp.getMessagesForThreads(threads).forEach(function (list) {
    list.forEach(function (m) {
      if (!isStatementSubject_(m.getSubject())) return;
      m.getAttachments().forEach(function (a, k) {
        if (a.getContentType() !== 'application/pdf' && !/\.pdf$/i.test(a.getName())) return;
        var lines = String(pdfText_(a.copyBlob())).split(/\r?\n/);
        lines.forEach(function (t, n) { out.push([m.getId() + '-' + k, n + 1, "'" + t.slice(0, 2000)]); });
      });
    });
  });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('StatementText') || ss.insertSheet('StatementText');
  sh.clear();
  sh.getRange(1, 1, out.length, 3).setValues(out);
  Logger.log('Saved ' + (out.length - 1) + ' lines to the StatementText tab.');
}

/**
 * Forgets every statement read so far and its open review items, and deletes the StatementText tab,
 * so the next app open reads the statement emails again. Entries already added to the app stay.
 */
function restartStatementReview() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var text = ss.getSheetByName('StatementText');
  if (text) ss.deleteSheet(text);
  ['Statements', 'StatementItems'].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  });
  PropertiesService.getScriptProperties().deleteProperty('statementBusy');
  bumpVersion_();
  Logger.log('Statement review cleared. Open the app to read the statements again.');
}
