/**
 * RENTALS (Oct 2026) -- rental toilets and their sets, from paid order to return
 * ---------------------------------------------------------------------
 * WHY: rentals used to be logged by the CRE as a normal order and dispatched
 * like a sale. Nothing recorded which units went out, where they are, when
 * they were installed or returned, or what is still owed. A sale ends at
 * dispatch; a rental starts there.
 *
 * DESIGN (agreed with Hari, 24 Oct 2026 -- "ICF Rental Management System --
 * Future-State Design" doc): the unit of business is the DEPLOYMENT, not the
 * single toilet. One rental order holds:
 *   - the requirement (CRE) and the component configuration (Ananthu):
 *     how many toilets, septic tanks, water tanks and stands go out. Several
 *     toilets can share a septic tank, so there is no fixed set.
 *   - any number of dispatch trips, deployments (installations), off-hires
 *     and return trips. Trips and deployments are separate on purpose: three
 *     trips can feed one installation; a 100-unit project installs in
 *     scheduled deployments.
 *   - a payment schedule: the advance plus whatever was agreed.
 * Every item carries a stencilled ID (T-0001 toilet, S- septic tank,
 * W- water tank, ST- stand), issued by the system when Ops tags it.
 * "No tag, no load."
 *
 * FLOW
 *   CRE        logs the rental ONLY after the advance is paid (Rentals page).
 *   Accounts   verifies the advance (or sends it back to the CRE).
 *   Ananthu    acknowledges -- or, when the needed date is 15+ days away
 *              (Settings), sets a reminder date: the order waits in
 *              "Scheduled" with no nudges and comes back on that date.
 *              Then enters the component configuration.
 *   Manoj      tags/allocates items, loads a trip and requests a gate pass.
 *   Accounts   issues the rental gate pass (PDF lists the item IDs).
 *   Sanju      marks the trip out on the Gate page.
 *   Ananthu    marks a deployment installed (date + site photo): RENT STARTS.
 *   CRE        records the off-hire request: RENT STOPS for those items.
 *   Ananthu    records suction, then plans the pickup (return trip).
 *   Sanju      marks the return trip in; Manoj inspects each item
 *              (OK -> Available, damaged -> Under Repair).
 *   Accounts   settles and closes once everything is back and paid.
 * Ananthu's steps use the Admin role; Directors can do them too ("Director"
 * in the API map below -- Admin is always allowed by callApi).
 *
 * DATA: separate tabs (nothing is written to the main tracker sheet):
 *   Rental Orders, Rental Payments, Rental Configuration, Rental Items,
 *   Rental Trips, Rental Deployments, Rental Off-hires, Rental Vendor Jobs,
 *   Rental Item Types. Columns are found by their header names, so new
 *   columns can be added at the end later without breaking anything.
 *
 * MONEY: billing mode per order -- Per event (fixed value) or Per day /
 * week / month (rate per item per period, run per item from its installation
 * date to its off-hire date). Days past the planned end are charged at the
 * overrun rate per toilet per day (provisional policy, Sambhu to confirm). Rent and overrun
 * count toilets only -- tanks and stands go with them.
 * The figures the system works out are ESTIMATES for Accounts; what is
 * actually billed is the payment schedule (Rental Payments tab).
 *
 * REMINDERS: rentalSweep_ runs inside the 10-minute alert check (office
 * hours). Emails + the Notification Log, plus pop-ups on the Rentals page.
 *
 * GO-LIVE: "Rentals: set up and go live" on the ICF Admin menu (setupRentals).
 * Item-level functions live in RentalFleet.js.
 */

var RENTAL_GO_LIVE_PROP = 'rental_go_live_ms';
var RENTAL_DOCS_FOLDER_NAME = 'ICF Rental Documents';
var RENTAL_GATE_PASS_FOLDER_NAME = 'ICF Rental Gate Passes';
var RENTAL_MODES = ['Per event', 'Per day', 'Per week', 'Per month'];
var RENTAL_PERIOD_DAYS = { 'Per day': 1, 'Per week': 7, 'Per month': 30 };
var RENTAL_TRIGGERS = ['', 'On installation', 'On off-hire', 'Before pickup'];
var RENTAL_CHARGE_KINDS = ['Instalment', 'Overrun', 'Damage', 'Extra charge'];
var RENTAL_EXTRA_KINDS = ['Overrun', 'Damage', 'Extra charge']; // added on top of the rent / event value
var RENTAL_AUTO_BILL = ['', 'Every week', 'Every month'];
var RENTAL_AUTO_BILL_DAYS = { 'Every week': 7, 'Every month': 30 };
var RENTAL_STANDBY_REASONS = ['Site not ready', 'Customer asked to postpone', 'Customer payment pending', 'No site access for pickup', 'Other'];
var RN_UNDO_MINUTES = 30; // a wrong tap at the gate can be undone this long after
var RENTAL_CATEGORIES = [
  { name: 'Toilet', prefix: 'T' },
  { name: 'Septic tank', prefix: 'S' },
  { name: 'Water tank', prefix: 'W' },
  { name: 'Stand', prefix: 'ST' }
];
// Item statuses. "Out" = with the customer side (counts against the order until it is back).
var RI_AVAILABLE = 'Available', RI_ALLOCATED = 'Allocated', RI_LOADED = 'Loaded', RI_TRANSIT = 'In Transit',
    RI_DEPLOYED = 'Deployed', RI_OFFHIRED = 'Off-hired', RI_RETURNING = 'Returning', RI_INSPECTION = 'Inspection',
    RI_REPAIR = 'Under Repair', RI_LOST = 'Lost', RI_SCRAPPED = 'Scrapped';
var RI_OUT = [RI_LOADED, RI_TRANSIT, RI_DEPLOYED, RI_OFFHIRED, RI_RETURNING];
var RI_ORDER = [RI_AVAILABLE, RI_ALLOCATED, RI_LOADED, RI_TRANSIT, RI_DEPLOYED, RI_OFFHIRED, RI_RETURNING, RI_INSPECTION, RI_REPAIR, RI_LOST, RI_SCRAPPED];

var RENTAL_TABLES = {
  orders: { name: 'Rental Orders', id: 'Rental ID', text: ['Customer Phone', 'Site Contact Phone', 'Site Pincode', 'Customer GSTIN', 'Advance UTR', 'Deposit UTR'],
    headers: ['Rental ID', 'Logged At', 'CRE Code', 'CRE Name', 'Customer', 'Customer Phone', 'Customer Email', 'Customer GSTIN',
      'Billing Address', 'Site Address', 'Site District', 'Site State', 'Site Pincode', 'Site Contact', 'Site Contact Phone',
      'Toilets Requested', 'Requirement', 'Billing Mode', 'Rate', 'Order Value', 'Overrun Rate', 'Planned Start', 'Planned End',
      'Advance Amount', 'Advance UTR', 'Deposit Amount', 'Deposit UTR', 'Agreement URL', 'Status', 'Sent Back Note',
      'Verified By', 'Verified At', 'Remind On', 'Deferred By', 'Acknowledged By', 'Acknowledged At',
      'Configured By', 'Configured At', 'Remarks', 'Closed By', 'Closed At', 'Settlement Note', 'Alerts Sent', 'History',
      // Oct 2026 round 2 -- added at the end, so live sheets just grow new columns (rnTable_ writes missing headers).
      'Auto Bill', 'Standby Status', 'Standby Reason', 'Standby Until', 'Standby New Start', 'Standby By', 'Standby Requested By',
      'Standby Ended At', 'Damage Notes', 'Imported', 'Standby Requested At'] },
  payments: { name: 'Rental Payments', id: 'Line ID', text: ['UTR'],
    headers: ['Line ID', 'Rental ID', 'Kind', 'Amount Due', 'Due Date', 'Due Trigger', 'Status', 'Amount Received', 'UTR',
      'Customer Says Paid At', 'Recorded By', 'Verified By', 'Verified At', 'Note', 'Alerts Sent'] },
  config: { name: 'Rental Configuration', id: 'Rental ID',
    headers: ['Rental ID', 'Category', 'Type', 'Quantity', 'Updated By', 'Updated At'] },
  items: { name: 'Rental Items', id: 'Item ID',
    headers: ['Item ID', 'Category', 'Type', 'Status', 'Rental ID', 'Trip ID', 'Deployment ID', 'Tagged At', 'Tagged By',
      'Tagged For', 'Last Update', 'Condition Note', 'History'] },
  trips: { name: 'Rental Trips', id: 'Trip ID', text: ['Vehicle No.', 'Gate Pass No.'],
    headers: ['Trip ID', 'Rental ID', 'Direction', 'Items', 'Counts', 'Vehicle No.', 'Transport', 'Vendor', 'Cost', 'Status',
      'Created By', 'Created At', 'Gate Pass No.', 'Gate Pass URL', 'Gate Pass Issued By', 'Gate Pass Issued At',
      'Gate By', 'Gate At', 'Gate Note', 'Alerts Sent', 'Photo URL'] },
  deployments: { name: 'Rental Deployments', id: 'Deployment ID',
    headers: ['Deployment ID', 'Rental ID', 'Items', 'Installed On', 'Planned End', 'Photo URL', 'Marked By', 'Marked At', 'Note'] },
  offhires: { name: 'Rental Off-hires', id: 'Off-hire ID',
    headers: ['Off-hire ID', 'Rental ID', 'Items', 'Off-hire On', 'Recorded By', 'Recorded At', 'Suction Done On',
      'Suction Vendor', 'Suction Cost', 'Suction By', 'Note'] },
  jobs: { name: 'Rental Vendor Jobs', id: 'Job ID',
    headers: ['Job ID', 'Rental ID', 'Kind', 'Vendor', 'Date', 'Cost', 'Ref', 'Note', 'Recorded By', 'Recorded At'] },
  types: { name: 'Rental Item Types', id: 'Type',
    headers: ['Category', 'Type', 'Active', 'Untagged In Yard'] }
};
var RENTAL_JOB_KINDS = ['Transport', 'Plumbing / installation', 'Cleaning', 'Suction', 'Other'];

// [label, default, help, kind, min, max] -- shown on the Settings page under "Rentals".
var RENTAL_SETTINGS_ROWS = [
  ['Rentals: warn when the needed date is at least (days) away', '15', 'A verified rental needed this far ahead lets Ananthu set a reminder date instead of acknowledging now. It waits in “Scheduled” with no nudges until then.', 'number', 1, 120],
  ['Rentals: Accounts to verify the advance within (working hours)', '24', 'Reminder to Accounts when a logged rental is still unverified.', 'number', 1, 336],
  ['Rentals: escalate an unverified advance after (working hours)', '48', 'Goes to the first approver, copied to Accounts.', 'number', 1, 336],
  ['Rentals: acknowledge a verified rental within (working hours)', '24', 'Reminder to the first approver (Ananthu). Counted from verification, or from the reminder date if one was set.', 'number', 1, 336],
  ['Rentals: escalate an unacknowledged rental after (working hours)', '48', 'Goes to the escalation contact.', 'number', 1, 336],
  ['Rentals: remind the CRE before the planned end (days)', '3', 'The CRE confirms an extension or records the off-hire.', 'number', 1, 30],
  ['Rentals: pickup deadline after off-hire (working days)', '3', 'Provisional until Sambhu decides. Suction and pickup should be done by then; past it, Ananthu is reminded, then the escalation contact.', 'number', 1, 30],
  ['Rentals: escalate an overdue payment after (working days)', '2', 'A payment past its due date goes to Ananthu and the CRE first, then to the escalation contact after this many working days.', 'number', 1, 30],
  ['Rentals: inspect returned items within (working days)', '1', 'Reminder to Ops; escalates to Ananthu after twice this.', 'number', 1, 30],
  ['Rentals: settle a fully returned rental within (working days)', '3', 'Reminder to Accounts; escalates to Ananthu after twice this.', 'number', 1, 30],
  ['Rentals: security deposit', 'No', 'Yes adds a deposit field at intake, which Accounts verifies with the advance.', 'yesno']
];

// ================================================================
// Small helpers
// ================================================================
function rnTz_() { return Session.getScriptTimeZone(); }
function rnEsc_(t) { return opsEsc_(t); }
function rnYmd_(v) { return sbYmd_(v); }
function rnFmtDate_(v) { var y = rnYmd_(v); return y ? fmtYmd_(y) : ''; }
function rnFmtTime_(v) { return opsFmt_(v); }
function rnMs_(v) { return opsMs_(v); }
function rnNum_(v) { var n = Number(String(v == null ? '' : v).replace(/[,\s₹]/g, '')); return isNaN(n) ? 0 : n; }
function rnRupees_(n) { return sbRupees_(n); }
function rnWho_(me) { return me.name + ' (' + me.code + ')'; }
function rnStamp_() { return Utilities.formatDate(new Date(), rnTz_(), 'dd-MMM HH:mm'); }
function rnSplit_(s) { return String(s || '').split(/[\s,;]+/).map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean); }
function rnUniq_(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
function rnPrefixOf_(category) {
  var c = RENTAL_CATEGORIES.filter(function (x) { return x.name === category; })[0];
  return c ? c.prefix : '';
}
function rnCategoryOfId_(id) {
  var m = String(id || '').toUpperCase().match(/^([A-Z]+)-\d+$/);
  if (!m) return '';
  var c = RENTAL_CATEGORIES.filter(function (x) { return x.prefix === m[1]; })[0];
  return c ? c.name : '';
}
function rnIsLive_() { return !!Number(PropertiesService.getScriptProperties().getProperty(RENTAL_GO_LIVE_PROP) || 0); }
function rnAssertLive_() {
  if (!rnIsLive_()) throw new Error('Rentals aren’t switched on yet – the admin runs “Rentals: set up and go live” on the ICF Admin menu first.');
}
function rnMe_() {
  if (!CURRENT_STAFF_) throw new Error('Not signed in.');
  return CURRENT_STAFF_;
}
function rnIsCoordinator_(me) { return me && (me.role === 'Admin' || me.role === 'Director'); }

/**
 * CRE cover (Oct 2026): a CRE may act on a rental they own, or one owned by a
 * CRE they are covering TODAY (Staff tab: Away From / Away To / Covered By,
 * set on the Admin page -- the same cover the sales tracker uses).
 */
function rnCreMayAct_(o, me) {
  if (!me || me.role !== 'CRE') return false;
  var owner = String(o['CRE Code'] || '').toUpperCase();
  if (owner === me.code) return true;
  var map = (RN_COVER_MEMO_ && RN_COVER_MEMO_.code === me.code) ? RN_COVER_MEMO_.map : coveredCodesFor_(me.code, getStaffMap_(false));
  return !!map[owner];
}
// Set only while one page load loops over every rental (getRentalHome_), then cleared.
var RN_COVER_MEMO_ = null;
function rnAssertCre_(o, me) {
  if (me.role === 'CRE' && !rnCreMayAct_(o, me)) throw new Error('This rental belongs to ' + o['CRE Name'] + '. If you are covering for them, ask the admin to set the leave cover on the Admin page.');
}
/** Who gets a CRE's rental messages today: the cover while they are away, else the CRE. */
function rnCreRecipients_(code, staffMap) {
  var s = staffMap[String(code || '').toUpperCase()];
  if (!s) return [];
  var today = todayYmd_();
  if (s.awayFrom && s.awayTo && s.awayFrom <= today && today <= s.awayTo && s.coveredBy && staffMap[s.coveredBy] && staffMap[s.coveredBy].active) return [staffMap[s.coveredBy]];
  return s.active ? [s] : [];
}
function rnLock_() { var l = LockService.getScriptLock(); l.waitLock(20000); return l; }
function rnValidYmd_(s, label) {
  s = String(s || '').trim();
  if (!sbIsYmd_(s)) throw new Error('Enter ' + label + '.');
  return s;
}
/** Working days (24 h each, Sundays/holidays skipped) between two moments. */
function rnWorkingDays_(fromMs, toMs) { return opsWorkingHours_(fromMs, toMs) / 24; }
function rnDayStartMs_(ymd) { return ymd ? sbYmdToDate_(ymd).getTime() : 0; }
function rnPlural_(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

/** Rental settings, clamped. Cached 5 minutes (cleared when Settings are saved). */
function getRentalSettings_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('rental_settings');
  if (hit) return JSON.parse(hit);
  var map = sbReadSettingsMap_();
  var n = function (i) {
    var r = RENTAL_SETTINGS_ROWS[i];
    var raw = map[r[0].toLowerCase()];
    var v = Number(String(raw == null ? '' : raw).replace(/[,\s]/g, ''));
    if (raw === undefined || raw === '' || isNaN(v)) v = Number(r[1]);
    return Math.min(r[5], Math.max(r[4], Math.floor(v)));
  };
  var dep = String(map[RENTAL_SETTINGS_ROWS[10][0].toLowerCase()] || RENTAL_SETTINGS_ROWS[10][1]).trim().toLowerCase();
  var s = {
    deferDays: n(0), verifyHours: n(1), verifyEscHours: n(2), ackHours: n(3), ackEscHours: n(4),
    endRemindDays: n(5), pickupDays: n(6), payEscDays: n(7), inspectDays: n(8), settleDays: n(9),
    depositOn: dep === 'yes' || dep === 'y'
  };
  if (s.verifyEscHours <= s.verifyHours) s.verifyEscHours = s.verifyHours * 2;
  if (s.ackEscHours <= s.ackHours) s.ackEscHours = s.ackHours * 2;
  cache.put('rental_settings', JSON.stringify(s), 300);
  return s;
}

// ================================================================
// Tabs -- read by header name
// ================================================================
function rnSheet_(key) {
  var t = RENTAL_TABLES[key];
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(t.name);
  if (!sh) {
    sh = ss.insertSheet(t.name);
    // A new tab has 26 columns; Rental Orders needs more. Writing past the grid throws.
    if (sh.getMaxColumns() < t.headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), t.headers.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, t.headers.length).setValues([t.headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    (t.text || []).forEach(function (h) {
      var c = t.headers.indexOf(h) + 1;
      if (c > 0) sh.getRange(2, c, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
    });
  }
  return sh;
}

/** { sheet, col: {header: index0}, rows: [{ _row, header: value }] }. Adds any missing header at the end. */
function rnTable_(key) {
  var t = RENTAL_TABLES[key];
  var sh = rnSheet_(key);
  var width = Math.max(sh.getLastColumn(), 1);
  var hdr = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h || '').trim(); });
  var col = {};
  hdr.forEach(function (h, i) { if (h && col[h] === undefined) col[h] = i; });
  t.headers.forEach(function (h) {
    if (col[h] !== undefined) return;
    width = Math.max(width, hdr.length);
    var at = hdr.length;
    if (sh.getMaxColumns() < at + 1) sh.insertColumnsAfter(sh.getMaxColumns(), at + 1 - sh.getMaxColumns());
    sh.getRange(1, at + 1).setValue(h).setFontWeight('bold');
    if ((t.text || []).indexOf(h) !== -1) sh.getRange(2, at + 1, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
    hdr.push(h);
    col[h] = at;
  });
  width = hdr.length;
  var rows = [];
  var last = sh.getLastRow();
  if (last >= 2) {
    var idCol = col[t.headers[0]];
    sh.getRange(2, 1, last - 1, width).getValues().forEach(function (r, i) {
      if (!String(r[idCol] == null ? '' : r[idCol]).trim()) return;
      var o = { _row: i + 2 };
      t.headers.forEach(function (h) { o[h] = r[col[h]]; });
      rows.push(o);
    });
  }
  return { key: key, sheet: sh, col: col, width: width, rows: rows };
}

function rnSet_(tbl, rowObj, fields) {
  Object.keys(fields).forEach(function (h) {
    var c = tbl.col[h];
    if (c === undefined) throw new Error('Unknown rental column: ' + h);
    tbl.sheet.getRange(rowObj._row, c + 1).setValue(fields[h]);
    rowObj[h] = fields[h];
  });
}

function rnAppend_(tbl, obj) {
  var arr = [];
  for (var i = 0; i < tbl.width; i++) arr.push('');
  Object.keys(obj).forEach(function (h) {
    var c = tbl.col[h];
    if (c === undefined) throw new Error('Unknown rental column: ' + h);
    arr[c] = obj[h];
  });
  var r = tbl.sheet.getLastRow() + 1;
  var text = RENTAL_TABLES[tbl.key].text || [];
  text.forEach(function (h) { if (tbl.col[h] !== undefined) tbl.sheet.getRange(r, tbl.col[h] + 1).setNumberFormat('@'); });
  tbl.sheet.getRange(r, 1, 1, tbl.width).setValues([arr]);
  var o = { _row: r };
  RENTAL_TABLES[tbl.key].headers.forEach(function (h) { o[h] = obj[h] === undefined ? '' : obj[h]; });
  tbl.rows.push(o);
  return o;
}

/** Next ID like RNT-0007 from the IDs already in the tab. */
function rnNextId_(tbl, prefix) {
  var max = 0, re = new RegExp('^' + prefix + '-(\\d+)$');
  tbl.rows.forEach(function (r) {
    var m = String(r[RENTAL_TABLES[tbl.key].headers[0]] || '').match(re);
    if (m) max = Math.max(max, Number(m[1]));
  });
  var n = String(max + 1);
  while (n.length < 4) n = '0' + n;
  return prefix + '-' + n;
}

function rnFind_(tbl, id) {
  var key = RENTAL_TABLES[tbl.key].headers[0];
  id = String(id || '').trim().toUpperCase();
  for (var i = 0; i < tbl.rows.length; i++) if (String(tbl.rows[i][key]).toUpperCase() === id) return tbl.rows[i];
  return null;
}

/** Adds a dated line to the order's History cell. */
function rnHistory_(orders, o, text, me) {
  var line = rnStamp_() + ' ' + (me ? me.name : 'System') + ': ' + text;
  var cur = String(o['History'] || '');
  rnSet_(orders, o, { 'History': (cur ? cur + '\n' : '') + line });
}
function rnItemHistory_(items, it, text, me) {
  var line = rnStamp_() + ' ' + (me ? me.name : 'System') + ': ' + text;
  var cur = String(it['History'] || '');
  rnSet_(items, it, { 'History': (cur ? cur + '\n' : '') + line, 'Last Update': new Date() });
}

/** Everything in one read. */
function rnLoad_() {
  return {
    orders: rnTable_('orders'), payments: rnTable_('payments'), config: rnTable_('config'), items: rnTable_('items'),
    trips: rnTable_('trips'), deployments: rnTable_('deployments'), offhires: rnTable_('offhires'), jobs: rnTable_('jobs'),
    types: rnTable_('types')
  };
}
function rnOrder_(ctx, rentalId) {
  var o = rnFind_(ctx.orders, rentalId);
  if (!o) throw new Error('Rental ' + rentalId + ' not found.');
  return o;
}
function rnOf_(tbl, rentalId) {
  var id = String(rentalId).toUpperCase();
  return tbl.rows.filter(function (r) { return String(r['Rental ID']).toUpperCase() === id; });
}

// ================================================================
// Stage, money and the order view
// ================================================================
/**
 * How many of each configured category|type this order already has covered:
 * items allocated or loaded now, plus every item that has LEFT on one of its
 * trips (even if it has since come back). { 'Toilet|Toilet': 12, ... }
 */
function rnCoverage_(ctx, rentalId) {
  var cov = {};
  var add = function (it) { var k = it['Category'] + '|' + it['Type']; cov[k] = (cov[k] || 0) + 1; };
  var sent = {};
  rnOf_(ctx.trips, rentalId).forEach(function (t) {
    if (t['Direction'] === 'Out' && t['Status'] === 'Left') rnSplit_(t['Items']).forEach(function (x) { sent[x] = true; });
  });
  // Installed items count too -- a rental imported while already on site has no trip.
  rnOf_(ctx.deployments, rentalId).forEach(function (d) { rnSplit_(d['Items']).forEach(function (x) { sent[x] = true; }); });
  Object.keys(sent).forEach(function (x) { var it = rnFind_(ctx.items, x); if (it) add(it); });
  rnOf_(ctx.items, rentalId).forEach(function (it) {
    if ((it['Status'] === RI_ALLOCATED || it['Status'] === RI_LOADED) && !sent[String(it['Item ID']).toUpperCase()]) add(it);
  });
  return cov;
}

/** Counts of this order's items by status, and its configuration needs. */
function rnItemSummary_(ctx, rentalId) {
  var mine = rnOf_(ctx.items, rentalId);
  var by = {};
  RI_ORDER.forEach(function (s) { by[s] = 0; });
  mine.forEach(function (it) { by[it['Status']] = (by[it['Status']] || 0) + 1; });
  var cov = rnCoverage_(ctx, rentalId);
  var need = rnOf_(ctx.config, rentalId).map(function (c) {
    return { category: String(c['Category']), type: String(c['Type']), quantity: rnNum_(c['Quantity']), have: cov[c['Category'] + '|' + c['Type']] || 0 };
  });
  var out = 0;
  RI_OUT.forEach(function (s) { out += by[s] || 0; });
  var tripsLeft = rnOf_(ctx.trips, rentalId).filter(function (t) { return t['Direction'] === 'Out' && t['Status'] === 'Left'; }).length +
    rnOf_(ctx.deployments, rentalId).length; // "something has gone out" -- imported rentals have deployments but no trips
  var returnedIn = rnOf_(ctx.trips, rentalId).filter(function (t) { return t['Direction'] === 'Return' && t['Status'] === 'Arrived'; });
  var needTotal = need.reduce(function (s, x) { return s + x.quantity; }, 0);
  var haveTotal = need.reduce(function (s, x) { return s + Math.min(x.have, x.quantity); }, 0);
  return {
    by: by, total: mine.length, out: out, need: need, needTotal: needTotal, haveTotal: haveTotal,
    tripsLeft: tripsLeft,
    // Everything sent has come back and nothing more is waiting to go.
    allBack: tripsLeft > 0 && out === 0 && !by[RI_ALLOCATED] && haveTotal >= needTotal,
    lastInMs: returnedIn.reduce(function (m, t) { return Math.max(m, rnMs_(t['Gate At'])); }, 0)
  };
}

/** One line telling where the order stands. */
function rnStage_(ctx, o, sum) {
  var base = rnStageBase_(ctx, o, sum);
  if ((o['Status'] === 'Verified' || o['Status'] === 'Acknowledged') && rnStandbyActive_(o)) {
    return { key: 'standby', label: 'On standby until ' + rnFmtDate_(o['Standby Until']) + ' – ' + o['Standby Reason'] + ' (' + base.label + ')', under: base.key };
  }
  if (String(o['Standby Status']) === 'Requested') base.label += ' · standby requested';
  return base;
}
function rnStageBase_(ctx, o, sum) {
  var st = String(o['Status']);
  if (st === 'Logged') return o['Sent Back Note'] ? { key: 'sentback', label: 'Sent back to the CRE' } : { key: 'verify', label: 'Awaiting advance verification' };
  if (st === 'Cancelled') return { key: 'cancelled', label: 'Cancelled' };
  if (st === 'Closed') return { key: 'closed', label: 'Closed' };
  var today = todayYmd_();
  if (st === 'Verified') {
    var rem = rnYmd_(o['Remind On']);
    if (rem && rem > today) return { key: 'scheduled', label: 'Scheduled – back for acknowledgement on ' + fmtYmd_(rem) };
    return { key: 'ack', label: 'Awaiting acknowledgement' };
  }
  sum = sum || rnItemSummary_(ctx, o['Rental ID']);
  if (!sum.need.length) return { key: 'configure', label: 'To configure' };
  var b = sum.by;
  if (sum.allBack) return { key: 'settle', label: 'All items back – to settle' };
  var bits = [];
  if (b[RI_DEPLOYED]) bits.push(b[RI_DEPLOYED] + ' on hire');
  if (b[RI_OFFHIRED]) bits.push(b[RI_OFFHIRED] + ' off-hired, awaiting pickup');
  if (b[RI_RETURNING]) bits.push(b[RI_RETURNING] + ' returning');
  if (b[RI_TRANSIT]) bits.push(b[RI_TRANSIT] + ' in transit');
  if (b[RI_LOADED]) bits.push(b[RI_LOADED] + ' loaded');
  if (b[RI_DEPLOYED] || b[RI_OFFHIRED] || b[RI_RETURNING]) return { key: 'onhire', label: bits.join(', ') };
  if (b[RI_TRANSIT]) return { key: 'install', label: 'Dispatched – to install (' + bits.join(', ') + ')' };
  return { key: 'prepare', label: 'Preparing – ' + sum.haveTotal + ' of ' + sum.needTotal + ' items allocated' + (b[RI_LOADED] ? ', ' + b[RI_LOADED] + ' loaded' : '') };
}

/**
 * Rent and overrun so far, per item: from its installation date to its
 * off-hire date (or today). Days up to the deployment's planned end are rent
 * (time-based modes only); days after it are overrun at the overrun rate.
 * Day count = end - start + 1 (the installation day counts). Estimates.
 */
function rnMoney_(ctx, o, asOfYmd) {
  var id = o['Rental ID'];
  var mode = String(o['Billing Mode'] || 'Per event');
  var rate = rnNum_(o['Rate']), overrunRate = rnNum_(o['Overrun Rate']);
  var periodDays = RENTAL_PERIOD_DAYS[mode] || 0;
  var today = asOfYmd || todayYmd_(); // period billing asks "as of the period end"
  var offOf = {};
  rnOf_(ctx.offhires, id).forEach(function (r) {
    rnSplit_(r['Items']).forEach(function (it) { offOf[it] = rnYmd_(r['Off-hire On']); });
  });
  var rentDays = 0, overrunDays = 0, rent = 0, itemsOnHire = 0;
  rnOf_(ctx.deployments, id).forEach(function (d) {
    var start = rnYmd_(d['Installed On']), plannedEnd = rnYmd_(d['Planned End']) || rnYmd_(o['Planned End']);
    if (!start || start > today) return;
    // Rent and overrun count TOILETS only: the toilet is the unit hired; its tanks and stands go with it
    // ("rate per toilet" at intake). Fixed Oct 2026 round 2 -- the first build counted every item.
    rnSplit_(d['Items']).filter(function (it) {
      var row = rnFind_(ctx.items, it);
      return (row ? String(row['Category']) : rnCategoryOfId_(it)) === 'Toilet';
    }).forEach(function (it) {
      var end = offOf[it] && offOf[it] < today ? offOf[it] : today;
      if (!offOf[it]) itemsOnHire++;
      if (end < start) return;
      var days = sbDaysBetween_(start, end) + 1;
      var inPlan = plannedEnd ? Math.max(0, Math.min(days, sbDaysBetween_(start, plannedEnd) + 1)) : days;
      var over = days - inPlan;
      rentDays += inPlan; overrunDays += over;
      if (periodDays) rent += Math.ceil(inPlan / periodDays) * rate;
    });
  });
  var lines = rnOf_(ctx.payments, id);
  var live = lines.filter(function (l) { return l['Status'] !== 'Waived'; });
  var deposit = live.filter(function (l) { return l['Kind'] === 'Deposit'; });
  var charges = live.filter(function (l) { return RENTAL_EXTRA_KINDS.indexOf(String(l['Kind'])) !== -1; })
    .reduce(function (s, l) { return s + rnNum_(l['Amount Due']); }, 0);
  var overrunBilled = live.filter(function (l) { return l['Kind'] === 'Overrun'; }).reduce(function (s, l) { return s + rnNum_(l['Amount Due']); }, 0);
  var received = live.filter(function (l) { return l['Kind'] !== 'Deposit' && l['Status'] === 'Verified'; })
    .reduce(function (s, l) { return s + rnNum_(l['Amount Received']); }, 0);
  var depositReceived = deposit.filter(function (l) { return l['Status'] === 'Verified'; }).reduce(function (s, l) { return s + rnNum_(l['Amount Received']); }, 0);
  var orderValue = rnNum_(o['Order Value']);
  var base = mode === 'Per event' ? orderValue : (rnOf_(ctx.deployments, id).length ? rent : orderValue);
  var due = base + charges;
  var overrunEstimate = overrunDays * overrunRate;
  return {
    mode: mode, rate: rate, overrunRate: overrunRate, orderValue: orderValue,
    rentDays: rentDays, overrunDays: overrunDays, rentEstimate: Math.round(rent), itemsOnHire: itemsOnHire,
    overrunEstimate: Math.round(overrunEstimate), overrunBilled: overrunBilled,
    overrunUnbilled: Math.max(0, Math.round(overrunEstimate - overrunBilled)),
    base: Math.round(base), charges: charges, due: Math.round(due), received: received,
    balance: Math.round(due - received), deposit: depositReceived
  };
}

function rnCost_(ctx, rentalId) {
  var jobs = rnOf_(ctx.jobs, rentalId).reduce(function (s, j) { return s + rnNum_(j['Cost']); }, 0);
  var trips = rnOf_(ctx.trips, rentalId).reduce(function (s, t) { return s + rnNum_(t['Cost']); }, 0);
  return { jobs: jobs, trips: trips, total: jobs + trips };
}

/** Effective due date of a payment line ('' = not due yet). */
function rnLineDue_(ctx, o, l, sum) {
  var d = rnYmd_(l['Due Date']);
  if (d) return d;
  var trig = String(l['Due Trigger'] || '');
  var deps = rnOf_(ctx.deployments, o['Rental ID']);
  if (trig === 'On installation') {
    return deps.reduce(function (m, x) { var y = rnYmd_(x['Installed On']); return y && (!m || y < m) ? y : m; }, '');
  }
  if (trig === 'On off-hire' || trig === 'Before pickup') {
    sum = sum || rnItemSummary_(ctx, o['Rental ID']);
    if (!deps.length || sum.by[RI_DEPLOYED] || sum.by[RI_TRANSIT] || sum.by[RI_LOADED]) return '';
    return rnOf_(ctx.offhires, o['Rental ID']).reduce(function (m, x) { var y = rnYmd_(x['Off-hire On']); return y > m ? y : m; }, '');
  }
  return '';
}

function rnLineView_(ctx, o, l, sum) {
  var due = rnLineDue_(ctx, o, l, sum);
  var st = String(l['Status']);
  var open = st === 'Due' || st === 'Paid – to verify';
  return {
    lineId: String(l['Line ID']), kind: String(l['Kind']), amount: rnNum_(l['Amount Due']),
    dueDate: rnFmtDate_(l['Due Date']), dueDateYmd: rnYmd_(l['Due Date']), trigger: String(l['Due Trigger'] || ''), effectiveDue: due ? fmtYmd_(due) : '',
    overdue: open && st === 'Due' && !!due && due < todayYmd_(),
    status: st, received: rnNum_(l['Amount Received']), utr: String(l['UTR'] || ''),
    saysPaidAt: rnFmtTime_(l['Customer Says Paid At']), verifiedBy: String(l['Verified By'] || ''),
    verifiedAt: rnFmtTime_(l['Verified At']), note: String(l['Note'] || '')
  };
}

/** A short card for lists. */
function rnCard_(ctx, o, sum) {
  sum = sum || rnItemSummary_(ctx, o['Rental ID']);
  var stage = rnStage_(ctx, o, sum);
  var start = rnYmd_(o['Planned Start']);
  return {
    rentalId: String(o['Rental ID']), customer: String(o['Customer'] || ''),
    site: [o['Site District'], o['Site State']].filter(function (x) { return String(x || '').trim(); }).join(', '),
    creName: String(o['CRE Name'] || ''), creCode: String(o['CRE Code'] || ''),
    status: String(o['Status']), stage: stage.label, stageKey: stage.key, baseKey: stage.under || stage.key,
    standby: rnStandbyView_(o), imported: String(o['Imported'] || '') === 'Y', autoBill: String(o['Auto Bill'] || ''),
    plannedStart: rnFmtDate_(o['Planned Start']), plannedEnd: rnFmtDate_(o['Planned End']),
    daysToStart: start ? sbDaysBetween_(todayYmd_(), start) : null,
    billingMode: String(o['Billing Mode'] || ''), toilets: rnNum_(o['Toilets Requested']),
    requirement: String(o['Requirement'] || ''), remindOn: rnFmtDate_(o['Remind On']),
    loggedAt: rnFmtTime_(o['Logged At']), verifiedAt: rnFmtTime_(o['Verified At']),
    sentBackNote: String(o['Sent Back Note'] || ''),
    need: sum.need, by: sum.by, needTotal: sum.needTotal, haveTotal: sum.haveTotal
  };
}

/** The full order for the detail panel. */
function getRentalOrder_(query) {
  var id = String((query && query.rentalId) || query || '').trim().toUpperCase();
  var ctx = rnLoad_();
  var o = rnOrder_(ctx, id);
  var sum = rnItemSummary_(ctx, id);
  var card = rnCard_(ctx, o, sum);
  var s = getRentalSettings_();
  var me = rnMe_();
  var money = rnMoney_(ctx, o);
  var cost = rnCost_(ctx, id);
  var showMoney = me.role !== 'Ops' && me.role !== 'Gate';
  var detail = {
    card: card,
    order: {
      customerPhone: String(o['Customer Phone'] || ''), customerEmail: String(o['Customer Email'] || ''),
      gstin: String(o['Customer GSTIN'] || ''), billingAddress: String(o['Billing Address'] || ''),
      siteAddress: String(o['Site Address'] || ''), sitePincode: String(o['Site Pincode'] || ''),
      siteDistrict: String(o['Site District'] || ''), siteState: String(o['Site State'] || ''),
      siteContact: String(o['Site Contact'] || ''), siteContactPhone: String(o['Site Contact Phone'] || ''),
      plannedStartYmd: rnYmd_(o['Planned Start']), plannedEndYmd: rnYmd_(o['Planned End']),
      remarks: String(o['Remarks'] || ''), agreementUrl: String(o['Agreement URL'] || ''),
      verifiedBy: String(o['Verified By'] || ''), acknowledgedBy: String(o['Acknowledged By'] || ''),
      acknowledgedAt: rnFmtTime_(o['Acknowledged At']), deferredBy: String(o['Deferred By'] || ''),
      configuredBy: String(o['Configured By'] || ''), closedBy: String(o['Closed By'] || ''),
      closedAt: rnFmtTime_(o['Closed At']), settlementNote: String(o['Settlement Note'] || ''),
      history: String(o['History'] || '').split('\n').filter(Boolean).reverse()
    },
    items: rnOf_(ctx.items, id).map(function (it) {
      return { itemId: String(it['Item ID']), category: String(it['Category']), type: String(it['Type']), status: String(it['Status']),
        tripId: String(it['Trip ID'] || ''), deploymentId: String(it['Deployment ID'] || '') };
    }).sort(function (a, b) { return a.itemId < b.itemId ? -1 : 1; }),
    trips: rnOf_(ctx.trips, id).map(rnTripView_),
    deployments: rnOf_(ctx.deployments, id).map(function (d) {
      return { deploymentId: String(d['Deployment ID']), items: rnSplit_(d['Items']), installedOn: rnFmtDate_(d['Installed On']),
        plannedEnd: rnFmtDate_(d['Planned End']), plannedEndYmd: rnYmd_(d['Planned End']), photoUrl: String(d['Photo URL'] || ''),
        markedBy: String(d['Marked By'] || ''), note: String(d['Note'] || '') };
    }),
    offhires: rnOf_(ctx.offhires, id).map(function (r) {
      return { offhireId: String(r['Off-hire ID']), items: rnSplit_(r['Items']), offhireOn: rnFmtDate_(r['Off-hire On']),
        recordedBy: String(r['Recorded By'] || ''), suctionOn: rnFmtDate_(r['Suction Done On']),
        suctionVendor: String(r['Suction Vendor'] || ''), note: String(r['Note'] || '') };
    }),
    jobs: showMoney ? rnOf_(ctx.jobs, id).map(function (j) {
      return { jobId: String(j['Job ID']), kind: String(j['Kind']), vendor: String(j['Vendor'] || ''), date: rnFmtDate_(j['Date']),
        cost: String(j['Cost']) === '' ? '' : rnNum_(j['Cost']), ref: String(j['Ref'] || ''), note: String(j['Note'] || '') };
    }) : [],
    payments: showMoney ? rnOf_(ctx.payments, id).map(function (l) { return rnLineView_(ctx, o, l, sum); }) : [],
    money: showMoney ? money : null,
    cost: showMoney ? cost : null,
    settings: { depositOn: s.depositOn, deferDays: s.deferDays },
    can: rnCan_(o, card, me),
    damages: rnDamages_(ctx, o),
    me: { code: me.code, role: me.role },
    cres: me.role === 'Admin' ? rnCreList_() : []
  };
  // Off-hires the signed-in CRE may still undo (their own, recorded today).
  detail.offhires.forEach(function (r) {
    var row = rnFind_(ctx.offhires, r.offhireId);
    r.recordedToday = !!row && rnYmd_(row['Recorded At']) === todayYmd_();
    r.mine = !!row && String(row['Recorded By']).indexOf('(' + me.code + ')') !== -1;
    r.itemsWaiting = r.items.filter(function (x) { var it = rnFind_(ctx.items, x); return it && it['Status'] === RI_OFFHIRED; }).length;
  });
  detail.deployments.forEach(function (d) {
    d.allOnHire = d.items.every(function (x) { var it = rnFind_(ctx.items, x); return it && it['Status'] === RI_DEPLOYED; });
  });
  return detail;
}

function rnCreList_() {
  var m = getStaffMap_(false);
  return Object.keys(m).map(function (k) { return m[k]; }).filter(function (x) { return x.active && x.role === 'CRE'; })
    .map(function (x) { return { code: x.code, name: x.name }; });
}

/** What the signed-in person may do with this order (the page shows only these buttons). */
function rnCan_(o, card, me) {
  var role = me.role, coord = rnIsCoordinator_(me), st = String(o['Status']);
  var mine = rnCreMayAct_(o, me);
  var open = st === 'Acknowledged';
  return {
    edit: st === 'Logged' && ((role === 'CRE' && mine) || role === 'Admin'),
    verify: st === 'Logged' && !o['Sent Back Note'] && (role === 'Accounts' || role === 'Admin'),
    acknowledge: st === 'Verified' && coord,
    configure: (st === 'Verified' || open) && coord,
    // Only while something is left to tag, allocate or load.
    prepare: open && card.need.length > 0 && (card.haveTotal < card.needTotal || card.by[RI_ALLOCATED] > 0 || card.by[RI_LOADED] > 0) && (role === 'Ops' || role === 'Admin'),
    install: open && coord,
    offhire: open && ((role === 'CRE') || coord),
    extend: open && ((role === 'CRE') || coord),
    suction: open && coord,
    pickup: open && (coord || role === 'Ops'),
    vendorJob: (open || st === 'Verified') && coord,
    payments: st !== 'Cancelled' && (role === 'Accounts' || role === 'Admin' || role === 'Director'),
    customerPaid: st !== 'Cancelled' && st !== 'Closed' && (role === 'CRE' || role === 'Admin'),
    waive: st !== 'Cancelled' && (role === 'Admin' || role === 'Director'),
    close: open && (role === 'Accounts' || role === 'Admin'),
    cancel: (st === 'Logged' || st === 'Verified' || open) && (role === 'Admin' || role === 'Director'),
    // Round 2
    standby: (st === 'Verified' || open) && (coord || (role === 'CRE' && mine) || role === 'Ops'),
    decideStandby: coord && String(o['Standby Status']) === 'Requested',
    correct: open && coord,
    undoOffhire: open && (coord || (role === 'CRE' && mine)),
    cancelPickup: open && (coord || role === 'Ops'),
    reassign: role === 'Admin' && st !== 'Closed' && st !== 'Cancelled',
    billDamage: role === 'Accounts' || role === 'Admin' || role === 'Director'
  };
}

// ================================================================
// Intake -- CRE, once the advance is paid
// ================================================================
/** Reads and checks the intake form. Throws a message the CRE can act on. */
function rnCleanIntake_(f, s, opts) {
  f = f || {};
  opts = opts || {};
  var t = function (k) { return String(f[k] == null ? '' : f[k]).trim(); };
  var errors = [];
  var out = {
    customer: t('customer'), customerPhone: t('customerPhone').replace(/[^\d+]/g, ''), customerEmail: t('customerEmail'),
    gstin: t('gstin').toUpperCase(), billingAddress: t('billingAddress'), siteAddress: t('siteAddress'),
    siteDistrict: t('siteDistrict'), siteState: t('siteState'), sitePincode: t('sitePincode').replace(/\D/g, ''),
    siteContact: t('siteContact'), siteContactPhone: t('siteContactPhone').replace(/[^\d+]/g, ''),
    toilets: rnNum_(f.toilets), requirement: t('requirement'), billingMode: t('billingMode'),
    rate: rnNum_(f.rate), orderValue: rnNum_(f.orderValue), overrunRate: rnNum_(f.overrunRate),
    plannedStart: t('plannedStart'), plannedEnd: t('plannedEnd'),
    advanceAmount: rnNum_(f.advanceAmount), advanceUtr: t('advanceUtr'),
    depositAmount: rnNum_(f.depositAmount), depositUtr: t('depositUtr'), remarks: t('remarks'),
    autoBill: t('autoBill'),
    schedule: []
  };
  if (RENTAL_AUTO_BILL.indexOf(out.autoBill) === -1) out.autoBill = '';
  if (out.billingMode === 'Per event') out.autoBill = '';
  if (!out.customer) errors.push('customer name');
  if (out.customerPhone.replace(/\D/g, '').length < 10) errors.push('customer phone (10 digits)');
  if (out.customerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.customerEmail)) errors.push('a valid customer email (or leave it blank)');
  if (!out.siteAddress) errors.push('site address');
  if (!out.siteContact || out.siteContactPhone.replace(/\D/g, '').length < 10) errors.push('site contact name and phone');
  if (out.toilets < 1 || Math.floor(out.toilets) !== out.toilets) errors.push('number of toilets requested');
  if (RENTAL_MODES.indexOf(out.billingMode) === -1) errors.push('billing mode');
  if (out.billingMode !== 'Per event' && out.rate <= 0) errors.push('rate per toilet ' + out.billingMode.replace('Per ', 'per '));
  if (out.orderValue <= 0) errors.push('agreed order value');
  if (!sbIsYmd_(out.plannedStart)) errors.push('installation date needed');
  if (!sbIsYmd_(out.plannedEnd)) errors.push('planned end date');
  if (sbIsYmd_(out.plannedStart) && sbIsYmd_(out.plannedEnd) && out.plannedEnd < out.plannedStart) errors.push('a planned end on or after the installation date');
  if (opts.imported) {
    // Already on site at go-live: the advance may be long settled -- optional, but a UTR with any amount.
    if (out.advanceAmount < 0) errors.push('a valid advance');
    if (out.advanceAmount > 0 && !out.advanceUtr) errors.push('the advance UTR');
  } else {
    if (out.advanceAmount <= 0) errors.push('advance received (a rental is logged only once the advance is paid)');
    if (!out.advanceUtr) errors.push('advance UTR / bank reference');
  }
  if (out.advanceAmount > out.orderValue + BALANCE_DUE_TOLERANCE) errors.push('an advance no larger than the order value');
  if (s.depositOn) {
    if (out.depositAmount < 0) errors.push('deposit amount');
    if (out.depositAmount > 0 && !out.depositUtr) errors.push('deposit UTR');
  } else {
    out.depositAmount = 0; out.depositUtr = '';
  }
  (f.schedule || []).forEach(function (l, i) {
    var amt = rnNum_(l && l.amount);
    var date = String((l && l.dueDate) || '').trim(), trig = String((l && l.trigger) || '').trim();
    if (!amt && !date && !trig) return;
    if (amt <= 0) errors.push('an amount for instalment ' + (i + 1));
    if (date && !sbIsYmd_(date)) errors.push('a valid date for instalment ' + (i + 1));
    if (!date && RENTAL_TRIGGERS.indexOf(trig) < 1) errors.push('a due date or a trigger for instalment ' + (i + 1));
    if (RENTAL_TRIGGERS.indexOf(trig) === -1) errors.push('a known trigger for instalment ' + (i + 1));
    out.schedule.push({ amount: amt, dueDate: date, trigger: date ? '' : trig, note: String((l && l.note) || '').trim() });
  });
  if (errors.length) throw new Error('Please enter: ' + errors.join('; ') + '.');
  return out;
}

function rnOrderFields_(c) {
  return {
    'Customer': c.customer, 'Customer Phone': c.customerPhone, 'Customer Email': c.customerEmail, 'Customer GSTIN': c.gstin,
    'Billing Address': c.billingAddress, 'Site Address': c.siteAddress, 'Site District': c.siteDistrict, 'Site State': c.siteState,
    'Site Pincode': c.sitePincode, 'Site Contact': c.siteContact, 'Site Contact Phone': c.siteContactPhone,
    'Toilets Requested': c.toilets, 'Requirement': c.requirement, 'Billing Mode': c.billingMode, 'Rate': c.rate || '',
    'Order Value': c.orderValue, 'Overrun Rate': c.overrunRate || '', 'Planned Start': sbYmdToDate_(c.plannedStart),
    'Planned End': sbYmdToDate_(c.plannedEnd), 'Advance Amount': c.advanceAmount, 'Advance UTR': c.advanceUtr,
    'Deposit Amount': c.depositAmount || '', 'Deposit UTR': c.depositUtr, 'Remarks': c.remarks, 'Auto Bill': c.autoBill
  };
}

/** Writes the advance / deposit / instalment lines for a new or edited (still unverified) order. */
function rnWriteIntakeLines_(ctx, rentalId, c, me) {
  var pay = ctx.payments;
  var add = function (kind, amount, due, trig, status, received, utr, note) {
    rnAppend_(pay, {
      'Line ID': rnNextId_(pay, 'RPL'), 'Rental ID': rentalId, 'Kind': kind, 'Amount Due': amount,
      'Due Date': due ? sbYmdToDate_(due) : '', 'Due Trigger': trig || '', 'Status': status,
      'Amount Received': received || '', 'UTR': utr || '', 'Customer Says Paid At': received ? new Date() : '',
      'Recorded By': rnWho_(me), 'Note': note || ''
    });
  };
  add('Advance', c.advanceAmount, '', '', 'Paid – to verify', c.advanceAmount, c.advanceUtr, 'Advance at intake');
  if (c.depositAmount > 0) add('Deposit', c.depositAmount, '', '', 'Paid – to verify', c.depositAmount, c.depositUtr, 'Deposit at intake');
  c.schedule.forEach(function (l) { add('Instalment', l.amount, l.dueDate, l.trigger, 'Due', 0, '', l.note); });
}

/** Saves an uploaded agreement / customer PO (optional). Returns its URL or ''. */
function rnSaveUpload_(file, rentalId, label) {
  if (!file || !file.data) return '';
  var d = docsDecode_(file);
  var f = getOrCreateFolder(RENTAL_DOCS_FOLDER_NAME).createFile(Utilities.newBlob(d.bytes, d.mime, sanitizeForFilename(rentalId) + ' - ' + label + d.ext));
  f.setDescription('ICF rental ' + rentalId + ' – ' + label + ', uploaded ' + opsFmt_(new Date()));
  docsShare_(f);
  return f.getUrl();
}

/** CRE: a new rental. form = intake fields + schedule [{amount, dueDate, trigger, note}] + agreement {data, mimeType}. */
function submitRental_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var s = getRentalSettings_();
  var c = rnCleanIntake_(form, s);
  var lock = rnLock_();
  var o, id;
  try {
    var ctx = rnLoad_();
    // The same customer + UTR twice within an hour is almost certainly a double click.
    var dup = ctx.orders.rows.filter(function (r) {
      return String(r['Advance UTR']).trim().toLowerCase() === c.advanceUtr.toLowerCase() && String(r['Status']) !== 'Cancelled';
    })[0];
    if (dup) throw new Error('A rental with advance UTR ' + c.advanceUtr + ' already exists (' + dup['Rental ID'] + ' – ' + dup['Customer'] + '). Look it up instead of logging it again.');
    id = rnNextId_(ctx.orders, 'RNT');
    var fields = rnOrderFields_(c);
    fields['Rental ID'] = id;
    fields['Logged At'] = new Date();
    fields['CRE Code'] = me.code;
    fields['CRE Name'] = me.name;
    fields['Status'] = 'Logged';
    fields['History'] = rnStamp_() + ' ' + me.name + ': Logged – advance ' + rnRupees_(c.advanceAmount) + ', UTR ' + c.advanceUtr;
    o = rnAppend_(ctx.orders, fields);
    rnWriteIntakeLines_(ctx, id, c, me);
  } finally {
    lock.releaseLock();
  }
  var url = '';
  try { url = rnSaveUpload_(form && form.agreement, id, 'Agreement'); } catch (e) { Logger.log('agreement upload failed: ' + e); url = ''; }
  if (url) { var t = rnTable_('orders'); rnSet_(t, rnFind_(t, id), { 'Agreement URL': url }); }
  return { trackerId: id, rentalId: id, customer: c.customer, agreementSaved: !!url };
}

/** CRE (own order, still unverified) or Admin: correct the intake. Clears a send-back. */
function updateRental_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var s = getRentalSettings_();
  var c = rnCleanIntake_(form, s);
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var lock = rnLock_();
  try {
    var ctx = rnLoad_();
    var o = rnOrder_(ctx, id);
    if (o['Status'] !== 'Logged') throw new Error('Accounts has already verified this rental, so it can’t be edited. Ask the admin.');
    rnAssertCre_(o, me);
    var f = rnOrderFields_(c);
    f['Sent Back Note'] = '';
    rnSet_(ctx.orders, o, f);
    // Replace the unverified intake lines with the corrected ones.
    var old = rnOf_(ctx.payments, id).filter(function (l) { return l['Status'] !== 'Verified'; }).sort(function (a, b) { return b._row - a._row; });
    old.forEach(function (l) { ctx.payments.sheet.deleteRow(l._row); });
    ctx.payments = rnTable_('payments');
    rnWriteIntakeLines_(ctx, id, c, me);
    rnHistory_(ctx.orders, o, 'Edited the intake' + (form.changeNote ? ' – ' + String(form.changeNote).slice(0, 200) : ''), me);
  } finally {
    lock.releaseLock();
  }
  if (form && form.agreement && form.agreement.data) {
    var url = rnSaveUpload_(form.agreement, id, 'Agreement');
    var t = rnTable_('orders'); rnSet_(t, rnFind_(t, id), { 'Agreement URL': url });
  }
  return { trackerId: id, rentalId: id };
}

// ================================================================
// Accounts -- verify the advance, or send it back
// ================================================================
/** form = { rentalId, checked } -- Accounts has matched the advance (and deposit) in the bank. */
function verifyRental_(form) {
  rnAssertLive_();
  var me = rnMe_();
  if (!form || !form.checked) throw new Error('Tick the box to confirm the advance is in the bank against this UTR.');
  var id = String(form.rentalId || '').trim().toUpperCase();
  var s = getRentalSettings_();
  var lock = rnLock_(), o, far = false;
  try {
    var ctx = rnLoad_();
    o = rnOrder_(ctx, id);
    if (o['Status'] !== 'Logged') throw new Error('This rental isn’t waiting for verification (status: ' + o['Status'] + ').');
    if (o['Sent Back Note']) throw new Error('This rental was sent back to the CRE and hasn’t been corrected yet.');
    rnOf_(ctx.payments, id).forEach(function (l) {
      if ((l['Kind'] === 'Advance' || l['Kind'] === 'Deposit') && l['Status'] === 'Paid – to verify') {
        rnSet_(ctx.payments, l, { 'Status': 'Verified', 'Verified By': rnWho_(me), 'Verified At': new Date() });
      }
    });
    rnSet_(ctx.orders, o, { 'Status': 'Verified', 'Verified By': rnWho_(me), 'Verified At': new Date() });
    rnHistory_(ctx.orders, o, 'Verified the advance' + (rnNum_(o['Deposit Amount']) ? ' and deposit' : ''), me);
    var start = rnYmd_(o['Planned Start']);
    far = !!start && sbDaysBetween_(todayYmd_(), start) >= s.deferDays;
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, farAhead: far };
}

/** form = { rentalId, reason } -- something doesn't match; back to the CRE to correct. */
function sendBackRental_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var reason = String((form && form.reason) || '').trim();
  if (reason.length < 5) throw new Error('Say what doesn’t match, so the CRE can fix it.');
  var lock = rnLock_(), o;
  try {
    var ctx = rnLoad_();
    o = rnOrder_(ctx, id);
    if (o['Status'] !== 'Logged') throw new Error('Only an unverified rental can be sent back.');
    rnSet_(ctx.orders, o, { 'Sent Back Note': reason + ' – ' + me.name + ', ' + rnStamp_() });
    rnHistory_(ctx.orders, o, 'Sent back to the CRE: ' + reason, me);
  } finally {
    lock.releaseLock();
  }
  try {
    var staffMap = getStaffMap_(false);
    var cre = staffMap[String(o['CRE Code']).toUpperCase()];
    if (cre) notify_('RENTAL_SENT_BACK', id, [staffRecipient_(cre)], {
      subject: 'Rental ' + id + ' sent back – ' + o['Customer'], email: true,
      text: 'Accounts sent rental ' + id + ' back: ' + reason,
      html: '<p>Accounts sent rental <b>' + rnEsc_(id) + '</b> (' + rnEsc_(o['Customer']) + ') back to you:</p><p><i>' + rnEsc_(reason) + '</i></p><p>Correct it on the Rentals page and save – it goes back to Accounts.</p>',
      link: appUrl_() ? appUrl_() + '?page=rental' : '', linkLabel: 'Open Rentals'
    });
  } catch (e) { Logger.log('send-back notice failed: ' + e); }
  return { trackerId: id, rentalId: id };
}

// ================================================================
// Ananthu -- acknowledge, or set a reminder date for far-off orders
// ================================================================
function acknowledgeRental_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var lock = rnLock_();
  try {
    var ctx = rnLoad_();
    var o = rnOrder_(ctx, id);
    if (o['Status'] !== 'Verified') throw new Error('This rental isn’t waiting for acknowledgement (status: ' + o['Status'] + ').');
    rnSet_(ctx.orders, o, { 'Status': 'Acknowledged', 'Acknowledged By': rnWho_(me), 'Acknowledged At': new Date(), 'Remind On': '' });
    rnHistory_(ctx.orders, o, 'Acknowledged', me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id };
}

/** form = { rentalId, remindOn: 'yyyy-MM-dd', note } -- park it until then. No nudges meanwhile. */
function deferRental_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var ymd = rnValidYmd_(form && form.remindOn, 'the date to be reminded');
  var today = todayYmd_();
  if (ymd <= today) throw new Error('Pick a date after today – or acknowledge it now.');
  var lock = rnLock_(), o;
  try {
    var ctx = rnLoad_();
    o = rnOrder_(ctx, id);
    if (o['Status'] !== 'Verified') throw new Error('Only a verified rental that isn’t acknowledged yet can be scheduled.');
    var start = rnYmd_(o['Planned Start']);
    if (start && ymd >= start) throw new Error('The reminder has to come before the installation date (' + fmtYmd_(start) + ').');
    var cell = String(o['Alerts Sent'] || '').split('|').map(function (x) { return x.trim(); })
      .filter(function (x) { return x && !/^(Ack|New|Back)/.test(x.split(' ')[0]); }).join(' | ');
    rnSet_(ctx.orders, o, { 'Remind On': sbYmdToDate_(ymd), 'Deferred By': rnWho_(me), 'Alerts Sent': cell });
    rnHistory_(ctx.orders, o, 'Scheduled – remind on ' + fmtYmd_(ymd) + (form.note ? ' (' + String(form.note).slice(0, 200) + ')' : ''), me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, remindOn: fmtYmd_(ymd) };
}

/** form = { rentalId, lines: [{category, type, quantity}] } -- Ananthu's configuration. Replaces the previous one. */
function setRentalConfig_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var lines = [];
  (form && form.lines || []).forEach(function (l) {
    var q = rnNum_(l && l.quantity);
    var cat = String((l && l.category) || '').trim(), type = String((l && l.type) || '').trim() || cat;
    if (!cat && !q) return;
    if (!rnPrefixOf_(cat)) throw new Error('Unknown item category: ' + cat);
    if (q < 1 || Math.floor(q) !== q) throw new Error('Enter a whole number for ' + type + '.');
    var same = lines.filter(function (x) { return x.category === cat && x.type === type; })[0];
    if (same) same.quantity += q; else lines.push({ category: cat, type: type, quantity: q });
  });
  if (!lines.length) throw new Error('Add at least one line – e.g. Toilet 20, Septic tank 5.');
  var lock = rnLock_(), shortages = [], o;
  try {
    var ctx = rnLoad_();
    o = rnOrder_(ctx, id);
    if (o['Status'] !== 'Verified' && o['Status'] !== 'Acknowledged') throw new Error('This rental can’t be configured now (status: ' + o['Status'] + ').');
    // Items already allocated or sent must still fit the new configuration.
    var errs = [];
    var counted = rnCoverage_(ctx, id);
    Object.keys(counted).forEach(function (k) {
      var p = k.split('|');
      var l = lines.filter(function (x) { return x.category === p[0] && x.type === p[1]; })[0];
      if (!l || l.quantity < counted[k]) errs.push(counted[k] + ' × ' + p[1] + ' already allocated or sent');
    });
    if (errs.length) throw new Error('The new configuration is smaller than what is already allocated: ' + errs.join('; ') + '. Release those items first (Ops), or keep the quantity.');
    rnOf_(ctx.config, id).sort(function (a, b) { return b._row - a._row; }).forEach(function (r) { ctx.config.sheet.deleteRow(r._row); });
    ctx.config = rnTable_('config');
    var now = new Date();
    lines.forEach(function (l) {
      rnAppend_(ctx.config, { 'Rental ID': id, 'Category': l.category, 'Type': l.type, 'Quantity': l.quantity, 'Updated By': rnWho_(me), 'Updated At': now });
    });
    var first = !o['Configured At'];
    rnSet_(ctx.orders, o, { 'Configured By': rnWho_(me), 'Configured At': now });
    rnHistory_(ctx.orders, o, (first ? 'Configured: ' : 'Changed configuration: ') + lines.map(function (l) { return l.quantity + ' × ' + l.type; }).join(', '), me);
    shortages = rnShortages_(ctx, id);
  } finally {
    lock.releaseLock();
  }
  if (shortages.length) {
    try { rnNotifyShortage_(o, shortages, me); } catch (e) { Logger.log('shortage notice failed: ' + e); }
  }
  return { trackerId: id, rentalId: id, shortages: shortages };
}

/** Per configuration line: still needed vs what the yard can supply (tagged Available + untagged count). */
function rnShortages_(ctx, rentalId) {
  var sum = rnItemSummary_(ctx, rentalId);
  var out = [];
  sum.need.forEach(function (n) {
    var still = n.quantity - n.have;
    if (still <= 0) return;
    var avail = ctx.items.rows.filter(function (it) { return it['Status'] === RI_AVAILABLE && it['Category'] === n.category && it['Type'] === n.type; }).length;
    var t = ctx.types.rows.filter(function (r) { return r['Category'] === n.category && r['Type'] === n.type; })[0];
    var untagged = t ? rnNum_(t['Untagged In Yard']) : 0;
    if (still > avail + untagged) out.push({ category: n.category, type: n.type, needed: still, available: avail + untagged, short: still - avail - untagged });
  });
  return out;
}

function rnNotifyShortage_(o, shortages, me) {
  var cfg = getAlertSettings_();
  var staffMap = getStaffMap_(false);
  var to = rnPeopleFor_('escalate', staffMap, cfg);
  var text = shortages.map(function (x) { return x.type + ': need ' + x.needed + ', yard has ' + x.available + ' – short by ' + x.short; }).join('; ');
  notify_('RENTAL_SHORTAGE', o['Rental ID'], to, {
    subject: 'Production needed: rental ' + o['Rental ID'] + ' is short of items', email: true,
    text: 'Rental ' + o['Rental ID'] + ' (' + o['Customer'] + ', needed ' + rnFmtDate_(o['Planned Start']) + '): ' + text,
    html: '<p>Rental <b>' + rnEsc_(o['Rental ID']) + '</b> – ' + rnEsc_(o['Customer']) + ', needed on <b>' + rnEsc_(rnFmtDate_(o['Planned Start'])) + '</b> – needs more items than the yard has (counting tagged items free in the yard plus the untagged count in the Rental Item Types tab):</p><ul>' +
      shortages.map(function (x) { return '<li>' + rnEsc_(x.type) + ': need ' + x.needed + ', available ' + x.available + ' – <b>short by ' + x.short + '</b></li>'; }).join('') + '</ul><p>Configured by ' + rnEsc_(me.name) + '.</p>',
    link: appUrl_() ? appUrl_() + '?page=rental' : '', linkLabel: 'Open Rentals'
  });
}

// ================================================================
// Payments
// ================================================================
/** CRE: the customer says they paid a line. form = { rentalId, lineId, amount, utr, note } */
function rentalCustomerPaid_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var amt = rnNum_(form && form.amount), utr = String((form && form.utr) || '').trim();
  if (amt <= 0) throw new Error('Enter the amount the customer paid.');
  if (!utr) throw new Error('Enter the UTR / bank reference so Accounts can find it.');
  var lock = rnLock_(), id;
  try {
    var ctx = rnLoad_();
    var l = rnFind_(ctx.payments, form.lineId);
    if (!l) throw new Error('Payment line not found.');
    id = String(l['Rental ID']);
    var o = rnOrder_(ctx, id);
    rnAssertCre_(o, me);
    if (l['Status'] !== 'Due') throw new Error('This line is “' + l['Status'] + '” – nothing to mark.');
    rnSet_(ctx.payments, l, { 'Status': 'Paid – to verify', 'Amount Received': amt, 'UTR': utr, 'Customer Says Paid At': new Date(),
      'Recorded By': rnWho_(me), 'Note': [String(l['Note'] || ''), String(form.note || '').trim()].filter(Boolean).join(' – ') });
    rnHistory_(ctx.orders, o, 'Customer says paid ' + rnRupees_(amt) + ' (' + l['Kind'] + '), UTR ' + utr, me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id };
}

/** Accounts: confirm a payment the CRE reported. form = { lineId, amount (optional correction) } */
function verifyRentalPayment_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var lock = rnLock_(), id, amt;
  try {
    var ctx = rnLoad_();
    var l = rnFind_(ctx.payments, form && form.lineId);
    if (!l) throw new Error('Payment line not found.');
    id = String(l['Rental ID']);
    var o = rnOrder_(ctx, id);
    if (l['Status'] !== 'Paid – to verify') throw new Error('Nothing to verify on this line (status: ' + l['Status'] + ').');
    if (o['Status'] === 'Logged') throw new Error('Verify the rental itself first – that verifies the advance.');
    amt = rnNum_(form.amount) || rnNum_(l['Amount Received']);
    if (amt <= 0) throw new Error('Enter the amount received.');
    rnSet_(ctx.payments, l, { 'Status': 'Verified', 'Amount Received': amt, 'Verified By': rnWho_(me), 'Verified At': new Date() });
    rnHistory_(ctx.orders, o, 'Verified ' + rnRupees_(amt) + ' (' + l['Kind'] + '), UTR ' + l['UTR'], me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, amount: amt };
}

/** Accounts: money is in the bank -- record it straight away. form = { rentalId, lineId?, amount, utr, kind?, note } */
function recordRentalPayment_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var amt = rnNum_(form && form.amount), utr = String((form && form.utr) || '').trim();
  if (amt <= 0 || !utr) throw new Error('Enter the amount and the UTR.');
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var lock = rnLock_();
  try {
    var ctx = rnLoad_();
    var o = rnOrder_(ctx, id);
    if (o['Status'] === 'Logged' || o['Status'] === 'Cancelled') throw new Error('Verify the rental first.');
    var l = form.lineId ? rnFind_(ctx.payments, form.lineId) : null;
    if (form.lineId && (!l || String(l['Rental ID']).toUpperCase() !== id)) throw new Error('Payment line not found on this rental.');
    var fields = { 'Status': 'Verified', 'Amount Received': amt, 'UTR': utr, 'Verified By': rnWho_(me), 'Verified At': new Date(), 'Recorded By': rnWho_(me) };
    if (l) {
      if (l['Status'] === 'Verified' || l['Status'] === 'Waived') throw new Error('That line is already ' + l['Status'].toLowerCase() + '.');
      rnSet_(ctx.payments, l, fields);
    } else {
      fields['Line ID'] = rnNextId_(ctx.payments, 'RPL');
      fields['Rental ID'] = id;
      fields['Kind'] = 'Instalment';
      fields['Amount Due'] = amt;
      fields['Note'] = String(form.note || 'Received without a schedule line').trim();
      rnAppend_(ctx.payments, fields);
    }
    rnHistory_(ctx.orders, o, 'Recorded payment ' + rnRupees_(amt) + ', UTR ' + utr, me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, amount: amt };
}

/** Accounts / Admin / Director: add something to bill. form = { rentalId, kind, amount, dueDate, note } */
function addRentalCharge_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var kind = String((form && form.kind) || '').trim();
  var amt = rnNum_(form && form.amount);
  var due = String((form && form.dueDate) || '').trim();
  var note = String((form && form.note) || '').trim();
  if (RENTAL_CHARGE_KINDS.indexOf(kind) === -1) throw new Error('Choose what the charge is for.');
  if (amt <= 0) throw new Error('Enter the amount.');
  if (due && !sbIsYmd_(due)) throw new Error('Enter a valid due date.');
  if (kind !== 'Instalment' && note.length < 3) throw new Error('Add a short note – e.g. “4 days over, 12 toilets”.');
  var lock = rnLock_();
  try {
    var ctx = rnLoad_();
    var o = rnOrder_(ctx, id);
    if (o['Status'] === 'Cancelled' || o['Status'] === 'Closed' || o['Status'] === 'Logged') throw new Error('Charges can be added only to a verified, open rental.');
    rnAppend_(ctx.payments, {
      'Line ID': rnNextId_(ctx.payments, 'RPL'), 'Rental ID': id, 'Kind': kind, 'Amount Due': amt,
      'Due Date': due ? sbYmdToDate_(due) : '', 'Due Trigger': '', 'Status': 'Due', 'Recorded By': rnWho_(me), 'Note': note
    });
    rnHistory_(ctx.orders, o, 'Added ' + kind.toLowerCase() + ' ' + rnRupees_(amt) + (due ? ' due ' + fmtYmd_(due) : '') + (note ? ' – ' + note : ''), me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id };
}

/** Admin / Director: drop a line (e.g. a charge agreed away). form = { lineId, reason } */
function waiveRentalLine_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var reason = String((form && form.reason) || '').trim();
  if (reason.length < 3) throw new Error('Give the reason.');
  var lock = rnLock_(), id;
  try {
    var ctx = rnLoad_();
    var l = rnFind_(ctx.payments, form && form.lineId);
    if (!l) throw new Error('Payment line not found.');
    if (l['Status'] === 'Verified') throw new Error('Money already received can’t be waived.');
    if (l['Kind'] === 'Advance') throw new Error('The advance can’t be waived – cancel the rental instead.');
    id = String(l['Rental ID']);
    rnSet_(ctx.payments, l, { 'Status': 'Waived', 'Note': [String(l['Note'] || ''), 'Waived by ' + me.name + ': ' + reason].filter(Boolean).join(' – ') });
    rnHistory_(ctx.orders, rnOrder_(ctx, id), 'Waived ' + l['Kind'].toLowerCase() + ' ' + rnRupees_(l['Amount Due']) + ': ' + reason, me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id };
}

// ================================================================
// Extension, settlement, cancellation
// ================================================================
/** CRE / Ananthu: new planned end. form = { rentalId, deploymentId? (blank = the order and every open deployment), plannedEnd, note } */
function extendRental_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var ymd = rnValidYmd_(form && form.plannedEnd, 'the new planned end');
  var lock = rnLock_(), changed = [];
  try {
    var ctx = rnLoad_();
    var o = rnOrder_(ctx, id);
    if (o['Status'] !== 'Acknowledged' && o['Status'] !== 'Verified') throw new Error('Only an open rental can be extended.');
    rnAssertCre_(o, me);
    var depId = String(form.deploymentId || '').trim().toUpperCase();
    var deps = rnOf_(ctx.deployments, id).filter(function (d) { return !depId || String(d['Deployment ID']).toUpperCase() === depId; });
    if (depId && !deps.length) throw new Error('Deployment ' + depId + ' not found.');
    deps.forEach(function (d) {
      if (ymd < rnYmd_(d['Installed On'])) throw new Error('The new end is before ' + d['Deployment ID'] + ' was installed.');
      rnSet_(ctx.deployments, d, { 'Planned End': sbYmdToDate_(ymd) });
      changed.push(String(d['Deployment ID']));
    });
    if (!depId) {
      if (ymd < rnYmd_(o['Planned Start'])) throw new Error('The new end is before the installation date.');
      rnSet_(ctx.orders, o, { 'Planned End': sbYmdToDate_(ymd) });
    }
    // Fresh end-date reminders for what was moved.
    var cell = String(o['Alerts Sent'] || '').split('|').map(function (x) { return x.trim(); }).filter(function (x) {
      var tok = x.split(' ')[0];
      return x && !changed.some(function (d) { return tok === 'EndSoon-' + d || tok === 'Overrun-' + d || tok === 'OverrunEsc-' + d; });
    }).join(' | ');
    rnSet_(ctx.orders, o, { 'Alerts Sent': cell });
    rnHistory_(ctx.orders, o, 'Planned end moved to ' + fmtYmd_(ymd) + (depId ? ' for ' + depId : (changed.length ? ' (order and ' + changed.join(', ') + ')' : '')) +
      (form.note ? ' – ' + String(form.note).slice(0, 200) : ''), me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, plannedEnd: fmtYmd_(ymd), deployments: changed };
}

/** Accounts: everything is back and paid. form = { rentalId, note, override } (override = Admin only, closes with a balance). */
function closeRental_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var note = String((form && form.note) || '').trim();
  var lock = rnLock_(), money;
  try {
    var ctx = rnLoad_();
    var o = rnOrder_(ctx, id);
    if (o['Status'] !== 'Acknowledged') throw new Error('Only an open rental can be closed.');
    var sum = rnItemSummary_(ctx, id);
    if (sum.out) throw new Error(rnPlural_(sum.out, 'item') + ' still out (not back at the factory). Close once everything is back.');
    var waiting = rnOf_(ctx.payments, id).filter(function (l) { return l['Status'] === 'Paid – to verify'; });
    if (waiting.length) throw new Error('Verify the payment' + (waiting.length > 1 ? 's' : '') + ' the CRE reported first.');
    money = rnMoney_(ctx, o);
    if (money.overrunUnbilled > 0 && !form.override) throw new Error('Overrun of about ' + rnRupees_(money.overrunUnbilled) + ' isn’t billed yet. Add it as a charge, or have the admin waive it.');
    if (money.balance > BALANCE_DUE_TOLERANCE) {
      if (!(form.override && me.role === 'Admin')) throw new Error('Balance of ' + rnRupees_(money.balance) + ' is still due. Record the payment first' + (me.role === 'Admin' ? ', or tick “close with balance” and give the reason.' : ' – only the admin can close with a balance.'));
      if (note.length < 5) throw new Error('Give the reason for closing with a balance.');
    }
    // Items allocated but never sent go back to the yard.
    rnOf_(ctx.items, id).forEach(function (it) {
      if (it['Status'] === RI_ALLOCATED) {
        rnSet_(ctx.items, it, { 'Status': RI_AVAILABLE, 'Rental ID': '', 'Trip ID': '', 'Deployment ID': '' });
        rnItemHistory_(ctx.items, it, 'Released – ' + id + ' closed', me);
      }
    });
    rnSet_(ctx.orders, o, { 'Status': 'Closed', 'Closed By': rnWho_(me), 'Closed At': new Date(),
      'Settlement Note': (money.balance > BALANCE_DUE_TOLERANCE ? 'Closed with balance ' + rnRupees_(money.balance) + '. ' : '') +
        (money.deposit ? 'Deposit held ' + rnRupees_(money.deposit) + '. ' : '') + note });
    rnHistory_(ctx.orders, o, 'Closed' + (note ? ' – ' + note : ''), me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, balance: money.balance };
}

/** Admin / Director: cancel before anything has left the factory. form = { rentalId, reason } */
function cancelRental_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var reason = String((form && form.reason) || '').trim();
  if (reason.length < 5) throw new Error('Give the reason for cancelling.');
  var lock = rnLock_();
  try {
    var ctx = rnLoad_();
    var o = rnOrder_(ctx, id);
    if (o['Status'] === 'Closed' || o['Status'] === 'Cancelled') throw new Error('This rental is already ' + o['Status'].toLowerCase() + '.');
    var left = rnOf_(ctx.trips, id).filter(function (t) { return t['Direction'] === 'Out' && (t['Status'] === 'Left' || t['Status'] === 'Gate pass issued'); });
    if (left.length) throw new Error('Items have already been sent (or have a gate pass). Bring them back and close the rental instead.');
    rnOf_(ctx.trips, id).forEach(function (t) { if (t['Status'] === 'Gate pass requested') rnSet_(ctx.trips, t, { 'Status': 'Cancelled' }); });
    rnOf_(ctx.items, id).forEach(function (it) {
      if (it['Status'] === RI_ALLOCATED || it['Status'] === RI_LOADED) {
        rnSet_(ctx.items, it, { 'Status': RI_AVAILABLE, 'Rental ID': '', 'Trip ID': '', 'Deployment ID': '' });
        rnItemHistory_(ctx.items, it, 'Released – ' + id + ' cancelled', me);
      }
    });
    rnSet_(ctx.orders, o, { 'Status': 'Cancelled', 'Closed By': rnWho_(me), 'Closed At': new Date(), 'Settlement Note': 'Cancelled: ' + reason });
    rnHistory_(ctx.orders, o, 'Cancelled: ' + reason, me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id };
}

// ================================================================
// The Rentals page -- one call returns what this person works on
// ================================================================
function getRentalHome_() {
  var me = rnMe_();
  RN_COVER_MEMO_ = { code: me.code, map: coveredCodesFor_(me.code, getStaffMap_(false)) };
  try { return rnRentalHome_(me); } finally { RN_COVER_MEMO_ = null; }
}
function rnRentalHome_(me) {
  var live = rnIsLive_();
  var s = getRentalSettings_();
  var out = { live: live, role: me.role, me: { code: me.code, name: me.name }, coordinator: rnIsCoordinator_(me),
    settings: { depositOn: s.depositOn, deferDays: s.deferDays }, today: todayYmd_(),
    categories: RENTAL_CATEGORIES.map(function (c) { return c.name; }), modes: RENTAL_MODES, triggers: RENTAL_TRIGGERS.slice(1),
    chargeKinds: RENTAL_CHARGE_KINDS, jobKinds: RENTAL_JOB_KINDS, types: [], queues: {}, alerts: [],
    standbyReasons: RENTAL_STANDBY_REASONS, autoBill: RENTAL_AUTO_BILL.slice(1), loadPhotoRequired: RN_LOAD_PHOTO_REQUIRED,
    cres: (me.role === 'Admin' || me.role === 'Director') ? rnCreList_() : [] };
  if (!live) return out;
  var ctx = rnLoad_();
  out.types = ctx.types.rows.filter(function (r) { return String(r['Active'] || 'Y').toUpperCase() !== 'N'; })
    .map(function (r) { return { category: String(r['Category']), type: String(r['Type']), untagged: rnNum_(r['Untagged In Yard']) }; });
  var cards = {};
  var sums = {};
  ctx.orders.rows.forEach(function (o) {
    var id = String(o['Rental ID']);
    sums[id] = rnItemSummary_(ctx, id);
    cards[id] = rnCard_(ctx, o, sums[id]);
  });
  var q = out.queues, today = todayYmd_();
  var list = function (pred) { return ctx.orders.rows.filter(pred).map(function (o) { return cards[o['Rental ID']]; }); };
  var openOrder = function (o) { return ['Logged', 'Verified', 'Acknowledged'].indexOf(String(o['Status'])) !== -1; };
  var role = me.role;

  if (role === 'CRE' || role === 'Admin') {
    q.mine = list(function (o) { return openOrder(o) && (role === 'Admin' || rnCreMayAct_(o, me)); });
    q.sentBack = q.mine.filter(function (c) { return c.stageKey === 'sentback'; });
  }
  if (role === 'Accounts' || role === 'Admin') {
    q.toVerify = list(function (o) { return o['Status'] === 'Logged' && !o['Sent Back Note']; });
    q.gatePasses = ctx.trips.rows.filter(function (t) { return t['Direction'] === 'Out' && t['Status'] === 'Gate pass requested'; })
      .map(function (t) { var v = rnTripView_(t); v.customer = cards[t['Rental ID']] ? cards[t['Rental ID']].customer : ''; return v; });
    q.paymentsToVerify = [];
    ctx.payments.rows.forEach(function (l) {
      var o = rnFind_(ctx.orders, l['Rental ID']);
      if (!o || o['Status'] === 'Logged' || o['Status'] === 'Cancelled') return;
      if (l['Status'] !== 'Paid – to verify') return;
      var v = rnLineView_(ctx, o, l, sums[o['Rental ID']]);
      v.rentalId = String(o['Rental ID']); v.customer = String(o['Customer']);
      q.paymentsToVerify.push(v);
    });
    q.toSettle = list(function (o) { return o['Status'] === 'Acknowledged' && sums[o['Rental ID']].allBack; });
  }
  if (role === 'Ops' || role === 'Admin') {
    q.toPrepare = list(function (o) {
      if (o['Status'] !== 'Acknowledged') return false;
      var sm = sums[o['Rental ID']];
      return sm.need.length && sm.haveTotal < sm.needTotal || (sm.by[RI_ALLOCATED] > 0);
    }).sort(function (a, b) { return (a.daysToStart == null ? 999 : a.daysToStart) - (b.daysToStart == null ? 999 : b.daysToStart); });
    q.requested = ctx.trips.rows.filter(function (t) { return t['Direction'] === 'Out' && (t['Status'] === 'Gate pass requested' || t['Status'] === 'Gate pass issued'); })
      .map(function (t) { var v = rnTripView_(t); v.customer = cards[t['Rental ID']] ? cards[t['Rental ID']].customer : ''; return v; });
    q.toInspect = ctx.items.rows.filter(function (it) { return it['Status'] === RI_INSPECTION; }).map(rnItemView_);
    q.repair = ctx.items.rows.filter(function (it) { return it['Status'] === RI_REPAIR; }).map(rnItemView_);
    q.pickups = list(function (o) { return o['Status'] === 'Acknowledged' && sums[o['Rental ID']].by[RI_OFFHIRED] > 0; });
  }
  if (rnIsCoordinator_(me)) {
    q.toAck = list(function (o) { return o['Status'] === 'Verified' && !(rnYmd_(o['Remind On']) > today) && !rnStandbyActive_(o, today); });
    q.standby = list(function (o) { return (o['Status'] === 'Verified' || o['Status'] === 'Acknowledged') && (rnStandbyActive_(o, today) || String(o['Standby Status']) === 'Requested'); });
    q.scheduled = list(function (o) { return o['Status'] === 'Verified' && rnYmd_(o['Remind On']) > today; });
    q.toConfigure = list(function (o) { return o['Status'] === 'Acknowledged' && !sums[o['Rental ID']].need.length; });
    q.toInstall = list(function (o) { return o['Status'] === 'Acknowledged' && sums[o['Rental ID']].by[RI_TRANSIT] > 0; });
    q.onHire = list(function (o) { return o['Status'] === 'Acknowledged' && (sums[o['Rental ID']].by[RI_DEPLOYED] > 0); });
    q.pickups = list(function (o) { return o['Status'] === 'Acknowledged' && sums[o['Rental ID']].by[RI_OFFHIRED] > 0; });
    q.inProgress = list(function (o) { return o['Status'] === 'Acknowledged'; });
  }
  out.alerts = rnAttention_(ctx, me, cards, sums);
  return out;
}

/** Search across all rentals (any role on the page). form = { q, includeClosed } */
function findRentals_(form) {
  var ctx = rnLoad_();
  var q = String((form && form.q) || '').trim().toLowerCase().replace(/\s+/g, '');
  var all = !!(form && form.includeClosed);
  var rows = ctx.orders.rows.filter(function (o) {
    if (!all && (o['Status'] === 'Closed' || o['Status'] === 'Cancelled')) return false;
    if (!q) return true;
    var hay = [o['Rental ID'], o['Customer'], o['Customer Phone'], o['Site District'], o['Site Address'], o['Advance UTR'], o['CRE Name']]
      .join(' ').toLowerCase().replace(/\s+/g, '');
    return hay.indexOf(q) !== -1;
  });
  // An item ID finds the rental it is on.
  if (q && /^[a-z]+-\d+$/.test(q)) {
    var it = rnFind_(ctx.items, q);
    if (it && it['Rental ID']) {
      var o = rnFind_(ctx.orders, it['Rental ID']);
      if (o && rows.indexOf(o) === -1) rows.push(o);
    }
  }
  return rows.sort(function (a, b) { return b._row - a._row; }).slice(0, 100).map(function (o) { return rnCard_(ctx, o); });
}

// ================================================================
// Pop-ups ("needs your attention") and the reminder sweep share these rules
// ================================================================
/** Things the signed-in person should act on now -- shown as a pop-up when the page opens. */
function rnAttention_(ctx, me, cards, sums) {
  var s = getRentalSettings_(), now = Date.now(), today = todayYmd_();
  var out = [];
  var role = me.role, coord = rnIsCoordinator_(me);
  var add = function (who, rentalId, text, level) { out.push({ rentalId: rentalId, text: text, level: level || 'warn', who: who }); };
  ctx.orders.rows.forEach(function (o) {
    var id = String(o['Rental ID']), st = String(o['Status']), sum = sums[id];
    var mine = rnCreMayAct_(o, me);
    var paused = (st === 'Verified' || st === 'Acknowledged') && rnStandbyActive_(o, today);
    if (coord && String(o['Standby Status']) === 'Requested') add('Ananthu', id, id + ' – ' + o['Customer'] + ': standby asked by ' + String(o['Standby Requested By']).replace(/\s*\([^)]*\)$/, '') + ' – ' + o['Standby Reason'] + '. Approve or decline it.', 'warn');
    if (st === 'Logged') {
      if (o['Sent Back Note'] && (mine || role === 'Admin') && (role === 'CRE' || role === 'Admin')) add('CRE', id, id + ' was sent back by Accounts: ' + o['Sent Back Note'], 'bad');
      if (!o['Sent Back Note'] && (role === 'Accounts' || role === 'Admin')) {
        var h = Math.floor(opsWorkingHours_(rnMs_(o['Logged At']), now));
        if (h >= s.verifyHours) add('Accounts', id, id + ' – ' + o['Customer'] + ': advance not verified for ' + h + ' working hours.', h >= s.verifyEscHours ? 'bad' : 'warn');
      }
      return;
    }
    if (st === 'Verified') {
      var rem = rnYmd_(o['Remind On']);
      if (coord && !(rem > today) && !paused) add('Ananthu', id, id + ' – ' + o['Customer'] + (rem ? ': reminder date reached – acknowledge it now.' : ': verified, waiting for your acknowledgement.'), rem ? 'bad' : 'warn');
      return;
    }
    if (st !== 'Acknowledged') return;
    if (coord && !sum.need.length) add('Ananthu', id, id + ' – ' + o['Customer'] + ': enter the component configuration.');
    var start = rnYmd_(o['Planned Start']);
    var daysTo = start ? sbDaysBetween_(today, start) : null;
    if (!paused && (role === 'Ops' || role === 'Admin') && sum.need.length && daysTo !== null && daysTo <= 2 && !sum.tripsLeft && sum.haveTotal < sum.needTotal) {
      add('Ops', id, id + ' – ' + o['Customer'] + ': needed ' + (daysTo < 0 ? rnPlural_(-daysTo, 'day') + ' ago' : daysTo === 0 ? 'today' : 'in ' + rnPlural_(daysTo, 'day')) + ', ' + sum.haveTotal + ' of ' + sum.needTotal + ' items allocated.', daysTo <= 0 ? 'bad' : 'warn');
    }
    if (coord && sum.by[RI_TRANSIT]) add('Ananthu', id, id + ' – ' + o['Customer'] + ': ' + rnPlural_(sum.by[RI_TRANSIT], 'item') + ' dispatched – mark the installation when done.');
    if (!paused && coord && sum.need.length && start && start < today && !rnOf_(ctx.deployments, id).length) add('Ananthu', id, id + ' – ' + o['Customer'] + ': installation date ' + fmtYmd_(start) + ' has passed and nothing is marked installed.', 'bad');
    // End dates
    rnOf_(ctx.deployments, id).forEach(function (d) {
      var still = rnSplit_(d['Items']).filter(function (x) { var it = rnFind_(ctx.items, x); return it && it['Status'] === RI_DEPLOYED && String(it['Rental ID']).toUpperCase() === id.toUpperCase(); }).length;
      if (!still) return;
      var end = rnYmd_(d['Planned End']) || rnYmd_(o['Planned End']);
      if (!end) return;
      var left = sbDaysBetween_(today, end);
      if ((mine && role === 'CRE') || role === 'Admin' || coord) {
        if (left < 0) add('CRE', id, id + ' – ' + o['Customer'] + ': ' + d['Deployment ID'] + ' passed its planned end (' + fmtYmd_(end) + ') – overrun is running on ' + rnPlural_(still, 'item') + '. Record the off-hire or the extension.', 'bad');
        else if (left <= s.endRemindDays && (role === 'CRE' || role === 'Admin')) add('CRE', id, id + ' – ' + o['Customer'] + ': ' + d['Deployment ID'] + ' ends ' + (left === 0 ? 'today' : 'in ' + rnPlural_(left, 'day')) + ' (' + fmtYmd_(end) + '). Confirm the off-hire or an extension with the customer.');
      }
    });
    // Pickups
    if (coord && !paused) {
      rnOf_(ctx.offhires, id).forEach(function (r) {
        var waiting = rnSplit_(r['Items']).filter(function (x) { var it = rnFind_(ctx.items, x); return it && it['Status'] === RI_OFFHIRED; }).length;
        if (!waiting) return;
        var days = rnWorkingDays_(rnDayStartMs_(rnYmd_(r['Off-hire On'])), now);
        if (days >= s.pickupDays) add('Ananthu', id, id + ' – ' + o['Customer'] + ': ' + rnPlural_(waiting, 'item') + ' off-hired on ' + rnFmtDate_(r['Off-hire On']) + ' still at site' + (r['Suction Done On'] ? '' : ' (suction not recorded)') + '.', 'bad');
      });
    }
    if ((role === 'Accounts' || role === 'Admin') && sum.allBack) add('Accounts', id, id + ' – ' + o['Customer'] + ': everything is back – settle and close.');
  });
  // Payments
  ctx.payments.rows.forEach(function (l) {
    var o = rnFind_(ctx.orders, l['Rental ID']);
    if (!o || o['Status'] === 'Logged' || o['Status'] === 'Cancelled') return;
    var id = String(o['Rental ID']);
    if (l['Status'] === 'Paid – to verify' && (role === 'Accounts' || role === 'Admin')) add('Accounts', id, id + ' – ' + o['Customer'] + ': customer says paid ' + rnRupees_(l['Amount Received']) + ' (UTR ' + l['UTR'] + ') – verify it.');
    if (l['Status'] !== 'Due') return;
    var due = rnLineDue_(ctx, o, l, sums[id]);
    if (!due || due >= today) return;
    var mine = rnCreMayAct_(o, me);
    if (coord || (role === 'CRE' && mine) || role === 'Accounts') add('Payment', id, id + ' – ' + o['Customer'] + ': ' + l['Kind'].toLowerCase() + ' ' + rnRupees_(l['Amount Due']) + ' was due ' + fmtYmd_(due) + '.', 'bad');
  });
  if (role === 'Accounts' || role === 'Admin') {
    ctx.trips.rows.forEach(function (t) {
      if (t['Direction'] === 'Out' && t['Status'] === 'Gate pass requested') add('Accounts', String(t['Rental ID']), 'Gate pass requested for ' + t['Trip ID'] + ' (' + t['Rental ID'] + ', vehicle ' + t['Vehicle No.'] + ').');
    });
  }
  if (role === 'Ops' || role === 'Admin') {
    var insp = ctx.items.rows.filter(function (it) { return it['Status'] === RI_INSPECTION; }).length;
    if (insp) add('Ops', '', rnPlural_(insp, 'returned item') + ' waiting for inspection.');
  }
  return out;
}

/** Who gets a rental message. kind: 'coordinator' | 'escalate' | 'accounts' | 'ops' | 'cre' (+ creCode). */
function rnPeopleFor_(kind, staffMap, cfg, creCode) {
  var all = Object.keys(staffMap).map(function (k) { return staffMap[k]; }).filter(function (s) { return s.active; });
  var admins = all.filter(function (s) { return s.role === 'Admin'; });
  var pick = function (code, fallback) { var s = staffMap[code]; return (s && s.active) ? [s] : fallback; };
  var list = [];
  if (kind === 'coordinator') list = pick(cfg.firstApprover, admins);
  else if (kind === 'escalate') list = pick(cfg.escalateTo, all.filter(function (s) { return s.role === 'Director'; }).concat(admins));
  else if (kind === 'accounts') list = all.filter(function (s) { return s.role === 'Accounts'; });
  else if (kind === 'ops') list = all.filter(function (s) { return s.role === 'Ops'; });
  else if (kind === 'cre') list = rnCreRecipients_(creCode, staffMap);
  return list.map(staffRecipient_);
}

/**
 * The reminder sweep -- called from checkApprovalAlerts every 10 minutes in
 * office hours. Tokens in the "Alerts Sent" cells (orders, payment lines,
 * trips) make sure each message goes once. One email per kind of message,
 * listing every rental it applies to. Returns emails sent.
 */
function rentalSweep_(nowMs, staffMap, cfg) {
  if (!rnIsLive_()) return 0;
  var s = getRentalSettings_();
  var ctx = rnLoad_();
  var today = Utilities.formatDate(new Date(nowMs), rnTz_(), 'yyyy-MM-dd');
  var url = appUrl_(), link = url ? url + '?page=rental' : '';
  var buckets = {}; // key -> { event, to, cc, subject, intro, lines: [], marks: [] }
  var push = function (key, spec, line, mark) {
    var b = buckets[key] || (buckets[key] = { event: spec.event, to: spec.to, cc: spec.cc || [], subject: spec.subject, intro: spec.intro, lines: [], marks: [] });
    b.lines.push(line);
    b.marks.push(mark);
  };
  var who = function (k, c) { return rnPeopleFor_(k, staffMap, cfg, c); };
  var emailsOf = function (list) { return list.map(function (p) { return p.email; }).filter(Boolean); };
  var has = opsHasToken_;
  var orderMark = function (o, tok) { return { tbl: ctx.orders, row: o, col: 'Alerts Sent', tok: tok }; };
  var label = function (o) { return o['Rental ID'] + ' – ' + o['Customer'] + (o['Site District'] ? ' (' + o['Site District'] + ')' : ''); };
  // Round 2: standby timers and period rent bills (RentalExtras.js) run first, so a standby that ends today is not paused below.
  var extraSent = 0;
  if (typeof rnExtrasSweep_ === 'function') {
    try { extraSent = rnExtrasSweep_(ctx, nowMs, staffMap, cfg, today); } catch (e) { Logger.log('rental extras sweep failed: ' + e); }
  }

  ctx.orders.rows.forEach(function (o) {
    var id = String(o['Rental ID']), st = String(o['Status']), cell = String(o['Alerts Sent'] || '');
    // Standby pauses the work reminders (acknowledge, prepare, install, pick up) -- not rent, overrun or payments.
    var paused = (st === 'Verified' || st === 'Acknowledged') && rnStandbyActive_(o, today);
    if (st === 'Logged') {
      if (o['Sent Back Note']) return;
      var h = opsWorkingHours_(rnMs_(o['Logged At']), nowMs);
      if (h >= s.verifyEscHours && !has(cell, 'VerifyEsc')) push('verifyEsc', { event: 'RENTAL_VERIFY_ESCALATION', to: who('coordinator'), cc: emailsOf(who('accounts')),
        subject: 'OVERDUE: rental advances not verified after ' + s.verifyEscHours + ' working hours', intro: 'These rentals were logged with the advance paid, but Accounts hasn’t verified them. Please check with Accounts.' },
        label(o) + ', logged ' + rnFmtTime_(o['Logged At']), orderMark(o, 'VerifyEsc'));
      else if (h >= s.verifyHours && !has(cell, 'VerifyReminder') && !has(cell, 'VerifyEsc')) push('verify', { event: 'RENTAL_VERIFY_REMINDER', to: who('accounts'),
        subject: 'Reminder: rental advances to verify', intro: 'These rentals are waiting for the advance to be verified on the Rentals page.' },
        label(o) + ', advance ' + rnRupees_(o['Advance Amount']) + ', UTR ' + o['Advance UTR'], orderMark(o, 'VerifyReminder'));
      return;
    }
    if (st === 'Verified') {
      var rem = rnYmd_(o['Remind On']);
      if (rem && rem > today) return; // scheduled -- quiet until the reminder date
      if (paused) return;
      var start = rnYmd_(o['Planned Start']);
      var far = start && sbDaysBetween_(today, start) >= s.deferDays;
      if (!has(cell, 'New') && !rem) push('new', { event: 'RENTAL_NEW', to: who('coordinator'),
        subject: 'Rentals verified – waiting for your acknowledgement', intro: 'Accounts has verified the advance on these rentals. Acknowledge them on the Rentals page' +
          ' – or, for one needed ' + s.deferDays + '+ days from now, set a reminder date instead.' },
        label(o) + ', needed ' + rnFmtDate_(o['Planned Start']) + (far ? ' – ' + sbDaysBetween_(today, start) + ' days away: you can set a reminder date' : ''), orderMark(o, 'New'));
      if (rem && !has(cell, 'Back' + rem)) push('back', { event: 'RENTAL_REMINDER_DATE', to: who('coordinator'),
        subject: 'Rentals back for acknowledgement today', intro: 'You set a reminder for these rentals. Acknowledge them now on the Rentals page.' },
        label(o) + ', needed ' + rnFmtDate_(o['Planned Start']), orderMark(o, 'Back' + rem));
      var from = Math.max(rnMs_(o['Verified At']), rnDayStartMs_(rem), rnMs_(o['Standby Ended At'])); // the clock restarts after a standby
      var ah = opsWorkingHours_(from, nowMs);
      if (ah >= s.ackEscHours && !has(cell, 'AckEscalated')) push('ackEsc', { event: 'RENTAL_ACK_ESCALATION', to: who('escalate'), cc: emailsOf(who('coordinator')),
        subject: 'OVERDUE: rentals not acknowledged after ' + s.ackEscHours + ' working hours', intro: 'These verified rentals haven’t been acknowledged by the rental coordinator.' },
        label(o) + ', needed ' + rnFmtDate_(o['Planned Start']), orderMark(o, 'AckEscalated'));
      else if (ah >= s.ackHours && !has(cell, 'AckReminder') && !has(cell, 'AckEscalated')) push('ack', { event: 'RENTAL_ACK_REMINDER', to: who('coordinator'),
        subject: 'Reminder: rentals to acknowledge', intro: 'These rentals were verified ' + s.ackHours + '+ working hours ago and aren’t acknowledged. They escalate at ' + s.ackEscHours + ' h.' },
        label(o) + ', needed ' + rnFmtDate_(o['Planned Start']), orderMark(o, 'AckReminder'));
      return;
    }
    if (st !== 'Acknowledged') return;
    var sum = rnItemSummary_(ctx, id);
    var startA = rnYmd_(o['Planned Start']);
    // Prep: the working day before the installation date, still not fully allocated.
    if (!paused && startA && sum.need.length && !sum.tripsLeft && sum.haveTotal < sum.needTotal && sbDaysBetween_(today, startA) <= 1 && !has(cell, 'PrepLate')) {
      push('prep', { event: 'RENTAL_PREP_LATE', to: who('ops'), cc: emailsOf(who('coordinator')),
        subject: 'Rentals needed tomorrow or sooner are not fully prepared', intro: 'Tag and allocate the remaining items and request the gate pass on the Rentals page.' },
        label(o) + ': needed ' + fmtYmd_(startA) + ', ' + sum.haveTotal + ' of ' + sum.needTotal + ' items allocated', orderMark(o, 'PrepLate'));
    }
    // Installation: the planned date has passed and nothing is marked installed.
    if (!paused && startA && startA < today && !rnOf_(ctx.deployments, id).length) {
      var late = rnWorkingDays_(rnDayStartMs_(startA) + 86400000, nowMs);
      if (late >= 2 && !has(cell, 'InstallEsc')) push('installEsc', { event: 'RENTAL_INSTALL_ESCALATION', to: who('escalate'), cc: emailsOf(who('coordinator')),
        subject: 'OVERDUE: rentals past their installation date with nothing installed', intro: 'Nothing is marked installed on these rentals two working days after the date agreed with the customer.' },
        label(o) + ': installation date ' + fmtYmd_(startA), orderMark(o, 'InstallEsc'));
      else if (!has(cell, 'InstallLate') && !has(cell, 'InstallEsc')) push('install', { event: 'RENTAL_INSTALL_LATE', to: who('coordinator'),
        subject: 'Rentals past their installation date', intro: 'The installation date has passed on these rentals and nothing is marked installed. If it is installed, mark it with the site photo; if not, tell the CRE.' },
        label(o) + ': installation date ' + fmtYmd_(startA), orderMark(o, 'InstallLate'));
    }
    // End dates and overrun, per deployment.
    rnOf_(ctx.deployments, id).forEach(function (d) {
      var depId = String(d['Deployment ID']);
      var still = rnSplit_(d['Items']).filter(function (x) { var it = rnFind_(ctx.items, x); return it && it['Status'] === RI_DEPLOYED && String(it['Rental ID']).toUpperCase() === id.toUpperCase(); }).length;
      if (!still) return;
      var end = rnYmd_(d['Planned End']) || rnYmd_(o['Planned End']);
      if (!end) return;
      var left = sbDaysBetween_(today, end);
      var cre = who('cre', o['CRE Code']);
      if (left < 0) {
        var od = rnWorkingDays_(rnDayStartMs_(end) + 86400000, nowMs);
        if (od >= 2 && !has(cell, 'OverrunEsc-' + depId)) push('overrunEsc', { event: 'RENTAL_OVERRUN_ESCALATION', to: who('escalate'), cc: emailsOf(who('coordinator').concat(cre)),
          subject: 'Rentals running past their planned end', intro: 'These deployments are past their planned end with items still on hire, and no off-hire or extension has been recorded.' },
          label(o) + ': ' + depId + ', ' + rnPlural_(still, 'item') + ', planned end ' + fmtYmd_(end), orderMark(o, 'OverrunEsc-' + depId));
        else if (!has(cell, 'Overrun-' + depId) && !has(cell, 'OverrunEsc-' + depId)) push('overrun|' + o['CRE Code'], { event: 'RENTAL_OVERRUN', to: cre.length ? cre : who('coordinator'), cc: emailsOf(who('coordinator')),
          subject: 'Overrun: rentals past their planned end', intro: 'The planned end has passed on these deployments and the items are still on hire. Record the off-hire, or the extension the customer agreed.' },
          label(o) + ': ' + depId + ', ' + rnPlural_(still, 'item') + ', planned end ' + fmtYmd_(end), orderMark(o, 'Overrun-' + depId));
      } else if (left <= s.endRemindDays && !has(cell, 'EndSoon-' + depId)) {
        push('endSoon|' + o['CRE Code'], { event: 'RENTAL_END_SOON', to: cre.length ? cre : who('coordinator'),
          subject: 'Rentals ending soon – confirm off-hire or extension', intro: 'These deployments reach their planned end within ' + rnPlural_(s.endRemindDays, 'day') + '. Call the customer: record the off-hire, or the new end date if they extend.' },
          label(o) + ': ' + depId + ', ' + rnPlural_(still, 'item') + ', ends ' + fmtYmd_(end), orderMark(o, 'EndSoon-' + depId));
      }
    });
    // Pickup after off-hire (paused on standby, e.g. no site access).
    if (!paused) rnOf_(ctx.offhires, id).forEach(function (r) {
      var ohId = String(r['Off-hire ID']);
      var waiting = rnSplit_(r['Items']).filter(function (x) { var it = rnFind_(ctx.items, x); return it && it['Status'] === RI_OFFHIRED; }).length;
      if (!waiting) return;
      var days = rnWorkingDays_(rnDayStartMs_(rnYmd_(r['Off-hire On'])) + 86400000, nowMs);
      var line = label(o) + ': ' + rnPlural_(waiting, 'item') + ' off-hired ' + rnFmtDate_(r['Off-hire On']) + (r['Suction Done On'] ? ', suction done' : ', suction NOT recorded');
      if (days >= s.pickupDays * 2 && !has(cell, 'PickupEsc-' + ohId)) push('pickupEsc', { event: 'RENTAL_PICKUP_ESCALATION', to: who('escalate'), cc: emailsOf(who('coordinator')),
        subject: 'OVERDUE: off-hired rental items still at site', intro: 'These items were off-hired more than ' + rnPlural_(s.pickupDays * 2, 'working day') + ' ago and haven’t been picked up. They can’t be rented out again until they’re back.' },
        line, orderMark(o, 'PickupEsc-' + ohId));
      else if (days >= s.pickupDays && !has(cell, 'Pickup-' + ohId) && !has(cell, 'PickupEsc-' + ohId)) push('pickup', { event: 'RENTAL_PICKUP_LATE', to: who('coordinator'),
        subject: 'Off-hired rental items to pick up', intro: 'These items are past the ' + rnPlural_(s.pickupDays, 'working day') + ' pickup deadline. Record the suction and plan the pickup on the Rentals page.' },
        line, orderMark(o, 'Pickup-' + ohId));
    });
    // Settlement.
    if (sum.allBack && sum.lastInMs) {
      var sd = rnWorkingDays_(sum.lastInMs, nowMs);
      if (sd >= s.settleDays * 2 && !has(cell, 'SettleEsc')) push('settleEsc', { event: 'RENTAL_SETTLE_ESCALATION', to: who('coordinator'), cc: emailsOf(who('accounts')),
        subject: 'Returned rentals not settled', intro: 'Everything is back on these rentals, but Accounts hasn’t settled and closed them.' }, label(o), orderMark(o, 'SettleEsc'));
      else if (sd >= s.settleDays && !has(cell, 'Settle') && !has(cell, 'SettleEsc')) push('settle', { event: 'RENTAL_SETTLE_REMINDER', to: who('accounts'),
        subject: 'Reminder: returned rentals to settle', intro: 'Everything is back on these rentals. Bill any overrun or charges, record the balance and close them.' }, label(o), orderMark(o, 'Settle'));
    }
  });

  // Payment lines.
  ctx.payments.rows.forEach(function (l) {
    var o = rnFind_(ctx.orders, l['Rental ID']);
    if (!o || ['Verified', 'Acknowledged', 'Closed'].indexOf(String(o['Status'])) === -1) return;
    var cell = String(l['Alerts Sent'] || '');
    var lineMark = function (tok) { return { tbl: ctx.payments, row: l, col: 'Alerts Sent', tok: tok }; };
    var text = label(o) + ': ' + String(l['Kind']).toLowerCase() + ' ' + rnRupees_(l['Status'] === 'Due' ? l['Amount Due'] : l['Amount Received']);
    if (l['Status'] === 'Paid – to verify') {
      var vh = opsWorkingHours_(rnMs_(l['Customer Says Paid At']), nowMs);
      if (vh >= s.verifyHours && !has(cell, 'VerifyPay')) push('verifyPay', { event: 'RENTAL_PAYMENT_VERIFY', to: who('accounts'),
        subject: 'Reminder: rental payments to verify', intro: 'The CRE recorded these payments as paid by the customer. Check the bank and verify them on the Rentals page.' },
        text + ', UTR ' + l['UTR'], lineMark('VerifyPay'));
      return;
    }
    if (l['Status'] !== 'Due') return;
    var due = rnLineDue_(ctx, o, l);
    if (!due || due >= today) return;
    var od = rnWorkingDays_(rnDayStartMs_(due) + 86400000, nowMs);
    if (od >= s.payEscDays && !has(cell, 'OverdueEsc')) push('payEsc', { event: 'RENTAL_PAYMENT_ESCALATION', to: who('escalate'), cc: emailsOf(who('coordinator').concat(who('cre', o['CRE Code']))),
      subject: 'OVERDUE rental payments', intro: 'These rental payments are more than ' + rnPlural_(s.payEscDays, 'working day') + ' past their due date.' },
      text + ', due ' + fmtYmd_(due), lineMark('OverdueEsc'));
    else if (!has(cell, 'Overdue') && !has(cell, 'OverdueEsc')) push('pay', { event: 'RENTAL_PAYMENT_OVERDUE', to: who('coordinator'), cc: emailsOf(who('cre', o['CRE Code'])),
      subject: 'Rental payments past their due date', intro: 'These payments were due and aren’t recorded. Follow up with the customer; the CRE records it as paid once it comes.' },
      text + ', due ' + fmtYmd_(due), lineMark('Overdue'));
  });

  // Trips: gate passes waiting with Accounts; returned items waiting for inspection.
  var ops = getOpsSettings_();
  ctx.trips.rows.forEach(function (t) {
    var cell = String(t['Alerts Sent'] || '');
    var tripMark = function (tok) { return { tbl: ctx.trips, row: t, col: 'Alerts Sent', tok: tok }; };
    if (t['Direction'] === 'Out' && t['Status'] === 'Gate pass requested') {
      var mins = officeMinutesBetween_(rnMs_(t['Created At']), nowMs, cfg);
      if (mins >= ops.acctRemindHours * 60 && !has(cell, 'GatePass')) push('gp', { event: 'RENTAL_GATE_PASS_REMINDER', to: who('accounts'),
        subject: 'Reminder: rental gate passes to issue', intro: 'Ops has loaded these rental trips and asked for the gate pass.' },
        t['Trip ID'] + ' – ' + t['Rental ID'] + ', vehicle ' + t['Vehicle No.'] + ', ' + t['Counts'], tripMark('GatePass'));
    }
    if (t['Direction'] === 'Return' && t['Status'] === 'Arrived') {
      var waiting = rnSplit_(t['Items']).filter(function (x) { var it = rnFind_(ctx.items, x); return it && it['Status'] === RI_INSPECTION; }).length;
      if (!waiting) return;
      var idays = rnWorkingDays_(rnMs_(t['Gate At']), nowMs);
      if (idays >= s.inspectDays * 2 && !has(cell, 'InspectEsc')) push('inspectEsc', { event: 'RENTAL_INSPECT_ESCALATION', to: who('coordinator'), cc: emailsOf(who('ops')),
        subject: 'Returned rental items still not inspected', intro: 'These items came back and haven’t been inspected, so they can’t go out again.' },
        t['Trip ID'] + ' – ' + t['Rental ID'] + ': ' + rnPlural_(waiting, 'item'), tripMark('InspectEsc'));
      else if (idays >= s.inspectDays && !has(cell, 'Inspect') && !has(cell, 'InspectEsc')) push('inspect', { event: 'RENTAL_INSPECT_REMINDER', to: who('ops'),
        subject: 'Reminder: returned rental items to inspect', intro: 'Check each item and mark it OK or damaged on the Rentals page.' },
        t['Trip ID'] + ' – ' + t['Rental ID'] + ': ' + rnPlural_(waiting, 'item'), tripMark('Inspect'));
    }
  });

  var sent = 0;
  Object.keys(buckets).forEach(function (k) {
    var b = buckets[k];
    if (!b.to.length) b.to = who('coordinator');
    sent += notify_(b.event, b.lines.length === 1 ? String(b.marks[0].row['Rental ID'] || '') : '', b.to, {
      subject: b.subject + (b.lines.length > 1 ? ' (' + b.lines.length + ')' : ''), email: true, cc: b.cc,
      text: b.subject + ': ' + b.lines.join('; '),
      html: '<p>' + rnEsc_(b.intro) + '</p><ul>' + b.lines.map(function (x) { return '<li>' + rnEsc_(x) + '</li>'; }).join('') + '</ul>',
      link: link, linkLabel: 'Open Rentals'
    });
    b.marks.forEach(function (m) {
      var cur = String(m.row[m.col] || '');
      rnSet_(m.tbl, m.row, (function () { var f = {}; f[m.col] = (cur ? cur + ' | ' : '') + m.tok + ' ' + rnStamp_(); return f; })());
    });
  });
  return sent + extraSent;
}

// ================================================================
// Overview -- Directors and the Admin
// ================================================================
function getRentalOverview_() {
  var ctx = rnLoad_();
  var fleet = RENTAL_CATEGORIES.map(function (c) {
    var row = { category: c.name, prefix: c.prefix, by: {}, total: 0, untagged: 0 };
    RI_ORDER.forEach(function (s) { row.by[s] = 0; });
    ctx.items.rows.forEach(function (it) { if (it['Category'] === c.name) { row.by[it['Status']] = (row.by[it['Status']] || 0) + 1; row.total++; } });
    ctx.types.rows.forEach(function (t) { if (t['Category'] === c.name) row.untagged += rnNum_(t['Untagged In Yard']); });
    return row;
  });
  var open = ctx.orders.rows.filter(function (o) { return o['Status'] === 'Acknowledged' || o['Status'] === 'Verified' || o['Status'] === 'Logged'; });
  var money = { due: 0, received: 0, balance: 0, overdue: 0, vendorCost: 0, overrunUnbilled: 0 };
  var rows = open.map(function (o) {
    var m = rnMoney_(ctx, o), c = rnCost_(ctx, o['Rental ID']);
    if (o['Status'] !== 'Logged') { // an unverified advance isn't money yet
      money.due += m.due; money.received += m.received; money.balance += Math.max(0, m.balance); money.overrunUnbilled += m.overrunUnbilled;
    }
    money.vendorCost += c.total;
    var card = rnCard_(ctx, o);
    card.balance = m.balance; card.cost = c.total; card.overrunUnbilled = m.overrunUnbilled;
    return card;
  });
  var today = todayYmd_();
  ctx.payments.rows.forEach(function (l) {
    var o = rnFind_(ctx.orders, l['Rental ID']);
    if (!o || l['Status'] !== 'Due' || ['Verified', 'Acknowledged', 'Closed'].indexOf(String(o['Status'])) === -1) return;
    var due = rnLineDue_(ctx, o, l);
    if (due && due < today) money.overdue += rnNum_(l['Amount Due']);
  });
  var shortages = [];
  open.filter(function (o) { return o['Status'] === 'Acknowledged'; }).forEach(function (o) {
    rnShortages_(ctx, o['Rental ID']).forEach(function (x) { x.rentalId = String(o['Rental ID']); x.customer = String(o['Customer']); shortages.push(x); });
  });
  return { fleet: fleet, statuses: RI_ORDER, rentals: rows, money: money, shortages: shortages,
    closedCount: ctx.orders.rows.filter(function (o) { return o['Status'] === 'Closed'; }).length };
}

// ================================================================
// Setup + go-live -- ICF Admin menu
// ================================================================
/**
 * Safe to run more than once.
 *   1. Creates the nine Rental tabs (headers only) and seeds Rental Item Types.
 *   2. Adds the Rentals rows to the Settings tab (deposit off).
 *   3. Creates the two Drive folders.
 *   4. Switches rentals on. Nothing in the sales tracker changes.
 */
function setupRentals() {
  var report = [];
  Object.keys(RENTAL_TABLES).forEach(function (k) {
    var existed = !!SpreadsheetApp.openById(SHEET_ID).getSheetByName(RENTAL_TABLES[k].name);
    rnTable_(k);
    report.push((existed ? 'Tab ready: ' : 'Created tab: ') + RENTAL_TABLES[k].name);
  });
  var types = rnTable_('types');
  if (!types.rows.length) {
    RENTAL_CATEGORIES.forEach(function (c) { rnAppend_(types, { 'Category': c.name, 'Type': c.name, 'Active': 'Y', 'Untagged In Yard': 0 }); });
    report.push('Rental Item Types seeded with one type per category. Add variants as rows (Category | Type) and type the yard count of untagged items in “Untagged In Yard”.');
  }
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var settings = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (settings) {
    var existing = settings.getLastRow() >= 2 ? settings.getRange(2, 1, settings.getLastRow() - 1, 1).getValues().map(function (x) { return String(x[0]).trim().toLowerCase(); }) : [];
    var added = 0;
    RENTAL_SETTINGS_ROWS.forEach(function (row) {
      if (existing.indexOf(row[0].toLowerCase()) !== -1) return;
      var n = settings.getLastRow() + 1;
      settings.getRange(n, 2).setNumberFormat('@');
      settings.getRange(n, 1, 1, 3).setValues([[row[0], row[1], row[2]]]);
      added++;
    });
    report.push(added ? 'Settings: ' + added + ' Rentals rows added (change them on the Settings page). Security deposit is off.' : 'Settings: Rentals rows already there.');
  }
  getOrCreateFolder(RENTAL_DOCS_FOLDER_NAME);
  getOrCreateFolder(RENTAL_GATE_PASS_FOLDER_NAME);
  report.push('Drive folders ready: ' + RENTAL_DOCS_FOLDER_NAME + ', ' + RENTAL_GATE_PASS_FOLDER_NAME + '.');
  var props = PropertiesService.getScriptProperties();
  if (!rnIsLive_()) {
    props.setProperty(RENTAL_GO_LIVE_PROP, String(Date.now()));
    report.push('Rentals LIVE from ' + opsFmt_(new Date()) + '. The Rentals page is ' + (appUrl_() ? appUrl_() + '?page=rental' : '…/exec?page=rental') + '.');
    logActivity_({ code: 'SYSTEM', name: 'Rentals go-live', role: '' }, 'Rentals went live', '', '');
  } else {
    report.push('Rentals already live.');
  }
  CacheService.getScriptCache().remove('rental_settings');
  var msg = report.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('Rentals', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { /* run from the editor */ }
  return msg;
}

// ================================================================
// Wiring used by Code.js
// ================================================================
function rentalApiMap_() {
  var CRE = ['CRE'], ACC = ['Accounts'], OPS = ['Ops'], DIR = ['Director'], GATE = ['Gate'];
  var PAGE = ['CRE', 'Accounts', 'Ops', 'Director'];
  return {
    getRentalHome:        { fn: getRentalHome_,        roles: PAGE },
    getRentalOrder:       { fn: getRentalOrder_,       roles: PAGE },
    findRentals:          { fn: findRentals_,          roles: PAGE },
    getRentalOverview:    { fn: getRentalOverview_,    roles: DIR },
    submitRental:         { fn: submitRental_,         roles: CRE, log: 'Logged rental' },
    updateRental:         { fn: updateRental_,         roles: CRE, log: 'Edited rental' },
    verifyRental:         { fn: verifyRental_,         roles: ACC, log: 'Verified rental advance' },
    sendBackRental:       { fn: sendBackRental_,       roles: ACC, log: 'Sent rental back to CRE' },
    acknowledgeRental:    { fn: acknowledgeRental_,    roles: DIR, log: 'Acknowledged rental' },
    deferRental:          { fn: deferRental_,          roles: DIR, log: 'Scheduled rental reminder' },
    setRentalConfig:      { fn: setRentalConfig_,      roles: DIR, log: 'Configured rental' },
    rentalCustomerPaid:   { fn: rentalCustomerPaid_,   roles: CRE, log: 'Rental: customer says paid' },
    verifyRentalPayment:  { fn: verifyRentalPayment_,  roles: ACC, log: 'Verified rental payment' },
    recordRentalPayment:  { fn: recordRentalPayment_,  roles: ACC, log: 'Recorded rental payment' },
    addRentalCharge:      { fn: addRentalCharge_,      roles: ['Accounts', 'Director'], log: 'Added rental charge' },
    waiveRentalLine:      { fn: waiveRentalLine_,      roles: DIR, log: 'Waived rental charge' },
    extendRental:         { fn: extendRental_,         roles: ['CRE', 'Director'], log: 'Extended rental' },
    closeRental:          { fn: closeRental_,          roles: ACC, log: 'Closed rental' },
    cancelRental:         { fn: cancelRental_,         roles: DIR, log: 'Cancelled rental' },
    // RentalFleet.js
    tagRentalItems:       { fn: tagRentalItems_,       roles: OPS, log: 'Tagged rental items' },
    allocateRentalItems:  { fn: allocateRentalItems_,  roles: OPS, log: 'Allocated rental items' },
    releaseRentalItems:   { fn: releaseRentalItems_,   roles: OPS, log: 'Released rental items' },
    createRentalTrip:     { fn: createRentalTrip_,     roles: OPS, log: 'Requested rental gate pass' },
    cancelRentalTrip:     { fn: cancelRentalTrip_,     roles: OPS, log: 'Cancelled rental trip' },
    issueRentalGatePass:  { fn: issueRentalGatePass_,  roles: ACC, log: 'Issued rental gate pass' },
    getRentalGateQueue:   { fn: getRentalGateQueue_,   roles: GATE },
    markRentalTripOut:    { fn: markRentalTripOut_,    roles: GATE, log: 'Rental trip out at gate' },
    markRentalTripIn:     { fn: markRentalTripIn_,     roles: GATE, log: 'Rental return in at gate' },
    markRentalInstalled:  { fn: markRentalInstalled_,  roles: DIR, log: 'Marked rental installed' },
    recordRentalOffHire:  { fn: recordRentalOffHire_,  roles: ['CRE', 'Director'], log: 'Recorded rental off-hire' },
    recordRentalSuction:  { fn: recordRentalSuction_,  roles: DIR, log: 'Recorded rental suction' },
    planRentalReturn:     { fn: planRentalReturn_,     roles: ['Ops', 'Director'], log: 'Planned rental pickup' },
    inspectRentalItems:   { fn: inspectRentalItems_,   roles: OPS, log: 'Inspected rental items' },
    repairRentalItem:     { fn: repairRentalItem_,     roles: OPS, log: 'Rental item repaired' },
    writeOffRentalItem:   { fn: writeOffRentalItem_,   roles: DIR, log: 'Wrote off rental item' },
    addRentalVendorJob:   { fn: addRentalVendorJob_,   roles: DIR, log: 'Added rental vendor job' }
  };
}

function rentalActivityDetail_(fnName, a, result) {
  a = a || {}; result = result || {};
  switch (fnName) {
    case 'submitRental': return (result.customer || a.customer || '') + ' – advance ' + rnRupees_(a.advanceAmount) + ', UTR ' + (a.advanceUtr || '');
    case 'sendBackRental': return a.reason || '';
    case 'deferRental': return 'Remind on ' + (result.remindOn || '');
    case 'setRentalConfig': return (a.lines || []).map(function (l) { return (l.quantity || '') + ' × ' + (l.type || l.category || ''); }).join(', ') +
      (result.shortages && result.shortages.length ? ' – SHORT: ' + result.shortages.map(function (x) { return x.short + ' × ' + x.type; }).join(', ') : '');
    case 'rentalCustomerPaid': return (a.lineId || '') + ' – ' + rnRupees_(a.amount) + ', UTR ' + (a.utr || '');
    case 'verifyRentalPayment': return (a.lineId || '') + ' – ' + rnRupees_(result.amount);
    case 'recordRentalPayment': return rnRupees_(a.amount) + ', UTR ' + (a.utr || '');
    case 'addRentalCharge': return (a.kind || '') + ' ' + rnRupees_(a.amount) + (a.note ? ' – ' + a.note : '');
    case 'waiveRentalLine': return (a.lineId || '') + ' – ' + (a.reason || '');
    case 'extendRental': return 'New end ' + (result.plannedEnd || '') + (result.deployments && result.deployments.length ? ' (' + result.deployments.join(', ') + ')' : '');
    case 'closeRental': return result.balance > BALANCE_DUE_TOLERANCE ? 'Closed with balance ' + rnRupees_(result.balance) + ': ' + (a.note || '') : (a.note || '');
    case 'cancelRental': return a.reason || '';
    default: return (typeof rentalFleetActivityDetail_ === 'function') ? rentalFleetActivityDetail_(fnName, a, result) : '';
  }
}

// ================================================================
// Test clean-up -- ICF Admin menu ("Delete rental test entries")
// ================================================================
/**
 * Same rule as deleteTestEntries (TestCleanup.js): a rental whose customer
 * contains "Test Customer". Lists them and asks first. Then removes their
 * rows from every Rental tab, the Activity Log and the Notification Log,
 * trashes their files (agreement, installation photos, gate passes), and:
 *   - deletes the items TAGGED for a test rental that never went on a real
 *     one, adding them back to "Untagged In Yard" (so the ID numbers are
 *     reused and the yard count is right again);
 *   - releases items tagged earlier that a test rental had borrowed.
 */
function deleteRentalTestEntries() {
  var ui = SpreadsheetApp.getUi();
  var ctx = rnLoad_();
  var hits = ctx.orders.rows.filter(function (o) { return TEST_MATCH_RE.test(String(o['Customer'] || '')); });
  if (!hits.length) { ui.alert('Delete rental test entries', 'No rentals with "Test Customer" in the customer name.', ui.ButtonSet.OK); return; }
  var list = hits.slice(0, 40).map(function (o) { return '• ' + o['Rental ID'] + '  (' + o['Customer'] + ')'; }).join('\n') + (hits.length > 40 ? '\n… and ' + (hits.length - 40) + ' more' : '');
  var answer = ui.alert('Delete ' + hits.length + ' test rental' + (hits.length === 1 ? '' : 's') + '?',
    list + '\n\nTheir rows in every Rental tab, their log lines and their files will be removed (files go to the Drive trash for 30 days). ' +
    'Items tagged for them are deleted and added back to the untagged yard count.\n\nIs every one of these a test?', ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) { ui.alert('Delete rental test entries', 'Nothing was deleted.', ui.ButtonSet.OK); return; }
  var msg = rnDeleteTestRentals_(hits.map(function (o) { return String(o['Rental ID']).toUpperCase(); }));
  ui.alert('Delete rental test entries', msg, ui.ButtonSet.OK);
}

/** The work behind deleteRentalTestEntries. ids = upper-case rental IDs. Returns a summary. */
function rnDeleteTestRentals_(ids) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 'The sheet is busy – try again in a minute. Nothing was deleted.';
  var want = {};
  ids.forEach(function (x) { want[x] = true; });
  var report = [], removedItems = 0, released = 0, files = 0;
  try {
    var ctx = rnLoad_();
    var urls = [];
    ctx.orders.rows.forEach(function (o) { if (want[String(o['Rental ID']).toUpperCase()] && o['Agreement URL']) urls.push(String(o['Agreement URL'])); });
    ctx.deployments.rows.forEach(function (d) { if (want[String(d['Rental ID']).toUpperCase()] && d['Photo URL']) urls.push(String(d['Photo URL'])); });
    ctx.trips.rows.forEach(function (t) {
      if (!want[String(t['Rental ID']).toUpperCase()]) return;
      if (t['Gate Pass URL']) urls.push(String(t['Gate Pass URL']));
      if (t['Photo URL']) urls.push(String(t['Photo URL'])); // loading photo (round 2)
    });
    ctx.orders.rows.forEach(function (o) { // damage photos (round 2)
      if (!want[String(o['Rental ID']).toUpperCase()]) return;
      String(o['Damage Notes'] || '').split('\n').forEach(function (x) { var u = (x.split(' | ')[2] || '').trim(); if (u) urls.push(u); });
    });
    urls.forEach(function (u) {
      var m = u.match(/\/d\/([A-Za-z0-9_-]+)/) || u.match(/[?&]id=([A-Za-z0-9_-]+)/);
      if (!m) return;
      try { DriveApp.getFileById(m[1]).setTrashed(true); files++; } catch (e) { Logger.log('Could not trash ' + u + ': ' + e); }
    });
    // Items: delete the ones tagged for a test rental (unless a real rental has them now); release borrowed ones.
    var giveBack = {};
    var delItems = [];
    ctx.items.rows.forEach(function (it) {
      var cur = String(it['Rental ID'] || '').toUpperCase(), tagged = String(it['Tagged For'] || '').toUpperCase();
      if (want[tagged] && (!cur || want[cur])) {
        delItems.push(it._row);
        var k = it['Category'] + '|' + it['Type'];
        giveBack[k] = (giveBack[k] || 0) + 1;
      } else if (cur && want[cur]) {
        rnSet_(ctx.items, it, { 'Status': RI_AVAILABLE, 'Rental ID': '', 'Trip ID': '', 'Deployment ID': '' });
        rnItemHistory_(ctx.items, it, 'Released – test rental ' + cur + ' deleted', null);
        released++;
      }
    });
    delItems.sort(function (a, b) { return b - a; }).forEach(function (r) { ctx.items.sheet.deleteRow(r); });
    removedItems = delItems.length;
    ctx.types.rows.forEach(function (t) {
      var k = t['Category'] + '|' + t['Type'];
      if (giveBack[k]) rnSet_(ctx.types, t, { 'Untagged In Yard': rnNum_(t['Untagged In Yard']) + giveBack[k] });
    });
    ['orders', 'payments', 'config', 'trips', 'deployments', 'offhires', 'jobs'].forEach(function (k) {
      var tbl = rnTable_(k);
      var rows = tbl.rows.filter(function (r) { return want[String(r['Rental ID']).toUpperCase()]; }).map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
      rows.forEach(function (r) { tbl.sheet.deleteRow(r); });
      if (rows.length) report.push(RENTAL_TABLES[k].name + ': ' + rows.length);
    });
    var ss = SpreadsheetApp.openById(SHEET_ID);
    [ACTIVITY_LOG_SHEET_NAME, NOTIFICATION_LOG_SHEET_NAME].forEach(function (name) {
      var sh = ss.getSheetByName(name);
      if (!sh || sh.getLastRow() < 2) return;
      var lc = sh.getLastColumn();
      var hdr = sh.getRange(1, 1, 1, lc).getDisplayValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
      var c = hdr.indexOf('tracker id');
      if (c === -1) return;
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, lc).getDisplayValues();
      var del = [];
      vals.forEach(function (v, i) { if (want[String(v[c]).trim().toUpperCase()]) del.push(i + 2); });
      del.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
      if (del.length) report.push(name + ': ' + del.length);
    });
  } finally {
    lock.releaseLock();
  }
  logActivity_({ code: 'SYSTEM', name: 'Delete rental test entries', role: '' }, 'Deleted test rentals', '', ids.length + ' rental(s): ' + ids.join(', '));
  return 'Deleted ' + ids.length + ' test rental(s). ' + removedItems + ' test-tagged item(s) deleted and added back to the untagged yard count' +
    (released ? ', ' + released + ' borrowed item(s) released' : '') + '. ' + files + ' file(s) moved to the Drive trash. Rows removed: ' + (report.join(', ') || 'none') + '.';
}
