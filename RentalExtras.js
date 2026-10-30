/**
 * RENTALS -- round 2 (Oct 2026): what the first build left open.
 * ---------------------------------------------------------------------
 *   CORRECTIONS  A wrong tap at the gate can be undone by the same person (or
 *                the Admin) within RN_UNDO_MINUTES, as long as nothing has
 *                moved since. Ananthu / Directors can correct an installation
 *                or off-hire date (reason required), undo an installation or
 *                off-hire recorded by mistake, and cancel a planned pickup.
 *                Every correction is written to the rental's history.
 *   CRE COVER    A CRE covering for an away CRE (Staff tab leave cover, set on
 *                the Admin page) sees and acts on their rentals, and gets their
 *                reminders. The Admin can reassign a rental to another CRE.
 *   STANDBY      A customer-side delay (site not ready, postponed, no access for
 *                pickup...). CRE or Ops ask; Ananthu / a Director approves --
 *                or sets it directly. While a rental is on standby, the
 *                acknowledgement, preparation, installation and pickup
 *                reminders stop. Rent, overrun and payment reminders do NOT
 *                stop: those are money the customer owes. It ends by itself on
 *                the resume date; a new installation date can be set with it.
 *   PHOTOS       Ops can add a loading photo to a dispatch trip; a damaged item
 *                at inspection needs a photo. Damage is listed on the rental for
 *                Accounts, who can bill it in one tap (charge kind "Damage").
 *                Who pays is still Sambhu's decision -- nothing is charged
 *                automatically.
 *   IMPORT       Rentals already installed before go-live: Ananthu / a Director
 *                enters one with its installation date and configuration. The
 *                items get IDs straight away as "Deployed", marked "stencil this
 *                ID when it comes back"; the advance goes to Accounts to verify.
 *   PERIOD BILLS For per day / week / month rentals with "Bill rent every week /
 *                month" set at intake: at the end of each period the reminder
 *                sweep raises a "Rent" line for whatever is owed by then beyond
 *                what is paid and what is already billed, and tells the CRE and
 *                Accounts. The advance is used up first, so no bill is raised
 *                while it still covers the rent.
 *   DASHBOARD    getRentalDashboard_ feeds the Rentals card on the Owner
 *                Dashboard (rental_dashboard.html).
 */

// ================================================================
// Reassign (Admin)
// ================================================================
/** form = { rentalId, toCode, note } */
function reassignRental_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var to = String((form && form.toCode) || '').trim().toUpperCase();
  var staff = getStaffMap_(true)[to];
  if (!staff || !staff.active || staff.role !== 'CRE') throw new Error('Choose an active CRE.');
  var lock = rnLock_(), from;
  try {
    var ctx = rnLoad_();
    var o = rnOrder_(ctx, id);
    if (o['Status'] === 'Closed' || o['Status'] === 'Cancelled') throw new Error('This rental is ' + String(o['Status']).toLowerCase() + '.');
    from = String(o['CRE Name'] || o['CRE Code']);
    if (String(o['CRE Code']).toUpperCase() === to) throw new Error('It is already with ' + staff.name + '.');
    rnSet_(ctx.orders, o, { 'CRE Code': to, 'CRE Name': staff.name });
    rnHistory_(ctx.orders, o, 'Reassigned from ' + from + ' to ' + staff.name + (form.note ? ' – ' + String(form.note).slice(0, 200) : ''), me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, from: from, to: staff.name };
}

// ================================================================
// Standby
// ================================================================
function rnStandbyActive_(o, todayYmd) {
  if (String(o['Standby Status'] || '') !== 'Active') return false;
  var until = rnYmd_(o['Standby Until']);
  return !!until && until >= (todayYmd || todayYmd_());
}
function rnStandbyView_(o) {
  var st = String(o['Standby Status'] || '');
  if (!st) return null;
  return { status: st, active: rnStandbyActive_(o), reason: String(o['Standby Reason'] || ''), until: rnFmtDate_(o['Standby Until']),
    untilYmd: rnYmd_(o['Standby Until']), newStart: rnFmtDate_(o['Standby New Start']), by: String(o['Standby By'] || ''),
    requestedBy: String(o['Standby Requested By'] || '') };
}
function rnStandbyCheck_(form, o, ctx) {
  var reason = String((form && form.reason) || '').trim();
  if (RENTAL_STANDBY_REASONS.indexOf(reason) === -1) throw new Error('Choose the reason.');
  var note = String(form.note || '').trim();
  if (reason === 'Other' && note.length < 5) throw new Error('Say what the delay is.');
  var until = rnValidYmd_(form.until, 'the date it resumes');
  var today = todayYmd_();
  if (until <= today) throw new Error('The resume date must be after today.');
  if (sbDaysBetween_(today, until) > 90) throw new Error('At most 90 days at a time. Extend it later if needed.');
  var newStart = String(form.newStart || '').trim();
  if (newStart) {
    if (!sbIsYmd_(newStart)) throw new Error('Enter a valid new installation date.');
    if (newStart < until) throw new Error('The new installation date can’t be before the resume date.');
    if (rnOf_(ctx.deployments, o['Rental ID']).length) throw new Error('Something is already installed – leave the installation date empty.');
  }
  return { reason: reason, note: note, until: until, newStart: newStart };
}
function rnApplyStandby_(ctx, o, c, me, requestedBy) {
  var f = { 'Standby Status': 'Active', 'Standby Reason': c.reason + (c.note ? ': ' + c.note : ''), 'Standby Until': sbYmdToDate_(c.until),
    'Standby New Start': c.newStart ? sbYmdToDate_(c.newStart) : '', 'Standby By': rnWho_(me), 'Standby Requested By': requestedBy || rnWho_(me) };
  var moved = '';
  if (c.newStart) {
    var oldStart = rnYmd_(o['Planned Start']), oldEnd = rnYmd_(o['Planned End']);
    f['Planned Start'] = sbYmdToDate_(c.newStart);
    if (oldStart && oldEnd) f['Planned End'] = sbYmdToDate_(sbAddDays_(c.newStart, sbDaysBetween_(oldStart, oldEnd))); // same length
    moved = '; installation moved ' + fmtYmd_(oldStart) + ' → ' + fmtYmd_(c.newStart);
  }
  rnSet_(ctx.orders, o, f);
  rnHistory_(ctx.orders, o, 'On standby until ' + fmtYmd_(c.until) + ' – ' + f['Standby Reason'] + moved, me);
}

/** CRE / Ops ask; Ananthu or a Director sets it straight away. form = { rentalId, reason, note, until, newStart } */
function requestRentalStandby_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var lock = rnLock_(), direct = rnIsCoordinator_(me), o, c;
  try {
    var ctx = rnLoad_();
    o = rnOrder_(ctx, id);
    if (o['Status'] !== 'Verified' && o['Status'] !== 'Acknowledged') throw new Error('Standby is for a verified, open rental.');
    rnAssertCre_(o, me);
    if (rnStandbyActive_(o) && !direct) throw new Error('Already on standby until ' + rnFmtDate_(o['Standby Until']) + '. Ask Ananthu to change it.');
    if (String(o['Standby Status']) === 'Requested' && !direct) throw new Error('A standby request is already waiting for Ananthu.');
    c = rnStandbyCheck_(form, o, ctx);
    if (direct) {
      rnApplyStandby_(ctx, o, c, me, String(o['Standby Status']) === 'Requested' ? String(o['Standby Requested By']) : '');
    } else {
      rnSet_(ctx.orders, o, { 'Standby Status': 'Requested', 'Standby Reason': c.reason + (c.note ? ': ' + c.note : ''), 'Standby Until': sbYmdToDate_(c.until),
        'Standby New Start': c.newStart ? sbYmdToDate_(c.newStart) : '', 'Standby Requested By': rnWho_(me), 'Standby By': '', 'Standby Requested At': new Date() });
      rnHistory_(ctx.orders, o, 'Asked for standby until ' + fmtYmd_(c.until) + ' – ' + c.reason + (c.note ? ': ' + c.note : ''), me);
    }
  } finally {
    lock.releaseLock();
  }
  if (!direct) {
    try {
      notify_('RENTAL_STANDBY_REQUEST', id, rnPeopleFor_('coordinator', getStaffMap_(false), getAlertSettings_()), {
        subject: 'Standby asked: ' + id + ' – ' + o['Customer'], email: true,
        text: me.name + ' asks to put ' + id + ' on standby until ' + fmtYmd_(c.until) + ': ' + c.reason + (c.note ? ' – ' + c.note : ''),
        html: '<p><b>' + rnEsc_(me.name) + '</b> asks to put rental <b>' + rnEsc_(id) + '</b> (' + rnEsc_(o['Customer']) + ') on standby until <b>' + rnEsc_(fmtYmd_(c.until)) +
          '</b>.</p><p>Reason: ' + rnEsc_(c.reason) + (c.note ? ' – ' + rnEsc_(c.note) : '') + (c.newStart ? '<br>New installation date: ' + rnEsc_(fmtYmd_(c.newStart)) : '') + '</p>',
        link: appUrl_() ? appUrl_() + '?page=rental' : '', linkLabel: 'Open Rentals'
      });
    } catch (e) { Logger.log('standby request notice failed: ' + e); }
  }
  return { trackerId: id, rentalId: id, active: direct, until: fmtYmd_(c.until) };
}

/** Ananthu / Director. form = { rentalId, approve, until (optional change), note } */
function decideRentalStandby_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var lock = rnLock_(), o, approve = !!(form && form.approve), who;
  try {
    var ctx = rnLoad_();
    o = rnOrder_(ctx, id);
    if (String(o['Standby Status']) !== 'Requested') throw new Error('No standby request is waiting on this rental.');
    who = String(o['Standby Requested By'] || '');
    if (approve) {
      var reason = String(o['Standby Reason'] || ''), i = reason.indexOf(': ');
      var c = rnStandbyCheck_({ reason: i === -1 ? reason : reason.slice(0, i), note: i === -1 ? '' : reason.slice(i + 2),
        until: form.until || rnYmd_(o['Standby Until']), newStart: rnYmd_(o['Standby New Start']) }, o, ctx);
      rnApplyStandby_(ctx, o, c, me, who);
    } else {
      var why = String(form.note || '').trim();
      if (why.length < 3) throw new Error('Say why, so the person who asked knows.');
      rnSet_(ctx.orders, o, { 'Standby Status': '', 'Standby Reason': '', 'Standby Until': '', 'Standby New Start': '', 'Standby By': '', 'Standby Requested By': '', 'Standby Requested At': '' });
      rnHistory_(ctx.orders, o, 'Standby request declined: ' + why, me);
    }
  } finally {
    lock.releaseLock();
  }
  try {
    var code = (who.match(/\(([^)]+)\)\s*$/) || [])[1];
    var p = code && getStaffMap_(false)[code];
    if (p) notify_('RENTAL_STANDBY_DECIDED', id, [staffRecipient_(p)], {
      subject: 'Standby ' + (approve ? 'approved' : 'declined') + ': ' + id, email: true,
      text: me.name + (approve ? ' approved' : ' declined') + ' standby on ' + id + (approve ? '' : ': ' + form.note),
      html: '<p>' + rnEsc_(me.name) + (approve ? ' approved' : ' declined') + ' the standby on rental <b>' + rnEsc_(id) + '</b>' + (approve ? '.' : ': ' + rnEsc_(form.note)) + '</p>'
    });
  } catch (e) { Logger.log('standby decision notice failed: ' + e); }
  return { trackerId: id, rentalId: id, approved: approve };
}

/** End a standby now, or withdraw a request. form = { rentalId } */
function endRentalStandby_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var lock = rnLock_();
  try {
    var ctx = rnLoad_();
    var o = rnOrder_(ctx, id);
    var st = String(o['Standby Status'] || '');
    if (!st) throw new Error('This rental isn’t on standby.');
    if (!rnIsCoordinator_(me)) {
      rnAssertCre_(o, me);
      if (me.role === 'Ops' && st === 'Active') throw new Error('Ask Ananthu to end the standby.');
    }
    rnEndStandby_(ctx, o, me, st === 'Requested' ? 'Standby request withdrawn' : 'Standby ended early');
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id };
}
function rnEndStandby_(ctx, o, me, text) {
  var was = String(o['Standby Status']) === 'Active';
  rnSet_(ctx.orders, o, { 'Standby Status': '', 'Standby Reason': '', 'Standby Until': '', 'Standby New Start': '', 'Standby By': '', 'Standby Requested By': '', 'Standby Requested At': '',
    'Standby Ended At': was ? new Date() : (o['Standby Ended At'] || '') });
  rnHistory_(ctx.orders, o, text, me);
}

// ================================================================
// Corrections
// ================================================================
/** Ananthu / Director: fix a date. form = { kind: 'install'|'offhire', id, date, reason } */
function correctRentalDate_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var kind = String((form && form.kind) || '');
  var ymd = rnValidYmd_(form && form.date, 'the correct date');
  var reason = String(form.reason || '').trim();
  if (reason.length < 5) throw new Error('Give the reason for the correction.');
  if (ymd > todayYmd_()) throw new Error('The date can’t be in the future.');
  var lock = rnLock_(), id, old, ref;
  try {
    var ctx = rnLoad_();
    if (kind === 'install') {
      var d = rnFind_(ctx.deployments, form.id);
      if (!d) throw new Error('Installation not found.');
      id = String(d['Rental ID']); ref = String(d['Deployment ID']);
      rnOpenOrder_(ctx, id);
      old = rnYmd_(d['Installed On']);
      rnSplit_(d['Items']).forEach(function (x) {
        var it = rnFind_(ctx.items, x);
        var t = it && rnFind_(ctx.trips, it['Trip ID']);
        if (t && rnYmd_(t['Gate At']) && ymd < rnYmd_(t['Gate At'])) throw new Error(x + ' left the factory on ' + rnFmtDate_(t['Gate At']) + '.');
        ctx.offhires.rows.forEach(function (r) {
          if (String(r['Rental ID']).toUpperCase() === id.toUpperCase() && rnSplit_(r['Items']).indexOf(x) !== -1 && rnYmd_(r['Off-hire On']) < ymd) {
            throw new Error(x + ' was off-hired on ' + rnFmtDate_(r['Off-hire On']) + ' – the installation can’t be after that.');
          }
        });
      });
      var pe = rnYmd_(d['Planned End']);
      if (pe && pe < ymd) throw new Error('That is after the planned end (' + fmtYmd_(pe) + '). Change the end date first.');
      rnSet_(ctx.deployments, d, { 'Installed On': sbYmdToDate_(ymd), 'Note': [String(d['Note'] || ''), 'Date corrected ' + fmtYmd_(old) + ' → ' + fmtYmd_(ymd) + ' by ' + me.name + ': ' + reason].filter(Boolean).join(' – ') });
    } else if (kind === 'offhire') {
      var r = rnFind_(ctx.offhires, form.id);
      if (!r) throw new Error('Off-hire not found.');
      id = String(r['Rental ID']); ref = String(r['Off-hire ID']);
      rnOpenOrder_(ctx, id);
      old = rnYmd_(r['Off-hire On']);
      rnSplit_(r['Items']).forEach(function (x) {
        var dd = ctx.deployments.rows.filter(function (q) { return String(q['Rental ID']).toUpperCase() === id.toUpperCase() && rnSplit_(q['Items']).indexOf(x) !== -1; })[0];
        if (dd && ymd < rnYmd_(dd['Installed On'])) throw new Error(x + ' was installed on ' + rnFmtDate_(dd['Installed On']) + '.');
      });
      if (rnYmd_(r['Suction Done On']) && rnYmd_(r['Suction Done On']) < ymd) throw new Error('Suction was recorded on ' + rnFmtDate_(r['Suction Done On']) + ' – the off-hire can’t be after that.');
      rnSet_(ctx.offhires, r, { 'Off-hire On': sbYmdToDate_(ymd), 'Note': [String(r['Note'] || ''), 'Date corrected ' + fmtYmd_(old) + ' → ' + fmtYmd_(ymd) + ' by ' + me.name + ': ' + reason].filter(Boolean).join(' – ') });
    } else {
      throw new Error('Choose what to correct.');
    }
    rnHistory_(ctx.orders, rnOrder_(ctx, id), 'Corrected ' + (kind === 'install' ? 'installation' : 'off-hire') + ' date of ' + ref + ': ' + fmtYmd_(old) + ' → ' + fmtYmd_(ymd) + ' (' + reason + ')', me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, ref: ref, from: fmtYmd_(old), to: fmtYmd_(ymd) };
}

/** Ananthu / Director: an installation recorded by mistake. Only while none of its items is off-hired. form = { deploymentId, reason } */
function undoRentalInstall_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var reason = String((form && form.reason) || '').trim();
  if (reason.length < 5) throw new Error('Give the reason.');
  var lock = rnLock_(), id, depId;
  try {
    var ctx = rnLoad_();
    var d = rnFind_(ctx.deployments, form.deploymentId);
    if (!d) throw new Error('Installation not found.');
    id = String(d['Rental ID']); depId = String(d['Deployment ID']);
    var o = rnOpenOrder_(ctx, id);
    var items = rnSplit_(d['Items']).map(function (x) { return rnFind_(ctx.items, x); });
    if (items.some(function (it) { return !it || it['Status'] !== RI_DEPLOYED; })) throw new Error('Some of these items are already off-hired or moved on. Undo the off-hire first, or correct the date instead.');
    if (String(o['Imported'] || '') === 'Y' && !rnOf_(ctx.trips, id).length) throw new Error('This rental was imported as already installed – correct the date instead.');
    items.forEach(function (it) {
      rnSet_(ctx.items, it, { 'Status': RI_TRANSIT, 'Deployment ID': '' });
      rnItemHistory_(ctx.items, it, 'Installation ' + depId + ' undone: ' + reason, me);
    });
    ctx.deployments.sheet.deleteRow(d._row);
    rnHistory_(ctx.orders, o, depId + ' undone (' + items.length + ' items back to “to install”): ' + reason + '. The site photo stays in Drive.', me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, deploymentId: depId };
}

/** Undo an off-hire recorded by mistake, while its items are still at site. CRE: same day, own record. Ananthu / Director: any time. form = { offhireId, reason } */
function undoRentalOffHire_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var reason = String((form && form.reason) || '').trim();
  if (reason.length < 5) throw new Error('Give the reason.');
  var lock = rnLock_(), id, ohId;
  try {
    var ctx = rnLoad_();
    var r = rnFind_(ctx.offhires, form.offhireId);
    if (!r) throw new Error('Off-hire not found.');
    id = String(r['Rental ID']); ohId = String(r['Off-hire ID']);
    var o = rnOpenOrder_(ctx, id);
    if (!rnIsCoordinator_(me)) {
      rnAssertCre_(o, me);
      if (String(r['Recorded By']).indexOf('(' + me.code + ')') === -1 || rnYmd_(r['Recorded At']) !== todayYmd_()) throw new Error('You can undo only your own off-hire, on the day you recorded it. Ask Ananthu.');
    }
    var items = rnSplit_(r['Items']).map(function (x) { return rnFind_(ctx.items, x); });
    if (items.some(function (it) { return !it || it['Status'] !== RI_OFFHIRED; })) throw new Error('Some of these items are already on a pickup or back. Cancel the pickup first.');
    items.forEach(function (it) {
      rnSet_(ctx.items, it, { 'Status': RI_DEPLOYED });
      rnItemHistory_(ctx.items, it, 'Off-hire ' + ohId + ' undone: ' + reason, me);
    });
    ctx.offhires.sheet.deleteRow(r._row);
    rnHistory_(ctx.orders, o, ohId + ' undone – ' + items.length + ' items back on hire (rent runs again): ' + reason + (r['Suction Done On'] ? '. The suction job stays in Vendor jobs.' : ''), me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, offhireId: ohId };
}

/** Ananthu / Ops: a planned pickup that isn't happening. form = { tripId, reason } */
function cancelRentalReturn_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var lock = rnLock_(), id, tripId;
  try {
    var ctx = rnLoad_();
    var t = rnFind_(ctx.trips, form && form.tripId);
    if (!t) throw new Error('Trip not found.');
    if (t['Direction'] !== 'Return' || t['Status'] !== 'Planned') throw new Error('Only a planned pickup that hasn’t come in can be cancelled.');
    id = String(t['Rental ID']); tripId = String(t['Trip ID']);
    rnSet_(ctx.trips, t, { 'Status': 'Cancelled', 'Gate Note': 'Cancelled by ' + me.name + (form.reason ? ': ' + String(form.reason).slice(0, 200) : '') });
    rnSplit_(t['Items']).forEach(function (x) {
      var it = rnFind_(ctx.items, x);
      if (it && it['Status'] === RI_RETURNING && String(it['Trip ID']).toUpperCase() === tripId.toUpperCase()) {
        rnSet_(ctx.items, it, { 'Status': RI_OFFHIRED, 'Trip ID': '' });
        rnItemHistory_(ctx.items, it, 'Pickup ' + tripId + ' cancelled', me);
      }
    });
    rnHistory_(ctx.orders, rnOrder_(ctx, id), 'Pickup ' + tripId + ' cancelled' + (form.reason ? ': ' + form.reason : ''), me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, tripId: tripId };
}

/** Same person or the Admin, within RN_UNDO_MINUTES. */
function rnGateCanUndo_(t, me, nowMs) {
  var at = rnMs_(t['Gate At']);
  if (!at || nowMs - at > RN_UNDO_MINUTES * 60000) return false;
  if (me.role === 'Admin') return true;
  return String(t['Gate By'] || '').indexOf('(' + me.code + ')') !== -1;
}

/** Sanju: a rental trip marked out by mistake. form = { tripId } */
function undoRentalTripOut_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var lock = rnLock_(), t, id;
  try {
    var ctx = rnLoad_();
    t = rnFind_(ctx.trips, form && form.tripId);
    if (!t || t['Direction'] !== 'Out' || t['Status'] !== 'Left') throw new Error('This trip isn’t marked out.');
    if (!rnGateCanUndo_(t, me, Date.now())) throw new Error('Only the person who marked it can undo, within ' + RN_UNDO_MINUTES + ' minutes. Ask the admin.');
    var items = rnSplit_(t['Items']).map(function (x) { return rnFind_(ctx.items, x); });
    if (items.some(function (it) { return !it || it['Status'] !== RI_TRANSIT; })) throw new Error('Some items are already marked installed – ask Ananthu.');
    id = String(t['Rental ID']);
    items.forEach(function (it) { rnSet_(ctx.items, it, { 'Status': RI_LOADED }); rnItemHistory_(ctx.items, it, 'Gate out undone (' + t['Trip ID'] + ')', me); });
    rnSet_(ctx.trips, t, { 'Status': 'Gate pass issued', 'Gate By': '', 'Gate At': '' });
    rnHistory_(ctx.orders, rnOrder_(ctx, id), t['Trip ID'] + ': gate out undone – back to waiting at the gate', me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, tripId: String(t['Trip ID']) };
}

/** Sanju: a pickup marked in by mistake. form = { tripId } */
function undoRentalTripIn_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var lock = rnLock_(), t, id;
  try {
    var ctx = rnLoad_();
    t = rnFind_(ctx.trips, form && form.tripId);
    if (!t || t['Direction'] !== 'Return' || t['Status'] !== 'Arrived') throw new Error('This pickup isn’t marked in.');
    if (!rnGateCanUndo_(t, me, Date.now())) throw new Error('Only the person who marked it can undo, within ' + RN_UNDO_MINUTES + ' minutes. Ask the admin.');
    var tripId = String(t['Trip ID']).toUpperCase();
    var missing = rnSplit_((String(t['Gate Note'] || '').match(/^Missing: ([^–]+)/) || [])[1] || '');
    var items = rnSplit_(t['Items']).map(function (x) { return rnFind_(ctx.items, x); });
    items.forEach(function (it) {
      if (!it) return;
      var x = String(it['Item ID']).toUpperCase();
      var ok = missing.indexOf(x) !== -1 ? it['Status'] === RI_OFFHIRED : (it['Status'] === RI_INSPECTION && String(it['Trip ID']).toUpperCase() === tripId);
      if (!ok) throw new Error(x + ' has already been inspected or moved – ask the admin.');
    });
    id = String(t['Rental ID']);
    items.forEach(function (it) { if (it) { rnSet_(ctx.items, it, { 'Status': RI_RETURNING, 'Trip ID': t['Trip ID'] }); rnItemHistory_(ctx.items, it, 'Gate in undone (' + t['Trip ID'] + ')', me); } });
    rnSet_(ctx.trips, t, { 'Status': 'Planned', 'Gate By': '', 'Gate At': '', 'Gate Note': '' });
    rnHistory_(ctx.orders, rnOrder_(ctx, id), t['Trip ID'] + ': gate in undone – expected at the gate again', me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, tripId: String(t['Trip ID']) };
}

// ================================================================
// Damage (from inspection)
// ================================================================
/** Lines in "Damage Notes": "T-0001 | note | photo url | yyyy-MM-dd" */
function rnAddDamage_(ctx, o, itemId, note, url) {
  var line = [itemId, String(note).replace(/[|\n]/g, ' '), url || '', todayYmd_()].join(' | ');
  var cur = String(o['Damage Notes'] || '');
  rnSet_(ctx.orders, o, { 'Damage Notes': (cur ? cur + '\n' : '') + line });
}
function rnDamages_(ctx, o) {
  var lines = rnOf_(ctx.payments, o['Rental ID']).filter(function (l) { return l['Kind'] === 'Damage' && l['Status'] !== 'Waived'; });
  return String(o['Damage Notes'] || '').split('\n').filter(Boolean).map(function (x) {
    var p = x.split(' | ');
    var item = String(p[0] || '').trim().toUpperCase();
    return { itemId: item, note: p[1] || '', photoUrl: p[2] || '', date: p[3] ? fmtYmd_(p[3]) : '',
      billed: lines.some(function (l) { return String(l['Note'] || '').toUpperCase().indexOf(item) !== -1; }) };
  });
}

// ================================================================
// Import a rental that was already installed at go-live
// ================================================================
/** Issues the next n IDs for a category. Call inside the lock. */
function rnIssueIds_(ctx, category, n) {
  var prefix = rnPrefixOf_(category);
  var max = 0, re = new RegExp('^' + prefix + '-(\\d+)$');
  ctx.items.rows.forEach(function (it) { var m = String(it['Item ID']).match(re); if (m) max = Math.max(max, Number(m[1])); });
  var ids = [];
  for (var i = 1; i <= n; i++) { var num = String(max + i); while (num.length < 4) num = '0' + num; ids.push(prefix + '-' + num); }
  return ids;
}

/**
 * Ananthu / Director. form = intake fields + creCode + installedOn + lines [{category, type, quantity}] + note.
 * The advance is optional here (it may have been settled long ago); if given, Accounts verifies it.
 */
function importRentalOnSite_(form) {
  rnAssertLive_();
  var me = rnMe_();
  form = form || {};
  var s = getRentalSettings_();
  var installed = rnValidYmd_(form.installedOn, 'the date it was installed');
  if (installed > todayYmd_()) throw new Error('The installation date can’t be in the future.');
  var f2 = {}; for (var k in form) f2[k] = form[k];
  f2.plannedStart = installed;
  // "Toilets requested" = the toilets at the site, unless typed in.
  if (!rnNum_(f2.toilets)) f2.toilets = (form.lines || []).filter(function (l) { return l && l.category === 'Toilet'; })
    .reduce(function (t, l) { return t + rnNum_(l.quantity); }, 0) || '';
  var c = rnCleanIntake_(f2, s, { imported: true });
  var cre = getStaffMap_(true)[String(form.creCode || '').toUpperCase()];
  if (!cre || !cre.active || cre.role !== 'CRE') throw new Error('Choose the CRE who handles this customer.');
  var lines = [];
  (form.lines || []).forEach(function (l) {
    var q = rnNum_(l && l.quantity), cat = String((l && l.category) || '').trim(), type = String((l && l.type) || '').trim() || cat;
    if (!q) return;
    if (!rnPrefixOf_(cat)) throw new Error('Unknown item category: ' + cat);
    if (q < 1 || Math.floor(q) !== q || q > RN_MAX_BATCH) throw new Error('Enter a whole number for ' + type + '.');
    lines.push({ category: cat, type: type, quantity: q });
  });
  if (!lines.length) throw new Error('Enter what is at the site – e.g. Toilet 20, Septic tank 5.');
  var lock = rnLock_(), id, ids = [];
  try {
    var ctx = rnLoad_();
    id = rnNextId_(ctx.orders, 'RNT');
    var now = new Date();
    var fields = rnOrderFields_(c);
    fields['Rental ID'] = id; fields['Logged At'] = now; fields['CRE Code'] = cre.code; fields['CRE Name'] = cre.name;
    fields['Status'] = 'Acknowledged'; fields['Imported'] = 'Y';
    fields['Verified By'] = 'Imported by ' + rnWho_(me); fields['Verified At'] = now;
    fields['Acknowledged By'] = rnWho_(me); fields['Acknowledged At'] = now;
    fields['Configured By'] = rnWho_(me); fields['Configured At'] = now;
    fields['History'] = rnStamp_() + ' ' + me.name + ': Imported – already installed on ' + fmtYmd_(installed) + ' (before rentals went live)' + (form.note ? ' – ' + String(form.note).slice(0, 200) : '');
    var o = rnAppend_(ctx.orders, fields);
    if (c.advanceAmount > 0) rnWriteIntakeLines_(ctx, id, c, me);
    else c.schedule.forEach(function (l) {
      rnAppend_(ctx.payments, { 'Line ID': rnNextId_(ctx.payments, 'RPL'), 'Rental ID': id, 'Kind': 'Instalment', 'Amount Due': l.amount,
        'Due Date': l.dueDate ? sbYmdToDate_(l.dueDate) : '', 'Due Trigger': l.trigger || '', 'Status': 'Due', 'Recorded By': rnWho_(me), 'Note': l.note || '' });
    });
    lines.forEach(function (l) {
      rnAppend_(ctx.config, { 'Rental ID': id, 'Category': l.category, 'Type': l.type, 'Quantity': l.quantity, 'Updated By': rnWho_(me), 'Updated At': now });
      rnIssueIds_(ctx, l.category, l.quantity).forEach(function (itemId) {
        rnAppend_(ctx.items, { 'Item ID': itemId, 'Category': l.category, 'Type': l.type, 'Status': RI_DEPLOYED, 'Rental ID': id,
          'Tagged At': now, 'Tagged By': rnWho_(me), 'Tagged For': id, 'Last Update': now, 'Condition Note': 'Stencil this ID when it comes back',
          'History': rnStamp_() + ' ' + me.name + ': ID given at import – at site since ' + fmtYmd_(installed) + ', not stencilled yet' });
        ids.push(itemId);
      });
    });
    var depId = rnNextId_(ctx.deployments, 'DEP');
    rnAppend_(ctx.deployments, { 'Deployment ID': depId, 'Rental ID': id, 'Items': ids.join(', '), 'Installed On': sbYmdToDate_(installed),
      'Planned End': sbYmdToDate_(c.plannedEnd), 'Photo URL': '', 'Marked By': rnWho_(me), 'Marked At': now, 'Note': 'Imported – already on site at go-live' });
    rnHistory_(ctx.orders, o, depId + ': ' + ids.length + ' items on site (' + ids[0] + ' to ' + ids[ids.length - 1] + ')', me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, count: ids.length, first: ids[0], last: ids[ids.length - 1] };
}

// ================================================================
// Period billing -- run inside rentalSweep_
// ================================================================
/**
 * For each open rental with "Auto Bill" set and something installed: every
 * completed period (7 or 30 days from the first installation) gets ONE check.
 * Owed by the period end (rent + charges, as of that date) minus what is paid
 * minus what is already billed and open = the new "Rent" line. Nothing is
 * raised while the advance still covers it. Returns the lines raised:
 * [{ o, amount, periodEnd }].
 */
function rnBillingSweep_(ctx, todayYmd) {
  var raised = [];
  ctx.orders.rows.forEach(function (o) {
    if (o['Status'] !== 'Acknowledged') return;
    var every = RENTAL_AUTO_BILL_DAYS[String(o['Auto Bill'] || '')];
    if (!every || !RENTAL_PERIOD_DAYS[String(o['Billing Mode'])]) return;
    var deps = rnOf_(ctx.deployments, o['Rental ID']);
    var first = deps.reduce(function (m, d) { var y = rnYmd_(d['Installed On']); return y && (!m || y < m) ? y : m; }, '');
    if (!first) return;
    var cell = String(o['Alerts Sent'] || '');
    for (var k = 1; k <= 60; k++) {
      var end = sbAddDays_(first, k * every - 1);
      if (end >= todayYmd) break; // period not over yet
      var tok = 'Bill-' + end;
      if (opsHasToken_(cell, tok)) continue;
      var m = rnMoney_(ctx, o, end);
      var open = rnOf_(ctx.payments, o['Rental ID']).filter(function (l) {
        return l['Kind'] !== 'Deposit' && (l['Status'] === 'Due' || l['Status'] === 'Paid – to verify');
      }).reduce(function (sum, l) { return sum + rnNum_(l['Status'] === 'Due' ? l['Amount Due'] : l['Amount Received']); }, 0);
      var amount = Math.round(m.due - m.received - open);
      if (amount > BALANCE_DUE_TOLERANCE) {
        var dueYmd = sbAddDays_(end, 1);
        rnAppend_(ctx.payments, { 'Line ID': rnNextId_(ctx.payments, 'RPL'), 'Rental ID': o['Rental ID'], 'Kind': 'Rent', 'Amount Due': amount,
          'Due Date': sbYmdToDate_(dueYmd), 'Due Trigger': '', 'Status': 'Due', 'Recorded By': 'System (period billing)',
          'Note': 'Rent up to ' + fmtYmd_(end) + ' (' + o['Auto Bill'].toLowerCase() + ')' });
        rnHistory_(ctx.orders, o, 'Rent bill raised: ' + rnRupees_(amount) + ' for the period up to ' + fmtYmd_(end), null);
        raised.push({ o: o, amount: amount, periodEnd: end });
      }
      cell = (cell ? cell + ' | ' : '') + tok + ' ' + rnStamp_();
      rnSet_(ctx.orders, o, { 'Alerts Sent': cell });
    }
  });
  return raised;
}

/** The parts of rentalSweep_ added in round 2: standby timers and period bills. Returns emails sent. */
function rnExtrasSweep_(ctx, nowMs, staffMap, cfg, todayYmd) {
  var sent = 0, s = getRentalSettings_();
  var link = appUrl_() ? appUrl_() + '?page=rental' : '';
  // Standby ends on its resume date.
  var ended = [], waiting = [];
  ctx.orders.rows.forEach(function (o) {
    var st = String(o['Standby Status'] || '');
    if (st === 'Active' && rnYmd_(o['Standby Until']) < todayYmd) { rnEndStandby_(ctx, o, null, 'Standby ended (resume date reached)'); ended.push(o); }
    // A request still undecided after the acknowledgement window: one reminder to Ananthu.
    if (st === 'Requested' && !opsHasToken_(o['Alerts Sent'], 'SbRequest') && opsWorkingHours_(rnMs_(o['Standby Requested At']), nowMs) >= s.ackHours) waiting.push(o);
  });
  if (ended.length) {
    var byCre = {};
    ended.forEach(function (o) { var k = String(o['CRE Code']); (byCre[k] = byCre[k] || []).push(o); });
    sent += notify_('RENTAL_STANDBY_ENDED', ended.length === 1 ? String(ended[0]['Rental ID']) : '', rnPeopleFor_('coordinator', staffMap, cfg), {
      subject: 'Standby over: ' + ended.length + ' rental' + (ended.length === 1 ? '' : 's') + ' back in the queue', email: true,
      text: 'Standby ended: ' + ended.map(function (o) { return o['Rental ID'] + ' – ' + o['Customer']; }).join('; '),
      html: '<p>These rentals reached their resume date and are back in the normal queue, with reminders running again:</p><ul>' +
        ended.map(function (o) { return '<li>' + rnEsc_(o['Rental ID'] + ' – ' + o['Customer'] + ', installation ' + rnFmtDate_(o['Planned Start'])) + '</li>'; }).join('') + '</ul>',
      link: link, linkLabel: 'Open Rentals'
    });
    Object.keys(byCre).forEach(function (k) {
      var to = rnCreRecipients_(k, staffMap).map(staffRecipient_);
      if (to.length) notify_('RENTAL_STANDBY_ENDED', '', to, { subject: 'Standby over on your rental(s)', email: false,
        text: 'Standby ended: ' + byCre[k].map(function (o) { return o['Rental ID']; }).join(', ') });
    });
  }
  // Period bills.
  var raised = rnBillingSweep_(ctx, todayYmd);
  if (raised.length) {
    var acc = rnPeopleFor_('accounts', staffMap, cfg);
    sent += notify_('RENTAL_RENT_BILLS', raised.length === 1 ? String(raised[0].o['Rental ID']) : '', acc, {
      subject: raised.length + ' rent bill' + (raised.length === 1 ? '' : 's') + ' raised – invoice the customer' + (raised.length === 1 ? '' : 's'), email: true,
      text: raised.map(function (r) { return r.o['Rental ID'] + ' ' + rnRupees_(r.amount); }).join('; '),
      html: '<p>The period ended on these rentals. The system raised a rent line for what is owed beyond what is paid. Send the invoice; the CRE follows up.</p><ul>' +
        raised.map(function (r) { return '<li>' + rnEsc_(r.o['Rental ID'] + ' – ' + r.o['Customer'] + ': ' + rnRupees_(r.amount) + ' (up to ' + fmtYmd_(r.periodEnd) + ')') + '</li>'; }).join('') + '</ul>',
      link: link, linkLabel: 'Open Rentals'
    });
    raised.forEach(function (r) {
      var to = rnCreRecipients_(r.o['CRE Code'], staffMap).map(staffRecipient_);
      if (to.length) sent += notify_('RENTAL_RENT_BILL', String(r.o['Rental ID']), to, {
        subject: 'Rent due: ' + r.o['Rental ID'] + ' – ' + rnRupees_(r.amount), email: true,
        text: 'Rent of ' + rnRupees_(r.amount) + ' raised on ' + r.o['Rental ID'] + ' for the period up to ' + fmtYmd_(r.periodEnd) + '. Collect it and mark it paid.',
        html: '<p>Rent of <b>' + rnRupees_(r.amount) + '</b> is now due on <b>' + rnEsc_(r.o['Rental ID']) + '</b> (' + rnEsc_(r.o['Customer']) + ') for the period up to ' + rnEsc_(fmtYmd_(r.periodEnd)) +
          '. Accounts sends the invoice; collect it and mark it “Customer paid” on the Rentals page.</p>',
        link: link, linkLabel: 'Open Rentals'
      });
    });
  }
  // Standby requests waiting for Ananthu: one reminder.
  if (waiting.length) {
    sent += notify_('RENTAL_STANDBY_WAITING', waiting.length === 1 ? String(waiting[0]['Rental ID']) : '', rnPeopleFor_('coordinator', staffMap, cfg), {
      subject: 'Standby request' + (waiting.length === 1 ? '' : 's') + ' waiting for you', email: true,
      text: waiting.map(function (o) { return o['Rental ID'] + ' – ' + o['Standby Reason']; }).join('; '),
      html: '<ul>' + waiting.map(function (o) { return '<li>' + rnEsc_(o['Rental ID'] + ' – ' + o['Customer'] + ': ' + o['Standby Reason'] + ', until ' + rnFmtDate_(o['Standby Until']) + ' (asked by ' + String(o['Standby Requested By']).replace(/\s*\([^)]*\)$/, '') + ')') + '</li>'; }).join('') + '</ul>',
      link: link, linkLabel: 'Open Rentals'
    });
    waiting.forEach(function (o) { var cur = String(o['Alerts Sent'] || ''); rnSet_(ctx.orders, o, { 'Alerts Sent': (cur ? cur + ' | ' : '') + 'SbRequest ' + rnStamp_() }); });
  }
  return sent;
}

// ================================================================
// Owner Dashboard card
// ================================================================
function getRentalDashboard_() {
  if (!rnIsLive_()) return { live: false };
  var ctx = rnLoad_();
  var today = todayYmd_();
  var out = { live: true, open: 0, toAck: 0, scheduled: 0, standby: 0, standbyRequests: 0, onHireRentals: 0, overrunRentals: 0,
    items: { deployed: 0, out: 0, offhired: 0, available: 0, repair: 0, inspection: 0 },
    money: { balance: 0, overdue: 0, overrunUnbilled: 0, cost: 0, rentBillsOpen: 0 }, shortages: 0, damagesUnbilled: 0, lateInstalls: 0, latePickups: 0 };
  var s = getRentalSettings_();
  ctx.items.rows.forEach(function (it) {
    var st = it['Status'];
    if (st === RI_DEPLOYED) out.items.deployed++;
    if (RI_OUT.indexOf(st) !== -1) out.items.out++;
    if (st === RI_OFFHIRED) out.items.offhired++;
    if (st === RI_AVAILABLE) out.items.available++;
    if (st === RI_REPAIR) out.items.repair++;
    if (st === RI_INSPECTION) out.items.inspection++;
  });
  ctx.orders.rows.forEach(function (o) {
    var st = String(o['Status']);
    if (['Logged', 'Verified', 'Acknowledged'].indexOf(st) === -1) return;
    out.open++;
    if (String(o['Standby Status']) === 'Requested') out.standbyRequests++;
    if (rnStandbyActive_(o, today)) out.standby++;
    if (st === 'Verified') { if (rnYmd_(o['Remind On']) > today) out.scheduled++; else out.toAck++; }
    if (st === 'Logged') return;
    var id = String(o['Rental ID']);
    var m = rnMoney_(ctx, o);
    out.money.balance += Math.max(0, m.balance); out.money.overrunUnbilled += m.overrunUnbilled; out.money.cost += rnCost_(ctx, id).total;
    var sum = rnItemSummary_(ctx, id);
    if (sum.by[RI_DEPLOYED]) out.onHireRentals++;
    if (m.overrunDays && sum.by[RI_DEPLOYED]) {
      var running = rnOf_(ctx.deployments, id).some(function (d) {
        var end = rnYmd_(d['Planned End']) || rnYmd_(o['Planned End']);
        return end && end < today && rnSplit_(d['Items']).some(function (x) { var it = rnFind_(ctx.items, x); return it && it['Status'] === RI_DEPLOYED; });
      });
      if (running) out.overrunRentals++;
    }
    if (st === 'Acknowledged') {
      out.shortages += rnShortages_(ctx, id).length ? 1 : 0;
      var start = rnYmd_(o['Planned Start']);
      if (start && start < today && !rnOf_(ctx.deployments, id).length && !rnStandbyActive_(o, today)) out.lateInstalls++;
      rnOf_(ctx.offhires, id).forEach(function (r) {
        var waiting = rnSplit_(r['Items']).some(function (x) { var it = rnFind_(ctx.items, x); return it && it['Status'] === RI_OFFHIRED; });
        if (waiting && rnWorkingDays_(rnDayStartMs_(rnYmd_(r['Off-hire On'])) + 86400000, Date.now()) >= s.pickupDays) out.latePickups++;
      });
      out.damagesUnbilled += rnDamages_(ctx, o).filter(function (d) { return !d.billed; }).length;
    }
    rnOf_(ctx.payments, id).forEach(function (l) {
      if (l['Status'] !== 'Due') return;
      if (l['Kind'] === 'Rent') out.money.rentBillsOpen += rnNum_(l['Amount Due']);
      var due = rnLineDue_(ctx, o, l, sum);
      if (due && due < today) out.money.overdue += rnNum_(l['Amount Due']);
    });
  });
  return out;
}

// ================================================================
// Wiring
// ================================================================
function rentalExtrasApiMap_() {
  var DIR = ['Director'];
  return {
    reassignRental:        { fn: reassignRental_,        roles: [],                      log: 'Reassigned rental' },
    requestRentalStandby:  { fn: requestRentalStandby_,  roles: ['CRE', 'Ops', 'Director'], log: 'Rental standby' },
    decideRentalStandby:   { fn: decideRentalStandby_,   roles: DIR,                     log: 'Decided rental standby' },
    endRentalStandby:      { fn: endRentalStandby_,      roles: ['CRE', 'Ops', 'Director'], log: 'Ended rental standby' },
    correctRentalDate:     { fn: correctRentalDate_,     roles: DIR,                     log: 'Corrected rental date' },
    undoRentalInstall:     { fn: undoRentalInstall_,     roles: DIR,                     log: 'Undid rental installation' },
    undoRentalOffHire:     { fn: undoRentalOffHire_,     roles: ['CRE', 'Director'],     log: 'Undid rental off-hire' },
    cancelRentalReturn:    { fn: cancelRentalReturn_,    roles: ['Ops', 'Director'],     log: 'Cancelled rental pickup' },
    undoRentalTripOut:     { fn: undoRentalTripOut_,     roles: ['Gate'],                log: 'Undid rental trip out' },
    undoRentalTripIn:      { fn: undoRentalTripIn_,      roles: ['Gate'],                log: 'Undid rental pickup in' },
    importRentalOnSite:    { fn: importRentalOnSite_,    roles: DIR,                     log: 'Imported rental already on site' },
    getRentalDashboard:    { fn: getRentalDashboard_,    roles: DIR }
  };
}

function rentalExtrasActivityDetail_(fnName, a, result) {
  a = a || {}; result = result || {};
  switch (fnName) {
    case 'reassignRental': return (result.from || '') + ' → ' + (result.to || '');
    case 'requestRentalStandby': return (result.active ? 'Set' : 'Asked') + ' until ' + (result.until || '') + ' – ' + (a.reason || '') + (a.note ? ': ' + a.note : '');
    case 'decideRentalStandby': return result.approved ? 'Approved' : 'Declined: ' + (a.note || '');
    case 'endRentalStandby': return 'Ended / withdrawn';
    case 'correctRentalDate': return (result.ref || '') + ': ' + (result.from || '') + ' → ' + (result.to || '') + ' – ' + (a.reason || '');
    case 'undoRentalInstall': return (result.deploymentId || '') + ' – ' + (a.reason || '');
    case 'undoRentalOffHire': return (result.offhireId || '') + ' – ' + (a.reason || '');
    case 'cancelRentalReturn': return (result.tripId || '') + (a.reason ? ' – ' + a.reason : '');
    case 'undoRentalTripOut': case 'undoRentalTripIn': return result.tripId || '';
    case 'importRentalOnSite': return (a.customer || '') + ' – ' + (result.count || 0) + ' items, ' + (result.first || '') + ' to ' + (result.last || '');
    default: return '';
  }
}
