/**
 * OPS LOGIN (Oct 2026) -- Operations works in the system, not on paper
 * ---------------------------------------------------------------------
 * WHY: the tracker made everything visible, and that showed three gaps on
 * the Ops side:
 *   1. Ops was outside the system -- pickup time and gate-pass requests only
 *      reached it through Accounts, typed in from paper.
 *   2. The Internal PO paper could miss Ops' attention while the tracker
 *      said "Sent to Ops".
 *   3. The pickup time was written on paper and typed in later by Accounts,
 *      which left room to write a better time than the real one.
 *
 * FLOW (agreed with Hari, Oct 2026)
 *   CRE logs the order            -> no printout.
 *   Accounts verifies payment     -> no printout; the order appears in the
 *                                    Ops queue (?page=ops).
 *   Ops presses "Acknowledge & pick up"
 *                                 -> the SYSTEM stamps the time (Received by
 *                                    Ops Timestamp), records who, and only
 *                                    then shows the Print PO button and the
 *                                    verification code to write on it.
 *   Vehicle order: Ops enters the vehicle and site readiness and presses
 *     "Request gate pass"         -> status "Vehicle Confirmed" (or "On Hold -
 *                                    Site Not Ready"); it lands in Accounts'
 *                                    Needs Action list. Accounts prints the
 *                                    gate pass as before; Sanju checks it at
 *                                    the gate, so dispatch can't happen
 *                                    without the system.
 *   Courier order: Ops posts the packet and records the courier, tracking
 *     no., time posted and a PHOTO of the postal receipt -> "Posted".
 *   Customer delay: Ops raises the standby request themselves. Admins and
 *     Directors can put an order on standby directly (setStandbyDirect_).
 *
 * NOTHING IS TYPED THAT THE SYSTEM CAN STAMP. The pickup time is the click.
 * The only time Ops types is "posted at" from the postal receipt, and that is
 * backed by the receipt photo.
 *
 * NUDGES (opsSweep_, run every 10 minutes by checkApprovalAlerts, office
 * hours only -- nothing goes out at night, it waits for the morning):
 *   - New orders: one message to Ops with the new ones and the total still
 *     not picked up.
 *   - Not acknowledged within 24 h -> reminder to Ops; 48 h -> escalation to
 *     the first approver (Ananthu), copied to Ops.
 *   - Courier picked up but not recorded as posted within 24 h -> reminder;
 *     48 h -> escalation. (Vehicle orders police themselves at the gate.)
 *   Hours are in the Settings page ("Ops nudges"). Time on standby doesn't
 *   count: the clock restarts when a standby ends.
 *
 * NOTIFICATIONS: every message (to staff or customers) is written to the
 * "Notification Log" tab first. Stage 1 sends staff messages by email where
 * the Staff tab has one; customer messages are QUEUED in the log, ready for
 * WhatsApp in stage 2 -- nothing goes to a customer yet. Customers only get
 * messages if the CRE ticked their consent at intake.
 *
 * GO-LIVE: "Ops login: set up and go live" on the ICF Admin menu
 * (setupOpsLogin) backs the spreadsheet up, writes the new column headers,
 * and marks the orders already with Ops as "cutover" -- treated as picked up
 * at go-live and left out of the pickup-time figures, so Ops doesn't start
 * with a wall of false "overdue" orders. Nothing is sent and no nudge fires
 * until this has run.
 */
var OPS_POSTAL_FOLDER_NAME = 'ICF Postal Receipts';
var NOTIFICATION_LOG_SHEET_NAME = 'Notification Log';
var NOTIFICATION_LOG_HEADERS = ['Timestamp', 'Event', 'Tracker ID', 'Audience', 'Recipient', 'Phone', 'Email', 'Status', 'Message'];
var OPS_GO_LIVE_PROP = 'ops_go_live_ms';
var OPS_BACKUP_PROP = 'ops_backup_url';
var OPS_NEW_HEADERS = ['Ops Code', 'Picked Up By', 'Ops Cutover', 'Gate Pass Requested By', 'Postal Receipt URL',
  'Customer Email', 'Customer Updates Consent', 'Ops Alerts Sent', 'Customer Updates Sent'];
var OPS_MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
// Receipt photo for courier postings: optional for now (Hari, Oct 2026). Set to
// true to make it required again -- the Ops page follows this automatically.
var OPS_RECEIPT_PHOTO_REQUIRED = false;

// [label, default, explanation] -- shown on the Settings page under "Ops nudges".
var OPS_SETTINGS_ROWS = [
  ['Ops: acknowledge new orders within (hours)', '24', 'After Accounts verifies an order, Ops gets a reminder if it isn’t picked up in the system within this many hours.'],
  ['Ops: escalate unacknowledged orders after (hours)', '48', 'Goes to the first approver (Approvers above), copied to Ops.'],
  ['Ops: record courier posting within (hours)', '24', 'After Ops picks up a courier order, a reminder if the postal receipt isn’t recorded within this many hours.'],
  ['Ops: escalate unrecorded courier posting after (hours)', '48', 'Goes to the first approver, copied to Ops.']
];
// Kept in the Settings tab only (not on the Settings page) until Sambhu decides the escalation matrix.
var CUSTOMER_SETTINGS_ROWS = [
  ['Customer messages: escalation level 2 (name & phone)', '', 'Shown to customers after their CRE, e.g. "Ananthu, Operations Manager, 98xxxxxxxx". Blank = not shown.'],
  ['Customer messages: escalation level 3 (name & phone)', '', 'e.g. a director. Blank = not shown.']
];
var OPS_HOURS_CEILING = 336; // 14 days

// ================================================================
// Settings + small helpers
// ================================================================
function opsGoLiveMs_() {
  return Number(PropertiesService.getScriptProperties().getProperty(OPS_GO_LIVE_PROP) || 0) || 0;
}

/** Ops nudge hours and the customer escalation lines. Cached 5 minutes (cleared when Settings are saved). */
function getOpsSettings_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('ops_settings');
  if (hit) return JSON.parse(hit);
  var map = sbReadSettingsMap_();
  var hours = function (i) {
    var raw = map[OPS_SETTINGS_ROWS[i][0].toLowerCase()];
    var v = Number(String(raw == null ? '' : raw).replace(/[,\s]/g, ''));
    if (raw === undefined || raw === '' || isNaN(v)) v = Number(OPS_SETTINGS_ROWS[i][1]);
    return Math.min(OPS_HOURS_CEILING, Math.max(1, Math.floor(v)));
  };
  var text = function (row) { return String(map[row[0].toLowerCase()] || '').trim(); };
  var s = {
    ackHours: hours(0), ackEscalateHours: hours(1), postHours: hours(2), postEscalateHours: hours(3),
    esc2: text(CUSTOMER_SETTINGS_ROWS[0]), esc3: text(CUSTOMER_SETTINGS_ROWS[1])
  };
  if (s.ackEscalateHours <= s.ackHours) s.ackEscalateHours = s.ackHours * 2;
  if (s.postEscalateHours <= s.postHours) s.postEscalateHours = s.postHours * 2;
  cache.put('ops_settings', JSON.stringify(s), 300);
  return s;
}

function opsEsc_(t) {
  return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}
function opsMs_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getTime();
  return 0;
}
function opsFmt_(v) {
  var ms = typeof v === 'number' ? v : opsMs_(v);
  return ms ? Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'dd-MMM, hh:mm a') : '';
}
function opsFmtDate_(v) {
  var ms = opsMs_(v);
  return ms ? Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '';
}
function opsStamp_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM HH:mm'); }

/** True once Ops has the order: acknowledged in the system, or already with Ops at go-live. */
function opsIsAcked_(ackVal, cutoverVal) {
  return !!opsMs_(ackVal) || String(cutoverVal || '').trim().toUpperCase() === 'Y';
}

/** Every order row in one read: [{ row, get(header) }]. */
function opsReadOrders_() {
  var sheet = getSheet();
  var last = getLastOrderRow_(sheet);
  if (last < 2) return { sheet: sheet, rows: [] };
  var data = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var C = {};
  HEADERS.forEach(function (h, i) { C[h] = i; });
  var rows = [];
  data.forEach(function (r, i) {
    if (!String(r[C['Tracker ID']] || '').trim()) return;
    rows.push({ row: i + 2, get: function (h) { return r[C[h]]; } });
  });
  return { sheet: sheet, rows: rows };
}

/** { trackerIdLower: latest standby end (ms) } -- a standby restarts the Ops clocks. */
function opsStandbyEnds_() {
  var out = {};
  if (typeof readStandby_ !== 'function') return out;
  try {
    readStandby_().forEach(function (r) {
      if (!r.endedAtMs) return;
      var k = r.trackerId.toLowerCase();
      if (!out[k] || r.endedAtMs > out[k]) out[k] = r.endedAtMs;
    });
  } catch (e) { Logger.log('opsStandbyEnds_ failed: ' + e); }
  return out;
}

/** Active Ops staff as notification recipients. */
function opsPeople_(staffMap) {
  return Object.keys(staffMap).map(function (k) { return staffMap[k]; })
    .filter(function (s) { return s.active && s.role === 'Ops'; });
}

function staffRecipient_(s) {
  return { audience: 'staff', code: s.code, name: s.name, email: /@/.test(s.email || '') ? s.email : '', phone: staffPhone_(s.code) };
}

// ================================================================
// Ops page -- queue and one order
// ================================================================
/** One order as a queue card. startMs = when its current Ops clock started. */
function opsCard_(o, nowMs, startMs, limitHours) {
  var priority = String(o.get('Priority Level') || 'Normal');
  var hours = startMs ? Math.floor((nowMs - startMs) / 3600000) : null;
  var reqDate = o.get('Customer Requested Delivery Date');
  return {
    trackerId: String(o.get('Tracker ID')),
    institution: String(o.get('Institution / Customer') || ''),
    location: [o.get('District'), o.get('State')].filter(function (x) { return String(x || '').trim(); }).join(', '),
    priority: priority === 'High' ? 'High' : 'Normal',
    dispatchType: normalizeDispatchType_(o.get('Dispatch Type')),
    status: String(o.get('Status') || ''),
    creName: String(o.get('CRE Name') || ''),
    verifiedAt: opsFmt_(o.get('Verified Date')),
    pickedUpBy: String(o.get('Picked Up By') || ''),
    pickedUpAt: opsFmt_(o.get('Received by Ops Timestamp')),
    cutover: String(o.get('Ops Cutover') || '').toUpperCase() === 'Y',
    vehicleNo: String(o.get('Vehicle No.') || ''),
    gatePassRequestedAt: opsFmt_(o.get('Vehicle Confirmed Timestamp')),
    requestedDelivery: opsFmtDate_(reqDate),
    daysUntilDelivery: computeDaysUntilDate(reqDate),
    hoursWaiting: hours,
    overdue: hours !== null && limitHours ? hours >= limitHours : false,
    startMs: startMs || 0
  };
}

/** Ops page: everything on the Ops side, grouped the way Ops works through it. */
function getOpsQueue_() {
  var cfg = getOpsSettings_();
  var now = Date.now();
  var goLive = opsGoLiveMs_();
  var ends = opsStandbyEnds_();
  var data = opsReadOrders_();
  var out = { newOrders: [], inHand: [], late: [], siteHold: [], gatePass: [], dispatchedToday: [], standby: [] };
  var today = todayYmd_();
  var tz = Session.getScriptTimeZone();
  data.rows.forEach(function (o) {
    var status = String(o.get('Status') || '');
    // Late for delivery (Oct 2026): still with Ops (not dispatched, not on standby) and past the wanted-by date.
    if (status === 'Sent to Ops' || status === 'On Hold - Site Not Ready' || status === 'Vehicle Confirmed') {
      var due = computeDaysUntilDate(o.get('Customer Requested Delivery Date'));
      if (due !== null && due < 0) out.late.push(opsCard_(o, now, 0, 0));
    }
    // Dispatched today: gate pass issued or posting recorded today.
    if (isDispatchedStatus_(status)) {
      var dms = opsMs_(o.get('Dispatch Timestamp'));
      if (dms && Utilities.formatDate(new Date(dms), tz, 'yyyy-MM-dd') === today) {
        var dc = opsCard_(o, now, 0, 0);
        dc.dispatchedAt = opsFmt_(dms);
        dc.gatePassNo = String(o.get('Gate Pass No.') || '');
        dc.trackingNo = String(o.get('Tracking / Consignment No.') || '');
        out.dispatchedToday.push(dc);
      }
    }
    var id = String(o.get('Tracker ID'));
    var endMs = ends[id.toLowerCase()] || 0;
    var acked = opsIsAcked_(o.get('Received by Ops Timestamp'), o.get('Ops Cutover'));
    var courier = normalizeDispatchType_(o.get('Dispatch Type')) === DISPATCH_COURIER;
    if (status === 'Sent to Ops' && !acked) {
      out.newOrders.push(opsCard_(o, now, Math.max(opsMs_(o.get('Sent to Ops Timestamp')), endMs), cfg.ackHours));
    } else if (status === 'Sent to Ops') {
      var ackMs = opsMs_(o.get('Received by Ops Timestamp')) || goLive;
      out.inHand.push(opsCard_(o, now, Math.max(ackMs, endMs), courier ? cfg.postHours : 0));
    } else if (status === 'On Hold - Site Not Ready') {
      out.siteHold.push(opsCard_(o, now, 0, 0));
    } else if (status === 'Vehicle Confirmed') {
      out.gatePass.push(opsCard_(o, now, opsMs_(o.get('Vehicle Confirmed Timestamp')), 0));
    } else if (typeof STATUS_STANDBY !== 'undefined' && status === STATUS_STANDBY) {
      out.standby.push(opsCard_(o, now, 0, 0));
    }
  });
  // High priority first, then whatever has waited longest.
  var byUrgency = function (a, b) {
    if (a.priority !== b.priority) return a.priority === 'High' ? -1 : 1;
    return (a.startMs || Infinity) - (b.startMs || Infinity);
  };
  ['newOrders', 'inHand', 'siteHold', 'gatePass', 'standby'].forEach(function (k) { out[k].sort(byUrgency); });
  out.late.sort(function (a, b) { return (a.daysUntilDelivery || 0) - (b.daysUntilDelivery || 0); }); // most overdue first
  out.dispatchedToday.sort(function (a, b) { return a.dispatchedAt < b.dispatchedAt ? 1 : -1; });
  out.summary = {
    newOrders: out.newOrders.length,
    newOverdue: out.newOrders.filter(function (c) { return c.overdue; }).length,
    inHand: out.inHand.length,
    inHandOverdue: out.inHand.filter(function (c) { return c.overdue; }).length,
    siteHold: out.siteHold.length,
    gatePass: out.gatePass.length,
    standby: out.standby.length,
    late: out.late.length,
    dispatchedToday: out.dispatchedToday.length
  };
  out.ackHours = cfg.ackHours;
  out.postHours = cfg.postHours;
  out.live = goLive > 0;
  return out;
}

/** Ops page: one order in full. The print link and verification code only appear once Ops has picked it up. */
function getOpsOrder_(query) {
  var sheet = getSheet();
  var row = findRowByTrackerId(sheet, String(query || '').trim());
  if (row === -1) {
    // Quotation no. (whole or part), phone or customer name -- same search as the
    // CRE and Accounts pages, including close spellings (Oct 2026).
    var found = findOrders_(query);
    if (found.order) row = findRowByTrackerId(sheet, found.order.trackerId);
    else if (found.matches && found.matches.length) {
      return { matches: found.matches.map(function (m) {
        return { trackerId: m.trackerId, institution: m.institution, status: m.status, matchedOn: m.matchedOn };
      }), fuzzy: !!found.fuzzy };
    }
    if (row === -1) throw new Error('No order found. Try the quotation number, phone number or part of the customer name.');
  }
  var f = getRowFields(sheet, row, [
    'Tracker ID', 'Institution / Customer', 'Customer Phone Number', 'CRE Name', 'CRE Code', 'Status', 'Priority Level',
    'Customer Requested Delivery Date', 'Dispatch Type', 'State', 'District', 'Pincode', 'Verified Date',
    'Sent to Ops Timestamp', 'Received by Ops Timestamp', 'Picked Up By', 'Ops Cutover', 'Verification Code',
    'Wrapper PO PDF URL', 'Vehicle No.', 'Site Readiness Confirmed', 'Gate Pass Requested By', 'Vehicle Confirmed Timestamp',
    'Gate Pass No.', 'Dispatch Timestamp', 'Courier / Transport Name', 'Tracking / Consignment No.',
    'Postal Receipt URL', 'Delivery Status'
  ]);
  var id = String(f['Tracker ID']);
  var acked = opsIsAcked_(f['Received by Ops Timestamp'], f['Ops Cutover']);
  var ownerCode = resolveOwnerCode_(f['CRE Code'], f['CRE Name']);
  var status = String(f['Status'] || '');
  return {
    trackerId: id,
    institution: String(f['Institution / Customer'] || ''),
    phone: String(f['Customer Phone Number'] || ''),
    location: [f['District'], f['State']].filter(function (x) { return String(x || '').trim(); }).join(', ') + (f['Pincode'] ? ' – ' + f['Pincode'] : ''),
    creName: String(f['CRE Name'] || ''),
    crePhone: ownerCode ? staffPhone_(ownerCode) : '',
    status: status,
    priority: f['Priority Level'] === 'High' ? 'High' : 'Normal',
    dispatchType: normalizeDispatchType_(f['Dispatch Type']),
    requestedDelivery: opsFmtDate_(f['Customer Requested Delivery Date']),
    verifiedAt: opsFmt_(f['Verified Date']),
    sentToOpsAt: opsFmt_(f['Sent to Ops Timestamp']),
    acked: acked,
    cutover: String(f['Ops Cutover'] || '').toUpperCase() === 'Y',
    pickedUpBy: String(f['Picked Up By'] || ''),
    pickedUpAt: opsFmt_(f['Received by Ops Timestamp']),
    verificationCode: acked ? String(f['Verification Code'] || '') : '',
    wrapperPdfUrl: acked ? String(f['Wrapper PO PDF URL'] || '') : '',
    vehicleNo: String(f['Vehicle No.'] || ''),
    siteReady: String(f['Site Readiness Confirmed'] || ''),
    gatePassRequestedBy: String(f['Gate Pass Requested By'] || ''),
    gatePassRequestedAt: opsFmt_(f['Vehicle Confirmed Timestamp']),
    gatePassNo: String(f['Gate Pass No.'] || ''),
    dispatchedAt: opsFmt_(f['Dispatch Timestamp']),
    courierName: String(f['Courier / Transport Name'] || ''),
    trackingNo: String(f['Tracking / Consignment No.'] || ''),
    postalReceiptUrl: String(f['Postal Receipt URL'] || ''),
    receiptPhotoRequired: OPS_RECEIPT_PHOTO_REQUIRED,
    deliveryStatus: String(f['Delivery Status'] || ''),
    products: getOrderLineItems_(id),
    standby: (typeof standbyInfoForOrder_ === 'function') ? standbyInfoForOrder_(id, status) : null,
    pendingRequest: (typeof pendingRequestFor_ === 'function') ? pendingRequestFor_(id) : null
  };
}

// ================================================================
// Ops actions
// ================================================================
/**
 * "Acknowledge & pick up". The time is the click -- it can't be typed or
 * changed. form = { trackerId }. Deliberately NOT blocked by a pending
 * admin request: picking the paper up is a fact, and blocking it would only
 * push Ops back to paper.
 */
function opsAssertLive_() {
  if (!opsGoLiveMs_()) throw new Error('The Ops login isn\u2019t switched on yet \u2013 the admin runs "Ops login: set up and go live" first. Keep working as before until then.');
}

function acknowledgeOrder_(form) {
  opsAssertLive_();
  var me = CURRENT_STAFF_;
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String((form && form.trackerId) || ''));
  if (row === -1) throw new Error('Order not found.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var f, now = new Date();
  try {
    f = getRowFields(sheet, row, ['Tracker ID', 'Status', 'Received by Ops Timestamp', 'Ops Cutover', 'Picked Up By',
      'Wrapper PO PDF URL', 'Verification Code', 'Dispatch Type']);
    if (opsIsAcked_(f['Received by Ops Timestamp'], f['Ops Cutover'])) {
      throw new Error('Already picked up' + (f['Picked Up By'] ? ' by ' + f['Picked Up By'] : '') +
        (opsMs_(f['Received by Ops Timestamp']) ? ' at ' + opsFmt_(f['Received by Ops Timestamp']) : '') + '.');
    }
    if (f['Status'] !== 'Sent to Ops') {
      throw new Error(typeof STATUS_STANDBY !== 'undefined' && f['Status'] === STATUS_STANDBY
        ? 'This order is on standby (customer delay). It comes back to your queue when the standby ends.'
        : 'This order is at "' + f['Status'] + '". Only orders Accounts has verified and sent to Ops can be picked up.');
    }
    setRowFields(sheet, row, { 'Received by Ops Timestamp': now, 'Ops Code': me.code, 'Picked Up By': me.name });
  } finally {
    lock.releaseLock();
  }
  // The PO is made now, with the verification and pick-up printed on it. The
  // pick-up is already saved -- if the PDF fails, Ops can press "Prepare PO".
  var pdfUrl = '', poError = '';
  try { pdfUrl = opsBuildPo_(sheet, row); } catch (e) { poError = 'The PO couldn\u2019t be prepared (' + e.message + '). Tap "Prepare PO" to try again.'; }
  return {
    trackerId: String(f['Tracker ID']), pickedUpAt: opsFmt_(now), pickedUpBy: me.name,
    wrapperPdfUrl: pdfUrl, poError: poError, verificationCode: String(f['Verification Code'] || ''),
    dispatchType: normalizeDispatchType_(f['Dispatch Type'])
  };
}

/**
 * Builds the Wrapper PO from what the system knows (see generateWrapperPdf)
 * and saves its link in "Wrapper PO PDF URL". Returns the link.
 */
function opsBuildPo_(sheet, row) {
  var f = getRowFields(sheet, row, ['Tracker ID', 'Date Logged', 'Institution / Customer', 'CRE Name', 'Total Order Value',
    'Advance Received', 'Customer Requested Delivery Date', 'Priority Level', 'Payment Terms Type', 'State', 'District',
    'Pincode', 'Dispatch Type', 'Verified By', 'Verified Date', 'Verification Code', 'Bank Reference / UTR',
    'Picked Up By', 'Received by Ops Timestamp', 'Ops Cutover']);
  var id = String(f['Tracker ID']);
  var total = Number(f['Total Order Value']) || 0, advance = Number(f['Advance Received']) || 0;
  var pct = total > 0 ? Math.round((advance / total) * 1000) / 10 : 0;
  var pickedAt = opsFmt_(f['Received by Ops Timestamp']);
  var url = generateWrapperPdf(id, f['Date Logged'], String(f['Institution / Customer'] || ''), String(f['CRE Name'] || ''), total, advance, pct,
    f['Customer Requested Delivery Date'] || '', f['Priority Level'] === 'High' ? 'High' : 'Normal', f['Payment Terms Type'] || 'End Customer',
    f['State'], f['District'], f['Pincode'], getOrderLineItems_(id), normalizeDispatchType_(f['Dispatch Type']), {
      verifiedBy: String(f['Verified By'] || ''),
      verifiedAt: opsFmt_(f['Verified Date']),
      verificationCode: String(f['Verification Code'] || ''),
      utr: String(f['Bank Reference / UTR'] || ''),
      pickedUpBy: String(f['Picked Up By'] || '') || (String(f['Ops Cutover'] || '').toUpperCase() === 'Y' ? 'With Ops at go-live' : ''),
      pickedUpAt: pickedAt
    });
  setRowFields(sheet, row, { 'Wrapper PO PDF URL': url });
  return url;
}

/** Ops: make (or re-make) the PO for an order already picked up. form = { trackerId } */
function preparePo_(form) {
  opsAssertLive_();
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String((form && form.trackerId) || ''));
  if (row === -1) throw new Error('Order not found.');
  var f = getRowFields(sheet, row, ['Tracker ID', 'Status', 'Received by Ops Timestamp', 'Ops Cutover']);
  if (!opsIsAcked_(f['Received by Ops Timestamp'], f['Ops Cutover'])) throw new Error('Pick the order up first.');
  if (f['Status'] === 'Cancelled') throw new Error('This order has been cancelled.');
  return { trackerId: String(f['Tracker ID']), wrapperPdfUrl: opsBuildPo_(sheet, row) };
}

// ================================================================
// Accounts -- gate passes Ops has asked for (pop-up from the top tile)
// ================================================================
/** Every order at "Vehicle Confirmed", with what Accounts needs to issue the gate pass in one place. */
function getGatePassQueue_() {
  var data = opsReadOrders_();
  var items = {};
  data.rows.forEach(function (o) {
    if (String(o.get('Status')) !== 'Vehicle Confirmed') return;
    var id = String(o.get('Tracker ID'));
    var terms = String(o.get('Payment Terms Type') || 'End Customer');
    var balance = computeBalanceDue(o.get('Total Order Value'), o.get('Advance Received'));
    var approved = balance > 0 && terms === 'End Customer' ? isPaymentExceptionApproved_(id, PX_DISPATCH) : false;
    var pending = (typeof pendingRequestFor_ === 'function') ? pendingRequestFor_(id) : null;
    items[id.toLowerCase()] = {
      trackerId: id,
      institution: String(o.get('Institution / Customer') || ''),
      location: [o.get('District'), o.get('State')].filter(function (x) { return String(x || '').trim(); }).join(', '),
      priority: o.get('Priority Level') === 'High' ? 'High' : 'Normal',
      vehicleNo: String(o.get('Vehicle No.') || ''),
      requestedBy: String(o.get('Gate Pass Requested By') || ''),
      requestedAt: opsFmt_(o.get('Vehicle Confirmed Timestamp')),
      requestedAtMs: opsMs_(o.get('Vehicle Confirmed Timestamp')),
      paymentTerms: terms,
      balanceDue: balance,
      blocked: terms === 'End Customer' && balance > 0 && !approved,
      approvedBalanceNote: approved ? 'Dispatch with \u20b9' + formatAmount(balance) + ' due was approved \u2013 the gate pass carries the note.' : '',
      poBalanceNote: terms === 'PO Customer' && balance > 0 ? '\u20b9' + formatAmount(balance) + ' balance allowed under the customer\u2019s own PO \u2013 noted on the gate pass.' : '',
      pending: pending ? pending.label + ' (waiting for ' + pending.waitingFor + ')' : '',
      products: []
    };
  });
  if (Object.keys(items).length) {
    getAllLineItems_().forEach(function (it) {
      var k = String(it.trackerId).toLowerCase();
      if (items[k]) items[k].products.push({ product: it.product, quantity: it.quantity });
    });
  }
  var out = Object.keys(items).map(function (k) { return items[k]; });
  out.sort(function (a, b) {
    if (a.priority !== b.priority) return a.priority === 'High' ? -1 : 1;
    return (a.requestedAtMs || 0) - (b.requestedAtMs || 0);
  });
  return out;
}

/**
 * Vehicle order is ready: Ops gives the vehicle and site readiness and asks
 * Accounts for the gate pass. form = { trackerId, vehicleNo, siteReadiness: 'Y'|'N' }.
 * Site not ready -> "On Hold - Site Not Ready"; Ops (or Accounts) presses
 * "Site ready now" later, which sends the same request to Accounts.
 */
function requestGatePass_(form) {
  opsAssertLive_();
  form = form || {};
  var me = CURRENT_STAFF_;
  var vehicleNo = String(form.vehicleNo || '').trim().toUpperCase();
  var site = form.siteReadiness === 'Y' ? 'Y' : (form.siteReadiness === 'N' ? 'N' : '');
  if (!vehicleNo) throw new Error('Enter the vehicle number.');
  if (!site) throw new Error('Say whether the customer has confirmed the site is ready.');
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String(form.trackerId || ''));
  if (row === -1) throw new Error('Order not found.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var f;
  try {
    f = getRowFields(sheet, row, ['Tracker ID', 'Status', 'Dispatch Type', 'Received by Ops Timestamp', 'Ops Cutover']);
    if (normalizeDispatchType_(f['Dispatch Type']) === DISPATCH_COURIER) {
      throw new Error('This is a courier order – there’s no gate pass. Record the postal receipt instead.');
    }
    assertNotOnStandby_(f['Status']);
    if (f['Status'] !== 'Sent to Ops') {
      throw new Error(f['Status'] === 'Vehicle Confirmed' ? 'The gate pass has already been requested – it’s with Accounts.'
        : 'This order is at "' + f['Status'] + '", so a gate pass can’t be requested now.');
    }
    if (!opsIsAcked_(f['Received by Ops Timestamp'], f['Ops Cutover'])) {
      throw new Error('Acknowledge (pick up) the order first.');
    }
    if (typeof assertNoPendingRequest_ === 'function') assertNoPendingRequest_(sheet, row);
    setRowFields(sheet, row, {
      'Vehicle No.': vehicleNo,
      'Site Readiness Confirmed': site,
      'Vehicle Confirmed Timestamp': new Date(),
      'Gate Pass Requested By': me.name,
      'Status': site === 'Y' ? 'Vehicle Confirmed' : 'On Hold - Site Not Ready'
    });
  } finally {
    lock.releaseLock();
  }
  return { trackerId: String(f['Tracker ID']), siteReady: site === 'Y', vehicleNo: vehicleNo };
}

/**
 * Courier order posted. form = { trackerId, courierName, trackingNo, postedAt,
 * receipt: { data (base64, no prefix), mimeType, name } }. The photo is
 * required -- it is what makes the typed "posted at" trustworthy.
 */
function recordPosting_(form) {
  opsAssertLive_();
  form = form || {};
  var courierName = String(form.courierName || '').trim();
  var trackingNo = String(form.trackingNo || '').trim();
  if (!courierName || !trackingNo || !form.postedAt) {
    throw new Error('Enter who it was posted with, the tracking number and the date & time on the receipt.');
  }
  var receipt = form.receipt || {};
  var hasPhoto = !!receipt.data;
  if (!hasPhoto && OPS_RECEIPT_PHOTO_REQUIRED) throw new Error('Add a photo of the postal receipt.');
  var mime = String(receipt.mimeType || 'image/jpeg').toLowerCase();
  if (hasPhoto && !/^image\/(jpeg|png|webp|heic|heif)$/.test(mime) && mime !== 'application/pdf') {
    throw new Error('The receipt must be a photo (JPG/PNG) or a PDF.');
  }
  var postedAt = new Date(form.postedAt);
  if (isNaN(postedAt.getTime())) throw new Error('Enter a valid date and time posted.');
  if (postedAt.getTime() > Date.now() + 10 * 60000) throw new Error('The time posted can’t be in the future.');

  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String(form.trackerId || ''));
  if (row === -1) throw new Error('Order not found.');
  var f = getRowFields(sheet, row, ['Tracker ID', 'Status', 'Dispatch Type', 'Payment Terms Type', 'Total Order Value',
    'Advance Received', 'Received by Ops Timestamp', 'Ops Cutover', 'Sent to Ops Timestamp']);
  var trackerId = String(f['Tracker ID']);
  if (normalizeDispatchType_(f['Dispatch Type']) !== DISPATCH_COURIER) {
    throw new Error('This is a vehicle order – request the gate pass instead.');
  }
  assertNotOnStandby_(f['Status']);
  if (f['Status'] !== 'Sent to Ops') throw new Error('This order is at "' + f['Status'] + '", so posting can’t be recorded now.');
  if (!opsIsAcked_(f['Received by Ops Timestamp'], f['Ops Cutover'])) throw new Error('Acknowledge (pick up) the order first.');
  if (typeof assertNoPendingRequest_ === 'function') assertNoPendingRequest_(sheet, row);
  var sentMs = opsMs_(f['Sent to Ops Timestamp']);
  if (sentMs && postedAt.getTime() < sentMs - 12 * 3600000) {
    throw new Error('The time posted is before Accounts sent this order to Ops (' + opsFmt_(sentMs) + '). Check the receipt.');
  }
  var balanceDue = computeBalanceDue(f['Total Order Value'], f['Advance Received']);
  if ((f['Payment Terms Type'] || 'End Customer') === 'End Customer' && balanceDue > 0 &&
      !isPaymentExceptionApproved_(trackerId, PX_DISPATCH) && !isPaymentExceptionApproved_(trackerId, PX_VERIFY)) {
    throw new Error('End-customer order with ₹' + formatAmount(balanceDue) + ' still outstanding – Accounts needs to record the balance first. Don’t post it yet.');
  }

  var receiptUrl = '';
  if (hasPhoto) {
    var bytes = Utilities.base64Decode(String(receipt.data).replace(/^data:[^,]*,/, ''));
    if (bytes.length > OPS_MAX_RECEIPT_BYTES) throw new Error('The photo is too large. Take it again at a lower resolution.');
    var ext = mime === 'application/pdf' ? '.pdf' : (mime === 'image/png' ? '.png' : '.jpg');
    var file = getOrCreateFolder(OPS_POSTAL_FOLDER_NAME)
      .createFile(Utilities.newBlob(bytes, mime, 'Postal receipt - ' + sanitizeForFilename(trackerId) + ext));
    // Same sharing as the PO and gate pass PDFs, so the CRE and Accounts can open it.
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    receiptUrl = file.getUrl();
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (getRowFields(sheet, row, ['Status'])['Status'] !== 'Sent to Ops') throw new Error('This order changed while the photo was uploading. Look it up again.');
    setRowFields(sheet, row, {
      'Transport Mode': 'Post / Courier',
      'Courier / Transport Name': courierName,
      'Dispatch Timestamp': postedAt,
      'Status': STATUS_POSTED,
      'Delivery Status': 'In Transit',
      'Delivery Status Last Updated': new Date(),
      'Postal Receipt URL': receiptUrl
    });
    // Keep long tracking numbers as text (not 5.72E+11).
    sheet.getRange(row, getHeaderIndex('Tracking / Consignment No.')).setNumberFormat('@').setValue(trackingNo);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: trackerId, status: STATUS_POSTED, receiptUrl: receiptUrl, courierName: courierName, trackingNo: trackingNo };
}

// ================================================================
// Direct standby -- Admin / Director, no request or approval step
// ================================================================
/**
 * form = { trackerId, reason, note, standbyFrom (yyyy-MM-dd, default today), resumeDate }.
 * Same reasons and hard limits as a request. The director limits (days,
 * orders, value on standby) don't block it -- the person doing this is the
 * one who would approve going past them -- but the result says which were
 * passed, and that is written into the standby's history.
 */
function setStandbyDirect_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  if (!me || (me.role !== 'Admin' && me.role !== 'Director')) throw new Error('Only an Admin or a Director can put an order on standby directly.');
  var reason = String(form.reason || '').trim();
  if (SB_REASONS.indexOf(reason) === -1) throw new Error('Choose the reason for the delay.');
  var note = String(form.note || '').trim();
  if (reason === 'Other' && !note) throw new Error('Describe the reason in the note.');
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String(form.trackerId || ''));
  if (row === -1) throw new Error('Order not found.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var r, over, resume, trackerId, f;
  try {
    f = sbOrderFields_(sheet, row);
    trackerId = String(f['Tracker ID']);
    if (SB_ELIGIBLE.indexOf(f['Status']) === -1) {
      throw new Error(f['Status'] === STATUS_STANDBY ? 'This order is already on standby.'
        : 'Standby is only for orders that haven’t been dispatched (this one is at "' + f['Status'] + '").');
    }
    var list = readStandby_();
    var open = sbOpenFor_(list, trackerId);
    if (open) throw new Error('A standby request is already waiting for this order (' + open.requestId + '). Decide it on the Admin page or the dashboard instead.');
    if (typeof assertNoPendingRequest_ === 'function') assertNoPendingRequest_(sheet, row);
    var from = String(form.standbyFrom || '').trim() || todayYmd_();
    resume = String(form.resumeDate || '').trim();
    var chk = sbCheckDates_(from, resume, sbEarliestStartMs_(f, list), todayYmd_());
    var value = Number(f['Total Order Value']) || 0;
    over = sbDirectorReasons_(chk.days, chk.backdatedDays, value, trackerId, list, getStandbySettings_());

    var requestId = 'SB-' + Utilities.formatDate(new Date(), sbTz_(), 'yyMMdd') + '-' + Utilities.getUuid().split('-')[0].slice(0, 4).toUpperCase();
    var now = new Date();
    var who = sbWho_(me) + ' – set directly';
    var vals = SB_HEADERS.map(function () { return ''; });
    vals[sbCol_('Request ID')] = requestId;
    vals[sbCol_('Requested At')] = now;
    vals[sbCol_('Tracker ID')] = trackerId;
    vals[sbCol_('Institution')] = String(f['Institution / Customer'] || '');
    vals[sbCol_('Requested By')] = me.code;
    vals[sbCol_('Requested By Name')] = me.name;
    vals[sbCol_('Reason')] = reason;
    vals[sbCol_('Note')] = note;
    vals[sbCol_('Reported By (Ops)')] = 'Set directly by ' + me.name;
    vals[sbCol_('Standby From')] = sbYmdToDate_(from);
    vals[sbCol_('Requested Resume Date')] = sbYmdToDate_(resume);
    vals[sbCol_('Order Value')] = value;
    vals[sbCol_('Status')] = 'Pending';
    vals[sbCol_('Decided By')] = who;
    vals[sbCol_('Decided At')] = now;
    if (me.role === 'Director') {
      vals[sbCol_('Director Decision')] = 'Set directly by ' + sbWho_(me);
      vals[sbCol_('Director Decided At')] = now;
    }
    vals[sbCol_('Backdated Days')] = chk.backdatedDays;
    vals[sbCol_('History')] = sbStamp_() + ' Put on standby directly by ' + me.name + ' (' + me.role + ', ' + chk.days + ' days)' +
      (over.length ? ' – past the usual limits: ' + over.join('; ') : '');
    var sbSheet = getOrCreateStandbySheet_();
    sbSheet.appendRow(vals);
    r = { row: sbSheet.getLastRow(), requestId: requestId, trackerId: trackerId, institution: vals[sbCol_('Institution')],
          reason: reason, note: note, reportedBy: vals[sbCol_('Reported By (Ops)')], fromYmd: from, requestedResumeYmd: resume,
          orderValue: value, history: vals[sbCol_('History')] };
    sbActivate_(r, sheet, row, f, resume, list, 'On standby until ' + fmtYmd_(resume));
  } finally {
    lock.releaseLock();
  }

  // Tell the people who would otherwise still be working on it.
  try {
    var staffMap = getStaffMap_(false);
    var people = opsPeople_(staffMap).concat(Object.keys(staffMap).map(function (k) { return staffMap[k]; })
      .filter(function (s) { return s.active && s.role === 'Accounts'; }));
    var ownerRow = getRowFields(sheet, row, ['CRE Code', 'CRE Name']);
    var owner = staffMap[resolveOwnerCode_(ownerRow['CRE Code'], ownerRow['CRE Name'], staffMap)] || null;
    if (owner && owner.active) people.push(owner);
    var text = me.name + ' put order ' + trackerId + ' (' + r.institution + ') on standby until ' + fmtYmd_(resume) + ' – ' + reason + (note ? ': ' + note : '') +
      '. It is off the live lists until then and the time isn’t counted against Ops.';
    notify_('STANDBY_SET_DIRECTLY', trackerId, people.map(staffRecipient_), {
      subject: 'On standby: ' + trackerId + ' until ' + fmtYmd_(resume),
      text: text, html: '<p>' + opsEsc_(text) + '</p>', email: true
    });
  } catch (e) { Logger.log('Direct standby notice failed: ' + e); }

  return { trackerId: trackerId, requestId: r.requestId, resume: fmtYmd_(resume), overLimits: over };
}

// ================================================================
// Notifications -- one log for everything, WhatsApp-ready
// ================================================================
function getOrCreateNotificationLog_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(NOTIFICATION_LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(NOTIFICATION_LOG_SHEET_NAME);
    sheet.getRange(1, 1, 1, NOTIFICATION_LOG_HEADERS.length).setValues([NOTIFICATION_LOG_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('F:F').setNumberFormat('@');
  }
  return sheet;
}

/**
 * The one place every new message goes through. Stage 1: staff messages are
 * emailed when msg.email is true and the person has an email; everything is
 * logged. Customer messages are only logged ("Queued for WhatsApp") -- stage 2
 * adds the WhatsApp sender, which reads the queued rows. Returns emails sent.
 * recipients: [{ audience: 'staff'|'customer', code, name, phone, email }]
 * msg: { subject, text, html, link, linkLabel, email, cc: [emails] }
 */
function notify_(event, trackerId, recipients, msg) {
  msg = msg || {};
  var rows = [], sent = 0, now = new Date();
  var staffEmails = [];
  (recipients || []).forEach(function (p) {
    if (!p) return;
    var status;
    if (p.audience === 'customer') {
      status = p.skip ? p.skip : 'Queued for WhatsApp (stage 2)';
    } else if (msg.email && p.email) {
      if (staffEmails.indexOf(p.email) === -1) staffEmails.push(p.email);
      status = 'Emailed';
    } else {
      status = 'Logged (no email on file)';
    }
    rows.push([now, event, trackerId || '', p.audience || 'staff', p.name || p.code || '', p.phone || '', p.email || '', status, String(msg.text || '').slice(0, 4000)]);
  });
  if (staffEmails.length) {
    var ok = sbMail_(staffEmails, msg.cc || [], msg.subject || 'ICF Order Tracker', msg.html || ('<p>' + opsEsc_(msg.text || '') + '</p>'), msg.link || '', msg.linkLabel || 'Open');
    if (ok) sent = staffEmails.length;
    else rows.forEach(function (r) { if (r[7] === 'Emailed') r[7] = 'Email failed'; });
  }
  if (rows.length) {
    try {
      var sheet = getOrCreateNotificationLog_();
      var start = sheet.getLastRow() + 1;
      sheet.getRange(start, 1, rows.length, NOTIFICATION_LOG_HEADERS.length).setValues(rows);
    } catch (e) { Logger.log('Notification Log write failed: ' + e); }
  }
  return sent;
}

// ================================================================
// The sweep -- run every 10 minutes (office hours) by checkApprovalAlerts
// ================================================================
/** Cells read like "New 16-Oct 10:40 | AckReminder 17-Oct 10:40" -- is this token in there? */
function opsHasToken_(cell, token) {
  return String(cell || '').split('|').some(function (part) { return part.trim().split(' ')[0] === token; });
}
function opsAddToken_(sheet, row, col, cell, token) {
  var v = (cell ? String(cell) + ' | ' : '') + token + ' ' + opsStamp_();
  sheet.getRange(row, col).setValue(v);
  return v;
}

/** Product summary per order, e.g. "2 x Eco Portable Toilet IWC, 1 x Ultra Series 1A". */
function opsProductsByOrder_() {
  var map = {};
  try {
    getAllLineItems_().forEach(function (it) {
      var k = String(it.trackerId).toLowerCase();
      map[k] = (map[k] ? map[k] + ', ' : '') + it.quantity + ' x ' + it.product;
    });
  } catch (e) { Logger.log('opsProductsByOrder_ failed: ' + e); }
  return map;
}

function opsListHtml_(cards, products) {
  return '<table cellpadding="6" style="border-collapse:collapse;font-size:13px;">' + cards.map(function (c) {
    return '<tr style="border-bottom:1px solid #eee;"><td><b>' + opsEsc_(c.trackerId) + '</b>' + (c.priority === 'High' ? ' <span style="color:#B00020;font-weight:700;">HIGH</span>' : '') +
      (c.dispatchType === DISPATCH_COURIER ? ' (courier)' : '') + '<br>' + opsEsc_(c.institution) + (c.location ? ' – ' + opsEsc_(c.location) : '') +
      (products[c.trackerId.toLowerCase()] ? '<br><span style="color:#555;">' + opsEsc_(products[c.trackerId.toLowerCase()]) + '</span>' : '') +
      (c.hoursWaiting !== null ? '<br><span style="color:#9a5b00;">Waiting ' + c.hoursWaiting + ' h</span>' : '') + '</td></tr>';
  }).join('') + '</table>';
}

function opsListText_(cards) {
  return cards.map(function (c) {
    return c.trackerId + ' – ' + c.institution + (c.priority === 'High' ? ' (HIGH)' : '') + (c.hoursWaiting !== null ? ', ' + c.hoursWaiting + ' h' : '');
  }).join('; ');
}

/**
 * New-order notices, 24 h / 48 h nudges, and customer updates. Does nothing
 * before go-live. Each order's "Ops Alerts Sent" / "Customer Updates Sent"
 * cells record what has gone out, so nothing is sent twice. Returns emails sent.
 */
function opsSweep_(nowMs, staffMap, alertCfg) {
  var goLive = opsGoLiveMs_();
  if (!goLive) return 0;
  var cfg = getOpsSettings_();
  var data = opsReadOrders_();
  var sheet = data.sheet;
  var ends = opsStandbyEnds_();
  var opsStaff = opsPeople_(staffMap).map(staffRecipient_);
  var first = staffMap[alertCfg.firstApprover];
  var escalateTo = (first && first.active) ? [staffRecipient_(first)]
    : Object.keys(staffMap).map(function (k) { return staffMap[k]; }).filter(function (s) { return s.active && s.role === 'Admin'; }).map(staffRecipient_);
  var opsEmails = opsStaff.map(function (p) { return p.email; }).filter(Boolean);
  var url = appUrl_();
  var opsLink = url ? url + '?page=ops' : '';
  var alertsCol = getHeaderIndex('Ops Alerts Sent');
  var custCol = getHeaderIndex('Customer Updates Sent');
  var sent = 0;

  var fresh = [], untouched = [], ackNudge = [], ackEsc = [], postNudge = [], postEsc = [];
  data.rows.forEach(function (o) {
    var status = String(o.get('Status') || '');
    if (status !== 'Sent to Ops') return;
    var id = String(o.get('Tracker ID'));
    var cell = String(o.get('Ops Alerts Sent') || '');
    var endMs = ends[id.toLowerCase()] || 0;
    var acked = opsIsAcked_(o.get('Received by Ops Timestamp'), o.get('Ops Cutover'));
    var courier = normalizeDispatchType_(o.get('Dispatch Type')) === DISPATCH_COURIER;
    if (!acked) {
      var startMs = Math.max(opsMs_(o.get('Sent to Ops Timestamp')), endMs, goLive);
      var card = opsCard_(o, nowMs, startMs, cfg.ackHours);
      card._row = o.row; card._cell = cell;
      untouched.push(card);
      if (!opsHasToken_(cell, 'New')) fresh.push(card);
      var h = (nowMs - startMs) / 3600000;
      if (h >= cfg.ackEscalateHours && !opsHasToken_(cell, 'AckEscalated')) ackEsc.push(card);
      else if (h >= cfg.ackHours && !opsHasToken_(cell, 'AckReminder')) ackNudge.push(card);
    } else if (courier) {
      var ackMs = Math.max(opsMs_(o.get('Received by Ops Timestamp')) || goLive, endMs);
      var pc = opsCard_(o, nowMs, ackMs, cfg.postHours);
      pc._row = o.row; pc._cell = cell;
      var ph = (nowMs - ackMs) / 3600000;
      if (ph >= cfg.postEscalateHours && !opsHasToken_(cell, 'PostEscalated')) postEsc.push(pc);
      else if (ph >= cfg.postHours && !opsHasToken_(cell, 'PostReminder')) postNudge.push(pc);
    }
  });

  var mark = function (cards, token) {
    cards.forEach(function (c) { c._cell = opsAddToken_(sheet, c._row, alertsCol, c._cell, token); });
  };
  var products = (fresh.length || ackNudge.length || ackEsc.length || postNudge.length || postEsc.length) ? opsProductsByOrder_() : {};

  if (fresh.length) {
    var subj = fresh.length + ' new order' + (fresh.length === 1 ? '' : 's') + ' for Ops – ' + untouched.length + ' waiting to be picked up';
    var text = 'New for Ops: ' + opsListText_(fresh) + '. Total not yet picked up: ' + untouched.length + '.';
    sent += notify_('OPS_NEW_ORDERS', fresh.length === 1 ? fresh[0].trackerId : '', opsStaff, {
      subject: subj, text: text, email: true, link: opsLink, linkLabel: 'Open the Operations page',
      html: '<p>Accounts has verified ' + (fresh.length === 1 ? 'this order' : 'these orders') + '. Pick ' + (fresh.length === 1 ? 'it' : 'them') +
        ' up on the Operations page – that records the time and lets you print the PO.</p>' + opsListHtml_(fresh, products) +
        '<p><b>' + untouched.length + '</b> order' + (untouched.length === 1 ? '' : 's') + ' in total not yet picked up.</p>'
    });
    mark(fresh, 'New');
  }
  if (ackNudge.length) {
    sent += notify_('OPS_ACK_REMINDER', ackNudge.length === 1 ? ackNudge[0].trackerId : '', opsStaff, {
      subject: 'Reminder: ' + ackNudge.length + ' order' + (ackNudge.length === 1 ? '' : 's') + ' not picked up for ' + cfg.ackHours + ' h',
      text: 'Not picked up for ' + cfg.ackHours + ' h: ' + opsListText_(ackNudge) + '. Escalates at ' + cfg.ackEscalateHours + ' h.',
      email: true, link: opsLink, linkLabel: 'Open the Operations page',
      html: '<p>These orders were sent to Ops ' + cfg.ackHours + '+ hours ago and haven’t been picked up in the system. ' +
        'They go to ' + opsEsc_(escalateTo.map(function (p) { return p.name; }).join(', ') || 'the admins') + ' at ' + cfg.ackEscalateHours + ' h.</p>' + opsListHtml_(ackNudge, products)
    });
    mark(ackNudge, 'AckReminder');
  }
  if (ackEsc.length) {
    sent += notify_('OPS_ACK_ESCALATION', ackEsc.length === 1 ? ackEsc[0].trackerId : '', escalateTo, {
      subject: 'OVERDUE: ' + ackEsc.length + ' order' + (ackEsc.length === 1 ? '' : 's') + ' not picked up by Ops after ' + cfg.ackEscalateHours + ' h',
      text: 'Not picked up after ' + cfg.ackEscalateHours + ' h: ' + opsListText_(ackEsc) + '.',
      email: true, cc: opsEmails, link: opsLink, linkLabel: 'Open the Operations page',
      html: '<p>Accounts verified these orders, but Ops hasn’t picked them up in the system for ' + cfg.ackEscalateHours + '+ hours. Please check with Ops.</p>' + opsListHtml_(ackEsc, products)
    });
    mark(ackEsc, 'AckEscalated');
  }
  if (postNudge.length) {
    sent += notify_('OPS_POST_REMINDER', postNudge.length === 1 ? postNudge[0].trackerId : '', opsStaff, {
      subject: 'Reminder: ' + postNudge.length + ' courier order' + (postNudge.length === 1 ? '' : 's') + ' not recorded as posted',
      text: 'Picked up ' + cfg.postHours + '+ h ago, no postal receipt recorded: ' + opsListText_(postNudge) + '.',
      email: true, link: opsLink, linkLabel: 'Open the Operations page',
      html: '<p>You picked these courier orders up ' + cfg.postHours + '+ hours ago, but no postal receipt is recorded. If posted, record it with the receipt photo; ' +
        'if not, post today. Escalates at ' + cfg.postEscalateHours + ' h.</p>' + opsListHtml_(postNudge, products)
    });
    mark(postNudge, 'PostReminder');
  }
  if (postEsc.length) {
    sent += notify_('OPS_POST_ESCALATION', postEsc.length === 1 ? postEsc[0].trackerId : '', escalateTo, {
      subject: 'OVERDUE: ' + postEsc.length + ' courier order' + (postEsc.length === 1 ? '' : 's') + ' not recorded as posted after ' + cfg.postEscalateHours + ' h',
      text: 'No postal receipt after ' + cfg.postEscalateHours + ' h: ' + opsListText_(postEsc) + '.',
      email: true, cc: opsEmails, link: opsLink, linkLabel: 'Open the Operations page',
      html: '<p>Ops picked these courier orders up but hasn’t recorded posting them for ' + cfg.postEscalateHours + '+ hours. Either they haven’t gone, or they went without being recorded – please check.</p>' + opsListHtml_(postEsc, products)
    });
    mark(postEsc, 'PostEscalated');
  }

  // ---- Customer updates (queued for WhatsApp in stage 2) ----
  data.rows.forEach(function (o) {
    var consent = String(o.get('Customer Updates Consent') || '').trim().toUpperCase();
    if (consent !== 'Y' && consent !== 'N') return; // logged before this release -- leave alone
    var status = String(o.get('Status') || '');
    if (status === 'Cancelled' || status === 'Logged' || status === STATUS_HOLD_BALANCE) return;
    var cell = String(o.get('Customer Updates Sent') || '');
    var due = [];
    if (opsMs_(o.get('Verified Date')) >= goLive && !opsHasToken_(cell, 'Confirmed')) due.push('Confirmed');
    if (isDispatchedStatus_(status) && opsMs_(o.get('Dispatch Timestamp')) && (opsMs_(o.get('Dispatch Timestamp')) >= goLive - 86400000) && !opsHasToken_(cell, 'Dispatched')) due.push('Dispatched');
    if (String(o.get('Delivery Status')) === 'Delivered' && opsMs_(o.get('Delivered Timestamp')) >= goLive - 86400000 && !opsHasToken_(cell, 'Delivered')) due.push('Delivered');
    due.forEach(function (kind) {
      var m = opsCustomerMessage_(kind, o, staffMap, cfg);
      notify_('CUSTOMER_' + kind.toUpperCase(), String(o.get('Tracker ID')), [{
        audience: 'customer', name: String(o.get('Institution / Customer') || ''),
        phone: String(o.get('Customer Phone Number') || ''), email: String(o.get('Customer Email') || ''),
        skip: consent === 'Y' ? (String(o.get('Customer Phone Number') || '').trim() ? '' : 'Not sent – no phone number') : 'Not sent – customer did not agree to updates'
      }], { text: m });
      cell = opsAddToken_(sheet, o.row, custCol, cell, kind);
    });
  });
  return sent;
}

/** The customer's message text. Kept plain so it can become a WhatsApp template in stage 2. */
function opsCustomerMessage_(kind, o, staffMap, cfg) {
  var id = String(o.get('Tracker ID'));
  var name = String(o.get('Institution / Customer') || 'Customer');
  var ownerCode = resolveOwnerCode_(o.get('CRE Code'), o.get('CRE Name'), staffMap);
  var cre = staffMap[ownerCode];
  var creLine = (cre ? cre.name : String(o.get('CRE Name') || 'our customer care team')) + (ownerCode && staffPhone_(ownerCode) ? ', ' + staffPhone_(ownerCode) : '');
  var contact = 'Your point of contact: ' + creLine + '.' +
    (cfg.esc2 ? ' If you need more help: ' + cfg.esc2 + '.' : '') + (cfg.esc3 ? ' Then: ' + cfg.esc3 + '.' : '');
  if (kind === 'Confirmed') {
    return 'Dear ' + name + ', thank you for your order with ICF Group (ref. ' + id + '). Your payment is confirmed and your order is now being processed. ' + contact;
  }
  if (kind === 'Dispatched') {
    var courier = normalizeDispatchType_(o.get('Dispatch Type')) === DISPATCH_COURIER;
    var how = courier
      ? ' by ' + (String(o.get('Courier / Transport Name') || 'post')) + (o.get('Tracking / Consignment No.') ? ', tracking no. ' + o.get('Tracking / Consignment No.') : '')
      : ' from our facility';
    return 'Dear ' + name + ', your ICF Group order (ref. ' + id + ') has been dispatched' + how + '. ' + contact;
  }
  return 'Dear ' + name + ', your ICF Group order (ref. ' + id + ') has been delivered. Thank you for choosing ICF Group. For any issue with the products: ' + creLine + '.';
}

// ================================================================
// One-time setup + go-live
// ================================================================
/**
 * ICF Admin menu > "Ops login: set up and go live". Safe to run again; each
 * step checks first. Run it right after the new version is deployed.
 *   1. Makes a full backup copy of the spreadsheet (first run only).
 *   2. Writes the new column headers AW..BE -- and stops without changing
 *      anything if any of those cells already holds something else.
 *   3. Adds "Ops" to the Role dropdown on the Staff tab, and an Ops row for
 *      Manoj (OPS001) if there is no Ops person yet -- set his PIN in Staff!E.
 *   4. Adds the Ops nudge rows and customer escalation rows to Settings.
 *   5. Creates the Notification Log tab and the postal receipts folder.
 *   6. GO-LIVE (first run only): orders already with Ops are marked cutover
 *      -- treated as picked up now, left out of the pickup-time figures --
 *      and the nudges and customer updates switch on from this moment.
 */
function setupOpsLogin() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var props = PropertiesService.getScriptProperties();
  var report = [];

  // 1. Backup
  var backup = props.getProperty(OPS_BACKUP_PROP);
  if (!backup) {
    var copy = DriveApp.getFileById(SHEET_ID).makeCopy('ICF - Order Tracker – backup before Ops login ' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy HH:mm'));
    backup = copy.getUrl();
    props.setProperty(OPS_BACKUP_PROP, backup);
    report.push('Backup made: ' + backup);
  } else {
    report.push('Backup already made earlier: ' + backup);
  }

  // 2. Headers -- check every cell before writing any.
  var tracker = getSheet();
  var firstNew = getHeaderIndex(OPS_NEW_HEADERS[0]);
  var current = tracker.getRange(1, firstNew, 1, OPS_NEW_HEADERS.length).getDisplayValues()[0];
  var clash = [];
  current.forEach(function (v, i) {
    var t = String(v || '').trim();
    if (t && t !== OPS_NEW_HEADERS[i]) clash.push(tracker.getRange(1, firstNew + i).getA1Notation() + ' holds "' + t + '"');
  });
  if (clash.length) {
    throw new Error('Stopped – nothing changed. The new columns need to go in ' + tracker.getRange(1, firstNew).getA1Notation() + ':' +
      tracker.getRange(1, firstNew + OPS_NEW_HEADERS.length - 1).getA1Notation() + ', but ' + clash.join('; ') + '. Move that data first.');
  }
  tracker.getRange(1, firstNew, 1, OPS_NEW_HEADERS.length).setValues([OPS_NEW_HEADERS]).setFontWeight('bold');
  report.push('Tracker columns ' + tracker.getRange(1, firstNew).getA1Notation() + ' to ' + tracker.getRange(1, firstNew + OPS_NEW_HEADERS.length - 1).getA1Notation() + ' ready.');

  // 3. Staff tab
  var staff = ss.getSheetByName(STAFF_SHEET_NAME);
  if (staff) {
    staff.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ROLES, true).build());
    var map = getStaffMap_(true);
    var hasOps = Object.keys(map).some(function (k) { return map[k].role === 'Ops'; });
    if (!hasOps && !map['OPS001']) {
      var r = staff.getLastRow() + 1;
      staff.getRange(r, 1, 1, 4).setValues([['OPS001', 'Manoj', 'Ops', 'Y']]);
      report.push('Added OPS001 Manoj (Ops) to the Staff tab – type his PIN in column E.');
    }
  }

  // 4. Settings rows
  var settings = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (settings) {
    var existing = settings.getLastRow() >= 2 ? settings.getRange(2, 1, settings.getLastRow() - 1, 1).getValues().map(function (x) { return String(x[0]).trim().toLowerCase(); }) : [];
    OPS_SETTINGS_ROWS.concat(CUSTOMER_SETTINGS_ROWS).forEach(function (row) {
      if (existing.indexOf(row[0].toLowerCase()) !== -1) return;
      var n = settings.getLastRow() + 1;
      settings.getRange(n, 2).setNumberFormat('@');
      settings.getRange(n, 1, 1, 3).setValues([[row[0], row[1], row[2]]]);
    });
  } else {
    report.push('No Settings tab yet – run "Run setup (staff, dispatch type)" first for office hours and approvers.');
  }

  // 5. Log tab, receipts folder, alert trigger
  getOrCreateNotificationLog_();
  getOrCreateFolder(OPS_POSTAL_FOLDER_NAME);
  installAlertTrigger();

  // 6. Go-live
  var liveSince = Number(props.getProperty(OPS_GO_LIVE_PROP) || 0);
  if (!liveSince) {
    var now = new Date();
    var data = opsReadOrders_();
    var cutCol = getHeaderIndex('Ops Cutover');
    var marked = [];
    data.rows.forEach(function (o) {
      if (String(o.get('Status')) === 'Sent to Ops' && !opsMs_(o.get('Received by Ops Timestamp'))) {
        tracker.getRange(o.row, cutCol).setValue('Y');
        marked.push(String(o.get('Tracker ID')));
      }
    });
    props.setProperty(OPS_GO_LIVE_PROP, String(now.getTime()));
    report.push('LIVE from ' + opsFmt_(now) + '. ' + marked.length + ' order(s) already with Ops marked as picked up at go-live (left out of pickup-time figures)' +
      (marked.length ? ': ' + marked.join(', ') : '') + '.');
    logActivity_({ code: 'SYSTEM', name: 'Ops login go-live', role: '' }, 'Ops login went live', '', marked.length + ' cutover order(s)');
  } else {
    report.push('Already live since ' + opsFmt_(liveSince) + ' – cutover not repeated.');
  }

  var cache = CacheService.getScriptCache();
  cache.remove('staff_map'); cache.remove('ops_settings'); cache.remove('alert_settings');
  var msg = report.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('Ops login', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { /* run from the editor */ }
  return msg;
}

// ================================================================
// Wiring used by Code.js
// ================================================================
function opsApiMap_() {
  var OPS = ['Ops'];
  return {
    getOpsQueue:      { fn: getOpsQueue_,      roles: OPS },
    getOpsOrder:      { fn: getOpsOrder_,      roles: OPS },
    acknowledgeOrder: { fn: acknowledgeOrder_, roles: OPS, log: 'Acknowledged & picked up' },
    requestGatePass:  { fn: requestGatePass_,  roles: OPS, log: 'Requested gate pass' },
    recordPosting:    { fn: recordPosting_,    roles: OPS, log: 'Recorded postal dispatch' },
    preparePo:        { fn: preparePo_,        roles: OPS, log: 'Prepared PO' },
    getGatePassQueue: { fn: getGatePassQueue_, roles: ['Accounts'] },
    setStandbyDirect: { fn: setStandbyDirect_, roles: ['Director'], log: 'Put order on standby directly' }
  };
}

function opsActivityDetail_(fnName, a, result) {
  a = a || {}; result = result || {};
  switch (fnName) {
    case 'acknowledgeOrder': return 'Picked up at ' + (result.pickedUpAt || '');
    case 'requestGatePass': return 'Vehicle ' + (result.vehicleNo || a.vehicleNo || '') + (result.siteReady ? '' : ' – site NOT ready, on hold');
    case 'recordPosting': return (result.courierName || a.courierName || '') + ' ' + (result.trackingNo || a.trackingNo || '') + (result.receiptUrl ? ' \u2013 receipt photo saved' : ' \u2013 no receipt photo');
    case 'setStandbyDirect': return (result.requestId || '') + ' – ' + (a.reason || '') + ', until ' + (result.resume || '') +
      (result.overLimits && result.overLimits.length ? ' (past limits: ' + result.overLimits.join('; ') + ')' : '');
    default: return '';
  }
}
