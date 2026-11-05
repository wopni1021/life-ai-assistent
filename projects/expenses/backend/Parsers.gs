/**
 * Pure parsing and classification of bank alert emails.
 * No Apps Script services are used here, so this file can be tested in any JavaScript engine
 * (see tests/run.html).
 */

var AMT_ = '(?:SGD|S\\$)\\s?([\\d,]+(?:\\.\\d+)?)';

function cleanText_(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/[|* ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function num_(s) { return Number(String(s).replace(/,/g, '')); }

function pick_(t, re) {
  var m = re.exec(t);
  return m ? m[1].trim() : '';
}

/**
 * Turns one email into { kind: 'txn' | 'ignore' | 'unknown', ... }.
 * A 'txn' has: bank, direction (out | in | refund | card_payment), amount, accountType (bank | card),
 * last4 (own account), counterparty, counterLast4, ref, channel.
 */
function parseAlert_(from, subject, body) {
  var f = String(from || '').toLowerCase();
  var t = cleanText_(body);
  if (f.indexOf('dbs.com') >= 0) return parseDbs_(String(subject || ''), t);
  if (f.indexOf('uobgroup.com') >= 0) return parseUob_(String(subject || ''), t);
  if (f.indexOf('ocbc.com') >= 0) return parseOcbc_(String(subject || ''), t);
  return { kind: 'ignore', reason: 'other sender' };
}

function stripAccountSuffix_(s) {
  return String(s || '')
    .replace(/\s*\(?\s*(?:A\/C|UEN) ending [A-Z0-9]+\s*\)?\s*$/i, '')
    .replace(/\s+/g, ' ').trim();
}

function parseDbs_(subject, t) {
  var head = subject + ' ' + t.slice(0, 400);
  if (/on hold|eDocument|eGIRO|GIRO (?:set up|application)|set up your GIRO/i.test(head)) {
    return { kind: 'ignore', reason: 'not a payment' };
  }
  var ref = pick_(t, /Transaction Ref:\s*(\S+)/);
  var m;

  m = new RegExp('You have received\\s+' + AMT_ + '\\s+via', 'i').exec(t);
  if (m) {
    return {
      kind: 'txn', bank: 'DBS', direction: 'in', amount: num_(m[1]), accountType: 'bank',
      last4: pick_(t, /To:\s*Your\s.*?account\s+ending\s+(\d{4})/i) || pick_(t, /account\s+ending\s+(\d{4})/i),
      counterparty: stripAccountSuffix_(pick_(t, /From:\s*(.+?)\s+To:/)), counterLast4: '', ref: ref, channel: 'FAST'
    };
  }

  m = new RegExp('Payment amount:\\s*' + AMT_).exec(t);
  if (m) {
    return {
      kind: 'txn', bank: 'DBS', direction: 'out', amount: num_(m[1]), accountType: 'bank',
      last4: pick_(pick_(t, /From:\s*(.+?)\s+Paying to:/), /ending\s+(\d{4})/i),
      counterparty: stripAccountSuffix_(pick_(t, /Paying to:\s*(.+?)\s+Payment amount:/)), counterLast4: '',
      ref: ref || pick_(t, /Bill Reference number:\s*(\S+)/), channel: 'GIRO'
    };
  }

  m = new RegExp('Amount:\\s*' + AMT_).exec(t);
  if (m) {
    var fromS = pick_(t, /From:\s*(.+?)\s+To:/);
    var toS = pick_(t, /\bTo:\s*(.+?)\s+(?:If unauthori[sz]ed|Thank you)/);
    var channel = /PAYNOW/i.test(t) ? 'PayNow' : /NETS Scan/i.test(t) ? 'NETS' : /FAST/i.test(t) ? 'FAST' : 'Transfer';
    return {
      kind: 'txn', bank: 'DBS', direction: 'out', amount: num_(m[1]), accountType: 'bank',
      last4: pick_(fromS, /ending\s+(\d{4})/i),
      counterparty: stripAccountSuffix_(toS), counterLast4: pick_(toS, /ending\s+(\d{4})/i),
      ref: ref, channel: channel, ownTransfer: /Transfer to own account/i.test(t)
    };
  }
  // Settings and card notices carry no amount, so only emails with one are worth a look in Unparsed.
  if (!new RegExp(AMT_).test(t)) return { kind: 'ignore', reason: 'no amount' };
  return { kind: 'unknown' };
}

function parseUob_(subject, t) {
  if (/Payment Received/i.test(subject)) return { kind: 'ignore', reason: 'card payment confirmation' };
  if (/eStatement|eAdvice/i.test(subject)) return { kind: 'ignore', reason: 'statement notice' };
  if (/declined/i.test(subject)) return { kind: 'ignore', reason: 'declined, nothing was charged' };
  var m;

  m = new RegExp('You have received ' + AMT_ + ' in your PayNow-linked account ending (\\d{4})', 'i').exec(t);
  if (m) {
    return {
      kind: 'txn', bank: 'UOB', direction: 'in', amount: num_(m[1]), accountType: 'bank', last4: m[2],
      counterparty: '', counterLast4: '', ref: '', channel: 'PayNow'
    };
  }

  // Card purchase in a foreign currency: the alert has no SGD amount, so the user fills it in.
  m = /A transaction of ([A-Z]{3})\s?([\d,]+(?:\.\d+)?) was made with your UOB Card ending (\d{4}) on \d{2}\/\d{2}\/\d{2} at (.+?)\.\s*If unauthori/i.exec(t);
  if (m && m[1].toUpperCase() !== 'SGD') {
    return {
      kind: 'txn', bank: 'UOB', direction: 'out', amount: '', accountType: 'card', last4: m[3],
      counterparty: m[4].trim(), counterLast4: '', ref: '', channel: 'Card',
      note: m[1].toUpperCase() + ' ' + m[2] + ' (enter the SGD amount from your statement)'
    };
  }

  m = new RegExp('A transaction of ' + AMT_ + ' was made with your UOB Card ending (\\d{4}) on \\d{2}/\\d{2}/\\d{2} at (.+?)\\.\\s*If unauthori', 'i').exec(t);
  if (m) {
    return {
      kind: 'txn', bank: 'UOB', direction: 'out', amount: num_(m[1]), accountType: 'card', last4: m[2],
      counterparty: m[3].trim(), counterLast4: '', ref: '', channel: 'Card'
    };
  }

  m = /A transaction of\s+([\d,]+(?:\.\d+)?)\s+SGD made with your UOB card ending (\d{4}) on .+? at (.+?) has been reversed/i.exec(t);
  if (m) {
    return {
      kind: 'txn', bank: 'UOB', direction: 'refund', amount: num_(m[1]), accountType: 'card', last4: m[2],
      counterparty: m[3].trim(), counterLast4: '', ref: '', channel: 'Card'
    };
  }

  m = new RegExp('A transaction of ' + AMT_ + ' was debited from your a/c X*(\\d{4}) at .+?\\. Ref: (.+?)\\.\\s*If unauthori', 'i').exec(t);
  if (m) {
    var ref = m[3].trim();
    if (/UOB CARD CENTRE/i.test(ref)) {
      return {
        kind: 'txn', bank: 'UOB', direction: 'card_payment', amount: num_(m[1]), accountType: 'bank', last4: m[2],
        counterparty: 'UOB Card', counterLast4: pick_(ref, /(\d{4})\s*$/), ref: ref, channel: 'GIRO'
      };
    }
    var payee = ref.replace(/^Inward DR\s*-\s*GIRO,\s*/i, '').split(',')[0].trim();
    return {
      kind: 'txn', bank: 'UOB', direction: 'out', amount: num_(m[1]), accountType: 'bank', last4: m[2],
      counterparty: payee || ref, counterLast4: '', ref: ref, channel: /GIRO/i.test(ref) ? 'GIRO' : 'Debit'
    };
  }

  m = new RegExp('A transaction of ' + AMT_ + ' was credited (?:to|into) your a/c X*(\\d{4})', 'i').exec(t);
  if (m) {
    return {
      kind: 'txn', bank: 'UOB', direction: 'in', amount: num_(m[1]), accountType: 'bank', last4: m[2],
      counterparty: pick_(t, /Ref:\s*(.+?)\.\s*If unauthori/i), counterLast4: '', ref: '', channel: 'Credit'
    };
  }
  return { kind: 'unknown' };
}

/** Last 4 digits of the last number in s: "360 Account (-123456)" gives 3456. */
function lastDigits4_(s) {
  var nums = String(s || '').match(/\d+/g);
  if (!nums) return '';
  var d = nums[nums.length - 1];
  return d.length >= 4 ? d.slice(-4) : '';
}

/**
 * OCBC sends alerts and marketing from the same address, so only emails that look like a payment are kept.
 * The card purchase format is a guess until a real 90°N alert has been seen; one that doesn't match lands in Unparsed.
 */
function parseOcbc_(subject, t) {
  if (/e-?Statement|credit limit|birthday/i.test(subject)) return { kind: 'ignore', reason: 'not a payment' };
  var ref = pick_(t, /Reference number\s*:\s*(\S+)/i);
  var m = new RegExp('Amount\\s*:\\s*' + AMT_, 'i').exec(t);

  if (m && /A deposit was made/i.test(t)) {
    return {
      kind: 'txn', bank: 'OCBC', direction: 'in', amount: num_(m[1]), accountType: 'bank',
      last4: lastDigits4_(pick_(t, /deposited in\s*:\s*(\S+)/i)),
      counterparty: pick_(t, /Reference\s*:\s*(?:from\s+)?(.+?)(?:\s+For assistance|\s+Thank you|$)/i),
      counterLast4: '', ref: '', channel: 'Deposit'
    };
  }
  if (m && /PayNow transfer has been made/i.test(t)) {
    return {
      kind: 'txn', bank: 'OCBC', direction: 'out', amount: num_(m[1]), accountType: 'bank',
      last4: lastDigits4_(pick_(t, /From your account\s*:\s*(.+?)\s+(?:Description|Reference number|If you have)/i)),
      counterparty: pick_(t, /has been made to\s+(.+?)\s+using/i), counterLast4: '', ref: ref, channel: 'PayNow'
    };
  }
  if (m && /following transfer/i.test(t)) {
    var toS = pick_(t, /To account\s*:\s*(.+?)\s+Reference number/i);
    return {
      kind: 'txn', bank: 'OCBC', direction: 'out', amount: num_(m[1]), accountType: 'bank',
      last4: lastDigits4_(pick_(t, /From your account\s*:\s*(.+?)\s+To account/i)),
      counterparty: toS.replace(/\s*\(-?\d+\)/, '').replace(/\s+/g, ' ').trim(),
      counterLast4: lastDigits4_(pick_(toS, /(\(-?\d+\))/)), ref: ref, channel: 'Transfer'
    };
  }
  var card = new RegExp(AMT_ + '.{0,80}?card\\s+(?:ending|no\\.?)\\s*(?:in\\s*|with\\s*)?[x*]*\\s*(\\d{4})', 'i').exec(t);
  if (card) {
    return {
      kind: 'txn', bank: 'OCBC', direction: 'out', amount: num_(card[1]), accountType: 'card', last4: card[2],
      counterparty: pick_(t.slice(card.index), /\bat\s+(.+?)(?:\s+on\s+\d|\.\s|\.$|\s+If\b|$)/i), counterLast4: '', ref: '', channel: 'Card'
    };
  }
  if (/(Amount\s*:|transaction of)\s*(?:SGD|S\$|\$)/i.test(t)) return { kind: 'unknown' };
  return { kind: 'ignore', reason: 'not a payment' };
}

/* ---------- classification ---------- */

/** Sheets turns 0001 into 1, so short numbers get their zeros back before comparing. */
function last4Key_(v) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  return /^\d{1,3}$/.test(s) ? ('0000' + s).slice(-4) : s;
}

function findAccount_(accounts, bank, last4, type) {
  if (!last4) return null;
  for (var i = 0; i < accounts.length; i++) {
    var a = accounts[i];
    if (last4Key_(a.last4) === last4Key_(last4) && (!bank || a.bank === bank) && (!type || a.type === type)) return a;
  }
  return null;
}

/** Banks sometimes mask a name, like "JAXE TAX": an x in the name stands for any letter. */
function maskedMatch_(n, o) {
  for (var start = 0; start + o.length <= n.length; start++) {
    var ok = true;
    for (var k = 0; k < o.length && ok; k++) {
      var c = n.charAt(start + k);
      ok = c === o.charAt(k) || (c === 'x' && /[a-z]/.test(o.charAt(k)));
    }
    if (ok) return true;
  }
  return false;
}

function isOwnName_(name, ownNames) {
  var n = String(name || '').toLowerCase().replace(/\s+/g, ' ');
  if (!n) return false;
  for (var i = 0; i < ownNames.length; i++) {
    var o = String(ownNames[i] || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (o && (n.indexOf(o) >= 0 || (n.indexOf('x') >= 0 && maskedMatch_(n, o)))) return true;
  }
  return false;
}

function tidyName_(raw) {
  var s = String(raw || '').replace(/[\s\-*]+$/, '').replace(/\s+/g, ' ').trim();
  if (s && s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s\/(])([a-z])/g, function (_, a, b) { return a + b.toUpperCase(); });
  }
  return s;
}

/** Rule pattern: plain text (case-insensitive, contained in the merchant) or "re:<regex>". First match wins. */
function matchRule_(raw, rules) {
  var s = String(raw || '');
  for (var i = 0; i < rules.length; i++) {
    var p = String(rules[i].pattern || '').trim();
    if (!p) continue;
    var hit = false;
    if (p.slice(0, 3) === 're:') {
      try { hit = new RegExp(p.slice(3), 'i').test(s); } catch (e) { hit = false; }
    } else {
      hit = s.toLowerCase().indexOf(p.toLowerCase()) >= 0;
    }
    if (hit) return rules[i];
  }
  return null;
}

/**
 * ctx = { accounts: [{id, name, type, bank, last4}], ownNames: [...], rules: [{pattern, name, category, tag}],
 *         defaultCategory, defaultTransferCategory }
 * Returns a Transactions row (without id, datetime, note, createdAt).
 * direction values: out | in | refund | transfer | transfer_in | card_payment
 * status values: ok | guess (default category, fix when convenient) | review (a number would be wrong) | dup
 */
function buildRow_(p, ctx) {
  var acct = findAccount_(ctx.accounts, p.bank, p.last4, p.accountType);
  var row = {
    direction: p.direction, amount: p.amount, account: acct ? acct.id : '', toAccount: '',
    merchantRaw: p.counterparty || '', merchant: '', category: '', tag: '',
    bank: p.bank, ref: p.ref || '', channel: p.channel || '', status: 'ok', note: p.note || ''
  };
  var own = isOwnName_(p.counterparty, ctx.ownNames);
  var dest = p.counterLast4 ? findAccount_(ctx.accounts, null, p.counterLast4, null) : null;

  if (p.direction === 'card_payment') {
    row.toAccount = dest ? dest.id : '';
    row.merchant = 'Card payment'; row.category = 'Transfer';
    if (!row.toAccount) row.status = 'review';
  } else if (p.direction === 'out' && (dest || own || p.ownTransfer)) {
    row.direction = 'transfer';
    row.toAccount = dest ? dest.id : '';
    row.merchant = dest ? 'Transfer to ' + dest.name : 'Transfer to self';
    row.category = 'Transfer';
    if (!row.toAccount) row.status = 'review';
  } else if (p.direction === 'in' && own) {
    row.direction = 'transfer_in';
    row.merchant = 'Transfer in'; row.category = 'Transfer';
  } else {
    var r = matchRule_(row.merchantRaw, ctx.rules);
    if (r) {
      row.merchant = r.name || tidyName_(row.merchantRaw);
      row.category = r.category || ''; row.tag = r.tag || '';
    } else {
      row.merchant = tidyName_(row.merchantRaw);
      if (p.direction === 'in') {
        row.category = 'Income';
      } else {
        var purchase = p.channel === 'Card' || p.channel === 'NETS' || p.channel === 'PayNow';
        row.category = purchase ? (ctx.defaultCategory || 'Dining') : (ctx.defaultTransferCategory || 'Other');
        row.status = 'guess';
      }
    }
  }
  if (!acct || p.amount === '') row.status = 'review';
  if (p.direction === 'in' && !p.counterparty) row.status = 'review';
  return row;
}
