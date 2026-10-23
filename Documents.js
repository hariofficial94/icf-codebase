/**
 * CRM PO + CUSTOMER PO UPLOADS (Oct 2026)
 * ---------------------------------------------------------------------
 * WHY: the delivery address and the amount per product are only on the PO
 * the CRM software generates. Accounts was verifying orders without seeing
 * it, and Ops had nothing to print it from.
 *
 * WHAT
 *   1. CRM PO       -- every order. Required at intake.
 *   2. Customer PO  -- the purchase order the customer gave. Required for
 *                      "PO Customer" orders (that is what makes them one);
 *                      optional for end customers.
 *   The CRE attaches both on the intake form (PDF or a photo). Files go to
 *   the Drive folder DOCS_FOLDER_NAME with the same link sharing as the
 *   Wrapper PO and gate pass, and their links are kept in the tracker
 *   ("CRM PO URL", "Customer PO URL").
 *
 *   Accounts can't verify an order until the required files are on it, and
 *   ticks that they've checked them (address, products, amounts) when
 *   verifying. Orders logged before this release need the CRE to upload them
 *   from "Look Up an Enquiry" first.
 *
 *   View / Print: CRE, Accounts and Ops (Ops once they've picked the order
 *   up) get buttons that open the file in Drive's viewer, which prints it.
 *
 * REPLACING: the CRE can replace a file only until Accounts verifies -- after
 * that, what Accounts checked stays put (an Admin can still replace it).
 * A missing file can be added any time. Replaced files are kept in Drive,
 * renamed "(replaced ...)", never deleted.
 *
 * UPLOAD MECHANICS: at intake the page uploads each file first
 * (stageOrderDocument_ -> a file marked as staged by that CRE), then sends
 * the order with the file ids; submitOrder_ attaches them (docsAttach_). One
 * file per call keeps each call well inside Apps Script's size limits, and a
 * failed order (e.g. a duplicate quotation no.) can be resent without
 * uploading again.
 */
var DOCS_FOLDER_NAME = 'ICF Order POs';
var DOCS_MAX_BYTES = 8 * 1024 * 1024;
var DOC_KINDS = {
  crm:      { col: 'CRM PO URL',      label: 'CRM PO' },
  customer: { col: 'Customer PO URL', label: 'Customer PO' }
};

function docsKind_(kind) {
  var k = DOC_KINDS[String(kind || '')];
  if (!k) throw new Error('Unknown document type.');
  return k;
}

/** What the pages need to know about an order's documents. raw = row fields incl. the two URL columns. */
function docsInfo_(raw) {
  var status = String(raw['Status'] || '');
  var terms = String(raw['Payment Terms Type'] || 'End Customer');
  var crmUrl = String(raw['CRM PO URL'] || '');
  var customerUrl = String(raw['Customer PO URL'] || '');
  var missing = [];
  if (!crmUrl) missing.push(DOC_KINDS.crm.label);
  if (!customerUrl && terms === 'PO Customer') missing.push(DOC_KINDS.customer.label);
  var role = CURRENT_STAFF_ ? CURRENT_STAFF_.role : '';
  return {
    crmUrl: crmUrl,
    customerUrl: customerUrl,
    customerRequired: terms === 'PO Customer',
    missing: missing,
    // Replacing what Accounts checked is the CRE's only until verification.
    canReplace: status === 'Logged' || (role === 'Admin' && status !== 'Cancelled'),
    canAdd: status !== 'Cancelled'
  };
}

/** Blocks verification until the required files are attached and Accounts has ticked that they checked them. */
function docsAssertReadyForVerify_(sheet, row, checked) {
  var f = getRowFields(sheet, row, ['Status', 'Payment Terms Type', 'CRM PO URL', 'Customer PO URL']);
  var info = docsInfo_(f);
  if (info.missing.length) {
    throw new Error('The ' + info.missing.join(' and the ') + ' ' + (info.missing.length > 1 ? 'are' : 'is') +
      ' not uploaded yet. Ask the CRE to upload ' + (info.missing.length > 1 ? 'them' : 'it') + ' (Look Up an Enquiry on the CRE page), then verify.');
  }
  if (!checked) throw new Error('Open the CRM PO and check the address, products and amounts, then tick the box to confirm.');
}

/** Reads { data (base64), mimeType, name } from the page and checks it. Returns { bytes, mime, ext }. */
function docsDecode_(file) {
  file = file || {};
  if (!file.data) throw new Error('Choose a file to upload.');
  var mime = String(file.mimeType || '').toLowerCase();
  var allowed = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif' };
  if (!allowed[mime]) throw new Error('Upload the PO as a PDF or a photo (JPG/PNG).');
  var bytes = Utilities.base64Decode(String(file.data).replace(/^data:[^,]*,/, ''));
  if (bytes.length > DOCS_MAX_BYTES) throw new Error('That file is over 8 MB. Save the PDF smaller, or take the photo again.');
  if (!bytes.length) throw new Error('That file is empty.');
  return { bytes: bytes, mime: mime, ext: allowed[mime] };
}

function docsFileName_(trackerId, kind, ext) {
  return sanitizeForFilename(trackerId) + ' - ' + docsKind_(kind).label + ext;
}

function docsShare_(file) {
  // Same sharing as the Wrapper PO and gate pass, so Accounts and Ops can open it without an access request.
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
}

// ================================================================
// API
// ================================================================
/** Intake: upload one file before the order is sent. form = { kind, file }. Returns { fileId, kind }. */
function stageOrderDocument_(form) {
  form = form || {};
  var k = docsKind_(form.kind);
  var d = docsDecode_(form.file);
  var me = CURRENT_STAFF_;
  var file = getOrCreateFolder(DOCS_FOLDER_NAME)
    .createFile(Utilities.newBlob(d.bytes, d.mime, 'STAGED - ' + k.label + ' - ' + me.code + ' - ' + Utilities.getUuid().slice(0, 8) + d.ext));
  file.setDescription('staged|' + me.code + '|' + form.kind);
  return { fileId: file.getId(), kind: form.kind };
}

/** Throws unless fileId is a file this person staged for this kind. Returns the Drive file. */
function docsStagedFile_(fileId, kind, me) {
  var file;
  try { file = DriveApp.getFileById(String(fileId || '')); } catch (e) { file = null; }
  if (!file || file.isTrashed() || String(file.getDescription() || '') !== 'staged|' + me.code + '|' + kind) {
    throw new Error('The ' + docsKind_(kind).label + ' upload didn’t go through. Choose the file again.');
  }
  return file;
}

/** Called by submitOrder_ after the row is written: names, shares and records a staged file. Returns its URL. */
function docsAttach_(sheet, row, trackerId, kind, fileId, me) {
  var k = docsKind_(kind);
  var file = docsStagedFile_(fileId, kind, me);
  var ext = (String(file.getName()).match(/\.[a-z0-9]+$/i) || ['.pdf'])[0].toLowerCase();
  file.setName(docsFileName_(trackerId, kind, ext));
  file.setDescription('ICF order ' + trackerId + ' – ' + k.label + ', uploaded by ' + me.name + ' at intake');
  docsShare_(file);
  var url = file.getUrl();
  var f = {}; f[k.col] = url;
  setRowFields(sheet, row, f);
  return url;
}

/** CRE (or Admin): add or replace a file on an order already logged. form = { trackerId, kind, file }. */
function uploadOrderDocument_(form) {
  form = form || {};
  var k = docsKind_(form.kind);
  var me = CURRENT_STAFF_;
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String(form.trackerId || ''));
  if (row === -1) throw new Error('Order not found.');
  requireCanAct_(sheet, row);
  var f = getRowFields(sheet, row, ['Tracker ID', 'Status', 'Payment Terms Type', 'CRM PO URL', 'Customer PO URL']);
  var trackerId = String(f['Tracker ID']);
  var info = docsInfo_(f);
  var existing = String(f[k.col] || '');
  if (!info.canAdd) throw new Error('This order is cancelled.');
  if (existing && !info.canReplace) {
    throw new Error('Accounts has already verified this order against the ' + k.label + ' on file, so it can’t be replaced now. Ask the admin if it’s wrong.');
  }
  var d = docsDecode_(form.file);
  var file = getOrCreateFolder(DOCS_FOLDER_NAME).createFile(Utilities.newBlob(d.bytes, d.mime, docsFileName_(trackerId, form.kind, d.ext)));
  file.setDescription('ICF order ' + trackerId + ' – ' + k.label + ', uploaded by ' + me.name + ' on ' + opsFmt_(new Date()));
  docsShare_(file);
  var url = file.getUrl();

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var now = getRowFields(sheet, row, ['Status', k.col]);
    if (now['Status'] !== f['Status'] || String(now[k.col] || '') !== existing) {
      file.setTrashed(true);
      throw new Error('This order changed while the file was uploading. Look it up again.');
    }
    var w = {}; w[k.col] = url;
    setRowFields(sheet, row, w);
  } finally {
    lock.releaseLock();
  }
  if (existing) {
    // Keep the old file (it may be what someone already printed) -- just mark it.
    try {
      var old = DriveApp.getFileById((existing.match(/\/d\/([^/]+)/) || [])[1] || '');
      old.setName('(replaced ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM') + ') ' + old.getName());
    } catch (e) { Logger.log('Could not rename replaced file: ' + e); }
  }
  return { trackerId: trackerId, kind: form.kind, label: k.label, url: url, replaced: !!existing };
}

// ================================================================
// Wiring used by Code.js
// ================================================================
function docsApiMap_() {
  return {
    stageOrderDocument:  { fn: stageOrderDocument_,  roles: ['CRE'] },
    uploadOrderDocument: { fn: uploadOrderDocument_, roles: ['CRE'], log: 'Uploaded PO document' }
  };
}

function docsActivityDetail_(fnName, a, result) {
  result = result || {};
  if (fnName === 'uploadOrderDocument') return (result.label || '') + (result.replaced ? ' replaced' : ' added');
  return '';
}
