/**
 * GATE LOGIN (Oct 2026) -- the gate marks the vehicle out
 * ---------------------------------------------------------------------
 * WHY: issuing the gate pass used to stamp "Dispatch Timestamp" and leave
 * Delivery Status at "Pending". Nothing in the system knew when the vehicle
 * actually left -- a gate pass can sit for hours -- and "In Transit" only
 * happened if the CRE remembered to set it. So pickup-to-dispatch figures
 * measured the gate pass, not the dispatch, and Pending/In Transit meant
 * nothing on the dashboard.
 *
 * FLOW (Hari, Oct 2026)
 *   Accounts issues the gate pass  -> "Gate-Verified", Delivery "Pending",
 *                                     Gate Pass Issued Timestamp = now.
 *                                     No dispatch time yet.
 *   Sanju (role "Gate", ?page=gate) checks the paper gate pass against the
 *   list of vehicles waiting, and taps "Vehicle left"
 *                                  -> Gate Out Timestamp + Dispatch Timestamp
 *                                     = that click, Gate Out By = Sanju,
 *                                     Delivery Status "In Transit".
 *   The CRE takes delivery follow-up from there (Delivered / Returned). Until
 *   the gate marks it out, the CRE can't update delivery for that order.
 *   A wrong tap can be undone by the same person (or an Admin) within
 *   GATE_UNDO_MINUTES, as long as nobody has updated delivery since.
 *
 * Courier orders don't pass the gate in a vehicle -- Ops records the posting
 * and they go straight to "In Transit" as before.
 *
 * GO-LIVE: "Gate login + PO uploads: set up and go live" on the ICF Admin menu
 * (setupGateAndDocs). Until it has run, gate passes still stamp the dispatch
 * time as before, so deploying the code first changes nothing. Gate passes
 * issued before go-live never show on the gate list (those vehicles have gone).
 */
var GATE_GO_LIVE_PROP = 'gate_go_live_ms';
var GATE_UNDO_MINUTES = 30;
var GATE_NEW_HEADERS = ['Gate Pass Issued Timestamp', 'Gate Out Timestamp', 'Gate Out By', 'CRM PO URL', 'Customer PO URL'];
// In-app nudge (Oct 2026, Hari): a vehicle normally leaves within ~3 hours of its
// gate pass. Past this many OFFICE hours it shows red on the gate page and as a
// red "not out at the gate" badge in the Admin's bar (Ananthu) on every page.
// No email or WhatsApp -- it lives in the web app only.
var GATE_SETTINGS_ROWS = [
  ['Gate: flag a vehicle not out within (office hours)', '6', 'After Accounts issues the gate pass. Shown red on the gate page and to the admins in the web app. Office hours only.']
];
var GATE_NUDGE_CEILING = 48;
var GATE_OVERDUE_CACHE = 'gate_overdue';

/** Office hours before a waiting vehicle is flagged. Cached 5 minutes. */
function gateNudgeHours_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('gate_nudge_hours');
  if (hit) return Number(hit);
  var raw = sbReadSettingsMap_()[GATE_SETTINGS_ROWS[0][0].toLowerCase()];
  var v = Number(String(raw == null ? '' : raw).replace(/[,\s]/g, ''));
  if (raw === undefined || raw === '' || isNaN(v)) v = Number(GATE_SETTINGS_ROWS[0][1]);
  v = Math.min(GATE_NUDGE_CEILING, Math.max(1, Math.floor(v)));
  cache.put('gate_nudge_hours', String(v), 300);
  return v;
}

/** Office minutes a vehicle has waited since its gate pass. */
function gateWaitedMins_(issuedMs, nowMs, cfg) {
  return issuedMs ? officeMinutesBetween_(issuedMs, nowMs, cfg) : 0;
}

/** For the Admin's bar: { count, oldestHours }. Cached 2 minutes -- the bar asks every minute. */
function gateOverdueSummary_() {
  if (!gateIsLive_()) return { count: 0 };
  var cache = CacheService.getScriptCache();
  var hit = cache.get(GATE_OVERDUE_CACHE);
  if (hit) return JSON.parse(hit);
  var cfg = getAlertSettings_(), limit = gateNudgeHours_() * 60, now = Date.now();
  var count = 0, oldest = 0;
  opsReadOrders_().rows.forEach(function (o) {
    if (!gateWaitingFromValues_(o.get('Status'), o.get('Dispatch Type'), o.get('Gate Pass Issued Timestamp'), o.get('Gate Out Timestamp'))) return;
    var mins = gateWaitedMins_(opsMs_(o.get('Gate Pass Issued Timestamp')), now, cfg);
    if (mins >= limit) { count++; if (mins > oldest) oldest = mins; }
  });
  var out = { count: count, oldestHours: Math.floor(oldest / 60), limitHours: limit / 60 };
  cache.put(GATE_OVERDUE_CACHE, JSON.stringify(out), 120);
  return out;
}

function gateGoLiveMs_() {
  return Number(PropertiesService.getScriptProperties().getProperty(GATE_GO_LIVE_PROP) || 0) || 0;
}
function gateIsLive_() { return gateGoLiveMs_() > 0; }

/** Gate pass issued after go-live, vehicle order, not yet marked out. */
function gateWaitingFromValues_(status, dispatchType, issuedVal, outVal) {
  var live = gateGoLiveMs_();
  if (!live) return false;
  if (String(status || '') !== 'Gate-Verified') return false;
  if (normalizeDispatchType_(dispatchType) === DISPATCH_COURIER) return false;
  var issued = opsMs_(issuedVal);
  return !!issued && issued >= live && !opsMs_(outVal);
}

function gateWaitingForRow_(sheet, row) {
  var f = getRowFields(sheet, row, ['Status', 'Dispatch Type', 'Gate Pass Issued Timestamp', 'Gate Out Timestamp']);
  return gateWaitingFromValues_(f['Status'], f['Dispatch Type'], f['Gate Pass Issued Timestamp'], f['Gate Out Timestamp']);
}

function gateAssertLive_() {
  if (!gateIsLive_()) throw new Error('The gate login isn’t switched on yet – the admin runs "Gate login + PO uploads: set up and go live" first.');
}

function gateCard_(o, products) {
  var id = String(o.get('Tracker ID'));
  return {
    trackerId: id,
    institution: String(o.get('Institution / Customer') || ''),
    location: [o.get('District'), o.get('State')].filter(function (x) { return String(x || '').trim(); }).join(', '),
    vehicleNo: String(o.get('Vehicle No.') || ''),
    gatePassNo: String(o.get('Gate Pass No.') || ''),
    transport: [o.get('Transport Mode'), o.get('Courier / Transport Name')].filter(function (x) { return String(x || '').trim(); }).join(' – '),
    issuedAt: opsFmt_(o.get('Gate Pass Issued Timestamp')),
    issuedMs: opsMs_(o.get('Gate Pass Issued Timestamp')),
    outAt: opsFmt_(o.get('Gate Out Timestamp')),
    outMs: opsMs_(o.get('Gate Out Timestamp')),
    outBy: String(o.get('Gate Out By') || ''),
    gatePassPdfUrl: String(o.get('Gate Pass PDF URL') || ''),
    priority: o.get('Priority Level') === 'High' ? 'High' : 'Normal',
    products: products[id.toLowerCase()] || ''
  };
}

/** Gate page: vehicles waiting to leave, and what left today. */
function getGateQueue_() {
  var live = gateGoLiveMs_();
  var out = { live: live > 0, waiting: [], leftToday: [], undoMinutes: GATE_UNDO_MINUTES, nudgeHours: 0, overdue: 0 };
  if (!live) return out;
  var cfg = getAlertSettings_(), limit = gateNudgeHours_() * 60;
  out.nudgeHours = limit / 60;
  var data = opsReadOrders_();
  var products = opsProductsByOrder_();
  var tz = Session.getScriptTimeZone();
  var today = todayYmd_();
  var me = CURRENT_STAFF_ || {};
  var now = Date.now();
  data.rows.forEach(function (o) {
    if (gateWaitingFromValues_(o.get('Status'), o.get('Dispatch Type'), o.get('Gate Pass Issued Timestamp'), o.get('Gate Out Timestamp'))) {
      var wc = gateCard_(o, products);
      var mins = gateWaitedMins_(wc.issuedMs, now, cfg);
      wc.waitedHours = Math.floor(mins / 60);
      wc.waitedMins = mins;
      wc.overdue = mins >= limit;
      if (wc.overdue) out.overdue++;
      out.waiting.push(wc);
      return;
    }
    var outMs = opsMs_(o.get('Gate Out Timestamp'));
    if (outMs && Utilities.formatDate(new Date(outMs), tz, 'yyyy-MM-dd') === today) {
      var c = gateCard_(o, products);
      c.canUndo = gateCanUndo_(o.get('Gate Out By'), outMs, o.get('Delivery Status'), me, now);
      out.leftToday.push(c);
    }
  });
  out.waiting.sort(function (a, b) { return a.issuedMs - b.issuedMs; });       // longest waiting first
  out.leftToday.sort(function (a, b) { return b.outMs - a.outMs; });          // latest first
  return out;
}

function gateCanUndo_(outBy, outMs, deliveryStatus, me, now) {
  if (!outMs || now - outMs > GATE_UNDO_MINUTES * 60000) return false;
  if (String(deliveryStatus || '') !== 'In Transit') return false; // the CRE has moved it on since
  if (me.role === 'Admin') return true;
  return String(outBy || '').indexOf('(' + me.code + ')') !== -1;
}

/** Sanju: the vehicle has left. form = { trackerId }. The time is the click. */
function markGateOut_(form) {
  gateAssertLive_();
  var me = CURRENT_STAFF_;
  var sheet = getSheet();
  var row = findRowByTrackerId(sheet, String((form && form.trackerId) || '').trim());
  if (row === -1) throw new Error('Order not found.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var now = new Date(), f;
  try {
    f = getRowFields(sheet, row, ['Tracker ID', 'Status', 'Dispatch Type', 'Gate Pass Issued Timestamp', 'Gate Out Timestamp', 'Gate Out By', 'Gate Pass No.', 'Vehicle No.']);
    if (opsMs_(f['Gate Out Timestamp'])) throw new Error('Already marked out at ' + opsFmt_(f['Gate Out Timestamp']) + (f['Gate Out By'] ? ' by ' + f['Gate Out By'] : '') + '.');
    if (!gateWaitingFromValues_(f['Status'], f['Dispatch Type'], f['Gate Pass Issued Timestamp'], f['Gate Out Timestamp'])) {
      throw new Error('This order isn’t waiting at the gate (stage: "' + f['Status'] + '"). Refresh the list.');
    }
    CacheService.getScriptCache().remove(GATE_OVERDUE_CACHE);
    setRowFields(sheet, row, {
      'Gate Out Timestamp': now,
      'Gate Out By': me.name + ' (' + me.code + ')',
      'Dispatch Timestamp': now,
      'Gate Verification Result': 'Out – ' + me.name,
      'Delivery Status': 'In Transit',
      'Delivery Status Last Updated': now
    });
  } finally {
    lock.releaseLock();
  }
  return { trackerId: String(f['Tracker ID']), gatePassNo: String(f['Gate Pass No.'] || ''), vehicleNo: String(f['Vehicle No.'] || ''), outAt: opsFmt_(now) };
}

/** A wrong tap: back to "waiting at the gate". Same person or an Admin, within GATE_UNDO_MINUTES. */
function undoGateOut_(form) {
  gateAssertLive_();
  var me = CURRENT_STAFF_;
  var sheet = getSheet();
  var row = findRowByTrackerId(sheet, String((form && form.trackerId) || '').trim());
  if (row === -1) throw new Error('Order not found.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var f;
  try {
    f = getRowFields(sheet, row, ['Tracker ID', 'Gate Out Timestamp', 'Gate Out By', 'Delivery Status', 'Gate Pass Issued Timestamp']);
    var outMs = opsMs_(f['Gate Out Timestamp']);
    if (!outMs) throw new Error('This vehicle isn’t marked out.');
    if (!gateCanUndo_(f['Gate Out By'], outMs, f['Delivery Status'], me, Date.now())) {
      throw new Error('This can only be undone by the person who marked it, within ' + GATE_UNDO_MINUTES + ' minutes, before the CRE updates delivery. Ask the admin.');
    }
    CacheService.getScriptCache().remove(GATE_OVERDUE_CACHE);
    setRowFields(sheet, row, {
      'Gate Out Timestamp': '', 'Gate Out By': '', 'Dispatch Timestamp': '', 'Gate Verification Result': '',
      'Delivery Status': 'Pending', 'Delivery Status Last Updated': new Date()
    });
  } finally {
    lock.releaseLock();
  }
  return { trackerId: String(f['Tracker ID']) };
}

// ================================================================
// Setup -- run once from the ICF Admin menu
// ================================================================
/**
 * Safe to run more than once.
 *   1. Writes the 5 new tracker headers (stops if those cells hold anything else).
 *   2. Adds "Gate" to the Role dropdown and a row GATE001 Sanju.
 *   3. Creates the "ICF Order POs" folder for the uploads.
 *   4. Switches the gate login on. From now, issuing a gate pass no longer
 *      stamps the dispatch time -- the gate does.
 * The PO uploads work as soon as the code is deployed; this only makes sure
 * the columns and folder are in place.
 */
function setupGateAndDocs() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var props = PropertiesService.getScriptProperties();
  var report = [];

  // 1. Headers
  var tracker = getSheet();
  var first = getHeaderIndex(GATE_NEW_HEADERS[0]);
  var current = tracker.getRange(1, first, 1, GATE_NEW_HEADERS.length).getDisplayValues()[0];
  var clash = [];
  current.forEach(function (v, i) {
    var t = String(v || '').trim();
    if (t && t !== GATE_NEW_HEADERS[i]) clash.push(tracker.getRange(1, first + i).getA1Notation() + ' holds "' + t + '"');
  });
  if (clash.length) {
    throw new Error('Stopped – nothing changed. The new columns need to go in ' + tracker.getRange(1, first).getA1Notation() + ':' +
      tracker.getRange(1, first + GATE_NEW_HEADERS.length - 1).getA1Notation() + ', but ' + clash.join('; ') + '. Move that data first.');
  }
  tracker.getRange(1, first, 1, GATE_NEW_HEADERS.length).setValues([GATE_NEW_HEADERS]).setFontWeight('bold');
  report.push('Tracker columns ' + tracker.getRange(1, first).getA1Notation() + ' to ' + tracker.getRange(1, first + GATE_NEW_HEADERS.length - 1).getA1Notation() + ' ready.');

  // 2. Staff tab
  var staff = ss.getSheetByName(STAFF_SHEET_NAME);
  if (staff) {
    staff.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ROLES, true).build());
    var map = getStaffMap_(true);
    var hasGate = Object.keys(map).some(function (k) { return map[k].role === 'Gate'; });
    if (!hasGate && !map['GATE001']) {
      var r = staff.getLastRow() + 1;
      staff.getRange(r, 1, 1, 4).setValues([['GATE001', 'Sanju', 'Gate', 'Y']]);
      report.push('Added GATE001 Sanju (Gate) to the Staff tab – type his PIN in column E.');
    } else {
      report.push('A Gate staff row already exists – not added again.');
    }
  }

  // 2b. Settings row for the gate nudge
  var settings = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (settings) {
    var existing = settings.getLastRow() >= 2 ? settings.getRange(2, 1, settings.getLastRow() - 1, 1).getValues().map(function (x) { return String(x[0]).trim().toLowerCase(); }) : [];
    GATE_SETTINGS_ROWS.forEach(function (row) {
      if (existing.indexOf(row[0].toLowerCase()) !== -1) return;
      var n = settings.getLastRow() + 1;
      settings.getRange(n, 2).setNumberFormat('@');
      settings.getRange(n, 1, 1, 3).setValues([[row[0], row[1], row[2]]]);
      report.push('Settings: "' + row[0] + '" = ' + row[1] + ' (change it on the Settings page).');
    });
  }

  // 3. Upload folder
  getOrCreateFolder(DOCS_FOLDER_NAME);
  report.push('Upload folder "' + DOCS_FOLDER_NAME + '" ready in Drive.');

  // 4. Go-live
  var live = gateGoLiveMs_();
  if (!live) {
    var now = new Date();
    props.setProperty(GATE_GO_LIVE_PROP, String(now.getTime()));
    report.push('Gate login LIVE from ' + opsFmt_(now) + '. Gate passes issued from now wait for the gate to mark the vehicle out; earlier ones are left as they are.');
    logActivity_({ code: 'SYSTEM', name: 'Gate login go-live', role: '' }, 'Gate login went live', '', '');
  } else {
    report.push('Gate login already live since ' + opsFmt_(live) + '.');
  }

  var cache = CacheService.getScriptCache();
  cache.remove('staff_map'); cache.remove('gate_nudge_hours'); cache.remove(GATE_OVERDUE_CACHE);
  var msg = report.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('Gate login + PO uploads', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { /* run from the editor */ }
  return msg;
}

// ================================================================
// Wiring used by Code.js
// ================================================================
function gateApiMap_() {
  return {
    getGateQueue: { fn: getGateQueue_, roles: ['Gate'] },
    markGateOut:  { fn: markGateOut_,  roles: ['Gate'], log: 'Vehicle out at gate' },
    undoGateOut:  { fn: undoGateOut_,  roles: ['Gate'], log: 'Undid vehicle out' }
  };
}

function gateActivityDetail_(fnName, a, result) {
  result = result || {};
  switch (fnName) {
    case 'markGateOut': return (result.gatePassNo || '') + (result.vehicleNo ? ', vehicle ' + result.vehicleNo : '') + ' – out at ' + (result.outAt || '');
    case 'undoGateOut': return 'Back to waiting at the gate';
    default: return '';
  }
}
