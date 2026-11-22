/**
 * Monthly bank bonus goals: how far this month's transactions go towards each row of the Goals tab.
 * Pure (no Apps Script services), so it is tested in tests/run.html. Uses Ledger.gs.
 *
 * Goal kinds:
 * - spend: purchases minus refunds on `account` this calendar month, leaving out merchants that contain
 *   any of the comma-separated `exclude` words. Met at `target` dollars and `minCount` purchases.
 * - incoming: money arriving in `account` this month (deposits and transfers in; refunds and balance
 *   corrections do not count). Met at `target`.
 * - balance_increase: this month's average daily balance of `account` at least `target` above last
 *   month's. The bank uses value dates, so this is the app's estimate.
 */

var GOAL_KINDS_ = ['spend', 'incoming', 'balance_increase'];

/** The goals set up for the user's accounts the first time. Edit them in the Goals tab. */
var SEED_GOALS = [
  ['uob-salary', 'UOB One Account: salary in', 'incoming', 'uob-account', 1600, '', '', 'yes'],
  ['uob-card', 'UOB One Card spend', 'spend', 'uob-card', 1000, 10, '', 'yes'],
  ['ocbc-save', 'OCBC 360: average balance up', 'balance_increase', 'ocbc-360', 500, '', '', 'yes'],
  ['ocbc-card', 'OCBC 90°N card spend', 'spend', 'ocbc-90n', 500, '', 'parking, carpark, car park, AXS, insurance, tax, top-up, topup', 'yes'],
  ['dbs-salary', 'DBS Multiplier: salary in', 'incoming', 'dbs-multiplier', 3000, '', '', 'yes'],
  ['dbs-paylah', 'DBS Multiplier: PayLah! spend', 'spend', 'paylah', 0, 1, '', 'yes']
];

function goalDay_(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
function daysInMonth_(month) { var p = month.split('-').map(Number); return new Date(Date.UTC(p[0], p[1], 0)).getUTCDate(); }
function prevMonth_(month) {
  var p = month.split('-').map(Number);
  return p[1] === 1 ? (p[0] - 1) + '-12' : p[0] + '-' + String(p[1] - 1).padStart(2, '0');
}

/** Words from the exclude column, lower case. */
function excludeWords_(s) {
  return String(s || '').split(',').map(function (w) { return w.trim().toLowerCase(); }).filter(Boolean);
}

function isExcluded_(r, words) {
  var text = (String(r.merchantRaw || '') + ' ' + String(r.merchant || '')).toLowerCase();
  return words.some(function (w) { return text.indexOf(w) >= 0; });
}

/**
 * End-of-day balance of one account for each day of `month`, up to and including `lastDay` (YYYY-MM-DD).
 * Starts from openingBalance plus every row before the month.
 */
function dailyBalances_(account, rows, month, lastDay) {
  var bal = Number(account.openingBalance) || 0, byDay = {};
  var first = month + '-01';
  rows.forEach(function (r) {
    var d = deltaFor_(r, account.id);
    if (!d) return;
    var day = String(r.datetime || '').slice(0, 10);
    if (day < first) bal += d;
    else if (day.slice(0, 7) === month) byDay[day] = (byDay[day] || 0) + d;
  });
  var out = [], n = daysInMonth_(month);
  for (var i = 1; i <= n; i++) {
    var day = goalDay_(month.slice(0, 4), Number(month.slice(5, 7)), i);
    if (lastDay && day > lastDay) break;
    bal += byDay[day] || 0;
    out.push(cents_(bal));
  }
  return out;
}

function average_(list) {
  if (!list.length) return 0;
  return cents_(list.reduce(function (a, b) { return a + b; }, 0) / list.length);
}

/**
 * Progress of each active goal for the month of `today` (YYYY-MM-DD).
 * goals: rows of the Goals tab. Returns [{id, label, kind, account, accountName, target, minCount, value, count, met, ...}].
 * A goal whose account is not in the Accounts tab comes back with problem set.
 */
function goalProgress_(goals, accounts, rows, today) {
  var month = today.slice(0, 7);
  var byId = {};
  accounts.forEach(function (a) { byId[a.id] = a; });
  var thisMonth = rows.filter(function (r) { return r.status !== 'dup' && String(r.datetime || '').slice(0, 7) === month; });

  return goals.filter(function (g) {
    return g.id && String(g.active || 'yes').toLowerCase() !== 'no' && GOAL_KINDS_.indexOf(String(g.kind)) >= 0;
  }).map(function (g) {
    var acct = byId[String(g.account)];
    var o = {
      id: String(g.id), label: String(g.label || g.id), kind: String(g.kind), account: String(g.account),
      accountName: acct ? acct.name : '', target: Number(g.target) || 0, minCount: Number(g.minCount) || 0,
      value: 0, count: 0, met: false
    };
    if (!acct) { o.problem = 'No account "' + o.account + '" in the Accounts tab. Add it there, or change the account in the Goals tab.'; return o; }

    if (o.kind === 'spend') {
      var words = excludeWords_(g.exclude), excluded = 0;
      thisMonth.forEach(function (r) {
        if (r.account !== acct.id) return;
        if (r.direction !== 'out' && r.direction !== 'refund') return;
        if (isExcluded_(r, words)) { if (r.direction === 'out') excluded += amountOf_(r); return; }
        if (r.direction === 'out') { o.value += amountOf_(r); o.count++; } else o.value -= amountOf_(r);
      });
      o.value = cents_(o.value); o.excluded = cents_(excluded);
      o.met = o.value >= o.target && o.count >= Math.max(o.minCount, o.target > 0 ? 0 : 1);
    } else if (o.kind === 'incoming') {
      thisMonth.forEach(function (r) {
        if (r.direction !== 'in' && r.direction !== 'transfer_in' && r.direction !== 'transfer' && r.direction !== 'card_payment') return;
        var d = deltaFor_(r, acct.id);
        if (d > 0) { o.value += d; o.count++; }
      });
      o.value = cents_(o.value);
      o.met = o.value >= o.target && o.count > 0;
    } else {
      var n = daysInMonth_(month), sofar = dailyBalances_(acct, rows, month, today);
      var lastMonth = average_(dailyBalances_(acct, rows, prevMonth_(month)));
      var now = sofar.length ? sofar[sofar.length - 1] : 0, left = n - sofar.length;
      var sum = sofar.reduce(function (a, b) { return a + b; }, 0);
      o.lastMonthAverage = lastMonth;
      o.needAverage = cents_(lastMonth + o.target);
      o.averageSoFar = average_(sofar);
      o.projectedAverage = cents_((sum + now * left) / n);
      o.value = cents_(o.projectedAverage - lastMonth);
      o.met = o.projectedAverage >= o.needAverage;
      // Added today, money counts for today and every day left (today's balance is already in `sum`).
      o.addNow = o.met ? 0 : cents_(Math.ceil(((o.needAverage * n - sum - now * left) / (left + 1)) * 100) / 100);
      o.daysLeft = left;
    }
    return o;
  });
}
