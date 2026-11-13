/**
 * FOLLOW-UPS (13 Nov 2026) -- closing the gaps found in the workflow review
 * ---------------------------------------------------------------------
 * The review asked, stage by stage: "is anyone blind here?" These are the
 * fixes, agreed with Hari on 13 Nov 2026. Everything that sends a reminder
 * also shows inside the app, because most staff have no email on file yet
 * (WhatsApp comes later -- every message already goes through notify_).
 *
 *   1. Logged orders: Accounts is reminded after 4 office hours and the first
 *      approver (Ananthu) gets the escalation after 1 working day. If Accounts
 *      CAN'T verify because a PO is missing, the CRE is told instead.
 *   2. Courier orders held for the balance ("On Hold - Balance Due"): the CRE
 *      is told at verification, sees it in Needs Action, is reminded after
 *      1 working day; escalation after 3.
 *   3. Delivery confirmation: 2 days past the wanted-by date (or the dispatch
 *      day, if later) the CRE is reminded; at 5 days it is escalated.
 *   4. Cancelled after Ops picked it up: Ops is told and must tap "Cancelled
 *      order cleared" (goods unloaded, POs binned). Not done within 1 working
 *      day -> escalated.
 *   5. Cancellation and return REQUESTS waiting for the admin get the same
 *      reminder/escalation as payment approvals; a refund past its deadline
 *      is escalated the next day.
 *   6. CRE "On standby" pane: every standby on the CRE's orders -- waiting,
 *      on, or ended in the last 7 days.
 *   7. Flipkart settlements: a Flipkart order is closed only once Accounts
 *      matches it to Flipkart's monthly payout (UTR).
 *
 * Timings live in the Settings tab ("Follow-ups" on the Settings page).
 * Everything runs inside the 10-minute alert check (checkApprovalAlerts),
 * office hours only. Orders that were already overdue when this went live
 * get ONE batched list each, not one email per order.
 */

var FU_GO_LIVE_PROP = 'followups_go_live_ms';

// [label, default, explanation, min, max] -- the label is what the code looks up; don't rename it.
var FU_SETTINGS_ROWS = [
  ['Accounts: remind to verify a logged order after (office hours)', '4', 'From the CRE logging the order. Not sent while a PO is missing (the CRE is told instead) or a request is with the admin.', 1, 72],
  ['Accounts: escalate an unverified order after (working days)', '1', 'Goes to the first approver, copied to Accounts.', 1, 14],
  ['CRE: remind to collect a courier balance after (working days)', '1', 'Courier order verified with a balance still due: the packet can’t be posted until it’s paid.', 1, 14],
  ['CRE: escalate an uncollected courier balance after (working days)', '3', 'Goes to the first approver, copied to the CRE.', 1, 30],
  ['CRE: remind to confirm delivery, days after the wanted-by date', '2', 'Counted from the customer’s wanted-by date, or the dispatch day if that was later.', 1, 30],
  ['CRE: escalate an unconfirmed delivery, days after the wanted-by date', '5', 'Goes to the first approver, copied to the CRE.', 1, 60],
  ['Ops: clear out a cancelled order within (working days)', '1', 'An order cancelled after Ops picked it up: Ops confirms the goods are unloaded and the POs binned. Escalated at twice this.', 1, 14]
];

function getFollowUpSettings_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('fu_settings');
  if (hit) return JSON.parse(hit);
  var map = sbReadSettingsMap_();
  var n = function (i) {
    var r = FU_SETTINGS_ROWS[i], raw = map[r[0].toLowerCase()];
    var v = Number(String(raw == null ? '' : raw).replace(/[,\s]/g, ''));
    if (raw === undefined || raw === '' || isNaN(v)) v = Number(r[1]);
    return Math.min(r[4], Math.max(r[3], Math.floor(v)));
  };
  var s = {
    verifyRemindHours: n(0), verifyEscDays: n(1),
    courierRemindDays: n(2), courierEscDays: n(3),
    deliveryRemindDays: n(4), deliveryEscDays: n(5),
    clearDays: n(6)
  };
  if (s.courierEscDays <= s.courierRemindDays) s.courierEscDays = s.courierRemindDays + 2;
  if (s.deliveryEscDays <= s.deliveryRemindDays) s.deliveryEscDays = s.deliveryRemindDays + 3;
  cache.put('fu_settings', JSON.stringify(s), 300);
  return s;
}

/** Set on the first sweep after deployment; clocks never start before it. */
function fuGoLiveMs_() {
  var props = PropertiesService.getScriptProperties();
  var v = Number(props.getProperty(FU_GO_LIVE_PROP) || 0);
  if (!v) { v = Date.now(); props.setProperty(FU_GO_LIVE_PROP, String(v)); }
  return v;
}

// ================================================================
// People
// ================================================================
/** The first approver (Ananthu), else every active Admin. */
function fuEscalateTo_(staffMap, alertCfg) {
  var first = staffMap[alertCfg.firstApprover];
  if (first && first.active) return [staffRecipient_(first)];
  return Object.keys(staffMap).map(function (k) { return staffMap[k]; })
    .filter(function (s) { return s.active && s.role === 'Admin'; }).map(staffRecipient_);
}

/**
 * The order's CRE -- or, if that CRE is no longer active (left, or the row
 * names someone not in the Staff tab), the first approver, so the message
 * isn't sent to nobody (13 Nov 2026).
 */
function creRecipientsOrFallback_(codeVal, nameVal, staffMap) {
  staffMap = staffMap || getStaffMap_(false);
  var s = staffMap[resolveOwnerCode_(codeVal, nameVal, staffMap)];
  if (s && s.active) return [staffRecipient_(s)];
  var cfg = getAlertSettings_();
  return fuEscalateTo_(staffMap, cfg).map(function (p) {
    p.name = (p.name || '') + ' (CRE ' + (String(nameVal || '') || 'unknown') + ' not active)';
    return p;
  });
}

function fuEmails_(recipients) { return (recipients || []).map(function (p) { return p.email; }).filter(Boolean); }

// ================================================================
// Pending-request locks, read once for the whole sweep
// ================================================================
/**
 * { trackerIdLower: label } for every order locked by a request waiting for
 * an admin (same rules as pendingRequestFor_ in Locks.js). While locked, the
 * people downstream can't move the order, so their clocks don't nag them.
 */
function pendingLockSet_() {
  var out = {};
  try {
    readPaymentExceptions_().forEach(function (r) {
      if (r.type !== PX_DISPATCH && r.status === 'Pending') out[r.trackerId.toLowerCase()] = PX_LABELS[r.type] || r.type;
    });
  } catch (e) { Logger.log('lock set (payments): ' + e); }
  try {
    if (typeof readStandby_ === 'function') readStandby_().forEach(function (r) {
      if (r.status === 'Pending' || r.status === 'Pending Director') out[r.trackerId.toLowerCase()] = 'Standby request';
    });
  } catch (e) { Logger.log('lock set (standby): ' + e); }
  try {
    if (typeof readCancellations_ === 'function') readCancellations_().forEach(function (r) {
      if (r.status === 'Pending') out[r.trackerId.toLowerCase()] = 'Cancellation request';
    });
  } catch (e) { Logger.log('lock set (cancel): ' + e); }
  return out;
}

// ================================================================
// The sweep (called from checkApprovalAlerts)
// ================================================================
function followUpSweep_(nowMs, staffMap, alertCfg) {
  var goLive = fuGoLiveMs_();
  var s = getFollowUpSettings_();
  var data = opsReadOrders_();
  var sheet = data.sheet;
  var alertsCol = getHeaderIndex('Ops Alerts Sent');
  var escalateTo = fuEscalateTo_(staffMap, alertCfg);
  var accounts = opsStaffOfRole_(staffMap, 'Accounts').map(staffRecipient_);
  var url = appUrl_();
  var locks = pendingLockSet_();
  var ends = opsStandbyEnds_();
  var dayMins = Math.max(60, alertCfg.closeMin - alertCfg.openMin);
  var today = todayYmd_();
  var sent = 0;

  // Batches: key -> { to, cc, subject, intro, lines: [], marks: [{row, cell, token}] }
  var batches = {};
  var add = function (key, spec, line, o, cell, token) {
    var b = batches[key] || (batches[key] = { spec: spec, lines: [], marks: [] });
    b.lines.push(line);
    b.marks.push({ row: o.row, token: token });
  };
  var lineOf = function (o, extra) {
    return String(o.get('Tracker ID')) + ' – ' + String(o.get('Institution / Customer') || '') +
      (o.get('CRE Name') ? ' (CRE ' + o.get('CRE Name') + ')' : '') + (extra ? ': ' + extra : '');
  };
  // Per-CRE batches are keyed by recipient so each CRE gets only their own orders.
  var creKey = function (prefix, rec) { return prefix + '|' + rec.map(function (p) { return p.code || p.email || p.name; }).join(','); };

  data.rows.forEach(function (o) {
    var status = String(o.get('Status') || '');
    if (status === 'Cancelled') return;
    var id = String(o.get('Tracker ID'));
    var key = id.toLowerCase();
    var cell = String(o.get('Ops Alerts Sent') || '');
    var has = function (t) { return opsHasToken_(cell, t); };
    var endMs = ends[key] || 0;

    // ---- 1. Logged: waiting for Accounts (or for the CRE's PO) ----
    if (status === 'Logged') {
      if (locks[key]) return; // the admin is the one deciding -- the approval alerts cover it
      var loggedMs = Math.max(opsMs_(o.get('Date Logged')) || 0, goLive);
      var docs = docsInfo_({ 'Status': status, 'Payment Terms Type': o.get('Payment Terms Type'),
        'CRM PO URL': o.get('CRM PO URL'), 'Customer PO URL': o.get('Customer PO URL') });
      var mins = officeMinutesBetween_(loggedMs, nowMs, alertCfg);
      if (docs.missing.length) {
        if (mins >= 60 && !has('DocsMissing')) {
          var cre = creRecipientsOrFallback_(o.get('CRE Code'), o.get('CRE Name'), staffMap);
          add(creKey('docs', cre), { to: cre, event: 'PO_MISSING_FOR_VERIFY', subject: 'Upload the PO – Accounts can’t verify',
            intro: 'Accounts can’t verify these orders until the PO is uploaded. Open the order (Find any order) and upload it.', link: url, linkLabel: 'Open the CRE page' },
            lineOf(o, docs.missing.join(' and ') + ' missing'), o, cell, 'DocsMissing');
        }
        return;
      }
      if (mins >= s.verifyEscDays * dayMins && !has('VerifyEscalated')) {
        add('verifyEsc', { to: escalateTo, cc: fuEmails_(accounts), event: 'VERIFY_ESCALATION',
          subject: 'OVERDUE: orders not verified by Accounts after ' + s.verifyEscDays + ' working day' + (s.verifyEscDays === 1 ? '' : 's'),
          intro: 'Logged by the CRE and still not verified by Accounts. Please check with Accounts.', link: url ? url + '?page=accounts' : '', linkLabel: 'Open the Accounts page' },
          lineOf(o, 'logged ' + opsFmt_(o.get('Date Logged'))), o, cell, 'VerifyEscalated');
      } else if (mins >= s.verifyRemindHours * 60 && !has('VerifyReminder') && !has('VerifyEscalated')) {
        add('verify', { to: accounts, event: 'VERIFY_REMINDER',
          subject: 'Reminder: orders waiting for verification for ' + s.verifyRemindHours + '+ office hours',
          intro: 'These orders are waiting for you to verify the payment. Escalated at ' + s.verifyEscDays + ' working day' + (s.verifyEscDays === 1 ? '' : 's') + '.',
          link: url ? url + '?page=accounts' : '', linkLabel: 'Open the Accounts page' },
          lineOf(o, 'logged ' + opsFmt_(o.get('Date Logged'))), o, cell, 'VerifyReminder');
      }
      return;
    }

    // ---- 2. Courier order held for the balance ----
    if (status === STATUS_HOLD_BALANCE) {
      if (locks[key]) return;
      var fromMs = Math.max(opsMs_(o.get('Verified Date')) || 0, endMs, goLive);
      var wd = opsWorkingHours_(fromMs, nowMs) / 24;
      var bal = computeBalanceDue(o.get('Total Order Value'), o.get('Advance Received'));
      var cre2 = creRecipientsOrFallback_(o.get('CRE Code'), o.get('CRE Name'), staffMap);
      if (wd >= s.courierEscDays && !has('CourierEscalated')) {
        add('courierEsc', { to: escalateTo, cc: fuEmails_(cre2), event: 'COURIER_BALANCE_ESCALATION',
          subject: 'OVERDUE: courier orders waiting ' + s.courierEscDays + '+ working days for the balance',
          intro: 'Verified, but the packet can’t be posted until the customer pays the balance. Please check with the CRE.' },
          lineOf(o, 'Rs. ' + formatAmount(bal) + ' due'), o, cell, 'CourierEscalated');
      } else if (wd >= s.courierRemindDays && !has('CourierReminder') && !has('CourierEscalated')) {
        add(creKey('courier', cre2), { to: cre2, event: 'COURIER_BALANCE_REMINDER', subject: 'Reminder: collect the balance so the packet can be posted',
          intro: 'Accounts has verified these courier orders, but the customer still owes a balance, so Ops can’t post them. Collect it and tap “Customer has paid”.',
          link: url, linkLabel: 'Open the CRE page' },
          lineOf(o, 'Rs. ' + formatAmount(bal) + ' due'), o, cell, 'CourierReminder');
      }
      return;
    }

    // ---- 3. Dispatched, delivery not confirmed ----
    if (isDispatchedStatus_(status)) {
      var ds = String(o.get('Delivery Status') || '');
      if (ds === 'Delivered' || ds === 'Returned') return;
      if (gateWaitingFromValues_(status, o.get('Dispatch Type'), o.get('Gate Pass Issued Timestamp'), o.get('Gate Out Timestamp'))) return; // at the gate: the gate nudge covers it
      var ot = normalizeOrderType_(o.get('Order Type'));
      if (ot === ORDER_TYPE_FLIPKART) return; // Flipkart delivers; its close-out is the settlement
      if (ot === ORDER_TYPE_DACC && !(o.get('DACC Released At') instanceof Date)) return; // DACC has its own sweep until released
      var dueYmd = fuDeliveryDueYmd_(o.get('Customer Requested Delivery Date'), o.get('Gate Out Timestamp') || o.get('Dispatch Timestamp'));
      if (!dueYmd) return;
      var late = sbDaysBetween_(dueYmd, today);
      var cre3 = creRecipientsOrFallback_(o.get('CRE Code'), o.get('CRE Name'), staffMap);
      var what = late + ' day' + (late === 1 ? '' : 's') + ' past ' + fmtYmd_(dueYmd) + (ds ? ', shows “' + ds + '”' : '');
      if (late >= s.deliveryEscDays && !has('DeliveryEscalated')) {
        add('deliveryEsc', { to: escalateTo, cc: fuEmails_(cre3), event: 'DELIVERY_ESCALATION',
          subject: 'OVERDUE: deliveries not confirmed ' + s.deliveryEscDays + '+ days after the wanted-by date',
          intro: 'Dispatched, but the CRE hasn’t confirmed delivery. Either the goods are still on the way, or delivery wasn’t recorded. Please check with the CRE.' },
          lineOf(o, what), o, cell, 'DeliveryEscalated');
      } else if (late >= s.deliveryRemindDays && !has('DeliveryReminder') && !has('DeliveryEscalated')) {
        add(creKey('delivery', cre3), { to: cre3, event: 'DELIVERY_REMINDER', subject: 'Reminder: confirm delivery with the customer',
          intro: 'Call the customer and update the delivery status. Escalated at ' + s.deliveryEscDays + ' days.', link: url, linkLabel: 'Open the CRE page' },
          lineOf(o, what), o, cell, 'DeliveryReminder');
      }
    }
  });

  // Send each batch, then mark the orders it covered.
  Object.keys(batches).forEach(function (k) {
    var b = batches[k], sp = b.spec;
    if (!sp.to || !sp.to.length) return;
    var html = '<p>' + opsEsc_(sp.intro) + '</p><ul>' + b.lines.map(function (l) { return '<li>' + opsEsc_(l) + '</li>'; }).join('') + '</ul>';
    sent += notify_(sp.event, b.lines.length === 1 ? b.lines[0].split(' – ')[0] : '', sp.to, {
      subject: sp.subject + (b.lines.length > 1 ? ' (' + b.lines.length + ')' : ''), text: sp.intro + ' ' + b.lines.join('; '),
      html: html, email: true, cc: sp.cc || [], link: sp.link || url, linkLabel: sp.linkLabel || 'Open'
    });
    b.marks.forEach(function (m) {
      var cur = String(sheet.getRange(m.row, alertsCol).getValue() || '');
      opsAddToken_(sheet, m.row, alertsCol, cur, m.token);
    });
  });

  try { sent += fuCancellationSweep_(nowMs, staffMap, alertCfg, escalateTo, s); } catch (e) { Logger.log('cancellation follow-ups failed: ' + e); }
  try { sent += fuRefundSweep_(staffMap, escalateTo, accounts); } catch (e) { Logger.log('refund follow-ups failed: ' + e); }
  return sent;
}

/** The later of the wanted-by date and the dispatch day, as yyyy-MM-dd (or '' if neither). */
function fuDeliveryDueYmd_(wantedBy, dispatchedAt) {
  var tz = Session.getScriptTimeZone();
  var a = wantedBy instanceof Date && !isNaN(wantedBy.getTime()) ? Utilities.formatDate(wantedBy, tz, 'yyyy-MM-dd') : '';
  var b = dispatchedAt instanceof Date && !isNaN(dispatchedAt.getTime()) ? Utilities.formatDate(dispatchedAt, tz, 'yyyy-MM-dd') : '';
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

// ================================================================
// 4. Cancelled after Ops picked it up -- Ops clears it out
// ================================================================
var CX_OPS_CLEAR_STATUSES = ['Sent to Ops', 'Vehicle Confirmed', 'On Hold - Site Not Ready', 'Ready - Payment Pending', 'On Standby'];

/**
 * Called by decideCancellation_ when it approves (inside its lock, before the
 * status changes). True when Ops already had the order in hand: picked up in
 * the system, or with Ops at go-live.
 */
function cxOpsHadIt_(sheet, row) {
  var f = getRowFields(sheet, row, ['Status', 'Received by Ops Timestamp', 'Ops Cutover', 'Dispatch Type']);
  if (CX_OPS_CLEAR_STATUSES.indexOf(String(f['Status'])) === -1) return false;
  return opsIsAcked_(f['Received by Ops Timestamp'], f['Ops Cutover']);
}

/** After a cancellation is approved for an order Ops had: tell Ops (and the gate-pass desk if it was asked). */
function cxNotifyOps_(r, statusBefore, me) {
  var staffMap = getStaffMap_(false);
  var people = opsPeople_(staffMap).map(staffRecipient_);
  if (statusBefore === 'Vehicle Confirmed') opsStaffOfRole_(staffMap, 'Accounts').forEach(function (s) { people.push(staffRecipient_(s)); });
  var url = appUrl_();
  var text = r.trackerId + ' (' + r.institution + ') has been CANCELLED by ' + me.name + '. Stop work on it: unload the goods, put them back, ' +
    'and bin the Internal PO and the CRM PO printout. Then tap “Cancelled order cleared” on the Operations page.' +
    (statusBefore === 'Vehicle Confirmed' ? ' Accounts: the gate pass request is withdrawn – don’t issue it.' : '');
  notify_('ORDER_CANCELLED_WITH_OPS', r.trackerId, people, {
    subject: 'CANCELLED – stop work: ' + r.trackerId, text: text, email: true,
    link: url ? url + '?page=ops' : '', linkLabel: 'Open the Operations page', html: '<p>' + opsEsc_(text) + '</p>'
  });
}

/** Ops page: cancelled orders still to clear out. */
function getOpsCancelledToClear_() {
  if (typeof readCancellations_ !== 'function') return [];
  var products = null;
  return readCancellations_().filter(function (r) {
    return r.status === 'Approved' && r.opsClearNeeded && !r.opsClearedAtMs;
  }).map(function (r) {
    if (!products) products = opsProductsByOrder_();
    return {
      requestId: r.requestId, trackerId: r.trackerId, institution: r.institution,
      cancelledBy: r.decidedBy, cancelledAt: cxFmt_(r.decidedAtMs), statusBefore: r.statusBefore,
      reason: r.reason, products: products[r.trackerId.toLowerCase()] || '' // "2 x Bio toilet, 1 x Septic tank"
    };
  });
}

/** Ops: form = { requestId, note } -- goods unloaded, POs binned. */
function opsClearCancelled_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var r;
  try {
    r = cxFind_(form.requestId);
    if (!r) throw new Error('Cancellation not found.');
    if (r.status !== 'Approved' || !r.opsClearNeeded) throw new Error('Nothing to clear for this order.');
    if (r.opsClearedAtMs) throw new Error('Already cleared by ' + r.opsClearedBy + '.');
    var note = String(form.note || '').trim();
    cxWrite_(r.row, { 'Ops Cleared By': me.name, 'Ops Cleared At': new Date(), 'Ops Clear Note': note,
      'History': cxHistory_(r, 'Ops cleared (goods back, POs binned) – ' + me.name + (note ? ': ' + note : '')) });
  } finally {
    lock.releaseLock();
  }
  return { requestId: r.requestId, trackerId: r.trackerId };
}

function fuCancellationSweep_(nowMs, staffMap, alertCfg, escalateTo, s) {
  if (typeof readCancellations_ !== 'function') return 0;
  var list = readCancellations_().filter(function (r) { return r.status === 'Approved' && r.opsClearNeeded && !r.opsClearedAtMs && r.decidedAtMs; });
  if (!list.length) return 0;
  var sheet = getOrCreateCancellationsSheet_();
  var col = cxCol_('Alerts Sent') + 1;
  var ops = opsPeople_(staffMap).map(staffRecipient_);
  var url = appUrl_();
  var rem = [], esc = [];
  list.forEach(function (r) {
    var wd = opsWorkingHours_(r.decidedAtMs, nowMs) / 24;
    if (wd >= s.clearDays * 2 && r.alertsSent.indexOf('ClearEscalated') === -1) esc.push(r);
    else if (wd >= s.clearDays && r.alertsSent.indexOf('ClearReminder') === -1 && r.alertsSent.indexOf('ClearEscalated') === -1) rem.push(r);
  });
  var sent = 0;
  var line = function (r) { return r.trackerId + ' – ' + r.institution + ' (cancelled ' + cxFmt_(r.decidedAtMs) + ')'; };
  if (rem.length) {
    sent += notify_('CANCELLED_CLEAR_REMINDER', rem.length === 1 ? rem[0].trackerId : '', ops, {
      subject: 'Reminder: clear out cancelled order' + (rem.length === 1 ? '' : 's'), email: true,
      text: 'Cancelled, not yet cleared: ' + rem.map(line).join('; '), link: url ? url + '?page=ops' : '', linkLabel: 'Open the Operations page'
    });
    rem.forEach(function (r) { markAlert_(sheet, r.row, col, r.alertsSent, 'ClearReminder'); });
  }
  if (esc.length) {
    sent += notify_('CANCELLED_CLEAR_ESCALATION', esc.length === 1 ? esc[0].trackerId : '', escalateTo, {
      subject: 'OVERDUE: cancelled order' + (esc.length === 1 ? '' : 's') + ' not cleared by Ops', email: true, cc: fuEmails_(ops),
      text: 'Ops hasn’t confirmed the goods are back and the POs binned: ' + esc.map(line).join('; ') + '. Please check the goods aren’t loaded or sent.',
      link: url ? url + '?page=ops' : '', linkLabel: 'Open the Operations page'
    });
    esc.forEach(function (r) { markAlert_(sheet, r.row, col, r.alertsSent, 'ClearEscalated'); });
  }
  return sent;
}

// ================================================================
// 5. Refunds past their deadline; request reminders
// ================================================================
function fuRefundSweep_(staffMap, escalateTo, accounts) {
  var today = todayYmd_();
  var late = [];
  if (typeof readCancellations_ === 'function') {
    var cs = getOrCreateCancellationsSheet_(), ccol = cxCol_('Alerts Sent') + 1;
    readCancellations_().forEach(function (r) {
      if (r.refundStatus !== CX_REFUND_PROCESSING || !r.refundDeadlineYmd || r.refundDeadlineYmd >= today) return;
      if (r.alertsSent.indexOf('RefundOverdue') !== -1) return;
      late.push({ text: r.trackerId + ' – ' + r.institution + ': ' + cxInr_(r.refundAmount) + ', due ' + fmtYmd_(r.refundDeadlineYmd) + ' (cancellation)',
        mark: function (rr) { return function () { markAlert_(cs, rr.row, ccol, rr.alertsSent, 'RefundOverdue'); }; }(r) });
    });
  }
  if (typeof readReturns_ === 'function') {
    var rs = rtSheet_(), rcol = rtCol_('Alerts Sent') + 1;
    readReturns_().forEach(function (r) {
      if (r.refundStatus !== RT_REFUND_PROCESSING || !r.refundDeadlineYmd || r.refundDeadlineYmd >= today) return;
      if (r.alertsSent.indexOf('RefundOverdue') !== -1) return;
      late.push({ text: r.trackerId + ' – ' + r.institution + ': ' + cxInr_(r.resolutionAmount) + ', due ' + fmtYmd_(r.refundDeadlineYmd) + ' (return ' + r.returnId + ')',
        mark: function (rr) { return function () { markAlert_(rs, rr.row, rcol, rr.alertsSent, 'RefundOverdue'); }; }(r) });
    });
  }
  if (!late.length) return 0;
  var url = appUrl_();
  var sent = notify_('REFUND_OVERDUE', '', escalateTo, {
    subject: 'OVERDUE: ' + late.length + ' refund' + (late.length === 1 ? '' : 's') + ' past the deadline', email: true, cc: fuEmails_(accounts),
    text: 'Refunds Accounts hasn’t marked paid by their deadline: ' + late.map(function (x) { return x.text; }).join('; ') + '.',
    link: url ? url + '?page=accounts' : '', linkLabel: 'Open the Accounts page'
  });
  late.forEach(function (x) { x.mark(); });
  return sent;
}

/**
 * Extra jobs for checkApprovalAlerts: cancellation and return requests waiting
 * for the admin, on the payment-approval timings. Same shape as its own jobs.
 */
function followUpApprovalJobs_(cfg) {
  var jobs = [];
  if (typeof readCancellations_ === 'function') {
    jobs.push({ list: readCancellations_(), sheet: getOrCreateCancellationsSheet_(), col: cxCol_('Alerts Sent') + 1,
      remind: cfg.paymentRemindAfter, escalate: cfg.paymentEscalateAfter,
      label: function (r) { return 'Cancellation request – ' + r.trackerId; },
      detail: function (r) { return cxEsc_(r.institution) + '<br>Asked by ' + cxEsc_(r.requestedByName) + ': ' + cxEsc_(r.reason) +
        '<br>The order is locked – nobody can move it until this is decided.'; } });
  }
  if (typeof readReturns_ === 'function') {
    jobs.push({ list: readReturns_().map(function (r) { r.requestId = r.returnId; return r; }), sheet: rtSheet_(), col: rtCol_('Alerts Sent') + 1,
      remind: cfg.paymentRemindAfter, escalate: cfg.paymentEscalateAfter,
      label: function (r) { return 'Return request – ' + r.trackerId; },
      detail: function (r) { return cxEsc_(r.institution) + '<br>Asked by ' + cxEsc_(r.requestedByName) + ': ' + cxEsc_(r.reason) + (r.details ? ' – ' + cxEsc_(r.details) : ''); } });
  }
  return jobs;
}

// ================================================================
// 6. CRE: orders on standby
// ================================================================
/** Standbys on the orders this CRE owns or covers (Admin: all) -- waiting, on, or ended in the last 7 days. */
function getCreStandbyPanel_() {
  if (typeof readStandby_ !== 'function') return { items: [] };
  var me = CURRENT_STAFF_;
  var scope = creScope_();
  var sheet = getSheet();
  var data = opsReadOrders_();
  var owner = {};
  var staffMap = getStaffMap_(false);
  data.rows.forEach(function (o) {
    owner[String(o.get('Tracker ID')).toLowerCase()] = { code: resolveOwnerCode_(o.get('CRE Code'), o.get('CRE Name'), staffMap), status: String(o.get('Status') || '') };
  });
  var cutoff = Date.now() - 7 * 86400000;
  var items = readStandby_().filter(function (r) {
    var ow = owner[r.trackerId.toLowerCase()];
    if (!ow) return false;
    if (scope && !scope.accessFor(ow.code, r.trackerId)) return false;
    if (r.status === 'Pending' || r.status === 'Pending Director' || r.status === 'Active') return true;
    if (r.status === 'Ended' || r.status === 'Declined') return Math.max(r.endedAtMs || 0, r.decidedAtMs || 0, r.directorDecidedAtMs || 0) > cutoff;
    return false;
  }).map(function (r) {
    var it = sbItem_(r);
    it.statusText = r.status === 'Pending' ? 'Requested – waiting for the admin'
      : r.status === 'Pending Director' ? 'Waiting for a director'
      : r.status === 'Active' ? 'On standby until ' + it.resume + (it.daysLeft !== null ? ' (' + (it.daysLeft <= 0 ? 'resumes today' : it.daysLeft + ' day' + (it.daysLeft === 1 ? '' : 's') + ' left') + ')' : '')
      : r.status === 'Declined' ? 'Declined – the order stayed live'
      : 'Back to live ' + it.endedAt + (r.endedHow ? ' – ' + r.endedHow : '');
    it.tone = r.status === 'Active' ? 'violet' : r.status === 'Ended' ? 'teal' : r.status === 'Declined' ? 'grey' : 'amber';
    it.orderStatus = owner[r.trackerId.toLowerCase()].status;
    return it;
  });
  var rank = { Active: 0, Pending: 1, 'Pending Director': 1, Ended: 2, Declined: 3 };
  items.sort(function (a, b) { return (rank[a.status] - rank[b.status]) || ((a.resumeYmd || '') < (b.resumeYmd || '') ? -1 : 1); });
  return { items: items, active: items.filter(function (i) { return i.status === 'Active'; }).length };
}

// ================================================================
// 7. Flipkart settlements (Accounts)
// ================================================================
var FK_SETTLED = 'Settled';
var FK_AWAITING = 'Awaiting';

/** Flipkart orders not yet matched to a payout (cancelled ones left out). */
function getFlipkartSettlements_() {
  var data = opsReadOrders_();
  var items = [];
  data.rows.forEach(function (o) {
    if (normalizeOrderType_(o.get('Order Type')) !== ORDER_TYPE_FLIPKART) return;
    var status = String(o.get('Status') || '');
    if (status === 'Cancelled') return;
    if (String(o.get('Flipkart Settlement') || '') === FK_SETTLED) return;
    var handedMs = isDispatchedStatus_(status) ? opsMs_(o.get('Dispatch Timestamp')) : null;
    items.push({
      trackerId: String(o.get('Tracker ID')), institution: String(o.get('Institution / Customer') || ''),
      value: Number(o.get('Total Order Value')) || 0, cre: String(o.get('CRE Name') || ''),
      loggedAt: opsFmtDate_(o.get('Date Logged')), loggedMs: opsMs_(o.get('Date Logged')) || 0,
      handedOver: handedMs ? opsFmtDate_(o.get('Dispatch Timestamp')) : '', handedMs: handedMs || 0,
      stage: handedMs ? 'Handed over' : 'Not handed over yet', deliveryStatus: String(o.get('Delivery Status') || ''),
      daysSinceHandover: handedMs ? Math.floor((Date.now() - handedMs) / 86400000) : null
    });
  });
  items.sort(function (a, b) { return (a.handedMs || 9e15) - (b.handedMs || 9e15); }); // oldest hand-over first
  return { items: items, total: items.reduce(function (t, i) { return t + i.value; }, 0) };
}

/**
 * Accounts: one Flipkart payout settles several orders.
 * form = { trackerIds: [...], utr, payoutDate (yyyy-MM-dd), payoutAmount (optional), note }
 */
function markFlipkartSettled_(form) {
  form = form || {};
  var me = CURRENT_STAFF_;
  var ids = (form.trackerIds || []).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
  if (!ids.length) throw new Error('Tick the orders this payout covers.');
  var utr = String(form.utr || '').trim();
  if (utr.length < 6) throw new Error('Enter the UTR / reference of Flipkart’s payout.');
  var payoutYmd = String(form.payoutDate || '').trim();
  if (!sbIsYmd_(payoutYmd)) throw new Error('Enter the date the payout reached the bank.');
  if (payoutYmd > todayYmd_()) throw new Error('The payout date can’t be in the future.');
  var amount = String(form.payoutAmount || '').trim() === '' ? null : Number(String(form.payoutAmount).replace(/[,\s₹]/g, ''));
  if (amount !== null && (isNaN(amount) || amount <= 0)) throw new Error('Enter the payout amount as a number, or leave it blank.');
  var note = String(form.note || '').trim();
  var sheet = getSheet();
  var ref = utr + ' – payout ' + fmtYmd_(payoutYmd) + (amount !== null ? ', Rs. ' + formatAmount(amount) + ' for ' + ids.length + ' order' + (ids.length === 1 ? '' : 's') : '') + (note ? ' – ' + note : '');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var done = [];
  try {
    var rows = ids.map(function (id) {
      var row = findRowByTrackerId(sheet, id);
      if (row === -1) throw new Error(id + ' isn’t in the tracker.');
      var f = getRowFields(sheet, row, ['Tracker ID', 'Order Type', 'Status', 'Flipkart Settlement']);
      if (normalizeOrderType_(f['Order Type']) !== ORDER_TYPE_FLIPKART) throw new Error(id + ' isn’t a Flipkart order.');
      if (f['Status'] === 'Cancelled') throw new Error(id + ' is cancelled.');
      if (String(f['Flipkart Settlement'] || '') === FK_SETTLED) throw new Error(id + ' is already settled.');
      return row;
    });
    var payoutDate = sbYmdToDate_(payoutYmd);
    rows.forEach(function (row, i) {
      setRowFields(sheet, row, { 'Flipkart Settlement': FK_SETTLED, 'Flipkart Settled By': me.name, 'Flipkart Settled At': payoutDate });
      sheet.getRange(row, getHeaderIndex('Flipkart Settlement UTR')).setNumberFormat('@').setValue(ref);
      done.push(ids[i]);
    });
  } finally {
    lock.releaseLock();
  }
  return { settled: done.length, trackerIds: done, utr: utr };
}

// ================================================================
// Wiring
// ================================================================
function followUpApiMap_() {
  return {
    getOpsCancelledToClear: { fn: getOpsCancelledToClear_, roles: ['Ops'] },
    opsClearCancelled:      { fn: opsClearCancelled_,      roles: ['Ops'], log: 'Cleared cancelled order' },
    getCreStandbyPanel:     { fn: getCreStandbyPanel_,     roles: ['CRE'] },
    getFlipkartSettlements: { fn: getFlipkartSettlements_, roles: ['Accounts', 'Director'] },
    markFlipkartSettled:    { fn: markFlipkartSettled_,    roles: ['Accounts'], log: 'Flipkart payout matched' }
  };
}

function followUpActivityDetail_(fnName, a, result) {
  a = a || {}; result = result || {};
  switch (fnName) {
    case 'opsClearCancelled': return (a.requestId || '') + (a.note ? ' – ' + a.note : '');
    case 'markFlipkartSettled': return 'UTR ' + (a.utr || '') + ', ' + (result.settled || 0) + ' order(s): ' + (result.trackerIds || []).join(', ');
    default: return '';
  }
}
