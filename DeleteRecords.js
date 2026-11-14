/**
 * DELETE A RECORD (Nov 2026) -- Admin page
 * ---------------------------------------------------------------------
 * For entries made by mistake (a duplicate order, the wrong customer, a
 * rental logged twice). Hari, 14 Nov 2026: the admin must be able to wipe
 * an entry completely from inside the tool, because deleting rows in the
 * sheet by hand leaves stray rows behind in other tabs and the dashboards
 * then count things that no longer exist.
 *
 * What it does
 *   Order  -- the same clean-up as "Delete test entries" (purgeOrders_ in
 *             TestCleanup.js): files to the Drive trash, the Tracker row, and
 *             every row in any tab with a "Tracker ID" / "Came With Order"
 *             column naming the order (line items, standby, payment
 *             exceptions and waivers, cancellations, returns, excess
 *             payments, access requests, Activity / Notification Log).
 *             If the order used a return credit, that credit goes back to the
 *             return so it can be used again.
 *   Rental -- rnPurgeRentals_ (Rental.js) in "real" mode: every Rental tab,
 *             the logs and the files. Items on the rental are released back
 *             to the yard (never deleted -- their ID is stencilled on).
 *
 * Decided with Hari (14 Nov 2026)
 *   - Admin (and Directors) can delete at any stage, verified or not; the
 *     pane warns about money already received and goods already sent.
 *   - Nothing of the record is kept. Only ONE line goes into the
 *     "Deletion Log" tab: when, Order/Rental, the ID, customer, the stage it
 *     was at, who deleted it and why. No dashboard reads that tab, and its
 *     ID column is headed "Deleted ID" (not "Tracker ID") so no clean-up or
 *     report ever treats it as order data.
 *   - The admin must give a reason and type the ID to confirm.
 *
 * Blocked (with the reason shown): an order whose return credit was used on
 * another order that still exists -- delete or correct that order first.
 */
var DELETION_LOG_SHEET_NAME = 'Deletion Log';
var DELETION_LOG_HEADERS = ['Deleted At', 'Record Type', 'Deleted ID', 'Customer', 'Stage When Deleted', 'Deleted By', 'Reason'];
var DEL_ORDER_FIELDS = ['Tracker ID', 'Institution / Customer', 'Customer Phone Number', 'CRE Name', 'Status', 'Delivery Status',
  'Payment Terms Type', 'Order Type', 'Total Order Value', 'Advance Received', 'Verified By', 'Received by Ops Timestamp',
  'Gate Out Timestamp', 'Dispatch Timestamp', 'Return Credit Applied', 'Return Credit Ref'];

// ================================================================
// Find + preview
// ================================================================
/** Admin: look up what to delete. query = quotation no., rental ID, phone or customer name. */
function getDeletePreview_(query) {
  var q = String(query == null ? '' : query).trim();
  if (!q) throw new Error('Enter a quotation number, rental ID, phone number or customer name.');
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = getSheet();

  var row = findRowByTrackerId(sheet, q);
  if (row !== -1) return delOrderPreview_(ss, sheet, row);
  var rctx = delRentalCtx_();
  if (rctx) {
    var ro = rnFind_(rctx.orders, q);
    if (ro) return delRentalPreview_(rctx, ro);
  }

  var matches = [];
  try {
    var found = findOrders_(q);
    if (found.order && found.order.trackerId) {
      var r2 = findRowByTrackerId(sheet, String(found.order.trackerId));
      if (r2 !== -1) return delOrderPreview_(ss, sheet, r2);
    }
    (found.matches || []).forEach(function (m) {
      matches.push({ kind: 'order', id: m.trackerId, customer: m.institution, status: m.status });
    });
  } catch (e) { /* no order hits */ }
  if (rctx) {
    var key = q.toLowerCase().replace(/\s+/g, '');
    rctx.orders.rows.forEach(function (o) {
      var hay = [o['Rental ID'], o['Customer'], o['Customer Phone'], o['Site District']].join(' ').toLowerCase().replace(/\s+/g, '');
      if (hay.indexOf(key) !== -1) matches.push({ kind: 'rental', id: String(o['Rental ID']), customer: String(o['Customer'] || ''), status: String(o['Status'] || '') });
    });
  }
  if (!matches.length) throw new Error('Nothing found. Try the quotation number, rental ID, phone number or part of the customer name.');
  return { matches: matches.slice(0, 15) };
}

/** Rental tables, or null if Rentals were never set up. */
function delRentalCtx_() {
  try { return rnLoad_(); } catch (e) { return null; }
}

function delInr_(n) { return '₹' + formatAmount(Math.round((Number(n) || 0) * 100) / 100); }

/** Everything the admin needs to see before deleting an order. */
function delOrderPreview_(ss, sheet, row) {
  var f = getRowFields(sheet, row, DEL_ORDER_FIELDS);
  var id = String(f['Tracker ID']).trim();
  var status = String(f['Status'] || '');
  var dispatched = !!(f['Gate Out Timestamp'] || f['Dispatch Timestamp']) ||
    ['Posted', 'Gate-Verified', 'Delivered', 'Closed', 'Filed'].indexOf(status) !== -1 || /deliver/i.test(String(f['Delivery Status'] || ''));
  var verified = status !== 'Logged' && status !== '' && !!f['Verified By'];
  var picked = !!f['Received by Ops Timestamp'];
  var stage = status === 'Cancelled' ? 'Cancelled'
    : dispatched ? 'Dispatched' + (f['Delivery Status'] ? ' (' + f['Delivery Status'] + ')' : '')
    : picked ? 'Picked up by Ops'
    : verified ? 'Payment verified'
    : 'Logged, not verified';

  var ids = {}; ids[id.toLowerCase()] = true;
  var tabs = orderRefRows_(ss, sheet, ids).map(function (t) { return { tab: t.name, rows: t.rows.length }; });
  var fileUrls = TEST_FILE_COLS.filter(function (c) { return String(getRowFields(sheet, row, [c])[c] || '').trim(); }).length;

  var warnings = [], blockers = [];
  var received = Number(f['Advance Received']) || 0;
  if (verified && received > 0) warnings.push(delInr_(received) + ' recorded as received will disappear from collections and every dashboard. Accounts will have a bank entry with no order behind it.');
  if (dispatched) warnings.push('The goods have already left the factory. If this is a real order, use cancellation or a return instead.');
  else if (picked) warnings.push('Ops has already picked this order up – tell Ops to pull the printed PO.');
  var credit = Number(f['Return Credit Applied']) || 0, creditRef = String(f['Return Credit Ref'] || '').trim();
  if (credit > 0 && creditRef) warnings.push('This order used ' + delInr_(credit) + ' of return credit from ' + creditRef + '. That credit goes back to the return so it can be used again.');

  // A return on this order whose credit went to another order that still exists.
  delReturnsOf_(id).forEach(function (r) {
    delCreditUsers_(r).forEach(function (other) {
      if (findRowByTrackerId(sheet, other) !== -1) blockers.push('Return ' + r.returnId + ' on this order gave its credit to order ' + other + '. Delete or correct ' + other + ' first.');
    });
  });

  return {
    kind: 'order', id: id, customer: String(f['Institution / Customer'] || ''), phone: String(f['Customer Phone Number'] || ''),
    cre: String(f['CRE Name'] || ''), status: status, stage: stage, terms: String(f['Payment Terms Type'] || 'End Customer'),
    orderType: String(f['Order Type'] || ''), total: Number(f['Total Order Value']) || 0, received: received,
    tabs: tabs, files: fileUrls, warnings: warnings, blockers: blockers
  };
}

/** Returns (Returns tab) raised on this order. [] if the Returns module isn't there. */
function delReturnsOf_(trackerId) {
  if (typeof readReturns_ !== 'function') return [];
  try {
    var t = String(trackerId).toLowerCase();
    return readReturns_().filter(function (r) { return String(r.trackerId).toLowerCase() === t; });
  } catch (e) { return []; }
}

/** Order IDs a return's credit was used on ("ID (₹x), ID2 (₹y)"). */
function delCreditUsers_(r) {
  return String(r.creditUsedOn || '').split(',').map(function (x) { return x.replace(/\s*\(.*$/, '').trim(); }).filter(function (x) { return x; });
}

/** Everything the admin needs to see before deleting a rental. */
function delRentalPreview_(ctx, o) {
  var id = String(o['Rental ID']).toUpperCase();
  var tabs = [];
  ['orders', 'payments', 'config', 'trips', 'deployments', 'offhires', 'jobs'].forEach(function (k) {
    var n = rnOf_(ctx[k], id).length;
    if (n) tabs.push({ tab: RENTAL_TABLES[k].name, rows: n });
  });
  var onIt = ctx.items.rows.filter(function (it) { return String(it['Rental ID'] || '').toUpperCase() === id; });
  var out = onIt.filter(function (it) { return RI_OUT.indexOf(String(it['Status'])) !== -1; });
  var received = rnOf_(ctx.payments, id).filter(function (l) { return l['Status'] === 'Verified'; })
    .reduce(function (s, l) { return s + rnNum_(l['Amount Received']); }, 0);
  var status = String(o['Status'] || '');

  var warnings = [];
  if (received > 0) warnings.push(delInr_(received) + ' recorded as received on this rental will disappear from collections and the rental dashboard.');
  if (out.length) warnings.push(out.length + ' item(s) are recorded as out of the yard on this rental (' + out.map(function (it) { return it['Item ID']; }).slice(0, 12).join(', ') +
    (out.length > 12 ? '…' : '') + '). They will show as Available in the yard – make sure they are physically back.');
  else if (onIt.length) warnings.push(onIt.length + ' item(s) allocated to this rental will be released back to the yard.');

  return {
    kind: 'rental', id: id, customer: String(o['Customer'] || ''), phone: String(o['Customer Phone'] || ''), cre: String(o['CRE Name'] || ''),
    status: status, stage: 'Rental – ' + (status || 'no status'), total: rnNum_(o['Order Value']), received: received,
    tabs: tabs, files: [o['Agreement URL']].filter(function (u) { return u; }).length, items: onIt.length,
    warnings: warnings, blockers: []
  };
}

// ================================================================
// Delete
// ================================================================
/**
 * Admin / Director: delete one order or rental completely.
 * form = { kind: 'order'|'rental', id, reason, confirmId (typed by the admin, must equal id) }
 */
function deleteRecord_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  if (!me || (me.role !== 'Admin' && me.role !== 'Director')) throw new Error('Only an admin or a director can delete a record.');
  var kind = form.kind === 'rental' ? 'rental' : 'order';
  var id = String(form.id || '').trim();
  var reason = String(form.reason || '').trim();
  if (!id) throw new Error('Choose the record to delete.');
  if (reason.length < 5) throw new Error('Say why it is being deleted.');
  if (String(form.confirmId || '').trim().toLowerCase() !== id.toLowerCase()) throw new Error('The ID you typed doesn’t match ' + id + '. Nothing was deleted.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('The tracker is busy – try again in a minute. Nothing was deleted.');
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var preview, summary;
  try {
    if (kind === 'order') {
      var sheet = getSheet();
      var row = findRowByTrackerId(sheet, id);
      if (row === -1) throw new Error('Order ' + id + ' is no longer in the tracker – it may already have been deleted.');
      preview = delOrderPreview_(ss, sheet, row); // re-checked inside the lock
      if (preview.blockers.length) throw new Error(preview.blockers.join(' '));
      id = preview.id;
      var values = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
      delGiveBackCredit_(id, values);
      var res = purgeOrders_(ss, sheet, [{ row: row, id: id, values: values }], {});
      summary = 'Order ' + id + ' deleted. ' + res.filesTrashed + ' file(s) moved to the Drive trash; ' + res.otherRows +
        ' row(s) removed from other tabs' + (res.report.length ? ' (' + res.report.join(', ') + ')' : '') + '.';
    } else {
      var ctx = delRentalCtx_();
      var o = ctx && rnFind_(ctx.orders, id);
      if (!o) throw new Error('Rental ' + id + ' is no longer there – it may already have been deleted.');
      preview = delRentalPreview_(ctx, o);
      id = preview.id;
      var rr = rnPurgeRentals_([id], { real: true });
      summary = 'Rental ' + id + ' deleted. ' + rr.files + ' file(s) moved to the Drive trash; ' + (rr.released ? rr.released + ' item(s) released back to the yard; ' : '') +
        'rows removed: ' + (rr.report.join(', ') || 'none') + '.';
    }
    delWriteLog_(ss, kind, id, preview.customer, preview.stage, me, reason);
  } finally {
    lock.releaseLock();
  }
  CacheService.getScriptCache().remove('gate_overdue');
  return { deleted: true, kind: kind, id: id, summary: summary };
}

/** The order used a return credit: hand it back to the return, and unlink the original order. */
function delGiveBackCredit_(id, values) {
  var credit = Number(values[HEADERS.indexOf('Return Credit Applied')]) || 0;
  var ref = String(values[HEADERS.indexOf('Return Credit Ref')] || '').trim();
  if (!(credit > 0) || !ref || typeof rtFind_ !== 'function') return;
  var r = rtFind_(ref);
  if (!r) return;
  var lid = id.toLowerCase();
  var usedOn = String(r.creditUsedOn || '').split(',').map(function (x) { return x.trim(); })
    .filter(function (x) { return x && x.replace(/\s*\(.*$/, '').trim().toLowerCase() !== lid; }).join(', ');
  rtWrite_(r.row, {
    'Credit Used': Math.max(0, Math.round((r.creditUsed - credit) * 100) / 100),
    'Credit Used On': usedOn,
    'History': rtHistory_(r, delInr_(credit) + ' credit returned – order ' + id + ' deleted by the admin')
  });
  var sheet = getSheet();
  var orow = findRowByTrackerId(sheet, String(r.trackerId || ''));
  if (orow !== -1) {
    var cur = String(getRowFields(sheet, orow, ['Linked Tracker ID'])['Linked Tracker ID'] || '');
    var left = cur.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x && x.toLowerCase() !== lid; }).join(', ');
    if (left !== cur) setRowFields(sheet, orow, { 'Linked Tracker ID': left });
  }
}

/** The one line kept about a deleted record. */
function delWriteLog_(ss, kind, id, customer, stage, me, reason) {
  var sh = ss.getSheetByName(DELETION_LOG_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(DELETION_LOG_SHEET_NAME, ss.getNumSheets()); // at the end -- never in front of the Tracker
    sh.getRange(1, 1, 1, DELETION_LOG_HEADERS.length).setValues([DELETION_LOG_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(2, 3, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@'); // IDs stay text
  }
  sh.appendRow([new Date(), kind === 'rental' ? 'Rental' : 'Order', id, customer || '', stage || '', me.name + ' (' + me.code + ')', reason]);
}

/** The pane's "Recent deletions" list. */
function getDeletionLog_() {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(DELETION_LOG_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return [];
  var n = Math.min(20, sh.getLastRow() - 1);
  var tz = Session.getScriptTimeZone();
  return sh.getRange(sh.getLastRow() - n + 1, 1, n, DELETION_LOG_HEADERS.length).getValues().reverse().map(function (r) {
    return { at: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'dd-MMM-yyyy, hh:mm a') : String(r[0] || ''),
      kind: String(r[1] || ''), id: String(r[2] || ''), customer: String(r[3] || ''), stage: String(r[4] || ''), by: String(r[5] || ''), reason: String(r[6] || '') };
  });
}

// ================================================================
// Wiring -- Admin always allowed; Directors too. Not logged through callApi on
// purpose: that would write the deleted ID back into the Activity Log.
// ================================================================
function deleteRecordsApiMap_() {
  return {
    getDeletePreview: { fn: getDeletePreview_, roles: ['Director'] },
    deleteRecord:     { fn: deleteRecord_,     roles: ['Director'] },
    getDeletionLog:   { fn: getDeletionLog_,   roles: ['Director'] }
  };
}
