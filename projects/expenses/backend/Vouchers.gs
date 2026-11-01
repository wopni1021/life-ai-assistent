/**
 * Vouchers: how much is left on each one and when it expires. Kept in the Vouchers tab.
 * useVoucher_ is pure and tested in tests/run.html. Vouchers are not part of Total money.
 */

var DEFAULT_VOUCHER_WARN_DAYS = 30;

/** The voucher after spending amount from it. Throws when the amount doesn't make sense. */
function useVoucher_(voucher, amount) {
  var spent = cents_(Number(amount)), left = cents_(Number(voucher.amountLeft));
  if (!isFinite(spent) || spent <= 0) throw new Error('enter an amount above 0');
  if (spent > left) throw new Error('that is more than what is left');
  var rest = cents_(left - spent);
  return { amountLeft: rest, status: rest === 0 ? 'used' : 'active' };
}

/** Name and note stay plain text, so a code like 0012 keeps its zeros. */
function vouchersSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Vouchers');
  if (sh) return sh;
  sh = ss.insertSheet('Vouchers');
  var head = TABS.Vouchers;
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  sh.setFrozenRows(1);
  ['name', 'note'].forEach(function (k) {
    sh.getRange(1, head.indexOf(k) + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  });
  return sh;
}

function loadVouchers_() {
  var zone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return rows_('Vouchers').filter(function (v) { return v.id; }).map(function (v) {
    return {
      id: String(v.id), name: String(v.name), amountLeft: Number(v.amountLeft) || 0,
      expires: v.expires instanceof Date ? Utilities.formatDate(v.expires, zone, 'yyyy-MM-dd') : String(v.expires || ''),
      note: String(v.note || ''), status: v.status === 'used' ? 'used' : 'active'
    };
  });
}

function voucherWarnDays_() {
  var days = DEFAULT_VOUCHER_WARN_DAYS;
  rows_('Settings').forEach(function (r) {
    if (r.key === 'voucherWarnDays' && Number(r.value) > 0) days = Number(r.value);
  });
  return days;
}

function findVoucherRow_(sh, id) {
  var n = sh.getLastRow();
  if (n < 2) return 0;
  var ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

/** Adds a voucher, or edits it when the id already exists. The app makes the id. */
function voucherSave_(req) {
  var name = text_(req.name, 80), amount = cents_(Number(req.amountLeft)), expires = String(req.expires || '');
  if (!/^v-[0-9]+$/.test(String(req.id))) throw new Error('bad voucher id');
  if (!name) throw new Error('enter a name');
  if (!isFinite(amount) || amount < 0) throw new Error('enter the amount left');
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) throw new Error('bad expiry date');
  var sh = vouchersSheet_();
  var row = findVoucherRow_(sh, req.id);
  var created = row ? sh.getRange(row, TABS.Vouchers.indexOf('createdAt') + 1).getValue() : new Date();
  var rec = {
    id: req.id, name: name, amountLeft: amount, expires: expires, note: text_(req.note, 200),
    status: amount === 0 ? 'used' : 'active', createdAt: created
  };
  sh.getRange(row || sh.getLastRow() + 1, 1, 1, TABS.Vouchers.length).setValues([TABS.Vouchers.map(function (h) { return rec[h]; })]);
  return { id: req.id };
}

function voucherUse_(req) {
  var sh = vouchersSheet_();
  var row = findVoucherRow_(sh, req.id);
  if (!row) throw new Error('voucher not found');
  var col = TABS.Vouchers.indexOf('amountLeft') + 1;
  var next = useVoucher_({ amountLeft: sh.getRange(row, col).getValue() }, req.amount);
  sh.getRange(row, col).setValue(next.amountLeft);
  sh.getRange(row, TABS.Vouchers.indexOf('status') + 1).setValue(next.status);
  return { id: req.id, amountLeft: next.amountLeft };
}

function voucherDelete_(req) {
  var sh = vouchersSheet_();
  var row = findVoucherRow_(sh, req.id);
  if (row) sh.deleteRow(row);
  return { id: req.id };
}
