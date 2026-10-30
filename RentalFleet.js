/**
 * RENTALS -- the items: tagging, trips, gate, installation, off-hire,
 * suction, pickup and inspection (Oct 2026). See the note at the top of
 * Rental.js for the whole flow. Every function here works on whole items
 * by their stencilled ID; the counts the pages show are worked out from
 * the Rental Items tab, never typed.
 *
 * ITEM LIFE:  Available -> Allocated (to a rental) -> Loaded (on a trip,
 * gate pass requested) -> In Transit (the gate marked the trip out) ->
 * Deployed (installed: rent starts) -> Off-hired (rent stops; waiting for
 * suction and pickup) -> Returning (on a return trip) -> Inspection (the gate
 * marked it in) -> Available, or Under Repair -> Available. Lost / Scrapped
 * are written off by a Director or the Admin.
 */

var RN_MAX_BATCH = 300; // items in one action
var RN_INSTALL_BACKDATE_DAYS = 7; // Ananthu; more needs a Director
var RN_OFFHIRE_BACKDATE_DAYS_CRE = 2; // CREs; Ananthu / Directors may go further (logged)
// Loading photo on a dispatch trip (Oct 2026 round 2): optional for now, like the courier receipt
// photo. Set to true to make it required -- the Rentals page follows this automatically.
var RN_LOAD_PHOTO_REQUIRED = false;

function rnTripView_(t) {
  return {
    tripId: String(t['Trip ID']), rentalId: String(t['Rental ID']), direction: String(t['Direction']),
    items: rnSplit_(t['Items']), counts: String(t['Counts'] || ''), vehicleNo: String(t['Vehicle No.'] || ''),
    transport: String(t['Transport'] || ''), vendor: String(t['Vendor'] || ''), cost: rnNum_(t['Cost']),
    status: String(t['Status']), createdBy: String(t['Created By'] || ''), createdAt: rnFmtTime_(t['Created At']),
    gatePassNo: String(t['Gate Pass No.'] || ''), gatePassUrl: String(t['Gate Pass URL'] || ''),
    gatePassIssuedAt: rnFmtTime_(t['Gate Pass Issued At']), gateBy: String(t['Gate By'] || ''),
    gateAt: rnFmtTime_(t['Gate At']), gateNote: String(t['Gate Note'] || ''), photoUrl: String(t['Photo URL'] || '')
  };
}

function rnItemView_(it) {
  return {
    itemId: String(it['Item ID']), category: String(it['Category']), type: String(it['Type']), status: String(it['Status']),
    rentalId: String(it['Rental ID'] || ''), tripId: String(it['Trip ID'] || ''), note: String(it['Condition Note'] || ''),
    lastUpdate: rnFmtTime_(it['Last Update'])
  };
}

/** "12 Toilet, 3 Septic tank" from item rows. */
function rnCounts_(items) {
  var c = {};
  items.forEach(function (it) { c[it['Type']] = (c[it['Type']] || 0) + 1; });
  return Object.keys(c).map(function (k) { return c[k] + ' ' + k; }).join(', ');
}

/** The listed IDs as item rows; every one must exist, belong to this rental (when given) and be in one of `statuses`. */
function rnPickItems_(ctx, ids, rentalId, statuses, what) {
  ids = rnUniq_(rnSplit_(Array.isArray(ids) ? ids.join(' ') : ids));
  if (!ids.length) throw new Error('Choose the items' + (what ? ' to ' + what : '') + '.');
  if (ids.length > RN_MAX_BATCH) throw new Error('At most ' + RN_MAX_BATCH + ' items at a time.');
  var bad = [];
  var rows = ids.map(function (x) {
    var it = rnFind_(ctx.items, x);
    if (!it) { bad.push(x + ' (no such item)'); return null; }
    if (rentalId && String(it['Rental ID']).toUpperCase() !== String(rentalId).toUpperCase()) { bad.push(x + ' (not on ' + rentalId + ')'); return null; }
    if (statuses && statuses.indexOf(it['Status']) === -1) { bad.push(x + ' (' + it['Status'] + ')'); return null; }
    return it;
  });
  if (bad.length) throw new Error('These can’t be used: ' + bad.join(', ') + '.');
  return rows;
}

function rnOpenOrder_(ctx, rentalId) {
  var o = rnOrder_(ctx, rentalId);
  if (o['Status'] !== 'Acknowledged') throw new Error('Rental ' + o['Rental ID'] + ' isn’t open for this (status: ' + o['Status'] + ').');
  return o;
}

function rnMoneyValue_(v, label) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  var n = rnNum_(s);
  if (n < 0) throw new Error('Enter a valid ' + label + '.');
  return n;
}

// ================================================================
// Manoj -- tag and allocate
// ================================================================
/** Remaining room per category|type on a rental: configured minus already covered. */
function rnRoom_(ctx, rentalId) {
  var room = {};
  rnItemSummary_(ctx, rentalId).need.forEach(function (n) { room[n.category + '|' + n.type] = Math.max(0, n.quantity - n.have); });
  return room;
}

/** Issue new IDs for untagged items going to this rental. form = { rentalId, category, type, count } */
function tagRentalItems_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var cat = String((form && form.category) || '').trim(), type = String((form && form.type) || '').trim() || cat;
  var n = rnNum_(form && form.count);
  var prefix = rnPrefixOf_(cat);
  if (!prefix) throw new Error('Choose the category.');
  if (n < 1 || Math.floor(n) !== n || n > RN_MAX_BATCH) throw new Error('Enter how many to tag (1 to ' + RN_MAX_BATCH + ').');
  var lock = rnLock_(), ids = [];
  try {
    var ctx = rnLoad_();
    var o = rnOpenOrder_(ctx, id);
    var room = rnRoom_(ctx, id)[cat + '|' + type];
    if (room === undefined) throw new Error(type + ' isn’t in this rental’s configuration. Ask Ananthu to add it.');
    if (n > room) throw new Error('Only ' + room + ' more ' + type + ' needed on ' + id + '.');
    var max = 0, re = new RegExp('^' + prefix + '-(\\d+)$');
    ctx.items.rows.forEach(function (it) { var m = String(it['Item ID']).match(re); if (m) max = Math.max(max, Number(m[1])); });
    var now = new Date();
    for (var i = 1; i <= n; i++) {
      var num = String(max + i);
      while (num.length < 4) num = '0' + num;
      var itemId = prefix + '-' + num;
      rnAppend_(ctx.items, { 'Item ID': itemId, 'Category': cat, 'Type': type, 'Status': RI_ALLOCATED, 'Rental ID': id,
        'Tagged At': now, 'Tagged By': rnWho_(me), 'Tagged For': id, 'Last Update': now,
        'History': rnStamp_() + ' ' + me.name + ': Tagged and allocated to ' + id });
      ids.push(itemId);
    }
    var t = ctx.types.rows.filter(function (r) { return r['Category'] === cat && r['Type'] === type; })[0];
    if (t && rnNum_(t['Untagged In Yard']) > 0) rnSet_(ctx.types, t, { 'Untagged In Yard': Math.max(0, rnNum_(t['Untagged In Yard']) - n) });
    rnHistory_(ctx.orders, o, 'Tagged ' + n + ' × ' + type + ': ' + ids[0] + (n > 1 ? ' to ' + ids[ids.length - 1] : ''), me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, ids: ids, first: ids[0], last: ids[ids.length - 1], type: type };
}

/** Put already-tagged items from the yard on this rental. form = { rentalId, itemIds } */
function allocateRentalItems_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var lock = rnLock_(), picked;
  try {
    var ctx = rnLoad_();
    var o = rnOpenOrder_(ctx, id);
    picked = rnPickItems_(ctx, form.itemIds, null, [RI_AVAILABLE], 'allocate');
    var room = rnRoom_(ctx, id), want = {};
    picked.forEach(function (it) { var k = it['Category'] + '|' + it['Type']; want[k] = (want[k] || 0) + 1; });
    var errs = [];
    Object.keys(want).forEach(function (k) {
      var r = room[k];
      if (r === undefined) errs.push(k.split('|')[1] + ' isn’t in the configuration');
      else if (want[k] > r) errs.push('only ' + r + ' more ' + k.split('|')[1] + ' needed');
    });
    if (errs.length) throw new Error('Can’t allocate: ' + errs.join('; ') + '.');
    picked.forEach(function (it) {
      rnSet_(ctx.items, it, { 'Status': RI_ALLOCATED, 'Rental ID': id, 'Trip ID': '', 'Deployment ID': '' });
      rnItemHistory_(ctx.items, it, 'Allocated to ' + id, me);
    });
    rnHistory_(ctx.orders, o, 'Allocated ' + rnCounts_(picked) + ': ' + picked.map(function (x) { return x['Item ID']; }).join(', '), me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, count: picked.length };
}

/** Take allocated (not loaded) items off a rental, back to the yard. form = { rentalId, itemIds } */
function releaseRentalItems_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var lock = rnLock_(), picked;
  try {
    var ctx = rnLoad_();
    var o = rnOrder_(ctx, id);
    picked = rnPickItems_(ctx, form.itemIds, id, [RI_ALLOCATED], 'release');
    picked.forEach(function (it) {
      rnSet_(ctx.items, it, { 'Status': RI_AVAILABLE, 'Rental ID': '', 'Trip ID': '', 'Deployment ID': '' });
      rnItemHistory_(ctx.items, it, 'Released from ' + id, me);
    });
    rnHistory_(ctx.orders, o, 'Released ' + picked.map(function (x) { return x['Item ID']; }).join(', '), me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, count: picked.length };
}

// ================================================================
// Trips out -- Manoj loads, Accounts issues the gate pass, Sanju marks it out
// ================================================================
/** form = { rentalId, itemIds, vehicleNo, transport: 'Own'|'Hired', vendor, cost } */
function createRentalTrip_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var vehicle = String((form && form.vehicleNo) || '').trim().toUpperCase().replace(/\s+/g, ' ');
  var transport = String((form && form.transport) || '').trim();
  if (!vehicle) throw new Error('Enter the vehicle number.');
  if (transport !== 'Own' && transport !== 'Hired') throw new Error('Is it our own vehicle or a hired one?');
  var vendor = String(form.vendor || '').trim();
  if (transport === 'Hired' && !vendor) throw new Error('Enter the transporter for a hired vehicle.');
  var cost = rnMoneyValue_(form.cost, 'transport cost');
  var hasPhoto = !!(form.photo && form.photo.data);
  if (RN_LOAD_PHOTO_REQUIRED && !hasPhoto) throw new Error('Take a photo of the loaded vehicle – it shows the condition the items left in.');
  // Check before saving the photo, so a refused trip leaves no file behind.
  rnPickItems_(rnLoad_(), form.itemIds, id, [RI_ALLOCATED], 'load');
  var photoUrl = hasPhoto ? rnSaveUpload_(form.photo, id, 'Loading ' + vehicle + ' ' + todayYmd_()) : '';
  var lock = rnLock_(), tripId, picked;
  try {
    var ctx = rnLoad_();
    var o = rnOpenOrder_(ctx, id);
    picked = rnPickItems_(ctx, form.itemIds, id, [RI_ALLOCATED], 'load');
    tripId = rnNextId_(ctx.trips, 'RTR');
    rnAppend_(ctx.trips, {
      'Trip ID': tripId, 'Rental ID': id, 'Direction': 'Out', 'Items': picked.map(function (x) { return x['Item ID']; }).join(', '),
      'Counts': rnCounts_(picked), 'Vehicle No.': vehicle, 'Transport': transport, 'Vendor': vendor, 'Cost': cost,
      'Status': 'Gate pass requested', 'Created By': rnWho_(me), 'Created At': new Date(), 'Photo URL': photoUrl
    });
    picked.forEach(function (it) {
      rnSet_(ctx.items, it, { 'Status': RI_LOADED, 'Trip ID': tripId });
      rnItemHistory_(ctx.items, it, 'Loaded on ' + tripId + ' (' + vehicle + ')', me);
    });
    rnHistory_(ctx.orders, o, tripId + ': loaded ' + rnCounts_(picked) + ' on ' + vehicle + ' – gate pass requested', me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, tripId: tripId, counts: rnCounts_(picked), vehicleNo: vehicle };
}

/** Before the gate pass is issued: unload. form = { tripId } */
function cancelRentalTrip_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var lock = rnLock_(), id, tripId;
  try {
    var ctx = rnLoad_();
    var t = rnFind_(ctx.trips, form && form.tripId);
    if (!t) throw new Error('Trip not found.');
    tripId = String(t['Trip ID']); id = String(t['Rental ID']);
    var issued = t['Status'] === 'Gate pass issued';
    if (t['Direction'] !== 'Out' || !(t['Status'] === 'Gate pass requested' || (issued && me.role === 'Admin'))) {
      throw new Error(issued ? 'The gate pass is already issued – ask the admin to cancel it.' : 'This trip can’t be cancelled (status: ' + t['Status'] + ').');
    }
    rnSet_(ctx.trips, t, { 'Status': 'Cancelled', 'Gate Note': 'Cancelled by ' + me.name + (form.reason ? ': ' + String(form.reason).slice(0, 200) : '') });
    rnSplit_(t['Items']).forEach(function (x) {
      var it = rnFind_(ctx.items, x);
      if (it && it['Status'] === RI_LOADED && String(it['Trip ID']).toUpperCase() === tripId.toUpperCase()) {
        rnSet_(ctx.items, it, { 'Status': RI_ALLOCATED, 'Trip ID': '' });
        rnItemHistory_(ctx.items, it, tripId + ' cancelled – back to allocated', me);
      }
    });
    rnHistory_(ctx.orders, rnOrder_(ctx, id), tripId + ' cancelled' + (issued ? ' (gate pass ' + t['Gate Pass No.'] + ' void)' : ''), me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, tripId: tripId };
}

/** Accounts: issue and print the rental gate pass. form = { tripId } */
function issueRentalGatePass_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var lock = rnLock_(), t, o, gpNo, ctx;
  try {
    ctx = rnLoad_();
    t = rnFind_(ctx.trips, form && form.tripId);
    if (!t) throw new Error('Trip not found.');
    if (t['Direction'] !== 'Out' || t['Status'] !== 'Gate pass requested') throw new Error('No gate pass is waiting on this trip (status: ' + t['Status'] + ').');
    o = rnOpenOrder_(ctx, t['Rental ID']);
    var max = 0;
    ctx.trips.rows.forEach(function (r) { var m = String(r['Gate Pass No.'] || '').match(/^RGP-(\d+)$/); if (m) max = Math.max(max, Number(m[1])); });
    gpNo = 'RGP-' + ('000' + (max + 1)).slice(-Math.max(4, String(max + 1).length));
    rnSet_(ctx.trips, t, { 'Status': 'Gate pass issued', 'Gate Pass No.': gpNo, 'Gate Pass Issued By': rnWho_(me), 'Gate Pass Issued At': new Date() });
    rnHistory_(ctx.orders, o, 'Gate pass ' + gpNo + ' issued for ' + t['Trip ID'], me);
  } finally {
    lock.releaseLock();
  }
  var url = '';
  try {
    url = rnGatePassPdf_(ctx, t, o, gpNo, me);
    var trips = rnTable_('trips');
    rnSet_(trips, rnFind_(trips, t['Trip ID']), { 'Gate Pass URL': url });
  } catch (e) {
    Logger.log('rental gate pass PDF failed: ' + e);
  }
  return { trackerId: String(o['Rental ID']), rentalId: String(o['Rental ID']), tripId: String(t['Trip ID']), gatePassNo: gpNo, url: url };
}

/** The printed gate pass: the vehicle, the site, and every item ID grouped by type. */
function rnGatePassPdf_(ctx, t, o, gpNo, me) {
  var ids = rnSplit_(t['Items']);
  var groups = {};
  ids.forEach(function (x) {
    var it = rnFind_(ctx.items, x);
    var k = it ? it['Type'] : rnCategoryOfId_(x);
    (groups[k] = groups[k] || []).push(x);
  });
  var e = rnEsc_;
  var rows = Object.keys(groups).map(function (k) {
    return '<tr><td style="padding:6px;border:1px solid #999;font-weight:bold;">' + e(k) + '</td><td style="padding:6px;border:1px solid #999;text-align:center;">' + groups[k].length +
      '</td><td style="padding:6px;border:1px solid #999;font-family:monospace;">' + e(groups[k].join(', ')) + '</td><td style="padding:6px;border:1px solid #999;width:60px;"></td></tr>';
  }).join('');
  var html = '<html><body style="font-family:Arial,sans-serif;font-size:12px;color:#000;">' +
    '<h2 style="margin:0;">INDIAN CENTRIFUGE ENGINEERING SOLUTIONS PVT LTD</h2>' +
    '<h3 style="margin:4px 0 12px;">RENTAL GATE PASS &nbsp; ' + e(gpNo) + '</h3>' +
    '<table style="border-collapse:collapse;width:100%;margin-bottom:12px;">' +
    '<tr><td><b>Rental</b> ' + e(o['Rental ID']) + '</td><td><b>Trip</b> ' + e(t['Trip ID']) + '</td><td><b>Date</b> ' + e(opsFmt_(new Date())) + '</td></tr>' +
    '<tr><td colspan="2"><b>Customer</b> ' + e(o['Customer']) + '</td><td><b>Vehicle</b> ' + e(t['Vehicle No.']) + ' (' + e(t['Transport']) + (t['Vendor'] ? ' – ' + e(t['Vendor']) : '') + ')</td></tr>' +
    '<tr><td colspan="3"><b>Site</b> ' + e(o['Site Address']) + (o['Site District'] ? ', ' + e(o['Site District']) : '') + ' &nbsp; <b>Site contact</b> ' + e(o['Site Contact']) + ' ' + e(o['Site Contact Phone']) + '</td></tr></table>' +
    '<table style="border-collapse:collapse;width:100%;"><tr style="background:#eee;"><th style="padding:6px;border:1px solid #999;">Item</th><th style="padding:6px;border:1px solid #999;">Qty</th><th style="padding:6px;border:1px solid #999;">IDs (stencilled)</th><th style="padding:6px;border:1px solid #999;">Checked</th></tr>' + rows +
    '<tr><td style="padding:6px;border:1px solid #999;font-weight:bold;">Total</td><td style="padding:6px;border:1px solid #999;text-align:center;font-weight:bold;">' + ids.length + '</td><td colspan="2" style="border:1px solid #999;"></td></tr></table>' +
    '<p style="margin-top:14px;">RENTAL – returnable property of ICF. Not for sale.</p>' +
    '<table style="width:100%;margin-top:40px;"><tr><td>Loaded by: ' + e(String(t['Created By']).replace(/\s*\([^)]*\)$/, '')) + '</td><td>Issued by: ' + e(me.name) + '</td><td>Driver name &amp; phone: ____________________</td><td>Gate: ____________</td></tr></table>' +
    '</body></html>';
  var blob = Utilities.newBlob(html, 'text/html', 'Rental Gate Pass - ' + gpNo + '.html').getAs('application/pdf').setName('Rental Gate Pass - ' + sanitizeForFilename(gpNo) + ' - ' + sanitizeForFilename(o['Rental ID']) + '.pdf');
  var file = getOrCreateFolder(RENTAL_GATE_PASS_FOLDER_NAME).createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

// ================================================================
// Gate -- Sanju (on the Gate page)
// ================================================================
function getRentalGateQueue_() {
  var out = { live: rnIsLive_(), out: [], expected: [], today: [] };
  if (!out.live) return out;
  var ctx = rnLoad_();
  var today = todayYmd_();
  ctx.trips.rows.forEach(function (t) {
    var v = rnTripView_(t);
    var o = rnFind_(ctx.orders, t['Rental ID']);
    v.customer = o ? String(o['Customer']) : '';
    v.site = o ? [o['Site District'], o['Site State']].filter(function (x) { return String(x || '').trim(); }).join(', ') : '';
    if (t['Direction'] === 'Out' && t['Status'] === 'Gate pass issued') out.out.push(v);
    else if (t['Direction'] === 'Return' && t['Status'] === 'Planned') out.expected.push(v);
    else if ((t['Status'] === 'Left' || t['Status'] === 'Arrived') && rnYmd_(t['Gate At']) === today) {
      v.canUndo = typeof rnGateCanUndo_ === 'function' && rnGateCanUndo_(t, CURRENT_STAFF_ || {}, Date.now());
      out.today.push(v);
    }
  });
  return out;
}

/** Sanju: the rental vehicle has left. form = { tripId } */
function markRentalTripOut_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var lock = rnLock_(), t, id;
  try {
    var ctx = rnLoad_();
    t = rnFind_(ctx.trips, form && form.tripId);
    if (!t) throw new Error('Trip not found.');
    if (t['Direction'] !== 'Out' || t['Status'] !== 'Gate pass issued') throw new Error('This trip isn’t waiting at the gate (status: ' + t['Status'] + '). Refresh the list.');
    id = String(t['Rental ID']);
    var now = new Date();
    rnSet_(ctx.trips, t, { 'Status': 'Left', 'Gate By': rnWho_(me), 'Gate At': now });
    rnSplit_(t['Items']).forEach(function (x) {
      var it = rnFind_(ctx.items, x);
      if (it && it['Status'] === RI_LOADED) {
        rnSet_(ctx.items, it, { 'Status': RI_TRANSIT });
        rnItemHistory_(ctx.items, it, 'Left the factory on ' + t['Trip ID'] + ' (' + t['Vehicle No.'] + ')', me);
      }
    });
    rnHistory_(ctx.orders, rnOrder_(ctx, id), t['Trip ID'] + ' left the factory – ' + t['Counts'] + ', vehicle ' + t['Vehicle No.'], me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, tripId: String(t['Trip ID']), vehicleNo: String(t['Vehicle No.']), outAt: opsFmt_(new Date()) };
}

/** Sanju: a return trip has come in. form = { tripId, missing: [itemIds not on the vehicle], note } */
function markRentalTripIn_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var lock = rnLock_(), t, id, missing = [], got = 0;
  try {
    var ctx = rnLoad_();
    t = rnFind_(ctx.trips, form && form.tripId);
    if (!t) throw new Error('Trip not found.');
    if (t['Direction'] !== 'Return' || t['Status'] !== 'Planned') throw new Error('This return isn’t expected at the gate (status: ' + t['Status'] + '). Refresh the list.');
    id = String(t['Rental ID']);
    var ids = rnSplit_(t['Items']);
    missing = rnSplit_((form.missing || []).join ? (form.missing || []).join(' ') : form.missing).filter(function (x) { return ids.indexOf(x) !== -1; });
    var note = String(form.note || '').trim();
    if (missing.length && note.length < 3) throw new Error('Say what happened to the missing item' + (missing.length > 1 ? 's' : '') + ' (e.g. “left at site, next trip”).');
    if (missing.length === ids.length) throw new Error('Nothing came in? Ask Ananthu to cancel this pickup instead.');
    var now = new Date();
    ids.forEach(function (x) {
      var it = rnFind_(ctx.items, x);
      if (!it || it['Status'] !== RI_RETURNING) return;
      if (missing.indexOf(x) !== -1) {
        rnSet_(ctx.items, it, { 'Status': RI_OFFHIRED, 'Trip ID': '' });
        rnItemHistory_(ctx.items, it, 'Not on ' + t['Trip ID'] + ' at the gate – ' + note, me);
      } else {
        rnSet_(ctx.items, it, { 'Status': RI_INSPECTION });
        rnItemHistory_(ctx.items, it, 'Back at the factory on ' + t['Trip ID'], me);
        got++;
      }
    });
    rnSet_(ctx.trips, t, { 'Status': 'Arrived', 'Gate By': rnWho_(me), 'Gate At': now,
      'Gate Note': missing.length ? 'Missing: ' + missing.join(', ') + ' – ' + note : note });
    rnHistory_(ctx.orders, rnOrder_(ctx, id), t['Trip ID'] + ' back at the factory – ' + got + ' item' + (got === 1 ? '' : 's') + (missing.length ? '; NOT on the vehicle: ' + missing.join(', ') + ' (' + note + ')' : ''), me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, tripId: String(t['Trip ID']), received: got, missing: missing };
}

// ================================================================
// Ananthu -- installation (rent starts)
// ================================================================
/** form = { rentalId, itemIds, installedOn, plannedEnd, photo: {data, mimeType}, note } */
function markRentalInstalled_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var on = rnValidYmd_(form && form.installedOn, 'the installation date');
  var today = todayYmd_();
  if (on > today) throw new Error('The installation date can’t be in the future.');
  var back = sbDaysBetween_(on, today);
  if (back > RN_INSTALL_BACKDATE_DAYS && me.role !== 'Director') throw new Error('That is ' + back + ' days back. Only a director can record an installation more than ' + RN_INSTALL_BACKDATE_DAYS + ' days back.');
  if (!form.photo || !form.photo.data) throw new Error('Attach the site photo from the plumber – the installation date decides when rent starts.');
  var end = String(form.plannedEnd || '').trim();
  if (end && !sbIsYmd_(end)) throw new Error('Enter a valid planned end.');
  // Check before saving the photo.
  var pre = rnLoad_();
  rnOpenOrder_(pre, id);
  rnPickItems_(pre, form.itemIds, id, [RI_TRANSIT], 'mark installed');
  var depIdGuess = rnNextId_(pre.deployments, 'DEP');
  var photoUrl = rnSaveUpload_(form.photo, id, 'Installation ' + depIdGuess + ' ' + on);
  var lock = rnLock_(), depId, picked;
  try {
    var ctx = rnLoad_();
    var o = rnOpenOrder_(ctx, id);
    picked = rnPickItems_(ctx, form.itemIds, id, [RI_TRANSIT], 'mark installed');
    var plannedEnd = end || rnYmd_(o['Planned End']);
    if (plannedEnd && plannedEnd < on) throw new Error('The planned end (' + fmtYmd_(plannedEnd) + ') is before the installation date. Set the right end date.');
    // Not before the trip left.
    picked.forEach(function (it) {
      var t = rnFind_(ctx.trips, it['Trip ID']);
      if (t && rnYmd_(t['Gate At']) && on < rnYmd_(t['Gate At'])) throw new Error(it['Item ID'] + ' left the factory on ' + rnFmtDate_(t['Gate At']) + ' – it can’t be installed before that.');
    });
    depId = rnNextId_(ctx.deployments, 'DEP');
    rnAppend_(ctx.deployments, { 'Deployment ID': depId, 'Rental ID': id, 'Items': picked.map(function (x) { return x['Item ID']; }).join(', '),
      'Installed On': sbYmdToDate_(on), 'Planned End': plannedEnd ? sbYmdToDate_(plannedEnd) : '', 'Photo URL': photoUrl,
      'Marked By': rnWho_(me), 'Marked At': new Date(), 'Note': String(form.note || '').trim() + (back > 2 ? (form.note ? ' – ' : '') + 'recorded ' + back + ' days later' : '') });
    picked.forEach(function (it) {
      rnSet_(ctx.items, it, { 'Status': RI_DEPLOYED, 'Deployment ID': depId });
      rnItemHistory_(ctx.items, it, 'Installed at site ' + fmtYmd_(on) + ' (' + depId + ')', me);
    });
    rnHistory_(ctx.orders, o, depId + ': installed ' + rnCounts_(picked) + ' on ' + fmtYmd_(on) + (plannedEnd ? ', planned end ' + fmtYmd_(plannedEnd) : '') + ' – rent starts', me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, deploymentId: depId, count: picked.length, installedOn: fmtYmd_(on) };
}

// ================================================================
// Off-hire (rent stops), suction, pickup
// ================================================================
/** CRE (own rental) or Ananthu. form = { rentalId, itemIds, offhireOn, note } */
function recordRentalOffHire_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var on = rnValidYmd_(form && form.offhireOn, 'the date the customer asked for the off-hire');
  var today = todayYmd_();
  if (on > today) throw new Error('Record the off-hire on the day the customer asks – it can’t be in the future. For a planned end, use “Change end date”.');
  var back = sbDaysBetween_(on, today);
  if (me.role === 'CRE' && back > RN_OFFHIRE_BACKDATE_DAYS_CRE) throw new Error('That is ' + back + ' days back – ask Ananthu to record it (it changes the rent).');
  var lock = rnLock_(), ohId, picked;
  try {
    var ctx = rnLoad_();
    var o = rnOpenOrder_(ctx, id);
    if (me.role === 'CRE' && String(o['CRE Code']).toUpperCase() !== me.code) throw new Error('This rental belongs to ' + o['CRE Name'] + '.');
    picked = rnPickItems_(ctx, form.itemIds, id, [RI_DEPLOYED], 'off-hire');
    picked.forEach(function (it) {
      var d = rnFind_(ctx.deployments, it['Deployment ID']);
      if (d && on < rnYmd_(d['Installed On'])) throw new Error(it['Item ID'] + ' was installed on ' + rnFmtDate_(d['Installed On']) + ' – the off-hire can’t be before that.');
    });
    ohId = rnNextId_(ctx.offhires, 'OFH');
    rnAppend_(ctx.offhires, { 'Off-hire ID': ohId, 'Rental ID': id, 'Items': picked.map(function (x) { return x['Item ID']; }).join(', '),
      'Off-hire On': sbYmdToDate_(on), 'Recorded By': rnWho_(me), 'Recorded At': new Date(),
      'Note': String(form.note || '').trim() + (back > 0 ? (form.note ? ' – ' : '') + 'recorded ' + back + ' day' + (back === 1 ? '' : 's') + ' later' : '') });
    picked.forEach(function (it) {
      rnSet_(ctx.items, it, { 'Status': RI_OFFHIRED });
      rnItemHistory_(ctx.items, it, 'Off-hired ' + fmtYmd_(on) + ' (' + ohId + ')', me);
    });
    rnHistory_(ctx.orders, o, ohId + ': off-hired ' + rnCounts_(picked) + ' from ' + fmtYmd_(on) + ' – rent stops; waiting for suction and pickup', me);
  } finally {
    lock.releaseLock();
  }
  try {
    var cfg = getAlertSettings_(), staffMap = getStaffMap_(false);
    notify_('RENTAL_OFFHIRE', id, rnPeopleFor_('coordinator', staffMap, cfg), {
      subject: 'Off-hire: ' + id + ' – ' + rnCounts_(picked) + ' to pick up', email: true,
      text: id + ': ' + rnCounts_(picked) + ' off-hired from ' + fmtYmd_(on) + ' (' + me.name + '). Arrange suction and pickup.',
      html: '<p><b>' + rnEsc_(id) + '</b>: ' + rnEsc_(rnCounts_(picked)) + ' off-hired from <b>' + rnEsc_(fmtYmd_(on)) + '</b>, recorded by ' + rnEsc_(me.name) + '.</p><p>Arrange suction and the pickup, then record them on the Rentals page.</p>',
      link: appUrl_() ? appUrl_() + '?page=rental' : '', linkLabel: 'Open Rentals'
    });
  } catch (e) { Logger.log('off-hire notice failed: ' + e); }
  return { trackerId: id, rentalId: id, offhireId: ohId, count: picked.length, offhireOn: fmtYmd_(on) };
}

/** Ananthu: suction done for one off-hire. form = { offhireId, doneOn, vendor, cost, note } */
function recordRentalSuction_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var on = rnValidYmd_(form && form.doneOn, 'the date of the suction');
  if (on > todayYmd_()) throw new Error('The suction date can’t be in the future.');
  var vendor = String((form && form.vendor) || '').trim();
  if (!vendor) throw new Error('Enter who did the suction.');
  var cost = rnMoneyValue_(form.cost, 'cost');
  var lock = rnLock_(), id, r;
  try {
    var ctx = rnLoad_();
    r = rnFind_(ctx.offhires, form && form.offhireId);
    if (!r) throw new Error('Off-hire not found.');
    id = String(r['Rental ID']);
    var o = rnOpenOrder_(ctx, id);
    if (on < rnYmd_(r['Off-hire On'])) throw new Error('The suction can’t be before the off-hire (' + rnFmtDate_(r['Off-hire On']) + ').');
    rnSet_(ctx.offhires, r, { 'Suction Done On': sbYmdToDate_(on), 'Suction Vendor': vendor, 'Suction Cost': cost, 'Suction By': rnWho_(me) });
    rnAppend_(ctx.jobs, { 'Job ID': rnNextId_(ctx.jobs, 'RVJ'), 'Rental ID': id, 'Kind': 'Suction', 'Vendor': vendor, 'Date': sbYmdToDate_(on),
      'Cost': cost, 'Ref': String(r['Off-hire ID']), 'Note': String(form.note || '').trim(), 'Recorded By': rnWho_(me), 'Recorded At': new Date() });
    rnHistory_(ctx.orders, o, 'Suction done for ' + r['Off-hire ID'] + ' on ' + fmtYmd_(on) + ' by ' + vendor + (cost !== '' ? ', ' + rnRupees_(cost) : ''), me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, offhireId: String(r['Off-hire ID']) };
}

/** Ananthu or Manoj: plan the pickup. form = { rentalId, itemIds, vehicleNo, transport, vendor, cost, noSuction } */
function planRentalReturn_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var vehicle = String((form && form.vehicleNo) || '').trim().toUpperCase().replace(/\s+/g, ' ');
  var transport = String((form && form.transport) || '').trim();
  if (!vehicle) throw new Error('Enter the vehicle number.');
  if (transport !== 'Own' && transport !== 'Hired') throw new Error('Is it our own vehicle or a hired one?');
  var vendor = String(form.vendor || '').trim();
  if (transport === 'Hired' && !vendor) throw new Error('Enter the transporter for a hired vehicle.');
  var cost = rnMoneyValue_(form.cost, 'transport cost');
  var lock = rnLock_(), tripId, picked;
  try {
    var ctx = rnLoad_();
    var o = rnOpenOrder_(ctx, id);
    picked = rnPickItems_(ctx, form.itemIds, id, [RI_OFFHIRED], 'pick up');
    if (!form.noSuction) {
      var noSuction = picked.filter(function (it) {
        var r = ctx.offhires.rows.filter(function (x) { return String(x['Rental ID']).toUpperCase() === id && rnSplit_(x['Items']).indexOf(String(it['Item ID']).toUpperCase()) !== -1; }).pop();
        return !(r && rnYmd_(r['Suction Done On']));
      }).map(function (it) { return it['Item ID']; });
      if (noSuction.length) throw new Error('Suction isn’t recorded for ' + noSuction.join(', ') + '. Record it first – or tick “no suction needed” (e.g. tanks and stands only).');
    }
    tripId = rnNextId_(ctx.trips, 'RTR');
    rnAppend_(ctx.trips, {
      'Trip ID': tripId, 'Rental ID': id, 'Direction': 'Return', 'Items': picked.map(function (x) { return x['Item ID']; }).join(', '),
      'Counts': rnCounts_(picked), 'Vehicle No.': vehicle, 'Transport': transport, 'Vendor': vendor, 'Cost': cost,
      'Status': 'Planned', 'Created By': rnWho_(me), 'Created At': new Date()
    });
    picked.forEach(function (it) {
      rnSet_(ctx.items, it, { 'Status': RI_RETURNING, 'Trip ID': tripId });
      rnItemHistory_(ctx.items, it, 'Pickup planned on ' + tripId + ' (' + vehicle + ')', me);
    });
    rnHistory_(ctx.orders, o, tripId + ': pickup of ' + rnCounts_(picked) + ' on ' + vehicle + (form.noSuction ? ' (no suction needed)' : ''), me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, tripId: tripId, counts: rnCounts_(picked) };
}

// ================================================================
// Manoj -- inspection and repair; write-offs
// ================================================================
/** form = { results: [{ itemId, ok: true|false, note }] } */
function inspectRentalItems_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var results = (form && form.results) || [];
  if (!results.length) throw new Error('Mark at least one item.');
  // Damaged items need a note AND a photo (round 2): the evidence for whoever decides who pays.
  var errs = [], noPhoto = [];
  results.forEach(function (r) {
    if (r.ok !== false) return;
    if (String(r.note || '').trim().length < 3) errs.push(String(r.itemId).toUpperCase());
    if (!(r.photo && r.photo.data)) noPhoto.push(String(r.itemId).toUpperCase());
  });
  if (errs.length) throw new Error('Say what is damaged on ' + errs.join(', ') + '.');
  if (noPhoto.length) throw new Error('Take a photo of the damage on ' + noPhoto.join(', ') + '.');
  rnPickItems_(rnLoad_(), results.map(function (r) { return r.itemId; }), null, [RI_INSPECTION], 'inspect');
  var photos = results.map(function (r) {
    return r.ok === false ? rnSaveUpload_(r.photo, String(r.itemId).toUpperCase(), 'Damage ' + todayYmd_()) : '';
  });
  var lock = rnLock_(), ok = 0, bad = 0, rentals = {};
  try {
    var ctx = rnLoad_();
    var picked = rnPickItems_(ctx, results.map(function (r) { return r.itemId; }), null, [RI_INSPECTION], 'inspect');
    picked.forEach(function (it, i) {
      var r = results[i];
      var rid = String(it['Rental ID'] || '');
      if (r.ok === false) {
        var note = String(r.note).trim();
        rnSet_(ctx.items, it, { 'Status': RI_REPAIR, 'Condition Note': note + ' (back from ' + rid + ')', 'Rental ID': '', 'Trip ID': '', 'Deployment ID': '' });
        rnItemHistory_(ctx.items, it, 'Inspected after ' + rid + ': DAMAGED – ' + note + (photos[i] ? ' (photo: ' + photos[i] + ')' : ''), me);
        var ord = rid && rnFind_(ctx.orders, rid);
        if (ord) rnAddDamage_(ctx, ord, String(it['Item ID']), note, photos[i]);
        bad++;
        (rentals[rid] = rentals[rid] || []).push(it['Item ID'] + ' damaged: ' + note);
      } else {
        if (/^Stencil this ID/.test(String(it['Condition Note'] || ''))) rnItemHistory_(ctx.items, it, 'Stencilled at inspection', me);
        rnSet_(ctx.items, it, { 'Status': RI_AVAILABLE, 'Condition Note': '', 'Rental ID': '', 'Trip ID': '', 'Deployment ID': '' });
        rnItemHistory_(ctx.items, it, 'Inspected after ' + rid + ': OK – available', me);
        ok++;
        (rentals[rid] = rentals[rid] || []);
      }
    });
    Object.keys(rentals).forEach(function (rid) {
      var o = rnFind_(ctx.orders, rid);
      if (!o) return;
      rnHistory_(ctx.orders, o, 'Inspected returned items' + (rentals[rid].length ? ' – ' + rentals[rid].join('; ') : ' – all OK'), me);
    });
  } finally {
    lock.releaseLock();
  }
  var ids = Object.keys(rentals);
  return { trackerId: ids.length === 1 ? ids[0] : '', ok: ok, damaged: bad };
}

/** Under Repair -> Available. form = { itemId, note } */
function repairRentalItem_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var lock = rnLock_(), it;
  try {
    var ctx = rnLoad_();
    it = rnPickItems_(ctx, [form && form.itemId], null, [RI_REPAIR], 'mark repaired')[0];
    rnSet_(ctx.items, it, { 'Status': RI_AVAILABLE, 'Condition Note': '' });
    rnItemHistory_(ctx.items, it, 'Repaired – available' + (form.note ? ' (' + String(form.note).slice(0, 200) + ')' : ''), me);
  } finally {
    lock.releaseLock();
  }
  return { itemId: String(it['Item ID']) };
}

/** Director / Admin: an item is lost or scrapped. form = { itemId, status: 'Lost'|'Scrapped', reason } */
function writeOffRentalItem_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var status = String((form && form.status) || '');
  if (status !== RI_LOST && status !== RI_SCRAPPED) throw new Error('Lost or scrapped?');
  var reason = String(form.reason || '').trim();
  if (reason.length < 5) throw new Error('Give the reason.');
  var lock = rnLock_(), it, rid;
  try {
    var ctx = rnLoad_();
    it = rnPickItems_(ctx, [form.itemId], null, [RI_AVAILABLE, RI_REPAIR, RI_INSPECTION, RI_DEPLOYED, RI_OFFHIRED, RI_RETURNING, RI_TRANSIT], 'write off')[0];
    rid = String(it['Rental ID'] || '');
    rnSet_(ctx.items, it, { 'Status': status, 'Condition Note': reason, 'Trip ID': '' });
    rnItemHistory_(ctx.items, it, status + ': ' + reason, me);
    if (rid) { var o = rnFind_(ctx.orders, rid); if (o) rnHistory_(ctx.orders, o, it['Item ID'] + ' written off as ' + status.toLowerCase() + ': ' + reason, me); }
  } finally {
    lock.releaseLock();
  }
  return { trackerId: rid, itemId: String(it['Item ID']), status: status };
}

/** Ananthu: a hired service on this rental. form = { rentalId, kind, vendor, date, cost, ref, note } */
function addRentalVendorJob_(form) {
  rnAssertLive_();
  var me = rnMe_();
  var id = String((form && form.rentalId) || '').trim().toUpperCase();
  var kind = String(form.kind || '').trim();
  if (RENTAL_JOB_KINDS.indexOf(kind) === -1) throw new Error('Choose the kind of job.');
  var vendor = String(form.vendor || '').trim();
  if (!vendor) throw new Error('Enter the vendor.');
  var date = rnValidYmd_(form.date, 'the date of the job');
  var cost = rnMoneyValue_(form.cost, 'cost');
  var lock = rnLock_(), jobId;
  try {
    var ctx = rnLoad_();
    var o = rnOrder_(ctx, id);
    if (o['Status'] !== 'Acknowledged' && o['Status'] !== 'Verified') throw new Error('Only an open rental takes vendor jobs.');
    jobId = rnNextId_(ctx.jobs, 'RVJ');
    rnAppend_(ctx.jobs, { 'Job ID': jobId, 'Rental ID': id, 'Kind': kind, 'Vendor': vendor, 'Date': sbYmdToDate_(date), 'Cost': cost,
      'Ref': String(form.ref || '').trim(), 'Note': String(form.note || '').trim(), 'Recorded By': rnWho_(me), 'Recorded At': new Date() });
    rnHistory_(ctx.orders, o, 'Vendor job: ' + kind + ' – ' + vendor + ' on ' + fmtYmd_(date) + (cost !== '' ? ', ' + rnRupees_(cost) : ''), me);
  } finally {
    lock.releaseLock();
  }
  return { trackerId: id, rentalId: id, jobId: jobId };
}

function rentalFleetActivityDetail_(fnName, a, result) {
  result = result || {}; a = a || {};
  switch (fnName) {
    case 'tagRentalItems': return (result.ids ? result.ids.length : '') + ' × ' + (result.type || '') + ': ' + (result.first || '') + (result.last && result.last !== result.first ? ' to ' + result.last : '');
    case 'allocateRentalItems': case 'releaseRentalItems': return (result.count || 0) + ' item(s): ' + rnSplit_(Array.isArray(a.itemIds) ? a.itemIds.join(' ') : a.itemIds).join(', ').slice(0, 400);
    case 'createRentalTrip': return (result.tripId || '') + ' – ' + (result.counts || '') + ', vehicle ' + (result.vehicleNo || '');
    case 'cancelRentalTrip': return (result.tripId || '') + (a.reason ? ' – ' + a.reason : '');
    case 'issueRentalGatePass': return (result.gatePassNo || '') + ' for ' + (result.tripId || '');
    case 'markRentalTripOut': return (result.tripId || '') + ', vehicle ' + (result.vehicleNo || '');
    case 'markRentalTripIn': return (result.tripId || '') + ' – ' + (result.received || 0) + ' in' + (result.missing && result.missing.length ? ', missing ' + result.missing.join(', ') : '');
    case 'markRentalInstalled': return (result.deploymentId || '') + ' – ' + (result.count || 0) + ' item(s) on ' + (result.installedOn || '');
    case 'recordRentalOffHire': return (result.offhireId || '') + ' – ' + (result.count || 0) + ' item(s) from ' + (result.offhireOn || '');
    case 'recordRentalSuction': return (result.offhireId || '') + ' – ' + (a.vendor || '') + ' on ' + (a.doneOn || '');
    case 'planRentalReturn': return (result.tripId || '') + ' – ' + (result.counts || '');
    case 'inspectRentalItems': return (result.ok || 0) + ' OK, ' + (result.damaged || 0) + ' damaged';
    case 'repairRentalItem': return result.itemId || '';
    case 'writeOffRentalItem': return (result.itemId || '') + ' – ' + (result.status || '') + ': ' + (a.reason || '');
    case 'addRentalVendorJob': return (result.jobId || '') + ' – ' + (a.kind || '') + ', ' + (a.vendor || '');
    default: return '';
  }
}
