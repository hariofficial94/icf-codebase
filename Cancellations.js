/**
 * ORDER CANCELLATION + REFUND (Oct 2026)
 * --------------------------------------
 * Replaces deleting a PO row by hand. The row is never deleted: its Status
 * becomes "Cancelled", which takes it off every live list, tile, KPI and
 * balance total, while the record stays on file (GST retention, audit).
 *
 * Flow
 *   1. CRE (owner, covering or with access) raises a request with a reason.
 *      Allowed only before dispatch. While it waits, the order is locked
 *      like any other pending request (Locks.gs).
 *   2. An Admin approves or declines. On approve the Admin says whether a
 *      refund is due; if so, the amount (default = amount received, never
 *      more) and a deadline. Accounts is emailed the refund with its deadline.
 *      Refund Status: "Processing".
 *   3. Accounts pays it, enters the UTR -> Refund Status "Processed". The CRE
 *      is emailed.
 *   4. CRE pane: once processed (or cancelled with no refund) the CRE ticks
 *      "Informed the customer" and presses OK; the item leaves the pane.
 *
 * Tab "Order Cancellations" (created on first use). One row per request.
 * Order rows in the tracker only ever get Status = "Cancelled"; everything
 * else lives here, so no tracker columns were added.
 */
var CX_SHEET_NAME = 'Order Cancellations';
var CX_HEADERS = ['Request ID', 'Requested At', 'Tracker ID', 'Institution / Customer', 'Owner Code', 'Requested By', 'Requested By Name',
  'Reason', 'Status Before', 'Order Value', 'Amount Received', 'Status', 'Decided By', 'Decided At', 'Admin Note',
  'Refund Amount', 'Refund Deadline', 'Refund Status', 'Refund UTR', 'Refund Note', 'Refund Processed By', 'Refund Processed At',
  'Customer Informed By', 'Customer Informed At', 'History'];
var STATUS_CANCELLED = 'Cancelled';
var CX_REFUND_PROCESSING = 'Processing';
var CX_REFUND_PROCESSED = 'Processed';
var CX_REFUND_NONE = 'Not required';

function isCancelledStatus_(status) { return String(status || '') === 'Cancelled'; }

// ---------------- Tab ----------------
function getOrCreateCancellationsSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(CX_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CX_SHEET_NAME);
    sheet.getRange(1, 1, 1, CX_HEADERS.length).setValues([CX_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    ensureColumns_(sheet, CX_HEADERS.length);
  }
  return sheet;
}

function cxCol_(name) {
  var i = CX_HEADERS.indexOf(name);
  if (i === -1) throw new Error('Unknown cancellation column: ' + name);
  return i;
}

function cxMs_(v) { return v instanceof Date ? v.getTime() : (v ? (new Date(v).getTime() || null) : null); }

function readCancellations_() {
  var sheet = getOrCreateCancellationsSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var tz = Session.getScriptTimeZone();
  return sheet.getRange(2, 1, last - 1, CX_HEADERS.length).getValues().map(function (r, i) {
    var g = function (n) { return r[cxCol_(n)]; };
    var deadline = g('Refund Deadline');
    return {
      row: i + 2,
      requestId: String(g('Request ID') || ''),
      requestedAtMs: cxMs_(g('Requested At')),
      trackerId: String(g('Tracker ID') || ''),
      institution: String(g('Institution / Customer') || ''),
      ownerCode: String(g('Owner Code') || '').toUpperCase(),
      requestedBy: String(g('Requested By') || '').toUpperCase(),
      requestedByName: String(g('Requested By Name') || ''),
      reason: String(g('Reason') || ''),
      statusBefore: String(g('Status Before') || ''),
      orderValue: Number(g('Order Value')) || 0,
      amountReceived: Number(g('Amount Received')) || 0,
      status: String(g('Status') || ''),
      decidedBy: String(g('Decided By') || ''),
      decidedAtMs: cxMs_(g('Decided At')),
      adminNote: String(g('Admin Note') || ''),
      refundAmount: Number(g('Refund Amount')) || 0,
      refundDeadlineYmd: deadline instanceof Date ? Utilities.formatDate(deadline, tz, 'yyyy-MM-dd') : String(deadline || ''),
      refundStatus: String(g('Refund Status') || ''),
      refundUtr: String(g('Refund UTR') || ''),
      refundNote: String(g('Refund Note') || ''),
      refundProcessedBy: String(g('Refund Processed By') || ''),
      refundProcessedAtMs: cxMs_(g('Refund Processed At')),
      informedBy: String(g('Customer Informed By') || ''),
      informedAtMs: cxMs_(g('Customer Informed At')),
      history: String(g('History') || '')
    };
  }).filter(function (r) { return r.requestId; });
}

function cxWrite_(row, fields) {
  var sheet = getOrCreateCancellationsSheet_();
  Object.keys(fields).forEach(function (k) {
    var cell = sheet.getRange(row, cxCol_(k) + 1);
    if (k === 'Refund UTR') cell.setNumberFormat('@'); // keep long UTRs as text
    cell.setValue(fields[k]);
  });
}

function cxHistory_(r, text) {
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM HH:mm');
  r.history = (r.history ? r.history + ' | ' : '') + stamp + ' ' + text;
  return r.history;
}

function cxFind_(requestId) {
  var id = String(requestId || '');
  return readCancellations_().filter(function (r) { return r.requestId === id; })[0] || null;
}

/** Latest request for an order (any status), or null. */
function cxLatestFor_(trackerId) {
  var t = String(trackerId || '').toLowerCase();
  var hits = readCancellations_().filter(function (r) { return r.trackerId.toLowerCase() === t; });
  return hits.length ? hits[hits.length - 1] : null;
}

function cxFmt_(ms, pattern) { return ms ? Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), pattern || 'dd-MMM, hh:mm a') : ''; }
function cxInr_(n) { return 'Rs. ' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }
function cxEsc_(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function cxEmailsFor_(roles) {
  var map = getStaffMap_(true), out = [];
  Object.keys(map).forEach(function (k) {
    var s = map[k];
    if (s.active && roles.indexOf(s.role) !== -1 && /@/.test(s.email) && out.indexOf(s.email) === -1) out.push(s.email);
  });
  return out;
}
function cxEmailOf_(code) { var s = getStaffMap_(false)[String(code || '').toUpperCase()]; return s && /@/.test(s.email) ? s.email : ''; }

function cxMail_(to, cc, subject, innerHtml, link, linkLabel) {
  to = (to || []).filter(function (e) { return /@/.test(e); });
  cc = (cc || []).filter(function (e) { return /@/.test(e) && to.indexOf(e) === -1; });
  if (!to.length) { to = cc; cc = []; }
  if (!to.length) { Logger.log('No email on file for: ' + subject); return false; }
  try {
    var opts = {
      to: to.join(','), subject: subject,
      htmlBody: innerHtml + (link ? '<p><a href="' + link + '" style="background:#1F3864;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:600;">' + cxEsc_(linkLabel || 'Open') + '</a></p>' : '') +
        '<p style="color:#888;font-size:11px;">Automatic message from the ICF Order Tracker.</p>'
    };
    if (cc.length) opts.cc = cc.join(',');
    MailApp.sendEmail(opts);
    return true;
  } catch (e) {
    Logger.log('Cancellation email failed: ' + e);
    return false;
  }
}

/** Days from today (IST) to a yyyy-MM-dd date; negative = overdue. */
function cxDaysUntil_(ymd) {
  if (!ymd) return null;
  var p = ymd.split('-'), t = todayYmd_().split('-');
  return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(+t[0], +t[1] - 1, +t[2])) / 86400000);
}

// ---------------- 1. CRE raises the request ----------------
/** CRE: form = { trackerId, reason } */
function requestCancellation_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var reason = String(form.reason || '').trim();
  if (reason.length < 5) throw new Error('Add the reason the customer gave, e.g. "Customer bought locally, wants advance back".');
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String(form.trackerId || ''));
  if (row === -1) throw new Error('Tracker ID not found.');
  requireCanAct_(sheet, row);
  var f = getRowFields(sheet, row, ['Tracker ID', 'Institution / Customer', 'Status', 'Total Order Value', 'Advance Received', 'CRE Code', 'CRE Name']);
  var trackerId = String(f['Tracker ID']);
  if (isCancelledStatus_(f['Status'])) throw new Error('This order is already cancelled.');
  if (isDispatchedStatus_(f['Status'])) {
    throw new Error('This order has already been dispatched, so it can’t be cancelled here – it would be a return. Speak to the admin.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var requestId;
  try {
    var existing = cxLatestFor_(trackerId);
    if (existing && existing.status === 'Pending') throw new Error('A cancellation request is already waiting for the admin (' + existing.requestId + ').');
    requestId = 'CX-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd') + '-' + Utilities.getUuid().split('-')[0].slice(0, 4).toUpperCase();
    var rowVals = CX_HEADERS.map(function () { return ''; });
    var set = function (k, v) { rowVals[cxCol_(k)] = v; };
    set('Request ID', requestId);
    set('Requested At', new Date());
    set('Tracker ID', trackerId);
    set('Institution / Customer', f['Institution / Customer']);
    set('Owner Code', resolveOwnerCode_(f['CRE Code'], f['CRE Name']) || '');
    set('Requested By', me.code);
    set('Requested By Name', me.name);
    set('Reason', reason);
    set('Status Before', f['Status']);
    set('Order Value', Number(f['Total Order Value']) || 0);
    set('Amount Received', Number(f['Advance Received']) || 0);
    set('Status', 'Pending');
    set('History', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM HH:mm') + ' Requested by ' + me.name);
    getOrCreateCancellationsSheet_().appendRow(rowVals);
  } finally {
    lock.releaseLock();
  }

  var url = appUrl_();
  cxMail_(cxEmailsFor_(['Admin']), [], 'Cancellation request: ' + trackerId + ' – ' + f['Institution / Customer'],
    '<p><b>' + cxEsc_(me.name) + '</b> is asking to cancel an order.</p>' +
    '<p>Order: <b>' + cxEsc_(trackerId) + '</b> – ' + cxEsc_(f['Institution / Customer']) + '<br>' +
    'Order value: ' + cxInr_(f['Total Order Value']) + ' &middot; Received so far: <b>' + cxInr_(f['Advance Received']) + '</b><br>' +
    'Stage: ' + cxEsc_(f['Status']) + '<br>Reason: ' + cxEsc_(reason) + '</p>' +
    '<p style="color:#666;font-size:12px;">The order is locked until you decide. If you approve, you’ll set the refund amount and deadline for Accounts.</p>',
    url ? url + '?page=admin&req=' + encodeURIComponent(requestId) : '', 'Review request');
  return { requestId: requestId, trackerId: trackerId };
}

/** CRE (who raised it, or the order's owner) or Admin: pull back a waiting request. form = { requestId } */
function withdrawCancellation_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var r = cxFind_(form.requestId);
    if (!r) throw new Error('Request not found.');
    if (r.status !== 'Pending') throw new Error('This request is already ' + r.status.toLowerCase() + ' – nothing to withdraw.');
    if (me.role !== 'Admin' && me.code !== r.requestedBy && me.code !== r.ownerCode) {
      throw new Error('Only ' + r.requestedByName + ' (who raised it) or an admin can withdraw this request.');
    }
    cxWrite_(r.row, { 'Status': 'Withdrawn', 'Decided By': 'Withdrawn by ' + me.name + ' (' + me.code + ')', 'Decided At': new Date(),
      'Customer Informed At': new Date(), // nothing to tell the customer -- keeps it off the CRE pane
      'History': cxHistory_(r, 'Withdrawn by ' + me.name) });
    return { requestId: r.requestId, trackerId: r.trackerId };
  } finally {
    lock.releaseLock();
  }
}

// ---------------- 2. Admin decides ----------------
/** Admin page data: waiting requests, refunds still processing, recent decisions. */
function getCancellationsAdmin_() {
  var all = readCancellations_();
  var tz = Session.getScriptTimeZone();
  var map = function (r) {
    return {
      requestId: r.requestId, trackerId: r.trackerId, institution: r.institution, requestedByName: r.requestedByName, requestedBy: r.requestedBy,
      ownerName: ((getStaffMap_(false)[r.ownerCode] || {}).name) || r.ownerCode,
      reason: r.reason, statusBefore: r.statusBefore, orderValue: r.orderValue, amountReceived: r.amountReceived,
      status: r.status, decidedBy: r.decidedBy, decidedAt: cxFmt_(r.decidedAtMs), adminNote: r.adminNote,
      requestedAt: cxFmt_(r.requestedAtMs), refundAmount: r.refundAmount, refundStatus: r.refundStatus,
      refundDeadline: r.refundDeadlineYmd ? fmtYmd_(r.refundDeadlineYmd) : '', daysLeft: cxDaysUntil_(r.refundDeadlineYmd),
      refundUtr: r.refundUtr, refundProcessedBy: r.refundProcessedBy, refundProcessedAt: cxFmt_(r.refundProcessedAtMs)
    };
  };
  return {
    pending: all.filter(function (r) { return r.status === 'Pending'; }).map(map),
    refundsOpen: all.filter(function (r) { return r.status === 'Approved' && r.refundStatus === CX_REFUND_PROCESSING; }).map(map),
    recent: all.filter(function (r) { return r.status !== 'Pending'; }).reverse().slice(0, 40).map(map),
    today: todayYmd_(),
    defaultDeadline: Utilities.formatDate(new Date(Date.now() + 7 * 86400000), tz, 'yyyy-MM-dd')
  };
}

/** Admin: form = { requestId, approve, note, refund (bool), refundAmount, refundDeadline (yyyy-MM-dd) } */
function decideCancellation_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var note = String(form.note || '').trim();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var r, out;
  try {
    r = cxFind_(form.requestId);
    if (!r) throw new Error('Request not found.');
    if (r.status !== 'Pending') throw new Error('This request was already ' + r.status.toLowerCase() + (r.decidedBy ? ' by ' + r.decidedBy : '') + '.');
    var now = new Date();

    if (!form.approve) {
      if (!note) throw new Error('Add a short note for the CRE saying why it’s declined.');
      cxWrite_(r.row, { 'Status': 'Declined', 'Decided By': me.name, 'Decided At': now, 'Admin Note': note,
        'History': cxHistory_(r, 'Declined by ' + me.name + ': ' + note) });
      out = { requestId: r.requestId, trackerId: r.trackerId, declined: true };
    } else {
      var sheet = getSheet();
      var row = findRowByTrackerId(sheet, r.trackerId);
      if (row === -1) throw new Error('The order ' + r.trackerId + ' is no longer in the tracker.');
      var f = getRowFields(sheet, row, ['Status', 'Advance Received']);
      if (isDispatchedStatus_(f['Status'])) throw new Error('The order was dispatched after this request was raised, so it can’t be cancelled now. Decline it and speak to the CRE.');
      var received = Number(f['Advance Received']) || 0;

      var refund = !!form.refund;
      var amount = 0, deadline = '';
      if (refund) {
        amount = Math.round(Number(form.refundAmount) * 100) / 100;
        if (!(amount > 0)) throw new Error('Enter the refund amount, or switch "Refund due" off.');
        if (amount > received + 0.5) throw new Error('The refund can’t be more than the ' + cxInr_(received) + ' received on this order.');
        deadline = String(form.refundDeadline || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new Error('Pick the date Accounts must refund by.');
        if (deadline < todayYmd_()) throw new Error('The refund deadline can’t be in the past.');
      }

      // The order: Status -> Cancelled. Nothing else on the row changes.
      setRowFields(sheet, row, { 'Status': STATUS_CANCELLED });

      // Anything else waiting on this order no longer applies.
      LOCK_SKIP_REQUEST_ID_ = r.requestId;
      try { cxCloseOtherRequests_(r.trackerId, me); } finally { LOCK_SKIP_REQUEST_ID_ = null; }

      var p = refund ? deadline.split('-') : null;
      cxWrite_(r.row, {
        'Status': 'Approved', 'Decided By': me.name, 'Decided At': now, 'Admin Note': note,
        'Refund Amount': refund ? amount : '',
        'Refund Deadline': refund ? new Date(+p[0], +p[1] - 1, +p[2]) : '',
        'Refund Status': refund ? CX_REFUND_PROCESSING : CX_REFUND_NONE,
        'History': cxHistory_(r, 'Approved by ' + me.name + (refund ? ', refund ' + cxInr_(amount) + ' by ' + fmtYmd_(deadline) : ', no refund'))
      });
      out = { requestId: r.requestId, trackerId: r.trackerId, approved: true, refund: refund, refundAmount: amount, refundDeadline: refund ? fmtYmd_(deadline) : '' };
    }
  } finally {
    lock.releaseLock();
  }

  // Emails (outside the lock)
  var url = appUrl_();
  var creTo = [cxEmailOf_(r.requestedBy)], creCc = r.ownerCode && r.ownerCode !== r.requestedBy ? [cxEmailOf_(r.ownerCode)] : [];
  var head = '<p>Order: <b>' + cxEsc_(r.trackerId) + '</b> – ' + cxEsc_(r.institution) + '</p>';
  if (out.declined) {
    cxMail_(creTo, creCc, 'Cancellation declined: ' + r.trackerId,
      head + '<p>' + cxEsc_(me.name) + ' declined the cancellation request.<br>Note: ' + cxEsc_(note) + '</p><p>The order is unlocked and carries on as before.</p>', url, 'Open the CRE page');
  } else {
    cxMail_(creTo, creCc, 'Order cancelled: ' + r.trackerId + (out.refund ? ' – refund processing' : ''),
      head + '<p>' + cxEsc_(me.name) + ' approved the cancellation.' + (note ? '<br>Note: ' + cxEsc_(note) : '') + '</p>' +
      (out.refund ? '<p>Refund of <b>' + cxInr_(out.refundAmount) + '</b> is with Accounts, to be paid by <b>' + cxEsc_(out.refundDeadline) + '</b>. You’ll get an email when it’s processed.</p>'
                  : '<p>No refund is due. Please tell the customer the order is cancelled.</p>'), url, 'Open the CRE page');
    if (out.refund) {
      cxMail_(cxEmailsFor_(['Accounts']), cxEmailsFor_(['Admin']), 'Refund to process by ' + out.refundDeadline + ': ' + r.trackerId + ' – ' + cxInr_(out.refundAmount),
        '<p>' + cxEsc_(me.name) + ' approved the cancellation of <b>' + cxEsc_(r.trackerId) + '</b> – ' + cxEsc_(r.institution) + ' and asked Accounts to refund the customer.</p>' +
        '<p>Refund amount: <b>' + cxInr_(out.refundAmount) + '</b> (received on the order: ' + cxInr_(r.amountReceived) + ')<br>' +
        'Refund by: <b>' + cxEsc_(out.refundDeadline) + '</b>' + (note ? '<br>Admin note: ' + cxEsc_(note) : '') + '</p>' +
        '<p style="color:#666;font-size:12px;">Once paid, open the Accounts page, find it under "Refunds to process" and enter the UTR.</p>',
        url ? url + '?page=accounts' : '', 'Open the Accounts page');
    }
  }
  return out;
}

/** On approval: withdraw any other waiting request on the order and end an active standby. */
function cxCloseOtherRequests_(trackerId, me) {
  var t = String(trackerId).toLowerCase();
  var stamp = new Date();
  var pxSheet = getOrCreatePaymentExceptionsSheet_();
  readPaymentExceptions_().forEach(function (x) {
    if (x.status === 'Pending' && x.trackerId.toLowerCase() === t) {
      pxSheet.getRange(x.row, 9, 1, 3).setValues([['Withdrawn', 'Order cancelled – ' + me.name, stamp]]);
    }
  });
  if (typeof readStandby_ === 'function') {
    readStandby_().forEach(function (s) {
      if (s.trackerId.toLowerCase() !== t) return;
      if (s.status === 'Pending' || s.status === 'Pending Director') {
        sbWrite_(s.row, { 'Status': 'Withdrawn', 'Decided By': 'Order cancelled – ' + me.name, 'Decided At': stamp,
          'History': sbHistory_(s, 'Withdrawn: order cancelled') });
      } else if (s.status === 'Active') {
        sbEnd_(s, 'Order cancelled'); // the order is no longer "On Standby", so nothing is restored
      }
    });
  }
}

// ---------------- 3. Accounts processes the refund ----------------
/** Accounts pane: refunds still to pay, most urgent first. */
function getRefundsToProcess_() {
  // Return refunds (Oct 2026, Returns.gs) are paid from the same pane.
  var returns = [];
  if (typeof rtRefundsToProcess_ === 'function') { try { returns = rtRefundsToProcess_(); } catch (e) { Logger.log('return refunds: ' + e); } }
  return readCancellations_().filter(function (r) { return r.status === 'Approved' && r.refundStatus === CX_REFUND_PROCESSING; })
    .map(function (r) {
      return {
        requestId: r.requestId, kind: 'Cancellation', trackerId: r.trackerId, institution: r.institution, refundAmount: r.refundAmount,
        amountReceived: r.amountReceived, deadline: r.refundDeadlineYmd ? fmtYmd_(r.refundDeadlineYmd) : '',
        daysLeft: cxDaysUntil_(r.refundDeadlineYmd), approvedBy: r.decidedBy, approvedAt: cxFmt_(r.decidedAtMs),
        adminNote: r.adminNote, cre: r.requestedByName
      };
    })
    .concat(returns)
    .sort(function (a, b) { return (a.daysLeft === null ? 9999 : a.daysLeft) - (b.daysLeft === null ? 9999 : b.daysLeft); });
}

/** Accounts: form = { requestId, utr, note } */
function markRefundProcessed_(form) {
  form = form || {};
  if (String(form.requestId || '').indexOf('RT-') === 0 && typeof rtMarkRefundProcessed_ === 'function') return rtMarkRefundProcessed_(form);
  var me = CURRENT_STAFF_;
  var utr = String(form.utr || '').trim();
  if (utr.length < 6) throw new Error('Enter the UTR / bank reference of the refund.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var r;
  try {
    r = cxFind_(form.requestId);
    if (!r) throw new Error('Refund not found.');
    if (r.refundStatus !== CX_REFUND_PROCESSING) throw new Error('This refund is already ' + (r.refundStatus || 'closed').toLowerCase() + '.');
    cxWrite_(r.row, { 'Refund Status': CX_REFUND_PROCESSED, 'Refund UTR': utr, 'Refund Note': String(form.note || '').trim(),
      'Refund Processed By': me.name, 'Refund Processed At': new Date(),
      'History': cxHistory_(r, 'Refund processed by ' + me.name + ', UTR ' + utr) });
  } finally {
    lock.releaseLock();
  }
  var late = cxDaysUntil_(r.refundDeadlineYmd);
  cxMail_([cxEmailOf_(r.requestedBy)], r.ownerCode && r.ownerCode !== r.requestedBy ? [cxEmailOf_(r.ownerCode)] : [],
    'Refund processed: ' + r.trackerId + ' – ' + cxInr_(r.refundAmount),
    '<p>Accounts (' + cxEsc_(me.name) + ') has refunded <b>' + cxInr_(r.refundAmount) + '</b> for the cancelled order <b>' + cxEsc_(r.trackerId) + '</b> – ' + cxEsc_(r.institution) + '.<br>UTR: <b>' + cxEsc_(utr) + '</b></p>' +
    '<p>Please tell the customer, then tick “Informed the customer” on the CRE page.</p>', appUrl_(), 'Open the CRE page');
  return { requestId: r.requestId, trackerId: r.trackerId, late: late !== null && late < 0 ? -late : 0 };
}

// ---------------- 4. CRE pane + acknowledgement ----------------
/** CRE pane: requests this CRE raised or whose order they own, until the customer has been told. */
function getCancellationPanel_() {
  var me = CURRENT_STAFF_;
  var threeDaysAgo = Date.now() - 3 * 86400000;
  return readCancellations_().filter(function (r) {
    if (me.role !== 'Admin' && r.requestedBy !== me.code && r.ownerCode !== me.code) return false;
    if (r.informedAtMs) return false;
    if (r.status === 'Withdrawn') return false;
    if (r.status === 'Declined' && !(r.decidedAtMs && r.decidedAtMs > threeDaysAgo)) return false;
    return true;
  }).map(function (r) {
    var stage, text, canAck = false;
    if (r.status === 'Pending') { stage = 'Pending'; text = 'Waiting for admin'; }
    else if (r.status === 'Declined') { stage = 'Declined'; text = 'Declined' + (r.adminNote ? ' – ' + r.adminNote : ''); canAck = true; }
    else if (r.refundStatus === CX_REFUND_PROCESSING) {
      stage = 'Processing'; text = 'Cancelled – refund processing' + (r.refundDeadlineYmd ? ' (due ' + fmtYmd_(r.refundDeadlineYmd) + ')' : '');
    } else if (r.refundStatus === CX_REFUND_PROCESSED) {
      stage = 'Processed'; text = 'Refund processed – UTR ' + r.refundUtr; canAck = true;
    } else { stage = 'NoRefund'; text = 'Cancelled – no refund due'; canAck = true; }
    var when = r.refundProcessedAtMs || r.decidedAtMs || r.requestedAtMs;
    return {
      requestId: r.requestId, trackerId: r.trackerId, institution: r.institution, stage: stage, statusText: text,
      refundAmount: r.refundAmount, canAck: canAck, ackLabel: r.status === 'Declined' ? 'Seen' : 'Informed the customer',
      when: cxFmt_(when), whenMs: when || 0
    };
  }).sort(function (a, b) {
    var rank = { Processed: 0, NoRefund: 1, Declined: 2, Processing: 3, Pending: 4 };
    return (rank[a.stage] - rank[b.stage]) || (b.whenMs - a.whenMs);
  });
}

/** CRE: form = { requestId } -- the customer has been told; removes it from the pane. */
function acknowledgeCancellation_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var r = cxFind_(form.requestId);
  if (!r) throw new Error('Request not found.');
  if (me.role !== 'Admin' && r.requestedBy !== me.code && r.ownerCode !== me.code) throw new Error('This isn’t your request.');
  if (r.status === 'Pending' || r.refundStatus === CX_REFUND_PROCESSING) throw new Error('Not finished yet – wait until the refund is processed.');
  if (r.informedAtMs) return { requestId: r.requestId, trackerId: r.trackerId };
  cxWrite_(r.row, { 'Customer Informed By': me.name, 'Customer Informed At': new Date(),
    'History': cxHistory_(r, (r.status === 'Declined' ? 'Seen by ' : 'Customer informed by ') + me.name) });
  return { requestId: r.requestId, trackerId: r.trackerId };
}

/** "All refunds" pop-up (CRE, Admin, Director): every refund ever raised, with the fields the filters need. */
function getRefundsReport_() {
  var sheet = getSheet();
  var last = getLastOrderRow_(sheet);
  var info = {};
  if (last >= 2) {
    var n = last - 1;
    var ids = sheet.getRange(2, getHeaderIndex('Tracker ID'), n, 1).getValues();
    var logged = sheet.getRange(2, getHeaderIndex('Date Logged'), n, 1).getValues();
    var terms = sheet.getRange(2, getHeaderIndex('Payment Terms Type'), n, 1).getValues();
    for (var i = 0; i < n; i++) {
      if (!ids[i][0]) continue;
      info[String(ids[i][0]).toLowerCase()] = { loggedMs: cxMs_(logged[i][0]), terms: String(terms[i][0] || 'End Customer') };
    }
  }
  var staff = getStaffMap_(false);
  // Return refunds (Oct 2026, Returns.gs) are listed with the rest.
  var returnRefunds = [];
  if (typeof readReturns_ === 'function') {
    try {
      returnRefunds = readReturns_().filter(function (r) { return r.resolution === 'Refund' && r.status !== 'Pending' && r.status !== 'Declined' && r.status !== 'Withdrawn'; })
        .reverse().map(function (r) {
          var o = info[r.trackerId.toLowerCase()] || {};
          return {
            requestId: r.returnId, trackerId: r.trackerId, institution: r.institution,
            cre: ((staff[r.ownerCode] || {}).name) || r.requestedByName,
            paymentTerms: o.terms || '', dateLoggedMs: o.loggedMs || null, orderValue: r.orderValue,
            refundAmount: r.resolutionAmount, refundStatus: r.refundStatus,
            deadline: r.refundDeadlineYmd ? fmtYmd_(r.refundDeadlineYmd) : '', daysLeft: r.refundDeadlineYmd ? cxDaysUntil_(r.refundDeadlineYmd) : null,
            approvedBy: r.decidedBy, approvedAt: cxFmt_(r.decidedAtMs, 'dd-MMM-yyyy'),
            processedBy: r.refundProcessedBy, processedAt: cxFmt_(r.refundProcessedAtMs, 'dd-MMM-yyyy'), utr: r.refundUtr,
            informed: !!r.informedAtMs, kind: 'Return'
          };
        });
    } catch (e) { Logger.log('refunds report: returns ' + e); }
  }
  return readCancellations_().filter(function (r) { return r.status === 'Approved' && r.refundStatus && r.refundStatus !== CX_REFUND_NONE; })
    .reverse().map(function (r) {
      var o = info[r.trackerId.toLowerCase()] || {};
      return {
        requestId: r.requestId, trackerId: r.trackerId, institution: r.institution,
        cre: ((staff[r.ownerCode] || {}).name) || r.requestedByName,
        paymentTerms: o.terms || '', dateLoggedMs: o.loggedMs || null, orderValue: r.orderValue,
        refundAmount: r.refundAmount, refundStatus: r.refundStatus,
        deadline: r.refundDeadlineYmd ? fmtYmd_(r.refundDeadlineYmd) : '', daysLeft: cxDaysUntil_(r.refundDeadlineYmd),
        approvedBy: r.decidedBy, approvedAt: cxFmt_(r.decidedAtMs, 'dd-MMM-yyyy'),
        processedBy: r.refundProcessedBy, processedAt: cxFmt_(r.refundProcessedAtMs, 'dd-MMM-yyyy'), utr: r.refundUtr,
        informed: !!r.informedAtMs, kind: 'Cancellation'
      };
    }).concat(returnRefunds);
}

// ---------------- Hooks used by other files ----------------
/** For pendingRequestFor_ (Locks.gs): the cancellation waiting on this order, or null. */
function cxPendingFor_(trackerId) {
  var t = String(trackerId || '').toLowerCase();
  var r = readCancellations_().filter(function (x) { return x.status === 'Pending' && x.trackerId.toLowerCase() === t && x.requestId !== LOCK_SKIP_REQUEST_ID_; })[0];
  return r ? { kind: 'cancel', requestId: r.requestId, label: 'Cancel this order', requestedBy: r.requestedBy,
               requestedByName: r.requestedByName, requestedAtMs: r.requestedAtMs, waitingFor: 'an admin' } : null;
}

/** For lookupOrder_ / getOrderTimeline_: the cancellation picture of one order. */
function cxInfoForOrder_(trackerId) {
  var r = cxLatestFor_(trackerId);
  if (!r) return null;
  return {
    requestId: r.requestId, status: r.status, requestedByName: r.requestedByName, requestedBy: r.requestedBy,
    requestedAt: cxFmt_(r.requestedAtMs), reason: r.reason, decidedBy: r.decidedBy, decidedAt: cxFmt_(r.decidedAtMs, 'dd-MMM-yyyy, hh:mm a'),
    adminNote: r.adminNote, refundStatus: r.refundStatus, refundAmount: r.refundAmount,
    refundDeadline: r.refundDeadlineYmd ? fmtYmd_(r.refundDeadlineYmd) : '', refundUtr: r.refundUtr,
    refundProcessedAt: cxFmt_(r.refundProcessedAtMs, 'dd-MMM-yyyy, hh:mm a')
  };
}

/** Waiting requests, for the admin's approvals counter. */
function cxPendingCount_() {
  return readCancellations_().filter(function (r) { return r.status === 'Pending'; });
}

/** Merged into apiMap_(). */
function cancellationApiMap_() {
  return {
    requestCancellation:     { fn: requestCancellation_,     roles: ['CRE'], log: 'Requested order cancellation' },
    withdrawCancellation:    { fn: withdrawCancellation_,    roles: ['CRE'], log: 'Withdrew cancellation request' },
    getCancellationPanel:    { fn: getCancellationPanel_,    roles: ['CRE'] },
    acknowledgeCancellation: { fn: acknowledgeCancellation_, roles: ['CRE'], log: 'Informed customer of cancellation' },
    getRefundsReport:        { fn: getRefundsReport_,        roles: ['CRE', 'Accounts', 'Director'] },
    getCancellationsAdmin:   { fn: getCancellationsAdmin_,   roles: [] },
    decideCancellation:      { fn: decideCancellation_,      roles: [], log: 'Decided order cancellation' },
    getRefundsToProcess:     { fn: getRefundsToProcess_,     roles: ['Accounts'] },
    markRefundProcessed:     { fn: markRefundProcessed_,     roles: ['Accounts'], log: 'Processed refund' }
  };
}

/** Activity Log detail for the calls above. */
function cancellationActivityDetail_(fnName, a, result) {
  a = a || {}; result = result || {};
  switch (fnName) {
    case 'requestCancellation': return (result.requestId || '') + ' – ' + (a.reason || '');
    case 'withdrawCancellation': return result.requestId || a.requestId || '';
    case 'decideCancellation': return (a.requestId || '') + ' – ' + (result.declined ? 'declined' : 'approved' + (result.refund ? ', refund Rs. ' + result.refundAmount + ' by ' + result.refundDeadline : ', no refund'));
    case 'markRefundProcessed': return (a.requestId || '') + ' – UTR ' + (a.utr || '') + (result.late ? ' (' + result.late + ' day(s) late)' : '');
    case 'acknowledgeCancellation': return a.requestId || '';
    default: return '';
  }
}
