/**
 * FLIPKART ON THE OPS PAGE (14 Nov 2026) -- the Ops beta's Flipkart lane
 * ---------------------------------------------------------------------
 * Flipkart orders are urgent: the CRE logs the order, Ops packs it and sticks
 * Flipkart's address label on it ("RTD" -- ready to dispatch), and whichever
 * staff member is going takes the packed parcels to the Flipkart office the
 * next morning (~9 am). There is no dedicated carrier, so once a parcel is
 * packed Ops used to lose sight of it -- Manoj had to phone the carrier to
 * find out whether it reached Flipkart.
 *
 * Decided with Hari (14 Nov 2026)
 *   - Flipkart is always first: its own lane at the top of the Ops beta page,
 *     never mixed into the other lists. Three columns:
 *       To pack  ->  Packed, waiting for the run  ->  Handed over today.
 *   - One tap "Packed · RTD" stamps the time and who. For Flipkart it is also
 *     the pick-up (no separate "Acknowledge"), and there is NO Internal PO --
 *     the Flipkart shipping label is the paperwork.
 *   - Pack within 2 office hours (Settings, "DACC & Flipkart"); reminder to
 *     Ops after that, the first approver after 4.
 *   - Ops notes who is taking the parcels ("Going with": someone from the
 *     Staff tab, or a name and phone typed in). The card shows a call button.
 *   - The hand-over is confirmed by Ops when the carrier calls or messages
 *     Manoj -- "Mark handed over" for the whole run at once. It is the same
 *     record as before (recordPosting_: status Posted, Transport Mode
 *     "Flipkart", the Flipkart order ID as the shipment number).
 *   - If a packed order isn't confirmed by 11:00 on the next working day
 *     (Settings), its card turns red ("call the carrier") and Ops and the
 *     first approver get one email.
 *   - No hand-over slip is printed.
 * The CRE still logs the order exactly as before; nothing changes for
 * Accounts (Flipkart orders skip verification).
 */

/** Flipkart order still with Ops? (status Sent to Ops) */
function fkIsFlipkartRow_(o) {
  return normalizeOrderType_(o.get('Order Type')) === ORDER_TYPE_FLIPKART;
}

/**
 * When the run carrying a parcel packed at packedMs should have been confirmed:
 * the next working day after the packing day, at the configured hour.
 */
function fkConfirmDeadlineMs_(packedMs, alertCfg, hour) {
  var off = tzOffsetMs_(packedMs), DAY = 86400000;
  var d = Math.floor((packedMs + off) / DAY) * DAY + DAY;
  for (var guard = 0; guard < 14 && !isWorkingDay_(d, alertCfg); guard++) d += DAY;
  return d + hour * 3600000 - off;
}

/**
 * Who appears under "Going with" (Hari, 14 Nov 2026): only the Ops staff and
 * the Admin (Manoj and Ananthu today) -- anyone else is typed in with
 * "Someone else". Role-based, so a new Ops person appears without a code change.
 */
var FK_CARRIER_ROLES = ['Ops', 'Admin'];

/** Active Ops / Admin staff with their phones, for "Going with". One read of the Staff tab. */
function fkCarriers_() {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(STAFF_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return [];
  var lc = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lc).getDisplayValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var pc = hdr.indexOf('phone');
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, lc).getDisplayValues();
  var out = [];
  vals.forEach(function (r) {
    var code = String(r[0] || '').trim().toUpperCase(), name = String(r[1] || '').trim();
    if (!code || !name || String(r[3] || '').trim().toUpperCase() !== 'Y') return;
    if (FK_CARRIER_ROLES.indexOf(normalizeRole_(r[2])) === -1) return;
    out.push({ code: code, name: name, phone: pc === -1 ? '' : String(r[pc] || '').trim() });
  });
  return out.sort(function (a, b) { return a.name.localeCompare(b.name); });
}

/** The Flipkart lane: { toPack, packed, handedToday, carriers, packHours, confirmHour }. */
function fkLane_(data, nowMs) {
  var s = getOrderTypeSettings_();
  var alertCfg = getAlertSettings_();
  var tz = Session.getScriptTimeZone();
  var today = todayYmd_();
  var products = opsProductsByOrder_();
  var locks = (typeof pendingLockSet_ === 'function') ? pendingLockSet_() : {};
  var out = { toPack: [], packed: [], handedToday: [], packHours: s.fkPackHours, confirmHour: s.fkConfirmHour };
  data.rows.forEach(function (o) {
    if (!fkIsFlipkartRow_(o)) return;
    var status = String(o.get('Status') || '');
    var id = String(o.get('Tracker ID'));
    var c = {
      trackerId: id,
      institution: String(o.get('Institution / Customer') || ''),
      creName: String(o.get('CRE Name') || ''),
      products: products[id.toLowerCase()] || '',
      shipBy: opsFmtDate_(o.get('Ship By Date')),
      daysToShip: computeDaysUntilDate(o.get('Ship By Date')),
      locked: locks[id.toLowerCase()] || ''
    };
    if (status === 'Sent to Ops') {
      var packedMs = opsMs_(o.get('Flipkart Packed At'));
      if (!packedMs) {
        var start = opsMs_(o.get('Sent to Ops Timestamp')) || opsMs_(o.get('Date Logged'));
        var mins = start ? officeMinutesBetween_(start, nowMs, alertCfg) : 0;
        c.arrivedAt = opsFmt_(start);
        c.arrivedMs = start || 0;
        c.officeMins = mins;
        c.pickedUp = opsIsAcked_(o.get('Received by Ops Timestamp'), o.get('Ops Cutover'));
        c.late = mins >= s.fkPackHours * 60 || (c.daysToShip !== null && c.daysToShip <= 0);
        out.toPack.push(c);
      } else {
        var dl = fkConfirmDeadlineMs_(packedMs, alertCfg, s.fkConfirmHour);
        c.packedAt = opsFmt_(packedMs);
        c.packedMs = packedMs;
        c.packedBy = String(o.get('Flipkart Packed By') || '');
        c.carrier = String(o.get('Flipkart Carrier') || '');
        c.carrierPhone = String(o.get('Flipkart Carrier Phone') || '');
        c.confirmBy = opsFmt_(dl);
        c.unconfirmed = nowMs >= dl;
        c.late = c.unconfirmed || (c.daysToShip !== null && c.daysToShip < 0);
        out.packed.push(c);
      }
    } else if (status === STATUS_POSTED) {
      var dms = opsMs_(o.get('Dispatch Timestamp'));
      if (dms && Utilities.formatDate(new Date(dms), tz, 'yyyy-MM-dd') === today) {
        c.handedAt = opsFmt_(dms);
        c.carrier = String(o.get('Flipkart Carrier') || '');
        out.handedToday.push(c);
      }
    }
  });
  out.toPack.sort(function (a, b) {
    if (a.late !== b.late) return a.late ? -1 : 1;
    var da = a.daysToShip === null ? 99 : a.daysToShip, db = b.daysToShip === null ? 99 : b.daysToShip;
    if (da !== db) return da - db;
    return a.arrivedMs - b.arrivedMs;
  });
  out.packed.sort(function (a, b) {
    if (a.late !== b.late) return a.late ? -1 : 1;
    return a.packedMs - b.packedMs;
  });
  out.handedToday.sort(function (a, b) { return a.handedAt < b.handedAt ? 1 : -1; });
  return out;
}

/** Ops beta queue: the classic queue without Flipkart, plus the Flipkart lane. */
function getOpsBetaQueue_() {
  var q = getOpsQueue_();
  var notFk = function (c) { return c.orderType !== ORDER_TYPE_FLIPKART; };
  ['newOrders', 'inHand', 'cleared', 'late', 'readyPay', 'siteHold', 'gatePass', 'dispatchedToday'].forEach(function (k) {
    q[k] = (q[k] || []).filter(notFk);
  });
  var s = q.summary;
  s.newOrders = q.newOrders.length;
  s.newOverdue = q.newOrders.filter(function (c) { return c.overdue; }).length;
  s.inHand = q.inHand.length;
  s.inHandOverdue = q.inHand.filter(function (c) { return c.overdue; }).length;
  s.cleared = q.cleared.length; s.late = q.late.length; s.readyPay = q.readyPay.length;
  s.siteHold = q.siteHold.length; s.gatePass = q.gatePass.length; s.dispatchedToday = q.dispatchedToday.length;
  q.fk = fkLane_(opsReadOrders_(), Date.now());
  q.fk.carriers = fkCarriers_();
  return q;
}

// ================================================================
// Actions
// ================================================================
/** "Packed · RTD". For Flipkart this is also the pick-up. form = { trackerId } */
function fkMarkPacked_(form) {
  opsAssertLive_();
  var me = CURRENT_STAFF_;
  var sheet = getSheet();
  var row = findRowByTrackerId(sheet, String((form && form.trackerId) || ''));
  if (row === -1) throw new Error('Order not found.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var now = new Date(), f;
  try {
    f = getRowFields(sheet, row, ['Tracker ID', 'Status', 'Order Type', 'Received by Ops Timestamp', 'Ops Cutover', 'Flipkart Packed At', 'Flipkart Packed By']);
    if (normalizeOrderType_(f['Order Type']) !== ORDER_TYPE_FLIPKART) throw new Error('This isn’t a Flipkart order.');
    assertNotOnStandby_(f['Status']);
    if (f['Status'] !== 'Sent to Ops') throw new Error('This order is at "' + f['Status'] + '", so it can’t be marked packed now.');
    if (opsMs_(f['Flipkart Packed At'])) throw new Error('Already marked packed' + (f['Flipkart Packed By'] ? ' by ' + f['Flipkart Packed By'] : '') + ' at ' + opsFmt_(f['Flipkart Packed At']) + '.');
    var set = { 'Flipkart Packed At': now, 'Flipkart Packed By': me.name };
    if (!opsIsAcked_(f['Received by Ops Timestamp'], f['Ops Cutover'])) {
      set['Received by Ops Timestamp'] = now; set['Ops Code'] = me.code; set['Picked Up By'] = me.name;
    }
    setRowFields(sheet, row, set);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: String(f['Tracker ID']), packedAt: opsFmt_(now), packedBy: me.name };
}

/** Marked packed by mistake: back to "To pack" (the pick-up stays). form = { trackerId } */
function fkUndoPacked_(form) {
  opsAssertLive_();
  var sheet = getSheet();
  var row = findRowByTrackerId(sheet, String((form && form.trackerId) || ''));
  if (row === -1) throw new Error('Order not found.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var f;
  try {
    f = getRowFields(sheet, row, ['Tracker ID', 'Status', 'Order Type', 'Flipkart Packed At']);
    if (normalizeOrderType_(f['Order Type']) !== ORDER_TYPE_FLIPKART) throw new Error('This isn’t a Flipkart order.');
    if (f['Status'] !== 'Sent to Ops') throw new Error('This order is at "' + f['Status'] + '" – it can’t go back to "To pack".');
    if (!opsMs_(f['Flipkart Packed At'])) throw new Error('It isn’t marked packed.');
    setRowFields(sheet, row, { 'Flipkart Packed At': '', 'Flipkart Packed By': '', 'Flipkart Carrier': '', 'Flipkart Carrier Phone': '' });
  } finally {
    lock.releaseLock();
  }
  return { trackerId: String(f['Tracker ID']) };
}

/**
 * Who takes the packed parcels to the Flipkart office.
 * form = { trackerIds: [...], code (from the Staff tab) | name + phone (typed) }
 */
function fkSetCarrier_(form) {
  opsAssertLive_();
  form = form || {};
  var ids = (form.trackerIds || []).map(function (x) { return String(x).trim(); }).filter(Boolean);
  if (!ids.length) throw new Error('Choose the packed orders first.');
  var name = String(form.name || '').trim(), phone = String(form.phone || '').trim();
  if (form.code) {
    var st = fkCarriers_().filter(function (c) { return c.code === String(form.code).toUpperCase(); })[0];
    if (!st) throw new Error('Choose Ops or the admin from the list – for anyone else, pick “Someone else” and type the name and phone.');
    name = st.name; phone = st.phone || phone;
  }
  if (!name) throw new Error('Choose or type who is taking the parcels.');
  var sheet = getSheet();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var done = [], skipped = [];
  try {
    ids.forEach(function (id) {
      var row = findRowByTrackerId(sheet, id);
      if (row === -1) { skipped.push(id + ' (not found)'); return; }
      var f = getRowFields(sheet, row, ['Status', 'Order Type', 'Flipkart Packed At']);
      if (normalizeOrderType_(f['Order Type']) !== ORDER_TYPE_FLIPKART || f['Status'] !== 'Sent to Ops' || !opsMs_(f['Flipkart Packed At'])) { skipped.push(id); return; }
      setRowFields(sheet, row, { 'Flipkart Carrier': name, 'Flipkart Carrier Phone': phone });
      sheet.getRange(row, getHeaderIndex('Flipkart Carrier Phone')).setNumberFormat('@').setValue(phone);
      done.push(id);
    });
  } finally {
    lock.releaseLock();
  }
  return { carrier: name, phone: phone, done: done, skipped: skipped };
}

/**
 * The carrier called or messaged: these parcels are at the Flipkart office.
 * form = { trackerIds: [...], handedAt (yyyy-MM-ddTHH:mm, local) }
 * Each one is recorded exactly like the single hand-over (recordPosting_).
 */
function fkMarkHandedOver_(form) {
  opsAssertLive_();
  form = form || {};
  var ids = (form.trackerIds || []).map(function (x) { return String(x).trim(); }).filter(Boolean);
  if (!ids.length) throw new Error('Choose the orders that were handed over.');
  if (!form.handedAt) throw new Error('Enter when they were handed over.');
  var sheet = getSheet();
  var done = [], failed = [];
  ids.forEach(function (id) {
    try {
      var row = findRowByTrackerId(sheet, id);
      if (row === -1) throw new Error('not found');
      var f = getRowFields(sheet, row, ['Tracker ID', 'Order Type', 'Flipkart Carrier', 'Tracking / Consignment No.']);
      if (normalizeOrderType_(f['Order Type']) !== ORDER_TYPE_FLIPKART) throw new Error('not a Flipkart order');
      var carrier = String(f['Flipkart Carrier'] || '').trim();
      recordPosting_({
        trackerId: String(f['Tracker ID']),
        courierName: 'Flipkart' + (carrier ? ' – taken by ' + carrier : ''),
        trackingNo: String(f['Tracking / Consignment No.'] || '').trim() || String(f['Tracker ID']),
        postedAt: form.handedAt
      });
      done.push(String(f['Tracker ID']));
    } catch (e) {
      failed.push({ trackerId: id, message: e.message });
    }
  });
  if (!done.length && failed.length) throw new Error(failed.map(function (x) { return x.trackerId + ': ' + x.message; }).join(' '));
  return { done: done, failed: failed };
}

// ================================================================
// Reminders -- run by checkApprovalAlerts every 10 minutes, office hours only
// ================================================================
/**
 * Not packed within the pack hours -> Ops; within the escalation hours -> the
 * first approver (Ops copied). Packed but not confirmed at Flipkart by the
 * confirm hour of the next working day -> Ops and the first approver, once.
 * Tokens go in "Flipkart Alerts Sent", so nothing is sent twice.
 */
function fkPackSweep_(nowMs, staffMap, alertCfg) {
  if (!opsGoLiveMs_()) return 0;
  var s = getOrderTypeSettings_();
  var data = opsReadOrders_();
  var sheet = data.sheet;
  var col = getHeaderIndex('Flipkart Alerts Sent');
  var first = staffMap[alertCfg.firstApprover] || null;
  var firstMail = first && first.active && /@/.test(first.email) ? [first.email] : [];
  var ops = opsPeople_(staffMap).filter(function (p) { return /@/.test(p.email); }).map(function (p) { return p.email; });
  var url = appUrl_();
  var link = url ? url + '?page=ops-beta' : '';
  var locks = (typeof pendingLockSet_ === 'function') ? pendingLockSet_() : {};
  var remind = [], esc = [], unconf = [];
  data.rows.forEach(function (o) {
    if (!fkIsFlipkartRow_(o) || String(o.get('Status')) !== 'Sent to Ops') return;
    var id = String(o.get('Tracker ID'));
    if (locks[id.toLowerCase()]) return; // waiting for the admin (e.g. a cancellation)
    var cell = String(o.get('Flipkart Alerts Sent') || '');
    var item = { row: o.row, cell: cell, id: id, inst: String(o.get('Institution / Customer') || ''),
      shipBy: opsFmtDate_(o.get('Ship By Date')), carrier: String(o.get('Flipkart Carrier') || ''), phone: String(o.get('Flipkart Carrier Phone') || '') };
    var packedMs = opsMs_(o.get('Flipkart Packed At'));
    if (!packedMs) {
      var start = opsMs_(o.get('Sent to Ops Timestamp')) || opsMs_(o.get('Date Logged'));
      if (!start) return;
      var mins = officeMinutesBetween_(start, nowMs, alertCfg);
      if (mins >= s.fkPackEscHours * 60 && !opsHasToken_(cell, 'PackEscalated')) esc.push(item);
      else if (mins >= s.fkPackHours * 60 && !opsHasToken_(cell, 'PackReminder') && !opsHasToken_(cell, 'PackEscalated')) remind.push(item);
    } else {
      var token = 'RunUnconfirmed-' + packedMs; // a fresh token if it is ever un-packed and packed again
      if (nowMs >= fkConfirmDeadlineMs_(packedMs, alertCfg, s.fkConfirmHour) && !opsHasToken_(cell, token)) { item.token = token; unconf.push(item); }
    }
  });
  var list = function (items, withCarrier) {
    return '<ul>' + items.map(function (x) {
      return '<li><b>' + opsEsc_(x.id) + '</b> – ' + opsEsc_(x.inst) + (x.shipBy ? ' (ship by ' + opsEsc_(x.shipBy) + ')' : '') +
        (withCarrier ? ' – ' + (x.carrier ? 'taken by <b>' + opsEsc_(x.carrier) + '</b>' + (x.phone ? ', ' + opsEsc_(x.phone) : '') : '<b>no carrier noted</b>') : '') + '</li>';
    }).join('') + '</ul>';
  };
  var sent = 0;
  var mark = function (items, tokenOf) { items.forEach(function (x) { x.cell = opsAddToken_(sheet, x.row, col, x.cell, tokenOf(x)); }); };
  if (remind.length && cxMail_(ops, [], 'Flipkart: ' + remind.length + ' order' + (remind.length === 1 ? '' : 's') + ' not packed yet',
      '<p>These Flipkart orders arrived ' + s.fkPackHours + '+ office hours ago and aren’t marked <b>Packed · RTD</b>. Pack them now. ' +
      'They go to the first approver at ' + s.fkPackEscHours + ' office hours.</p>' + list(remind, false), link, 'Open the Operations page')) {
    mark(remind, function () { return 'PackReminder'; }); sent++;
  }
  if (esc.length && cxMail_(firstMail.length ? firstMail : ops, firstMail.length ? ops : [], 'NOT PACKED: ' + esc.length + ' Flipkart order' + (esc.length === 1 ? '' : 's') + ' after ' + s.fkPackEscHours + ' office hours',
      '<p>Ops hasn’t marked these Flipkart orders packed after ' + s.fkPackEscHours + ' office hours. Flipkart may cancel late orders or penalise the seller account – please check with Ops.</p>' + list(esc, false), link, 'Open the Operations page')) {
    mark(esc, function () { return 'PackEscalated'; }); sent++;
  }
  if (unconf.length && cxMail_(ops, firstMail, 'Flipkart: hand-over not confirmed for ' + unconf.length + ' parcel' + (unconf.length === 1 ? '' : 's'),
      '<p>These parcels were packed and should have reached the Flipkart office this morning, but the hand-over isn’t recorded. ' +
      'Call whoever took them, then tap <b>Mark handed over</b> on the Operations page.</p>' + list(unconf, true), link, 'Open the Operations page')) {
    mark(unconf, function (x) { return x.token; }); sent++;
  }
  return sent;
}

// ================================================================
// Wiring
// ================================================================
function flipkartOpsApiMap_() {
  var OPS = ['Ops'];
  return {
    getOpsBetaQueue:   { fn: getOpsBetaQueue_,   roles: OPS },
    fkMarkPacked:      { fn: fkMarkPacked_,      roles: OPS, log: 'Flipkart: packed (RTD)' },
    fkUndoPacked:      { fn: fkUndoPacked_,      roles: OPS, log: 'Flipkart: packed undone' },
    fkSetCarrier:      { fn: fkSetCarrier_,      roles: OPS, log: 'Flipkart: carrier noted' },
    fkMarkHandedOver:  { fn: fkMarkHandedOver_,  roles: OPS, log: 'Flipkart: handed over' }
  };
}

function flipkartOpsActivityDetail_(fnName, a, result) {
  a = a || {}; result = result || {};
  switch (fnName) {
    case 'fkMarkPacked': return 'Packed at ' + (result.packedAt || '');
    case 'fkSetCarrier': return 'Going with ' + (result.carrier || '') + (result.phone ? ' (' + result.phone + ')' : '') + ': ' + (result.done || []).join(', ');
    case 'fkMarkHandedOver': return 'Handed over at the Flipkart office ' + (a.handedAt || '') + ': ' + (result.done || []).join(', ') +
      ((result.failed || []).length ? ' – not saved: ' + result.failed.map(function (x) { return x.trackerId; }).join(', ') : '');
    default: return '';
  }
}
