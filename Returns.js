/**
 * PRODUCT RETURNS (Oct 2026)
 * ---------------------------------------------------------------------
 * Goods that left ICF and are coming back -- all or some of an order.
 * Same shape as cancellations: the CRE asks, an admin decides, the record
 * lives in its own tab and the order row only changes where it must.
 *
 * Why goods come back (RT_REASONS): damaged in transit, wrong product sent,
 * defective, the customer refused it at delivery, a DACC rejected at the
 * transporter's warehouse, a Flipkart return, or ICF retrieving goods from a
 * site because the customer didn't pay the balance. ICF bears the return
 * freight, whatever the reason (Hari, 31 Oct 2026).
 *
 * FLOW
 *   1. CRE raises it from the order: reason, the products and quantities
 *      coming back (partial returns are common), how it's coming back, when
 *      it's expected, and what they suggest for the customer.
 *   2. An admin approves or declines. On approval the admin settles the money:
 *        - "Reduce what the customer still owes by" -- for goods the customer
 *          never paid for (a rejected DACC, a site retrieval). The order's
 *          Total Order Value goes down; the old value is kept in "Original
 *          Order Value". Done at once, so the CRE stops chasing that balance.
 *        - What the customer gets for money already paid: a refund, a
 *          replacement order, credit on a future order, or nothing.
 *      Sanju (Gate) sees the return on his list from now.
 *   3. Sanju logs the goods in at the gate (quantity per product) and records
 *      the inspection: restock, repair, scrap, or send to another customer --
 *      in one go, or arrival now and inspection later.
 *      A refund goes to Accounts once the goods are in (unless the admin said
 *      to refund at once), due within the days the admin set. If the whole
 *      order is back, its Delivery Status becomes "Returned".
 *   4. Accounts pays the refund and enters the UTR -- same "Refunds to process"
 *      pane as cancellations (Cancellations.gs hands RT- requests over here).
 *   5. The CRE tells the customer, ticks it, and the return is Closed.
 *
 * REPLACEMENT / CREDIT. The original order is NOT cancelled or reopened -- it
 * was dispatched and invoiced, so it stays as it is with the return recorded
 * against it. The replacement is logged as a NEW PO with "Apply return credit"
 * = the return's ID: the credit counts as already received (Accounts verifies
 * only any new money), and the new order is linked to the original ("Linked
 * Tracker ID"). A wrong product replaced at a different price simply gets the
 * new price on the new order: dearer = the customer pays the difference as a
 * normal balance; cheaper = the unused credit stays on the return for a later
 * order, or the admin refunds it.
 *
 * Tabs (created on first use): "Returns" (one row per return) and
 * "Return Lines" (one row per product on a return).
 */
var RT_SHEET_NAME = 'Returns';
var RT_LINES_SHEET_NAME = 'Return Lines';
var RT_HEADERS = ['Return ID', 'Requested At', 'Tracker ID', 'Institution / Customer', 'Owner Code', 'Requested By', 'Requested By Name',
  'Reason', 'Details', 'Order Type', 'Order Value', 'Amount Received', 'Coming Back By', 'Expected By', 'Proposed Resolution',
  'Status', 'Decided By', 'Decided At', 'Admin Note', 'Goods Value', 'Reduce Order Value By', 'Resolution', 'Resolution Amount',
  'Refund Days', 'Refund Now', 'Refund Deadline', 'Refund Status', 'Refund UTR', 'Refund Note', 'Refund Processed By', 'Refund Processed At',
  'Credit Used', 'Credit Used On', 'Arrived At', 'Arrived By', 'Inspected At', 'Inspected By', 'Inspection Note', 'Full Return',
  'Customer Informed By', 'Customer Informed At', 'Alerts Sent', 'History'];
var RT_LINE_HEADERS = ['Return ID', 'Tracker ID', 'Product', 'Qty Requested', 'Qty Received', 'Outcome', 'Condition Note'];

var RT_REASONS = ['Damaged in transit', 'Wrong product sent', 'Defective product', 'Customer refused at delivery',
  'DACC – rejected at inspection', 'Flipkart return', 'Balance not paid – retrieved from site', 'Other'];
var RT_RESOLUTIONS = ['Refund', 'Replacement order', 'Credit on a future order', 'Nothing due'];
var RT_COMING_BACK = ['ICF vehicle', 'Transporter', 'Courier / Flipkart', 'Customer drops it at ICF'];
var RT_OUTCOMES = ['Restock', 'Repair', 'Scrap', 'Send to another customer'];
var RT_REFUND_WAITING = 'Waiting for goods';
var RT_REFUND_PROCESSING = 'Processing';
var RT_REFUND_PROCESSED = 'Processed';
var RT_REFUND_NONE = 'Not required';
var RT_OPEN_STATUSES = ['Approved', 'Arrived', 'Inspected'];

// ================================================================
// Tabs
// ================================================================
function rtSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(RT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(RT_SHEET_NAME, ss.getNumSheets());
    sheet.getRange(1, 1, 1, RT_HEADERS.length).setValues([RT_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    ensureColumns_(sheet, RT_HEADERS.length);
  }
  return sheet;
}
function rtLinesSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(RT_LINES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(RT_LINES_SHEET_NAME, ss.getNumSheets());
    sheet.getRange(1, 1, 1, RT_LINE_HEADERS.length).setValues([RT_LINE_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}
function rtCol_(name) {
  var i = RT_HEADERS.indexOf(name);
  if (i === -1) throw new Error('Unknown returns column: ' + name);
  return i;
}
function rtMs_(v) { return v instanceof Date ? v.getTime() : null; }
function rtYmd_(v) { return v instanceof Date && !isNaN(v.getTime()) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v || ''); }
function rtFmt_(ms, pattern) { return ms ? Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), pattern || 'dd-MMM, hh:mm a') : ''; }
function rtNum_(v) { var n = Math.round((Number(String(v == null ? '' : v).replace(/[,\s₹]/g, '')) || 0) * 100) / 100; return n; }
function rtDate_(ymd) { var p = String(ymd).split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }

function readReturns_() {
  var sheet = rtSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, RT_HEADERS.length).getValues().map(function (r, i) {
    var g = function (n) { return r[rtCol_(n)]; };
    return {
      row: i + 2,
      returnId: String(g('Return ID') || ''),
      requestedAtMs: rtMs_(g('Requested At')),
      trackerId: String(g('Tracker ID') || ''),
      institution: String(g('Institution / Customer') || ''),
      ownerCode: String(g('Owner Code') || '').toUpperCase(),
      requestedBy: String(g('Requested By') || '').toUpperCase(),
      requestedByName: String(g('Requested By Name') || ''),
      reason: String(g('Reason') || ''),
      details: String(g('Details') || ''),
      orderType: String(g('Order Type') || ''),
      orderValue: Number(g('Order Value')) || 0,
      amountReceived: Number(g('Amount Received')) || 0,
      comingBackBy: String(g('Coming Back By') || ''),
      expectedYmd: rtYmd_(g('Expected By')),
      proposedResolution: String(g('Proposed Resolution') || ''),
      status: String(g('Status') || ''),
      decidedBy: String(g('Decided By') || ''),
      decidedAtMs: rtMs_(g('Decided At')),
      adminNote: String(g('Admin Note') || ''),
      goodsValue: Number(g('Goods Value')) || 0,
      reduceBy: Number(g('Reduce Order Value By')) || 0,
      resolution: String(g('Resolution') || ''),
      resolutionAmount: Number(g('Resolution Amount')) || 0,
      refundDays: Number(g('Refund Days')) || 0,
      refundNow: String(g('Refund Now') || '') === 'Y',
      refundDeadlineYmd: rtYmd_(g('Refund Deadline')),
      refundStatus: String(g('Refund Status') || ''),
      refundUtr: String(g('Refund UTR') || ''),
      refundNote: String(g('Refund Note') || ''),
      refundProcessedBy: String(g('Refund Processed By') || ''),
      refundProcessedAtMs: rtMs_(g('Refund Processed At')),
      creditUsed: Number(g('Credit Used')) || 0,
      creditUsedOn: String(g('Credit Used On') || ''),
      arrivedAtMs: rtMs_(g('Arrived At')),
      arrivedBy: String(g('Arrived By') || ''),
      inspectedAtMs: rtMs_(g('Inspected At')),
      inspectedBy: String(g('Inspected By') || ''),
      inspectionNote: String(g('Inspection Note') || ''),
      fullReturn: String(g('Full Return') || '') === 'Y',
      informedBy: String(g('Customer Informed By') || ''),
      informedAtMs: rtMs_(g('Customer Informed At')),
      alertsSent: String(g('Alerts Sent') || ''),
      history: String(g('History') || '')
    };
  }).filter(function (r) { return r.returnId; });
}

function readReturnLines_() {
  var sheet = rtLinesSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, RT_LINE_HEADERS.length).getValues().map(function (r, i) {
    return { row: i + 2, returnId: String(r[0] || ''), trackerId: String(r[1] || ''), product: String(r[2] || ''),
      qtyRequested: Number(r[3]) || 0, qtyReceived: r[4] === '' || r[4] === null ? null : Number(r[4]) || 0,
      outcome: String(r[5] || ''), note: String(r[6] || '') };
  }).filter(function (l) { return l.returnId; });
}
function rtLinesFor_(returnId, allLines) {
  return (allLines || readReturnLines_()).filter(function (l) { return l.returnId === returnId; });
}

function rtWrite_(row, fields) {
  var sheet = rtSheet_();
  Object.keys(fields).forEach(function (k) {
    var cell = sheet.getRange(row, rtCol_(k) + 1);
    if (k === 'Refund UTR') cell.setNumberFormat('@');
    cell.setValue(fields[k]);
  });
}
function rtHistory_(r, text) {
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM HH:mm');
  r.history = (r.history ? r.history + ' | ' : '') + stamp + ' ' + text;
  return r.history;
}
function rtFind_(returnId) {
  var id = String(returnId || '').trim().toUpperCase();
  return readReturns_().filter(function (r) { return r.returnId.toUpperCase() === id; })[0] || null;
}
function rtInr_(n) { return 'Rs. ' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }

/** Ordered, already returned and still returnable quantity per product on an order. */
function rtReturnable_(trackerId, returns, lines) {
  var t = String(trackerId).toLowerCase();
  var counted = {};
  (returns || readReturns_()).forEach(function (r) {
    if (r.trackerId.toLowerCase() === t && r.status !== 'Declined' && r.status !== 'Withdrawn') counted[r.returnId] = r;
  });
  var back = {};
  (lines || readReturnLines_()).forEach(function (l) {
    if (!counted[l.returnId]) return;
    var k = l.product.toLowerCase();
    // Once logged in at the gate, what actually came back counts; until then, what was asked for.
    back[k] = (back[k] || 0) + (l.qtyReceived === null ? l.qtyRequested : l.qtyReceived);
  });
  var ordered = {};
  getOrderLineItems_(trackerId).forEach(function (it) {
    var k = String(it.product).toLowerCase();
    if (!ordered[k]) ordered[k] = { product: String(it.product), ordered: 0 };
    ordered[k].ordered += Number(it.quantity) || 0;
  });
  return Object.keys(ordered).map(function (k) {
    var o = ordered[k];
    return { product: o.product, ordered: o.ordered, returned: back[k] || 0, available: Math.max(0, o.ordered - (back[k] || 0)) };
  });
}

// ================================================================
// For the order drawer (lookupOrder_)
// ================================================================
function rtInfoForOrder_(trackerId, raw) {
  var all = readReturns_(), lines = readReturnLines_();
  var t = String(trackerId).toLowerCase();
  var mine = all.filter(function (r) { return r.trackerId.toLowerCase() === t; });
  var status = String(raw['Status'] || '');
  var atGate = (typeof gateWaitingFromValues_ === 'function') ? gateWaitingFromValues_(raw['Status'], raw['Dispatch Type'], raw['Gate Pass Issued Timestamp'], raw['Gate Out Timestamp']) : false;
  var returnable = rtReturnable_(trackerId, all, lines);
  var pending = mine.filter(function (r) { return r.status === 'Pending'; })[0];
  var canRaise = isDispatchedStatus_(status) && !atGate && !pending && returnable.some(function (l) { return l.available > 0; });
  return {
    canRaise: canRaise,
    whyNot: !isDispatchedStatus_(status) ? (status === 'Cancelled' ? 'Cancelled order.' : 'Not dispatched yet – use a cancellation instead.')
      : atGate ? 'Still at the gate.' : pending ? 'A return request is already waiting for the admin.' : !canRaise ? 'Everything on this order is already being returned.' : '',
    reasons: RT_REASONS, resolutions: RT_RESOLUTIONS, comingBack: RT_COMING_BACK,
    returnable: returnable,
    amountReceived: Number(raw['Advance Received']) || 0,
    balanceDue: computeBalanceDue(raw['Total Order Value'], raw['Advance Received']),
    today: todayYmd_(),
    list: mine.slice().reverse().map(function (r) { return rtItem_(r, lines); })
  };
}

/** One return, as the pages show it. */
function rtItem_(r, lines) {
  var ls = rtLinesFor_(r.returnId, lines);
  var credit = rtCreditLeft_(r);
  var stageText;
  switch (r.status) {
    case 'Pending': stageText = 'Waiting for the admin'; break;
    case 'Declined': stageText = 'Declined' + (r.adminNote ? ' – ' + r.adminNote : ''); break;
    case 'Withdrawn': stageText = 'Withdrawn'; break;
    case 'Approved': stageText = 'Approved – waiting for the goods at the gate' + (r.expectedYmd ? ' (expected ' + fmtYmd_(r.expectedYmd) + ')' : ''); break;
    case 'Arrived': stageText = 'Goods in at the gate – waiting for inspection'; break;
    case 'Inspected': stageText = 'Goods in and inspected'; break;
    case 'Closed': stageText = 'Closed – customer informed'; break;
    default: stageText = r.status;
  }
  return {
    returnId: r.returnId, trackerId: r.trackerId, institution: r.institution, reason: r.reason, details: r.details,
    status: r.status, stageText: stageText, requestedByName: r.requestedByName, requestedBy: r.requestedBy, ownerCode: r.ownerCode,
    requestedAt: rtFmt_(r.requestedAtMs), comingBackBy: r.comingBackBy, expected: r.expectedYmd ? fmtYmd_(r.expectedYmd) : '',
    proposedResolution: r.proposedResolution, decidedBy: r.decidedBy, decidedAt: rtFmt_(r.decidedAtMs), adminNote: r.adminNote,
    goodsValue: r.goodsValue, reduceBy: r.reduceBy, resolution: r.resolution, resolutionAmount: r.resolutionAmount,
    refundStatus: r.refundStatus, refundDeadline: r.refundDeadlineYmd ? fmtYmd_(r.refundDeadlineYmd) : '',
    refundDaysLeft: r.refundDeadlineYmd ? cxDaysUntil_(r.refundDeadlineYmd) : null, refundUtr: r.refundUtr,
    refundProcessedAt: rtFmt_(r.refundProcessedAtMs), creditLeft: credit, creditUsed: r.creditUsed, creditUsedOn: r.creditUsedOn,
    arrivedAt: rtFmt_(r.arrivedAtMs), arrivedBy: r.arrivedBy, inspectedAt: rtFmt_(r.inspectedAtMs), inspectedBy: r.inspectedBy,
    inspectionNote: r.inspectionNote, fullReturn: r.fullReturn, informedAt: rtFmt_(r.informedAtMs),
    lines: ls.map(function (l) { return { product: l.product, qtyRequested: l.qtyRequested, qtyReceived: l.qtyReceived, outcome: l.outcome, note: l.note }; })
  };
}

// ================================================================
// 1. CRE raises a return
// ================================================================
/**
 * form = { trackerId, reason, details, lines: [{ product, qty }], comingBackBy,
 *          expectedBy (yyyy-MM-dd), proposedResolution }
 */
function requestReturn_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var reason = String(form.reason || '').trim();
  if (RT_REASONS.indexOf(reason) === -1) throw new Error('Choose why the goods are coming back.');
  var details = String(form.details || '').trim().slice(0, 1000);
  if (details.length < 5) throw new Error('Add a line on what happened' + (reason.indexOf('DACC') === 0 ? ' – and, if the customer took part of it, what they accepted.' : '.'));
  var comingBack = String(form.comingBackBy || '').trim();
  if (RT_COMING_BACK.indexOf(comingBack) === -1) throw new Error('Say how the goods are coming back.');
  var expected = String(form.expectedBy || '').trim();
  if (expected && !/^\d{4}-\d{2}-\d{2}$/.test(expected)) throw new Error('Choose the date the goods are expected back, or leave it blank.');
  var proposed = String(form.proposedResolution || '').trim();
  if (proposed && RT_RESOLUTIONS.indexOf(proposed) === -1) proposed = '';

  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String(form.trackerId || ''));
  if (row === -1) throw new Error('Order not found.');
  requireCanAct_(sheet, row);
  var f = getRowFields(sheet, row, ['Tracker ID', 'Institution / Customer', 'Status', 'Total Order Value', 'Advance Received', 'CRE Code', 'CRE Name',
    'Order Type', 'Dispatch Type', 'Gate Pass Issued Timestamp', 'Gate Out Timestamp']);
  var trackerId = String(f['Tracker ID']);
  if (!isDispatchedStatus_(f['Status'])) {
    throw new Error(f['Status'] === 'Cancelled' ? 'This order is cancelled.' : 'This order hasn’t been dispatched yet – nothing to return. If the customer doesn’t want it, request a cancellation instead.');
  }
  if (typeof gateWaitingFromValues_ === 'function' && gateWaitingFromValues_(f['Status'], f['Dispatch Type'], f['Gate Pass Issued Timestamp'], f['Gate Out Timestamp'])) {
    throw new Error('The vehicle hasn’t left the gate yet – speak to Ops instead of raising a return.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var returnId, cleanLines;
  try {
    var all = readReturns_(), allLines = readReturnLines_();
    var waiting = all.filter(function (r) { return r.trackerId.toLowerCase() === trackerId.toLowerCase() && r.status === 'Pending'; })[0];
    if (waiting) throw new Error('A return request is already waiting for the admin (' + waiting.returnId + '). Withdraw it first to change it.');
    var avail = {};
    rtReturnable_(trackerId, all, allLines).forEach(function (l) { avail[l.product.toLowerCase()] = l; });
    var seen = {};
    cleanLines = (form.lines || []).map(function (l) { return { product: String(l.product || '').trim(), qty: Math.floor(Number(l.qty) || 0) }; })
      .filter(function (l) { return l.product && l.qty > 0; });
    if (!cleanLines.length) throw new Error('Enter how many of which product are coming back.');
    cleanLines.forEach(function (l) {
      var a = avail[l.product.toLowerCase()];
      if (!a) throw new Error(l.product + ' isn’t on this order.');
      if (seen[l.product.toLowerCase()]) throw new Error(l.product + ' is listed twice.');
      seen[l.product.toLowerCase()] = true;
      if (l.qty > a.available) throw new Error('Only ' + a.available + ' of ' + l.product + ' can come back (' + a.ordered + ' ordered' + (a.returned ? ', ' + a.returned + ' already on a return' : '') + ').');
      l.product = a.product;
    });
    returnId = 'RT-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd') + '-' + Utilities.getUuid().split('-')[0].slice(0, 4).toUpperCase();
    var vals = RT_HEADERS.map(function () { return ''; });
    var set = function (k, v) { vals[rtCol_(k)] = v; };
    set('Return ID', returnId);
    set('Requested At', new Date());
    set('Tracker ID', trackerId);
    set('Institution / Customer', f['Institution / Customer']);
    set('Owner Code', resolveOwnerCode_(f['CRE Code'], f['CRE Name']) || '');
    set('Requested By', me.code);
    set('Requested By Name', me.name);
    set('Reason', reason);
    set('Details', details);
    set('Order Type', normalizeOrderType_(f['Order Type']));
    set('Order Value', Number(f['Total Order Value']) || 0);
    set('Amount Received', Number(f['Advance Received']) || 0);
    set('Coming Back By', comingBack);
    set('Expected By', expected ? rtDate_(expected) : '');
    set('Proposed Resolution', proposed);
    set('Status', 'Pending');
    set('History', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM HH:mm') + ' Requested by ' + me.name);
    rtSheet_().appendRow(vals);
    var ls = rtLinesSheet_();
    var start = ls.getLastRow() + 1;
    ls.getRange(start, 1, cleanLines.length, RT_LINE_HEADERS.length).setValues(cleanLines.map(function (l) {
      return [returnId, trackerId, l.product, l.qty, '', '', ''];
    }));
  } finally {
    lock.releaseLock();
  }

  var url = appUrl_();
  cxMail_(cxEmailsFor_(['Admin']), [], 'Return request: ' + trackerId + ' – ' + f['Institution / Customer'],
    '<p><b>' + cxEsc_(me.name) + '</b> is asking to take goods back.</p>' +
    '<p>Order: <b>' + cxEsc_(trackerId) + '</b> – ' + cxEsc_(f['Institution / Customer']) + '<br>' +
    'Reason: <b>' + cxEsc_(reason) + '</b><br>' + cxEsc_(details) + '</p>' +
    '<p>Coming back: ' + cleanLines.map(function (l) { return l.qty + ' × ' + cxEsc_(l.product); }).join(', ') + '<br>' +
    'By: ' + cxEsc_(comingBack) + (expected ? ', expected ' + fmtYmd_(expected) : '') + '</p>' +
    '<p>Order value ' + cxInr_(f['Total Order Value']) + ' · received ' + cxInr_(f['Advance Received']) +
    (proposed ? '<br>The CRE suggests: <b>' + cxEsc_(proposed) + '</b>' : '') + '</p>',
    url ? url + '?page=admin&req=' + encodeURIComponent(returnId) : '', 'Review request');
  return { returnId: returnId, trackerId: trackerId };
}

/** CRE (who raised it, or the owner) or Admin: pull back a waiting request. form = { returnId } */
function withdrawReturn_(form) {
  var me = CURRENT_STAFF_;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var r = rtFind_((form || {}).returnId);
    if (!r) throw new Error('Return not found.');
    if (r.status !== 'Pending') throw new Error('This return is already ' + r.status.toLowerCase() + ' – nothing to withdraw.');
    if (me.role !== 'Admin' && me.code !== r.requestedBy && me.code !== r.ownerCode) throw new Error('Only ' + r.requestedByName + ' or an admin can withdraw it.');
    rtWrite_(r.row, { 'Status': 'Withdrawn', 'Decided By': 'Withdrawn by ' + me.name, 'Decided At': new Date(), 'Customer Informed At': new Date(),
      'History': rtHistory_(r, 'Withdrawn by ' + me.name) });
    return { returnId: r.returnId, trackerId: r.trackerId };
  } finally {
    lock.releaseLock();
  }
}

// ================================================================
// 2. Admin decides
// ================================================================
function getReturnsAdmin_() {
  var all = readReturns_(), lines = readReturnLines_();
  var staff = getStaffMap_(false);
  var orders = {};
  opsReadOrders_().rows.forEach(function (o) {
    orders[String(o.get('Tracker ID')).toLowerCase()] = {
      total: Number(o.get('Total Order Value')) || 0, advance: Number(o.get('Advance Received')) || 0,
      balance: computeBalanceDue(o.get('Total Order Value'), o.get('Advance Received'))
    };
  });
  var map = function (r) {
    var it = rtItem_(r, lines);
    var o = orders[r.trackerId.toLowerCase()] || {};
    it.ownerName = ((staff[r.ownerCode] || {}).name) || r.ownerCode;
    it.orderType = r.orderType;
    it.orderValueNow = o.total || r.orderValue;
    it.amountReceivedNow = o.advance != null ? o.advance : r.amountReceived;
    it.balanceNow = o.balance || 0;
    it.returnable = r.status === 'Pending' ? rtReturnable_(r.trackerId, all, lines) : null;
    return it;
  };
  return {
    pending: all.filter(function (r) { return r.status === 'Pending'; }).map(map),
    open: all.filter(function (r) { return RT_OPEN_STATUSES.indexOf(r.status) !== -1; }).reverse().map(map),
    recent: all.filter(function (r) { return r.status !== 'Pending' && RT_OPEN_STATUSES.indexOf(r.status) === -1; }).reverse().slice(0, 40).map(map),
    resolutions: RT_RESOLUTIONS
  };
}

/**
 * Admin: form = { returnId, approve, note, goodsValue, reduceBy, resolution, amount, refundDays, refundNow }
 */
function decideReturn_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var note = String(form.note || '').trim();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var r, out;
  try {
    r = rtFind_(form.returnId);
    if (!r) throw new Error('Return not found.');
    if (r.status !== 'Pending') throw new Error('This return was already ' + r.status.toLowerCase() + (r.decidedBy ? ' by ' + r.decidedBy : '') + '.');
    var now = new Date();
    if (!form.approve) {
      if (!note) throw new Error('Add a short note for the CRE saying why it’s declined.');
      rtWrite_(r.row, { 'Status': 'Declined', 'Decided By': me.name, 'Decided At': now, 'Admin Note': note,
        'History': rtHistory_(r, 'Declined by ' + me.name + ': ' + note) });
      out = { returnId: r.returnId, trackerId: r.trackerId, declined: true };
    } else {
      var sheet = getSheet();
      var row = findRowByTrackerId(sheet, r.trackerId);
      if (row === -1) throw new Error('The order ' + r.trackerId + ' is no longer in the tracker.');
      var f = getRowFields(sheet, row, ['Total Order Value', 'Advance Received', 'Original Order Value', 'Remarks', 'Order Type', 'DACC Outcome']);
      var total = Number(f['Total Order Value']) || 0, received = Number(f['Advance Received']) || 0;
      var balance = computeBalanceDue(total, received);
      var goodsValue = rtNum_(form.goodsValue);
      var reduceBy = rtNum_(form.reduceBy);
      var resolution = String(form.resolution || '');
      if (RT_RESOLUTIONS.indexOf(resolution) === -1) throw new Error('Choose what the customer gets for what they’ve paid.');
      var amount = resolution === 'Nothing due' ? 0 : rtNum_(form.amount);
      var refundDays = Math.floor(Number(form.refundDays) || 0);
      if (goodsValue < 0 || reduceBy < 0 || amount < 0) throw new Error('Amounts can’t be negative.');
      if (reduceBy > balance + BALANCE_DUE_TOLERANCE) {
        throw new Error('The customer owes only ' + cxInr_(balance) + ' on this order, so it can be reduced by that much at most. Anything they’ve already paid is handled by the refund / credit.');
      }
      if (resolution !== 'Nothing due') {
        if (!(amount > 0)) throw new Error('Enter the ' + (resolution === 'Refund' ? 'refund' : 'credit') + ' amount, or choose “Nothing due”.');
        if (amount > received + 0.5) throw new Error('The ' + (resolution === 'Refund' ? 'refund' : 'credit') + ' can’t be more than the ' + cxInr_(received) + ' received on this order.');
      }
      if (resolution === 'Refund' && !form.refundNow && (refundDays < 1 || refundDays > 60)) throw new Error('Say how many days after the goods are in Accounts has to refund (1 to 60).');
      if (!reduceBy && resolution === 'Nothing due' && !note) throw new Error('Nothing is reduced or given back – add a note saying why (e.g. “Goods returned for repair, sent back free”).');

      // Write off what the customer never paid for -- straight away, so the CRE stops chasing it.
      if (reduceBy > 0) {
        var newTotal = Math.round((total - reduceBy) * 100) / 100;
        var fields = { 'Total Order Value': newTotal,
          'Remarks': (f['Remarks'] ? String(f['Remarks']) + ' | ' : '') + 'Order value reduced by ' + rtInr_(reduceBy) + ' for return ' + r.returnId + ' (' + me.name + ', ' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd-MMM-yyyy') + ')' };
        if (!(Number(f['Original Order Value']) > 0)) fields['Original Order Value'] = total;
        if (computeBalanceDue(newTotal, received) <= 0) fields['Payment Follow-up Date'] = '';
        setRowFields(sheet, row, fields);
        writeAdvancePct_(sheet, row, received, newTotal);
      }
      if (normalizeOrderType_(f['Order Type']) === ORDER_TYPE_DACC && r.reason.indexOf('DACC') === 0) {
        var whole = rtLinesFor_(r.returnId).reduce(function (s, l) { return s + l.qtyRequested; }, 0) >=
          getOrderLineItems_(r.trackerId).reduce(function (s, it) { return s + (Number(it.quantity) || 0); }, 0);
        setRowFields(sheet, row, { 'DACC Outcome': (whole ? 'Rejected at inspection' : 'Partly accepted') + ' – return ' + r.returnId });
      }
      var refundStatus = resolution === 'Refund' ? (form.refundNow ? RT_REFUND_PROCESSING : RT_REFUND_WAITING) : RT_REFUND_NONE;
      var deadline = '';
      if (resolution === 'Refund' && form.refundNow) {
        deadline = Utilities.formatDate(new Date(now.getTime() + Math.max(1, refundDays || 7) * 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      rtWrite_(r.row, {
        'Status': 'Approved', 'Decided By': me.name, 'Decided At': now, 'Admin Note': note,
        'Goods Value': goodsValue || '', 'Reduce Order Value By': reduceBy || '', 'Resolution': resolution, 'Resolution Amount': amount || '',
        'Refund Days': resolution === 'Refund' ? (refundDays || 7) : '', 'Refund Now': form.refundNow && resolution === 'Refund' ? 'Y' : '',
        'Refund Deadline': deadline ? rtDate_(deadline) : '', 'Refund Status': refundStatus,
        'History': rtHistory_(r, 'Approved by ' + me.name + ': ' + resolution + (amount ? ' ' + rtInr_(amount) : '') + (reduceBy ? ', order value reduced by ' + rtInr_(reduceBy) : ''))
      });
      out = { returnId: r.returnId, trackerId: r.trackerId, approved: true, resolution: resolution, amount: amount, reduceBy: reduceBy,
              refundNow: !!(form.refundNow && resolution === 'Refund'), deadline: deadline ? fmtYmd_(deadline) : '' };
    }
  } finally {
    lock.releaseLock();
  }

  var url = appUrl_();
  var creTo = [cxEmailOf_(r.requestedBy)], creCc = r.ownerCode && r.ownerCode !== r.requestedBy ? [cxEmailOf_(r.ownerCode)] : [];
  var head = '<p>Return <b>' + cxEsc_(r.returnId) + '</b> – order ' + cxEsc_(r.trackerId) + ', ' + cxEsc_(r.institution) + '</p>';
  if (out.declined) {
    cxMail_(creTo, creCc, 'Return declined: ' + r.trackerId, head + '<p>' + cxEsc_(me.name) + ' declined it.<br>Note: ' + cxEsc_(note) + '</p>', url, 'Open the CRE page');
  } else {
    var what = out.resolution === 'Refund' ? 'a refund of <b>' + cxInr_(out.amount) + '</b>' + (out.refundNow ? ', with Accounts now (due ' + cxEsc_(out.deadline) + ')' : ', paid by Accounts once the goods are in at the gate')
      : out.resolution === 'Replacement order' ? 'a replacement: log it as a new PO with “Apply return credit” = <b>' + cxEsc_(r.returnId) + '</b> (credit ' + cxInr_(out.amount) + ')'
      : out.resolution === 'Credit on a future order' ? 'credit of <b>' + cxInr_(out.amount) + '</b> for their next order – use “Apply return credit” = ' + cxEsc_(r.returnId)
      : 'nothing further';
    cxMail_(creTo, creCc, 'Return approved: ' + r.trackerId,
      head + '<p>' + cxEsc_(me.name) + ' approved the return.' + (note ? '<br>Note: ' + cxEsc_(note) : '') + '</p>' +
      (out.reduceBy ? '<p>What the customer owes on the order was reduced by <b>' + cxInr_(out.reduceBy) + '</b>.</p>' : '') +
      '<p>The customer gets ' + what + '.</p><p>Sanju logs the goods in at the gate.</p>', url, 'Open the CRE page');
    var gate = cxEmailsFor_(['Gate']);
    if (gate.length) {
      cxMail_(gate, [], 'Goods coming back: ' + r.trackerId + ' – ' + r.institution,
        head + '<p>Coming back by ' + cxEsc_(r.comingBackBy) + (r.expectedYmd ? ', expected ' + fmtYmd_(r.expectedYmd) : '') + ':<br>' +
        rtLinesFor_(r.returnId).map(function (l) { return l.qtyRequested + ' × ' + cxEsc_(l.product); }).join('<br>') + '</p>' +
        '<p>Log them in on the Gate page when they arrive, and record what each one should go to.</p>', url ? url + '?page=gate' : '', 'Open the Gate page');
    }
    if (out.refundNow) rtMailAccountsRefund_(rtFind_(r.returnId), me);
  }
  return out;
}

function rtMailAccountsRefund_(r, me) {
  if (!r) return;
  var url = appUrl_();
  cxMail_(cxEmailsFor_(['Accounts']), cxEmailsFor_(['Admin']), 'Refund to process by ' + fmtYmd_(r.refundDeadlineYmd) + ': return ' + r.returnId + ' – ' + cxInr_(r.resolutionAmount),
    '<p>Refund for the return <b>' + cxEsc_(r.returnId) + '</b> – order ' + cxEsc_(r.trackerId) + ', ' + cxEsc_(r.institution) + '.</p>' +
    '<p>Refund amount: <b>' + cxInr_(r.resolutionAmount) + '</b><br>Refund by: <b>' + cxEsc_(fmtYmd_(r.refundDeadlineYmd)) + '</b><br>Approved by ' + cxEsc_(r.decidedBy) +
    (r.adminNote ? ' – ' + cxEsc_(r.adminNote) : '') + '</p>' +
    '<p style="color:#666;font-size:12px;">Once paid, find it under “Refunds to process” on the Accounts page and enter the UTR.</p>',
    url ? url + '?page=accounts' : '', 'Open the Accounts page');
}

// ================================================================
// 3. Gate: goods in, inspection
// ================================================================
function getReturnsGate_() {
  var lines = readReturnLines_();
  var all = readReturns_();
  var item = function (r) {
    var it = rtItem_(r, lines);
    it.expectedYmd = r.expectedYmd;
    it.overdue = r.status === 'Approved' && r.expectedYmd && r.expectedYmd < todayYmd_();
    return it;
  };
  return {
    expected: all.filter(function (r) { return r.status === 'Approved'; }).map(item)
      .sort(function (a, b) { return (a.expectedYmd || '9') < (b.expectedYmd || '9') ? -1 : 1; }),
    toInspect: all.filter(function (r) { return r.status === 'Arrived'; }).map(item),
    doneToday: all.filter(function (r) { return r.inspectedAtMs && rtYmd_(new Date(r.inspectedAtMs)) === todayYmd_(); }).map(item),
    outcomes: RT_OUTCOMES
  };
}

/**
 * Sanju: the goods are in. form = { returnId, lines: [{ product, qtyReceived, outcome, note }], note, inspectNow }
 * inspectNow = also record the inspection (outcome per product) in the same step.
 */
function logReturnArrival_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var r, res;
  try {
    r = rtFind_(form.returnId);
    if (!r) throw new Error('Return not found.');
    if (r.status !== 'Approved') throw new Error(r.status === 'Arrived' || r.status === 'Inspected' ? 'Already logged in at ' + rtFmt_(r.arrivedAtMs) + '.' : 'This return isn’t approved (it’s ' + r.status.toLowerCase() + ').');
    var lines = rtLinesFor_(r.returnId);
    var given = {};
    (form.lines || []).forEach(function (l) { given[String(l.product || '').toLowerCase()] = l; });
    var anything = 0;
    lines.forEach(function (l) {
      var g = given[l.product.toLowerCase()] || {};
      var q = Math.floor(Number(g.qtyReceived));
      if (isNaN(q) || q < 0) throw new Error('Enter how many of ' + l.product + ' came in (0 if none).');
      if (q > l.qtyRequested) throw new Error(q + ' of ' + l.product + ' is more than the ' + l.qtyRequested + ' on the return. Check the count, or ask the CRE to raise another return.');
      if (form.inspectNow && q > 0 && RT_OUTCOMES.indexOf(String(g.outcome || '')) === -1) throw new Error('Choose what happens to ' + l.product + ' (restock, repair, scrap or another customer).');
      l.qtyReceived = q; l.outcome = q > 0 && form.inspectNow ? String(g.outcome) : ''; l.note = String(g.note || '').trim().slice(0, 300);
      anything += q;
    });
    if (!anything) throw new Error('Nothing came in? Leave it on the list until the goods arrive.');
    var ls = rtLinesSheet_();
    lines.forEach(function (l) { ls.getRange(l.row, 5, 1, 3).setValues([[l.qtyReceived, l.outcome, l.note]]); });
    var now = new Date();
    var fields = { 'Status': form.inspectNow ? 'Inspected' : 'Arrived', 'Arrived At': now, 'Arrived By': me.name + ' (' + me.code + ')' };
    var short = lines.filter(function (l) { return l.qtyReceived < l.qtyRequested; });
    var hist = 'In at the gate (' + me.name + '): ' + lines.map(function (l) { return l.qtyReceived + '/' + l.qtyRequested + ' ' + l.product; }).join(', ');
    if (form.inspectNow) {
      fields['Inspected At'] = now; fields['Inspected By'] = me.name + ' (' + me.code + ')';
      fields['Inspection Note'] = String(form.note || '').trim().slice(0, 500);
      hist += '; inspected: ' + lines.filter(function (l) { return l.outcome; }).map(function (l) { return l.product + ' → ' + l.outcome; }).join(', ');
    }
    // Refund: due once the goods are in.
    if (r.refundStatus === RT_REFUND_WAITING) {
      var dl = Utilities.formatDate(new Date(now.getTime() + Math.max(1, r.refundDays || 7) * 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      fields['Refund Status'] = RT_REFUND_PROCESSING; fields['Refund Deadline'] = rtDate_(dl);
      r.refundDeadlineYmd = dl;
    }
    // Is the whole order back now?
    var full = rtReturnable_(r.trackerId).every(function (x) { return x.available === 0; }) && short.length === 0;
    if (full) fields['Full Return'] = 'Y';
    fields['History'] = rtHistory_(r, hist);
    rtWrite_(r.row, fields);
    if (full) {
      var sheet = getSheet();
      var row = findRowByTrackerId(sheet, r.trackerId);
      if (row !== -1) setRowFields(sheet, row, { 'Delivery Status': 'Returned', 'Delivery Status Last Updated': now });
    }
    res = { returnId: r.returnId, trackerId: r.trackerId, inspected: !!form.inspectNow, fullReturn: full, short: short.length,
            refundToAccounts: r.refundStatus === RT_REFUND_WAITING, lines: lines };
  } finally {
    lock.releaseLock();
  }
  if (res.refundToAccounts) { r.refundStatus = RT_REFUND_PROCESSING; rtMailAccountsRefund_(rtFind_(r.returnId), me); }
  rtMailCre_(r, 'Goods back in: return ' + r.returnId,
    '<p>The goods for return <b>' + cxEsc_(r.returnId) + '</b> (order ' + cxEsc_(r.trackerId) + ', ' + cxEsc_(r.institution) + ') are in at the gate – logged by ' + cxEsc_(me.name) + '.</p>' +
    '<p>' + res.lines.map(function (l) { return l.qtyReceived + ' of ' + l.qtyRequested + ' × ' + cxEsc_(l.product) + (l.outcome ? ' → ' + cxEsc_(l.outcome) : '') + (l.note ? ' (' + cxEsc_(l.note) + ')' : ''); }).join('<br>') + '</p>' +
    (res.short ? '<p><b>Less came back than expected.</b> Check with the customer / transporter.</p>' : '') +
    (res.refundToAccounts ? '<p>The refund is now with Accounts.</p>' : ''));
  return { returnId: res.returnId, trackerId: res.trackerId, inspected: res.inspected, fullReturn: res.fullReturn, short: res.short };
}

/** Sanju: inspection for goods already logged in. form = { returnId, lines: [{ product, outcome, note }], note } */
function recordReturnInspection_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var r, lines;
  try {
    r = rtFind_(form.returnId);
    if (!r) throw new Error('Return not found.');
    if (r.status !== 'Arrived') throw new Error(r.status === 'Inspected' || r.status === 'Closed' ? 'Already inspected.' : 'Log the goods in first.');
    lines = rtLinesFor_(r.returnId);
    var given = {};
    (form.lines || []).forEach(function (l) { given[String(l.product || '').toLowerCase()] = l; });
    lines.forEach(function (l) {
      if (!(l.qtyReceived > 0)) return;
      var g = given[l.product.toLowerCase()] || {};
      if (RT_OUTCOMES.indexOf(String(g.outcome || '')) === -1) throw new Error('Choose what happens to ' + l.product + '.');
      l.outcome = String(g.outcome);
      if (g.note !== undefined) l.note = String(g.note || '').trim().slice(0, 300);
    });
    var ls = rtLinesSheet_();
    lines.forEach(function (l) { ls.getRange(l.row, 6, 1, 2).setValues([[l.outcome, l.note]]); });
    rtWrite_(r.row, { 'Status': 'Inspected', 'Inspected At': new Date(), 'Inspected By': me.name + ' (' + me.code + ')',
      'Inspection Note': String(form.note || '').trim().slice(0, 500),
      'History': rtHistory_(r, 'Inspected by ' + me.name + ': ' + lines.filter(function (l) { return l.outcome; }).map(function (l) { return l.product + ' → ' + l.outcome; }).join(', ')) });
  } finally {
    lock.releaseLock();
  }
  rtMailCre_(r, 'Inspected: return ' + r.returnId,
    '<p>' + cxEsc_(me.name) + ' inspected the goods for return <b>' + cxEsc_(r.returnId) + '</b> (order ' + cxEsc_(r.trackerId) + '):</p><p>' +
    lines.filter(function (l) { return l.outcome; }).map(function (l) { return l.qtyReceived + ' × ' + cxEsc_(l.product) + ' → ' + cxEsc_(l.outcome) + (l.note ? ' (' + cxEsc_(l.note) + ')' : ''); }).join('<br>') + '</p>');
  return { returnId: r.returnId, trackerId: r.trackerId };
}

function rtMailCre_(r, subject, html) {
  try {
    cxMail_([cxEmailOf_(r.requestedBy)], r.ownerCode && r.ownerCode !== r.requestedBy ? [cxEmailOf_(r.ownerCode)] : [], subject, html, appUrl_(), 'Open the CRE page');
  } catch (e) { Logger.log('return email failed: ' + e); }
}

// ================================================================
// 4. Accounts: refunds (shown in the cancellations' "Refunds to process" pane)
// ================================================================
function rtRefundsToProcess_() {
  return readReturns_().filter(function (r) { return r.refundStatus === RT_REFUND_PROCESSING; }).map(function (r) {
    return {
      requestId: r.returnId, kind: 'Return', trackerId: r.trackerId, institution: r.institution, refundAmount: r.resolutionAmount,
      amountReceived: r.amountReceived, deadline: r.refundDeadlineYmd ? fmtYmd_(r.refundDeadlineYmd) : '',
      daysLeft: r.refundDeadlineYmd ? cxDaysUntil_(r.refundDeadlineYmd) : null, approvedBy: r.decidedBy, approvedAt: rtFmt_(r.decidedAtMs),
      adminNote: (r.reason ? 'Return – ' + r.reason : 'Return') + (r.adminNote ? '. ' + r.adminNote : ''), cre: r.requestedByName
    };
  });
}

/** Accounts: form = { requestId (RT-...), utr, note } */
function rtMarkRefundProcessed_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var utr = String(form.utr || '').trim();
  if (utr.length < 6) throw new Error('Enter the UTR / bank reference of the refund.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var r;
  try {
    r = rtFind_(form.requestId);
    if (!r) throw new Error('Refund not found.');
    if (r.refundStatus !== RT_REFUND_PROCESSING) throw new Error('This refund is ' + (r.refundStatus || 'not open').toLowerCase() + '.');
    rtWrite_(r.row, { 'Refund Status': RT_REFUND_PROCESSED, 'Refund UTR': utr, 'Refund Note': String(form.note || '').trim(),
      'Refund Processed By': me.name, 'Refund Processed At': new Date(), 'History': rtHistory_(r, 'Refund processed by ' + me.name + ', UTR ' + utr) });
  } finally {
    lock.releaseLock();
  }
  rtMailCre_(r, 'Refund processed: return ' + r.returnId + ' – ' + cxInr_(r.resolutionAmount),
    '<p>Accounts (' + cxEsc_(me.name) + ') has refunded <b>' + cxInr_(r.resolutionAmount) + '</b> for return <b>' + cxEsc_(r.returnId) + '</b> (order ' + cxEsc_(r.trackerId) + ', ' + cxEsc_(r.institution) + ').<br>UTR: <b>' + cxEsc_(utr) + '</b></p>' +
    '<p>Tell the customer, then tick “Informed the customer” under Requests on the CRE page.</p>');
  var late = r.refundDeadlineYmd ? cxDaysUntil_(r.refundDeadlineYmd) : null;
  return { requestId: r.returnId, trackerId: r.trackerId, late: late !== null && late < 0 ? -late : 0 };
}

// ================================================================
// 5. CRE: Requests pane, close-out
// ================================================================
function getReturnsPanel_() {
  var me = CURRENT_STAFF_;
  var lines = readReturnLines_();
  var cutoff = Date.now() - 3 * 86400000;
  return readReturns_().filter(function (r) {
    if (me.role !== 'Admin' && r.requestedBy !== me.code && r.ownerCode !== me.code) return false;
    if (r.status === 'Closed' || r.status === 'Withdrawn') return false;
    if (r.status === 'Declined') return !r.informedAtMs && r.decidedAtMs > cutoff;
    return true;
  }).map(function (r) {
    var it = rtItem_(r, lines);
    it.canAck = rtCanClose_(r);
    it.ackLabel = r.status === 'Declined' ? 'Seen' : 'Informed the customer';
    it.waitingOn = r.status === 'Pending' ? 'admin' : r.status === 'Approved' ? 'gate' : r.status === 'Arrived' ? 'inspection'
      : r.refundStatus === RT_REFUND_PROCESSING ? 'accounts' : '';
    it.whenMs = Math.max(r.requestedAtMs || 0, r.decidedAtMs || 0, r.arrivedAtMs || 0, r.inspectedAtMs || 0, r.refundProcessedAtMs || 0);
    return it;
  }).sort(function (a, b) { return (b.canAck ? 1 : 0) - (a.canAck ? 1 : 0) || b.whenMs - a.whenMs; });
}

function rtCanClose_(r) {
  if (r.status === 'Declined') return true;
  if (r.status !== 'Inspected') return false;
  return r.refundStatus !== RT_REFUND_WAITING && r.refundStatus !== RT_REFUND_PROCESSING;
}

/** CRE: form = { returnId } -- the customer has been told; the return is closed. */
function acknowledgeReturn_(form) {
  var me = CURRENT_STAFF_;
  var r = rtFind_((form || {}).returnId);
  if (!r) throw new Error('Return not found.');
  if (me.role !== 'Admin' && r.requestedBy !== me.code && r.ownerCode !== me.code) throw new Error('This isn’t your return.');
  if (!rtCanClose_(r)) throw new Error(r.refundStatus === RT_REFUND_PROCESSING ? 'Wait until Accounts has paid the refund.' : 'Not finished yet – the goods have to be in and inspected first.');
  rtWrite_(r.row, { 'Status': r.status === 'Declined' ? 'Declined' : 'Closed', 'Customer Informed By': me.name, 'Customer Informed At': new Date(),
    'History': rtHistory_(r, (r.status === 'Declined' ? 'Seen by ' : 'Customer informed by ') + me.name) });
  return { returnId: r.returnId, trackerId: r.trackerId };
}

// ================================================================
// Return credit -- used on a replacement or a later order (submitOrder_)
// ================================================================
function rtCreditLeft_(r) {
  if (RT_OPEN_STATUSES.concat(['Closed']).indexOf(r.status) === -1) return 0;
  if (r.resolution !== 'Replacement order' && r.resolution !== 'Credit on a future order') return 0;
  return Math.max(0, Math.round((r.resolutionAmount - r.creditUsed) * 100) / 100);
}

/** Checks a credit for a new order. Returns { returnId, amount, originalTrackerId }. Throws a message for the CRE. */
function rtCheckCredit_(returnId, total, cashAdvance) {
  var r = rtFind_(returnId);
  if (!r) throw new Error('Return credit “' + returnId + '” not found – check the return ID (it starts with RT-).');
  if (r.resolution !== 'Replacement order' && r.resolution !== 'Credit on a future order') throw new Error(r.returnId + ' doesn’t carry a credit (' + (r.resolution || r.status) + ').');
  if (RT_OPEN_STATUSES.concat(['Closed']).indexOf(r.status) === -1) throw new Error(r.returnId + ' isn’t approved.');
  var left = rtCreditLeft_(r);
  if (!(left > 0)) throw new Error('The credit on ' + r.returnId + ' is already used (' + r.creditUsedOn + ').');
  var room = Math.max(0, Math.round(((Number(total) || 0) - (Number(cashAdvance) || 0)) * 100) / 100);
  if (!(room > 0)) throw new Error('The advance already covers the order value – there’s nothing left to pay from the return credit.');
  return { returnId: r.returnId, amount: Math.min(left, room), left: left, originalTrackerId: r.trackerId };
}

/** Called by submitOrder_ (inside its lock) once the new order row is written. */
function rtConsumeCredit_(returnId, newTrackerId, amount) {
  var r = rtFind_(returnId);
  if (!r) return;
  rtWrite_(r.row, { 'Credit Used': Math.round((r.creditUsed + amount) * 100) / 100,
    'Credit Used On': (r.creditUsedOn ? r.creditUsedOn + ', ' : '') + newTrackerId + ' (' + rtInr_(amount) + ')',
    'History': rtHistory_(r, rtInr_(amount) + ' credit used on ' + newTrackerId) });
  try {
    var sheet = getSheet();
    var row = findRowByTrackerId(sheet, r.trackerId);
    if (row !== -1) {
      var cur = String(getRowFields(sheet, row, ['Linked Tracker ID'])['Linked Tracker ID'] || '');
      setRowFields(sheet, row, { 'Linked Tracker ID': (cur ? cur + ', ' : '') + newTrackerId });
    }
  } catch (e) { Logger.log('link original order failed: ' + e); }
}

/** For the New PO form: open credits for a customer name (CRE types the RT-id or picks one). */
function getReturnCredits_(query) {
  var q = String(query || '').trim().toLowerCase();
  return readReturns_().filter(function (r) {
    if (!(rtCreditLeft_(r) > 0)) return false;
    return !q || r.returnId.toLowerCase().indexOf(q) !== -1 || r.institution.toLowerCase().indexOf(q) !== -1 || r.trackerId.toLowerCase().indexOf(q) !== -1;
  }).slice(0, 20).map(function (r) {
    return { returnId: r.returnId, trackerId: r.trackerId, institution: r.institution, creditLeft: rtCreditLeft_(r), resolution: r.resolution };
  });
}

// ================================================================
// Hooks used by other files
// ================================================================
/** Waiting requests, for the admin's approvals counter. */
function rtPendingList_() {
  return readReturns_().filter(function (r) { return r.status === 'Pending'; }).map(function (r) {
    return { requestId: r.returnId, requestedAtMs: r.requestedAtMs };
  });
}

function returnsApiMap_() {
  return {
    requestReturn:           { fn: requestReturn_,           roles: ['CRE'], log: 'Requested return' },
    withdrawReturn:          { fn: withdrawReturn_,          roles: ['CRE'], log: 'Withdrew return request' },
    getReturnsPanel:         { fn: getReturnsPanel_,         roles: ['CRE'] },
    acknowledgeReturn:       { fn: acknowledgeReturn_,       roles: ['CRE'], log: 'Closed return – customer informed' },
    getReturnCredits:        { fn: getReturnCredits_,        roles: ['CRE'] },
    getReturnsAdmin:         { fn: getReturnsAdmin_,         roles: [] },
    decideReturn:            { fn: decideReturn_,            roles: [], log: 'Decided return' },
    getReturnsGate:          { fn: getReturnsGate_,          roles: ['Gate'] },
    logReturnArrival:        { fn: logReturnArrival_,        roles: ['Gate'], log: 'Return goods in at gate' },
    recordReturnInspection:  { fn: recordReturnInspection_,  roles: ['Gate'], log: 'Inspected returned goods' }
  };
}

function returnsActivityDetail_(fnName, a, result) {
  a = a || {}; result = result || {};
  switch (fnName) {
    case 'requestReturn': return (result.returnId || '') + ' – ' + (a.reason || '') + ': ' + (a.lines || []).map(function (l) { return l.qty + ' x ' + l.product; }).join(', ');
    case 'withdrawReturn': return result.returnId || a.returnId || '';
    case 'decideReturn': return (a.returnId || '') + ' – ' + (result.declined ? 'declined' : 'approved: ' + (result.resolution || '') + (result.amount ? ' Rs. ' + result.amount : '') + (result.reduceBy ? ', order value -Rs. ' + result.reduceBy : ''));
    case 'logReturnArrival': return (result.returnId || a.returnId || '') + (result.inspected ? ' – in and inspected' : ' – in, inspection later') + (result.fullReturn ? ' (whole order back)' : '') + (result.short ? ' – ' + result.short + ' line(s) short' : '');
    case 'recordReturnInspection': return result.returnId || a.returnId || '';
    case 'acknowledgeReturn': return a.returnId || '';
    default: return '';
  }
}
