/**
 * ICF Order Processing Toolkit
 * ------------------------------------
 * One Apps Script project, one web app deployment, three linked tools -- each
 * reached via a URL parameter so there is only one deployment URL to manage:
 *
 *   .../exec                -> Wrapper PO Generator      (Sales/CRE, at intake,
 *                               plus a general order lookup and the CRE's
 *                               "Needs Action" pane for delivery-status updates)
 *   .../exec?page=accounts  -> Accounts (all-in-one)     (Accounts: verify payment,
 *                               log ops personnel's pickup/vehicle, generate gate pass,
 *                               record balance payments)
 *   .../exec?page=dashboard -> Owner Dashboard            (Sambhu/directors:
 *                               read-only view over the same tracker -- see
 *                               TOOL 5 below for what it shows and why)
 *
 * STAFF SIGN-IN (added Sep 2026): every page now asks for a Staff Code + PIN
 * before it shows anything. Staff, roles and PINs live in the "Staff" tab of
 * this spreadsheet -- see the STAFF & SIGN-IN section further down for the
 * full design. In short:
 *   - Every browser call goes through ONE server entry point, callApi(),
 *     which checks the session and the caller's role before running the
 *     real function. The real functions all end in "_" (e.g. submitOrder_),
 *     which Apps Script refuses to run from the browser directly -- so the
 *     sign-in cannot be bypassed from the browser console.
 *   - The signed-in person's name is what gets written as "CRE Name" at
 *     intake and "Verified By" at payment verification -- no more typing
 *     names (which is how "sony" and "sony james" both ended up in the sheet).
 *   - Every change is written to an "Activity Log" tab: who, what, when,
 *     which order.
 *
 * DISPATCH TYPE (added Sep 2026): each product in the Product Catalog tab
 * now carries a Dispatch Type -- "Vehicle" (default) or "Courier". An order
 * whose products are ALL courier products (today: Bio Bacteria - 1Kg) runs a
 * shorter pipeline with no vehicle, e-way bill or gate pass:
 *     Logged -> [Accounts verifies payment] -> Sent to Ops
 *            -> [Ops posts the packet, hands the postal receipt to the CRE]
 *            -> Posted  (CRE records courier + tracking no.; Delivery Status = In Transit)
 *            -> [CRE confirms delivery] -> Delivery Status = Delivered (closed)
 *   An End Customer courier order that isn't fully paid at verification
 *   goes to "On Hold - Balance Due" instead of "Sent to Ops" -- there's no
 *   gate pass stage to stop it later, so this is the checkpoint. Recording
 *   the balance (Pending Payments) releases it to Ops automatically.
 *   A mixed order (a courier product plus anything else) goes the normal
 *   vehicle route -- the packet simply travels with the vehicle.
 *
 * STANDBY (added Oct 2026): a customer-caused delay can put an order "On
 * Standby" -- Accounts asks, an Admin approves (a Director past the limits),
 * and the time is kept out of the turnaround figures. Directors also get an
 * approvals panel on the dashboard and a Settings page (?page=settings, the
 * only page an Admin can't open). All of it lives in Standby.gs plus three
 * small include files (standby_accounts, standby_admin, standby_dashboard)
 * and settings.html -- see the note at the top of Standby.gs.
 *
 * Old links (?page=verify, ?page=ops, ?page=delivery) still work and now route
 * to the combined Accounts page, since in practice only Sales and Accounts ever
 * touch this system -- there was no reason to keep those as separate pages.
 *
 * OWNERSHIP CHANGE: Delivery Status updates used to be an Accounts action.
 * That responsibility now belongs to the CRE -- once Accounts hands an order
 * off with a Gate Pass (Status = "Gate-Verified"), it's the CRE's job to track
 * it through to Delivered/Returned, since they're the one in touch with the
 * customer. Accounts' "Needs Action" list (getPendingOrders) no longer
 * includes Gate-Verified orders; the CRE's own list (getCREActionItems) does.
 *
 * SETUP (one-time):
 *   1. Open the "ICF - Order Tracker" Google Sheet.
 *   2. Extensions > Apps Script.
 *   3. Replace Code.gs with this file.
 *   4. Keep FOUR html files, named exactly: index, accounts, dashboard, auth
 *      (Apps Script adds .html automatically -- type only the name shown).
 *      Delete the old verify / ops / delivery files if present -- no longer used.
 *   5. Add the new column(s) to the tracker sheet's header row (see the
 *      column layout note below) BEFORE using any of these tools.
 *   6. Deploy > New deployment > Web app. Execute as: Me. Access: as appropriate.
 *   7. Share the base URL (Sales/CRE) and the same URL with ?page=accounts
 *      (Accounts) with the right people.
 *   8. Add a tab named exactly "Pincode Directory" to this same spreadsheet,
 *      with headers Pincode | District | State in row 1, and import the
 *      pincode_directory.csv data below that. This is what lets
 *      lookupPincode auto-fill State/District at intake without calling any
 *      external API. Not required for the tool to run -- if this tab is
 *      missing, lookupPincode just falls back to the (less reliable)
 *      external API -- but strongly recommended, since it also removes a
 *      dependency on that API's authorization/availability.
 *
 *   9. (Sep 2026) Run setupStaffAndDispatch() once from the editor -- it
 *      creates the Staff and Activity Log tabs, adds the "Dispatch Type"
 *      column to the Product Catalog (and the Bio Bacteria - 1Kg row, as
 *      Courier), writes the new AU1 header, and back-fills the AJ/AK
 *      formulas that were never dragged down. Safe to run more than once.
 *      Then set a PIN for each person in the Staff tab (see STAFF & SIGN-IN).
 *
 * SHEET COLUMN LAYOUT (A to AV, 48 columns -- must match the sheet exactly):
 *   A Tracker ID                       M Status                          Y Verification Code
 *   B Date Logged                      N Site Readiness Confirmed        Z Sent to Ops Timestamp
 *   C Institution / Customer           O Vehicle No.                    AA Received by Ops Timestamp
 *   D CRE Name                         P E-way Bill No.                 AB Vehicle Confirmed Timestamp
 *   E Total Order Value                Q Gate Pass No.                  AC Dispatch Timestamp
 *   F Advance Received                 R Gate Verification Result       AD Transport Mode
 *   G Advance % of Total               S Amendment Flag                 AE Courier / Transport Name
 *   H Payment Verification Status      T Linked Tracker ID              AF Tracking / Consignment No.
 *   I Verified By                      U Filed Date                     AG Delivery Status
 *   J Verified Date  (now holds a      V Remarks                        AH Delivery Status Last Updated
 *     full date+time, not date-only)   W Customer Requested Delivery    AI Delivered Timestamp
 *   K Bank Reference / UTR               Date                           AJ Verification-to-Pickup Time (Hrs) [formula]
 *   L Draft Bill Reference             X Priority Level                 AK Total Cycle Time (Hrs) [formula]
 *                                       AL Payment Terms Type
 *                                                                        AM Balance Fully Paid Timestamp
 *                                                                        AN Customer Phone Number
 *                                                                        AO State
 *                                                                        AP District
 *                                                                        AQ Pincode
 *                                                                        AR Wrapper PO PDF URL
 *                                                                        AS Gate Pass PDF URL
 *                                                                        AT Last Payment Timestamp
 *                                                                        AU Dispatch Type
 *                                                                        AV CRE Code
 *
 *   AJ2 formula: =IF(AND(J2<>"",AA2<>""), ROUND((AA2-J2)*24,2), "")
 *   AK2 formula: =IF(AND(J2<>"",AI2<>""), ROUND((AI2-J2)*24,2), "")
 *   Written automatically into each new order's row by submitOrder_.
 *   DO NOT drag these down onto empty rows -- that is what pushed new
 *   orders to row 1001 (see getLastOrderRow_ / compactTrackerRows).
 *
 *   AL "Payment Terms Type" holds one of two exact values, set at intake:
 *     "End Customer"   -- full payment required before a gate pass can be issued
 *     "PO Customer"    -- dealer/institution with their own PO; partial/deferred
 *                         payment is allowed through to dispatch, with a note
 *                         printed on the Gate Pass PDF
 *
 *   AM "Balance Fully Paid Timestamp" -- set automatically the moment an
 *      order's balance first reaches zero: either at intake, if the advance
 *      received already covers the total, or the moment a balance top-up
 *      (recordBalancePayment) clears it. Never set again after that, so it
 *      reflects the date the order was FIRST fully paid. Feeds the "date of
 *      complete payment" line in the Order Timeline.
 *
 *   AN "Customer Phone Number" -- Captured by the CRE at intake. Lets Accounts
 *      and the CRE both look an order up by the customer's phone number
 *      instead of the Tracker ID, since that's often what's on hand when a
 *      customer calls in (see resolveTrackerId).
 *
 *   AO/AP/AQ "State" / "District" / "Pincode" -- Captured by the CRE at
 *      intake, for sales-by-location reporting (a Pivot Table on
 *      State/District, counting Tracker ID or summing Total Order Value,
 *      answers "which district gives us the most orders" directly -- no
 *      extra tooling needed here for that).
 *
 *      The CRE types the Pincode; the client calls lookupPincode (below),
 *      which looks the pincode up in the "Pincode Directory" tab in this
 *      same spreadsheet (see SETUP step 8) and returns State/District from
 *      there -- instantly, with no network call. Only if that tab is
 *      missing or doesn't have the pincode yet does it fall back to India
 *      Post's public API. Either way, State/District are auto-filled into
 *      editable fields so the CRE can correct them if the lookup is wrong
 *      -- but in the normal case they always come from the same source and
 *      are spelled the same way every time, which is what makes the Pivot
 *      Table trustworthy. Pincode itself is optional (an order can be
 *      logged without it, with State/District typed in by hand).
 *
 *      >>> ACTION REQUIRED: add "State", "District", "Pincode", "Wrapper PO
 *      >>> PDF URL", "Gate Pass PDF URL" and "Last Payment Timestamp" as the
 *      >>> headers in cells AO1 through AT1 of the live sheet before
 *      >>> deploying this version. If you have not already added "Customer
 *      >>> Phone Number" in AN1 from an earlier update, add that too. <<<
 *
 *   AR/AS "Wrapper PO PDF URL" / "Gate Pass PDF URL" -- the Drive link to
 *      each PDF, saved the moment it's generated (submitOrder / submitDispatch)
 *      so it can be found again later without re-generating it. This is what
 *      lets a CRE or Accounts reprint a document after losing the original
 *      tab (a power cut, an accidental close) -- lookupOrder returns
 *      whichever of these two are set, and the Look Up screen on each page
 *      shows a reprint link when there's something to reprint. AS is blank
 *      until an order actually reaches dispatch (no gate pass exists before
 *      then); AR is set for every order, since a Wrapper PO is generated at
 *      intake for all of them.
 *
 *   AT "Last Payment Timestamp" -- stamped every time money is confirmed
 *      against an order: the initial advance (submitVerification) and any
 *      later top-up (recordBalancePayment) both overwrite it, so it always
 *      holds the most recent payment event, not just the first one. Exists
 *      purely to make getAccountsSummary's "payments recorded today" count
 *      accurate -- without it, that number could only reflect the initial
 *      advance and would quietly miss same-day balance top-ups.
 *
 *   AU "Dispatch Type" -- "Vehicle" or "Courier", decided at intake from the
 *      products on the order (see DISPATCH TYPE above). Blank on orders
 *      logged before this column existed; every reader treats blank as
 *      "Vehicle", which is what all of those orders were.
 *
 *   AV "CRE Code" -- the Staff Code of the CRE who OWNS the order: set at
 *      intake to whoever logged it, changed only by an Admin reassignment.
 *      Ownership decides whose Needs Action list / tiles an order counts in
 *      and who may act on it (see ORDER OWNERSHIP, COVER & ACCESS REQUESTS).
 *      Rows logged before this column existed are matched to a staff code
 *      by CRE Name, once, by setupStaffAndDispatch().
 *
 *   PRODUCTS -- an order can carry any number of products, so these don't
 *      live as columns on the main tracker row at all. They're captured at
 *      intake as an add-a-line list (product + quantity, add as many rows
 *      as needed) and written to a separate "Order Line Items" tab (Tracker
 *      ID | Product | Quantity, one row per product per order). That tab is
 *      created automatically the first time an order is submitted -- no
 *      manual setup needed, unlike the Pincode Directory.
 *
 *      The product dropdown itself comes from a separate "Product Catalog"
 *      tab (Product | Active), also auto-created and seeded on first use
 *      (from DEFAULT_PRODUCT_LIST below) -- so the catalog is a spreadsheet
 *      to edit, not code to redeploy. Add a product by adding a row; retire
 *      one by setting Active to N (not deleting the row, so the name stays
 *      legible against any past order that used it); the dropdown follows
 *      row order, not alphabetical, so keep related products grouped by
 *      keeping their rows together. Renaming a row changes the name for
 *      NEW orders only -- past orders in Order Line Items keep whatever
 *      name was current when they were logged, so a rename (as opposed to
 *      a typo fix) will show as two separate lines in any product-level
 *      report spanning before/after the rename, the same trade-off as
 *      State/District spelling changes.
 *
 *      Products also print on the Wrapper PO PDF and are visible on the
 *      "Look Up an Enquiry" screen alongside the rest of the order. Not yet
 *      broken out on the Owner Dashboard (see the placeholder card there) --
 *      the data exists and is ready whenever that's worth wiring up.
 *
 *   NOTE ON "STATUS" vs "DELIVERY STATUS": these are two separate columns and
 *   are easy to confuse. "Status" (M) is the internal workflow stage and stops
 *   advancing once an order reaches "Gate-Verified" -- there is no later
 *   Status value for delivery. "Delivery Status" (AG) is what then tracks
 *   Pending -> In Transit -> Delivered/Returned, and is now updated by the CRE.
 *   Courier orders stop at "Posted" instead of "Gate-Verified" -- the two are
 *   treated alike everywhere as "dispatched" (see isDispatchedStatus_)
 *   rather than Accounts. An order showing Status = "Gate-Verified" and
 *   Delivery Status = "Delivered" at the same time is normal and expected,
 *   not a data conflict.
 */

// ---- CONFIG ----
var SHEET_ID = '1uWsfRpJpNzQ1bq2x2xG6DZKEpXrwMPddd5Cdy4JVseU'; // "ICF - Order Tracker"
var PDF_FOLDER_NAME = 'ICF Wrapper POs';
var GATE_PASS_FOLDER_NAME = 'ICF Gate Passes';
var BALANCE_DUE_TOLERANCE = 1; // rupees -- ignore rounding dust below this as "fully paid"
var PINCODE_API_URL = 'https://api.postalpincode.in/pincode/'; // India Post public pincode lookup

var HEADERS = [
  'Tracker ID', 'Date Logged', 'Institution / Customer', 'CRE Name',
  'Total Order Value', 'Advance Received', 'Advance % of Total',
  'Payment Verification Status', 'Verified By', 'Verified Date',
  'Bank Reference / UTR', 'Draft Bill Reference', 'Status',
  'Site Readiness Confirmed', 'Vehicle No.', 'E-way Bill No.',
  'Gate Pass No.', 'Gate Verification Result', 'Amendment Flag',
  'Linked Tracker ID', 'Filed Date', 'Remarks',
  'Customer Requested Delivery Date', 'Priority Level', 'Verification Code',
  'Sent to Ops Timestamp', 'Received by Ops Timestamp',
  'Vehicle Confirmed Timestamp', 'Dispatch Timestamp', 'Transport Mode',
  'Courier / Transport Name', 'Tracking / Consignment No.',
  'Delivery Status', 'Delivery Status Last Updated', 'Delivered Timestamp',
  'Verification-to-Pickup Time (Hrs)', 'Total Cycle Time (Hrs)',
  'Payment Terms Type', 'Balance Fully Paid Timestamp', 'Customer Phone Number',
  'State', 'District', 'Pincode', 'Wrapper PO PDF URL', 'Gate Pass PDF URL',
  'Last Payment Timestamp', 'Dispatch Type', 'CRE Code'
];

var DISPATCH_VEHICLE = 'Vehicle';
var DISPATCH_COURIER = 'Courier';
var STATUS_HOLD_BALANCE = 'On Hold - Balance Due'; // courier-only: End Customer, not fully paid at verification
var STATUS_POSTED = 'Posted';                       // courier-only equivalent of Gate-Verified

/** True once an order has physically left ICF -- by vehicle (Gate-Verified)
 *  or by post/courier (Posted). Everything that used to ask
 *  "status === 'Gate-Verified'" to mean "dispatched" asks this instead. */
function isDispatchedStatus_(status) {
  return status === 'Gate-Verified' || status === STATUS_POSTED;
}

/** Blank (older orders) reads as Vehicle. */
function normalizeDispatchType_(val) {
  return String(val || '').trim().toLowerCase() === 'courier' ? DISPATCH_COURIER : DISPATCH_VEHICLE;
}

// Seed list for the "Product Catalog" tab (see getOrCreateProductCatalogSheet)
// -- used only to populate that tab the first time it's created, and as a
// last-resort fallback if the tab ever ends up with zero active rows (e.g.
// someone accidentally clears it). The tab itself, not this array, is the
// actual source of truth once it exists -- see getProductList below.
var DEFAULT_PRODUCT_LIST = [
  'Eco Portable Toilet IWC',
  'Eco Portable Toilet EWC',
  'Eco Portable Toilet Shower',
  'Eco Portable Toilet Flat Cabin',
  'Eco Portable Toilet Urinals',
  'Premium Portable Toilet IWC',
  'Premium Portable Toilet EWC',
  'Premium Portable Toilet Shower',
  'Premium Portable Toilet Urinals',
  'Premium Portable Toilet Flat Cabin',
  'Chemical Toilet',
  'Rental Services - Portable Toilet',
  'Premium EWC without Wash Basin',
  'Gents Waterless 4-in-1 Urinals',
  'ReLeaf Office Container Z 2010 Model',
  'Ultra Series 1A',
  'Ultra Series 1 (35 flushes/day)',
  'Ultra Series II (50 flushes/day)',
  'Ultra Series III (75 flushes/day)',
  'Ultra Series 4 - Bio Septic Tank',
  'Ultra Series V A - Water Tank',
  'Ultra Series 5',
  'Ultra Series VI',
  'Ultra Series VII',
  'Ultra Series XI',
  'Ultra Series 9'
];

var PRODUCT_CATALOG_SHEET_NAME = 'Product Catalog'; // tab layout: Product | Active (Y/N) | Dispatch Type (Vehicle/Courier)

// Products that ship by post/courier rather than on an ICF vehicle. Only used
// to seed the Dispatch Type column the first time it's added -- after that,
// the Product Catalog tab is the source of truth (type "Courier" in column C
// for any new small-parcel product).
var DEFAULT_COURIER_PRODUCTS = ['Bio Bacteria - 1Kg'];

/**
 * Gets the "Product Catalog" tab, creating and seeding it from
 * DEFAULT_PRODUCT_LIST the first time it's needed -- same auto-create
 * pattern as the Order Line Items tab, so there's no manual setup step.
 * Every seeded row starts Active = Y.
 */
function getOrCreateProductCatalogSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(PRODUCT_CATALOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PRODUCT_CATALOG_SHEET_NAME);
    sheet.getRange(1, 1, 1, 2).setValues([['Product', 'Active']]);
    sheet.setFrozenRows(1);
    var seedRows = DEFAULT_PRODUCT_LIST.map(function (p) { return [p, 'Y']; });
    sheet.getRange(2, 1, seedRows.length, 2).setValues(seedRows);
  }
  ensureCatalogDispatchColumn_(sheet);
  return sheet;
}

/**
 * Adds the "Dispatch Type" column (C) to an existing Product Catalog tab
 * the first time it's needed, and makes sure every DEFAULT_COURIER_PRODUCTS
 * entry exists and is marked Courier. Existing rows are left blank, which
 * reads as Vehicle -- nothing about the current products changes.
 */
function ensureCatalogDispatchColumn_(sheet) {
  var header = String(sheet.getRange(1, 3).getValue() || '').trim();
  if (header === 'Dispatch Type') return;
  sheet.getRange(1, 3).setValue('Dispatch Type');
  var lastRow = sheet.getLastRow();
  var names = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) { return String(r[0]).trim().toLowerCase(); }) : [];
  DEFAULT_COURIER_PRODUCTS.forEach(function (p) {
    var idx = names.indexOf(p.toLowerCase());
    if (idx === -1) {
      sheet.appendRow([p, 'Y', DISPATCH_COURIER]);
    } else {
      sheet.getRange(idx + 2, 3).setValue(DISPATCH_COURIER);
    }
  });
}

/**
 * Same list as getProductList_, but with each product's Dispatch Type, so
 * the intake form can tell the CRE up front when an order will go by
 * courier. [{ name, dispatchType }, ...], active rows only, sheet order.
 */
function getProductCatalog_() {
  var sheet = getOrCreateProductCatalogSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return DEFAULT_PRODUCT_LIST.map(function (p) { return { name: p, dispatchType: DISPATCH_VEHICLE }; });
  var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var results = [];
  for (var i = 0; i < data.length; i++) {
    var name = String(data[i][0] || '').trim();
    var active = String(data[i][1] || '').trim().toUpperCase();
    if (name && active === 'Y') results.push({ name: name, dispatchType: normalizeDispatchType_(data[i][2]) });
  }
  return results.length ? results : DEFAULT_PRODUCT_LIST.map(function (p) { return { name: p, dispatchType: DISPATCH_VEHICLE }; });
}

/**
 * Decides an order's Dispatch Type from its products: Courier only if EVERY
 * product on it is a courier product. Reads all catalog rows (active or
 * not), so an order can still be classified if a product was retired
 * between the form loading and the order being submitted.
 */
function determineDispatchType_(lineItems) {
  var sheet = getOrCreateProductCatalogSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2 || !lineItems || !lineItems.length) return DISPATCH_VEHICLE;
  var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var map = {};
  data.forEach(function (r) { map[String(r[0] || '').trim().toLowerCase()] = normalizeDispatchType_(r[2]); });
  for (var i = 0; i < lineItems.length; i++) {
    if (map[String(lineItems[i].product || '').trim().toLowerCase()] !== DISPATCH_COURIER) return DISPATCH_VEHICLE;
  }
  return DISPATCH_COURIER;
}

/**
 * Returns the product list for the client to build its dropdown from, read
 * from the "Product Catalog" tab rather than hardcoded -- so adding,
 * renaming, or retiring a product is a spreadsheet edit, not a code change.
 *
 * Only rows with Active = Y are returned, in sheet row order (not
 * alphabetical), so the Eco / Premium / Ultra Series grouping stays intact
 * as long as that's how the rows are kept. To retire a product, set Active
 * to N rather than deleting the row -- the name stays legible against any
 * past order that used it, it just stops appearing for new ones.
 *
 * Falls back to DEFAULT_PRODUCT_LIST only if the tab exists but every row
 * happens to be inactive or blank (nothing else to show the CRE) -- pure
 * insurance against an accidental mass-edit, not the normal path.
 */
function getProductList_() {
  var sheet = getOrCreateProductCatalogSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return DEFAULT_PRODUCT_LIST;

  var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  var results = [];
  for (var i = 0; i < data.length; i++) {
    var name = String(data[i][0] || '').trim();
    var active = String(data[i][1] || '').trim().toUpperCase();
    if (name && active === 'Y') results.push(name);
  }
  return results.length ? results : DEFAULT_PRODUCT_LIST;
}

var LINE_ITEMS_SHEET_NAME = 'Order Line Items'; // tab layout: Tracker ID | Product | Quantity

/**
 * Gets the "Order Line Items" tab, creating it with headers if it doesn't
 * exist yet -- unlike the Pincode Directory (which needs real bulk data
 * imported by hand), this one only ever needs its header row, so there's no
 * reason to make that a manual setup step.
 */
function getOrCreateLineItemsSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(LINE_ITEMS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(LINE_ITEMS_SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([['Tracker ID', 'Product', 'Quantity']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Writes an order's product lines in one batch call. items = [{product, quantity}, ...].
 * Called right after the order's main row is appended in submitOrder.
 */
function writeLineItems(trackerId, items) {
  if (!items || !items.length) return;
  var sheet = getOrCreateLineItemsSheet();
  var rows = items.map(function (it) {
    return [trackerId, it.product, Number(it.quantity) || 0];
  });
  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, 3).setValues(rows);
}

/** Returns [{product, quantity}, ...] for one order, most-recently-added first is not relevant here -- sheet order is preserved. */
function getOrderLineItems_(trackerId) {
  var sheet = getOrCreateLineItemsSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var target = (trackerId || '').trim().toLowerCase();
  var results = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === target) {
      results.push({ product: data[i][1], quantity: data[i][2] });
    }
  }
  return results;
}


// ---------------- ROUTER ----------------
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'wrapper';
  // Old page names all fold into the single combined Accounts page.
  var fileMap = {
    wrapper: 'index',
    accounts: 'accounts',
    verify: 'accounts',
    ops: 'accounts',
    delivery: 'accounts',
    dashboard: 'dashboard',
    admin: 'admin',
    settings: 'settings'
  };
  var file = fileMap[page] || 'index';
  var titleMap = {
    wrapper: 'ICF Internal PO Generator',
    accounts: 'ICF Accounts',
    verify: 'ICF Accounts',
    ops: 'ICF Accounts',
    delivery: 'ICF Accounts',
    dashboard: 'ICF Dashboard',
    admin: 'ICF Admin',
    settings: 'ICF Settings'
  };
  // Evaluated as a template (not a plain file) so each page can pull in the
  // shared sign-in screen with <?!= include('auth'); ?> -- one copy of the
  // sign-in code for all three pages instead of three to keep in sync.
  var template = HtmlService.createTemplateFromFile(file);
  // Only the Admin page uses this: an approval email links to
  // ?page=admin&req=<Request ID>, and that request is shown first.
  template.reqId = String((e && e.parameter && e.parameter.req) || '').replace(/[^A-Za-z0-9-]/g, '');
  return template.evaluate()
    .setTitle(titleMap[page] || 'ICF Tool')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Used by the pages as <?!= include('auth'); ?> -- returns a file's raw content. */
function include(name) {
  var html = HtmlService.createHtmlOutputFromFile(name).getContent();
  // Every page includes 'auth', so the shared Refresh-button spinner (Oct 2026)
  // rides along with it -- no page needed editing. See refresh_spinner.html.
  if (name === 'auth') {
    try { html += HtmlService.createHtmlOutputFromFile('refresh_spinner').getContent(); } catch (e) { /* page still works without it */ }
  }
  return html;
}

// ---------------- SHARED HELPERS ----------------
function getSheet() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  // Reading a column past the edge of the grid throws in Apps Script, so
  // make sure the grid is wide enough for every column in HEADERS (e.g. the
  // new AU "Dispatch Type") before anything reads it.
  var maxCols = sheet.getMaxColumns();
  if (maxCols < HEADERS.length) sheet.insertColumnsAfter(maxCols, HEADERS.length - maxCols);
  return sheet;
}

function getHeaderIndex(name) {
  var idx = HEADERS.indexOf(name);
  if (idx === -1) throw new Error('Unknown column: ' + name);
  return idx + 1; // 1-based for Sheets API
}

function findRowByTrackerId(sheet, trackerId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var target = trackerId.trim().toLowerCase();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim().toLowerCase() === target) return i + 2; // actual sheet row
  }
  return -1;
}

/**
 * Resolves a Tracker ID input that may be the full quotation number (e.g.
 * "ICESPL-0006131-R1-09-26") or just a fragment of it (e.g. "6131") -- since
 * typing the full number by hand is slow and error-prone. Tries an exact match
 * first; if that fails, falls back to a "contains" search across existing
 * Tracker IDs. If NOTHING matches on Tracker ID, falls back further to a
 * phone-number search against Customer Phone Number -- since a customer
 * calling in is more likely to be identified by their number than by a
 * quotation number nobody has memorized. Throws a clear error if the input
 * matches more than one order.
 */
function resolveTrackerId(sheet, input) {
  // String() first: a purely numeric Tracker ID arrives from the page as a
  // number, and numbers have no .trim() -- that broke the timeline.
  var trimmed = String(input == null ? '' : input).trim();
  if (!trimmed) return -1;

  var exactRow = findRowByTrackerId(sheet, trimmed);
  if (exactRow !== -1) return exactRow;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  var idCol = getHeaderIndex('Tracker ID');
  var phoneCol = getHeaderIndex('Customer Phone Number');
  var numRows = lastRow - 1;
  var idVals = sheet.getRange(2, idCol, numRows, 1).getValues();

  var target = trimmed.toLowerCase();
  var matches = [];
  for (var i = 0; i < numRows; i++) {
    var idVal = String(idVals[i][0]).trim();
    if (idVal.toLowerCase().indexOf(target) !== -1) {
      matches.push({ row: i + 2, id: idVal });
    }
  }

  // Nothing matched as a Tracker ID fragment -- try the customer's phone
  // number instead. Only kicks in for inputs that look like a phone fragment
  // (a handful of digits or more), so short numeric Tracker ID fragments
  // (e.g. "6131") keep matching exactly as before via the loop above.
  var digitsTarget = trimmed.replace(/\D/g, '');
  if (matches.length === 0 && digitsTarget.length >= 4) {
    var phoneVals = sheet.getRange(2, phoneCol, numRows, 1).getValues();
    for (var j = 0; j < numRows; j++) {
      var phoneVal = String(phoneVals[j][0] || '').replace(/\D/g, '');
      if (phoneVal && phoneVal.indexOf(digitsTarget) !== -1) {
        matches.push({ row: j + 2, id: String(idVals[j][0]).trim() });
      }
    }
  }

  if (matches.length === 0) return -1;
  if (matches.length === 1) return matches[0].row;
  throw new Error(
    'More than one order matches "' + trimmed + '": ' +
    matches.map(function (m) { return m.id; }).join(', ') +
    '. Enter a few more digits to narrow it down, or pick from the list below.'
  );
}

/**
 * The last row that actually holds an order (non-blank Tracker ID in column A),
 * or 1 if there are none. Use this -- not sheet.getLastRow() -- to decide
 * where the next order goes. See the note in submitOrder_.
 */
function getLastOrderRow_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0] || '').trim()) return i + 2;
  }
  return 1;
}

/**
 * Removes the empty rows sitting between orders in the tracker -- the rows
 * 11-1000 left behind when the AJ/AK formulas were dragged to row 1000 --
 * so the orders are contiguous again.
 *
 * Safety: a row is only removed if its Tracker ID is blank AND every cell
 * other than the two formula columns (AJ, AK) is blank. A row with anything
 * typed into it is left alone and reported in the log instead, so nothing
 * real can be deleted by this. Order Line Items are keyed by Tracker ID,
 * not row number, so moving orders up doesn't disturb them.
 *
 * Also clears the leftover AJ/AK formulas below the last order, so the
 * sheet's "last row" is the last order again. Safe to run more than once.
 * Returns the number of rows removed.
 */
function compactTrackerRows() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return 0;
    var width = HEADERS.length;
    var data = sheet.getRange(2, 1, lastRow - 1, width).getValues();
    var ajIdx = HEADERS.indexOf('Verification-to-Pickup Time (Hrs)');
    var akIdx = HEADERS.indexOf('Total Cycle Time (Hrs)');

    var removable = [], keptBlankId = [];
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0] || '').trim()) continue;
      var other = false;
      for (var c = 0; c < width; c++) {
        if (c === ajIdx || c === akIdx) continue;
        if (data[i][c] !== '' && data[i][c] !== null) { other = true; break; }
      }
      if (other) keptBlankId.push(i + 2); else removable.push(i + 2);
    }

    // Delete bottom-up in contiguous blocks (one call per block, not per row).
    var removed = 0;
    for (var j = removable.length - 1; j >= 0; ) {
      var end = removable[j], start = end;
      while (j - 1 >= 0 && removable[j - 1] === start - 1) { j--; start--; }
      sheet.deleteRows(start, end - start + 1);
      removed += end - start + 1;
      j--;
    }
    if (keptBlankId.length) {
      Logger.log('Left in place (blank Tracker ID but other data present) -- check by hand: rows ' + keptBlankId.join(', '));
    }
    Logger.log('Removed ' + removed + ' empty row(s). Orders now end at row ' + getLastOrderRow_(sheet) + '.');
    return removed;
  } finally {
    lock.releaseLock();
  }
}

function trackerIdExists(sheet, trackerId) {
  return findRowByTrackerId(sheet, trackerId) !== -1;
}

/** Writes {headerName: value, ...} into the given row, by header name -- order-independent. */
// Reference numbers are stored as TEXT (Oct 2026). Without this, a long
// all-digit UTR such as 627646832323627... is turned into a number by
// Sheets and its last digits are lost for good (shown as 6.28E+23).
var TEXT_FIELDS_ = { 'Bank Reference / UTR': true, 'E-way Bill No.': true, 'Tracking / Consignment No.': true };

function setRowFields(sheet, row, fieldsObj) {
  Object.keys(fieldsObj).forEach(function (key) {
    var col = getHeaderIndex(key);
    var cell = sheet.getRange(row, col);
    if (TEXT_FIELDS_[key]) cell.setNumberFormat('@');
    cell.setValue(fieldsObj[key]);
  });
}

/**
 * appendRow, except the listed columns (1-based) are formatted as text BEFORE
 * the values go in -- so UTRs and other long numbers keep every digit.
 */
function appendRowText_(sheet, values, textCols) {
  var row = sheet.getLastRow() + 1;
  (textCols || []).forEach(function (c) { sheet.getRange(row, c).setNumberFormat('@'); });
  sheet.getRange(row, 1, 1, values.length).setValues([values.map(function (v, i) {
    return (textCols || []).indexOf(i + 1) !== -1 && v !== '' && v !== null && v !== undefined ? String(v) : v;
  })]);
  return row;
}

function getRowFields(sheet, row, headerNames) {
  var result = {};
  headerNames.forEach(function (name) {
    var col = getHeaderIndex(name);
    result[name] = sheet.getRange(row, col).getValue();
  });
  return result;
}

function sanitizeForFilename(text) {
  return String(text).replace(/[\/\\:*?"<>|]/g, '-');
}

function formatAmount(n) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Balance still owed on an order. Treats anything under the rounding
 *  tolerance as fully paid, so stray paisa-level rounding never blocks dispatch
 *  or lingers forever in the Pending Payments list. */
function computeBalanceDue(total, advance) {
  var balance = (Number(total) || 0) - (Number(advance) || 0);
  return balance > BALANCE_DUE_TOLERANCE ? Math.round(balance * 100) / 100 : 0;
}

/** Whole days between today and a target date (may be a Date object or a
 *  date-like string/blank cell). Negative means the date has already passed.
 *  Returns null when there's no usable date, so callers can skip the urgency
 *  flag entirely rather than treating a blank delivery date as "overdue". */
function computeDaysUntilDate(dateVal) {
  if (!dateVal) return null;
  var target = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
  if (isNaN(target.getTime())) return null;
  var today = new Date();
  var todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  var targetMid = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((targetMid - todayMid) / 86400000);
}

function generateVerificationCode() {
  return Utilities.getUuid().split('-')[0].toUpperCase(); // short, readable, unique enough for this purpose
}

function getOrCreateFolder(name) {
  var folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

function appendSectionTable(body, heading, rows) {
  var hp = body.appendParagraph(heading);
  hp.editAsText().setBold(true).setFontSize(11).setForegroundColor('#2E74B5');
  hp.setSpacingBefore(10).setSpacingAfter(4);

  var table = body.appendTable(rows);
  table.setBorderWidth(0.5);
  table.setColumnWidth(0, 220);

  for (var i = 0; i < rows.length; i++) {
    var labelPara = table.getCell(i, 0).getChild(0).asParagraph();
    labelPara.editAsText().setBold(true).setFontSize(9.5);
    table.getCell(i, 0).setBackgroundColor('#F2F2F2');
    var valuePara = table.getCell(i, 1).getChild(0).asParagraph();
    valuePara.editAsText().setBold(false).setFontSize(9.5);
  }
}

// ================================================================
// TOOL 1: WRAPPER PO GENERATOR  (CRE, at intake)
// ================================================================
/**
 * form = { trackerId, institution, customerPhone, creName, totalValue, advanceReceived,
 *          requestedDeliveryDate, priorityLevel, paymentTermsType, state, district, pincode,
 *          lineItems }
 * trackerId is the CRM's own Quotation No., typed in by the CRE.
 * customerPhone is optional but recommended -- it lets Accounts and the CRE
 * both find this order later by phone number instead of the Tracker ID.
 * paymentTermsType is 'End Customer' (full payment required before gate pass)
 * or 'PO Customer' (dealer/institution with their own PO -- partial/deferred
 * payment allowed through to dispatch). Recorded now, at intake, since this is
 * the point Sales actually knows which kind of order this is.
 * state/district/pincode are for sales-by-location reporting. pincode is
 * optional; when given, the client has already resolved it to state/district
 * via lookupPincode (below) before this is called, so those two arrive
 * pre-filled and this function just stores whatever the CRE confirmed.
 * lineItems = [{ product, quantity }, ...] -- at least one required. These
 * don't live on the main tracker row (an order can carry any number of
 * products) -- they're written to the separate "Order Line Items" tab, one
 * row per product, via writeLineItems.
 */
function submitOrder_(form) {
  // CRE Name comes from whoever is signed in, not from a typed field -- so
  // it's always spelled the same way and can't be someone else's name.
  form.creName = currentStaffName_();
  if (!form.institution || !form.creName) {
    throw new Error('Institution is required.');
  }
  var trackerId = (form.trackerId || '').trim();
  if (!trackerId) {
    throw new Error('CRM Quotation / Reference No. is required.');
  }
  var lineItems = (form.lineItems || []).filter(function (it) {
    return it && it.product && Number(it.quantity) > 0;
  });
  if (!lineItems.length) {
    throw new Error('At least one product with a quantity greater than zero is required.');
  }
  var paymentTermsType = form.paymentTermsType === 'PO Customer' ? 'PO Customer' : 'End Customer';
  var dispatchType = determineDispatchType_(lineItems);

  var sheet = getSheet();

  // Two CREs can now submit at the same moment. Without a lock, both could
  // read the same "next empty row" and one order would overwrite the other,
  // or both could pass the duplicate check below for the same Quotation No.
  // The lock makes the check-then-write a single step; it's released
  // automatically when this function returns or throws.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new Error('The tracker is busy saving another order. Please click Generate again in a few seconds.');
  }

  if (trackerIdExists(sheet, trackerId)) {
    throw new Error('This Quotation No. (' + trackerId + ') is already logged in the tracker. Check for a duplicate entry before proceeding.');
  }

  var total = parseFloat(form.totalValue) || 0;
  var advance = parseFloat(form.advanceReceived) || 0;
  if (total > 0 && advance > total) {
    throw new Error('The advance (\u20b9' + formatAmount(advance) + ') is more than the order value (\u20b9' + formatAmount(total) + '). ' +
      'Enter only this order\u2019s share (up to \u20b9' + formatAmount(total) + ') and tell Accounts about the extra \u20b9' +
      formatAmount(Math.round((advance - total) * 100) / 100) + ' \u2013 they record it when verifying.');
  }
  var advancePct = total > 0 ? Math.round((advance / total) * 1000) / 10 : 0;
  var dateLogged = new Date();
  var priority = form.priorityLevel === 'High' ? 'High' : 'Normal';

  var row = new Array(HEADERS.length).fill('');
  function set(name, val) { row[HEADERS.indexOf(name)] = val; }
  set('Tracker ID', trackerId);
  set('Date Logged', dateLogged);
  set('Institution / Customer', form.institution);
  set('Customer Phone Number', (form.customerPhone || '').trim());
  set('CRE Name', form.creName);
  set('Total Order Value', total);
  set('Advance Received', advance);
  set('Advance % of Total', advancePct + '%');
  set('Payment Verification Status', 'Not Verified');
  set('Status', 'Logged');
  set('Customer Requested Delivery Date', form.requestedDeliveryDate || '');
  set('Priority Level', priority);
  set('Payment Terms Type', paymentTermsType);
  set('State', (form.state || '').trim());
  set('District', (form.district || '').trim());
  set('Pincode', (form.pincode || '').trim());
  set('Dispatch Type', dispatchType);
  set('CRE Code', CURRENT_STAFF_ ? CURRENT_STAFF_.code : '');

  // If the advance received at intake already covers the full order value,
  // the order is fully paid from day one -- stamp it now, since
  // recordBalancePayment (the only other place this column is set) will
  // never get called for an order like this.
  if (computeBalanceDue(total, advance) <= 0) {
    set('Balance Fully Paid Timestamp', dateLogged);
  }

  // NOT appendRow: appendRow writes below the last row with ANY content,
  // and a formula showing "" counts as content -- which is how orders ended
  // up at row 1001+ after the AJ/AK formulas were dragged down to row 1000.
  // Writing to the row after the last Tracker ID ignores stray formulas,
  // formatting, or anything else sitting further down the sheet.
  var newRow = getLastOrderRow_(sheet) + 1;
  if (newRow > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 50);
  sheet.getRange(newRow, 1, 1, row.length).setValues([row]);
  SpreadsheetApp.flush();
  lock.releaseLock(); // the row is written -- the PDF below doesn't need to hold up other CREs

  // Force the Advance % column to plain text so Sheets doesn't silently convert
  // "98.7%" into the raw fraction 0.987 -- keeps what's stored matching what's displayed.
  var pctCol = getHeaderIndex('Advance % of Total');
  var pctRange = sheet.getRange(newRow, pctCol);
  pctRange.setNumberFormat('@');
  pctRange.setValue(advancePct + '%');

  // The AJ/AK cycle-time formulas were meant to be dragged down by hand and
  // never were, so both columns sat empty. Written per row from now on;
  // setupStaffAndDispatch() back-fills the older rows.
  writeCycleFormulas_(sheet, newRow);

  writeLineItems(trackerId, lineItems);

  var pdfUrl = generateWrapperPdf(trackerId, dateLogged, form.institution, form.creName, total, advance, advancePct, form.requestedDeliveryDate, priority, paymentTermsType, form.state, form.district, form.pincode, lineItems, dispatchType);

  // Saved so the PDF can be reprinted later from the Look Up screen without
  // regenerating it -- see the AR/AS note in the column layout comment above.
  setRowFields(sheet, newRow, { 'Wrapper PO PDF URL': pdfUrl });

  return { trackerId: trackerId, advancePct: advancePct, pdfUrl: pdfUrl, priority: priority, dispatchType: dispatchType };
}

/** Writes the AJ (verification-to-pickup) and AK (total cycle) formulas into one row. */
function writeCycleFormulas_(sheet, row) {
  var J = 'J' + row, AA = 'AA' + row, AI = 'AI' + row;
  sheet.getRange(row, getHeaderIndex('Verification-to-Pickup Time (Hrs)'))
    .setFormula('=IF(AND(' + J + '<>"",' + AA + '<>""), ROUND((' + AA + '-' + J + ')*24,2), "")');
  sheet.getRange(row, getHeaderIndex('Total Cycle Time (Hrs)'))
    .setFormula('=IF(AND(' + J + '<>"",' + AI + '<>""), ROUND((' + AI + '-' + J + ')*24,2), "")');
}

/**
 * Resolves a 6-digit Indian pincode to its State and District, so the CRE
 * can just type the pincode at intake and have State/District come back
 * pre-filled -- rather than typing both by hand, where spelling drifts
 * ("Kannur" vs "Cannanore" vs "kannur dist") would otherwise quietly wreck
 * any Pivot Table built on those columns later. The client still shows
 * State/District as editable fields, so a wrong or not-yet-covered pincode
 * can always be corrected by hand.
 *
 * Looks up the "Pincode Directory" sheet tab first (see
 * lookupPincodeFromDirectory) -- instant and works with no network call at
 * all, which is what makes this reliable. Only falls back to India Post's
 * public API (lookupPincodeFromApi) if the directory tab is missing, or the
 * pincode isn't in it yet (e.g. a newly issued pincode).
 *
 * Returns { success: true, state, district, source } on a match, or
 * { success: false, message } if the pincode isn't found anywhere or every
 * lookup path fails -- callers should fall back to manual entry either way,
 * not block order entry on this. source is 'directory' or 'api', mainly for
 * anyone debugging via View > Executions.
 */
function lookupPincode_(pincode) {
  var trimmed = (pincode || '').trim();
  if (!/^\d{6}$/.test(trimmed)) {
    return { success: false, message: 'Enter a valid 6-digit pincode.' };
  }

  var fromDirectory = lookupPincodeFromDirectory(trimmed);
  if (fromDirectory) return fromDirectory;

  return lookupPincodeFromApi(trimmed);
}

var PINCODE_DIRECTORY_SHEET_NAME = 'Pincode Directory'; // tab layout: Pincode | District | State

/**
 * Looks up a pincode in the local "Pincode Directory" sheet tab, if one
 * exists. Uses createTextFinder rather than reading the whole ~19,000-row
 * tab into memory -- Sheets does the search server-side and this only pulls
 * back the one matching row. Returns null (not a failure object) when the
 * tab doesn't exist or the pincode isn't in it, so the caller knows to try
 * the API fallback instead of treating this as a final answer.
 */
function lookupPincodeFromDirectory(pincode) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var dirSheet = ss.getSheetByName(PINCODE_DIRECTORY_SHEET_NAME);
    if (!dirSheet || dirSheet.getLastRow() < 2) return null;

    var finder = dirSheet.getRange(2, 1, dirSheet.getLastRow() - 1, 1)
      .createTextFinder(pincode)
      .matchEntireCell(true);
    var cell = finder.findNext();
    if (!cell) return null;

    var rowVals = dirSheet.getRange(cell.getRow(), 2, 1, 2).getValues()[0]; // District, State
    var district = String(rowVals[0] || '').trim();
    var state = String(rowVals[1] || '').trim();
    if (!district && !state) return null;
    return { success: true, state: state, district: district, source: 'directory' };
  } catch (e) {
    Logger.log('lookupPincodeFromDirectory error for ' + pincode + ': ' + e);
    return null; // fall through to the API rather than fail the whole lookup
  }
}

/** Falls back to India Post's public pincode API when the local directory doesn't have this pincode. */
function lookupPincodeFromApi(trimmed) {
  try {
    var response = UrlFetchApp.fetch(PINCODE_API_URL + trimmed, { muteHttpExceptions: true });
    var code = response.getResponseCode();
    if (code !== 200) {
      Logger.log('lookupPincode HTTP ' + code + ' for ' + trimmed + ': ' + response.getContentText());
      return { success: false, message: 'Could not look up the pincode right now -- enter State/District manually.' };
    }
    var data = JSON.parse(response.getContentText());
    var result = data && data[0];
    if (!result || result.Status !== 'Success' || !result.PostOffice || !result.PostOffice.length) {
      return { success: false, message: 'Pincode not found -- enter State/District manually.' };
    }
    var po = result.PostOffice[0];
    return { success: true, state: po.State || '', district: po.District || '', source: 'api' };
  } catch (e) {
    Logger.log('lookupPincode error for ' + trimmed + ': ' + e);
    return { success: false, message: 'Could not look up the pincode right now -- enter State/District manually.' };
  }
}

function generateWrapperPdf(trackerId, dateLogged, institution, creName, total, advance, advancePct, requestedDeliveryDate, priority, paymentTermsType, state, district, pincode, lineItems, dispatchType) {
  var isCourier = dispatchType === DISPATCH_COURIER;
  var folder = getOrCreateFolder(PDF_FOLDER_NAME);
  var safeName = sanitizeForFilename(trackerId);
  var doc = DocumentApp.create('Wrapper PO - ' + safeName);
  var body = doc.getBody();
  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(50).setMarginRight(50);

  var kicker = body.appendParagraph('ICF GROUP');
  kicker.editAsText().setBold(true).setFontSize(11).setForegroundColor('#1F3864');

  if (priority === 'High') {
    var flag = body.appendParagraph('PRIORITY: HIGH \u2013 AFFIX RED STICKER');
    flag.editAsText().setBold(true).setFontSize(13).setForegroundColor('#B00020');
    flag.setSpacingAfter(6);
  }

  if (isCourier) {
    var cflag = body.appendParagraph('COURIER DISPATCH \u2013 NO VEHICLE, E-WAY BILL OR GATE PASS');
    cflag.editAsText().setBold(true).setFontSize(12).setForegroundColor('#2E74B5');
    cflag.setSpacingAfter(6);
  }

  var h = body.appendParagraph('Internal Purchase Order \u2013 Wrapper');
  h.editAsText().setBold(true).setFontSize(18).setForegroundColor('#1F3864');
  h.setSpacingAfter(4);

  var sub = body.appendParagraph(
    'To be created by the CRE at intake. Product/pricing detail is not re-entered here \u2013 see attached CRM-generated PO.'
  );
  sub.editAsText().setItalic(true).setFontSize(9).setForegroundColor('#595959');
  sub.setSpacingAfter(14);

  var deliveryDateStr = requestedDeliveryDate
    ? Utilities.formatDate(new Date(requestedDeliveryDate), Session.getScriptTimeZone(), 'dd-MMM-yyyy')
    : '';

  appendSectionTable(body, '1. Order Reference', [
    ['Tracker ID', trackerId],
    ['Date', Utilities.formatDate(dateLogged, Session.getScriptTimeZone(), 'dd-MMM-yyyy')],
    ['Institution / Customer Name', institution],
    ['CRE Name', creName],
    ['Location (District, State)', [district, state].filter(function (v) { return v; }).join(', ')],
    ['Pincode', pincode || ''],
    ['Customer Requested Delivery Date', deliveryDateStr],
    ['Priority Level', priority],
    ['Dispatch Type', isCourier ? 'Courier / Post (packet)' : 'Vehicle'],
    ['Payment Terms', paymentTermsType === 'PO Customer' ? 'PO Customer \u2013 partial/deferred payment allowed' : 'End Customer \u2013 full payment required before dispatch']
  ]);

  appendSectionTable(body, '2. Order Items', (lineItems || []).map(function (it) {
    return [it.product, String(it.quantity) + (Number(it.quantity) === 1 ? ' unit' : ' units')];
  }));

  appendSectionTable(body, '3. Order Value', [
    ['Total Order Value (Rs.)', formatAmount(total)],
    ['Advance Received (Rs.)', formatAmount(advance)],
    ['Advance as % of Total', advancePct + '%']
  ]);

  appendSectionTable(body, '4. Attachments (staple behind this sheet)', [
    ['Attachments', '[ ] CRM-generated PO      [ ] Original institution-side PO']
  ]);

  appendSectionTable(body, '5. Payment Verification (filled by Accounts)', [
    ['Payment Verified By', ''],
    ['Verification Code (from Accounts Verification tool)', ''],
    ['Bank Reference / UTR No.', ''],
    ['Accounts Seal / Sign-off', '']
  ]);

  if (isCourier) {
    appendSectionTable(body, '6. Postal Dispatch (filled by ops personnel, by hand)', [
      ['Packet picked up by Operations \u2013 Sign & Time', ''],
      ['Posted via (Post office / Courier name)', ''],
      ['Tracking / Consignment No. (from receipt)', ''],
      ['Postal receipt handed to CRE \u2013 CRE Sign & Time', '']
    ]);
  } else {
    appendSectionTable(body, '6. Operations Handoff (filled by ops personnel, by hand)', [
      ['Received by Operations \u2013 Sign & Time', ''],
      ['Vehicle No. (filled on dispatch)', ''],
      ['Site Readiness Confirmed (Y/N, Date, By)', '']
    ]);
  }

  appendSectionTable(body, '7. Remarks', [
    ['Remarks / Linked Tracker ID', '']
  ]);

  doc.saveAndClose();
  var pdfBlob = DriveApp.getFileById(doc.getId()).getAs('application/pdf');
  var pdfFile = folder.createFile(pdfBlob).setName('Wrapper PO - ' + safeName + '.pdf');
  DriveApp.getFileById(doc.getId()).setTrashed(true);

  // The script always creates files under the deploying account (that's what
  // "Execute as: Me" means), so a new file defaults to private -- anyone else
  // opening the link triggers a Drive "request access" email back to that
  // account. Setting link-sharing here means Greeshma/Sonu (or anyone else
  // with the link) can open it immediately, with nothing for Accounts to
  // approve and no per-person sharing to maintain.
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return pdfFile.getUrl();
}

// ================================================================
// PENDING ORDERS PANEL (Accounts page -- "Needs Action")
// ================================================================
/**
 * Shared column-read + status-filter logic behind getNewEnquiries and
 * getPendingOrders -- both want the same {trackerId, institution, status,
 * priority} shape, just filtered to a different set of Status values, so
 * this is the one place that reads the sheet for either of them.
 */
function getOrdersByStatuses_(statuses, excludeFn) {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var idCol = getHeaderIndex('Tracker ID');
  var instCol = getHeaderIndex('Institution / Customer');
  var statusCol = getHeaderIndex('Status');
  var priorityCol = getHeaderIndex('Priority Level');
  var dispatchCol = getHeaderIndex('Dispatch Type');

  var numRows = lastRow - 1;
  var idVals = sheet.getRange(2, idCol, numRows, 1).getValues();
  var instVals = sheet.getRange(2, instCol, numRows, 1).getValues();
  var statusVals = sheet.getRange(2, statusCol, numRows, 1).getValues();
  var priorityVals = sheet.getRange(2, priorityCol, numRows, 1).getValues();
  var dispatchVals = sheet.getRange(2, dispatchCol, numRows, 1).getValues();

  var results = [];
  for (var i = numRows - 1; i >= 0; i--) { // most recently added first
    var status = statusVals[i][0];
    if (statuses.indexOf(status) === -1) continue;
    var item = {
      trackerId: idVals[i][0],
      institution: instVals[i][0],
      status: status,
      priority: priorityVals[i][0] || 'Normal',
      dispatchType: normalizeDispatchType_(dispatchVals[i][0])
    };
    if (excludeFn && excludeFn(item)) continue;
    results.push(item);
    if (results.length >= 50) break;
  }
  return results;
}

/**
 * Returns orders at Status = "Logged" -- freshly submitted at intake and not
 * yet looked at by Accounts at all. Split out into its own pane (separate
 * from getPendingOrders, which used to include these) specifically so a
 * brand-new enquiry doesn't visually blend into orders that are already
 * several stages further along (Vehicle Confirmed, etc.) -- the first thing
 * anyone should notice on this page is "something just landed and needs a
 * first look," not have it sit unnoticed in a list sorted by recency
 * alongside unrelated older-but-still-open orders.
 *
 * Same cap and reasoning as getPendingOrders -- see that function.
 */
function getNewEnquiries_() {
  return getOrdersByStatuses_(['Logged']);
}

/**
 * Returns orders needing further action from Accounts, once the initial
 * verification is behind them -- pickup/vehicle, site-readiness hold,
 * dispatch. Deliberately excludes "Logged" (see getNewEnquiries, its own
 * pane) and "Gate-Verified" (once a Gate Pass is issued, delivery-status
 * follow-up is the CRE's job -- see getCREActionItems -- not Accounts').
 *
 * Capped at 50 (generous headroom above what the UI shows) rather than a
 * tight number -- the client only ever renders the first 5 in the sidebar
 * itself and puts the rest behind a "Show all" popup, so this cap just
 * bounds worst-case payload size, not what the user can see.
 */
function getPendingOrders_() {
  // Courier orders at "Sent to Ops" are with Ops for posting and then with
  // the CRE (postal receipt) -- Accounts has nothing to do on them, so they
  // stay off this list. A courier order held for its balance DOES belong
  // here: recording that payment is Accounts' job.
  return getOrdersByStatuses_(
    [STATUS_HOLD_BALANCE, 'Sent to Ops', 'On Hold - Site Not Ready', 'Vehicle Confirmed'],
    function (it) { return it.status === 'Sent to Ops' && it.dispatchType === DISPATCH_COURIER; }
  );
}

// ================================================================
// CRE ACTION PANEL (Wrapper PO page -- "Needs Action")
// ================================================================
/**
 * Returns dispatched orders (Status = "Gate-Verified") that are not yet
 * closed out on delivery (Delivery Status not Delivered/Returned) -- this is
 * the CRE's action list. Once Accounts hands off a Gate Pass, it's on the CRE
 * to chase the customer and keep Delivery Status current, since they're the
 * one in contact with the customer, not Accounts.
 *
 * isUrgent flags an order whose Customer Requested Delivery Date is 3 days
 * away or has already passed -- a visual nudge that the CRE needs to call the
 * customer soon, both to confirm delivery and (often the same call) chase
 * any outstanding balance.
 *
 * Capped at 50 for the same reason as getPendingOrders -- the sidebar only
 * shows the first 5, with the rest reachable via the "Show all" popup.
 */
function getCREActionItems_() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var idCol = getHeaderIndex('Tracker ID');
  var instCol = getHeaderIndex('Institution / Customer');
  var statusCol = getHeaderIndex('Status');
  var priorityCol = getHeaderIndex('Priority Level');
  var deliveryStatusCol = getHeaderIndex('Delivery Status');
  var deliveryDateCol = getHeaderIndex('Customer Requested Delivery Date');
  var dispatchCol = getHeaderIndex('Dispatch Type');

  var numRows = lastRow - 1;
  var idVals = sheet.getRange(2, idCol, numRows, 1).getValues();
  var instVals = sheet.getRange(2, instCol, numRows, 1).getValues();
  var statusVals = sheet.getRange(2, statusCol, numRows, 1).getValues();
  var priorityVals = sheet.getRange(2, priorityCol, numRows, 1).getValues();
  var deliveryStatusVals = sheet.getRange(2, deliveryStatusCol, numRows, 1).getValues();
  var deliveryDateVals = sheet.getRange(2, deliveryDateCol, numRows, 1).getValues();
  var dispatchVals = sheet.getRange(2, dispatchCol, numRows, 1).getValues();
  var owners = readOrderOwners_(sheet, numRows);
  var scope = creScope_();

  var results = [];
  for (var i = numRows - 1; i >= 0; i--) { // most recently dispatched first
    var access = scope ? scope.accessFor(owners[i], idVals[i][0]) : null;
    if (scope && !access) continue; // someone else's order, no cover or grant
    var status = statusVals[i][0];
    var dispatchType = normalizeDispatchType_(dispatchVals[i][0]);
    var ds = deliveryStatusVals[i][0];
    var actionLabel;

    if (status === 'Sent to Ops' && dispatchType === DISPATCH_COURIER) {
      // Courier order with Ops -- the CRE is next in line, as soon as Ops
      // hands over the postal receipt.
      actionLabel = 'Awaiting postal receipt from Ops';
    } else if (isDispatchedStatus_(status)) {
      if (ds === 'Delivered' || ds === 'Returned') continue; // already closed out
      actionLabel = ds || 'Pending';
    } else {
      continue;
    }

    var daysUntil = computeDaysUntilDate(deliveryDateVals[i][0]);
    results.push({
      trackerId: idVals[i][0],
      institution: instVals[i][0],
      priority: priorityVals[i][0] || 'Normal',
      deliveryStatus: actionLabel,
      dispatchType: dispatchType,
      accessNote: access && access !== 'owner' ? access : '',
      daysUntilDelivery: daysUntil,
      isUrgent: (daysUntil !== null && daysUntil <= 3)
    });
    if (results.length >= 50) break;
  }
  return results;
}

// ================================================================
// PENDING PAYMENTS PANEL (shown on both Sales and Accounts pages)
// ================================================================
/**
 * Returns orders with an outstanding balance (Total Order Value minus Advance
 * Received, beyond rounding tolerance), across all statuses -- not tied to a
 * single workflow stage, since a PO-customer order can carry a pending balance
 * even after dispatch, or even after delivery. Read-only for Sales (so CRE can
 * chase the customer); actionable for Accounts (who records the balance
 * payment when it lands).
 *
 * Each item also carries daysUntilDelivery / isUrgent, computed the same way
 * as getCREActionItems: an order whose requested delivery date is 3 days out
 * or has already passed is flagged urgent, so its tile can be highlighted --
 * the balance needs chasing before the delivery date arrives, not after.
 * deliveryStatus rides along specifically so the client can tell "delivery
 * date passed, still in transit" apart from "already Delivered, balance
 * simply hasn't been chased yet" -- Delivery Status and the requested date
 * are independent, and showing "delivery date passed" on an order that has
 * in fact already been delivered reads as a data error when it isn't one.
 *
 * workflowStatus is included so the Accounts UI can grey out the "record a
 * payment" action for any order still at "Logged" -- recordBalancePayment
 * itself also blocks this server-side, but surfacing it here means Accounts
 * sees "verify this first" up front instead of after typing an amount in.
 *
 * Capped at 50 -- both UIs only show the first 5 in the sidebar and put the
 * rest behind a "Show all" popup, so this just bounds payload size.
 */
function getPendingPayments_() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var idCol = getHeaderIndex('Tracker ID');
  var instCol = getHeaderIndex('Institution / Customer');
  var totalCol = getHeaderIndex('Total Order Value');
  var advanceCol = getHeaderIndex('Advance Received');
  var termsCol = getHeaderIndex('Payment Terms Type');
  var deliveryDateCol = getHeaderIndex('Customer Requested Delivery Date');
  var statusCol = getHeaderIndex('Status');
  var deliveryStatusCol = getHeaderIndex('Delivery Status');

  var numRows = lastRow - 1;
  var idVals = sheet.getRange(2, idCol, numRows, 1).getValues();
  var instVals = sheet.getRange(2, instCol, numRows, 1).getValues();
  var totalVals = sheet.getRange(2, totalCol, numRows, 1).getValues();
  var advanceVals = sheet.getRange(2, advanceCol, numRows, 1).getValues();
  var termsVals = sheet.getRange(2, termsCol, numRows, 1).getValues();
  var deliveryDateVals = sheet.getRange(2, deliveryDateCol, numRows, 1).getValues();
  var statusVals = sheet.getRange(2, statusCol, numRows, 1).getValues();
  var deliveryStatusVals = sheet.getRange(2, deliveryStatusCol, numRows, 1).getValues();
  var owners = readOrderOwners_(sheet, numRows);
  var scope = creScope_(); // null for Accounts/Admin -- they see every balance

  var results = [];
  for (var i = numRows - 1; i >= 0; i--) { // most recent first
    if (scope && !scope.ownsOrCovers(owners[i])) continue;
    var total = Number(totalVals[i][0]) || 0;
    var advance = Number(advanceVals[i][0]) || 0;
    var balanceDue = computeBalanceDue(total, advance);
    if (balanceDue <= 0) continue;
    var daysUntil = computeDaysUntilDate(deliveryDateVals[i][0]);
    results.push({
      trackerId: idVals[i][0],
      institution: instVals[i][0],
      totalOrderValue: total,
      advanceReceived: advance,
      balanceDue: balanceDue,
      paymentTermsType: termsVals[i][0] || 'End Customer',
      daysUntilDelivery: daysUntil,
      isUrgent: (daysUntil !== null && daysUntil <= 3),
      workflowStatus: statusVals[i][0] || '',
      deliveryStatus: deliveryStatusVals[i][0] || ''
    });
    if (results.length >= 50) break;
  }
  return results;
}

// ================================================================
// AT-A-GLANCE SUMMARY STRIPS (Accounts and CRE pages)
// ================================================================
/**
 * True totals for the small stat strip at the top of the Accounts page --
 * deliberately NOT derived from getNewEnquiries/getPendingOrders/
 * getPendingPayments, which all cap at 50 rows for payload-size reasons
 * (see their own docs). These numbers need to be exact even past that cap,
 * so this does its own single uncapped pass over the sheet instead.
 *
 * paymentsToday counts ORDERS with a payment event today (Last Payment
 * Timestamp falls on today's date), not the number of payment events --
 * an order topped up twice in one day is still one order, counted once.
 */
function getAccountsSummary_() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { newEnquiries: 0, outstandingTotal: 0, readyToDispatch: 0, paymentsToday: 0 };
  }

  var numRows = lastRow - 1;
  var statusCol = getHeaderIndex('Status');
  var totalCol = getHeaderIndex('Total Order Value');
  var advanceCol = getHeaderIndex('Advance Received');
  var lastPaymentCol = getHeaderIndex('Last Payment Timestamp');

  var statusVals = sheet.getRange(2, statusCol, numRows, 1).getValues();
  var totalVals = sheet.getRange(2, totalCol, numRows, 1).getValues();
  var advanceVals = sheet.getRange(2, advanceCol, numRows, 1).getValues();
  var lastPaymentVals = sheet.getRange(2, lastPaymentCol, numRows, 1).getValues();

  var tz = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  var newEnquiries = 0, outstandingTotal = 0, readyToDispatch = 0, paymentsToday = 0;
  for (var i = 0; i < numRows; i++) {
    var status = statusVals[i][0];
    if (status === 'Logged') newEnquiries++;
    if (status === 'Vehicle Confirmed') readyToDispatch++;

    var balance = computeBalanceDue(Number(totalVals[i][0]) || 0, Number(advanceVals[i][0]) || 0);
    if (balance > 0) outstandingTotal += balance;

    var lp = lastPaymentVals[i][0];
    if (lp) {
      var lpDate = (lp instanceof Date) ? lp : new Date(lp);
      if (!isNaN(lpDate.getTime()) && Utilities.formatDate(lpDate, tz, 'yyyy-MM-dd') === todayStr) {
        paymentsToday++;
      }
    }
  }

  return { newEnquiries: newEnquiries, outstandingTotal: outstandingTotal, readyToDispatch: readyToDispatch, paymentsToday: paymentsToday };
}

/**
 * True totals for the small stat strip at the top of the CRE (Wrapper PO
 * Generator) page. Same "single uncapped pass" approach as
 * getAccountsSummary, for the same reason.
 *
 * "This week" is a rolling 7-day window ending today (today + 6 days back),
 * matching the convention the Owner Dashboard's period tabs already use --
 * kept consistent rather than introducing a second definition of "week"
 * (a calendar Mon-Sun window) elsewhere in the same app.
 *
 * "Still pending" (for highPriorityPending) means not yet fully closed out
 * -- closed = dispatched AND delivered/returned. An order that hasn't even
 * been dispatched yet is obviously still pending under this definition,
 * same as one that's out for delivery.
 *
 * inTransit is narrower than awaitingDeliveryUpdate: awaitingDeliveryUpdate
 * is "needs the CRE to check in" (Pending or In Transit, i.e. anything not
 * yet closed out), while inTransit is specifically Delivery Status = "In
 * Transit" -- already confirmed moving, as opposed to dispatched but not
 * yet confirmed picked up by the courier.
 */
function getCreSummary_() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { highPriorityPending: 0, awaitingDeliveryUpdate: 0, inTransit: 0, loggedToday: 0, loggedThisWeek: 0, valueThisWeek: 0, totalLogged: 0 };
  }

  var numRows = lastRow - 1;
  var dateCol = getHeaderIndex('Date Logged');
  var totalCol = getHeaderIndex('Total Order Value');
  var priorityCol = getHeaderIndex('Priority Level');
  var statusCol = getHeaderIndex('Status');
  var deliveryStatusCol = getHeaderIndex('Delivery Status');

  var dateVals = sheet.getRange(2, dateCol, numRows, 1).getValues();
  var totalVals = sheet.getRange(2, totalCol, numRows, 1).getValues();
  var priorityVals = sheet.getRange(2, priorityCol, numRows, 1).getValues();
  var statusVals = sheet.getRange(2, statusCol, numRows, 1).getValues();
  var deliveryStatusVals = sheet.getRange(2, deliveryStatusCol, numRows, 1).getValues();
  var owners = readOrderOwners_(sheet, numRows);
  var scope = creScope_(); // the tiles are the CRE's OWN numbers -- not covered or granted orders

  var tz = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 6);
  weekAgo.setHours(0, 0, 0, 0);

  var highPriorityPending = 0, awaitingDeliveryUpdate = 0, inTransit = 0, loggedToday = 0, loggedThisWeek = 0, valueThisWeek = 0, totalLogged = 0;
  var idColS = getHeaderIndex('Tracker ID');
  var idValsS = sheet.getRange(2, idColS, numRows, 1).getValues();
  for (var i = 0; i < numRows; i++) {
    if (scope && owners[i] !== scope.me.code) continue;
    if (!String(idValsS[i][0] || '').trim()) continue;
    totalLogged++;
    var status = statusVals[i][0];
    var ds = deliveryStatusVals[i][0];
    var closed = (isDispatchedStatus_(status) && (ds === 'Delivered' || ds === 'Returned'));

    if (priorityVals[i][0] === 'High' && !closed) highPriorityPending++;
    if (isDispatchedStatus_(status) && ds !== 'Delivered' && ds !== 'Returned') awaitingDeliveryUpdate++;
    if (ds === 'In Transit') inTransit++;

    var logged = dateVals[i][0];
    if (logged instanceof Date) {
      if (Utilities.formatDate(logged, tz, 'yyyy-MM-dd') === todayStr) loggedToday++;
      if (logged >= weekAgo) {
        loggedThisWeek++;
        valueThisWeek += Number(totalVals[i][0]) || 0;
      }
    }
  }

  return {
    highPriorityPending: highPriorityPending,
    awaitingDeliveryUpdate: awaitingDeliveryUpdate,
    inTransit: inTransit,
    loggedToday: loggedToday,
    loggedThisWeek: loggedThisWeek,
    valueThisWeek: valueThisWeek,
    totalLogged: totalLogged
  };
}

/**
 * Records a further payment against an order's outstanding balance. Adds to
 * Advance Received (never overwrites it) and recalculates Advance % of Total,
 * so partial top-ups can be logged more than once against the same order.
 * form = { trackerId, amountReceived, bankReference }
 *
 * Bank Reference / UTR is mandatory on every call, not just the first -- every
 * payment recorded here needs its own paper trail, the same as the initial
 * advance does.
 *
 * Blocked until the order's initial advance has been through submitVerification
 * (Status must not still be "Logged"). Without this check, Accounts could add
 * money to Advance Received -- even enough to mark the order fully paid -- on
 * an order whose original advance was never checked against a bank reference.
 * That verification step is the checkpoint that catches a wrong or fabricated
 * advance amount before the order moves forward; topping up the balance can't
 * be allowed to route around it.
 */
function recordBalancePayment_(form) {
  var trackerId = (form.trackerId || '').trim();
  var amountReceived = parseFloat(form.amountReceived) || 0;
  var bankReference = (form.bankReference || '').trim();
  if (!trackerId || amountReceived <= 0) {
    throw new Error('Tracker ID and a positive amount received are required.');
  }
  if (!bankReference) {
    throw new Error('Bank Reference / UTR No. is required for every payment recorded.');
  }
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, trackerId);
  if (row === -1) throw new Error('Tracker ID not found.');

  var data = getRowFields(sheet, row, ['Total Order Value', 'Advance Received', 'Bank Reference / UTR', 'Status']);
  if (typeof assertNoPendingRequest_ === 'function') assertNoPendingRequest_(sheet, row); // locked while a request waits (Oct 2026)
  var releasedToOps = false;
  if (data['Status'] === 'Logged') {
    throw new Error(
      'This order\u2019s initial advance payment has not been verified yet. ' +
      'Verify it first (see the Confirm Payment Verification stage) before recording any further payment.'
    );
  }

  var total = Number(data['Total Order Value']) || 0;
  // Never more than the order still needs (Oct 2026): anything extra is an excess
  // payment, which goes to an admin and is kept off the order (see Excess.gs).
  var balanceBefore = computeBalanceDue(total, data['Advance Received']);
  if (amountReceived > balanceBefore + BALANCE_DUE_TOLERANCE) {
    throw new Error('\u20b9' + formatAmount(amountReceived) + ' is more than the balance due (\u20b9' + formatAmount(balanceBefore) + '). ' +
      'If the customer really paid extra, send it to an admin as a payment with excess \u2013 the extra is kept off the order.');
  }
  var newAdvance = (Number(data['Advance Received']) || 0) + amountReceived;
  var advancePct = total > 0 ? Math.round((newAdvance / total) * 1000) / 10 : 0;
  var newBalance = computeBalanceDue(total, newAdvance);

  var existingRef = data['Bank Reference / UTR'] || '';
  var newRef = existingRef ? existingRef + ' | Balance: ' + bankReference : bankReference;

  var now = new Date();
  setRowFields(sheet, row, { 'Advance Received': newAdvance, 'Bank Reference / UTR': newRef, 'Last Payment Timestamp': now });

  // Same plain-text guard as the intake tool, so this doesn't silently become 0.987.
  var pctRange = sheet.getRange(row, getHeaderIndex('Advance % of Total'));
  pctRange.setNumberFormat('@');
  pctRange.setValue(advancePct + '%');

  // Stamp the moment the order FIRST becomes fully paid. Only set once --
  // if it's already stamped (e.g. from an earlier top-up), leave it alone so
  // the timeline keeps showing the original settlement date.
  if (newBalance <= 0) {
    var alreadyStamped = getRowFields(sheet, row, ['Balance Fully Paid Timestamp'])['Balance Fully Paid Timestamp'];
    if (!alreadyStamped) {
      setRowFields(sheet, row, { 'Balance Fully Paid Timestamp': now });
    }
    // A courier order held at verification for its balance goes to Ops the
    // moment it's cleared -- no separate "release" click for Accounts.
    if (data['Status'] === STATUS_HOLD_BALANCE) {
      setRowFields(sheet, row, { 'Status': 'Sent to Ops', 'Sent to Ops Timestamp': now });
      releasedToOps = true;
    }
  }

  return { trackerId: trackerId, newAdvancePct: advancePct, balanceDue: newBalance, fullyPaid: newBalance <= 0, releasedToOps: releasedToOps };
}

// ================================================================
// TOOL 2: ACCOUNTS VERIFICATION  (Accounts, on receiving the PO)
// ================================================================
/** Returns the order's key details for Accounts/CRE to review before acting. */
function lookupOrder_(trackerId) {
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, trackerId);
  if (row === -1) throw new Error('Tracker ID not found. Check the number and try again.');
  var raw = getRowFields(sheet, row, [
    'Tracker ID', 'Institution / Customer', 'Customer Phone Number', 'CRE Name',
    'Total Order Value', 'Advance Received', 'Advance % of Total', 'Status',
    'Priority Level', 'Customer Requested Delivery Date',
    'Vehicle No.', 'Payment Terms Type', 'Delivery Status',
    'State', 'District', 'Pincode', 'Wrapper PO PDF URL', 'Gate Pass PDF URL', 'Dispatch Type',
    'Courier / Transport Name', 'Tracking / Consignment No.', 'CRE Code'
  ]);
  var ownerCode = resolveOwnerCode_(raw['CRE Code'], raw['CRE Name']);
  var ownerStaff = getStaffMap_(false)[ownerCode];
  // Returned with plain, ASCII-safe keys AND plain strings only -- google.script.run
  // has known issues serializing object keys with spaces/slashes/% signs, and
  // separately can fail to serialize raw Date objects embedded in a returned object
  // (both can cause the whole object to arrive as null on the client, even though
  // the server call itself succeeded). toDisplayString() below guards against the
  // Date case specifically.
  var total = Number(raw['Total Order Value']) || 0;
  var advance = Number(raw['Advance Received']) || 0;
  return {
    trackerId: raw['Tracker ID'] || trackerId,
    institution: raw['Institution / Customer'] || '',
    phoneNumber: raw['Customer Phone Number'] || '',
    creName: raw['CRE Name'] || '',
    totalOrderValue: raw['Total Order Value'] || '',
    advanceReceived: raw['Advance Received'] || '',
    advancePct: toPercentDisplay(raw['Advance % of Total']),
    status: raw['Status'] || '',
    priority: raw['Priority Level'] || 'Normal',
    requestedDeliveryDate: toDisplayString(raw['Customer Requested Delivery Date']),
    vehicleNo: raw['Vehicle No.'] || '',
    paymentTermsType: raw['Payment Terms Type'] || 'End Customer',
    balanceDue: computeBalanceDue(total, advance),
    deliveryStatus: raw['Delivery Status'] || '',
    state: raw['State'] || '',
    district: raw['District'] || '',
    pincode: raw['Pincode'] || '',
    wrapperPdfUrl: raw['Wrapper PO PDF URL'] || '',
    gatePassPdfUrl: raw['Gate Pass PDF URL'] || '',
    dispatchType: normalizeDispatchType_(raw['Dispatch Type']),
    courierName: String(raw['Courier / Transport Name'] || ''),
    trackingNo: String(raw['Tracking / Consignment No.'] || ''),
    ownerCode: ownerCode,
    ownerName: ownerStaff ? ownerStaff.name : String(raw['CRE Name'] || ''),
    access: describeAccess_(ownerCode, raw['Tracker ID'] || trackerId),
    advanceAmount: advance,
    paymentExceptions: {
      verify: summarizePaymentException_(latestPaymentException_(raw['Tracker ID'] || trackerId, PX_VERIFY)),
      dispatch: summarizePaymentException_(latestPaymentException_(raw['Tracker ID'] || trackerId, PX_DISPATCH)),
      correction: summarizePaymentException_(latestPaymentException_(raw['Tracker ID'] || trackerId, PX_CORRECTION)),
      excess: summarizePaymentException_(latestPaymentException_(raw['Tracker ID'] || trackerId, PX_EXCESS))
    },
    // Request waiting for a decision (Oct 2026): the order is locked until it's decided or withdrawn.
    pendingRequest: (typeof pendingRequestFor_ === 'function') ? pendingRequestFor_(raw['Tracker ID'] || trackerId) : null,
    // Standby (Oct 2026): request/approval state for the Accounts page. Never throws.
    standby: (typeof standbyInfoForOrder_ === 'function') ? standbyInfoForOrder_(raw['Tracker ID'] || trackerId, raw['Status'] || '') : null
  };
}

/** Converts a cell value to a plain, safely-serializable string. Guards specifically
 *  against raw Date objects, which google.script.run can fail to pass through intact
 *  when embedded as a property inside a returned object. */
function toDisplayString(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'dd-MMM-yyyy');
  }
  return val || '';
}

/** Handles rows written before the plain-text fix, where Sheets may have auto-converted
 *  "98.7%" into the raw fraction 0.987. Displays either form correctly as "98.7%". */
function toPercentDisplay(val) {
  if (typeof val === 'number') {
    return (Math.round(val * 1000) / 10) + '%';
  }
  return val || '';
}

/**
 * Returns the full lifecycle timeline for one order -- enquiry through
 * delivery -- for the Accounts lookup screen. Every field that is still a
 * blank cell (a stage not yet reached) comes back as an empty string, so the
 * client can simply skip rendering that row instead of showing "undefined"
 * or an invalid date.
 */
function getOrderTimeline_(trackerId) {
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, trackerId);
  if (row === -1) throw new Error('Tracker ID not found.');

  var raw = getRowFields(sheet, row, [
    'Tracker ID', 'Date Logged', 'Verified Date', 'Balance Fully Paid Timestamp',
    'Sent to Ops Timestamp', 'Received by Ops Timestamp', 'Dispatch Timestamp',
    'E-way Bill No.', 'Transport Mode', 'Courier / Transport Name',
    'Total Order Value', 'Advance Received', 'Delivered Timestamp',
    'Delivery Status', 'Status', 'Payment Terms Type', 'Dispatch Type', 'Tracking / Consignment No.'
  ]);

  var total = Number(raw['Total Order Value']) || 0;
  var advance = Number(raw['Advance Received']) || 0;

  return {
    trackerId: raw['Tracker ID'] || trackerId,
    enquiryDate: toTimelineDisplay(raw['Date Logged']),
    advancePaymentVerifiedDate: toTimelineDisplay(raw['Verified Date']),
    fullPaymentDate: toTimelineDisplay(raw['Balance Fully Paid Timestamp']),
    handoverToOpsDate: toTimelineDisplay(raw['Sent to Ops Timestamp']),
    pickupByOpsDate: toTimelineDisplay(raw['Received by Ops Timestamp']),
    dispatchDate: toTimelineDisplay(raw['Dispatch Timestamp']),
    ewayBillNo: raw['E-way Bill No.'] || '',
    transportMode: raw['Transport Mode'] || '',
    courierName: raw['Courier / Transport Name'] || '',
    totalOrderValue: total,
    advanceReceived: advance,
    balanceDue: computeBalanceDue(total, advance),
    deliveryDate: toTimelineDisplay(raw['Delivered Timestamp']),
    deliveryStatus: raw['Delivery Status'] || '',
    workflowStatus: raw['Status'] || '',
    paymentTermsType: raw['Payment Terms Type'] || 'End Customer',
    dispatchType: normalizeDispatchType_(raw['Dispatch Type']),
    trackingNo: String(raw['Tracking / Consignment No.'] || '')
  };
}

/** Formats a cell value that may be a Date or blank, for the timeline
 *  display. Returns '' for blanks so the client can skip that row entirely
 *  rather than rendering "undefined" or "Invalid Date". */
function toTimelineDisplay(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'dd-MMM-yyyy, hh:mm a');
  }
  return String(val);
}

/** form = { trackerId, bankReference }. "Verified By" is the signed-in
 *  staff member -- no longer typed in. */
function submitVerification_(form) {
  var trackerId = (form.trackerId || '').trim();
  // VERIFY_AS_NAME_: set only when an approved excess payment completes the verification (Excess.gs).
  form.accountsName = (typeof VERIFY_AS_NAME_ !== 'undefined' && VERIFY_AS_NAME_) ? VERIFY_AS_NAME_ : currentStaffName_();
  if (!trackerId || !form.accountsName) throw new Error('Tracker ID is required.');
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, trackerId);
  if (row === -1) throw new Error('Tracker ID not found.');
  if (typeof assertNoPendingRequest_ === 'function') assertNoPendingRequest_(sheet, row); // locked while a request waits (Oct 2026)

  var current = getRowFields(sheet, row, ['Status', 'Dispatch Type', 'Payment Terms Type', 'Total Order Value', 'Advance Received']);
  if (current['Status'] !== 'Logged') {
    throw new Error('This order is already at status "' + current['Status'] + '" \u2013 it may already be verified.');
  }

  // AMOUNT RECEIVED (as per the bank) -- Accounts confirms what actually
  // arrived, which may differ from what the CRE logged:
  //   same as logged              -> normal verification.
  //   CRE logged 0, bank shows X  -> the customer paid after logging. Record
  //                                  it as the advance -- no approval needed,
  //                                  it's simply a payment coming in.
  //   CRE logged X, bank shows Y  -> the logged figure is wrong. Changing it
  //                                  needs an Admin-approved "Correct advance"
  //                                  exception, which updates the order when
  //                                  approved -- so after approval the two
  //                                  figures match again and this passes.
  // WHEN IS A UTR NEEDED? Only when money was actually received.
  //   Advance > 0                 -> UTR required, as always.
  //   Advance 0, PO Customer      -> nothing to trace; verify without a UTR.
  //   Advance 0, End Customer     -> only with an Admin-approved payment
  //                                  exception (see PAYMENT EXCEPTIONS).
  var terms = current['Payment Terms Type'] || 'End Customer';
  var loggedAdvance = Number(current['Advance Received']) || 0;
  var totalValue = Number(current['Total Order Value']) || 0;
  var hasAmount = !(form.amountReceived === undefined || form.amountReceived === null || String(form.amountReceived).trim() === '');
  var advanceAmt = hasAmount ? Number(form.amountReceived) : loggedAdvance;
  if (isNaN(advanceAmt) || advanceAmt < 0) throw new Error('Enter the amount received as a number (0 if nothing has come in).');
  advanceAmt = Math.round(advanceAmt * 100) / 100;
  if (totalValue > 0 && advanceAmt > totalValue) throw new Error('The amount received (\u20b9' + formatAmount(advanceAmt) + ') is more than the order value (\u20b9' + formatAmount(totalValue) + '). ' +
    'If the customer really paid extra, send it to an admin as a payment with excess \u2013 the extra is kept off the order.');
  if (loggedAdvance > 0 && advanceAmt !== loggedAdvance) {
    throw new Error('The CRE logged an advance of \u20b9' + formatAmount(loggedAdvance) + '. Changing it to \u20b9' + formatAmount(advanceAmt) +
      ' needs an admin\u2019s approval \u2013 use "Request correction".');
  }
  var newPaymentRecorded = loggedAdvance === 0 && advanceAmt > 0;
  var bankReference = String(form.bankReference || '').trim();
  var verifyException = null;
  if (advanceAmt > 0) {
    if (!bankReference) throw new Error('Enter the Bank Reference / UTR No. for the advance received.');
  } else if (terms === 'PO Customer') {
    bankReference = 'N/A \u2013 PO customer, no advance';
  } else {
    verifyException = latestPaymentException_(trackerId, PX_VERIFY);
    if (!verifyException || verifyException.status !== 'Approved') {
      throw new Error('End customer with no advance received \u2013 this needs an admin\u2019s approval before it can be verified. Use "Request admin approval".');
    }
    bankReference = 'N/A \u2013 no advance, approved by ' + verifyException.decidedBy + ' (' + verifyException.requestId + ')';
  }

  var code = generateVerificationCode();
  var now = new Date();
  var dispatchType = normalizeDispatchType_(current['Dispatch Type']);
  var balanceDue = computeBalanceDue(totalValue, advanceAmt);

  // Courier orders have no gate pass stage to stop an unpaid End Customer
  // order later -- Ops posts the packet straight after this. So the
  // full-payment rule is enforced here instead: hold until the balance is
  // recorded (recordBalancePayment_ releases it automatically).
  // An approved "no advance" exception on a courier order is also approval to
  // send it: for a packet, verification and dispatch are the same moment.
  var holdForBalance = dispatchType === DISPATCH_COURIER && terms === 'End Customer' && balanceDue > 0 && !verifyException;

  var fields = {
    'Payment Verification Status': 'Verified',
    'Verified By': form.accountsName,
    'Verified Date': now,
    'Bank Reference / UTR': bankReference,
    'Verification Code': code,
    'Status': holdForBalance ? STATUS_HOLD_BALANCE : 'Sent to Ops'
  };
  if (advanceAmt > 0) fields['Last Payment Timestamp'] = now; // no payment, no payment timestamp
  if (newPaymentRecorded) {
    fields['Advance Received'] = advanceAmt;
    if (balanceDue <= 0) fields['Balance Fully Paid Timestamp'] = now;
  }
  if (!holdForBalance) fields['Sent to Ops Timestamp'] = now;
  setRowFields(sheet, row, fields);
  if (newPaymentRecorded) writeAdvancePct_(sheet, row, advanceAmt, totalValue);
  // Stored as text so a code like "70141742" isn't turned into a number.
  sheet.getRange(row, getHeaderIndex('Verification Code')).setNumberFormat('@').setValue(code);

  return { trackerId: trackerId, verificationCode: code, dispatchType: dispatchType, heldForBalance: holdForBalance, balanceDue: balanceDue,
           noAdvance: advanceAmt <= 0, approvedBy: verifyException ? verifyException.decidedBy : '',
           newPaymentRecorded: newPaymentRecorded, advanceAmount: advanceAmt };
}

// ================================================================
// TOOL 3: OPS PICKUP & DISPATCH  (Accounts, transcribing ops personnel's paper notes)
// ================================================================
/**
 * Combines what used to be two separate actions (marking pickup, then vehicle
 * details) into one -- because in practice, Accounts only sees the physical PO
 * again once ops personnel return with the vehicle already arranged. Waiting for a
 * separate earlier action left the tracker showing a stale "Sent to Ops" status
 * for however long the PO actually sat with ops personnel, which nobody could update in
 * real time anyway. Both pieces of information (his handwritten pickup time,
 * and the vehicle/site-readiness details) are entered together, in one pass,
 * from the same returned paper.
 *
 * form = { trackerId, receivedTimestamp, vehicleNo, siteReadiness }
 * receivedTimestamp is the time ops personnel wrote by hand -- captured for the
 * verification-to-pickup metric even though it is entered into the system later.
 *
 * If Site Readiness is not "Y", the order is held (status = "On Hold - Site Not
 * Ready") rather than allowed through to the dispatch/gate-pass stage.
 */
function submitPickupAndVehicle_(form) {
  var trackerId = (form.trackerId || '').trim();
  if (!trackerId || !form.receivedTimestamp || !form.vehicleNo) {
    throw new Error('Tracker ID, the pickup time ops personnel noted, and Vehicle No. are all required.');
  }
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, trackerId);
  if (row === -1) throw new Error('Tracker ID not found.');

  if (normalizeDispatchType_(getRowFields(sheet, row, ['Dispatch Type'])['Dispatch Type']) === DISPATCH_COURIER) {
    throw new Error('This is a courier order \u2013 there is no vehicle stage. The CRE records the postal receipt instead.');
  }
  assertNotOnStandby_(getRowFields(sheet, row, ['Status'])['Status']);
  if (typeof assertNoPendingRequest_ === 'function') assertNoPendingRequest_(sheet, row); // locked while a request waits (Oct 2026)

  var siteReady = form.siteReadiness === 'Y';
  var now = new Date();

  setRowFields(sheet, row, {
    'Received by Ops Timestamp': new Date(form.receivedTimestamp),
    'Vehicle No.': form.vehicleNo,
    'Site Readiness Confirmed': form.siteReadiness || '',
    'Vehicle Confirmed Timestamp': now,
    'Status': siteReady ? 'Vehicle Confirmed' : 'On Hold - Site Not Ready'
  });

  return { trackerId: trackerId, siteReady: siteReady };
}

/**
 * Used when an order was held at "On Hold - Site Not Ready" and the customer
 * has since confirmed the site is ready. Moves it forward to the dispatch stage
 * without re-entering vehicle details, which are already on file.
 */
function confirmSiteReady_(trackerId) {
  var id = (trackerId || '').trim();
  if (!id) throw new Error('Tracker ID is required.');
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, id);
  if (row === -1) throw new Error('Tracker ID not found.');
  assertNotOnStandby_(getRowFields(sheet, row, ['Status'])['Status']);
  if (typeof assertNoPendingRequest_ === 'function') assertNoPendingRequest_(sheet, row); // locked while a request waits (Oct 2026)

  setRowFields(sheet, row, {
    'Site Readiness Confirmed': 'Y',
    'Status': 'Vehicle Confirmed'
  });
  return { trackerId: id };
}

/** form = { trackerId, ewayBillNo, transportMode, courierName, trackingNo, itemDescription, itemQty } */
function submitDispatch_(form) {
  var trackerId = (form.trackerId || '').trim();
  if (!trackerId || !form.ewayBillNo || !form.vehicleNoConfirm) {
    // vehicleNoConfirm is just a display re-check on the client; not required server-side
  }
  if (!trackerId || !form.ewayBillNo) {
    throw new Error('Tracker ID and E-way Bill No. are required.');
  }
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, trackerId);
  if (row === -1) throw new Error('Tracker ID not found.');

  var data = getRowFields(sheet, row, [
    'Institution / Customer', 'Vehicle No.', 'Tracker ID', 'Site Readiness Confirmed',
    'Status', 'Payment Terms Type', 'Total Order Value', 'Advance Received'
  ]);
  assertNotOnStandby_(data['Status']);
  if (typeof assertNoPendingRequest_ === 'function') assertNoPendingRequest_(sheet, row); // locked while a request waits (Oct 2026)
  if (data['Site Readiness Confirmed'] !== 'Y') {
    throw new Error('Site readiness is not confirmed for this order -- dispatch is on hold until that is set to Yes.');
  }

  var paymentTermsType = data['Payment Terms Type'] || 'End Customer';
  var balanceDue = computeBalanceDue(data['Total Order Value'], data['Advance Received']);

  // End-customer orders (no separate PO from the buyer) must be fully paid before
  // a gate pass can be issued. PO-customer orders (dealer/institution with their
  // own PO) are allowed through with a balance still outstanding -- that is what
  // the separate PO on file is for -- but the Gate Pass carries a visible note
  // so whoever handles it knows this is an authorized exception, not an oversight.
  var dispatchException = null;
  if (paymentTermsType === 'End Customer' && balanceDue > 0) {
    dispatchException = latestPaymentException_(data['Tracker ID'], PX_DISPATCH);
    if (!dispatchException || dispatchException.status !== 'Approved') {
      throw new Error(
        'This is an end-customer order and the balance is not fully paid (\u20b9' + formatAmount(balanceDue) +
        ' outstanding). Record the payment, or use "Request admin approval" to dispatch with the balance due.'
      );
    }
  }

  var now = new Date();
  var gatePassNo = 'GP-' + sanitizeForFilename(trackerId) + '-' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'HHmmss');

  setRowFields(sheet, row, {
    'E-way Bill No.': form.ewayBillNo,
    'Gate Pass No.': gatePassNo,
    'Transport Mode': form.transportMode || '',
    'Courier / Transport Name': form.courierName || '',
    'Tracking / Consignment No.': form.trackingNo || '',
    'Dispatch Timestamp': now,
    'Status': 'Gate-Verified',
    'Delivery Status': 'Pending',
    'Delivery Status Last Updated': now
  });

  var pdfUrl = generateGatePassPdf(trackerId, gatePassNo, data['Institution / Customer'], form.ewayBillNo, data['Vehicle No.'], form.itemDescription, form.itemQty, now, paymentTermsType, balanceDue, dispatchException);

  // Saved so the PDF can be reprinted later from the Look Up screen without
  // regenerating it -- see the AR/AS note in the column layout comment above.
  setRowFields(sheet, row, { 'Gate Pass PDF URL': pdfUrl });

  return { trackerId: trackerId, gatePassNo: gatePassNo, pdfUrl: pdfUrl };
}

function generateGatePassPdf(trackerId, gatePassNo, institution, ewayBillNo, vehicleNo, itemDescription, itemQty, date, paymentTermsType, balanceDue, dispatchException) {
  var folder = getOrCreateFolder(GATE_PASS_FOLDER_NAME);
  var safeName = sanitizeForFilename(trackerId);
  var doc = DocumentApp.create('Gate Pass - ' + safeName);
  var body = doc.getBody();
  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(50).setMarginRight(50);

  var kicker = body.appendParagraph('ICF GROUP');
  kicker.editAsText().setBold(true).setFontSize(11).setForegroundColor('#1F3864');

  var h = body.appendParagraph('Gate Pass');
  h.editAsText().setBold(true).setFontSize(18).setForegroundColor('#1F3864');
  h.setSpacingAfter(4);

  var sub = body.appendParagraph('Issued by Accounts once the e-way bill is generated. Required for the vehicle to exit the premises.');
  sub.editAsText().setItalic(true).setFontSize(9).setForegroundColor('#595959');
  sub.setSpacingAfter(14);

  if (paymentTermsType === 'PO Customer' && balanceDue > 0) {
    var note = body.appendParagraph(
      'NOTE: Balance payment of \u20b9' + formatAmount(balanceDue) + ' is pending, authorized under this customer\u2019s own PO terms (deferred/partial payment).'
    );
    note.editAsText().setBold(true).setFontSize(10).setForegroundColor('#B06E00');
    note.setSpacingAfter(10);
  }
  if (dispatchException && balanceDue > 0) {
    var exNote = body.appendParagraph(
      'NOTE: Balance payment of \u20b9' + formatAmount(balanceDue) + ' is pending. Dispatch before full payment approved by ' +
      dispatchException.decidedBy + ' (' + dispatchException.requestId + ').'
    );
    exNote.editAsText().setBold(true).setFontSize(10).setForegroundColor('#B00020');
    exNote.setSpacingAfter(10);
  }

  appendSectionTable(body, '1. Reference Details', [
    ['Gate Pass No.', gatePassNo],
    ['Tracker ID', trackerId],
    ['Date', Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd-MMM-yyyy')],
    ['Institution / Customer Name', institution]
  ]);

  appendSectionTable(body, '2. Billing & Vehicle Details', [
    ['E-way Bill No.', ewayBillNo],
    ['Vehicle No.', vehicleNo]
  ]);

  appendSectionTable(body, '3. Item Verification (cross-check against physical load before exit)', [
    ['Item Description', itemDescription || ''],
    ['Quantity (as per E-way Bill)', itemQty || ''],
    ['Quantity Loaded (verified)', '']
  ]);

  appendSectionTable(body, '4. Sign-off', [
    ['Loaded & Released by (Operations) \u2013 Sign & Time', ''],
    ['Gate Verification \u2013 Quantity Matches (Y/N)', ''],
    ['Verified by (Gatekeeper) \u2013 Sign & Time Out', '']
  ]);

  doc.saveAndClose();
  var pdfBlob = DriveApp.getFileById(doc.getId()).getAs('application/pdf');
  var pdfFile = folder.createFile(pdfBlob).setName('Gate Pass - ' + safeName + '.pdf');
  DriveApp.getFileById(doc.getId()).setTrashed(true);

  // Same reasoning as the Wrapper PO: without this, the Gate Pass file
  // defaults to private to the deploying account and triggers an access
  // request the moment Accounts or the CRE opens the link.
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return pdfFile.getUrl();
}

// ================================================================
// TOOL 4: DELIVERY STATUS UPDATE
// ================================================================
/** form = { trackerId, deliveryStatus, transportMode, courierName, trackingNo, deliveredAt }
 *  deliveredAt is required when deliveryStatus is "Delivered" -- it's the
 *  actual date/time the customer confirmed delivery on the CRE's follow-up
 *  call, entered by hand from that conversation. This deliberately does NOT
 *  default to "now": the CRE typically only gets through to the customer the
 *  day after dispatch, so stamping "now" here silently inflated Total Cycle
 *  Time and made On-time Delivery Rate read ~0% almost regardless of actual
 *  performance. */
function submitDeliveryUpdate_(form) {
  var trackerId = (form.trackerId || '').trim();
  if (!trackerId || !form.deliveryStatus) {
    throw new Error('Tracker ID and Delivery Status are required.');
  }
  if (form.deliveryStatus === 'Delivered' && !form.deliveredAt) {
    throw new Error('Enter the date and time the customer confirmed delivery.');
  }
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, trackerId);
  if (row === -1) throw new Error('Tracker ID not found.');
  requireCanAct_(sheet, row);
  var currentStatus = getRowFields(sheet, row, ['Status'])['Status'];
  if (!isDispatchedStatus_(currentStatus)) {
    throw new Error('This order has not been dispatched yet (stage: "' + currentStatus + '") \u2013 delivery status can only be updated after dispatch.');
  }

  var now = new Date();
  var fields = {
    'Delivery Status': form.deliveryStatus,
    'Delivery Status Last Updated': now
  };
  if (form.transportMode) fields['Transport Mode'] = form.transportMode;
  if (form.courierName) fields['Courier / Transport Name'] = form.courierName;
  if (form.trackingNo) fields['Tracking / Consignment No.'] = form.trackingNo;
  if (form.deliveryStatus === 'Delivered') fields['Delivered Timestamp'] = new Date(form.deliveredAt);

  setRowFields(sheet, row, fields);
  return { trackerId: trackerId, deliveryStatus: form.deliveryStatus };
}

// ================================================================
// TOOL 4b: POSTAL DISPATCH  (CRE, courier orders only)
// ================================================================
/**
 * The courier pipeline's equivalent of the gate pass step. Ops posts the
 * packet and hands the postal receipt to the CRE; the CRE records it here.
 * Moves the order to "Posted" with Delivery Status "In Transit" (the courier
 * already has it) -- from there it's the same delivery follow-up as any
 * dispatched order, via submitDeliveryUpdate_.
 *
 * form = { trackerId, courierName, trackingNo, postedAt, pickedUpAt }
 *   postedAt   -- date/time on the postal receipt (required); stored as the
 *                 Dispatch Timestamp so dispatch reporting treats courier
 *                 and vehicle orders alike.
 *   pickedUpAt -- optional: the time Ops wrote down for collecting the
 *                 packet. Feeds Received by Ops Timestamp, and through it
 *                 the verification-to-pickup metric.
 */
function submitPostalDispatch_(form) {
  var trackerId = (form.trackerId || '').trim();
  var courierName = (form.courierName || '').trim();
  var trackingNo = (form.trackingNo || '').trim();
  if (!trackerId || !courierName || !trackingNo || !form.postedAt) {
    throw new Error('Courier / post office, tracking number and the date & time posted are all required.');
  }
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, trackerId);
  if (row === -1) throw new Error('Tracker ID not found.');

  requireCanAct_(sheet, row);
  if (typeof assertNoPendingRequest_ === 'function') assertNoPendingRequest_(sheet, row); // locked while a request waits (Oct 2026)
  var data = getRowFields(sheet, row, ['Status', 'Dispatch Type', 'Payment Terms Type', 'Total Order Value', 'Advance Received']);
  if (normalizeDispatchType_(data['Dispatch Type']) !== DISPATCH_COURIER) {
    throw new Error('This is a vehicle order \u2013 it is dispatched through Accounts with a gate pass, not recorded here.');
  }
  if (data['Status'] !== 'Sent to Ops') {
    throw new Error('This order is at stage "' + data['Status'] + '". A postal receipt can only be recorded once Accounts has sent it to Ops.');
  }
  var balanceDue = computeBalanceDue(data['Total Order Value'], data['Advance Received']);
  if ((data['Payment Terms Type'] || 'End Customer') === 'End Customer' && balanceDue > 0 &&
      !isPaymentExceptionApproved_(trackerId, PX_DISPATCH) && !isPaymentExceptionApproved_(trackerId, PX_VERIFY)) {
    throw new Error('End-customer order with \u20b9' + formatAmount(balanceDue) + ' still outstanding \u2013 Accounts needs to record the balance first.');
  }

  var postedAt = new Date(form.postedAt);
  if (isNaN(postedAt.getTime())) throw new Error('Enter a valid date and time posted.');
  var now = new Date();
  var fields = {
    'Transport Mode': 'Post / Courier',
    'Courier / Transport Name': courierName,
    'Tracking / Consignment No.': trackingNo,
    'Dispatch Timestamp': postedAt,
    'Status': STATUS_POSTED,
    'Delivery Status': 'In Transit',
    'Delivery Status Last Updated': now
  };
  if (form.pickedUpAt) {
    var pickedUp = new Date(form.pickedUpAt);
    if (!isNaN(pickedUp.getTime())) fields['Received by Ops Timestamp'] = pickedUp;
  }
  setRowFields(sheet, row, fields);
  // Tracking numbers are often long digit strings -- keep them as text so
  // Sheets doesn't turn them into 5.72E+11.
  sheet.getRange(row, getHeaderIndex('Tracking / Consignment No.')).setNumberFormat('@').setValue(trackingNo);
  return { trackerId: trackerId, status: STATUS_POSTED };
}

// ================================================================
// TOOL 5: OWNER / DIRECTOR DASHBOARD  (new page -- ?page=dashboard)
// ================================================================
/**
 * Returns one row per order, trimmed to the fields the dashboard needs, as a
 * flat array -- all aggregation (KPIs, funnel, trends, tables) happens
 * client-side in dashboard.html rather than here. That keeps this function
 * to a single read of the sheet (one getRange call for every column at
 * once, not one call per metric) and lets the dashboard re-slice the same
 * data by date range or filter without another round trip to the server.
 *
 * Dates are returned as epoch milliseconds (or null), not formatted
 * strings or raw Date objects -- the same google.script.run serialization
 * problem noted elsewhere in this file (see toDisplayString) applies here
 * too, and a number is the one format that always survives the trip intact
 * and is trivial to turn into a JS Date or compare on the client.
 *
 * Capped at 2000 rows, which is far beyond what this business will produce
 * for a long while -- just a guard against an unbounded payload if the
 * tracker ever grows very large.
 *
 * NOTE: there is deliberately no Product field in this per-order payload --
 * that's a one-to-many relationship (one row per product per order), which
 * doesn't fit this flat one-row-per-order shape. Product data reaches the
 * dashboard through the separate getAllLineItems_() below instead; the
 * client joins the two by Tracker ID (see renderProductTable in
 * dashboard.html) rather than this function trying to flatten them together.
 */
function getDashboardData_() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var numRows = Math.min(lastRow - 1, 2000);
  var data = sheet.getRange(2, 1, numRows, HEADERS.length).getValues();

  function col(name) { return HEADERS.indexOf(name); }
  var C = {
    id: col('Tracker ID'), date: col('Date Logged'), inst: col('Institution / Customer'),
    cre: col('CRE Name'), total: col('Total Order Value'), advance: col('Advance Received'),
    status: col('Status'), priority: col('Priority Level'), deliveryStatus: col('Delivery Status'),
    reqDate: col('Customer Requested Delivery Date'), verifiedDate: col('Verified Date'),
    sentOps: col('Sent to Ops Timestamp'), recvOps: col('Received by Ops Timestamp'),
    vehConf: col('Vehicle Confirmed Timestamp'), dispatch: col('Dispatch Timestamp'),
    delivered: col('Delivered Timestamp'), vToP: col('Verification-to-Pickup Time (Hrs)'),
    cycle: col('Total Cycle Time (Hrs)'), terms: col('Payment Terms Type'),
    amend: col('Amendment Flag'), state: col('State'), district: col('District'),
    pincode: col('Pincode'), fullPaid: col('Balance Fully Paid Timestamp'),
    dispatchType: col('Dispatch Type')
  };

  var out = [];
  for (var i = 0; i < numRows; i++) {
    var r = data[i];
    if (!r[C.id]) continue; // skip any blank trailing row
    var total = Number(r[C.total]) || 0;
    var advance = Number(r[C.advance]) || 0;
    out.push({
      id: r[C.id],
      dateLogged: dashDate_(r[C.date]),
      institution: r[C.inst] || '',
      cre: r[C.cre] || '',
      total: total,
      advance: advance,
      balanceDue: computeBalanceDue(total, advance),
      status: r[C.status] || '',
      priority: r[C.priority] || 'Normal',
      deliveryStatus: r[C.deliveryStatus] || '',
      reqDeliveryDate: dashDate_(r[C.reqDate]),
      verifiedDate: dashDate_(r[C.verifiedDate]),
      sentOpsDate: dashDate_(r[C.sentOps]),
      recvOpsDate: dashDate_(r[C.recvOps]),
      vehConfDate: dashDate_(r[C.vehConf]),
      dispatchDate: dashDate_(r[C.dispatch]),
      deliveredDate: dashDate_(r[C.delivered]),
      fullyPaidDate: dashDate_(r[C.fullPaid]),
      // Falls back to computing from the timestamps when the AJ/AK formula
      // cell is blank -- those formulas were never dragged down on older
      // rows, which left every cycle-time figure on the dashboard empty.
      vToPHrs: toFiniteNumberOrNull_(r[C.vToP]) !== null ? toFiniteNumberOrNull_(r[C.vToP]) : hoursBetween_(r[C.verifiedDate], r[C.recvOps]),
      cycleHrs: toFiniteNumberOrNull_(r[C.cycle]) !== null ? toFiniteNumberOrNull_(r[C.cycle]) : hoursBetween_(r[C.verifiedDate], r[C.delivered]),
      dispatchType: normalizeDispatchType_(r[C.dispatchType]),
      paymentTerms: r[C.terms] || 'End Customer',
      amended: !!r[C.amend],
      state: (r[C.state] || '').toString().trim(),
      district: (r[C.district] || '').toString().trim(),
      pincode: (r[C.pincode] || '').toString().trim()
    });
    if (out.length >= 2000) break;
  }
  return out;
}

/**
 * Returns every row in the "Order Line Items" tab as a flat array --
 * { trackerId, product, quantity } per row -- for the Owner Dashboard's
 * product breakdown (renderProductTable in dashboard.html). Same approach
 * as getDashboardData: one full read, all aggregation (by period, by
 * product) happens client-side, joined to the order data there by Tracker
 * ID. Capped at 5000 rows -- line items run several-to-one against orders,
 * so this is a higher ceiling than getDashboardData's, same "guard against
 * an unbounded payload" reasoning.
 */
function getAllLineItems_() {
  var sheet = getOrCreateLineItemsSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var numRows = Math.min(lastRow - 1, 5000);
  var data = sheet.getRange(2, 1, numRows, 3).getValues();
  var out = [];
  for (var i = 0; i < numRows; i++) {
    var r = data[i];
    if (!r[0]) continue; // skip any blank trailing row
    out.push({ trackerId: r[0], product: r[1] || '', quantity: Number(r[2]) || 0 });
  }
  return out;
}

/**
 * Converts a tracker cell that is SUPPOSED to be one of the AJ/AK formula
 * numbers into a real number, or null if it isn't one -- covers a blank
 * cell, the formula's own "" result (order hasn't reached that stage yet),
 * and anything else that doesn't parse cleanly (a formula error, or a row
 * where the AJ/AK formula was never dragged down to, per the manual step
 * noted at the top of this file). Without this guard a single bad cell
 * turns Number() into NaN, which then poisons every average built from it
 * on the client -- every card shows "NaN hrs" instead of just skipping
 * that one row, which is what actually happened here.
 */
function toFiniteNumberOrNull_(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  var n = Number(raw);
  return isFinite(n) ? n : null;
}

/** Makes sure a tab is at least n columns wide (reading past the edge throws). Returns true. */
function ensureColumns_(sheet, n) {
  var max = sheet.getMaxColumns();
  if (max < n) sheet.insertColumnsAfter(max, n - max);
  return true;
}

/** Hours from a to b, 2 dp, or null if either is missing/invalid. */
function hoursBetween_(a, b) {
  var ma = dashDate_(a), mb = dashDate_(b);
  if (ma === null || mb === null) return null;
  return Math.round(((mb - ma) / 3600000) * 100) / 100;
}

/** Same epoch-ms-or-null conversion used across getDashboardData -- a plain
 *  number is what survives google.script.run intact; blank cells become null
 *  so the client can skip them instead of building an "Invalid Date". */
function dashDate_(v) {
  if (!v) return null;
  var d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.getTime();
}

// ================================================================
// ONE-TIME CLEANUP -- run manually once, not part of normal usage
// ================================================================
/**
 * Updates sharing on every PDF already sitting in the two output folders
 * (Wrapper POs and Gate Passes generated before link-sharing was added
 * above) so they stop triggering Drive "request access" emails too -- the
 * code fix above only covers PDFs generated from now on.
 *
 * To run: open this project in the Apps Script editor, pick
 * "shareExistingPdfsWithLink" from the function dropdown at the top, and
 * click Run. Check View > Logs afterward to see how many files were updated.
 * Safe to run more than once.
 */
function shareExistingPdfsWithLink() {
  [PDF_FOLDER_NAME, GATE_PASS_FOLDER_NAME].forEach(function (folderName) {
    var folder = getOrCreateFolder(folderName);
    var files = folder.getFiles();
    var count = 0;
    while (files.hasNext()) {
      files.next().setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      count++;
    }
    Logger.log(folderName + ': updated sharing on ' + count + ' file(s).');
  });
}
// ================================================================
// STAFF & SIGN-IN
// ================================================================
/**
 * WHY: more staff are joining (a second CRE now, more later), and the tool
 * used to trust whatever name was typed into a box. This gives every person
 * a Staff Code + PIN, ties every action to the person who did it, and lets
 * the owner switch someone off in one cell.
 *
 * WHERE THINGS LIVE
 *   "Staff" tab (created by setupStaffAndDispatch):
 *     A Staff Code   -- what they type to sign in, e.g. CRE002. Unique.
 *     B Staff Name   -- written into the tracker as CRE Name / Verified By.
 *                       Spell it the way it should appear in reports.
 *     C Role         -- CRE | Accounts | Director | Admin
 *     D Active       -- Y / N. N blocks sign-in within about a minute,
 *                       even for someone already signed in.
 *     E Set PIN      -- type a 4-6 digit PIN here to set or reset it. It is
 *                       scrambled and the cell cleared the instant you press
 *                       Enter (onEdit below), so PINs never sit in the sheet.
 *     F PIN Status   -- written by the script ("Set on 25-Sep-2026").
 *     G Last Sign-in -- written by the script.
 *   The scrambled PINs (salted SHA-256) are kept in Script Properties, not
 *   in the sheet. Staff can change their own PIN from the page ("Change
 *   PIN"), so after the first handover even the admin doesn't know it.
 *
 *   "Activity Log" tab: one row per sign-in, failed sign-in and change made
 *   through the tool -- Timestamp | Staff Code | Staff Name | Role | Action |
 *   Tracker ID | Detail.
 *
 * WHO SEES WHAT
 *   CRE      -> the PO Generator page (base URL)
 *   Accounts -> ?page=accounts
 *   Director -> ?page=dashboard
 *   Admin    -> all three (for the owner / consultant)
 *
 * HOW IT'S ENFORCED
 *   The pages never call the real functions. Every call goes through
 *   callApi(token, name, args), which (1) checks the session token,
 *   (2) re-checks the person is still Active and what their role is now,
 *   (3) checks that role may run that function, then runs it. The real
 *   functions all end in "_", which Apps Script will not run from a
 *   browser -- so there's no way around this from the browser console.
 *
 *   Sessions last 6 hours from the LAST action (CacheService's maximum),
 *   so a working day with a lunch break won't need a re-sign-in, but a
 *   machine left overnight will. 5 wrong PINs locks that staff code for
 *   15 minutes.
 */
var STAFF_SHEET_NAME = 'Staff';
var ACTIVITY_LOG_SHEET_NAME = 'Activity Log';
var STAFF_HEADERS = ['Staff Code', 'Staff Name', 'Role', 'Active', 'Set PIN', 'PIN Status', 'Last Sign-in',
                     'Email', 'Away From', 'Away To', 'Covered By'];
var ROLES = ['CRE', 'Accounts', 'Director', 'Admin'];
var SESSION_SECONDS = 21600;   // 6 h -- CacheService maximum
var LOCKOUT_ATTEMPTS = 5;
var LOCKOUT_SECONDS = 900;     // 15 min
var PAGE_ROLES = { cre: ['CRE'], accounts: ['Accounts'], dashboard: ['Director'], admin: [], settings: ['Director'] }; // Admin is always allowed...
var PAGE_LABELS = { cre: 'the CRE page', accounts: 'the Accounts page', dashboard: 'the Owner Dashboard', admin: 'the Admin page', settings: 'the Settings page' };
var DIRECTOR_ONLY_PAGES = { settings: true }; // ...except on these: Directors only, Admins too are refused (Oct 2026)

/** May this role open this page? Admin may open everything except DIRECTOR_ONLY_PAGES. */
function canOpenPage_(role, page) {
  if (role === 'Admin' && !DIRECTOR_ONLY_PAGES[page]) return true;
  return (PAGE_ROLES[page] || []).indexOf(role) !== -1;
}

var CURRENT_STAFF_ = null; // set by callApi for the duration of one call
var CURRENT_ON_BEHALF_ = ''; // set by requireCanAct_ when someone acts on another CRE's order

/** Which roles may call which function, and whether the call is logged. Admin may call anything. */
function apiMap_() {
  var CRE = ['CRE'], ACC = ['Accounts'], DIR = ['Director'];
  var ANY = ['CRE', 'Accounts', 'Director'];
  var map = {
    getProductList:         { fn: getProductList_,         roles: CRE },
    getProductCatalog:      { fn: getProductCatalog_,      roles: CRE },
    lookupPincode:          { fn: lookupPincode_,          roles: CRE },
    submitOrder:            { fn: submitOrder_,            roles: CRE, log: 'Logged order' },
    getCREActionItems:      { fn: getCREActionItems_,      roles: CRE },
    getCreSummary:          { fn: getCreSummary_,          roles: CRE },
    submitPostalDispatch:   { fn: submitPostalDispatch_,   roles: CRE, log: 'Recorded postal dispatch' },
    submitDeliveryUpdate:   { fn: submitDeliveryUpdate_,   roles: CRE, log: 'Updated delivery status' },
    lookupOrder:            { fn: lookupOrder_,            roles: ANY },
    findOrders:             { fn: findOrders_,             roles: ANY },
    getMyOrders:            { fn: getMyOrders_,            roles: CRE },
    getOrderTimeline:       { fn: getOrderTimeline_,       roles: ANY },
    getOrderLineItems:      { fn: getOrderLineItems_,      roles: ANY },
    getPendingPayments:     { fn: getPendingPayments_,     roles: ['CRE', 'Accounts'] },
    getNewEnquiries:        { fn: getNewEnquiries_,        roles: ACC },
    getPendingOrders:       { fn: getPendingOrders_,       roles: ACC },
    getAccountsSummary:     { fn: getAccountsSummary_,     roles: ACC },
    submitVerification:     { fn: submitVerification_,     roles: ACC, log: 'Verified payment' },
    recordBalancePayment:   { fn: recordBalancePayment_,   roles: ACC, log: 'Recorded balance payment' },
    submitPickupAndVehicle: { fn: submitPickupAndVehicle_, roles: ACC, log: 'Saved pickup & vehicle' },
    confirmSiteReady:       { fn: confirmSiteReady_,       roles: ACC, log: 'Confirmed site ready' },
    submitDispatch:         { fn: submitDispatch_,         roles: ACC, log: 'Generated gate pass' },
    requestOrderAccess:     { fn: requestOrderAccess_,     roles: CRE, log: 'Requested order access' },
    requestPaymentException:{ fn: requestPaymentException_, roles: ACC, log: 'Requested payment exception' },
    getPaymentApprovalsPanel:{ fn: getPaymentApprovalsPanel_, roles: ACC },
    getAccessApprovalsPanel:{ fn: getAccessApprovalsPanel_, roles: CRE },
    decidePaymentException: { fn: decidePaymentException_, roles: [], log: 'Decided payment exception' },
    getAdminData:           { fn: getAdminData_,           roles: [] },
    getApprovalSummary:     { fn: getApprovalSummary_,     roles: [] },
    decideAccessRequest:    { fn: decideAccessRequest_,    roles: [], log: 'Decided access request' },
    setStaffCover:          { fn: setStaffCover_,          roles: [], log: 'Set leave cover' },
    reassignOrders:         { fn: reassignOrders_,         roles: [], log: 'Reassigned orders' },
    getDashboardData:       { fn: getDashboardData_,       roles: DIR },
    getAllLineItems:        { fn: getAllLineItems_,        roles: DIR }
  };
  // Standby + Settings page (Oct 2026) -- defined in Standby.gs.
  if (typeof standbyApiMap_ === 'function') {
    var extra = standbyApiMap_();
    for (var k in extra) map[k] = extra[k];
  }
  // Excess payments (Oct 2026) -- defined in Excess.gs.
  if (typeof excessApiMap_ === 'function') {
    var extra2 = excessApiMap_();
    for (var k2 in extra2) map[k2] = extra2[k2];
  }
  // Order lock / withdraw (Oct 2026) -- defined in Locks.gs.
  if (typeof lockApiMap_ === 'function') {
    var extra3 = lockApiMap_();
    for (var k3 in extra3) map[k3] = extra3[k3];
  }
  return map;
}

/** The one entry point the pages call. See HOW IT'S ENFORCED above. */
function callApi(token, fnName, args) {
  var staff = requireSession_(token);
  var entry = apiMap_()[fnName];
  if (!entry) throw new Error('Unknown action: ' + fnName);
  if (staff.role !== 'Admin' && entry.roles.indexOf(staff.role) === -1) {
    throw new Error('Your role (' + staff.role + ') cannot do this. Ask the admin if you need access.');
  }
  if (entry.directorOnly && staff.role !== 'Director') {
    throw new Error('Only a Director can do this.');
  }
  CURRENT_STAFF_ = staff;
  CURRENT_ON_BEHALF_ = '';
  try {
    var result = entry.fn.apply(null, args || []);
    if (entry.log) {
      var a0 = (args && args[0]) || {};
      var trackerId = (result && result.trackerId) || (typeof a0 === 'string' ? a0 : a0.trackerId) || '';
      var detail = activityDetail_(fnName, a0, result);
      if (CURRENT_ON_BEHALF_) detail = (detail ? detail + ' ' : '') + '(on behalf of ' + CURRENT_ON_BEHALF_ + ')';
      logActivity_(staff, entry.log, trackerId, detail);
    }
    // Round-trip through JSON before handing back to the browser. The
    // browser bridge (google.script.run) silently delivers null for any
    // reply it can't package -- e.g. one containing a Date object -- and
    // the page then shows empty lists with no error. JSON turns Dates into
    // plain text and guarantees the reply always arrives intact.
    return result === undefined ? null : JSON.parse(JSON.stringify(result));
  } finally {
    CURRENT_STAFF_ = null;
    CURRENT_ON_BEHALF_ = '';
  }
}

function currentStaffName_() {
  if (!CURRENT_STAFF_ || !CURRENT_STAFF_.name) throw new Error('Not signed in.');
  return CURRENT_STAFF_.name;
}

/** A short, human-readable note for the Activity Log's Detail column. */
function activityDetail_(fnName, a, result) {
  a = a || {}; result = result || {};
  switch (fnName) {
    case 'submitOrder': return (a.institution || '') + ' \u2013 ' + (result.dispatchType || '');
    case 'recordBalancePayment': return 'Rs. ' + (a.amountReceived || '') + ', UTR ' + (a.bankReference || '') + (result.releasedToOps ? ' \u2013 released to Ops' : '');
    case 'submitPickupAndVehicle': return 'Vehicle ' + (a.vehicleNo || '') + ', site ready ' + (a.siteReadiness || '');
    case 'submitDispatch': return (result.gatePassNo || '') + ', e-way ' + (a.ewayBillNo || '');
    case 'submitPostalDispatch': return (a.courierName || '') + ' ' + (a.trackingNo || '');
    case 'submitDeliveryUpdate': return a.deliveryStatus || '';
    case 'requestPaymentException': return (result.requestId || '') + ' \u2013 ' + (PX_LABELS[a.type] || a.type) + ': ' + (a.reason || '');
    case 'decidePaymentException': return (a.requestId || '') + ' \u2013 ' + (a.approve ? 'approved' : 'declined') + (result.releasedToOps ? ', released to Ops' : '');
    case 'submitVerification': return (result.newPaymentRecorded ? 'Advance recorded at verification: Rs. ' + result.advanceAmount + ', ' : '') + (result.noAdvance ? 'No advance' + (result.approvedBy ? ' \u2013 approved by ' + result.approvedBy : ' \u2013 PO customer') : 'UTR ' + (a.bankReference || '')) + (result.heldForBalance ? ' \u2013 held: balance due' : '');
    case 'requestOrderAccess': return (result.requestId || '') + ' \u2013 ' + (a.reason || '');
    case 'decideAccessRequest': return (a.requestId || '') + ' \u2013 ' + (a.approve ? 'approved' : 'declined');
    case 'setStaffCover': return (a.staffCode || '') + (a.coveredBy ? ' away ' + (a.awayFrom || '') + ' to ' + (a.awayTo || '') + ', covered by ' + a.coveredBy : ' \u2013 cover cleared');
    case 'reassignOrders': return (a.fromCode || '') + ' \u2192 ' + (a.toCode || '') + ': ' + (result.moved || 0) + ' order(s)' + (a.trackerId ? ' (' + a.trackerId + ')' : '');
    default: return (typeof standbyActivityDetail_ === 'function') ? standbyActivityDetail_(fnName, a, result) : '';
  }
}

// ---------------- Sign-in, sign-out, PIN change (called directly from auth.html) ----------------

/** Returns { token, code, name, role } or throws a message fit to show the user. */
function staffLogin(staffCode, pin, page) {
  var code = String(staffCode || '').trim().toUpperCase();
  pin = String(pin || '').trim();
  if (!code || !pin) throw new Error('Enter your staff code and PIN.');

  var cache = CacheService.getScriptCache();
  var failKey = 'fail_' + code;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= LOCKOUT_ATTEMPTS) {
    throw new Error('Too many wrong attempts for ' + code + '. Try again in 15 minutes, or ask the admin to reset your PIN.');
  }

  var staff = getStaffMap_(true)[code];
  var storedHash = PropertiesService.getScriptProperties().getProperty('pin_' + code);
  if (staff && staff.active && !storedHash) {
    throw new Error('No PIN has been set for ' + code + ' yet. Ask the admin to set one in the Staff tab.');
  }
  if (!staff || !staff.active || !storedHash || storedHash !== hashPin_(code, pin)) {
    cache.put(failKey, String(fails + 1), LOCKOUT_SECONDS);
    logActivity_({ code: code, name: staff ? staff.name : '', role: staff ? staff.role : '' }, 'Failed sign-in', '', page || '');
    var left = LOCKOUT_ATTEMPTS - fails - 1;
    throw new Error('Staff code or PIN is incorrect.' + (left > 0 && left <= 2 ? ' ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left before a 15-minute lock.' : ''));
  }
  cache.remove(failKey);

  if (!canOpenPage_(staff.role, page)) {
    throw new Error(staff.name + ', your role (' + staff.role + ') doesn\u2019t use ' + (PAGE_LABELS[page] || 'this page') + '. Open the link for your role instead.');
  }

  var token = Utilities.getUuid();
  cache.put('sess_' + token, JSON.stringify({ code: code, epoch: sessionEpoch_() }), SESSION_SECONDS);
  stampLastSignIn_(staff.row);
  logActivity_(staff, 'Signed in', '', page || '');
  return { token: token, code: code, name: staff.name, role: staff.role, appUrl: staff.role === 'Admin' ? appUrl_() : '' };
}

/** For a page reload: returns the staff info if the token is still good for this page, else null. Never throws. */
function checkSession(token, page) {
  try {
    var staff = requireSession_(token);
    if (!canOpenPage_(staff.role, page)) return null;
    return { code: staff.code, name: staff.name, role: staff.role, appUrl: staff.role === 'Admin' ? appUrl_() : '' };
  } catch (e) {
    return null;
  }
}

function staffLogout(token) {
  try {
    var staff = requireSession_(token);
    logActivity_(staff, 'Signed out', '', '');
  } catch (e) { /* already expired -- nothing to log */ }
  if (token) CacheService.getScriptCache().remove('sess_' + token);
  return true;
}

function changeMyPin(token, currentPin, newPin) {
  var staff = requireSession_(token);
  currentPin = String(currentPin || '').trim();
  newPin = String(newPin || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('pin_' + staff.code) !== hashPin_(staff.code, currentPin)) {
    throw new Error('Your current PIN is incorrect.');
  }
  if (!/^\d{4,6}$/.test(newPin)) throw new Error('New PIN must be 4 to 6 digits.');
  if (newPin === currentPin) throw new Error('New PIN is the same as the current one.');
  props.setProperty('pin_' + staff.code, hashPin_(staff.code, newPin));
  markPinStatus_(staff.row, 'Changed by staff on ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy'));
  logActivity_(staff, 'Changed own PIN', '', '');
  return true;
}

// ---------------- Session + staff helpers ----------------

/** Returns { code, name, role, row } for a live session, or throws SESSION_EXPIRED. Slides the 6-hour window. */
function requireSession_(token) {
  if (!token) throw new Error('SESSION_EXPIRED: Please sign in.');
  var cache = CacheService.getScriptCache();
  var raw = cache.get('sess_' + token);
  if (!raw) throw new Error('SESSION_EXPIRED: Your session has ended. Please sign in again.');
  var sess = JSON.parse(raw);
  if (sess.epoch !== sessionEpoch_()) {
    cache.remove('sess_' + token);
    throw new Error('SESSION_EXPIRED: You were signed out by the admin. Please sign in again.');
  }
  var staff = getStaffMap_(false)[sess.code];
  if (!staff || !staff.active) {
    cache.remove('sess_' + token);
    throw new Error('SESSION_EXPIRED: This staff code is no longer active. Contact the admin.');
  }
  cache.put('sess_' + token, raw, SESSION_SECONDS); // sliding expiry
  return staff;
}

/**
 * { CODE: { code, name, role, active, row } } from the Staff tab. Cached for
 * 60 s so a busy page isn't re-reading the tab on every click -- which is
 * also why switching someone to Active = N takes up to a minute to bite.
 */
function getStaffMap_(fresh) {
  var cache = CacheService.getScriptCache();
  if (!fresh) {
    var hit = cache.get('staff_map');
    if (hit) return JSON.parse(hit);
  }
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(STAFF_SHEET_NAME);
  var map = {};
  if (sheet && sheet.getLastRow() >= 2) {
    var width = Math.min(Math.max(sheet.getLastColumn(), 4), STAFF_HEADERS.length);
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
    var tz = Session.getScriptTimeZone();
    function ymd(v) { return (v instanceof Date && !isNaN(v.getTime())) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : ''; }
    for (var i = 0; i < data.length; i++) {
      var code = String(data[i][0] || '').trim().toUpperCase();
      if (!code || map[code]) continue; // first row wins on a duplicate code
      map[code] = {
        code: code,
        name: String(data[i][1] || '').trim(),
        role: normalizeRole_(data[i][2]),
        active: String(data[i][3] || '').trim().toUpperCase() === 'Y',
        row: i + 2,
        email: String(data[i][7] || '').trim(),
        awayFrom: ymd(data[i][8]),   // yyyy-MM-dd strings so the cached map stays JSON-safe
        awayTo: ymd(data[i][9]),
        coveredBy: String(data[i][10] || '').trim().toUpperCase()
      };
    }
  }
  cache.put('staff_map', JSON.stringify(map), 60);
  return map;
}

function normalizeRole_(val) {
  var v = String(val || '').trim().toLowerCase();
  for (var i = 0; i < ROLES.length; i++) if (ROLES[i].toLowerCase() === v) return ROLES[i];
  return '';
}

function hashPin_(code, pin) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pinSalt_() + '|' + code + '|' + pin, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function pinSalt_() {
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty('pin_salt');
  if (!salt) { salt = Utilities.getUuid(); props.setProperty('pin_salt', salt); }
  return salt;
}

function sessionEpoch_() {
  return PropertiesService.getScriptProperties().getProperty('session_epoch') || '1';
}

function stampLastSignIn_(row) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(STAFF_SHEET_NAME);
  if (sheet && row) sheet.getRange(row, 7).setValue(new Date());
}

function markPinStatus_(row, text) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(STAFF_SHEET_NAME);
  if (sheet && row) sheet.getRange(row, 6).setValue(text);
}

function logActivity_(staff, action, trackerId, detail) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(ACTIVITY_LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(ACTIVITY_LOG_SHEET_NAME);
      sheet.getRange(1, 1, 1, 7).setValues([['Timestamp', 'Staff Code', 'Staff Name', 'Role', 'Action', 'Tracker ID', 'Detail']]);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date(), staff.code || '', staff.name || '', staff.role || '', action, trackerId || '', detail || '']);
  } catch (e) {
    Logger.log('logActivity_ failed: ' + e); // never let logging break the real action
  }
}

// ---------------- Admin: PINs typed into the Staff tab ----------------

/**
 * Simple trigger -- runs by itself whenever anyone edits the spreadsheet.
 * The moment a PIN is typed into Staff!E (Set PIN), it's scrambled into
 * Script Properties and the cell is cleared, so it's never left readable.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== STAFF_SHEET_NAME || e.range.getColumn() > 5 || e.range.getLastColumn() < 5 || e.range.getRow() < 2) return;
    securePinsInRange_(sheet, e.range.getRow(), e.range.getNumRows());
  } catch (err) {
    Logger.log('onEdit PIN handling failed: ' + err);
  }
}

/** Menu fallback: secures every PIN still sitting in the Set PIN column. */
function secureTypedPins() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(STAFF_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return;
  securePinsInRange_(sheet, 2, sheet.getLastRow() - 1);
}

function securePinsInRange_(sheet, startRow, numRows) {
  var vals = sheet.getRange(startRow, 1, numRows, 5).getDisplayValues();
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy');
  for (var i = 0; i < vals.length; i++) {
    var pin = String(vals[i][4] || '').trim();
    if (!pin) continue;
    var row = startRow + i;
    var code = String(vals[i][0] || '').trim().toUpperCase();
    sheet.getRange(row, 5).clearContent();
    if (!code) { sheet.getRange(row, 6).setValue('Enter a Staff Code first, then the PIN'); continue; }
    if (!/^\d{4,6}$/.test(pin)) { sheet.getRange(row, 6).setValue('Not saved \u2013 PIN must be 4 to 6 digits'); continue; }
    props.setProperty('pin_' + code, hashPin_(code, pin));
    sheet.getRange(row, 6).setValue('Set by admin on ' + today);
  }
  CacheService.getScriptCache().remove('staff_map');
}

/** Menu: signs every device out (e.g. after a phone is lost, or someone leaves). */
function signEveryoneOut() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('session_epoch', String(Number(sessionEpoch_()) + 1));
  SpreadsheetApp.getActive() && SpreadsheetApp.getActive().toast('Everyone has been signed out.', 'ICF Admin', 5);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ICF Admin')
    .addItem('Run setup (staff, dispatch type)', 'setupStaffAndDispatch')
    .addItem('Secure PINs typed in the Staff tab', 'secureTypedPins')
    .addItem('Remove empty rows between orders', 'compactTrackerRows')
    .addItem('Turn on approval alerts (every 10 min)', 'installAlertTrigger')
    .addItem('Run approval alert check now', 'checkApprovalAlerts')
    .addItem('Set up standby (tab + settings rows)', 'setupStandby')
    .addSeparator()
    .addItem('Sign everyone out', 'signEveryoneOut')
    .addToUi();
}

// ================================================================
// ONE-TIME SETUP (Sep 2026) -- run from the editor or the ICF Admin menu
// ================================================================
/**
 * Safe to run more than once -- every step checks before it changes anything.
 *   1. Creates the Staff tab (with dropdowns for Role/Active, and Set PIN as
 *      a text column so a PIN like 0427 keeps its leading zero), seeded with
 *      the current team. PINs are NOT set -- type them in column E after.
 *   2. Creates the Activity Log tab.
 *   3. Adds the Dispatch Type column to Product Catalog, with
 *      Bio Bacteria - 1Kg as Courier.
 *   4. Writes the "Dispatch Type" header in AU1 of the tracker.
 *   5. Removes the empty formula-only rows between orders (compactTrackerRows).
 *   6. Back-fills the AJ/AK cycle-time formulas on every existing order --
 *      and ONLY on real orders, so they never again sit on empty rows.
 *   8. Approval alerts: creates the Settings tab (office hours, approvers,
 *      time limits), adds a Phone column to the Staff tab, and turns on the
 *      10-minute alert check (see APPROVAL ALERTS).
 *   7. Ownership: adds AV "CRE Code" and fills it on existing orders by
 *      matching CRE Name to the Staff tab; adds Staff columns H:K (Email,
 *      Away From, Away To, Covered By); creates the Access Requests tab.
 */
function setupStaffAndDispatch() {
  var ss = SpreadsheetApp.openById(SHEET_ID);

  var staff = ss.getSheetByName(STAFF_SHEET_NAME);
  if (!staff) {
    staff = ss.insertSheet(STAFF_SHEET_NAME);
    staff.getRange(1, 1, 1, STAFF_HEADERS.length).setValues([STAFF_HEADERS]).setFontWeight('bold');
    staff.setFrozenRows(1);
    staff.getRange(2, 1, 4, 4).setValues([
      ['CRE001', 'Greeshma', 'CRE', 'Y'],
      ['CRE002', 'New CRE \u2013 enter name', 'CRE', 'N'],
      ['ACC001', 'Sonu', 'Accounts', 'Y'],
      ['ADM001', 'Sambhu', 'Admin', 'Y']
    ]);
    staff.getRange('E2:E').setNumberFormat('@');
    staff.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ROLES, true).build());
    staff.getRange('D2:D').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Y', 'N'], true).build());
    staff.getRange('F2:G').setFontColor('#888888');
    staff.setColumnWidth(2, 180);
    staff.setColumnWidth(6, 220);
  }

  if (!ss.getSheetByName(ACTIVITY_LOG_SHEET_NAME)) {
    var log = ss.insertSheet(ACTIVITY_LOG_SHEET_NAME);
    log.getRange(1, 1, 1, 7).setValues([['Timestamp', 'Staff Code', 'Staff Name', 'Role', 'Action', 'Tracker ID', 'Detail']]).setFontWeight('bold');
    log.setFrozenRows(1);
  }

  getOrCreateProductCatalogSheet(); // adds Dispatch Type + Bio Bacteria row if missing

  var tracker = getSheet();
  var auCol = getHeaderIndex('Dispatch Type');
  if (!String(tracker.getRange(1, auCol).getValue() || '').trim()) tracker.getRange(1, auCol).setValue('Dispatch Type');

  compactTrackerRows(); // close the row-11-to-1000 gap before anything else touches row numbers

  var lastRow = getLastOrderRow_(tracker);
  if (lastRow >= 2) {
    var ids = tracker.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0] || '').trim()) writeCycleFormulas_(tracker, i + 2);
    }
  }

  setupOwnership_();
  setupAlerts_();

  pinSalt_();
  CacheService.getScriptCache().remove('staff_map');
  Logger.log('Setup complete. Next: type a PIN for each person in Staff!E.');
}

// ================================================================
// ORDER OWNERSHIP, COVER & ACCESS REQUESTS
// ================================================================
/**
 * RULES (agreed Sep 2026)
 *   - Every order is OWNED by one CRE (tracker column AV "CRE Code"): the one
 *     who logged it, unless an Admin reassigns it.
 *   - Any CRE can LOOK UP any order (a customer may call whoever picks up),
 *     but a CRE's Needs Action list, Pending Payments list and stat tiles
 *     show only their own orders. Tiles are always own-only -- they're the
 *     CRE's performance numbers.
 *   - Only the owner can ACT on an order (record postal receipt, update
 *     delivery), with three exceptions, all granted by an Admin:
 *       1. LEAVE COVER (planned): Admin sets "away from / to / covered by"
 *          on the absent CRE (Admin page, or Staff tab I:K). For those
 *          dates the covering CRE sees and can act on all the absent CRE's
 *          orders -- no per-order requests. Ends by itself after "Away To".
 *       2. ACCESS REQUEST (unplanned, one order): the CRE clicks "Request
 *          access" on the order with a reason. Every active Admin with an
 *          Email in the Staff tab is emailed a link to the Admin page; the
 *          Admin signs in with their own PIN and approves or declines.
 *          Approval gives that CRE that one order for 24 hours.
 *       3. REASSIGNMENT (permanent): Admin moves one order, or all of a
 *          CRE's open orders, to another CRE. Ownership changes for good.
 *   - During cover or a grant, OWNERSHIP DOES NOT CHANGE -- the order stays
 *     in the owner's numbers -- but the Activity Log records the action
 *     against the person who did it, "on behalf of" the owner.
 *   - Admins can act on everything; Accounts/Director aren't affected.
 *
 * "Access Requests" tab: Request ID | Requested At | Tracker ID | Requested By |
 *   Requested By Name | Owner Code | Reason | Status | Decided By | Decided At |
 *   Access Until.  Status: Pending / Approved / Declined. An Approved grant
 *   past its Access Until is simply treated as expired -- nothing rewrites it.
 */
var ACCESS_REQUESTS_SHEET_NAME = 'Access Requests';
var ACCESS_REQUEST_HEADERS = ['Request ID', 'Requested At', 'Tracker ID', 'Requested By', 'Requested By Name',
  'Owner Code', 'Reason', 'Status', 'Decided By', 'Decided At', 'Access Until', 'Alerts Sent'];
var ACCESS_GRANT_HOURS = 24;

/** Owner code for an order row: the CRE Code column, or (for rows logged
 *  before that column existed) the staff code whose name matches CRE Name. */
function resolveOwnerCode_(codeVal, nameVal, staffMap) {
  var code = String(codeVal || '').trim().toUpperCase();
  if (code) return code;
  var name = String(nameVal || '').trim().toLowerCase();
  if (!name) return '';
  staffMap = staffMap || getStaffMap_(false);
  for (var k in staffMap) if (staffMap[k].name.toLowerCase() === name) return k;
  return '';
}

/** Owner code per tracker row (index 0 = sheet row 2), in one read of each column. */
function readOrderOwners_(sheet, numRows) {
  var codes = sheet.getRange(2, getHeaderIndex('CRE Code'), numRows, 1).getValues();
  var names = sheet.getRange(2, getHeaderIndex('CRE Name'), numRows, 1).getValues();
  var staffMap = getStaffMap_(false);
  var out = [];
  for (var i = 0; i < numRows; i++) out.push(resolveOwnerCode_(codes[i][0], names[i][0], staffMap));
  return out;
}

/** yyyy-MM-dd for today in the script's timezone (IST). */
function todayYmd_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Staff codes this person is covering for TODAY: { code: name }. */
function coveredCodesFor_(myCode, staffMap) {
  var today = todayYmd_(), out = {};
  for (var k in staffMap) {
    var s = staffMap[k];
    if (s.coveredBy === myCode && s.awayFrom && s.awayTo && s.awayFrom <= today && today <= s.awayTo) out[k] = s.name;
  }
  return out;
}

/** Live (approved, unexpired) single-order grants for this person: { trackerIdLower: untilMs }. */
function activeGrantsFor_(myCode) {
  var out = {};
  readAccessRequests_().forEach(function (r) {
    if (r.requestedBy === myCode && r.status === 'Approved' && r.untilMs && r.untilMs > Date.now()) {
      out[String(r.trackerId).toLowerCase()] = r.untilMs;
    }
  });
  return out;
}

/**
 * For list functions: null when the caller is not a CRE (no filtering),
 * otherwise an object that says whether/why the CRE can see an order in
 * their lists. accessFor() returns 'owner', 'Covering for <name>',
 * 'Access granted', or null.
 */
function creScope_() {
  var me = CURRENT_STAFF_;
  if (!me || me.role !== 'CRE') return null;
  var staffMap = getStaffMap_(false);
  var covered = coveredCodesFor_(me.code, staffMap);
  var grants = activeGrantsFor_(me.code);
  return {
    me: me,
    ownsOrCovers: function (ownerCode) { return ownerCode === me.code || covered.hasOwnProperty(ownerCode); },
    accessFor: function (ownerCode, trackerId) {
      if (ownerCode === me.code) return 'owner';
      if (covered.hasOwnProperty(ownerCode)) return 'Covering for ' + covered[ownerCode];
      if (grants.hasOwnProperty(String(trackerId).toLowerCase())) return 'Access granted';
      return null;
    }
  };
}

/**
 * What the signed-in person may do on one order, for the Look Up screen:
 * { canAct, reason: 'owner'|'admin'|'cover'|'grant'|'none', note, pendingRequest, lastDecision }
 */
function describeAccess_(ownerCode, trackerId) {
  var me = CURRENT_STAFF_;
  if (!me) return { canAct: false, reason: 'none' };
  if (me.role === 'Admin') return { canAct: true, reason: 'admin' };
  if (me.role !== 'CRE') return { canAct: false, reason: 'none' };
  if (ownerCode && ownerCode === me.code) return { canAct: true, reason: 'owner' };

  var staffMap = getStaffMap_(false);
  var covered = coveredCodesFor_(me.code, staffMap);
  if (ownerCode && covered.hasOwnProperty(ownerCode)) {
    return { canAct: true, reason: 'cover', note: 'You\u2019re covering for ' + covered[ownerCode] + ' until ' + fmtYmd_(staffMap[ownerCode].awayTo) + '.' };
  }
  if (!ownerCode) {
    // An old row whose CRE Name doesn't match anyone in the Staff tab -- no
    // owner to protect, so any CRE may act (and an Admin can assign it).
    return { canAct: true, reason: 'unowned', note: 'This order has no owner on record \u2013 ask the admin to assign it.' };
  }

  var tidLower = String(trackerId).toLowerCase();
  var mine = readAccessRequests_().filter(function (r) {
    return r.requestedBy === me.code && String(r.trackerId).toLowerCase() === tidLower;
  });
  var tz = Session.getScriptTimeZone();
  for (var i = mine.length - 1; i >= 0; i--) {
    var r = mine[i];
    if (r.status === 'Approved' && r.untilMs > Date.now()) {
      return { canAct: true, reason: 'grant', note: 'Access granted by ' + r.decidedBy + ' until ' + Utilities.formatDate(new Date(r.untilMs), tz, 'dd-MMM, hh:mm a') + '.' };
    }
  }
  var last = mine.length ? mine[mine.length - 1] : null;
  return {
    canAct: false,
    reason: 'none',
    pendingRequest: !!(last && last.status === 'Pending'),
    lastDecision: last && last.status !== 'Pending'
      ? (last.status === 'Approved' ? 'Your earlier access expired.' : 'Your last request was declined by ' + last.decidedBy + '.')
      : ''
  };
}

/** Server-side gate for CRE actions on an order. Throws if not allowed. */
function requireCanAct_(sheet, row) {
  var f = getRowFields(sheet, row, ['Tracker ID', 'CRE Code', 'CRE Name']);
  var ownerCode = resolveOwnerCode_(f['CRE Code'], f['CRE Name']);
  var access = describeAccess_(ownerCode, f['Tracker ID']);
  if (!access.canAct) {
    throw new Error('This is ' + (f['CRE Name'] || 'another CRE') + '\u2019s order. Request access from the admin to update it.');
  }
  if (access.reason === 'cover' || access.reason === 'grant' || (access.reason === 'admin' && ownerCode && ownerCode !== CURRENT_STAFF_.code)) {
    CURRENT_ON_BEHALF_ = String(f['CRE Name'] || ownerCode);
  }
}

function fmtYmd_(ymd) {
  if (!ymd) return '';
  var p = ymd.split('-');
  return Utilities.formatDate(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])), Session.getScriptTimeZone(), 'dd-MMM-yyyy');
}

function appUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

// ---------------- Access Requests tab ----------------

function getOrCreateAccessRequestsSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(ACCESS_REQUESTS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ACCESS_REQUESTS_SHEET_NAME);
    sheet.getRange(1, 1, 1, ACCESS_REQUEST_HEADERS.length).setValues([ACCESS_REQUEST_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else if (ensureColumns_(sheet, ACCESS_REQUEST_HEADERS.length) && !String(sheet.getRange(1, ACCESS_REQUEST_HEADERS.length).getValue() || '').trim()) {
    sheet.getRange(1, ACCESS_REQUEST_HEADERS.length).setValue('Alerts Sent').setFontWeight('bold'); // added Sep 2026
  }
  return sheet;
}

function readAccessRequests_() {
  var sheet = getOrCreateAccessRequestsSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, ACCESS_REQUEST_HEADERS.length).getValues().map(function (r, i) {
    var until = r[10] instanceof Date ? r[10].getTime() : (r[10] ? new Date(r[10]).getTime() : 0);
    return {
      row: i + 2, requestId: String(r[0] || ''), requestedAtMs: r[1] instanceof Date ? r[1].getTime() : null,
      trackerId: String(r[2] || ''), requestedBy: String(r[3] || '').toUpperCase(), requestedByName: String(r[4] || ''),
      ownerCode: String(r[5] || '').toUpperCase(), reason: String(r[6] || ''), status: String(r[7] || ''),
      decidedBy: String(r[8] || ''), decidedAtMs: r[9] instanceof Date ? r[9].getTime() : null, untilMs: isNaN(until) ? 0 : until,
      alertsSent: String(r[11] || '')
    };
  }).filter(function (r) { return r.requestId; });
}

/** CRE: ask an Admin for 24-hour access to one order. form = { trackerId, reason } */
function requestOrderAccess_(form) {
  var me = CURRENT_STAFF_;
  var reason = String(form.reason || '').trim();
  if (!reason) throw new Error('Add a short reason, e.g. "Customer called, Greeshma on leave".');
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String(form.trackerId || ''));
  if (row === -1) throw new Error('Tracker ID not found.');
  var f = getRowFields(sheet, row, ['Tracker ID', 'Institution / Customer', 'CRE Code', 'CRE Name']);
  var trackerId = String(f['Tracker ID']);
  var ownerCode = resolveOwnerCode_(f['CRE Code'], f['CRE Name']);

  var access = describeAccess_(ownerCode, trackerId);
  if (access.canAct) throw new Error('You can already update this order.');
  if (access.pendingRequest) throw new Error('You already have a request waiting for this order.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var requestId;
  try {
    var reqSheet = getOrCreateAccessRequestsSheet_();
    requestId = 'AR-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd') + '-' + Utilities.getUuid().split('-')[0].slice(0, 4).toUpperCase();
    reqSheet.appendRow([requestId, new Date(), trackerId, me.code, me.name, ownerCode, reason, 'Pending', '', '', '']);
  } finally {
    lock.releaseLock();
  }

  var ownerName = (getStaffMap_(false)[ownerCode] || {}).name || f['CRE Name'] || ownerCode;
  var emailed = notifyAdmins_(requestId, trackerId, f['Institution / Customer'], me.name + ' (' + me.code + ')', ownerName, reason);
  return { trackerId: trackerId, requestId: requestId, emailed: emailed };
}

/** Emails every active Admin who has an Email in the Staff tab. Returns how many were emailed. */
function notifyAdmins_(requestId, trackerId, institution, requester, ownerName, reason) {
  var staffMap = getStaffMap_(true);
  var to = [];
  for (var k in staffMap) {
    var s = staffMap[k];
    if (s.active && s.role === 'Admin' && /@/.test(s.email)) to.push(s.email);
  }
  if (!to.length) return 0;
  var url = appUrl_();
  var link = url ? url + '?page=admin&req=' + encodeURIComponent(requestId) : '';
  var esc = function (t) { return String(t || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  try {
    MailApp.sendEmail({
      to: to.join(','),
      subject: 'Access request: ' + requester + ' \u2013 ' + trackerId,
      htmlBody:
        '<p><b>' + esc(requester) + '</b> is asking to update an order owned by <b>' + esc(ownerName) + '</b>.</p>' +
        '<p>Order: <b>' + esc(trackerId) + '</b> \u2013 ' + esc(institution) + '<br>Reason: ' + esc(reason) + '</p>' +
        (link ? '<p><a href="' + link + '" style="background:#1F3864;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:600;">Review request</a></p>' +
                '<p style="color:#666;font-size:12px;">You\u2019ll sign in with your staff code and PIN to approve or decline. Approval gives access to this one order for ' + ACCESS_GRANT_HOURS + ' hours.</p>' : '') +
        '<p style="color:#666;font-size:12px;">Request ' + esc(requestId) + '</p>'
    });
    return to.length;
  } catch (e) {
    Logger.log('notifyAdmins_ failed: ' + e);
    return 0;
  }
}

// ---------------- Admin page ----------------

/** Everything the Admin page shows: requests, CREs (with cover), and open-order counts per owner. */
function getAdminData_() {
  var staffMap = getStaffMap_(true);
  var tz = Session.getScriptTimeZone();
  var fmt = function (ms) { return ms ? Utilities.formatDate(new Date(ms), tz, 'dd-MMM, hh:mm a') : ''; };

  // institution lookup for the requests list
  var sheet = getSheet();
  var lastRow = getLastOrderRow_(sheet);
  var inst = {}, openCount = {};
  if (lastRow >= 2) {
    var n = lastRow - 1;
    var ids = sheet.getRange(2, 1, n, 1).getValues();
    var insts = sheet.getRange(2, getHeaderIndex('Institution / Customer'), n, 1).getValues();
    var ds = sheet.getRange(2, getHeaderIndex('Delivery Status'), n, 1).getValues();
    var owners = readOrderOwners_(sheet, n);
    for (var i = 0; i < n; i++) {
      inst[String(ids[i][0]).toLowerCase()] = insts[i][0];
      var closed = ds[i][0] === 'Delivered' || ds[i][0] === 'Returned';
      if (!closed && ids[i][0]) openCount[owners[i] || '(none)'] = (openCount[owners[i] || '(none)'] || 0) + 1;
    }
  }

  var requests = readAccessRequests_().reverse().slice(0, 40).map(function (r) {
    var expired = r.status === 'Approved' && r.untilMs && r.untilMs <= Date.now();
    return {
      requestId: r.requestId, trackerId: r.trackerId, institution: inst[r.trackerId.toLowerCase()] || '',
      requestedBy: r.requestedBy, requestedByName: r.requestedByName,
      ownerCode: r.ownerCode, ownerName: (staffMap[r.ownerCode] || {}).name || r.ownerCode,
      reason: r.reason, status: expired ? 'Expired' : r.status, requestedAt: fmt(r.requestedAtMs),
      decidedBy: r.decidedBy, decidedAt: fmt(r.decidedAtMs), accessUntil: r.status === 'Approved' ? fmt(r.untilMs) : ''
    };
  });

  var staff = [];
  for (var k in staffMap) {
    var s = staffMap[k];
    staff.push({ code: s.code, name: s.name, role: s.role, active: s.active, hasEmail: /@/.test(s.email),
      awayFrom: s.awayFrom, awayTo: s.awayTo, coveredBy: s.coveredBy, openOrders: openCount[s.code] || 0 });
  }
  var paymentExceptions = readPaymentExceptions_().reverse().slice(0, 40).map(function (r) {
    return {
      requestId: r.requestId, trackerId: r.trackerId, institution: inst[r.trackerId.toLowerCase()] || '',
      type: r.type, typeLabel: PX_LABELS[r.type] || r.type, requestedBy: r.requestedBy, requestedByName: r.requestedByName,
      reason: r.reason, amountNote: r.amountNote, status: r.status, requestedAt: fmt(r.requestedAtMs),
      decidedBy: r.decidedBy, decidedAt: fmt(r.decidedAtMs)
    };
  });
  return { requests: requests, paymentExceptions: paymentExceptions, staff: staff, unownedOpen: openCount['(none)'] || 0, today: todayYmd_() };
}

/** Admin: form = { requestId, approve } */
function decideAccessRequest_(form) {
  var me = CURRENT_STAFF_;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var r = readAccessRequests_().filter(function (x) { return x.requestId === form.requestId; })[0];
    if (!r) throw new Error('Request not found.');
    if (r.status !== 'Pending') throw new Error('This request was already ' + r.status.toLowerCase() + ' by ' + (r.decidedBy || 'someone') + '.');
    var now = new Date();
    var until = form.approve ? new Date(now.getTime() + ACCESS_GRANT_HOURS * 3600000) : '';
    getOrCreateAccessRequestsSheet_().getRange(r.row, 8, 1, 4)
      .setValues([[form.approve ? 'Approved' : 'Declined', me.name + ' (' + me.code + ')', now, until]]);
  } finally {
    lock.releaseLock();
  }
  var requester = getStaffMap_(false)[r.requestedBy];
  if (requester && /@/.test(requester.email)) {
    try {
      MailApp.sendEmail(requester.email, 'Access ' + (form.approve ? 'approved' : 'declined') + ': ' + r.trackerId,
        (form.approve ? 'You can update ' + r.trackerId + ' for the next ' + ACCESS_GRANT_HOURS + ' hours. It is in your Needs Action list.'
                      : 'Your request to update ' + r.trackerId + ' was declined by ' + me.name + '.'));
    } catch (e) { Logger.log('requester notify failed: ' + e); }
  }
  return { trackerId: r.trackerId, requestId: r.requestId, approved: !!form.approve };
}

/** Admin: form = { staffCode, awayFrom, awayTo, coveredBy } -- blank coveredBy clears the cover. */
function setStaffCover_(form) {
  var code = String(form.staffCode || '').trim().toUpperCase();
  var staffMap = getStaffMap_(true);
  var s = staffMap[code];
  if (!s) throw new Error('Unknown staff code.');
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(STAFF_SHEET_NAME);
  ensureStaffColumns_(sheet);
  var cover = String(form.coveredBy || '').trim().toUpperCase();
  if (!cover) {
    sheet.getRange(s.row, 9, 1, 3).setValues([['', '', '']]);
  } else {
    var c = staffMap[cover];
    if (!c || !c.active) throw new Error('The covering person must be an active staff member.');
    if (cover === code) throw new Error('Someone can\u2019t cover for themselves.');
    if (!form.awayFrom || !form.awayTo || form.awayTo < form.awayFrom) throw new Error('Enter valid Away From and Away To dates.');
    var d = function (ymd) { var p = ymd.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); };
    sheet.getRange(s.row, 9, 1, 3).setValues([[d(form.awayFrom), d(form.awayTo), cover]]);
  }
  CacheService.getScriptCache().remove('staff_map');
  return { staffCode: code };
}

/**
 * Admin: permanent reassignment. form = { fromCode, toCode, trackerId }
 *   trackerId given -> just that order (any stage).
 *   trackerId blank -> every OPEN order owned by fromCode (not yet
 *                      Delivered/Returned). Closed orders stay with the
 *                      person who handled them, so history is untouched.
 */
function reassignOrders_(form) {
  var staffMap = getStaffMap_(true);
  var toCode = String(form.toCode || '').trim().toUpperCase();
  var to = staffMap[toCode];
  if (!to || !to.active) throw new Error('Choose an active CRE to move the orders to.');
  var sheet = getSheet();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var codeCol = getHeaderIndex('CRE Code'), nameCol = getHeaderIndex('CRE Name');
    if (form.trackerId) {
      var row = resolveTrackerId(sheet, String(form.trackerId));
      if (row === -1) throw new Error('Tracker ID not found.');
      sheet.getRange(row, codeCol).setValue(toCode);
      sheet.getRange(row, nameCol).setValue(to.name);
      return { moved: 1, trackerId: sheet.getRange(row, 1).getValue() };
    }
    var fromCode = String(form.fromCode || '').trim().toUpperCase();
    if (!fromCode || fromCode === toCode) throw new Error('Choose two different CREs.');
    var lastRow = getLastOrderRow_(sheet);
    if (lastRow < 2) return { moved: 0 };
    var n = lastRow - 1;
    var owners = readOrderOwners_(sheet, n);
    var ds = sheet.getRange(2, getHeaderIndex('Delivery Status'), n, 1).getValues();
    var moved = 0;
    for (var i = 0; i < n; i++) {
      if (owners[i] !== fromCode) continue;
      if (ds[i][0] === 'Delivered' || ds[i][0] === 'Returned') continue;
      sheet.getRange(i + 2, codeCol).setValue(toCode);
      sheet.getRange(i + 2, nameCol).setValue(to.name);
      moved++;
    }
    return { moved: moved };
  } finally {
    lock.releaseLock();
  }
}

/** Adds the Email / Away From / Away To / Covered By headers (H:K) to an existing Staff tab. */
function ensureStaffColumns_(sheet) {
  if (!sheet) return;
  if (sheet.getMaxColumns() < STAFF_HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), STAFF_HEADERS.length - sheet.getMaxColumns());
  var hdr = sheet.getRange(1, 1, 1, STAFF_HEADERS.length).getValues()[0];
  for (var i = 7; i < STAFF_HEADERS.length; i++) {
    if (!String(hdr[i] || '').trim()) sheet.getRange(1, i + 1).setValue(STAFF_HEADERS[i]).setFontWeight('bold');
  }
  sheet.getRange('I2:J').setNumberFormat('dd-mmm-yyyy');
}

/**
 * Setup step for ownership: header AV, Staff columns H:K, Access Requests tab,
 * and fills CRE Code on existing orders by matching CRE Name to the Staff tab.
 * Names that match nobody are left blank (and logged) -- assign those from the
 * Admin page with a single-order reassignment.
 */
function setupOwnership_() {
  var tracker = getSheet();
  var avCol = getHeaderIndex('CRE Code');
  if (!String(tracker.getRange(1, avCol).getValue() || '').trim()) tracker.getRange(1, avCol).setValue('CRE Code');
  ensureStaffColumns_(SpreadsheetApp.openById(SHEET_ID).getSheetByName(STAFF_SHEET_NAME));
  getOrCreateAccessRequestsSheet_();
  CacheService.getScriptCache().remove('staff_map');

  var lastRow = getLastOrderRow_(tracker);
  if (lastRow < 2) return;
  var n = lastRow - 1;
  var codes = tracker.getRange(2, avCol, n, 1).getValues();
  var names = tracker.getRange(2, getHeaderIndex('CRE Name'), n, 1).getValues();
  var staffMap = getStaffMap_(true);
  var unmatched = {};
  for (var i = 0; i < n; i++) {
    if (String(codes[i][0] || '').trim()) continue;
    var code = resolveOwnerCode_('', names[i][0], staffMap);
    if (code) codes[i][0] = code; else if (names[i][0]) unmatched[names[i][0]] = true;
  }
  tracker.getRange(2, avCol, n, 1).setValues(codes);
  var un = Object.keys(unmatched);
  if (un.length) Logger.log('CRE names with no matching Staff row (left unassigned): ' + un.join(', '));
}

// ================================================================
// PAYMENT EXCEPTIONS  (Accounts asks, an Admin approves)
// ================================================================
/**
 * Two places where the normal payment rule would stop an End Customer
 * order, and where the business sometimes decides to go ahead anyway:
 *
 *   PX_VERIFY    "Verify without advance" -- End Customer, advance = 0.
 *                Normally verification needs a UTR for the advance. With
 *                approval, Accounts verifies without one and the order goes
 *                to Ops. (A PO Customer with no advance needs NO approval --
 *                their own PO covers it -- see submitVerification_.)
 *
 *   PX_DISPATCH  "Dispatch with balance due" -- End Customer, balance > 0.
 *                Normally no gate pass until fully paid. With approval, the
 *                gate pass is issued and carries a red note naming the
 *                approver. For a courier order held at "On Hold - Balance
 *                Due", approval releases it to Ops straight away.
 *
 * Flow: Accounts clicks "Request admin approval" on the order with a reason
 * -> every active Admin with an Email is sent a link to the Admin page ->
 * the Admin signs in with their PIN and approves or declines -> Accounts
 * looks the order up again and carries on. Approvals don't expire (unlike
 * CRE access grants) -- they're a decision about the order, not about a
 * person's access. Everything is in the Activity Log and the
 * "Payment Exceptions" tab (created automatically on first use):
 *   Request ID | Requested At | Tracker ID | Type | Requested By |
 *   Requested By Name | Reason | Amount At Request | Status | Decided By | Decided At
 */
var PAYMENT_EXCEPTIONS_SHEET_NAME = 'Payment Exceptions';
var PX_HEADERS = ['Request ID', 'Requested At', 'Tracker ID', 'Type', 'Requested By', 'Requested By Name',
  'Reason', 'Amount At Request', 'Status', 'Decided By', 'Decided At', 'Corrected Advance', 'Alerts Sent',
  'Amount Received', 'Bank Reference / UTR']; // last two: excess payments only (Oct 2026)
var PX_VERIFY = 'VERIFY_NO_ADVANCE';
var PX_DISPATCH = 'DISPATCH_WITH_BALANCE';
// PX_CORRECTION "Correct advance amount" -- the CRE logged an advance (say
// Rs. 50,000) but the bank shows a different figure. Accounts asks to change
// it; on approval the order's Advance Received is updated to the bank
// figure straight away (and the change is logged), after which Accounts
// verifies as normal.
var PX_CORRECTION = 'ADVANCE_CORRECTION';
var PX_LABELS = {};
PX_LABELS[PX_VERIFY] = 'Verify without advance';
PX_LABELS[PX_DISPATCH] = 'Dispatch with balance due';
PX_LABELS[PX_CORRECTION] = 'Correct advance amount';
// PX_EXCESS "Payment with excess" (Oct 2026) -- the bank shows more than the
// order needs (usually old pre-system dues in the same transfer). The whole
// entry waits for an admin; on approval the order gets its share and the rest
// goes to the Excess Payments tab, never onto the order. See Excess.gs.
var PX_EXCESS = 'EXCESS_PAYMENT';
PX_LABELS[PX_EXCESS] = 'Payment with excess';

function getOrCreatePaymentExceptionsSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(PAYMENT_EXCEPTIONS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PAYMENT_EXCEPTIONS_SHEET_NAME);
    sheet.getRange(1, 1, 1, PX_HEADERS.length).setValues([PX_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    // Columns added after the tab first went live (Sep 2026): fill in any missing headers.
    ensureColumns_(sheet, PX_HEADERS.length);
    var hdr = sheet.getRange(1, 1, 1, PX_HEADERS.length).getValues()[0];
    for (var h = 11; h < PX_HEADERS.length; h++) {
      if (!String(hdr[h] || '').trim()) sheet.getRange(1, h + 1).setValue(PX_HEADERS[h]).setFontWeight('bold');
    }
  }
  return sheet;
}

function readPaymentExceptions_() {
  var sheet = getOrCreatePaymentExceptionsSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, PX_HEADERS.length).getValues().map(function (r, i) {
    return {
      row: i + 2, requestId: String(r[0] || ''), requestedAtMs: r[1] instanceof Date ? r[1].getTime() : null,
      trackerId: String(r[2] || ''), type: String(r[3] || ''), requestedBy: String(r[4] || '').toUpperCase(),
      requestedByName: String(r[5] || ''), reason: String(r[6] || ''), amountNote: String(r[7] || ''),
      status: String(r[8] || ''), decidedBy: String(r[9] || ''), decidedAtMs: r[10] instanceof Date ? r[10].getTime() : null,
      correctedAdvance: r[11] === '' || r[11] === null ? null : Number(r[11]),
      alertsSent: String(r[12] || ''),
      amountReceived: Number(r[13]) || 0, bankReference: String(r[14] || '')
    };
  }).filter(function (r) { return r.requestId; });
}

/** Most recent exception request of this type for this order, or null. */
function latestPaymentException_(trackerId, type) {
  var tid = String(trackerId || '').toLowerCase();
  var all = readPaymentExceptions_().filter(function (r) { return r.type === type && r.trackerId.toLowerCase() === tid; });
  return all.length ? all[all.length - 1] : null;
}

function isPaymentExceptionApproved_(trackerId, type) {
  var r = latestPaymentException_(trackerId, type);
  return !!(r && r.status === 'Approved');
}

/** Browser-safe summary for the Accounts page. */
function summarizePaymentException_(r) {
  if (!r) return null;
  return { requestId: r.requestId, status: r.status, decidedBy: r.decidedBy, requestedByName: r.requestedByName, reason: r.reason,
           correctedAdvance: r.correctedAdvance, amountNote: r.amountNote, amountReceived: r.amountReceived || 0 };
}

/** Accounts: form = { trackerId, type, reason } */
function requestPaymentException_(form) {
  var me = CURRENT_STAFF_;
  var type = [PX_VERIFY, PX_DISPATCH, PX_CORRECTION, PX_EXCESS].indexOf(form.type) !== -1 ? form.type : '';
  if (!type) throw new Error('Unknown request type.');
  var reason = String(form.reason || '').trim();
  if (!reason) throw new Error('Add a short reason for the admin, e.g. "Govt. hospital, pays on delivery".');

  var sheet = getSheet();
  var row = resolveTrackerId(sheet, String(form.trackerId || ''));
  if (row === -1) throw new Error('Tracker ID not found.');
  var d = getRowFields(sheet, row, ['Tracker ID', 'Institution / Customer', 'Status', 'Payment Terms Type', 'Total Order Value', 'Advance Received']);
  var trackerId = String(d['Tracker ID']);
  // One request at a time per order (Oct 2026): a waiting request of ANY type locks the order.
  if (typeof assertNoPendingRequest_ === 'function') assertNoPendingRequest_(sheet, row);
  var terms = d['Payment Terms Type'] || 'End Customer';
  var total = Number(d['Total Order Value']) || 0;
  var advance = Number(d['Advance Received']) || 0;
  var balance = computeBalanceDue(total, advance);

  // Only allow a request where the rule actually blocks something.
  var amountNote, corrected = '', excess = null;
  if (type === PX_EXCESS) {
    // Any customer, before or after verification -- it's about money that arrived, not payment terms.
    excess = prepareExcessRequest_(sheet, row, form);
    amountNote = excess.amountNote;
  } else if (type === PX_CORRECTION) {
    // Applies to PO and End customers alike -- it's about a wrong figure, not payment terms.
    if (d['Status'] !== 'Logged') throw new Error('The advance can only be corrected before verification.');
    corrected = Math.round(Number(form.correctedAdvance) * 100) / 100;
    if (form.correctedAdvance === '' || isNaN(corrected) || corrected < 0) throw new Error('Enter the amount the bank actually shows.');
    if (advance <= 0) throw new Error('No advance was logged \u2013 just enter the amount received and verify; no approval needed.');
    if (corrected === advance) throw new Error('That\u2019s the same as the logged advance \u2013 nothing to correct.');
    if (total > 0 && corrected > total) throw new Error('That\u2019s more than the order value (\u20b9' + formatAmount(total) + ').');
    amountNote = 'Logged \u20b9' + formatAmount(advance) + ' \u2192 bank shows \u20b9' + formatAmount(corrected) + ' (order \u20b9' + formatAmount(total) + ')';
  } else if (terms !== 'End Customer') {
    throw new Error('PO customers don\u2019t need an exception \u2013 their own PO terms already allow this.');
  } else if (type === PX_VERIFY) {
    if (d['Status'] !== 'Logged') throw new Error('This order has already been verified.');
    if (advance > 0) throw new Error('An advance of \u20b9' + formatAmount(advance) + ' was received \u2013 verify it with the UTR instead.');
    amountNote = 'Order \u20b9' + formatAmount(total) + ', advance \u20b90';
  } else {
    if (balance <= 0) throw new Error('This order is fully paid \u2013 no exception needed.');
    if (d['Status'] === 'Logged') throw new Error('Verify the payment first; request dispatch approval once it\u2019s with Ops.');
    if (isDispatchedStatus_(d['Status'])) throw new Error('This order has already been dispatched.');
    amountNote = 'Order \u20b9' + formatAmount(total) + ', paid \u20b9' + formatAmount(advance) + ', balance \u20b9' + formatAmount(balance);
  }
  var existing = latestPaymentException_(trackerId, type);
  if (existing && existing.status === 'Pending') throw new Error('A request is already waiting for an admin (' + existing.requestId + ').');
  // An order can receive more than one excess payment over time, so an earlier approved one doesn't block a new one.
  if (existing && existing.status === 'Approved' && type !== PX_EXCESS) throw new Error('Already approved by ' + existing.decidedBy + '. Look the order up again to continue.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var requestId;
  try {
    requestId = 'PE-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd') + '-' + Utilities.getUuid().split('-')[0].slice(0, 4).toUpperCase();
    appendRowText_(getOrCreatePaymentExceptionsSheet_(), [requestId, new Date(), trackerId, type, me.code, me.name, reason, amountNote, 'Pending', '', '', corrected,
      '', excess ? excess.amount : '', excess ? excess.utr : ''], [PX_HEADERS.indexOf('Bank Reference / UTR') + 1]);
  } finally {
    lock.releaseLock();
  }

  var esc = function (t) { return String(t || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var url = appUrl_();
  var link = url ? url + '?page=admin&req=' + encodeURIComponent(requestId) : '';
  var emailed = emailAdmins_(
    'Payment approval: ' + PX_LABELS[type] + ' \u2013 ' + trackerId,
    '<p><b>' + esc(me.name) + '</b> (Accounts) is asking to <b>' + esc(PX_LABELS[type].toLowerCase()) + '</b>' + (type === PX_CORRECTION || type === PX_EXCESS ? '' : ' for an end-customer order') + '.</p>' +
    '<p>Order: <b>' + esc(trackerId) + '</b> \u2013 ' + esc(d['Institution / Customer']) + '<br>' + esc(amountNote) + '<br>Reason: ' + esc(reason) + '</p>' +
    (link ? '<p><a href="' + link + '" style="background:#1F3864;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:600;">Review request</a></p>' +
            '<p style="color:#666;font-size:12px;">You\u2019ll sign in with your staff code and PIN to approve or decline.</p>' : '') +
    '<p style="color:#666;font-size:12px;">Request ' + esc(requestId) + '</p>'
  );
  // Tell Accounts who to ring right now, and whether the one-hour clock is running.
  var cfg = getAlertSettings_();
  var approver = cfg.firstApprover ? getStaffMap_(false)[cfg.firstApprover] : null;
  return {
    trackerId: trackerId, requestId: requestId, emailed: emailed,
    callName: approver ? approver.name : '', callPhone: approver ? staffPhone_(approver.code) : '',
    officeOpen: isOfficeOpen_(Date.now(), cfg), targetMinutes: cfg.paymentEscalateAfter
  };
}

/** Admin: form = { requestId, approve } */
function decidePaymentException_(form) {
  var me = CURRENT_STAFF_;
  var r;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var releasedToOps = false;
  var excessResult = null;
  try {
    r = readPaymentExceptions_().filter(function (x) { return x.requestId === form.requestId; })[0];
    if (!r) throw new Error('Request not found.');
    if (r.status !== 'Pending') throw new Error('This request was already ' + r.status.toLowerCase() + ' by ' + (r.decidedBy || 'someone') + '.');
    if (form.approve && r.type === PX_CORRECTION) {
      // Apply the corrected advance to the order now, so Accounts simply
      // verifies against the right figure. Only while still unverified.
      var cSheet = getSheet();
      var cRow = resolveTrackerId(cSheet, r.trackerId);
      if (cRow === -1) throw new Error('Order not found.');
      var cur = getRowFields(cSheet, cRow, ['Status', 'Total Order Value']);
      if (cur['Status'] !== 'Logged') throw new Error('This order has already been verified, so the advance can\u2019t be corrected this way any more. Decline it.');
      if (r.correctedAdvance === null || isNaN(r.correctedAdvance)) throw new Error('This request has no corrected amount.');
      setRowFields(cSheet, cRow, { 'Advance Received': r.correctedAdvance });
      writeAdvancePct_(cSheet, cRow, r.correctedAdvance, Number(cur['Total Order Value']) || 0);
      logActivity_(me, 'Advance corrected', r.trackerId, r.amountNote + ' (' + r.requestId + ')');
    }
    if (form.approve && r.type === PX_EXCESS) {
      // Records the order's share (completing verification if still Logged) and logs the excess. Throws -> nothing marked.
      excessResult = applyExcessPayment_(r, me);
      releasedToOps = !!excessResult.releasedToOps;
    }
    getOrCreatePaymentExceptionsSheet_().getRange(r.row, 9, 1, 3)
      .setValues([[form.approve ? 'Approved' : 'Declined', me.name + ' (' + me.code + ')', new Date()]]);

    // A courier order held for its balance goes to Ops as soon as dispatch is approved.
    if (form.approve && r.type === PX_DISPATCH) {
      var sheet = getSheet();
      var row = resolveTrackerId(sheet, r.trackerId);
      if (row !== -1 && getRowFields(sheet, row, ['Status'])['Status'] === STATUS_HOLD_BALANCE) {
        setRowFields(sheet, row, { 'Status': 'Sent to Ops', 'Sent to Ops Timestamp': new Date() });
        releasedToOps = true;
      }
    }
  } finally {
    lock.releaseLock();
  }
  var requester = getStaffMap_(false)[r.requestedBy];
  if (requester && /@/.test(requester.email)) {
    try {
      MailApp.sendEmail(requester.email, (form.approve ? 'Approved: ' : 'Declined: ') + PX_LABELS[r.type] + ' \u2013 ' + r.trackerId,
        excessResult
          ? me.name + ' approved the payment for ' + r.trackerId + '. Recorded: \u20b9' + formatAmount(excessResult.share) + ' to the order, \u20b9' +
            formatAmount(excessResult.excess) + ' to Excess Payments.' +
            (excessResult.verificationCode ? ' The order is verified \u2013 Verification Code ' + excessResult.verificationCode + ' (write it on the physical PO).' : '')
          : form.approve ? me.name + ' approved "' + PX_LABELS[r.type] + '" for ' + r.trackerId + '. Look the order up on the Accounts page to continue.'
          : me.name + ' declined "' + PX_LABELS[r.type] + '" for ' + r.trackerId + '.' + (r.type === PX_EXCESS ? ' Nothing was recorded \u2013 check the amount and enter it again.' : ''));
    } catch (e) { Logger.log('requester notify failed: ' + e); }
  }
  return { trackerId: r.trackerId, requestId: r.requestId, approved: !!form.approve, releasedToOps: releasedToOps,
           excess: excessResult ? excessResult.excess : null, verificationCode: excessResult ? excessResult.verificationCode || '' : '' };
}

/** Writes Advance % of Total as text ("45.5%"), same format as intake and balance payments. */
function writeAdvancePct_(sheet, row, advance, total) {
  var pct = total > 0 ? Math.round((advance / total) * 1000) / 10 : 0;
  var r = sheet.getRange(row, getHeaderIndex('Advance % of Total'));
  r.setNumberFormat('@');
  r.setValue(pct + '%');
}

/**
 * Admin-only: what's waiting on an admin decision, for the counter in the
 * signed-in bar (auth.html) that follows the Admin to every page. Polled
 * once a minute, so it has to stay cheap -- two small tabs, no tracker read.
 * Counts every Pending request, exactly like the Admin page lists them.
 */
function getApprovalSummary_() {
  var now = Date.now();
  var px = readPaymentExceptions_().filter(function (r) { return r.status === 'Pending'; });
  var ar = readAccessRequests_().filter(function (r) { return r.status === 'Pending'; });
  // Standby requests waiting for an admin (Oct 2026). "Pending Director" ones are the directors', not counted here.
  var sb = (typeof readStandby_ === 'function') ? readStandby_().filter(function (r) { return r.status === 'Pending'; }) : [];
  var oldest = null;
  px.concat(ar, sb).forEach(function (r) {
    if (r.requestedAtMs && (oldest === null || r.requestedAtMs < oldest)) oldest = r.requestedAtMs;
  });
  var cfg = getAlertSettings_();
  var overdue = 0;
  px.forEach(function (r) { if (r.requestedAtMs && officeMinutesBetween_(r.requestedAtMs, now, cfg) >= cfg.paymentEscalateAfter) overdue++; });
  ar.forEach(function (r) { if (r.requestedAtMs && officeMinutesBetween_(r.requestedAtMs, now, cfg) >= cfg.accessEscalateAfter) overdue++; });
  if (sb.length) {
    var sbEsc = getStandbySettings_().escalateAfter;
    sb.forEach(function (r) { if (r.requestedAtMs && officeMinutesBetween_(r.requestedAtMs, now, cfg) >= sbEsc) overdue++; });
  }
  return {
    payments: px.length,
    access: ar.length,
    standby: sb.length,
    total: px.length + ar.length + sb.length,
    overdue: overdue, // past the target in OFFICE time -- a request left overnight isn't overdue at 9:30

    oldestMinutes: oldest === null ? null : Math.max(0, Math.floor((now - oldest) / 60000)),
    newestId: px.concat(ar, sb).reduce(function (m, r) { return (!m || (r.requestedAtMs || 0) > m.t) ? { id: r.requestId, t: r.requestedAtMs || 0 } : m; }, null)
  };
}

// ================================================================
// "AWAITING APPROVAL" PANELS  (left column on the Accounts and CRE pages)
// ================================================================
/**
 * Keeps every order that's waiting on -- or has just received -- an Admin
 * decision on screen, so it can't slip out of sight while the request is
 * out. Each item stays until it no longer needs the person's attention:
 *   Pending  -> until decided (or the order moves on without it).
 *   Approved -> until the approved step is actually done (verified /
 *               dispatched; for CRE access, until the 24 hours run out).
 *   Declined -> for 7 days (CRE: 3 days) or until the order moves on, so the
 *               person sees the "no" and follows up.
 * Only the latest request per order + type is shown.
 */
function getPaymentApprovalsPanel_() {
  var all = readPaymentExceptions_();
  if (!all.length) return [];
  var latest = {};
  all.forEach(function (r) { latest[r.trackerId.toLowerCase() + '|' + r.type] = r; });
  var orders = orderSnapshot_();
  var weekAgo = Date.now() - 7 * 86400000;
  var out = [];
  Object.keys(latest).forEach(function (k) {
    var r = latest[k];
    var o = orders[r.trackerId.toLowerCase()];
    if (!o) return;
    if (r.status === 'Withdrawn') return; // pulled back by Accounts -- nothing to follow up
    var stillBlocking = (r.type === PX_DISPATCH) ? (!isDispatchedStatus_(o.status) && o.balance > 0)
      : (r.type === PX_EXCESS) ? (r.status === 'Pending' || (r.decidedAtMs && r.decidedAtMs > Date.now() - 2 * 86400000))
      : (o.status === 'Logged');
    if (!stillBlocking) return;
    if (r.status === 'Declined' && !(r.decidedAtMs && r.decidedAtMs > weekAgo)) return;
    out.push(panelItem_(r, o, PX_LABELS[r.type] || r.type,
      r.status === 'Approved' ? (r.type === PX_CORRECTION ? 'Approved \u2013 advance updated, verify now' : r.type === PX_EXCESS ? 'Approved \u2013 recorded' : 'Approved \u2013 continue')
      : r.status === 'Declined' ? (r.type === PX_EXCESS ? 'Declined \u2013 nothing recorded, re-enter' : 'Declined \u2013 follow up') : 'Waiting for admin'));
  });
  return sortPanel_(out);
}

function getAccessApprovalsPanel_() {
  var me = CURRENT_STAFF_;
  var latest = {};
  readAccessRequests_().forEach(function (r) { if (r.requestedBy === me.code) latest[r.trackerId.toLowerCase()] = r; });
  var orders = orderSnapshot_();
  var threeDaysAgo = Date.now() - 3 * 86400000;
  var tz = Session.getScriptTimeZone();
  var out = [];
  Object.keys(latest).forEach(function (k) {
    var r = latest[k];
    var o = orders[k];
    if (!o || o.closed) return;
    if (r.status === 'Approved' && !(r.untilMs > Date.now())) return; // expired
    if (r.status === 'Declined' && !(r.decidedAtMs && r.decidedAtMs > threeDaysAgo)) return;
    out.push(panelItem_(r, o, 'Access to ' + (o.ownerName || 'another CRE') + '\u2019s order',
      r.status === 'Approved' ? 'Approved \u2013 until ' + Utilities.formatDate(new Date(r.untilMs), tz, 'dd-MMM, hh:mm a')
      : r.status === 'Declined' ? 'Declined' : 'Waiting for admin'));
  });
  return sortPanel_(out);
}

function panelItem_(r, o, label, statusText) {
  var tz = Session.getScriptTimeZone();
  var when = r.status === 'Pending' ? r.requestedAtMs : (r.decidedAtMs || r.requestedAtMs);
  return {
    trackerId: o.trackerId, institution: o.institution, requestId: r.requestId, label: label,
    status: r.status, statusText: statusText, decidedBy: r.decidedBy || '',
    when: when ? Utilities.formatDate(new Date(when), tz, 'dd-MMM, hh:mm a') : '', whenMs: when || 0
  };
}

/** Approved first (ready to act on), then Declined, then Pending; newest first within each. */
function sortPanel_(items) {
  var rank = { Approved: 0, Declined: 1, Pending: 2 };
  return items.sort(function (a, b) { return (rank[a.status] - rank[b.status]) || (b.whenMs - a.whenMs); });
}

/** { trackerIdLower: { trackerId, institution, status, balance, closed, ownerName } } in one pass. */
function orderSnapshot_() {
  var sheet = getSheet();
  var last = getLastOrderRow_(sheet);
  var out = {};
  if (last < 2) return out;
  var n = last - 1;
  var col = function (h) { return sheet.getRange(2, getHeaderIndex(h), n, 1).getValues(); };
  var ids = col('Tracker ID'), inst = col('Institution / Customer'), st = col('Status'), tot = col('Total Order Value'),
      adv = col('Advance Received'), ds = col('Delivery Status');
  var owners = readOrderOwners_(sheet, n);
  var staffMap = getStaffMap_(false);
  for (var i = 0; i < n; i++) {
    var id = String(ids[i][0] || '').trim();
    if (!id) continue;
    out[id.toLowerCase()] = {
      trackerId: id, institution: String(inst[i][0] || ''), status: String(st[i][0] || ''),
      balance: computeBalanceDue(tot[i][0], adv[i][0]),
      closed: ds[i][0] === 'Delivered' || ds[i][0] === 'Returned',
      ownerName: (staffMap[owners[i]] || {}).name || ''
    };
  }
  return out;
}

/** Emails every active Admin who has an Email in the Staff tab. Returns how many were emailed. */
function emailAdmins_(subject, htmlBody) {
  var staffMap = getStaffMap_(true);
  var to = [];
  for (var k in staffMap) {
    var s = staffMap[k];
    if (s.active && s.role === 'Admin' && /@/.test(s.email)) to.push(s.email);
  }
  if (!to.length) return 0;
  try {
    MailApp.sendEmail({ to: to.join(','), subject: subject, htmlBody: htmlBody });
    return to.length;
  } catch (e) {
    Logger.log('emailAdmins_ failed: ' + e);
    return 0;
  }
}

// ================================================================
// APPROVAL ALERTS  (reminders + escalation, office hours only)
// ================================================================
/**
 * Makes sure no approval request sits unanswered. Agreed rules (Sep 2026):
 *   - Payment approvals must be answered within an hour. Accounts rings the
 *     first approver (Ananthu) as soon as they raise one -- the Accounts
 *     screen shows his number for that.
 *   - If a request is still pending: a REMINDER goes to the first approver,
 *     then an ESCALATION goes to the escalation contact (Sambhu), copied to
 *     the first approver and the person who asked.
 *   - Time only counts during OFFICE HOURS. A request raised at 7 pm starts
 *     its clock when the office opens next morning, and no reminder or
 *     escalation is ever sent outside office hours. (The first "new request"
 *     email still goes immediately, whatever the time -- it's a notice, not
 *     an alert.)
 *
 * NOTHING IS HARD-CODED. Everything comes from the spreadsheet:
 *   "Settings" tab (created by setup):
 *     Office opens / Office closes (HH:MM, 24-hour), Working days,
 *     Holidays (dates, comma-separated), First approver / Escalate to (staff
 *     codes), and the four time limits in office minutes.
 *   "Staff" tab: each person's Email (column H) and Phone (the column headed
 *     "Phone", added by setup) -- looked up by staff code every time.
 *   Edit any of it in the sheet; the next check (within 10 minutes) uses it.
 *
 * HOW IT RUNS: a time-driven trigger calls checkApprovalAlerts() every 10
 * minutes (installAlertTrigger, run by setup or from the ICF Admin menu).
 * Each request's "Alerts Sent" column records what has gone out, so nothing
 * is sent twice.
 */
var SETTINGS_SHEET_NAME = 'Settings';
var SETTINGS_ROWS = [
  // [label, default, explanation]  -- the label is what the code looks up; don't rename it
  ['Office opens', '09:30', '24-hour time, e.g. 09:30'],
  ['Office closes', '18:30', '24-hour time, e.g. 18:30'],
  ['Working days', 'Mon, Tue, Wed, Thu, Fri, Sat', 'Days the office works (Mon, Tue, Wed, Thu, Fri, Sat, Sun)'],
  ['Holidays', '', 'Dates the office is closed, comma-separated, e.g. 02-Oct-2026, 20-Oct-2026'],
  ['First approver (staff code)', '', 'Gets the reminder, and is who Accounts is told to call. e.g. Ananthu\u2019s code'],
  ['Escalate to (staff code)', '', 'Gets the escalation if a request is still unanswered. e.g. Sambhu\u2019s code'],
  ['Payment approval: remind after (office minutes)', '30', 'Reminder to the first approver'],
  ['Payment approval: escalate after (office minutes)', '60', 'The one-hour target \u2013 escalation goes out here'],
  ['CRE access request: remind after (office minutes)', '60', ''],
  ['CRE access request: escalate after (office minutes)', '120', '']
];

/** Settings as a plain object. Cached 5 minutes; edits in the sheet apply by the next check. */
function getAlertSettings_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('alert_settings');
  if (hit) return JSON.parse(hit);
  var map = {};
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SETTINGS_SHEET_NAME);
  if (sheet && sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues().forEach(function (r) {
      map[String(r[0] || '').trim().toLowerCase()] = String(r[1] || '').trim();
    });
  }
  var get = function (label) {
    var v = map[label.toLowerCase()];
    if (v === undefined || v === '') {
      var def = SETTINGS_ROWS.filter(function (r) { return r[0] === label; })[0];
      return def ? def[1] : '';
    }
    return v;
  };
  var num = function (label) { var n = Number(get(label)); return isNaN(n) || n <= 0 ? Number(SETTINGS_ROWS.filter(function (r) { return r[0] === label; })[0][1]) : n; };
  var hm = function (label) {
    var m = String(get(label)).match(/^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/i);
    if (!m) m = String(SETTINGS_ROWS.filter(function (r) { return r[0] === label; })[0][1]).match(/^(\d{1,2}):(\d{2})()$/);
    var h = Number(m[1]) % 12 + (m[3] && m[3].toLowerCase() === 'pm' ? 12 : (m[3] ? 0 : Math.floor(Number(m[1]) / 12) * 12));
    return h * 60 + Number(m[2]);
  };
  var DAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  var days = String(get('Working days')).toLowerCase().split(/[^a-z]+/).map(function (d) { return DAY[d.slice(0, 3)]; })
    .filter(function (d) { return d !== undefined; });
  var holidays = String(get('Holidays')).split(/[,;\n]+/).map(function (t) { return parseHolidayYmd_(t.trim()); }).filter(Boolean);
  var cfg = {
    openMin: hm('Office opens'),
    closeMin: hm('Office closes'),
    workingDays: days.length ? days : [1, 2, 3, 4, 5, 6],
    holidays: holidays,
    firstApprover: String(get('First approver (staff code)')).toUpperCase(),
    escalateTo: String(get('Escalate to (staff code)')).toUpperCase(),
    paymentRemindAfter: num('Payment approval: remind after (office minutes)'),
    paymentEscalateAfter: num('Payment approval: escalate after (office minutes)'),
    accessRemindAfter: num('CRE access request: remind after (office minutes)'),
    accessEscalateAfter: num('CRE access request: escalate after (office minutes)')
  };
  cache.put('alert_settings', JSON.stringify(cfg), 300);
  return cfg;
}

/** "02-Oct-2026", "2-10-2026", "2026-10-02" -> "2026-10-02" (or null). */
function parseHolidayYmd_(t) {
  if (!t) return null;
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var m;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
  if ((m = t.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ](\d{4})$/)) && MON[m[2].toLowerCase()]) return m[3] + '-' + pad(MON[m[2].toLowerCase()]) + '-' + pad(+m[1]);
  if ((m = t.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/))) return m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]); // day first (India)
  return null;
}

/** Offset of the script's timezone from UTC, in ms (IST = +5:30; no daylight saving). */
function tzOffsetMs_(atMs) {
  var z = Utilities.formatDate(new Date(atMs), Session.getScriptTimeZone(), 'Z'); // e.g. "+0530"
  var sign = z.charAt(0) === '-' ? -1 : 1;
  return sign * (Number(z.substr(1, 2)) * 60 + Number(z.substr(3, 2))) * 60000;
}

function isWorkingDay_(localDayStartMs, cfg) {
  var d = new Date(localDayStartMs);
  return cfg.workingDays.indexOf(d.getUTCDay()) !== -1 && cfg.holidays.indexOf(d.toISOString().slice(0, 10)) === -1;
}

/** Minutes of office time between two moments (the clock is paused outside office hours). */
function officeMinutesBetween_(fromMs, toMs, cfg) {
  if (!fromMs || toMs <= fromMs) return 0;
  var off = tzOffsetMs_(toMs), DAYMS = 86400000;
  var s = fromMs + off, e = toMs + off; // "local" times, handled as if UTC
  var total = 0;
  for (var d = Math.floor(s / DAYMS) * DAYMS, guard = 0; d <= e && guard < 120; d += DAYMS, guard++) {
    if (!isWorkingDay_(d, cfg)) continue;
    var open = d + cfg.openMin * 60000, close = d + cfg.closeMin * 60000;
    total += Math.max(0, Math.min(e, close) - Math.max(s, open));
  }
  return Math.floor(total / 60000);
}

function isOfficeOpen_(nowMs, cfg) {
  var off = tzOffsetMs_(nowMs), DAYMS = 86400000;
  var local = nowMs + off, d = Math.floor(local / DAYMS) * DAYMS;
  var mins = (local - d) / 60000;
  return isWorkingDay_(d, cfg) && mins >= cfg.openMin && mins < cfg.closeMin;
}

/**
 * Phone number from the Staff tab's "Phone" column (found by its header, so
 * it doesn't matter where the column sits). '' if none.
 */
function staffPhone_(code) {
  var s = getStaffMap_(false)[String(code || '').toUpperCase()];
  if (!s) return '';
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(STAFF_SHEET_NAME);
  var lastCol = sheet.getLastColumn();
  var hdr = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var col = hdr.indexOf('phone');
  return col === -1 ? '' : String(sheet.getRange(s.row, col + 1).getDisplayValue() || '').trim();
}

/** The time-driven check. Runs every 10 minutes; does nothing outside office hours. */
function checkApprovalAlerts() {
  var cfg = getAlertSettings_();
  var now = Date.now();
  if (!isOfficeOpen_(now, cfg)) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return; // another check still running -- the next one will catch up
  try {
    var staffMap = getStaffMap_(true);
    var first = staffMap[cfg.firstApprover] || null;
    var escal = staffMap[cfg.escalateTo] || null;
    var fallbackAdmins = Object.keys(staffMap).map(function (k) { return staffMap[k]; })
      .filter(function (s) { return s.active && s.role === 'Admin' && /@/.test(s.email); });
    var emailOf = function (s) { return s && s.active && /@/.test(s.email) ? s.email : ''; };
    var firstEmails = emailOf(first) ? [emailOf(first)] : fallbackAdmins.map(function (s) { return s.email; });
    var url = appUrl_();
    var sent = 0;

    var jobs = [
      { list: readPaymentExceptions_(), sheet: getOrCreatePaymentExceptionsSheet_(), col: PX_HEADERS.indexOf('Alerts Sent') + 1,
        remind: cfg.paymentRemindAfter, escalate: cfg.paymentEscalateAfter,
        label: function (r) { return (PX_LABELS[r.type] || r.type) + ' \u2013 ' + r.trackerId; },
        detail: function (r) { return r.amountNote + '<br>Asked by ' + r.requestedByName + ': ' + r.reason; } },
      { list: readAccessRequests_(), sheet: getOrCreateAccessRequestsSheet_(), col: ACCESS_REQUEST_HEADERS.length,
        remind: cfg.accessRemindAfter, escalate: cfg.accessEscalateAfter,
        label: function (r) { return 'CRE access request \u2013 ' + r.trackerId; },
        detail: function (r) { return r.requestedByName + ' wants to update ' + ((staffMap[r.ownerCode] || {}).name || r.ownerCode) + '\u2019s order: ' + r.reason; } }
    ];
    jobs[0].directorCanAct = true; // payment approvals: a Director can decide them from the dashboard (Oct 2026)
    if (typeof standbyAlertJob_ === 'function') {
      try { jobs.push(standbyAlertJob_()); } catch (e) { Logger.log('Standby alert job failed: ' + e); }
    }

    jobs.forEach(function (job) {
      job.list.forEach(function (r) {
        if (r.status !== 'Pending' || !r.requestedAtMs) return;
        var mins = officeMinutesBetween_(r.requestedAtMs, now, cfg);
        var reminded = r.alertsSent.indexOf('Reminder') !== -1;
        var escalated = r.alertsSent.indexOf('Escalated') !== -1;
        var link = url ? url + '?page=admin&req=' + encodeURIComponent(r.requestId) : '';
        var requester = staffMap[r.requestedBy];
        var stamp = Utilities.formatDate(new Date(now), Session.getScriptTimeZone(), 'dd-MMM HH:mm');

        if (mins >= job.escalate && !escalated) {
          var to = emailOf(escal) ? [emailOf(escal)] : firstEmails; // no escalation contact on file -> at least chase the approvers
          var cc = firstEmails.concat(emailOf(requester) ? [emailOf(requester)] : []).filter(function (e) { return to.indexOf(e) === -1; });
          // An escalation to a Director links to the dashboard, where they can decide it (payments only).
        var escLink = (job.directorCanAct && escal && escal.role === 'Director' && url) ? url + '?page=dashboard' : link;
        if (sendAlertEmail_(to, cc, 'OVERDUE: ' + job.label(r),
              '<p>This request has waited <b>' + fmtMins_(mins) + ' of office time</b> without a decision (target: ' + fmtMins_(job.escalate) + ').</p>' +
              '<p>' + job.detail(r) + '</p>' +
              (first ? '<p>First approver: ' + first.name + (staffPhone_(first.code) ? ' (' + staffPhone_(first.code) + ')' : '') + '</p>' : ''), escLink)) {
            markAlert_(job.sheet, r.row, job.col, r.alertsSent, (reminded ? '' : 'Reminder ' + stamp + ' | ') + 'Escalated ' + stamp);
            logActivity_({ code: 'SYSTEM', name: 'Approval alerts', role: '' }, 'Escalated overdue request', r.trackerId, r.requestId + ' after ' + mins + ' office min');
            sent++;
          }
        } else if (mins >= job.remind && !reminded) {
          if (sendAlertEmail_(firstEmails, [], 'Reminder: ' + job.label(r),
              '<p>Still waiting for a decision \u2013 ' + fmtMins_(mins) + ' of office time so far. It will be escalated' +
              (escal ? ' to ' + escal.name : '') + ' at ' + fmtMins_(job.escalate) + '.</p><p>' + job.detail(r) + '</p>', link)) {
            markAlert_(job.sheet, r.row, job.col, r.alertsSent, 'Reminder ' + stamp);
            logActivity_({ code: 'SYSTEM', name: 'Approval alerts', role: '' }, 'Reminder sent', r.trackerId, r.requestId + ' after ' + mins + ' office min');
            sent++;
          }
        }
      });
    });
    // Standby timers (Oct 2026): auto-resume on the resume date, nudge the working day before.
    if (typeof processStandbyTimers_ === 'function') {
      try { sent += processStandbyTimers_(now, staffMap, cfg); } catch (e) { Logger.log('Standby timers failed: ' + e); }
    }
    return sent;
  } finally {
    lock.releaseLock();
  }
}

function fmtMins_(m) {
  if (m < 60) return m + ' min';
  var h = Math.floor(m / 60), r = m % 60;
  return h + ' h' + (r ? ' ' + r + ' min' : '');
}

function markAlert_(sheet, row, col, existing, add) {
  sheet.getRange(row, col).setValue(existing ? existing + ' | ' + add : add);
}

function sendAlertEmail_(to, cc, subject, htmlInner, link) {
  to = (to || []).filter(function (e) { return /@/.test(e); });
  if (!to.length) { Logger.log('No email on file for alert: ' + subject); return false; }
  try {
    var opts = {
      to: to.join(','), subject: subject,
      htmlBody: htmlInner + (link ? '<p><a href="' + link + '" style="background:#1F3864;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:600;">Review request</a></p>' : '') +
        '<p style="color:#888;font-size:11px;">Automatic alert from the ICF Order Tracker. Office hours, approvers and time limits are in the Settings tab.</p>'
    };
    cc = (cc || []).filter(function (e) { return /@/.test(e); });
    if (cc.length) opts.cc = cc.join(',');
    MailApp.sendEmail(opts);
    return true;
  } catch (e) {
    Logger.log('Alert email failed: ' + e);
    return false;
  }
}

/** Creates the 10-minute trigger once (safe to run again). Also on the ICF Admin menu. */
function installAlertTrigger() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'checkApprovalAlerts'; });
  if (!exists) ScriptApp.newTrigger('checkApprovalAlerts').timeBased().everyMinutes(10).create();
  return exists ? 'Approval alerts were already on.' : 'Approval alerts turned on (every 10 minutes).';
}

/**
 * Setup step: Settings tab (defaults, with the approver codes filled in by
 * matching staff named Ananthu / Sambhu if they exist), a Phone column on the
 * Staff tab, and the trigger. Never overwrites values already in Settings.
 */
function setupAlerts_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var staffMap = getStaffMap_(true);
  var codeFor = function (name) {
    for (var k in staffMap) if (staffMap[k].name.toLowerCase().indexOf(name) === 0) return k;
    return '';
  };
  var settings = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (!settings) {
    settings = ss.insertSheet(SETTINGS_SHEET_NAME);
    settings.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'What it means']]).setFontWeight('bold');
    settings.setFrozenRows(1);
    settings.getRange('B:B').setNumberFormat('@'); // keep 09:30 as text, not a Sheets time
    settings.setColumnWidth(1, 330); settings.setColumnWidth(2, 220); settings.setColumnWidth(3, 420);
  }
  var existing = settings.getLastRow() >= 2
    ? settings.getRange(2, 1, settings.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).trim().toLowerCase(); }) : [];
  SETTINGS_ROWS.forEach(function (r) {
    if (existing.indexOf(r[0].toLowerCase()) !== -1) return;
    var val = r[1];
    if (r[0] === 'First approver (staff code)') val = codeFor('ananthu');
    if (r[0] === 'Escalate to (staff code)') val = codeFor('sambhu');
    settings.appendRow([r[0], val, r[2]]);
  });
  settings.getRange('B:B').setNumberFormat('@');

  // Phone column on the Staff tab: added after the LAST column holding anything,
  // so it can never land on top of existing data.
  var staff = ss.getSheetByName(STAFF_SHEET_NAME);
  if (staff) {
    var lastCol = staff.getLastColumn();
    var hdr = staff.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
    if (hdr.indexOf('phone') === -1) {
      var col = lastCol + 1;
      if (staff.getMaxColumns() < col) staff.insertColumnsAfter(staff.getMaxColumns(), col - staff.getMaxColumns());
      staff.getRange(1, col).setValue('Phone').setFontWeight('bold');
      staff.getRange(2, col, Math.max(staff.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    }
  }
  getOrCreatePaymentExceptionsSheet_();
  getOrCreateAccessRequestsSheet_();
  CacheService.getScriptCache().remove('alert_settings');
  installAlertTrigger();
}


// ================================================================
// ORDER SEARCH + "MY ORDERS" (CRE page: lookup box and the tile pop-up)
// ================================================================
/**
 * One search used by the Look Up box. The query can be:
 *   - a CRM quotation / Tracker ID, whole or partial   ("6199", "ICESPL-6199")
 *   - a phone number, whole or partial (4+ digits)     ("98470", "9847012345")
 *   - a customer / institution name, or part of one    ("booma", "nursing home")
 * An exact Tracker ID wins outright. Otherwise every order matching ANY of
 * the three is returned (newest first, max 30). When there's exactly one
 * match the full order comes back too, so the page opens it with no second
 * round trip; with several, the page lists them and the person picks one.
 */
function findOrders_(query) {
  var q = String(query == null ? '' : query).trim();
  if (!q) throw new Error('Enter a quotation number, phone number or customer name.');
  var sheet = getSheet();
  var exact = findRowByTrackerId(sheet, q);
  if (exact !== -1) {
    var id = String(sheet.getRange(exact, getHeaderIndex('Tracker ID')).getValue());
    return { matches: [], order: lookupOrder_(id), total: 1 };
  }
  var last = getLastOrderRow_(sheet);
  if (last < 2) return { matches: [], total: 0 };
  var n = last - 1;
  var col = function (h) { return sheet.getRange(2, getHeaderIndex(h), n, 1).getValues(); };
  var ids = col('Tracker ID'), inst = col('Institution / Customer'), phones = col('Customer Phone Number'),
      dates = col('Date Logged'), st = col('Status'), ds = col('Delivery Status'), tot = col('Total Order Value'),
      creNames = col('CRE Name');

  var lower = q.toLowerCase().replace(/\s+/g, ' ');
  var digits = q.replace(/\D/g, '');
  var nameish = /[a-z]/i.test(q) && lower.length >= 2;
  var hits = [];
  for (var i = 0; i < n; i++) {
    var id = String(ids[i][0] || '').trim();
    if (!id) continue;
    var why = '';
    if (id.toLowerCase().indexOf(lower) !== -1) why = 'Quotation no.';
    else if (digits.length >= 4 && !nameish && String(phones[i][0] || '').replace(/\D/g, '').indexOf(digits) !== -1) why = 'Phone';
    else if (nameish && String(inst[i][0] || '').toLowerCase().replace(/\s+/g, ' ').indexOf(lower) !== -1) why = 'Name';
    if (!why) continue;
    hits.push({
      trackerId: id, institution: String(inst[i][0] || ''), phone: String(phones[i][0] || ''),
      status: String(st[i][0] || ''), deliveryStatus: String(ds[i][0] || ''), total: Number(tot[i][0]) || 0,
      cre: String(creNames[i][0] || ''), matchedOn: why,
      dateLoggedMs: dates[i][0] instanceof Date ? dates[i][0].getTime() : 0
    });
  }
  // A number that matches quotation numbers shouldn't also drag in every phone
  // number that happens to contain it (same rule the lookup always had).
  if (hits.some(function (h) { return h.matchedOn === 'Quotation no.'; })) {
    hits = hits.filter(function (h) { return h.matchedOn !== 'Phone'; });
  }
  hits.sort(function (a, b) { return b.dateLoggedMs - a.dateLoggedMs; });
  if (hits.length === 1) return { matches: [], order: lookupOrder_(hits[0].trackerId), total: 1 };
  return { matches: hits.slice(0, 30), total: hits.length };
}

/**
 * Every order the signed-in CRE owns (Admins: every order), for the tile
 * pop-up on the CRE page. Each row carries the same flags the stat tiles
 * count with (see getCreSummary_), so clicking a tile shows exactly the
 * orders behind its number.
 */
function getMyOrders_() {
  var sheet = getSheet();
  var last = getLastOrderRow_(sheet);
  if (last < 2) return [];
  var n = last - 1;
  var col = function (h) { return sheet.getRange(2, getHeaderIndex(h), n, 1).getValues(); };
  var ids = col('Tracker ID'), inst = col('Institution / Customer'), phones = col('Customer Phone Number'),
      dates = col('Date Logged'), st = col('Status'), ds = col('Delivery Status'), tot = col('Total Order Value'),
      adv = col('Advance Received'), pri = col('Priority Level'), terms = col('Payment Terms Type');
  var owners = readOrderOwners_(sheet, n);
  var scope = creScope_();
  var tz = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 6);
  weekAgo.setHours(0, 0, 0, 0);
  var out = [];
  for (var i = 0; i < n; i++) {
    var id = String(ids[i][0] || '').trim();
    if (!id) continue;
    if (scope && owners[i] !== scope.me.code) continue;
    var status = String(st[i][0] || ''), dstat = String(ds[i][0] || '');
    var closed = isDispatchedStatus_(status) && (dstat === 'Delivered' || dstat === 'Returned');
    var logged = dates[i][0] instanceof Date ? dates[i][0] : null;
    out.push({
      trackerId: id, institution: String(inst[i][0] || ''), phone: String(phones[i][0] || ''),
      status: status, deliveryStatus: dstat, total: Number(tot[i][0]) || 0,
      balance: computeBalanceDue(tot[i][0], adv[i][0]), priority: String(pri[i][0] || 'Normal'),
      paymentTerms: String(terms[i][0] || 'End Customer'),
      dateLoggedMs: logged ? logged.getTime() : 0,
      // same rules as getCreSummary_ -- tile number and pop-up always agree
      loggedToday: !!logged && Utilities.formatDate(logged, tz, 'yyyy-MM-dd') === todayStr,
      loggedThisWeek: !!logged && logged >= weekAgo,
      highPending: String(pri[i][0]) === 'High' && !closed,
      awaitingDelivery: isDispatchedStatus_(status) && dstat !== 'Delivered' && dstat !== 'Returned',
      inTransit: dstat === 'In Transit'
    });
  }
  out.sort(function (a, b) { return b.dateLoggedMs - a.dateLoggedMs; });
  return out;
}