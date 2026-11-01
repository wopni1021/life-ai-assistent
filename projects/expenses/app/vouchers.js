/* Voucher dates. Worked out on the phone from today's date, so a warning needs no update from the server. Tested in backend/tests/run.html. */
var VOUCHER_URGENT_DAYS = 7;

/** level is expired, urgent, soon or ok. daysLeft is null when there is no expiry date. */
function voucherUrgency(expires, today, warnDays) {
  var end = Date.parse(String(expires || '') + 'T00:00:00Z'), now = Date.parse(today + 'T00:00:00Z');
  if (!isFinite(end)) return { level: 'ok', daysLeft: null };
  var days = Math.round((end - now) / 86400000);
  var level = days < 0 ? 'expired' : days <= VOUCHER_URGENT_DAYS ? 'urgent' : days <= warnDays ? 'soon' : 'ok';
  return { level: level, daysLeft: days };
}

function voucherDueText(daysLeft) {
  if (daysLeft === null) return 'No expiry';
  if (daysLeft < -1) return 'Expired ' + (-daysLeft) + ' days ago';
  if (daysLeft === -1) return 'Expired yesterday';
  if (daysLeft === 0) return 'Expires today';
  if (daysLeft === 1) return 'Expires tomorrow';
  return 'Expires in ' + daysLeft + ' days';
}
