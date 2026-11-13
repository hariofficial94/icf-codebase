/**
 * WAIVERS + CRE PAYMENT REQUESTS (13 Nov 2026)
 * ---------------------------------------------------------------------
 * 1. WAIVE A BALANCE. Some balances will never be paid: Rs. 20 short from
 *    bank charges, a rounding gap, a small deduction the customer won't pay.
 *    Without a way to waive them, the order shows "payment pending" for ever
 *    (and a vehicle order can't even get its gate pass).
 *      - An ADMIN waives what's left on an order, with a reason, up to the limit
 *        a director sets on the Settings page ("Admin: waive a balance up to").
 *      - Above that limit the admin's waiver goes to the DIRECTORS, who decide it
 *        from the dashboard ("Waiting for a director") like other payment approvals.
 *      - On approval the order's Total Order Value goes down by the waived amount,
 *        so every balance check in the system sees it as settled. Nothing is hidden:
 *        the billed value stays in "Original Order Value", the waiver in its own
 *        columns (Waived Amount / By / At / Reason) and in Remarks, and the request
 *        in the Payment Exceptions tab. The owner dashboard shows the total waived.
 *      - An order held for the money moves on at once: "Ready - Payment Pending"
 *        goes back to Ops as Cleared, a courier "On Hold - Balance Due" goes to Ops.
 *      - TDS is NOT a waiver: that money is still owed until the certificate comes.
 *
 * 2. CRE "PAYMENT REQUESTS" PANE. A CRE's "dispatch without full payment" /
 *    "balance after delivery" request used to vanish from view once sent. The
 *    Requests page now lists every payment request the CRE raised, and every
 *    payment request or waiver on the CRE's own orders: waiting, and decided in
 *    the last 14 days.
 *
 * Server side only here; PX_WAIVE and its label are defined in Code.js with the
 * other request types. Pages: waive_admin.html (Admin page), cre_beta.html.
 */

// [label, default, explanation, min, max] -- the label is what the code looks up; don't rename it.
var WAIVE_SETTINGS_ROWS = [
  ['Admin: waive a balance up to (₹)', '100', 'An admin can waive what’s left to pay on an order, with a reason, up to this amount. Above it, a director must approve. 0 = every waiver goes to a director.', 0, 1000000]
];

function getWaiveLimit_() {
  var map = sbReadSettingsMap_();
  var r = WAIVE_SETTINGS_ROWS[0];
  var raw = map[r[0].toLowerCase()];
  var v = Number(String(raw == null ? '' : raw).replace(/[,\s₹]/g, ''));
  if (raw === undefined || raw === '' || isNaN(v)) v = Number(r[1]);
  return Math.min(r[4], Math.max(r[3], Math.floor(v)));
}

/** Admin page: the limit and the latest waivers. */
function getWaiverAdmin_() {
  var orders = orderSnapshot_();
  var tz = Session.getScriptTimeZone();
  var fmt = function (ms) { return ms ? Utilities.formatDate(new Date(ms), tz, 'dd-MMM, hh:mm a') : ''; };
  var recent = readPaymentExceptions_().filter(function (r) { return r.type === PX_WAIVE; }).reverse().slice(0, 15).map(function (r) {
    var o = orders[r.trackerId.toLowerCase()] || {};
    return { requestId: r.requestId, trackerId: r.trackerId, institution: o.institution || '', amount: r.correctedAdvance || 0,
      reason: r.reason, status: r.status, requestedByName: r.requestedByName, requestedAt: fmt(r.requestedAtMs),
      decidedBy: String(r.decidedBy || '').replace(/ \(.*$/, ''), decidedAt: fmt(r.decidedAtMs) };
  });
  return { limit: getWaiveLimit_(), isDirector: !!(CURRENT_STAFF_ && CURRENT_STAFF_.role === 'Director'), recent: recent };
}

/** Admin: look an order up before waiving. query = tracker ID, phone or name. */
function getWaiveInfo_(query) {
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String(query || '').trim());
  if (row === -1) {
    var found = findOrders_(query);
    if (found.order) row = findRowByTrackerId(sheet, found.order.trackerId);
    else if (found.matches && found.matches.length) {
      return { matches: found.matches.slice(0, 10).map(function (m) { return { trackerId: m.trackerId, institution: m.institution, status: m.status }; }) };
    }
    if (row === -1) throw new Error('No order found. Try the quotation number, phone number or part of the customer name.');
  }
  var f = getRowFields(sheet, row, ['Tracker ID', 'Institution / Customer', 'CRE Name', 'Status', 'Payment Terms Type',
    'Total Order Value', 'Advance Received', 'Delivery Status', 'Waived Amount', 'Original Order Value']);
  var id = String(f['Tracker ID']);
  var balance = computeBalanceDue(f['Total Order Value'], f['Advance Received']);
  var pending = latestPaymentException_(id, PX_WAIVE);
  var limit = getWaiveLimit_();
  var status = String(f['Status'] || '');
  var why = status === 'Cancelled' ? 'This order is cancelled.'
    : status === 'Logged' ? 'Not verified yet – Accounts verifies the payment first.'
    : balance <= 0 ? 'Nothing is due on this order.'
    : (pending && pending.status === 'Pending') ? 'A waiver is already waiting for a director (' + pending.requestId + ').' : '';
  return {
    trackerId: id, institution: String(f['Institution / Customer'] || ''), cre: String(f['CRE Name'] || ''), status: status,
    deliveryStatus: String(f['Delivery Status'] || ''), terms: String(f['Payment Terms Type'] || 'End Customer'),
    total: Number(f['Total Order Value']) || 0, paid: Number(f['Advance Received']) || 0, balance: balance,
    alreadyWaived: Number(f['Waived Amount']) || 0, limit: limit,
    needsDirector: !(CURRENT_STAFF_ && CURRENT_STAFF_.role === 'Director') && balance > limit,
    canWaive: !why, why: why
  };
}

/**
 * Admin (or Director): waive the whole balance left on an order.
 * form = { trackerId, reason, amount (what the screen showed -- must still match) }
 */
function waiveBalance_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  if (!me || (me.role !== 'Admin' && me.role !== 'Director')) throw new Error('Only an admin or a director can waive a balance.');
  var reason = String(form.reason || '').trim();
  if (reason.length < 5) throw new Error('Say why it’s being waived, e.g. "Rs. 20 short – bank charges, customer won’t pay".');
  var sheet = getSheet();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var out;
  try {
    var row = resolveTrackerId(sheet, String(form.trackerId || ''));
    if (row === -1) throw new Error('Order not found.');
    var f = getRowFields(sheet, row, ['Tracker ID', 'Institution / Customer', 'Status', 'Total Order Value', 'Advance Received']);
    var id = String(f['Tracker ID']);
    if (f['Status'] === 'Cancelled') throw new Error('This order is cancelled.');
    if (f['Status'] === 'Logged') throw new Error('Not verified yet – Accounts verifies the payment first.');
    var balance = computeBalanceDue(f['Total Order Value'], f['Advance Received']);
    if (balance <= 0) throw new Error('Nothing is due on this order.');
    if (form.amount !== undefined && form.amount !== '' && Math.abs(Number(form.amount) - balance) > 0.009) {
      throw new Error('The balance has changed to ₹' + formatAmount(balance) + ' (a payment may have come in). Look the order up again.');
    }
    var prev = latestPaymentException_(id, PX_WAIVE);
    if (prev && prev.status === 'Pending') throw new Error('A waiver is already waiting for a director (' + prev.requestId + ').');
    var limit = getWaiveLimit_();
    var direct = me.role === 'Director' || balance <= limit;
    var amountNote = 'Waive ₹' + formatAmount(balance) + ' (order ₹' + formatAmount(f['Total Order Value']) + ', paid ₹' + formatAmount(f['Advance Received']) + ')' +
      (direct ? '' : ' – over the admin limit of ₹' + formatAmount(limit));
    var requestId = 'PE-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd') + '-' + Utilities.getUuid().split('-')[0].slice(0, 4).toUpperCase();
    var now = new Date();
    appendRowText_(getOrCreatePaymentExceptionsSheet_(), [requestId, now, id, PX_WAIVE, me.code, me.name, reason, amountNote,
      direct ? 'Approved' : 'Pending', direct ? me.name + ' (' + me.code + ')' : '', direct ? now : '', balance, '', '', ''], []);
    if (direct) {
      out = waiveApply_(sheet, row, balance, reason, me, requestId);
      out.requestId = requestId; out.waived = true;
    } else {
      out = { trackerId: id, requestId: requestId, waived: false, toDirector: true, amount: balance, limit: limit };
    }
  } finally {
    lock.releaseLock();
  }
  if (out.waived) waiveNotify_(out, reason, me);
  else {
    try {
      var url = appUrl_();
      var html = '<p><b>' + opsEsc_(me.name) + '</b> wants to <b>waive ₹' + formatAmount(out.amount) + '</b> still due on ' + opsEsc_(out.trackerId) +
        '. That is over the admin limit of ₹' + formatAmount(out.limit) + ', so a director decides.</p><p>Reason: ' + opsEsc_(reason) + '</p>' +
        (url ? '<p><a href="' + url + '?page=dashboard-beta">Open the dashboard</a> – it’s under “Waiting for a director”.</p>' : '');
      var dirs = opsStaffOfRole_(getStaffMap_(false), 'Director').map(function (s) { return s.email; }).filter(function (e) { return /@/.test(e); });
      if (dirs.length) MailApp.sendEmail({ to: dirs.join(','), subject: 'Director approval: waive ₹' + formatAmount(out.amount) + ' – ' + out.trackerId, htmlBody: html });
    } catch (e) { Logger.log('waiver -> directors mail failed: ' + e); }
  }
  return out;
}

/** Called by decidePaymentException_ (inside its lock) when a director approves a waiver. */
function waiveApproveFromRequest_(r, me) {
  if (!me || me.role !== 'Director') throw new Error('This waiver is over the admin limit – only a director can approve it. (You can decline it.)');
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, r.trackerId);
  if (row === -1) throw new Error('Order not found.');
  var f = getRowFields(sheet, row, ['Status', 'Total Order Value', 'Advance Received']);
  if (f['Status'] === 'Cancelled') throw new Error('The order has been cancelled since – decline this.');
  var balance = computeBalanceDue(f['Total Order Value'], f['Advance Received']);
  if (balance <= 0) throw new Error('Nothing is due any more (the customer may have paid) – decline this.');
  var amount = Math.min(balance, Number(r.correctedAdvance) || balance); // never more than asked, never more than is left
  var out = waiveApply_(sheet, row, amount, r.reason, me, r.requestId);
  logActivity_(me, 'Waived balance (director)', r.trackerId, '₹' + formatAmount(amount) + ' – ' + r.reason + ' (' + r.requestId + ', asked by ' + r.requestedByName + ')');
  r._waiveOut = out;
  return out;
}

/** Writes the waiver onto the order and moves a held order on. Returns { trackerId, amount, releasedToOps }. */
function waiveApply_(sheet, row, amount, reason, me, requestId) {
  var f = getRowFields(sheet, row, ['Tracker ID', 'Institution / Customer', 'Status', 'Total Order Value', 'Advance Received',
    'Original Order Value', 'Remarks', 'Waived Amount', 'Waive Reason']);
  var total = Number(f['Total Order Value']) || 0;
  var newTotal = Math.round((total - amount) * 100) / 100;
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy');
  var note = 'Balance ₹' + formatAmount(amount) + ' waived by ' + me.name + ' on ' + stamp + ' (' + requestId + '): ' + reason;
  var fields = {
    'Total Order Value': newTotal,
    'Waived Amount': Math.round(((Number(f['Waived Amount']) || 0) + amount) * 100) / 100,
    'Waived By': me.name,
    'Waived At': new Date(),
    'Waive Reason': (f['Waive Reason'] ? f['Waive Reason'] + ' | ' : '') + reason,
    'Remarks': (f['Remarks'] ? f['Remarks'] + ' | ' : '') + note
  };
  if (!(Number(f['Original Order Value']) > 0)) fields['Original Order Value'] = total;
  setRowFields(sheet, row, fields);
  writeAdvancePct_(sheet, row, Number(f['Advance Received']) || 0, newTotal);
  var released = false;
  var status = String(f['Status'] || '');
  if (status === STATUS_HOLD_BALANCE) {
    setRowFields(sheet, row, { 'Status': 'Sent to Ops', 'Sent to Ops Timestamp': new Date() });
    released = true;
  } else if (status === STATUS_READY_PAY && typeof opsReleaseIfCleared_ === 'function') {
    released = opsReleaseIfCleared_(sheet, row, 'Balance of ₹' + formatAmount(amount) + ' waived by ' + me.name);
  }
  return { trackerId: String(f['Tracker ID']), institution: String(f['Institution / Customer'] || ''), amount: amount, releasedToOps: released, statusBefore: status };
}

/** Tell the CRE and Accounts. */
function waiveNotify_(out, reason, me) {
  try {
    var sheet = getSheet();
    var row = findRowByTrackerId(sheet, out.trackerId);
    var cf = getRowFields(sheet, row, ['CRE Code', 'CRE Name']);
    var staffMap = getStaffMap_(false);
    var people = creRecipientsOrFallback_(cf['CRE Code'], cf['CRE Name'], staffMap)
      .concat(opsStaffOfRole_(staffMap, 'Accounts').map(staffRecipient_));
    var text = me.name + ' waived the ₹' + formatAmount(out.amount) + ' still due on ' + out.trackerId + ' (' + out.institution + '). Reason: ' + reason + '. ' +
      'Nothing more to collect on this order.' + (out.releasedToOps ? ' It has gone back to Ops to dispatch.' : '');
    notify_('BALANCE_WAIVED', out.trackerId, people, { subject: 'Balance waived: ' + out.trackerId, text: text, email: true, html: '<p>' + opsEsc_(text) + '</p>' });
  } catch (e) { Logger.log('waiver notice failed: ' + e); }
}

// ================================================================
// CRE: Payment requests pane
// ================================================================
/**
 * Every payment request this CRE raised, and every payment request or waiver
 * on orders this CRE owns or covers (Admin: all). Waiting ones always; decided
 * ones for 14 days.
 */
function getCrePaymentRequests_() {
  var me = CURRENT_STAFF_;
  var scope = creScope_();
  var staffMap = getStaffMap_(false);
  var data = opsReadOrders_();
  var orders = {};
  data.rows.forEach(function (o) {
    orders[String(o.get('Tracker ID')).toLowerCase()] = {
      institution: String(o.get('Institution / Customer') || ''), status: String(o.get('Status') || ''),
      owner: resolveOwnerCode_(o.get('CRE Code'), o.get('CRE Name'), staffMap),
      balance: computeBalanceDue(o.get('Total Order Value'), o.get('Advance Received'))
    };
  });
  var tz = Session.getScriptTimeZone();
  var fmt = function (ms) { return ms ? Utilities.formatDate(new Date(ms), tz, 'dd-MMM, hh:mm a') : ''; };
  var cutoff = Date.now() - 14 * 86400000;
  var items = readPaymentExceptions_().filter(function (r) {
    if (r.status === 'Withdrawn') return false;
    var o = orders[r.trackerId.toLowerCase()];
    if (!o) return false;
    var mine = r.requestedBy === me.code || !scope || !!scope.accessFor(o.owner, r.trackerId);
    if (!mine) return false;
    if (r.status === 'Pending') return true;
    return (r.decidedAtMs || r.requestedAtMs || 0) > cutoff;
  }).map(function (r) {
    var o = orders[r.trackerId.toLowerCase()];
    var who = String(r.decidedBy || '').replace(/ \(.*$/, '');
    var text;
    if (r.status === 'Pending') text = r.type === PX_WAIVE ? 'Waiting for a director' : 'Waiting for the admin';
    else if (r.status === 'Declined') text = 'Declined' + (who ? ' by ' + who : '');
    else if (r.type === PX_WAIVE) text = 'Waived' + (who ? ' by ' + who : '') + ' – nothing more to collect';
    else if (r.type === PX_DISPATCH) text = 'Approved' + (who ? ' by ' + who : '') + (isDispatchedStatus_(o.status) ? ' – dispatched' : ' – it can go without full payment');
    else text = 'Approved' + (who ? ' by ' + who : '');
    var label = r.type === PX_DISPATCH && /^Balance to be paid after delivery/.test(r.reason) ? 'Balance after delivery' : (PX_LABELS[r.type] || r.type);
    return {
      requestId: r.requestId, trackerId: r.trackerId, institution: o.institution, label: label, type: r.type,
      status: r.status, statusText: text, amountNote: r.amountNote,
      reason: String(r.reason || '').replace(/^(Balance to be paid after delivery \(CRE, at intake\)|Goods ready – CRE asks to dispatch without full payment): /, ''),
      requestedByName: r.requestedByName, mine: r.requestedBy === me.code,
      when: fmt(r.status === 'Pending' ? r.requestedAtMs : (r.decidedAtMs || r.requestedAtMs)), whenMs: (r.status === 'Pending' ? r.requestedAtMs : r.decidedAtMs) || 0
    };
  });
  var rank = { Pending: 0, Declined: 1, Approved: 2 };
  items.sort(function (a, b) { return ((rank[a.status] || 9) - (rank[b.status] || 9)) || (b.whenMs - a.whenMs); });
  return { items: items, waiting: items.filter(function (i) { return i.status === 'Pending'; }).length,
           declined: items.filter(function (i) { return i.status === 'Declined'; }).length };
}

// ================================================================
// Wiring
// ================================================================
function waiverApiMap_() {
  return {
    getWaiverAdmin:        { fn: getWaiverAdmin_,        roles: ['Director'] },
    getWaiveInfo:          { fn: getWaiveInfo_,          roles: ['Director'] },
    waiveBalance:          { fn: waiveBalance_,          roles: ['Director'], log: 'Waive balance' },
    getCrePaymentRequests: { fn: getCrePaymentRequests_, roles: ['CRE'] }
  };
}

function waiverActivityDetail_(fnName, a, result) {
  a = a || {}; result = result || {};
  if (fnName === 'waiveBalance') {
    return (result.requestId || '') + ' – ₹' + formatAmount(result.amount || a.amount || 0) +
      (result.toDirector ? ' sent to the directors (over the limit)' : ' waived') + ': ' + (a.reason || '');
  }
  return '';
}
