/**
 * Pure balance and summary calculations over Transactions rows.
 * No Apps Script services are used, so this file is tested in tests/run.html.
 *
 * Row fields used: datetime (ISO string), direction, amount, account, toAccount, category, tag, status.
 * Directions: out | in | refund | transfer | transfer_in | card_payment | adjust (signed amount).
 * A card's balance is negative when money is owed.
 */

function cents_(n) { return Math.round(n * 100) / 100; }

function amountOf_(r) {
  if (r.amount === '' || r.amount === null || r.amount === undefined) return 0;
  var n = Number(r.amount);
  return isFinite(n) ? n : 0;
}

/** What one row does to account balances: [{account, delta}]. Duplicates do nothing. */
function rowEffects_(r) {
  if (r.status === 'dup') return [];
  var amt = amountOf_(r), d = r.direction, out = [];
  function add(acct, delta) { if (acct) out.push({ account: acct, delta: delta }); }
  if (d === 'out') add(r.account, -amt);
  else if (d === 'in' || d === 'refund' || d === 'transfer_in' || d === 'adjust') add(r.account, amt);
  else if (d === 'transfer' || d === 'card_payment') { add(r.account, -amt); add(r.toAccount, amt); }
  return out;
}

/** How much one row changes a single account's balance (0 for a duplicate or an unrelated account). */
function deltaFor_(r, accountId) {
  var sum = 0;
  rowEffects_(r).forEach(function (e) { if (e.account === accountId) sum += e.delta; });
  return cents_(sum);
}

/**
 * Balance of every account, plus totals.
 * Returns { accounts: [{id, name, type, bank, balance, sinceLastPayment?}], totalMoney, cardOwed }.
 */
function balances_(accounts, rows) {
  var bal = {};
  accounts.forEach(function (a) { bal[a.id] = Number(a.openingBalance) || 0; });
  rows.forEach(function (r) {
    rowEffects_(r).forEach(function (e) { if (e.account in bal) bal[e.account] += e.delta; });
  });
  var totalMoney = 0, cardOwed = 0;
  var list = accounts.map(function (a) {
    var b = cents_(bal[a.id]);
    var o = { id: a.id, name: a.name, type: a.type, bank: a.bank, balance: b };
    if (a.type === 'card') {
      cardOwed += -b;
      o.sinceLastPayment = cardSinceLastPayment_(rows, a.id);
    } else {
      totalMoney += b;
    }
    return o;
  });
  return { accounts: list, totalMoney: cents_(totalMoney), cardOwed: cents_(cardOwed) };
}

/** Net card spending after the most recent payment to this card. */
function cardSinceLastPayment_(rows, cardId) {
  var last = '';
  rows.forEach(function (r) {
    if (r.status !== 'dup' && r.direction === 'card_payment' && r.toAccount === cardId && String(r.datetime) > last) last = String(r.datetime);
  });
  var sum = 0;
  rows.forEach(function (r) {
    if (r.status === 'dup' || r.account !== cardId || String(r.datetime) <= last) return;
    if (r.direction === 'out') sum += amountOf_(r);
    else if (r.direction === 'refund') sum -= amountOf_(r);
  });
  return cents_(sum);
}

function monthOf_(r) { return String(r.datetime || '').slice(0, 7); }

/** Spending in one month ('YYYY-MM'): purchases minus refunds. Transfers, card payments and adjustments are not spending. */
function monthSummary_(rows, month) {
  var total = 0, count = 0, cat = {}, tag = {}, review = 0;
  rows.forEach(function (r) {
    if (r.status === 'review') review++;
    if (r.status === 'dup' || monthOf_(r) !== month) return;
    var sign = r.direction === 'out' ? 1 : r.direction === 'refund' ? -1 : 0;
    if (!sign) return;
    var amt = sign * amountOf_(r);
    total += amt; count++;
    var c = r.category || 'Uncategorised';
    cat[c] = (cat[c] || 0) + amt;
    if (r.tag) tag[r.tag] = (tag[r.tag] || 0) + amt;
  });
  function sorted(o) {
    return Object.keys(o).map(function (k) { return { name: k, total: cents_(o[k]) }; })
      .sort(function (a, b) { return b.total - a.total; });
  }
  return { month: month, total: cents_(total), count: count, byCategory: sorted(cat), byTag: sorted(tag), reviewCount: review };
}
