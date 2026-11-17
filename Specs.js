/**
 * PRODUCT SPECIFICATION FOR THE FACTORY (17 Nov 2026)
 * ---------------------------------------------------------------------
 * Some products are made to order -- first the ReLeaf office container.
 * The factory needs the CRE's description of how this one is to be built
 * and the design files (drawings, PDFs, photos).
 *
 * Decided with Hari (17 Nov 2026)
 *   - Which products: the Product Catalog tab's "Needs Specification"
 *     column (Y). Seeded Y for the ReLeaf Office Container; type Y for any
 *     other made-to-order product -- no code change.
 *   - When an order has such a product, the New PO form shows a
 *     "Specification for the factory" section: a description (required, up
 *     to 1,500 characters) and up to 10 design files (PDF or photo, 8 MB
 *     each). ONE specification per order (the text can say "Unit 1 ... Unit 2").
 *   - The description prints in full on the Internal PO ("Manufacturing
 *     instructions"), with the design files listed by name; the files open
 *     and print from the order on the Ops, CRE and Accounts pages.
 *   - Anyone who can see the order can see the specification. The CRE who
 *     owns the order (or an Admin / Director) can change it at any time --
 *     NOT locked after Ops picks the order up. A change after pickup marks the
 *     order "Specification changed" and emails Ops once; it clears when Ops
 *     prints the Internal PO again.
 *
 * Storage
 *   Tracker columns: Spec Description, Spec Updated At, Spec Updated By,
 *   Spec Changed After Pickup.
 *   "Order Design Files" tab: one row per file (Tracker ID, File No, File
 *   Name, File URL, File ID, Uploaded At, Uploaded By) -- keyed by Tracker ID,
 *   so the admin "Delete a record" clean-up removes them with the order.
 *   Files live in the "ICF Order POs" Drive folder as
 *   "<Tracker ID> - Design 01 - <original name>", shared by link like the POs.
 *   A removed file is renamed "(removed <date>) ..." and kept, never deleted.
 */
var SPEC_MAX_CHARS = 1500;
var SPEC_MAX_FILES = 10;
var SPEC_FILES_SHEET_NAME = 'Order Design Files';
var SPEC_FILES_HEADERS = ['Tracker ID', 'File No', 'File Name', 'File URL', 'File ID', 'Uploaded At', 'Uploaded By'];
var SPEC_CATALOG_HEADER = 'Needs Specification';
var DEFAULT_SPEC_PRODUCTS = ['ReLeaf Office Container Z 2010 Model'];

// ================================================================
// Product Catalog: which products need a specification
// ================================================================
/** Adds column D "Needs Specification" the first time, with the office container set to Y. */
function ensureCatalogSpecColumn_(sheet) {
  var header = String(sheet.getRange(1, 4).getValue() || '').trim();
  if (header === SPEC_CATALOG_HEADER) return;
  sheet.getRange(1, 4).setValue(SPEC_CATALOG_HEADER);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var names = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) { return String(r[0]).trim().toLowerCase(); });
  DEFAULT_SPEC_PRODUCTS.forEach(function (p) {
    var idx = names.indexOf(p.toLowerCase());
    if (idx !== -1) sheet.getRange(idx + 2, 4).setValue('Y');
  });
}

/** { lower-case product name: true } for every catalog product marked Y (active or not). */
function specProducts_() {
  var sheet = getOrCreateProductCatalogSheet();
  var lastRow = sheet.getLastRow();
  var out = {};
  if (lastRow < 2) return out;
  sheet.getRange(2, 1, lastRow - 1, 4).getValues().forEach(function (r) {
    if (String(r[3] || '').trim().toUpperCase() === 'Y') out[String(r[0] || '').trim().toLowerCase()] = true;
  });
  return out;
}

/** Does this order (line items) need a specification? */
function specNeeded_(lineItems) {
  var set = specProducts_();
  return (lineItems || []).some(function (it) { return set[String(it.product || '').trim().toLowerCase()]; });
}

// ================================================================
// Files
// ================================================================
function specSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SPEC_FILES_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SPEC_FILES_SHEET_NAME, ss.getNumSheets());
    sh.getRange(1, 1, 1, SPEC_FILES_HEADERS.length).setValues([SPEC_FILES_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A2:A').setNumberFormat('@');
  }
  return sh;
}

/** The files on an order: [{ row, no, name, url, fileId, uploadedAt, by }] in file-number order. */
function specFiles_(trackerId) {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SPEC_FILES_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return [];
  var want = String(trackerId).trim().toLowerCase();
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, SPEC_FILES_HEADERS.length).getValues();
  var out = [];
  vals.forEach(function (r, i) {
    if (String(r[0]).trim().toLowerCase() !== want) return;
    out.push({ row: i + 2, no: Number(r[1]) || 0, name: String(r[2] || ''), url: String(r[3] || ''), fileId: String(r[4] || ''),
      uploadedAt: r[5] instanceof Date ? Utilities.formatDate(r[5], Session.getScriptTimeZone(), 'dd-MMM-yyyy, hh:mm a') : String(r[5] || ''),
      by: String(r[6] || '') });
  });
  return out.sort(function (a, b) { return a.no - b.no; });
}

function specCleanName_(name, ext) {
  var n = String(name || '').replace(/[\\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) n = 'design' + ext;
  if (!/\.[a-z0-9]{2,5}$/i.test(n)) n += ext;
  return n.length > 80 ? n.slice(0, 70) + n.slice(-10) : n;
}

/** Names, shares and records a file on an order. file = a Drive file (staged or new). */
function specRecordFile_(trackerId, file, originalName, me) {
  var existing = specFiles_(trackerId);
  if (existing.length >= SPEC_MAX_FILES) throw new Error('This order already has ' + SPEC_MAX_FILES + ' design files – remove one first.');
  var no = existing.reduce(function (m, f) { return Math.max(m, f.no); }, 0) + 1;
  var ext = (String(file.getName()).match(/\.[a-z0-9]+$/i) || ['.pdf'])[0].toLowerCase();
  var shown = specCleanName_(originalName, ext);
  file.setName(sanitizeForFilename(trackerId) + ' - Design ' + (no < 10 ? '0' : '') + no + ' - ' + shown);
  file.setDescription('ICF order ' + trackerId + ' – design file ' + no + ', uploaded by ' + me.name);
  docsShare_(file);
  var sh = specSheet_();
  sh.appendRow([String(trackerId), no, shown, file.getUrl(), file.getId(), new Date(), me.name]);
  return { no: no, name: shown, url: file.getUrl(), fileId: file.getId() };
}

/** Intake: upload one design file before the order is sent. form = { file: { data, mimeType, name } }. */
function stageSpecFile_(form) {
  form = form || {};
  var d = docsDecode_(form.file);
  var me = CURRENT_STAFF_;
  var orig = specCleanName_(form.file && form.file.name, d.ext);
  var file = getOrCreateFolder(DOCS_FOLDER_NAME)
    .createFile(Utilities.newBlob(d.bytes, d.mime, 'STAGED - Design - ' + me.code + ' - ' + Utilities.getUuid().slice(0, 8) + d.ext));
  file.setDescription('staged|' + me.code + '|spec|' + orig);
  return { fileId: file.getId(), name: orig };
}

/** The staged design file, or throws. Returns { file, name }. */
function specStagedFile_(fileId, me) {
  var file;
  try { file = DriveApp.getFileById(String(fileId || '')); } catch (e) { file = null; }
  var desc = file && !file.isTrashed() ? String(file.getDescription() || '') : '';
  var prefix = 'staged|' + me.code + '|spec|';
  if (desc.indexOf(prefix) !== 0) throw new Error('A design file upload didn’t go through. Choose the files again.');
  return { file: file, name: desc.slice(prefix.length) };
}

// ================================================================
// Intake (called from submitOrder_)
// ================================================================
/**
 * Checks the specification part of the New PO form before anything is written.
 * Returns null when the order needs none, else { description, fileIds }.
 */
function specIntakeCheck_(form, lineItems) {
  if (!specNeeded_(lineItems)) return null;
  var desc = String(form.specDescription || '').replace(/\r\n/g, '\n').trim();
  if (!desc) throw new Error('Describe how it is to be made – the “Specification for the factory” box is required for this product.');
  if (desc.length > SPEC_MAX_CHARS) throw new Error('The specification is ' + desc.length + ' characters – keep it under ' + SPEC_MAX_CHARS + ' and put the rest in the design files.');
  var ids = (form.specFileIds || []).map(String).filter(Boolean);
  if (ids.length > SPEC_MAX_FILES) throw new Error('Attach at most ' + SPEC_MAX_FILES + ' design files.');
  ids.forEach(function (id) { specStagedFile_(id, CURRENT_STAFF_); });
  return { description: desc, fileIds: ids };
}

/** After the row is written. Returns a warning string ('' if all went well). */
function specIntakeAttach_(sheet, row, trackerId, spec, me) {
  if (!spec) return '';
  setRowFields(sheet, row, { 'Spec Description': spec.description, 'Spec Updated At': new Date(), 'Spec Updated By': me.name });
  var failed = 0;
  spec.fileIds.forEach(function (id) {
    try { var s = specStagedFile_(id, me); specRecordFile_(trackerId, s.file, s.name, me); } catch (e) { failed++; Logger.log('Design file: ' + e); }
  });
  return failed ? failed + ' design file' + (failed === 1 ? '' : 's') + ' could not be attached – add ' + (failed === 1 ? 'it' : 'them') + ' again from the order.' : '';
}

// ================================================================
// View and change after intake
// ================================================================
var SPEC_FIELDS = ['Tracker ID', 'Status', 'CRE Code', 'CRE Name', 'Received by Ops Timestamp', 'Ops Cutover',
  'Spec Description', 'Spec Updated At', 'Spec Updated By', 'Spec Changed After Pickup'];

function specCanEdit_(sheet, row) {
  var me = CURRENT_STAFF_;
  if (!me) return false;
  if (me.role === 'Admin' || me.role === 'Director') return true;
  if (me.role !== 'CRE') return false;
  var f = getRowFields(sheet, row, ['Tracker ID', 'CRE Code', 'CRE Name']);
  return describeAccess_(resolveOwnerCode_(f['CRE Code'], f['CRE Name']), f['Tracker ID']).canAct;
}

/** Everyone: the specification on an order. form = { trackerId } or a string. */
function getOrderSpec_(form) {
  var q = typeof form === 'string' ? form : String((form && form.trackerId) || '');
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, q);
  if (row === -1) throw new Error('Order not found.');
  var f = getRowFields(sheet, row, SPEC_FIELDS);
  var id = String(f['Tracker ID']);
  var tz = Session.getScriptTimeZone();
  var fmt = function (v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'dd-MMM-yyyy, hh:mm a') : String(v || ''); };
  var files = specFiles_(id).map(function (x) { return { no: x.no, name: x.name, url: x.url, fileId: x.fileId, uploadedAt: x.uploadedAt, by: x.by }; });
  var desc = String(f['Spec Description'] || '');
  return {
    trackerId: id,
    needed: specNeeded_(getOrderLineItems_(id)),
    description: desc,
    updatedAt: fmt(f['Spec Updated At']),
    updatedBy: String(f['Spec Updated By'] || ''),
    changedAfterPickup: fmt(f['Spec Changed After Pickup']),
    files: files,
    canEdit: f['Status'] !== 'Cancelled' && specCanEdit_(sheet, row),
    maxChars: SPEC_MAX_CHARS,
    maxFiles: SPEC_MAX_FILES
  };
}

function specRowForEdit_(trackerId) {
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String(trackerId || ''));
  if (row === -1) throw new Error('Order not found.');
  if (!specCanEdit_(sheet, row)) throw new Error('Only the CRE on this order (or the admin) can change its specification.');
  var f = getRowFields(sheet, row, SPEC_FIELDS);
  if (f['Status'] === 'Cancelled') throw new Error('This order has been cancelled.');
  return { sheet: sheet, row: row, f: f, id: String(f['Tracker ID']) };
}

/**
 * After a change: who/when, and if Ops already has the order, the
 * "Specification changed" flag + one email to Ops (until the PO is printed again).
 */
function specAfterChange_(x, what) {
  var me = CURRENT_STAFF_;
  var set = { 'Spec Updated At': new Date(), 'Spec Updated By': me.name };
  var picked = opsIsAcked_(x.f['Received by Ops Timestamp'], x.f['Ops Cutover']);
  var dispatched = isDispatchedStatus_(x.f['Status']);
  var alreadyFlagged = !!x.f['Spec Changed After Pickup'];
  if (picked && !dispatched) set['Spec Changed After Pickup'] = new Date();
  setRowFields(x.sheet, x.row, set);
  if (picked && !dispatched && !alreadyFlagged) {
    try {
      var staffMap = getStaffMap_(false);
      var ops = opsPeople_(staffMap).filter(function (p) { return /@/.test(p.email); }).map(function (p) { return p.email; });
      var url = appUrl_();
      cxMail_(ops, [], 'Specification changed: ' + x.id + ' – reprint the Internal PO',
        '<p>' + opsEsc_(me.name) + ' changed the factory specification on <b>' + opsEsc_(x.id) + '</b> (' + opsEsc_(what) + ') after you picked it up.</p>' +
        '<p>Open the order, check the new instructions and design files, and print the Internal PO again so the factory works from the latest version.</p>',
        url ? url + '?page=ops-beta' : '', 'Open the Operations page');
    } catch (e) { Logger.log('Spec change email failed: ' + e); }
  }
  return picked && !dispatched;
}

/** CRE / Admin: change the description. form = { trackerId, description } */
function saveOrderSpec_(form) {
  form = form || {};
  var desc = String(form.description || '').replace(/\r\n/g, '\n').trim();
  if (!desc) throw new Error('The description can’t be empty.');
  if (desc.length > SPEC_MAX_CHARS) throw new Error('Keep it under ' + SPEC_MAX_CHARS + ' characters (it is ' + desc.length + ') – put the rest in the design files.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var x, flagged;
  try {
    x = specRowForEdit_(form.trackerId);
    setRowFields(x.sheet, x.row, { 'Spec Description': desc });
    flagged = specAfterChange_(x, 'description');
  } finally { lock.releaseLock(); }
  return { trackerId: x.id, opsAlerted: flagged };
}

/** CRE / Admin: add one design file. form = { trackerId, file: { data, mimeType, name } } */
function addOrderSpecFile_(form) {
  form = form || {};
  var d = docsDecode_(form.file);
  var me = CURRENT_STAFF_;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var x, rec, flagged;
  try {
    x = specRowForEdit_(form.trackerId);
    if (specFiles_(x.id).length >= SPEC_MAX_FILES) throw new Error('This order already has ' + SPEC_MAX_FILES + ' design files – remove one first.');
    var file = getOrCreateFolder(DOCS_FOLDER_NAME).createFile(Utilities.newBlob(d.bytes, d.mime, 'design' + d.ext));
    rec = specRecordFile_(x.id, file, form.file && form.file.name, me);
    flagged = specAfterChange_(x, 'added ' + rec.name);
  } finally { lock.releaseLock(); }
  return { trackerId: x.id, file: rec, opsAlerted: flagged };
}

/** CRE / Admin: take a design file off (kept in Drive, renamed). form = { trackerId, fileId } */
function removeOrderSpecFile_(form) {
  form = form || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var x, gone, flagged;
  try {
    x = specRowForEdit_(form.trackerId);
    gone = specFiles_(x.id).filter(function (f) { return f.fileId === String(form.fileId || ''); })[0];
    if (!gone) throw new Error('That file isn’t on this order any more.');
    try {
      var file = DriveApp.getFileById(gone.fileId);
      file.setName('(removed ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy') + ') ' + file.getName());
    } catch (e) { /* file already gone from Drive */ }
    specSheet_().deleteRow(gone.row);
    flagged = specAfterChange_(x, 'removed ' + gone.name);
  } finally { lock.releaseLock(); }
  return { trackerId: x.id, opsAlerted: flagged };
}

/** For the Internal PO. null when the order has no specification. */
function specForPo_(trackerId, description) {
  var files = specFiles_(trackerId);
  var desc = String(description || '').trim();
  if (!desc && !files.length) return null;
  return { description: desc, files: files.map(function (f) { return f.name; }) };
}

// ================================================================
// Wiring
// ================================================================
function specsApiMap_() {
  var ALL = ['CRE', 'Accounts', 'Ops', 'Gate', 'Director'];
  var EDIT = ['CRE', 'Director'];
  return {
    getOrderSpec:        { fn: getOrderSpec_,        roles: ALL },
    stageSpecFile:       { fn: stageSpecFile_,       roles: EDIT },
    saveOrderSpec:       { fn: saveOrderSpec_,       roles: EDIT, log: 'Specification changed' },
    addOrderSpecFile:    { fn: addOrderSpecFile_,    roles: EDIT, log: 'Design file added' },
    removeOrderSpecFile: { fn: removeOrderSpecFile_, roles: EDIT, log: 'Design file removed' }
  };
}

function specsActivityDetail_(fnName, a, result) {
  a = a || {}; result = result || {};
  var tail = result.opsAlerted ? ' (after pickup – Ops told to reprint the PO)' : '';
  switch (fnName) {
    case 'saveOrderSpec': return 'Description updated' + tail;
    case 'addOrderSpecFile': return 'Added ' + (result.file ? result.file.name : '') + tail;
    case 'removeOrderSpecFile': return 'Removed a design file' + tail;
    default: return '';
  }
}
