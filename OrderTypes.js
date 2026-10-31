/**
 * ORDER TYPES: DACC and FLIPKART (Oct 2026)
 * ---------------------------------------------------------------------
 * The CRE picks the order type on the New PO form. "Standard" is every order
 * the tracker has handled so far; nothing about those changes.
 *
 * DACC -- Delivery Against Consignor's Copy (Hari, 31 Oct 2026)
 *   Offered when a customer doesn't trust paying in full before seeing the
 *   goods. The customer pays an advance, the goods go by a transporter booked
 *   as DACC and wait at the transporter's warehouse near the customer. The
 *   customer inspects them there; if happy, pays ICF the balance; Accounts
 *   verifies it; the CRE emails the transporter to cancel the DACC and
 *   deliver.
 *     Intake      End customer only, advance at least the Settings minimum
 *                 (50%), transporter chosen from the "Transporters" tab
 *                 (Safe Express to start -- add more as rows, no code change).
 *                 Always a vehicle/transporter order, never a courier packet.
 *     Ops/gate    As a normal vehicle order, EXCEPT the balance never blocks
 *                 the gate pass -- the goods are held at the transporter, and
 *                 that is the security. The gate pass prints a DACC note.
 *     In transit  CRE marks "Reached the transporter's warehouse" (date +
 *                 branch). From that day the free-days clock runs (Settings,
 *                 4 days): reminder to the CRE the day before, copy to the
 *                 first approver when it runs out.
 *     Accepted    The customer pays -> Accounts records the balance as usual
 *                 -> the CRE ticks "Emailed the transporter to cancel the DACC"
 *                 -> "DACC released". Only then can the order be marked
 *                 Delivered.
 *     Rejected    The CRE raises a return (Returns.gs) with the reason "DACC -
 *                 rejected at inspection". A partial acceptance is a return
 *                 for the rejected lines, with what was accepted typed in.
 *
 * FLIPKART (Hari, 31 Oct 2026)
 *   Bio Bacteria sold on Flipkart (10-20 a month). Greeshma accepts the order
 *   on the seller panel and logs it here so Ops can see it. Flipkart collects
 *   the money, so there is no Accounts verification: the order goes straight
 *   to Ops, paid in full ("Payment Terms Type" = "Flipkart", settled by the
 *   marketplace). Flipkart's ship-by date is Ops' deadline. Ops packs it,
 *   hands it over at the nearby Flipkart office and records the handover
 *   (shipment ID + time) -- the same step as posting a courier packet. The CRE
 *   marks it delivered from the seller panel. Returns go through Returns.gs.
 *
 * New tracker columns (appended at the end; header cells fill in by
 * themselves): Order Type, DACC Transporter, DACC Arrived At, DACC Warehouse,
 * DACC Outcome, DACC Released At, DACC Released By, DACC Alerts Sent,
 * Ship By Date, Flipkart Alerts Sent, Return Credit Applied, Return Credit Ref,
 * Original Order Value.
 */
var ORDER_TYPE_STANDARD = 'Standard';
var ORDER_TYPE_DACC = 'DACC';
var ORDER_TYPE_FLIPKART = 'Flipkart';
var TERMS_FLIPKART = 'Flipkart';

var TRANSPORTERS_SHEET_NAME = 'Transporters';
var TRANSPORTER_HEADERS = ['Transporter', 'Active', 'Email', 'Phone', 'Notes'];
var DEFAULT_TRANSPORTERS = [['Safe Express', 'Y', '', '', 'DACC bookings. Add the email the DACC-cancellation goes to.']];

// [label, default, help, min, max] -- shown on the Settings page under "DACC & Flipkart".
var ORDER_TYPE_SETTINGS_ROWS = [
  ['DACC: minimum advance (%)', '50', 'A DACC order can only be logged (and verified) with at least this share of the order value paid.', 1, 100],
  ['DACC: transporter keeps the goods free for (days)', '4', 'Days the transporter holds DACC goods at its warehouse before it starts calling. Counted from the day the CRE marks the goods as arrived.', 1, 30],
  ['DACC: remind the CRE (days before the free days run out)', '1', 'The CRE gets an email this many days before; the first approver is copied once the free days have run out.', 0, 10]
];

function normalizeOrderType_(v) {
  var s = String(v || '').trim().toLowerCase();
  if (s === 'dacc') return ORDER_TYPE_DACC;
  if (s === 'flipkart') return ORDER_TYPE_FLIPKART;
  return ORDER_TYPE_STANDARD;
}

/** Settings as numbers. Cached 5 minutes (cleared when Settings are saved). */
function getOrderTypeSettings_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('ordertype_settings');
  if (hit) return JSON.parse(hit);
  var map = sbReadSettingsMap_();
  var n = function (i) {
    var r = ORDER_TYPE_SETTINGS_ROWS[i];
    var raw = map[r[0].toLowerCase()];
    var v = Number(String(raw == null ? '' : raw).replace(/[,\s%]/g, ''));
    if (raw === undefined || raw === '' || isNaN(v)) v = Number(r[1]);
    return Math.min(r[4], Math.max(r[3], Math.floor(v)));
  };
  var s = { daccMinPct: n(0), daccFreeDays: n(1), daccRemindBefore: n(2) };
  if (s.daccRemindBefore >= s.daccFreeDays) s.daccRemindBefore = s.daccFreeDays - 1;
  cache.put('ordertype_settings', JSON.stringify(s), 300);
  return s;
}

// ================================================================
// Transporters tab -- a spreadsheet to edit, like the Product Catalog
// ================================================================
function getOrCreateTransportersSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TRANSPORTERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TRANSPORTERS_SHEET_NAME, ss.getNumSheets()); // at the end -- the Tracker must stay first
    sheet.getRange(1, 1, 1, TRANSPORTER_HEADERS.length).setValues([TRANSPORTER_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange(2, 1, DEFAULT_TRANSPORTERS.length, TRANSPORTER_HEADERS.length).setValues(DEFAULT_TRANSPORTERS);
  }
  return sheet;
}

/** Active transporters, sheet order: [{ name, email, phone }]. */
function getTransporters_() {
  var sheet = getOrCreateTransportersSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, TRANSPORTER_HEADERS.length).getValues()
    .filter(function (r) { return String(r[0] || '').trim() && String(r[1] || '').trim().toUpperCase() === 'Y'; })
    .map(function (r) { return { name: String(r[0]).trim(), email: String(r[2] || '').trim(), phone: String(r[3] || '').trim() }; });
}

/** Any transporter (active or not), so an old order still shows its contact. */
function transporterInfo_(name) {
  var key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  var sheet = getOrCreateTransportersSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return { name: name, email: '', phone: '' };
  var hit = sheet.getRange(2, 1, last - 1, TRANSPORTER_HEADERS.length).getValues()
    .filter(function (r) { return String(r[0] || '').trim().toLowerCase() === key; })[0];
  return hit ? { name: String(hit[0]).trim(), email: String(hit[2] || '').trim(), phone: String(hit[3] || '').trim() } : { name: name, email: '', phone: '' };
}

/** For the New PO form: transporters + the DACC minimum. */
function getOrderTypeOptions_() {
  return { transporters: getTransporters_(), daccMinPct: getOrderTypeSettings_().daccMinPct, today: todayYmd_() };
}

// ================================================================
// Which orders are DACC -- one read per execution
// ================================================================
var OT_INDEX_ = null;
function otIndex_() {
  if (OT_INDEX_) return OT_INDEX_;
  OT_INDEX_ = {};
  try {
    var sheet = getSheet();
    var last = getLastOrderRow_(sheet);
    if (last >= 2) {
      var ids = sheet.getRange(2, getHeaderIndex('Tracker ID'), last - 1, 1).getValues();
      var types = sheet.getRange(2, getHeaderIndex('Order Type'), last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        var id = String(ids[i][0] || '').trim().toLowerCase();
        if (id) OT_INDEX_[id] = normalizeOrderType_(types[i][0]);
      }
    }
  } catch (e) { Logger.log('otIndex_ failed: ' + e); }
  return OT_INDEX_;
}
function isDaccOrderId_(id) { return otIndex_()[String(id || '').trim().toLowerCase()] === ORDER_TYPE_DACC; }

// ================================================================
// Intake -- called from submitOrder_ (Code.js)
// ================================================================
/**
 * Checks the order-type part of the New PO form before anything is written.
 * Returns { type, paymentTermsType?, dispatchType?, crmPoOptional, transporter, shipByYmd }.
 */
function otIntakeCheck_(form, lineItems, paymentTermsType, dispatchType) {
  var type = normalizeOrderType_(form.orderType);
  var out = { type: type, crmPoOptional: false, transporter: '', shipByYmd: '' };
  if (type === ORDER_TYPE_DACC) {
    if (paymentTermsType !== 'End Customer') throw new Error('DACC is for end customers – a dealer / institution with its own PO pays on its own terms. Choose “End Customer”, or log it as a standard order.');
    if (dispatchType === DISPATCH_COURIER) throw new Error('DACC goes through a transporter’s warehouse – it can’t be used for a courier packet. Log this as a standard order.');
    var t = String(form.daccTransporter || '').trim();
    if (!t) throw new Error('Choose the transporter the DACC is booked with.');
    var known = getTransporters_().filter(function (x) { return x.name.toLowerCase() === t.toLowerCase(); })[0];
    if (!known) throw new Error('“' + t + '” isn’t in the Transporters list. Ask the admin to add it to the Transporters tab first.');
    if (form.balanceAfterDelivery) throw new Error('A DACC order is already paid at the transporter’s warehouse – untick “Balance to be paid after delivery”.');
    out.transporter = known.name;
  } else if (type === ORDER_TYPE_FLIPKART) {
    if (dispatchType !== DISPATCH_COURIER) {
      throw new Error('Flipkart orders are packed and handed over at the Flipkart office as parcels, so only parcel products (Dispatch Type “Courier” in the Product Catalog, e.g. Bio Bacteria) can be on one.');
    }
    var ship = String(form.shipByDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ship)) throw new Error('Enter Flipkart’s ship-by date (it’s on the order in the seller panel).');
    var today = todayYmd_();
    var back = Utilities.formatDate(new Date(Date.now() - 2 * 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (ship < back) throw new Error('The ship-by date is already past – check it on the seller panel.');
    if (form.balanceAfterDelivery) throw new Error('Flipkart collects the payment – untick “Balance to be paid after delivery”.');
    if (form.returnCreditId) throw new Error('A return credit can’t be used on a Flipkart order – Flipkart collects the payment.');
    out.paymentTermsType = TERMS_FLIPKART;
    out.dispatchType = DISPATCH_COURIER; // packed by Ops and handed over at the Flipkart office -- no vehicle or gate pass
    out.crmPoOptional = true;
    out.shipByYmd = ship;
    if (ship < today) out.shipLate = true;
  }
  return out;
}

/** Amount rules. Returns the advance to record. */
function otIntakeAmounts_(ot, total, advance) {
  if (!ot) return advance;
  if (ot.type === ORDER_TYPE_FLIPKART) {
    if (!(total > 0)) throw new Error('Enter the order value (the Flipkart selling price).');
    return total; // Flipkart collects it all
  }
  if (ot.type === ORDER_TYPE_DACC) {
    if (!(total > 0)) throw new Error('Enter the total order value.');
    var min = getOrderTypeSettings_().daccMinPct;
    var pct = advance / total * 100;
    if (pct + 0.05 < min) {
      throw new Error('A DACC order needs at least ' + min + '% paid up front (₹' + formatAmount(Math.ceil(total * min) / 100) +
        ' of ₹' + formatAmount(total) + '). The advance is ' + (Math.round(pct * 10) / 10) + '%.');
    }
  }
  return advance;
}

/** Fields written on the new row for the order type. */
function otIntakeRowFields_(ot, me, total) {
  var f = { 'Order Type': ot ? ot.type : ORDER_TYPE_STANDARD };
  if (!ot) return f;
  if (ot.type === ORDER_TYPE_DACC) {
    f['DACC Transporter'] = ot.transporter;
  } else if (ot.type === ORDER_TYPE_FLIPKART) {
    var now = new Date();
    var p = ot.shipByYmd.split('-');
    var shipDate = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    f['Ship By Date'] = shipDate;
    f['Customer Requested Delivery Date'] = shipDate; // Ops' "wanted by" and "late" lists use this
    f['Payment Verification Status'] = 'Not required – Flipkart';
    f['Verified By'] = 'Flipkart order (logged by ' + (me ? me.name : 'CRE') + ')';
    f['Verified Date'] = now;
    f['Bank Reference / UTR'] = 'Flipkart – paid through the marketplace settlement';
    f['Verification Code'] = generateVerificationCode();
    f['Status'] = 'Sent to Ops';
    f['Sent to Ops Timestamp'] = now;
    f['Balance Fully Paid Timestamp'] = now;
  }
  return f;
}

// ================================================================
// Order details -- used by lookupOrder_ and the Ops page
// ================================================================
function otOrderInfo_(id, raw) {
  var type = normalizeOrderType_(raw['Order Type']);
  var out = { type: type };
  if (type === ORDER_TYPE_FLIPKART) {
    out.shipBy = raw['Ship By Date'] instanceof Date ? Utilities.formatDate(raw['Ship By Date'], Session.getScriptTimeZone(), 'dd-MMM-yyyy') : '';
    out.daysToShip = computeDaysUntilDate(raw['Ship By Date']);
  }
  if (type === ORDER_TYPE_DACC) out.dacc = daccInfo_(raw);
  if (Number(raw['Return Credit Applied']) > 0) {
    out.returnCredit = Number(raw['Return Credit Applied']) || 0;
    out.returnCreditRef = String(raw['Return Credit Ref'] || '');
  }
  if (Number(raw['Original Order Value']) > 0) out.originalValue = Number(raw['Original Order Value']) || 0;
  return out;
}

/** Where a DACC order stands, and what the CRE can do next. */
function daccInfo_(raw) {
  var cfg = getOrderTypeSettings_();
  var tz = Session.getScriptTimeZone();
  var t = transporterInfo_(raw['DACC Transporter']) || { name: '', email: '', phone: '' };
  var status = String(raw['Status'] || '');
  var dispatched = isDispatchedStatus_(status);
  var atGate = (typeof gateWaitingFromValues_ === 'function') ? gateWaitingFromValues_(raw['Status'], raw['Dispatch Type'], raw['Gate Pass Issued Timestamp'], raw['Gate Out Timestamp']) : false;
  var arrived = raw['DACC Arrived At'] instanceof Date ? raw['DACC Arrived At'] : null;
  var released = raw['DACC Released At'] instanceof Date ? raw['DACC Released At'] : null;
  var balance = computeBalanceDue(raw['Total Order Value'], raw['Advance Received']);
  var ds = String(raw['Delivery Status'] || '');
  var days = arrived ? daccDaysSince_(arrived) : null;
  var stage;
  if (status === 'Cancelled') stage = 'cancelled';
  else if (!dispatched || atGate) stage = 'not-dispatched';
  else if (ds === 'Returned') stage = 'returned';
  else if (released) stage = ds === 'Delivered' ? 'delivered' : 'released';
  else if (!arrived) stage = 'in-transit';
  else stage = 'at-warehouse';
  return {
    transporter: t.name, transporterEmail: t.email, transporterPhone: t.phone,
    consignmentNo: String(raw['Tracking / Consignment No.'] || ''),
    arrivedAt: arrived ? Utilities.formatDate(arrived, tz, 'dd-MMM-yyyy') : '',
    warehouse: String(raw['DACC Warehouse'] || ''),
    daysAtWarehouse: days,
    freeDays: cfg.daccFreeDays,
    daysLeft: days === null ? null : cfg.daccFreeDays - days,
    releasedAt: released ? Utilities.formatDate(released, tz, 'dd-MMM-yyyy, hh:mm a') : '',
    releasedBy: String(raw['DACC Released By'] || ''),
    outcome: String(raw['DACC Outcome'] || ''),
    balanceDue: balance,
    stage: stage,
    canMarkArrived: stage === 'in-transit',
    canRelease: stage === 'at-warehouse' && balance <= 0,
    dispatchedOn: raw['Dispatch Timestamp'] instanceof Date ? Utilities.formatDate(raw['Dispatch Timestamp'], tz, 'yyyy-MM-dd') : ''
  };
}

/** Whole calendar days since the goods reached the warehouse (arrival day = 0). */
function daccDaysSince_(d) {
  var tz = Session.getScriptTimeZone();
  var a = Utilities.formatDate(d, tz, 'yyyy-MM-dd'), t = todayYmd_();
  return Math.round((Date.parse(t + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

// ================================================================
// DACC -- CRE actions
// ================================================================
var DACC_FIELDS_ = ['Tracker ID', 'Institution / Customer', 'Status', 'Order Type', 'DACC Transporter', 'DACC Arrived At', 'DACC Warehouse',
  'DACC Outcome', 'DACC Released At', 'DACC Released By', 'Total Order Value', 'Advance Received', 'Delivery Status', 'Dispatch Type',
  'Gate Pass Issued Timestamp', 'Gate Out Timestamp', 'Dispatch Timestamp', 'Tracking / Consignment No.'];

/** CRE: the goods are at the transporter's warehouse. form = { trackerId, arrivedOn (yyyy-MM-dd), warehouse } */
function daccMarkArrived_(form) {
  form = form || {};
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String(form.trackerId || ''));
  if (row === -1) throw new Error('Order not found.');
  requireCanAct_(sheet, row);
  var on = String(form.arrivedOn || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) throw new Error('Choose the date the goods reached the warehouse.');
  if (on > todayYmd_()) throw new Error('That date is in the future.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var raw;
  try {
    raw = getRowFields(sheet, row, DACC_FIELDS_);
    if (normalizeOrderType_(raw['Order Type']) !== ORDER_TYPE_DACC) throw new Error('This isn’t a DACC order.');
    var info = daccInfo_(raw);
    if (info.stage === 'not-dispatched') throw new Error('The goods haven’t left ICF yet.');
    if (info.stage !== 'in-transit') throw new Error('Already recorded as at the warehouse' + (info.arrivedAt ? ' since ' + info.arrivedAt : '') + '.');
    if (info.dispatchedOn && on < info.dispatchedOn) throw new Error('That’s before the goods left ICF (' + fmtYmd_(info.dispatchedOn) + ').');
    var p = on.split('-');
    setRowFields(sheet, row, {
      'DACC Arrived At': new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])),
      'DACC Warehouse': String(form.warehouse || '').trim().slice(0, 200),
      'DACC Outcome': 'At the warehouse – waiting for the customer to inspect'
    });
  } finally {
    lock.releaseLock();
  }
  var cfg = getOrderTypeSettings_();
  return { trackerId: String(raw['Tracker ID']), arrivedOn: fmtYmd_(on), freeDays: cfg.daccFreeDays };
}

/** CRE: balance paid and verified; the transporter has been emailed. form = { trackerId, emailed: true, note } */
function daccRelease_(form) {
  form = form || {};
  if (!form.emailed) throw new Error('Tick the box once you’ve emailed the transporter to cancel the DACC.');
  var me = CURRENT_STAFF_;
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String(form.trackerId || ''));
  if (row === -1) throw new Error('Order not found.');
  requireCanAct_(sheet, row);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var raw, info;
  try {
    raw = getRowFields(sheet, row, DACC_FIELDS_);
    if (normalizeOrderType_(raw['Order Type']) !== ORDER_TYPE_DACC) throw new Error('This isn’t a DACC order.');
    info = daccInfo_(raw);
    if (info.stage === 'released' || info.stage === 'delivered') throw new Error('Already released' + (info.releasedAt ? ' on ' + info.releasedAt : '') + '.');
    if (info.stage !== 'at-warehouse') throw new Error('Mark the goods as at the warehouse first.');
    if (info.balanceDue > 0) {
      throw new Error('₹' + formatAmount(info.balanceDue) + ' is still due. Once the customer pays, tell Accounts (“Customer has paid”) – release the DACC only after Accounts has recorded it.');
    }
    var note = String(form.note || '').trim().slice(0, 200);
    setRowFields(sheet, row, {
      'DACC Released At': new Date(),
      'DACC Released By': me.name + ' (' + me.code + ')',
      'DACC Outcome': 'Accepted – DACC released' + (note ? ' (' + note + ')' : '')
    });
  } finally {
    lock.releaseLock();
  }
  return { trackerId: String(raw['Tracker ID']), transporter: info.transporter };
}

// ================================================================
// Sweeps -- run every 10 minutes (office hours) by checkApprovalAlerts
// ================================================================
/** DACC free days: reminder to the CRE before they run out; escalation once they have. Once each per order. */
function daccSweep_(nowMs, staffMap, alertCfg) {
  var cfg = getOrderTypeSettings_();
  var data = opsReadOrders_();
  var sheet = data.sheet;
  var alertCol = getHeaderIndex('DACC Alerts Sent');
  var first = staffMap[alertCfg.firstApprover] || null;
  var url = appUrl_();
  var sent = 0;
  data.rows.forEach(function (o) {
    if (normalizeOrderType_(o.get('Order Type')) !== ORDER_TYPE_DACC) return;
    if (String(o.get('Status')) === 'Cancelled') return;
    var arrived = o.get('DACC Arrived At');
    if (!(arrived instanceof Date) || o.get('DACC Released At') instanceof Date) return;
    var ds = String(o.get('Delivery Status') || '');
    if (ds === 'Returned' || ds === 'Delivered') return;
    var days = daccDaysSince_(arrived);
    var left = cfg.daccFreeDays - days;
    var cell = String(o.get('DACC Alerts Sent') || '');
    var id = String(o.get('Tracker ID'));
    var owner = staffMap[resolveOwnerCode_(o.get('CRE Code'), o.get('CRE Name'), staffMap)];
    var bal = computeBalanceDue(o.get('Total Order Value'), o.get('Advance Received'));
    var head = id + ' – ' + o.get('Institution / Customer');
    var body = '<p>The DACC goods for <b>' + opsEsc_(head) + '</b> have been at ' + opsEsc_(o.get('DACC Transporter') || 'the transporter') + '’s warehouse' +
      (o.get('DACC Warehouse') ? ' (' + opsEsc_(o.get('DACC Warehouse')) + ')' : '') + ' for <b>' + days + ' day' + (days === 1 ? '' : 's') + '</b>. ' +
      'The transporter keeps them free for ' + cfg.daccFreeDays + ' days.</p>' +
      '<p>' + (bal > 0 ? 'Still due from the customer: <b>₹' + formatAmount(bal) + '</b>. Call them: are they inspecting, and when will they pay? If they reject the goods, raise a return.'
        : 'The balance is paid – email the transporter to cancel the DACC, then tick “DACC released” on the order.') + '</p>';
    if (left <= 0 && !opsHasToken_(cell, 'DaccOverdue')) {
      var cc = first && first.active && /@/.test(first.email) ? [first.email] : [];
      if (cxMail_(owner && owner.active ? [owner.email] : cc, cc, 'DACC free days are up: ' + head, body, url, 'Open the CRE page')) {
        opsAddToken_(sheet, o.row, alertCol, cell, 'DaccOverdue');
        sent++;
      }
    } else if (left > 0 && left <= cfg.daccRemindBefore && !opsHasToken_(cell, 'DaccReminder')) {
      if (owner && owner.active && cxMail_([owner.email], [], 'DACC: ' + left + ' free day' + (left === 1 ? '' : 's') + ' left – ' + head, body, url, 'Open the CRE page')) {
        opsAddToken_(sheet, o.row, alertCol, cell, 'DaccReminder');
        sent++;
      }
    }
  });
  return sent;
}

/** Flipkart ship-by: Ops is told on the ship-by day if it isn't handed over; the first approver once it's past. */
function flipkartSweep_(nowMs, staffMap, alertCfg) {
  var data = opsReadOrders_();
  var sheet = data.sheet;
  var alertCol = getHeaderIndex('Flipkart Alerts Sent');
  var first = staffMap[alertCfg.firstApprover] || null;
  var ops = opsPeople_(staffMap).filter(function (s) { return /@/.test(s.email); }).map(function (s) { return s.email; });
  var url = appUrl_();
  var sent = 0;
  data.rows.forEach(function (o) {
    if (normalizeOrderType_(o.get('Order Type')) !== ORDER_TYPE_FLIPKART) return;
    if (String(o.get('Status')) !== 'Sent to Ops') return; // handed over (Posted), cancelled or on standby
    var days = computeDaysUntilDate(o.get('Ship By Date'));
    if (days === null || days > 0) return;
    var cell = String(o.get('Flipkart Alerts Sent') || '');
    var id = String(o.get('Tracker ID'));
    var body = '<p>Flipkart order <b>' + opsEsc_(id) + '</b> (' + opsEsc_(o.get('Institution / Customer')) + ') ' +
      (days === 0 ? 'must be handed over at the Flipkart office <b>today</b>.' : 'was due at the Flipkart office <b>' + (-days) + ' day' + (days === -1 ? '' : 's') + ' ago</b> – Flipkart may cancel it or penalise the seller account.') +
      '</p><p>Pack it, hand it over, and record the handover on the Operations page.</p>';
    if (days < 0 && !opsHasToken_(cell, 'ShipLate')) {
      var to = first && first.active && /@/.test(first.email) ? [first.email] : ops;
      if (cxMail_(to, ops, 'LATE for Flipkart: ' + id, body, url ? url + '?page=ops' : '', 'Open the Operations page')) {
        opsAddToken_(sheet, o.row, alertCol, cell, 'ShipLate'); sent++;
      }
    } else if (days === 0 && !opsHasToken_(cell, 'ShipToday')) {
      if (cxMail_(ops, [], 'Ship today for Flipkart: ' + id, body, url ? url + '?page=ops' : '', 'Open the Operations page')) {
        opsAddToken_(sheet, o.row, alertCol, cell, 'ShipToday'); sent++;
      }
    }
  });
  return sent;
}

// ================================================================
// Wiring used by Code.js
// ================================================================
function orderTypesApiMap_() {
  return {
    getOrderTypeOptions: { fn: getOrderTypeOptions_, roles: ['CRE', 'Accounts', 'Director'] },
    daccMarkArrived:     { fn: daccMarkArrived_,     roles: ['CRE'], log: 'DACC: goods at transporter warehouse' },
    daccRelease:         { fn: daccRelease_,         roles: ['CRE'], log: 'DACC released' }
  };
}

function orderTypesActivityDetail_(fnName, a, result) {
  a = a || {}; result = result || {};
  switch (fnName) {
    case 'daccMarkArrived': return 'Arrived ' + (result.arrivedOn || '') + (a.warehouse ? ' at ' + a.warehouse : '');
    case 'daccRelease': return 'Transporter (' + (result.transporter || '') + ') emailed to cancel the DACC' + (a.note ? ' – ' + a.note : '');
    default: return '';
  }
}
