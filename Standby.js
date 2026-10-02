/**
 * STANDBY (Oct 2026) -- customer-caused delays, kept out of Ops' numbers
 * ---------------------------------------------------------------------
 * WHY: when the customer holds things up (site not ready, payment late, new
 * delivery location...), the order used to sit at its stage and read as
 * Ops being slow. Standby takes it off every live list and out of the
 * turnaround-time figures, but only with an admin's say-so, for a fixed
 * period, and within limits the directors set.
 *
 * FLOW
 *   1. Ops hears about the delay from the customer and tells Accounts.
 *   2. Accounts looks the order up and raises a standby request: reason,
 *      note, the ops person who reported it, the date the delay started
 *      (today, or a few days back) and the date the customer expects to be
 *      ready ("resume date"). Allowed from Sent to Ops, Site Not Ready,
 *      Vehicle Confirmed and (courier) On Hold - Balance Due.
 *   3. An Admin approves (optionally with an EARLIER resume date) or
 *      declines on the Admin page. The order stays live until then.
 *   4. If approving would go past a director limit -- too many days, started
 *      too far back, too many orders on standby, or too much order value on
 *      standby -- it goes to the Directors instead ("Pending Director"),
 *      who decide from the Owner Dashboard.
 *   5. Approved: the order's Status becomes "On Standby" (its old status is
 *      remembered). It drops off Accounts' Needs Action list, can't get a
 *      gate pass, and the time is excluded from the dashboard's TAT.
 *   6. Admin/Director can shorten an active standby at any time; Accounts can
 *      resume it early. The day before the resume date Accounts and the
 *      admins get a nudge; ON the resume date (when the office opens) the
 *      order resumes by itself and shows as live again. Needing more time
 *      means a fresh request.
 *
 * WHERE THINGS LIVE
 *   "Standby Requests" tab (created on first use) -- one row per request,
 *     see SB_HEADERS. Status: Pending | Pending Director | Active |
 *     Declined | Ended. An Active/Ended row's Started At..Ended At is the
 *     period removed from TAT on the dashboard.
 *   "Settings" tab -- the standby limits (SB_SETTINGS_ROWS) sit alongside
 *     the existing office-hours rows. Directors edit all of it from the
 *     Settings page (?page=settings); SB_CEILINGS are hard limits the
 *     Settings page can't go past.
 *   Tracker -- no new columns. Status "On Standby" is the only change.
 */
var STANDBY_SHEET_NAME = 'Standby Requests';
var STATUS_STANDBY = 'On Standby';
var SB_HEADERS = ['Request ID', 'Requested At', 'Tracker ID', 'Institution', 'Requested By', 'Requested By Name',
  'Reason', 'Note', 'Reported By (Ops)', 'Standby From', 'Requested Resume Date', 'Approved Resume Date',
  'Order Value', 'Status', 'Decided By', 'Decided At', 'Director Decision', 'Director Decided At',
  'Status Before Standby', 'Started At', 'Ended At', 'Ended How', 'Backdated Days', 'Alerts Sent', 'History'];
var SB_REASONS = ['Site not ready', 'Customer payment pending', 'Delivery location changed', 'Customer asked to postpone', 'Other'];
var SB_ELIGIBLE = ['Sent to Ops', 'On Hold - Site Not Ready', 'Vehicle Confirmed', 'On Hold - Balance Due'];
// Hard ceilings -- the Settings page can set anything up to these, never past them.
var SB_CEILINGS = { maxDays: 60, maxBackdateDays: 14, maxOrders: 20, maxValue: 5000000, minutes: 1440 };
var SB_SETTINGS_ROWS = [
  ['Standby: longest standby without director approval (days)', '15', 'Longer standbys go to a director. Hard limit 60 days.'],
  ['Standby: how far back a standby can start without director approval (days)', '3', 'For delays reported late. 0 = no backdating without a director. Hard limit 14.'],
  ['Standby: orders on standby at once before director approval', '5', 'The next one needs a director. Hard limit 20.'],
  ['Standby: total order value on standby before director approval (Rs.)', '200000', 'Inventory held for customers. Hard limit Rs. 50,00,000.'],
  ['Standby approval: remind after (office minutes)', '60', 'Reminder to the first approver'],
  ['Standby approval: escalate after (office minutes)', '120', 'Escalation to the escalation contact']
];

// ---------------- small helpers ----------------
function sbTz_() { return Session.getScriptTimeZone(); }
function sbEsc_(t) {
  return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}
function sbMs_(v) { return (v instanceof Date && !isNaN(v.getTime())) ? v.getTime() : null; }
function sbYmd_(v) {
  if (!v) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, sbTz_(), 'yyyy-MM-dd');
  var m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '';
}
function sbYmdToDate_(ymd) { return Utilities.parseDate(ymd + ' 00:00:00', sbTz_(), 'yyyy-MM-dd HH:mm:ss'); }
function sbDaysBetween_(a, b) { return Math.round((sbYmdToDate_(b).getTime() - sbYmdToDate_(a).getTime()) / 86400000); }
function sbAddDays_(ymd, n) { return Utilities.formatDate(new Date(sbYmdToDate_(ymd).getTime() + n * 86400000 + 3600000), sbTz_(), 'yyyy-MM-dd'); }
function sbIsYmd_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function sbRupees_(n) { return '\u20b9' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }
function sbStamp_() { return Utilities.formatDate(new Date(), sbTz_(), 'dd-MMM HH:mm'); }
function sbWho_(me) { return me.name + ' (' + me.code + ')'; }

// ---------------- Settings ----------------
/** Settings tab as { lowercased label: display value }. */
function sbReadSettingsMap_() {
  var map = {};
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SETTINGS_SHEET_NAME);
  if (sheet && sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues().forEach(function (r) {
      map[String(r[0] || '').trim().toLowerCase()] = String(r[1] || '').trim();
    });
  }
  return map;
}

/** The standby limits, clamped to SB_CEILINGS. Cached 5 minutes (cleared on save). */
function getStandbySettings_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('sb_settings');
  if (hit) return JSON.parse(hit);
  var map = sbReadSettingsMap_();
  var n = function (i, lo, hi) {
    var raw = map[SB_SETTINGS_ROWS[i][0].toLowerCase()];
    var v = Number(String(raw == null ? '' : raw).replace(/[,\s\u20b9]/g, ''));
    if (raw === undefined || raw === '' || isNaN(v)) v = Number(SB_SETTINGS_ROWS[i][1]);
    return Math.min(hi, Math.max(lo, Math.floor(v)));
  };
  var s = {
    maxDays: n(0, 1, SB_CEILINGS.maxDays),
    maxBackdateDays: n(1, 0, SB_CEILINGS.maxBackdateDays),
    maxOrders: n(2, 1, SB_CEILINGS.maxOrders),
    maxValue: n(3, 1, SB_CEILINGS.maxValue),
    remindAfter: n(4, 1, SB_CEILINGS.minutes),
    escalateAfter: n(5, 1, SB_CEILINGS.minutes)
  };
  cache.put('sb_settings', JSON.stringify(s), 300);
  return s;
}

// ---------------- Standby Requests tab ----------------
function getOrCreateStandbySheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(STANDBY_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(STANDBY_SHEET_NAME);
    sheet.getRange(1, 1, 1, SB_HEADERS.length).setValues([SB_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    ensureColumns_(sheet, SB_HEADERS.length);
  }
  return sheet;
}

function sbCol_(name) {
  var i = SB_HEADERS.indexOf(name);
  if (i === -1) throw new Error('Unknown standby column: ' + name);
  return i;
}

function readStandby_() {
  var sheet = getOrCreateStandbySheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, SB_HEADERS.length).getValues().map(function (r, i) {
    var g = function (n) { return r[sbCol_(n)]; };
    return {
      row: i + 2,
      requestId: String(g('Request ID') || ''),
      requestedAtMs: sbMs_(g('Requested At')),
      trackerId: String(g('Tracker ID') || ''),
      institution: String(g('Institution') || ''),
      requestedBy: String(g('Requested By') || '').toUpperCase(),
      requestedByName: String(g('Requested By Name') || ''),
      reason: String(g('Reason') || ''),
      note: String(g('Note') || ''),
      reportedBy: String(g('Reported By (Ops)') || ''),
      fromYmd: sbYmd_(g('Standby From')),
      requestedResumeYmd: sbYmd_(g('Requested Resume Date')),
      approvedResumeYmd: sbYmd_(g('Approved Resume Date')),
      orderValue: Number(g('Order Value')) || 0,
      status: String(g('Status') || ''),
      decidedBy: String(g('Decided By') || ''),
      decidedAtMs: sbMs_(g('Decided At')),
      directorDecision: String(g('Director Decision') || ''),
      directorDecidedAtMs: sbMs_(g('Director Decided At')),
      statusBefore: String(g('Status Before Standby') || ''),
      startedAtMs: sbMs_(g('Started At')),
      endedAtMs: sbMs_(g('Ended At')),
      endedHow: String(g('Ended How') || ''),
      backdatedDays: Number(g('Backdated Days')) || 0,
      alertsSent: String(g('Alerts Sent') || ''),
      history: String(g('History') || '')
    };
  }).filter(function (r) { return r.requestId; });
}

function sbWrite_(row, fields) {
  var sheet = getOrCreateStandbySheet_();
  Object.keys(fields).forEach(function (k) { sheet.getRange(row, sbCol_(k) + 1).setValue(fields[k]); });
}

/** Appends a timestamped line to the request's History cell value (returns the new text). */
function sbHistory_(r, text) {
  r.history = (r.history ? r.history + ' | ' : '') + sbStamp_() + ' ' + text;
  return r.history;
}

function sbOpenFor_(list, trackerId) {
  var t = String(trackerId).toLowerCase();
  var open = list.filter(function (x) {
    return x.trackerId.toLowerCase() === t && (x.status === 'Pending' || x.status === 'Pending Director' || x.status === 'Active');
  });
  return open.length ? open[open.length - 1] : null;
}
function sbActive_(list) { return list.filter(function (x) { return x.status === 'Active'; }); }
function sbFind_(list, requestId) { return list.filter(function (x) { return x.requestId === String(requestId || ''); })[0] || null; }

function sbOrderFields_(sheet, row) {
  return getRowFields(sheet, row, ['Tracker ID', 'Institution / Customer', 'Status', 'Total Order Value', 'Advance Received',
    'Verified Date', 'Sent to Ops Timestamp', 'Received by Ops Timestamp', 'Vehicle Confirmed Timestamp']);
}

/** The latest moment the order was worked on (or came off an earlier standby). A standby can't start before this. */
function sbEarliestStartMs_(f, list) {
  var ms = 0;
  ['Verified Date', 'Sent to Ops Timestamp', 'Received by Ops Timestamp', 'Vehicle Confirmed Timestamp'].forEach(function (k) {
    var m = sbMs_(f[k]);
    if (m && m <= Date.now() && m > ms) ms = m;
  });
  var t = String(f['Tracker ID']).toLowerCase();
  list.forEach(function (x) { if (x.trackerId.toLowerCase() === t && x.endedAtMs && x.endedAtMs > ms) ms = x.endedAtMs; });
  return ms;
}

/**
 * Date rules shared by request and approval. refYmd is the day the request
 * was raised -- backdating is measured from then, not from the approval day.
 */
function sbCheckDates_(fromYmd, resumeYmd, earliestMs, refYmd) {
  var today = todayYmd_();
  if (!sbIsYmd_(fromYmd)) throw new Error('Choose the date the customer delay started.');
  if (!sbIsYmd_(resumeYmd)) throw new Error('Choose the date the customer expects to be ready (the resume date).');
  if (fromYmd > refYmd) throw new Error('The standby can\u2019t start in the future \u2013 raise it on the day the delay starts.');
  var earliestYmd = earliestMs ? sbYmd_(new Date(earliestMs)) : '';
  if (earliestYmd && fromYmd < earliestYmd) {
    throw new Error('The standby can\u2019t start before ' + fmtYmd_(earliestYmd) + ' \u2013 the order was still being worked on until then.');
  }
  if (resumeYmd <= today) throw new Error('The resume date must be after today.');
  var days = sbDaysBetween_(fromYmd, resumeYmd);
  var back = Math.max(0, sbDaysBetween_(fromYmd, refYmd));
  if (days > SB_CEILINGS.maxDays) throw new Error('A standby can\u2019t be longer than ' + SB_CEILINGS.maxDays + ' days. Ask for a shorter period and request again if needed.');
  if (back > SB_CEILINGS.maxBackdateDays) throw new Error('A standby can\u2019t start more than ' + SB_CEILINGS.maxBackdateDays + ' days back.');
  return { days: days, backdatedDays: back };
}

/** Why this standby would need a director (empty list = an admin can approve it). */
function sbDirectorReasons_(days, back, orderValue, trackerId, list, s) {
  var reasons = [];
  if (days > s.maxDays) reasons.push(days + ' days on standby (limit ' + s.maxDays + ')');
  if (back > s.maxBackdateDays) reasons.push('started ' + back + ' day' + (back === 1 ? '' : 's') + ' back (limit ' + s.maxBackdateDays + ')');
  var t = String(trackerId).toLowerCase();
  var others = sbActive_(list).filter(function (x) { return x.trackerId.toLowerCase() !== t; });
  var value = others.reduce(function (sum, x) { return sum + x.orderValue; }, 0);
  if (others.length + 1 > s.maxOrders) reasons.push('would make ' + (others.length + 1) + ' orders on standby (limit ' + s.maxOrders + ')');
  if (value + orderValue > s.maxValue) reasons.push('would put ' + sbRupees_(value + orderValue) + ' on standby (limit ' + sbRupees_(s.maxValue) + ')');
  return reasons;
}

function sbUsage_(list) {
  var act = sbActive_(list);
  var s = getStandbySettings_();
  return {
    count: act.length, value: act.reduce(function (sum, x) { return sum + x.orderValue; }, 0),
    maxOrders: s.maxOrders, maxValue: s.maxValue, maxDays: s.maxDays, maxBackdateDays: s.maxBackdateDays
  };
}

/** Admin/Director-chosen resume date: blank keeps the current one; otherwise it may only be earlier. */
function sbPickResume_(input, current) {
  var v = String(input || '').trim();
  if (!v) return current;
  if (!sbIsYmd_(v)) throw new Error('Enter the resume date as a date.');
  if (current && v > current) throw new Error('You can only shorten a standby (resume earlier than ' + fmtYmd_(current) + '), not extend it.');
  return v;
}

/** Puts the order on standby. Caller holds the script lock and has validated everything. */
function sbActivate_(r, sheet, row, f, resumeYmd, list, histText) {
  var startMs = Math.max(sbYmdToDate_(r.fromYmd).getTime(), sbEarliestStartMs_(f, list));
  var start = new Date(Math.min(startMs, Date.now()));
  setRowFields(sheet, row, { 'Status': STATUS_STANDBY });
  sbWrite_(r.row, {
    'Status': 'Active', 'Status Before Standby': f['Status'], 'Started At': start,
    'Approved Resume Date': sbYmdToDate_(resumeYmd), 'History': sbHistory_(r, histText)
  });
}

/**
 * Ends a standby and puts the order back where it was. A courier order that
 * was held for its balance goes straight to Ops if the balance was cleared
 * (or dispatch with balance was approved) while it was on standby -- the
 * same release recordBalancePayment_/decidePaymentException_ would have done.
 * Returns the status the order went back to ('' if it had already moved).
 */
function sbEnd_(r, how) {
  var sheet = getSheet();
  var row = findRowByTrackerId(sheet, r.trackerId);
  var restored = '';
  if (row !== -1) {
    var cur = getRowFields(sheet, row, ['Status', 'Total Order Value', 'Advance Received']);
    if (cur['Status'] === STATUS_STANDBY) {
      var back = SB_ELIGIBLE.indexOf(r.statusBefore) !== -1 ? r.statusBefore : 'Sent to Ops';
      var fields = {};
      if (back === STATUS_HOLD_BALANCE &&
          (computeBalanceDue(cur['Total Order Value'], cur['Advance Received']) <= 0 || isPaymentExceptionApproved_(r.trackerId, PX_DISPATCH))) {
        back = 'Sent to Ops';
        fields['Sent to Ops Timestamp'] = new Date();
      }
      fields['Status'] = back;
      setRowFields(sheet, row, fields);
      restored = back;
    }
  }
  sbWrite_(r.row, {
    'Status': 'Ended', 'Ended At': new Date(), 'Ended How': how,
    'History': sbHistory_(r, how + (restored ? ' \u2013 back to "' + restored + '"' : ''))
  });
  return restored;
}

/** Called by the stage actions in Code.js: nothing moves an order on while it's on standby. */
function assertNotOnStandby_(status) {
  if (status === STATUS_STANDBY) {
    throw new Error('This order is on standby (customer delay). Resume it first \u2013 look it up on the Accounts page and use "Resume now".');
  }
}

// ---------------- Emails ----------------
function sbEmailsFor_(staffMap, roles) {
  var out = [];
  Object.keys(staffMap).forEach(function (k) {
    var s = staffMap[k];
    if (s.active && roles.indexOf(s.role) !== -1 && /@/.test(s.email) && out.indexOf(s.email) === -1) out.push(s.email);
  });
  return out;
}

function sbMail_(to, cc, subject, innerHtml, link, linkLabel) {
  to = (to || []).filter(function (e) { return /@/.test(e); });
  cc = (cc || []).filter(function (e) { return /@/.test(e) && to.indexOf(e) === -1; });
  if (!to.length) { to = cc; cc = []; }
  if (!to.length) { Logger.log('No email on file for: ' + subject); return false; }
  try {
    var opts = {
      to: to.join(','), subject: subject,
      htmlBody: innerHtml + (link ? '<p><a href="' + link + '" style="background:#1F3864;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:600;">' + sbEsc_(linkLabel || 'Open') + '</a></p>' : '') +
        '<p style="color:#888;font-size:11px;">Automatic message from the ICF Order Tracker.</p>'
    };
    if (cc.length) opts.cc = cc.join(',');
    MailApp.sendEmail(opts);
    return true;
  } catch (e) {
    Logger.log('Standby email failed: ' + e);
    return false;
  }
}

function sbSummaryHtml_(r, resumeYmd) {
  return '<p>Order: <b>' + sbEsc_(r.trackerId) + '</b> \u2013 ' + sbEsc_(r.institution) + ' (' + sbRupees_(r.orderValue) + ')<br>' +
    'Reason: ' + sbEsc_(r.reason) + (r.note ? ' \u2013 ' + sbEsc_(r.note) : '') + '<br>' +
    'Reported by (Ops): ' + sbEsc_(r.reportedBy) + '<br>' +
    'Standby from ' + sbEsc_(fmtYmd_(r.fromYmd)) + ' to ' + sbEsc_(fmtYmd_(resumeYmd || r.requestedResumeYmd)) + '</p>';
}

// ================================================================
// API -- Accounts
// ================================================================
/** Accounts: form = { trackerId, reason, note, reportedBy, standbyFrom, resumeDate } (dates yyyy-MM-dd). */
function requestStandby_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var reason = String(form.reason || '').trim();
  if (SB_REASONS.indexOf(reason) === -1) throw new Error('Choose the reason for the delay.');
  var note = String(form.note || '').trim();
  if (reason === 'Other' && !note) throw new Error('Describe the reason in the note.');
  var reportedBy = String(form.reportedBy || '').trim();
  if (!reportedBy) throw new Error('Enter the name of the ops person who reported the delay.');

  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String(form.trackerId || ''));
  if (row === -1) throw new Error('Tracker ID not found.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var requestId, rec, prelim;
  try {
    var f = sbOrderFields_(sheet, row);
    var trackerId = String(f['Tracker ID']);
    if (SB_ELIGIBLE.indexOf(f['Status']) === -1) {
      throw new Error(f['Status'] === STATUS_STANDBY ? 'This order is already on standby.'
        : 'Standby is only for orders with Ops that haven\u2019t been dispatched (this one is at "' + f['Status'] + '").');
    }
    var list = readStandby_();
    var open = sbOpenFor_(list, trackerId);
    if (open) throw new Error('There is already a standby request for this order (' + open.requestId + ', ' + open.status.toLowerCase() + ').');
    var from = String(form.standbyFrom || '').trim();
    var resume = String(form.resumeDate || '').trim();
    var chk = sbCheckDates_(from, resume, sbEarliestStartMs_(f, list), todayYmd_());
    var value = Number(f['Total Order Value']) || 0;
    prelim = sbDirectorReasons_(chk.days, chk.backdatedDays, value, trackerId, list, getStandbySettings_());

    requestId = 'SB-' + Utilities.formatDate(new Date(), sbTz_(), 'yyMMdd') + '-' + Utilities.getUuid().split('-')[0].slice(0, 4).toUpperCase();
    rec = {
      requestId: requestId, trackerId: trackerId, institution: String(f['Institution / Customer'] || ''),
      reason: reason, note: note, reportedBy: reportedBy, fromYmd: from, requestedResumeYmd: resume, orderValue: value, history: ''
    };
    var vals = SB_HEADERS.map(function () { return ''; });
    vals[sbCol_('Request ID')] = requestId;
    vals[sbCol_('Requested At')] = new Date();
    vals[sbCol_('Tracker ID')] = trackerId;
    vals[sbCol_('Institution')] = rec.institution;
    vals[sbCol_('Requested By')] = me.code;
    vals[sbCol_('Requested By Name')] = me.name;
    vals[sbCol_('Reason')] = reason;
    vals[sbCol_('Note')] = note;
    vals[sbCol_('Reported By (Ops)')] = reportedBy;
    vals[sbCol_('Standby From')] = sbYmdToDate_(from);
    vals[sbCol_('Requested Resume Date')] = sbYmdToDate_(resume);
    vals[sbCol_('Order Value')] = value;
    vals[sbCol_('Status')] = 'Pending';
    vals[sbCol_('Backdated Days')] = chk.backdatedDays;
    vals[sbCol_('History')] = sbStamp_() + ' Requested by ' + me.name + ' (' + chk.days + ' days)';
    getOrCreateStandbySheet_().appendRow(vals);
  } finally {
    lock.releaseLock();
  }

  var url = appUrl_();
  var emailed = emailAdmins_('Standby request: ' + rec.trackerId + ' \u2013 ' + rec.reason,
    '<p><b>' + sbEsc_(me.name) + '</b> (Accounts) is asking to put an order on <b>standby</b> because of a customer-side delay.</p>' +
    sbSummaryHtml_(rec) +
    (prelim.length ? '<p style="color:#9a5b00;">If approved, this will also need a director: ' + sbEsc_(prelim.join('; ')) + '.</p>' : '') +
    (url ? '<p><a href="' + url + '?page=admin&req=' + encodeURIComponent(requestId) + '" style="background:#1F3864;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:600;">Review request</a></p>' : '') +
    '<p style="color:#666;font-size:12px;">Request ' + sbEsc_(requestId) + '</p>');
  var cfg = getAlertSettings_();
  var approver = cfg.firstApprover ? getStaffMap_(false)[cfg.firstApprover] : null;
  return {
    trackerId: rec.trackerId, requestId: requestId, emailed: emailed, needsDirector: prelim.length > 0, directorReasons: prelim,
    callName: approver ? approver.name : '', callPhone: approver ? staffPhone_(approver.code) : ''
  };
}

/** Accounts / Admin / Director: the customer is ready early. form = { trackerId, note } */
function resumeStandby_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String(form.trackerId || ''));
  if (row === -1) throw new Error('Tracker ID not found.');
  var trackerId = String(getRowFields(sheet, row, ['Tracker ID'])['Tracker ID']);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var r, restored;
  try {
    var list = readStandby_();
    r = list.filter(function (x) { return x.status === 'Active' && x.trackerId.toLowerCase() === trackerId.toLowerCase(); }).pop();
    if (!r) throw new Error('This order isn\u2019t on standby.');
    var note = String(form.note || '').trim();
    restored = sbEnd_(r, 'Resumed early by ' + me.name + (note ? ' (' + note + ')' : ''));
  } finally {
    lock.releaseLock();
  }
  return { trackerId: trackerId, requestId: r.requestId, restoredStatus: restored };
}

/** Accounts side panel: orders on standby or waiting for a standby decision (+ declines from the last 3 days). */
function getStandbyPanel_() {
  var list = readStandby_();
  var cutoff = Date.now() - 3 * 86400000;
  var latest = {};
  list.forEach(function (r) { latest[r.trackerId.toLowerCase()] = r; });
  var out = [];
  Object.keys(latest).forEach(function (k) {
    var r = latest[k];
    if (r.status === 'Ended') return;
    if (r.status === 'Declined' && !(r.decidedAtMs && r.decidedAtMs > cutoff) && !(r.directorDecidedAtMs && r.directorDecidedAtMs > cutoff)) return;
    out.push(sbItem_(r));
  });
  var rank = { Active: 0, 'Pending Director': 1, Pending: 2, Declined: 3 };
  out.sort(function (a, b) { return (rank[a.status] - rank[b.status]) || ((a.resumeYmd || '') < (b.resumeYmd || '') ? -1 : 1); });
  return { items: out, usage: sbUsage_(list), today: todayYmd_() };
}

/** Browser-safe view of one request. */
function sbItem_(r) {
  var tz = sbTz_();
  var fmt = function (ms) { return ms ? Utilities.formatDate(new Date(ms), tz, 'dd-MMM, hh:mm a') : ''; };
  var resume = r.approvedResumeYmd || r.requestedResumeYmd;
  return {
    requestId: r.requestId, trackerId: r.trackerId, institution: r.institution, status: r.status,
    reason: r.reason, note: r.note, reportedBy: r.reportedBy, requestedBy: r.requestedBy, requestedByName: r.requestedByName,
    requestedAt: fmt(r.requestedAtMs), requestedAtMs: r.requestedAtMs || 0,
    fromYmd: r.fromYmd, from: fmtYmd_(r.fromYmd), requestedResumeYmd: r.requestedResumeYmd, requestedResume: fmtYmd_(r.requestedResumeYmd),
    resumeYmd: resume, resume: fmtYmd_(resume), approvedResumeYmd: r.approvedResumeYmd,
    days: (r.fromYmd && resume) ? sbDaysBetween_(r.fromYmd, resume) : null,
    daysLeft: (r.status === 'Active' && resume) ? sbDaysBetween_(todayYmd_(), resume) : null,
    orderValue: r.orderValue, decidedBy: r.decidedBy, decidedAt: fmt(r.decidedAtMs), directorDecision: r.directorDecision,
    statusBefore: r.statusBefore, startedAt: fmt(r.startedAtMs), endedAt: fmt(r.endedAtMs), endedHow: r.endedHow,
    backdatedDays: r.backdatedDays, history: r.history
  };
}

/** Added to lookupOrder_ (never throws): the standby picture for one order. */
function standbyInfoForOrder_(trackerId, status) {
  try {
    var list = readStandby_();
    var t = String(trackerId).toLowerCase();
    var mine = list.filter(function (x) { return x.trackerId.toLowerCase() === t; });
    var open = sbOpenFor_(list, trackerId);
    var lastClosed = mine.filter(function (x) { return x.status === 'Declined' || x.status === 'Ended'; }).pop() || null;
    var s = getStandbySettings_();
    var earliest = '';
    if (SB_ELIGIBLE.indexOf(status) !== -1) {
      var sheet = getSheet();
      var row = findRowByTrackerId(sheet, String(trackerId));
      if (row !== -1) {
        var ms = sbEarliestStartMs_(sbOrderFields_(sheet, row), list);
        earliest = ms ? sbYmd_(new Date(ms)) : '';
      }
    }
    var today = todayYmd_();
    var floor = sbAddDays_(today, -SB_CEILINGS.maxBackdateDays);
    return {
      eligible: SB_ELIGIBLE.indexOf(status) !== -1 && !open,
      onStandby: status === STATUS_STANDBY,
      open: open ? sbItem_(open) : null,
      last: lastClosed ? sbItem_(lastClosed) : null,
      timesOnStandby: mine.filter(function (x) { return x.status === 'Active' || x.status === 'Ended'; }).length,
      today: today,
      earliestFromYmd: earliest && earliest > floor ? earliest : floor,
      maxDays: s.maxDays, maxBackdateDays: s.maxBackdateDays, ceilingDays: SB_CEILINGS.maxDays,
      reasons: SB_REASONS
    };
  } catch (e) {
    Logger.log('standbyInfoForOrder_ failed: ' + e);
    return null;
  }
}

// ================================================================
// API -- Admin
// ================================================================
/** Admin page data: waiting, with the directors, active, recent. */
function getStandbyAdmin_() {
  var list = readStandby_();
  var s = getStandbySettings_();
  var pending = list.filter(function (r) { return r.status === 'Pending'; }).map(function (r) {
    var it = sbItem_(r);
    var refYmd = r.requestedAtMs ? sbYmd_(new Date(r.requestedAtMs)) : todayYmd_();
    var days = sbDaysBetween_(r.fromYmd, r.requestedResumeYmd);
    var back = Math.max(0, sbDaysBetween_(r.fromYmd, refYmd));
    it.directorReasons = sbDirectorReasons_(days, back, r.orderValue, r.trackerId, list, s);
    return it;
  });
  var withDirector = list.filter(function (r) { return r.status === 'Pending Director'; }).map(sbItem_);
  var active = sbActive_(list).map(sbItem_).sort(function (a, b) { return a.resumeYmd < b.resumeYmd ? -1 : 1; });
  var recent = list.filter(function (r) { return r.status === 'Declined' || r.status === 'Ended'; }).slice(-20).reverse().map(sbItem_);
  return { pending: pending, withDirector: withDirector, active: active, recent: recent, usage: sbUsage_(list), today: todayYmd_(), tomorrow: sbAddDays_(todayYmd_(), 1) };
}

/** Admin: form = { requestId, approve, resumeDate (optional, earlier only), note } */
function decideStandby_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var r, out, resume, reasons = [];
  try {
    var list = readStandby_();
    r = sbFind_(list, form.requestId);
    if (!r) throw new Error('Request not found.');
    if (r.status !== 'Pending') throw new Error('This request is already ' + r.status.toLowerCase() + (r.decidedBy ? ' (' + r.decidedBy + ')' : '') + '.');
    if (r.requestedBy === me.code) throw new Error('You raised this request yourself, so another admin has to decide it.');
    var note = String(form.note || '').trim();
    if (!form.approve) {
      sbWrite_(r.row, { 'Status': 'Declined', 'Decided By': sbWho_(me), 'Decided At': new Date(),
        'History': sbHistory_(r, 'Declined by ' + me.name + (note ? ' (' + note + ')' : '')) });
      out = { requestId: r.requestId, trackerId: r.trackerId, declined: true };
    } else {
      var sheet = getSheet();
      var row = findRowByTrackerId(sheet, r.trackerId);
      if (row === -1) throw new Error('Order not found in the tracker.');
      var f = sbOrderFields_(sheet, row);
      if (SB_ELIGIBLE.indexOf(f['Status']) === -1) throw new Error('The order is now at "' + f['Status'] + '", so it can\u2019t go on standby. Decline this request.');
      resume = sbPickResume_(form.resumeDate, r.requestedResumeYmd);
      var refYmd = r.requestedAtMs ? sbYmd_(new Date(r.requestedAtMs)) : todayYmd_();
      var chk = sbCheckDates_(r.fromYmd, resume, sbEarliestStartMs_(f, list), refYmd);
      reasons = sbDirectorReasons_(chk.days, chk.backdatedDays, r.orderValue, r.trackerId, list, getStandbySettings_());
      var shortened = resume !== r.requestedResumeYmd ? ', resume brought forward to ' + fmtYmd_(resume) : '';
      sbWrite_(r.row, { 'Approved Resume Date': sbYmdToDate_(resume), 'Decided By': sbWho_(me), 'Decided At': new Date(), 'Backdated Days': chk.backdatedDays });
      if (reasons.length) {
        sbWrite_(r.row, { 'Status': 'Pending Director',
          'History': sbHistory_(r, 'Approved by ' + me.name + shortened + (note ? ' (' + note + ')' : '') + ' \u2013 sent to the directors: ' + reasons.join('; ')) });
        out = { requestId: r.requestId, trackerId: r.trackerId, sentToDirector: true, reasons: reasons };
      } else {
        sbActivate_(r, sheet, row, f, resume, list, 'Approved by ' + me.name + shortened + (note ? ' (' + note + ')' : '') + ' \u2013 on standby');
        out = { requestId: r.requestId, trackerId: r.trackerId, activated: true, resume: fmtYmd_(resume) };
      }
    }
  } finally {
    lock.releaseLock();
  }
  sbNotifyDecision_(r, out, me, resume, reasons);
  return out;
}

/** Admin / Director: bring an active standby's resume date forward. form = { requestId, resumeDate, note } */
function shortenStandby_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var r, resume;
  try {
    var list = readStandby_();
    r = sbFind_(list, form.requestId);
    if (!r || r.status !== 'Active') throw new Error('That standby isn\u2019t active any more.');
    resume = String(form.resumeDate || '').trim();
    if (!sbIsYmd_(resume)) throw new Error('Choose the new resume date.');
    if (resume >= r.approvedResumeYmd) throw new Error('The new date must be earlier than ' + fmtYmd_(r.approvedResumeYmd) + '. To end it today, use "Resume now" on the Accounts page.');
    if (resume <= todayYmd_()) throw new Error('The new date must be after today. To end it today, use "Resume now" on the Accounts page.');
    var note = String(form.note || '').trim();
    sbWrite_(r.row, { 'Approved Resume Date': sbYmdToDate_(resume),
      'History': sbHistory_(r, 'Shortened by ' + me.name + ': resume ' + fmtYmd_(r.approvedResumeYmd) + ' \u2192 ' + fmtYmd_(resume) + (note ? ' (' + note + ')' : '')) });
  } finally {
    lock.releaseLock();
  }
  var staffMap = getStaffMap_(false);
  var requester = staffMap[r.requestedBy];
  var url = appUrl_();
  sbMail_(sbEmailsFor_(staffMap, ['Accounts']).concat(requester && /@/.test(requester.email) ? [requester.email] : []),
    sbEmailsFor_(staffMap, ['Admin']),
    'Standby shortened: ' + r.trackerId + ' now resumes ' + fmtYmd_(resume),
    '<p><b>' + sbEsc_(me.name) + '</b> brought this standby forward. The order goes live again on <b>' + sbEsc_(fmtYmd_(resume)) + '</b> \u2013 please let the ops person (' + sbEsc_(r.reportedBy) + ') know.</p>' +
    sbSummaryHtml_(r, resume), url ? url + '?page=accounts' : '', 'Open Accounts page');
  return { requestId: r.requestId, trackerId: r.trackerId, resume: fmtYmd_(resume) };
}

// ================================================================
// API -- Directors
// ================================================================
/** Dashboard panel for directors: standby requests over the limits + payment approvals. */
function getDirectorPanel_() {
  var list = readStandby_();
  var standby = list.filter(function (r) { return r.status === 'Pending Director'; }).map(sbItem_);
  var tz = sbTz_();
  var orders = orderSnapshot_();
  var payments = readPaymentExceptions_().filter(function (r) { return r.status === 'Pending'; }).map(function (r) {
    var o = orders[r.trackerId.toLowerCase()] || {};
    return {
      requestId: r.requestId, trackerId: r.trackerId, institution: o.institution || '', typeLabel: PX_LABELS[r.type] || r.type,
      amountNote: r.amountNote, reason: r.reason, requestedByName: r.requestedByName,
      requestedAt: r.requestedAtMs ? Utilities.formatDate(new Date(r.requestedAtMs), tz, 'dd-MMM, hh:mm a') : '',
      escalated: r.alertsSent.indexOf('Escalated') !== -1
    };
  });
  var url = appUrl_();
  return { standby: standby, payments: payments, usage: sbUsage_(list), settingsUrl: url ? url + '?page=settings' : '', today: todayYmd_(), tomorrow: sbAddDays_(todayYmd_(), 1) };
}

/** Director: form = { requestId, approve, resumeDate (optional, earlier only), note } */
function decideStandbyDirector_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var r, out, resume;
  try {
    var list = readStandby_();
    r = sbFind_(list, form.requestId);
    if (!r) throw new Error('Request not found.');
    if (r.status !== 'Pending Director') throw new Error('This request is already ' + r.status.toLowerCase() + '.');
    var note = String(form.note || '').trim();
    if (!form.approve) {
      sbWrite_(r.row, { 'Status': 'Declined', 'Director Decision': 'Declined by ' + sbWho_(me), 'Director Decided At': new Date(),
        'History': sbHistory_(r, 'Declined by director ' + me.name + (note ? ' (' + note + ')' : '')) });
      out = { requestId: r.requestId, trackerId: r.trackerId, declined: true };
    } else {
      var sheet = getSheet();
      var row = findRowByTrackerId(sheet, r.trackerId);
      if (row === -1) throw new Error('Order not found in the tracker.');
      var f = sbOrderFields_(sheet, row);
      if (SB_ELIGIBLE.indexOf(f['Status']) === -1) throw new Error('The order is now at "' + f['Status'] + '", so it can\u2019t go on standby. Decline this request.');
      resume = sbPickResume_(form.resumeDate, r.approvedResumeYmd || r.requestedResumeYmd);
      var refYmd = r.requestedAtMs ? sbYmd_(new Date(r.requestedAtMs)) : todayYmd_();
      sbCheckDates_(r.fromYmd, resume, sbEarliestStartMs_(f, list), refYmd); // hard limits still apply
      sbWrite_(r.row, { 'Director Decision': 'Approved by ' + sbWho_(me), 'Director Decided At': new Date() });
      sbActivate_(r, sheet, row, f, resume, list, 'Approved by director ' + me.name +
        (resume !== (r.approvedResumeYmd || r.requestedResumeYmd) ? ', resume brought forward to ' + fmtYmd_(resume) : '') + (note ? ' (' + note + ')' : '') + ' \u2013 on standby');
      out = { requestId: r.requestId, trackerId: r.trackerId, activated: true, resume: fmtYmd_(resume) };
    }
  } finally {
    lock.releaseLock();
  }
  sbNotifyDecision_(r, out, me, resume, []);
  return out;
}

/** Director: decide a payment exception from the dashboard (same rules as the Admin page). */
function decidePaymentAsDirector_(form) {
  return decidePaymentException_(form);
}

function sbNotifyDecision_(r, out, me, resume, reasons) {
  try {
    var staffMap = getStaffMap_(false);
    var requester = staffMap[r.requestedBy];
    var url = appUrl_();
    if (out.sentToDirector) {
      sbMail_(sbEmailsFor_(staffMap, ['Director']), [],
        'Director approval needed: standby for ' + r.trackerId,
        '<p><b>' + sbEsc_(me.name) + '</b> approved this standby, but it goes past a limit you set, so it needs a director: <b>' + sbEsc_(reasons.join('; ')) + '</b>.</p>' +
        sbSummaryHtml_(r, resume), url ? url + '?page=dashboard' : '', 'Open the dashboard');
    }
    if (requester && /@/.test(requester.email)) {
      var line = out.declined ? 'was declined by ' + me.name + '. The order stays live.'
        : out.sentToDirector ? 'was approved by ' + me.name + ' and now needs a director (' + reasons.join('; ') + '). The order stays live until then.'
        : 'was approved by ' + me.name + '. The order is on standby until ' + fmtYmd_(resume) + ' \u2013 please let ' + r.reportedBy + ' know.';
      sbMail_([requester.email], [], 'Standby ' + (out.declined ? 'declined' : out.sentToDirector ? 'with the directors' : 'approved') + ': ' + r.trackerId,
        '<p>The standby request for <b>' + sbEsc_(r.trackerId) + '</b> (' + sbEsc_(r.institution) + ') ' + sbEsc_(line) + '</p>', '', '');
    }
  } catch (e) {
    Logger.log('sbNotifyDecision_ failed: ' + e);
  }
}

// ================================================================
// Owner Dashboard data
// ================================================================
/** Every approved standby period, for net TAT, the standby section and the director panel. */
function getStandbyDashboard_() {
  var list = readStandby_();
  var records = list.filter(function (r) { return (r.status === 'Active' || r.status === 'Ended') && r.startedAtMs; }).map(function (r) {
    return {
      trackerId: r.trackerId, institution: r.institution, reason: r.reason, startMs: r.startedAtMs,
      endMs: r.status === 'Active' ? null : (r.endedAtMs || r.startedAtMs), active: r.status === 'Active',
      resume: fmtYmd_(r.approvedResumeYmd), resumeYmd: r.approvedResumeYmd, backdatedDays: r.backdatedDays,
      orderValue: r.orderValue, directorApproved: !!r.directorDecision, endedHow: r.endedHow
    };
  });
  return {
    records: records, usage: sbUsage_(list), today: todayYmd_(),
    pending: list.filter(function (r) { return r.status === 'Pending'; }).length,
    withDirector: list.filter(function (r) { return r.status === 'Pending Director'; }).length
  };
}

// ================================================================
// Timers -- run from checkApprovalAlerts() (office hours, every 10 min)
// ================================================================
/** The approval-alert job for pending standby requests (reminder + escalation), same shape as the others. */
function standbyAlertJob_() {
  var s = getStandbySettings_();
  return {
    list: readStandby_(), sheet: getOrCreateStandbySheet_(), col: sbCol_('Alerts Sent') + 1,
    remind: s.remindAfter, escalate: s.escalateAfter,
    label: function (r) { return 'Standby request \u2013 ' + r.trackerId; },
    detail: function (r) {
      return sbEsc_(r.institution) + ': ' + sbEsc_(r.reason) + (r.note ? ' \u2013 ' + sbEsc_(r.note) : '') +
        '<br>Standby ' + sbEsc_(fmtYmd_(r.fromYmd)) + ' to ' + sbEsc_(fmtYmd_(r.requestedResumeYmd)) + '. Asked by ' + sbEsc_(r.requestedByName) + '.';
    }
  };
}

/** Next working day after ymd, by the Settings tab's working days and holidays. */
function sbNextWorkingYmd_(ymd, cfg) {
  var d = ymd;
  for (var i = 0; i < 14; i++) {
    d = sbAddDays_(d, 1);
    var dow = Number(Utilities.formatDate(sbYmdToDate_(d), sbTz_(), 'u')) % 7; // 1=Mon..7=Sun -> 0=Sun
    if (cfg.workingDays.indexOf(dow) !== -1 && cfg.holidays.indexOf(d) === -1) return d;
  }
  return sbAddDays_(ymd, 1);
}

/**
 * Auto-resume on the resume date, and the nudge on the last working day
 * before it. Only runs while the office is open (the caller checks), so an
 * order whose resume date is a Sunday resumes when the office opens Monday.
 * Returns the number of emails sent.
 */
function processStandbyTimers_(now, staffMap, cfg) {
  var list = readStandby_();
  var today = todayYmd_();
  var nextWorking = sbNextWorkingYmd_(today, cfg);
  var sheet = getOrCreateStandbySheet_();
  var alertsCol = sbCol_('Alerts Sent') + 1;
  var accounts = sbEmailsFor_(staffMap, ['Accounts']);
  var admins = sbEmailsFor_(staffMap, ['Admin']);
  var url = appUrl_();
  var sent = 0;
  list.forEach(function (r) {
    if (r.status !== 'Active' || !r.approvedResumeYmd) return;
    var requester = staffMap[r.requestedBy];
    var to = accounts.concat(requester && /@/.test(requester.email) ? [requester.email] : []);
    if (r.approvedResumeYmd <= today) {
      var restored = sbEnd_(r, 'Resumed automatically on ' + fmtYmd_(today));
      logActivity_({ code: 'SYSTEM', name: 'Standby timer', role: '' }, 'Standby ended (resume date)', r.trackerId, r.requestId + (restored ? ' \u2013 back to ' + restored : ''));
      if (sbMail_(to, admins, 'Back to live: ' + r.trackerId + ' \u2013 standby ended',
        '<p>The standby on this order ended today and it is <b>live again</b>' + (restored ? ' at "' + sbEsc_(restored) + '"' : '') +
        '. Its turnaround clock is running. Check with ' + sbEsc_(r.reportedBy) + ' that the customer is ready; if not, raise a new standby request.</p>' +
        sbSummaryHtml_(r, r.approvedResumeYmd), url ? url + '?page=accounts' : '', 'Open Accounts page')) sent++;
    } else if (r.approvedResumeYmd <= nextWorking && r.alertsSent.indexOf('Nudge ' + r.approvedResumeYmd) === -1) {
      if (sbMail_(to, admins, 'Standby ends ' + fmtYmd_(r.approvedResumeYmd) + ': ' + r.trackerId,
        '<p>This order comes off standby on <b>' + sbEsc_(fmtYmd_(r.approvedResumeYmd)) + '</b> and will show as live again. ' +
        'Please ask ' + sbEsc_(r.reportedBy) + ' to confirm with the customer today.</p>' + sbSummaryHtml_(r, r.approvedResumeYmd),
        url ? url + '?page=accounts' : '', 'Open Accounts page')) {
        markAlert_(sheet, r.row, alertsCol, r.alertsSent, 'Nudge ' + r.approvedResumeYmd + ' (' + sbStamp_() + ')');
        sent++;
      }
    }
  });
  return sent;
}

// ================================================================
// SETTINGS PAGE (?page=settings) -- Directors only
// ================================================================
/** Every row the Settings page shows, with how to edit and check it. */
function sbSettingsSchema_() {
  var kindOf = function (label) {
    if (label === 'Office opens' || label === 'Office closes') return 'time';
    if (label === 'Working days') return 'days';
    if (label === 'Holidays') return 'holidays';
    if (/\(staff code\)$/.test(label)) return 'staff';
    if (/\(office minutes\)$/.test(label)) return 'minutes';
    return 'text';
  };
  var groupOf = function (label) {
    if (/^Standby/.test(label)) return /^Standby approval/.test(label) ? 'Approval timings' : 'Standby limits';
    if (/\(staff code\)$/.test(label)) return 'Approvers';
    if (/\(office minutes\)$/.test(label)) return 'Approval timings';
    return 'Office hours';
  };
  var rows = SETTINGS_ROWS.map(function (r) { return { label: r[0], def: r[1], help: r[2], kind: kindOf(r[0]), group: groupOf(r[0]) }; });
  var lim = [[1, SB_CEILINGS.maxDays], [0, SB_CEILINGS.maxBackdateDays], [1, SB_CEILINGS.maxOrders], [1, SB_CEILINGS.maxValue]];
  SB_SETTINGS_ROWS.forEach(function (r, i) {
    var row = { label: r[0], def: r[1], help: r[2], kind: i < 4 ? (i === 3 ? 'money' : 'number') : 'minutes', group: groupOf(r[0]) };
    if (i < 4) { row.min = lim[i][0]; row.max = lim[i][1]; }
    rows.push(row);
  });
  return rows;
}

function getSettingsData_() {
  var map = sbReadSettingsMap_();
  var staffMap = getStaffMap_(true);
  var approvers = Object.keys(staffMap).map(function (k) { return staffMap[k]; })
    .filter(function (s) { return s.active && (s.role === 'Admin' || s.role === 'Director'); })
    .map(function (s) { return { code: s.code, name: s.name, role: s.role }; });
  var url = appUrl_();
  return {
    rows: sbSettingsSchema_().map(function (r) {
      var v = map[r.label.toLowerCase()];
      r.value = (v === undefined || v === '') ? r.def : v;
      r.saved = v !== undefined;
      return r;
    }),
    approvers: approvers, dashboardUrl: url ? url + '?page=dashboard' : ''
  };
}

/** Director: values = { label: value }. Checks everything first; writes nothing if anything is wrong. */
function saveSettings_(values) {
  values = values || {};
  var me = CURRENT_STAFF_;
  var schema = sbSettingsSchema_();
  var staffMap = getStaffMap_(true);
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var clean = {}, errors = [];
  schema.forEach(function (r) {
    if (!Object.prototype.hasOwnProperty.call(values, r.label)) return;
    var v = String(values[r.label] == null ? '' : values[r.label]).trim();
    try {
      if (r.kind === 'time') {
        var m = v.match(/^(\d{1,2})[:.](\d{2})$/);
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('enter a 24-hour time like 09:30');
        v = ('0' + Number(m[1])).slice(-2) + ':' + m[2];
      } else if (r.kind === 'days') {
        var picked = {};
        v.toLowerCase().split(/[^a-z]+/).forEach(function (d) {
          var i = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(d.slice(0, 3));
          if (i !== -1) picked[i] = true;
        });
        var order = [1, 2, 3, 4, 5, 6, 0].filter(function (i) { return picked[i]; });
        if (!order.length) throw new Error('choose at least one working day');
        v = order.map(function (i) { return DAY_NAMES[i]; }).join(', ');
      } else if (r.kind === 'holidays') {
        var parts = v ? v.split(/[,;\n]+/).map(function (t) { return t.trim(); }).filter(Boolean) : [];
        var ymds = parts.map(function (t) {
          var y = parseHolidayYmd_(t);
          if (!y) throw new Error('"' + t + '" isn\u2019t a date (use e.g. 02-Oct-2026)');
          return y;
        });
        ymds = ymds.filter(function (y, i) { return ymds.indexOf(y) === i; }).sort();
        v = ymds.map(function (y) { return fmtYmd_(y); }).join(', ');
      } else if (r.kind === 'staff') {
        v = v.toUpperCase();
        if (v) {
          var s = staffMap[v];
          if (!s || !s.active || (s.role !== 'Admin' && s.role !== 'Director')) throw new Error(v + ' isn\u2019t an active Admin or Director');
        }
      } else if (r.kind === 'minutes' || r.kind === 'number' || r.kind === 'money') {
        var n = Number(v.replace(/[,\s\u20b9]/g, ''));
        var lo = r.kind === 'minutes' ? 1 : r.min, hi = r.kind === 'minutes' ? SB_CEILINGS.minutes : r.max;
        if (v === '' || isNaN(n) || Math.floor(n) !== n) throw new Error('enter a whole number');
        if (n < lo || n > hi) throw new Error('must be between ' + lo + ' and ' + hi);
        v = String(n);
      }
      clean[r.label] = v;
    } catch (e) {
      errors.push(r.label + ': ' + e.message);
    }
  });
  var get = function (label) {
    if (Object.prototype.hasOwnProperty.call(clean, label)) return clean[label];
    var cur = sbReadSettingsMap_()[label.toLowerCase()];
    var def = schema.filter(function (r) { return r.label === label; })[0];
    return (cur === undefined || cur === '') ? (def ? def.def : '') : cur;
  };
  var toMin = function (t) { var m = String(t).match(/^(\d{1,2})[:.](\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  if (!errors.length) {
    var o = toMin(get('Office opens')), c = toMin(get('Office closes'));
    if (o !== null && c !== null && o >= c) errors.push('Office closes must be later than Office opens.');
    [['Payment approval: remind after (office minutes)', 'Payment approval: escalate after (office minutes)'],
     ['CRE access request: remind after (office minutes)', 'CRE access request: escalate after (office minutes)'],
     [SB_SETTINGS_ROWS[4][0], SB_SETTINGS_ROWS[5][0]]].forEach(function (p) {
      if (Number(get(p[0])) >= Number(get(p[1]))) errors.push('"' + p[1] + '" must be longer than "' + p[0] + '".');
    });
  }
  if (errors.length) throw new Error('Nothing was saved. ' + errors.join(' \u2022 '));

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'What it means']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  var changes = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var last = sheet.getLastRow();
    var labels = last >= 2 ? sheet.getRange(2, 1, last - 1, 2).getDisplayValues() : [];
    Object.keys(clean).forEach(function (label) {
      var idx = -1;
      for (var i = 0; i < labels.length; i++) if (String(labels[i][0]).trim().toLowerCase() === label.toLowerCase()) { idx = i; break; }
      if (idx === -1) {
        var def = schema.filter(function (r) { return r.label === label; })[0];
        var newRow = sheet.getLastRow() + 1;
        sheet.getRange(newRow, 2).setNumberFormat('@');
        sheet.getRange(newRow, 1, 1, 3).setValues([[label, clean[label], def ? def.help : '']]);
        labels.push([label, clean[label]]);
        changes.push(label + ': (new) ' + clean[label]);
      } else if (String(labels[idx][1]).trim() !== clean[label]) {
        var cell = sheet.getRange(idx + 2, 2);
        cell.setNumberFormat('@');
        cell.setValue(clean[label]);
        changes.push(label + ': ' + String(labels[idx][1]).trim() + ' \u2192 ' + clean[label]);
      }
    });
  } finally {
    lock.releaseLock();
  }
  var cache = CacheService.getScriptCache();
  cache.remove('alert_settings');
  cache.remove('sb_settings');
  if (changes.length) logActivity_(me, 'Changed settings', '', changes.join('; ').slice(0, 45000));
  return { changed: changes.length, changes: changes };
}

// ================================================================
// Wiring used by Code.js
// ================================================================
/** Merged into apiMap_(). directorOnly: even an Admin can't call it. */
function standbyApiMap_() {
  var ACC = ['Accounts'], DIR = ['Director'];
  return {
    requestStandby: { fn: requestStandby_, roles: ACC, log: 'Requested standby' },
    resumeStandby: { fn: resumeStandby_, roles: ['Accounts', 'Director'], log: 'Resumed standby early' },
    getStandbyPanel: { fn: getStandbyPanel_, roles: ACC },
    getStandbyAdmin: { fn: getStandbyAdmin_, roles: [] },
    decideStandby: { fn: decideStandby_, roles: [], log: 'Decided standby' },
    shortenStandby: { fn: shortenStandby_, roles: DIR, log: 'Shortened standby' },
    getStandbyDashboard: { fn: getStandbyDashboard_, roles: DIR },
    getDirectorPanel: { fn: getDirectorPanel_, roles: DIR, directorOnly: true },
    decideStandbyDirector: { fn: decideStandbyDirector_, roles: DIR, directorOnly: true, log: 'Director decided standby' },
    decidePaymentAsDirector: { fn: decidePaymentAsDirector_, roles: DIR, directorOnly: true, log: 'Director decided payment exception' },
    getSettingsData: { fn: getSettingsData_, roles: DIR, directorOnly: true },
    saveSettings: { fn: saveSettings_, roles: DIR, directorOnly: true, log: 'Saved settings' }
  };
}

/** Activity Log detail for the calls above. */
function standbyActivityDetail_(fnName, a, result) {
  a = a || {}; result = result || {};
  switch (fnName) {
    case 'requestStandby': return (result.requestId || '') + ' \u2013 ' + (a.reason || '') + ', ' + (a.standbyFrom || '') + ' to ' + (a.resumeDate || '') + (a.reportedBy ? ', reported by ' + a.reportedBy : '');
    case 'resumeStandby': return (result.requestId || '') + (result.restoredStatus ? ' \u2013 back to ' + result.restoredStatus : '');
    case 'decideStandby':
    case 'decideStandbyDirector':
      return (a.requestId || '') + ' \u2013 ' + (result.declined ? 'declined' : result.sentToDirector ? 'approved, sent to directors' : 'approved until ' + (result.resume || ''));
    case 'shortenStandby': return (a.requestId || '') + ' \u2013 now resumes ' + (result.resume || '');
    case 'decidePaymentAsDirector': return (a.requestId || '') + ' \u2013 ' + (a.approve ? 'approved' : 'declined') + (result.releasedToOps ? ', released to Ops' : '');
    case 'saveSettings': return (result.changed || 0) + ' change(s)';
    default: return '';
  }
}

/** Optional one-time setup (ICF Admin menu): creates the tab and adds the standby rows to Settings. Safe to re-run. */
function setupStandby() {
  getOrCreateStandbySheet_();
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SETTINGS_SHEET_NAME);
  if (sheet) {
    var existing = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).trim().toLowerCase(); }) : [];
    SB_SETTINGS_ROWS.forEach(function (r) {
      if (existing.indexOf(r[0].toLowerCase()) !== -1) return;
      var newRow = sheet.getLastRow() + 1;
      sheet.getRange(newRow, 2).setNumberFormat('@');
      sheet.getRange(newRow, 1, 1, 3).setValues([[r[0], r[1], r[2]]]);
    });
  }
  CacheService.getScriptCache().remove('sb_settings');
  Logger.log('Standby setup complete.');
}
