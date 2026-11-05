/* Sample data for trying the app without a backend. Used only when the token is "demo". All names and amounts are made up. */
(function () {
  var accounts = [
    { id: 'dbs-savings', name: 'DBS Savings', type: 'bank', bank: 'DBS', balance: 12480.55 },
    { id: 'uob-account', name: 'UOB Account', type: 'bank', bank: 'UOB', balance: 3120.1 },
    { id: 'uob-card', name: 'UOB Card', type: 'card', bank: 'UOB', balance: -412.36, sinceLastPayment: 412.36 },
    { id: 'ocbc-360', name: 'OCBC 360', type: 'bank', bank: 'OCBC', balance: 8200 },
    { id: 'ocbc-card', name: 'OCBC Card', type: 'card', bank: 'OCBC', balance: -88.4, sinceLastPayment: 88.4 }
  ];
  var tx = [
    { id: 't1', datetime: '2026-10-27T09:14:00', direction: 'out', amount: 44.82, account: 'uob-card', merchantRaw: 'SHENG SIONG SUPERMARKET -', merchant: 'Sheng Siong', category: 'Groceries', tag: 'supermarket', bank: 'UOB', status: 'ok' },
    { id: 't2', datetime: '2026-10-27T12:20:00', direction: 'out', amount: 9.4, account: 'dbs-savings', merchantRaw: 'KOPI CORNER PTE. LTD.', merchant: 'Kopi Corner Pte. Ltd.', category: 'Dining', tag: '', bank: 'DBS', status: 'guess' },
    { id: 't3', datetime: '2026-10-26T18:05:00', direction: 'out', amount: 3.5, account: 'uob-card', merchantRaw: 'BUS/MRT', merchant: 'Public transport', category: 'Transport', tag: 'commute', bank: 'UOB', status: 'ok' },
    { id: 't4', datetime: '2026-10-26T12:40:00', direction: 'out', amount: '', account: 'uob-card', merchantRaw: 'AMAZON.CO.JP', merchant: 'Amazon Japan', category: 'Shopping', tag: 'online', bank: 'UOB', status: 'review', note: 'JPY 5900.00 (enter the SGD amount from your statement)' },
    { id: 't5', datetime: '2026-10-25T10:00:00', direction: 'out', amount: 560, account: 'dbs-savings', merchantRaw: 'a relative', merchant: 'A Relative', category: 'Other', tag: '', bank: 'DBS', status: 'guess' },
    { id: 't6', datetime: '2026-10-24T20:11:00', direction: 'out', amount: 16, account: 'uob-card', merchantRaw: 'GV FUNAN', merchant: 'Golden Village', category: 'Entertainment', tag: 'movies', bank: 'UOB', status: 'ok' },
    { id: 't7', datetime: '2026-10-22T21:31:00', direction: 'card_payment', amount: 1593.82, account: 'uob-account', toAccount: 'uob-card', merchantRaw: 'UOB Card', merchant: 'Card payment', category: 'Transfer', bank: 'UOB', status: 'ok' },
    { id: 't8', datetime: '2026-09-28T19:00:00', direction: 'out', amount: 21.5, account: 'uob-card', merchantRaw: 'NOODLE HOUSE', merchant: 'Noodle House', category: 'Dining', tag: 'hawker', bank: 'UOB', status: 'ok' }
  ];
  function dayFrom(n) {
    var d = new Date(Date.now() + n * 86400000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var vouchers = [
    { id: 'v-1', name: 'Supermarket gift card', amountLeft: 20, expires: dayFrom(5), note: 'Code 0012', status: 'active' },
    { id: 'v-2', name: 'Cafe voucher', amountLeft: 7.5, expires: dayFrom(21), note: '', status: 'active' },
    { id: 'v-3', name: 'Bookshop', amountLeft: 50, expires: dayFrom(120), note: '', status: 'active' },
    { id: 'v-4', name: 'Hair salon', amountLeft: 30, expires: '', note: 'No expiry', status: 'active' },
    { id: 'v-5', name: 'Old cinema voucher', amountLeft: 12, expires: dayFrom(-10), note: '', status: 'active' },
    { id: 'v-6', name: 'Finished voucher', amountLeft: 0, expires: dayFrom(40), note: '', status: 'used' }
  ];
  var categories = ['Dining', 'Groceries', 'Transport', 'Shopping', 'Baby', 'Health', 'Bills', 'Subscriptions', 'Entertainment', 'Household', 'Personal care', 'Other'];
  var MONTH = '2026-10';
  var version = 1;

  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function delay(v) { return new Promise(function (r) { setTimeout(function () { r(copy(v)); }, 150); }); }
  function newest(x, y) { return x.datetime < y.datetime ? 1 : -1; }
  function round(n) { return Math.round(n * 100) / 100; }
  function withEffects(r) {
    var o = copy(r), amt = r.amount === '' ? 0 : r.amount;
    o.effects = [];
    if (r.direction === 'out') o.effects.push({ account: r.account, delta: -amt });
    else if (r.direction === 'in' || r.direction === 'refund' || r.direction === 'adjust') o.effects.push({ account: r.account, delta: amt });
    else if (r.direction === 'transfer' || r.direction === 'card_payment') {
      o.effects.push({ account: r.account, delta: -amt });
      if (r.toAccount) o.effects.push({ account: r.toAccount, delta: amt });
    }
    return o;
  }
  function snapshot() {
    var cats = {}, total = 0;
    tx.forEach(function (r) {
      if (r.direction === 'out' && r.amount !== '' && r.datetime.slice(0, 7) === MONTH) {
        total += r.amount; cats[r.category] = (cats[r.category] || 0) + r.amount;
      }
    });
    var money = 0, owed = 0;
    accounts.forEach(function (a) { if (a.type === 'card') owed -= a.balance; else money += a.balance; });
    var sorted = tx.slice().sort(newest);
    var recent = sorted.slice(0, 8).map(function (r) { return r.id; });
    return {
      version: String(version) + '|' + MONTH,
      balances: { accounts: accounts, totalMoney: round(money), cardOwed: round(owed) },
      month: {
        month: MONTH, total: round(total), count: tx.length,
        byCategory: Object.keys(cats).map(function (k) { return { name: k, total: round(cats[k]) }; }).sort(function (x, y) { return y.total - x.total; }),
        byTag: [{ name: 'supermarket', total: 44.82 }, { name: 'commute', total: 3.5 }]
      },
      months: [MONTH, '2026-09'], banksSeen: ['DBS', 'UOB'], lastAlertAt: '2026-10-27T12:21:00', categories: categories,
      rows: sorted.filter(function (r) { return r.datetime.slice(0, 7) === MONTH || r.status === 'review' || r.status === 'guess' || recent.indexOf(r.id) >= 0; }).map(withEffects),
      recentIds: recent,
      vouchers: vouchers,
      voucherWarnDays: 30
    };
  }
  function done(extra) {
    version++;
    extra.snapshot = snapshot();
    return delay(extra);
  }

  window.MockApi = function (req) {
    window.__mockCalls = (window.__mockCalls || 0) + 1;
    var a = req.action;
    if (window.__failNext) { window.__failNext = false; return Promise.reject(new Error('no connection')); }
    if (a === 'sync') {
      if (!req.force && req.version === String(version) + '|' + MONTH) return delay({ unchanged: true });
      return delay(snapshot());
    }
    if (a === 'list') {
      return delay({ month: req.month, rows: tx.filter(function (r) { return r.datetime.slice(0, 7) === req.month; }).sort(newest).map(withEffects) });
    }
    if (a === 'setCategory') {
      var r = tx.filter(function (x) { return x.id === req.id; })[0];
      ['category', 'tag', 'merchant', 'amount', 'account', 'toAccount', 'direction'].forEach(function (k) { if (req[k] !== undefined) r[k] = req[k]; });
      r.status = 'ok';
      return done({ id: r.id, status: 'ok', ruleAdded: !!req.applyToMerchant });
    }
    if (a === 'addManual') {
      var id = 'm-' + Date.now();
      tx.unshift({ id: id, datetime: (req.date || '2026-10-27') + 'T12:00:00', direction: req.direction || 'out', amount: Number(req.amount), account: req.account, merchantRaw: req.merchant, merchant: req.merchant, category: req.category, tag: req.tag || '', bank: 'manual', status: 'ok' });
      accounts.forEach(function (x) { if (x.id === req.account) x.balance = round(x.balance + (req.direction === 'in' ? 1 : -1) * Number(req.amount)); });
      return done({ id: id });
    }
    if (a === 'setBalance') {
      var ac = accounts.filter(function (x) { return x.id === req.account; })[0];
      ac.balance = Number(req.actual);
      if (ac.type === 'card') ac.sinceLastPayment = Math.max(0, -ac.balance);
      return done({ change: 0, balance: ac.balance });
    }
    if (a === 'voucherSave') {
      var v = vouchers.filter(function (x) { return x.id === req.id; })[0];
      if (!v) { v = { id: req.id }; vouchers.push(v); }
      v.name = req.name; v.amountLeft = req.amountLeft; v.expires = req.expires; v.note = req.note;
      v.status = req.amountLeft === 0 ? 'used' : 'active';
      return done({ id: req.id });
    }
    if (a === 'voucherUse') {
      var u = vouchers.filter(function (x) { return x.id === req.id; })[0];
      u.amountLeft = round(u.amountLeft - req.amount);
      u.status = u.amountLeft === 0 ? 'used' : 'active';
      return done({ id: req.id, amountLeft: u.amountLeft });
    }
    if (a === 'voucherDelete') { vouchers = vouchers.filter(function (x) { return x.id !== req.id; }); return done({ id: req.id }); }
    if (a === 'deleteRow') { tx = tx.filter(function (x) { return x.id !== req.id; }); return done({ id: req.id }); }
    return Promise.reject(new Error('unknown action'));
  };
})();
