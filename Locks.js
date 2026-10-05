/**
 * ORDER LOCK WHILE A REQUEST IS WAITING (Oct 2026)
 * ------------------------------------------------
 * Once Accounts sends an order to an admin (any payment exception, or a
 * standby request), nothing on that order may change until the request is
 * approved, declined -- or withdrawn. Otherwise the admin could be deciding
 * on a picture that has already moved (e.g. a correction approved after
 * the order was verified with the disputed figure).
 *
 * Enforced on the server in every action that changes an order:
 *   submitVerification_, recordBalancePayment_, submitPickupAndVehicle_,
 *   confirmSiteReady_, submitDispatch_, submitPostalDispatch_,
 *   requestPaymentException_, requestStandby_.
 * Not locked: CRE delivery-status updates (they report what happened on the
 * road), resuming an active standby, and the automatic steps an approval
 * itself performs (LOCK_SKIP_REQUEST_ID_ lets the request being applied
 * through).
 *
 * Way out: withdrawRequest_ -- any Accounts person (or an Admin) can pull
 * back a waiting request, e.g. the customer paid the balance while a
 * "dispatch with balance" request was out. Status becomes "Withdrawn".
 */
var LOCK_SKIP_REQUEST_ID_ = null;

/** The request waiting for a decision on this order, or null. */
function pendingRequestFor_(trackerId) {
  var t = String(trackerId || '').toLowerCase();
  if (!t) return null;
  var hits = [];
  readPaymentExceptions_().forEach(function (r) {
    if (r.status === 'Pending' && r.trackerId.toLowerCase() === t && r.requestId !== LOCK_SKIP_REQUEST_ID_) {
      hits.push({ kind: 'payment', requestId: r.requestId, label: PX_LABELS[r.type] || r.type, requestedBy: r.requestedBy,
                  requestedByName: r.requestedByName, requestedAtMs: r.requestedAtMs, waitingFor: 'an admin' });
    }
  });
  if (typeof readStandby_ === 'function') {
    readStandby_().forEach(function (r) {
      if ((r.status === 'Pending' || r.status === 'Pending Director') && r.trackerId.toLowerCase() === t && r.requestId !== LOCK_SKIP_REQUEST_ID_) {
        hits.push({ kind: 'standby', requestId: r.requestId, label: 'Standby (' + r.reason + ')', requestedBy: r.requestedBy,
                    requestedByName: r.requestedByName, requestedAtMs: r.requestedAtMs,
                    waitingFor: r.status === 'Pending Director' ? 'a director' : 'an admin' });
      }
    });
  }
  if (!hits.length) return null;
  var h = hits[0];
  h.requestedAt = h.requestedAtMs ? Utilities.formatDate(new Date(h.requestedAtMs), Session.getScriptTimeZone(), 'dd-MMM, hh:mm a') : '';
  return h;
}

/** Throws if the order at this row has a request waiting. */
function assertNoPendingRequest_(sheet, row) {
  var id = getRowFields(sheet, row, ['Tracker ID'])['Tracker ID'];
  var p = pendingRequestFor_(id);
  if (p) {
    throw new Error('This order is waiting for ' + p.waitingFor + ' to decide "' + p.label + '" (' + p.requestId + ', asked by ' +
      p.requestedByName + (p.requestedAt ? ' at ' + p.requestedAt : '') + '). Nothing can be changed on it until that\u2019s decided. ' +
      'If the request isn\u2019t needed any more, look the order up on the Accounts page and withdraw it.');
  }
}

/** Accounts / Admin: pull back a waiting request. form = { requestId, note } */
function withdrawRequest_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var id = String(form.requestId || '').trim();
  var note = String(form.note || '').trim();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var out;
  try {
    if (id.indexOf('SB-') === 0) {
      var list = readStandby_();
      var s = sbFind_(list, id);
      if (!s) throw new Error('Request not found.');
      if (s.status !== 'Pending' && s.status !== 'Pending Director') throw new Error('This request is already ' + s.status.toLowerCase() + ' \u2013 nothing to withdraw.');
      sbWrite_(s.row, { 'Status': 'Withdrawn', 'Decided By': 'Withdrawn by ' + me.name + ' (' + me.code + ')', 'Decided At': new Date(),
        'History': sbHistory_(s, 'Withdrawn by ' + me.name + (note ? ' (' + note + ')' : '')) });
      out = { requestId: id, trackerId: s.trackerId, label: 'Standby' };
    } else {
      var r = readPaymentExceptions_().filter(function (x) { return x.requestId === id; })[0];
      if (!r) throw new Error('Request not found.');
      if (r.status !== 'Pending') throw new Error('This request is already ' + r.status.toLowerCase() + ' \u2013 nothing to withdraw.');
      getOrCreatePaymentExceptionsSheet_().getRange(r.row, 9, 1, 3).setValues([['Withdrawn', me.name + ' (' + me.code + ')', new Date()]]);
      out = { requestId: id, trackerId: r.trackerId, label: PX_LABELS[r.type] || r.type };
    }
  } finally {
    lock.releaseLock();
  }
  return out;
}

/** Merged into apiMap_(). */
function lockApiMap_() {
  return { withdrawRequest: { fn: withdrawRequest_, roles: ['Accounts'], log: 'Withdrew request' } };
}
