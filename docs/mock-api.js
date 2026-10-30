/* Sample data for trying the app without a backend. Used only when the token is "demo". All names and amounts are made up. */
(function () {
  var accounts = [
    { id: 'dbs-savings', name: 'DBS Savings', type: 'bank', bank: 'DBS', balance: 12480.55 },
    { id: 'uob-account', name: 'UOB Account', type: 'bank', bank: 'UOB', balance: 3120.1 },
    { id: 'uob-card', name: 'UOB Card', type: 'card', bank: 'UOB', balance: -412.36, sinceLastPayment: 412.36 }
  ];
  var tx = [
    { id: 't1', datetime: '2026-10-27T09:14:00', direction: 'out', amount: 44.82, account: 'uob-card', merchantRaw: 'SHENG SIONG SUPERMARKET -', merchant: 'Sheng Siong', category: 'Groceries', tag: 'supermarket', bank: 'UOB', status: 'ok' },
    { id: 't2', datetime: '2026-10-27T12:20:00', direction: 'out', amount: 9.4, account: 'dbs-savings', merchantRaw: 'KOPI CORNER PTE. LTD.', merchant: 'Kopi Corner Pte. Ltd.', category: '', tag: '', bank: 'DBS', status: 'review' },
    { id: 't3', datetime: '2026-10-26T18:05:00', direction: 'out', amount: 3.5, account: 'uob-card', merchantRaw: 'BUS/MRT', merchant: 'Public transport', category: 'Transport', tag: 'commute', bank: 'UOB', status: 'ok' },
    { id: 't4', datetime: '2026-10-26T12:40:00', direction: 'out', amount: '', account: 'uob-card', merchantRaw: 'AMAZON.CO.JP', merchant: 'Amazon Japan', category: 'Shopping', tag: 'online', bank: 'UOB', status: 'review', note: 'JPY 5900.00 (enter the SGD amount from your statement)' },
    { id: 't5', datetime: '2026-10-25T10:00:00', direction: 'out', amount: 560, account: 'dbs-savings', merchantRaw: 'a relative', merchant: 'A Relative', category: '', tag: '', bank: 'DBS', status: 'review' },
    { id: 't6', datetime: '2026-10-24T20:11:00', direction: 'out', amount: 16, account: 'uob-card', merchantRaw: 'GV FUNAN', merchant: 'Golden Village', category: 'Entertainment', tag: 'movies', bank: 'UOB', status: 'ok' },
    { id: 't7', datetime: '2026-10-22T21:31:00', direction: 'card_payment', amount: 1593.82, account: 'uob-account', toAccount: 'uob-card', merchantRaw: 'UOB Card', merchant: 'Card payment', category: 'Transfer', bank: 'UOB', status: 'ok' }
  ];
  var categories = ['Dining', 'Groceries', 'Transport', 'Shopping', 'Baby', 'Health', 'Bills', 'Subscriptions', 'Entertainment', 'Household', 'Personal care', 'Other'];

  function delay(v) { return new Promise(function (r) { setTimeout(function () { r(JSON.parse(JSON.stringify(v))); }, 150); }); }
  function acctName(id) { var a = accounts.filter(function (x) { return x.id === id; })[0]; return a ? a.name : ''; }

  window.MockApi = function (req) {
    var a = req.action;
    if (a === 'summary') {
      var cats = {}, total = 0;
      tx.forEach(function (r) { if (r.direction === 'out' && r.amount !== '' && r.datetime.slice(0, 7) === '2026-10') { total += r.amount; var c = r.category || 'Uncategorised'; cats[c] = (cats[c] || 0) + r.amount; } });
      var bank = accounts.filter(function (x) { return x.type === 'bank'; }).reduce(function (s, x) { return s + x.balance; }, 0);
      var owed = accounts.filter(function (x) { return x.type === 'card'; }).reduce(function (s, x) { return s - x.balance; }, 0);
      return delay({
        balances: { accounts: accounts, totalMoney: Math.round(bank * 100) / 100, cardOwed: Math.round(owed * 100) / 100 },
        month: {
          month: '2026-10', total: Math.round(total * 100) / 100, count: tx.length,
          byCategory: Object.keys(cats).map(function (k) { return { name: k, total: cats[k] }; }).sort(function (x, y) { return y.total - x.total; }),
          byTag: [{ name: 'supermarket', total: 44.82 }, { name: 'commute', total: 3.5 }],
          reviewCount: tx.filter(function (r) { return r.status === 'review'; }).length
        },
        banksSeen: ['DBS', 'UOB'], lastAlertAt: '2026-10-27T12:21:00', categories: categories
      });
    }
    if (a === 'list') {
      var q = String(req.query || '').toLowerCase();
      var rows = tx.filter(function (r) { return r.datetime.slice(0, 7) === (req.month || '2026-10') && (!q || (r.merchant + ' ' + r.merchantRaw + ' ' + r.category).toLowerCase().indexOf(q) >= 0); })
        .sort(function (x, y) { return x.datetime < y.datetime ? 1 : -1; });
      return delay({ month: req.month || '2026-10', months: ['2026-10', '2026-09'], rows: rows });
    }
    if (a === 'reviewQueue') {
      return delay({
        rows: tx.filter(function (r) { return r.status === 'review'; }), categories: categories,
        accounts: accounts.map(function (x) { return { id: x.id, name: x.name, type: x.type }; })
      });
    }
    if (a === 'setCategory') {
      var r = tx.filter(function (x) { return x.id === req.id; })[0];
      ['category', 'tag', 'merchant', 'amount', 'account', 'toAccount', 'direction'].forEach(function (k) { if (req[k] !== undefined) r[k] = req[k]; });
      r.status = 'ok';
      return delay({ id: r.id, status: 'ok', ruleAdded: !!req.applyToMerchant });
    }
    if (a === 'addManual') {
      tx.unshift({ id: 'm-' + Date.now(), datetime: (req.date || '2026-10-27') + 'T12:00:00', direction: req.direction || 'out', amount: Number(req.amount), account: req.account, merchantRaw: req.merchant, merchant: req.merchant, category: req.category, tag: req.tag || '', bank: 'manual', status: 'ok' });
      return delay({ id: tx[0].id });
    }
    if (a === 'setBalance') {
      var ac = accounts.filter(function (x) { return x.id === req.account; })[0];
      ac.balance = Number(req.actual);
      if (ac.type === 'card') ac.sinceLastPayment = Math.max(0, -ac.balance);
      return delay({ change: 0, balance: ac.balance });
    }
    if (a === 'deleteRow') { tx = tx.filter(function (x) { return x.id !== req.id; }); return delay({ id: req.id }); }
    return Promise.reject(new Error('unknown action'));
  };
  window.MockApi.acctName = acctName;
})();
