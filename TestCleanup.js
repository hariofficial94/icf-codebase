/**
 * DELETE TEST ENTRIES (Oct 2026) -- ICF Admin menu
 * ---------------------------------------------------------------------
 * Hari tests with names like "Test Customer 2", "Test reference", "test12345".
 * This finds every order whose Tracker ID or Institution / Customer has a word
 * starting with "test" (so "Test", "test123", "Testing" -- but not "Contest"),
 * LISTS THEM and asks before touching anything. On Yes it:
 *   1. copies the full tracker rows to the "Deleted Test Orders" tab (a record,
 *      in case a real order was caught by mistake -- it can be pasted back);
 *   2. moves the order's files (Wrapper PO, gate pass, postal receipt, CRM PO,
 *      customer PO) to the Drive trash -- recoverable for 30 days;
 *   3. deletes those orders' rows from the Tracker and from every other tab
 *      that has a "Tracker ID" column (line items, standby, payment
 *      exceptions, cancellations, excess payments, access requests, activity
 *      log, notification log).
 */
var TEST_ARCHIVE_SHEET_NAME = 'Deleted Test Orders';
var TEST_MATCH_RE = /(^|[^a-z0-9])test/i;
var TEST_FILE_COLS = ['Wrapper PO PDF URL', 'Gate Pass PDF URL', 'Postal Receipt URL', 'CRM PO URL', 'Customer PO URL'];

function deleteTestEntries() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var tracker = getSheet();
  var last = getLastOrderRow_(tracker);
  if (last < 2) { ui.alert('Delete test entries', 'There are no orders in the tracker.', ui.ButtonSet.OK); return; }

  var data = tracker.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var idCol = HEADERS.indexOf('Tracker ID'), instCol = HEADERS.indexOf('Institution / Customer');
  var hits = [];
  data.forEach(function (r, i) {
    var id = String(r[idCol] || '').trim();
    if (!id) return;
    if (TEST_MATCH_RE.test(id) || TEST_MATCH_RE.test(String(r[instCol] || ''))) hits.push({ row: i + 2, id: id, inst: String(r[instCol] || ''), values: r });
  });
  if (!hits.length) { ui.alert('Delete test entries', 'No orders with "test" in the quotation no. or customer name.', ui.ButtonSet.OK); return; }

  var list = hits.slice(0, 40).map(function (h) { return '• ' + h.id + (h.inst && h.inst !== h.id ? '  (' + h.inst + ')' : ''); }).join('\n') +
    (hits.length > 40 ? '\n… and ' + (hits.length - 40) + ' more' : '');
  var answer = ui.alert('Delete ' + hits.length + ' test order' + (hits.length === 1 ? '' : 's') + '?',
    list + '\n\nThese orders, their rows in every other tab and their files will be removed. ' +
    'The tracker rows are copied to the "' + TEST_ARCHIVE_SHEET_NAME + '" tab first; files go to the Drive trash (30 days).\n\n' +
    'Check the list – is every one of these a test?', ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) { ui.alert('Delete test entries', 'Nothing was deleted.', ui.ButtonSet.OK); return; }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { ui.alert('Delete test entries', 'The tracker is busy – try again in a minute. Nothing was deleted.', ui.ButtonSet.OK); return; }
  var ids = {}, filesTrashed = 0, otherRows = 0, report = [];
  try {
    // Re-read: rows may have moved while the dialog was open.
    last = getLastOrderRow_(tracker);
    data = tracker.getRange(2, 1, last - 1, HEADERS.length).getValues();
    var wanted = {};
    hits.forEach(function (h) { wanted[h.id.toLowerCase()] = true; });
    var rows = [];
    data.forEach(function (r, i) {
      var id = String(r[idCol] || '').trim();
      if (id && wanted[id.toLowerCase()]) { rows.push({ row: i + 2, id: id, values: r }); ids[id.toLowerCase()] = true; }
    });

    // 1. Archive
    var arch = ss.getSheetByName(TEST_ARCHIVE_SHEET_NAME);
    if (!arch) {
      arch = ss.insertSheet(TEST_ARCHIVE_SHEET_NAME, ss.getNumSheets()); // at the end -- the Tracker must stay first
      arch.getRange(1, 1, 1, HEADERS.length + 1).setValues([['Deleted At'].concat(HEADERS)]).setFontWeight('bold');
      arch.setFrozenRows(1);
    }
    if (arch.getMaxColumns() < HEADERS.length + 1) arch.insertColumnsAfter(arch.getMaxColumns(), HEADERS.length + 1 - arch.getMaxColumns());
    var now = new Date();
    if (rows.length) {
      arch.getRange(arch.getLastRow() + 1, 1, rows.length, HEADERS.length + 1)
        .setValues(rows.map(function (x) { return [now].concat(x.values.map(function (v) { return v === null ? '' : v; })); }));
    }

    // 2. Files to the Drive trash
    rows.forEach(function (x) {
      TEST_FILE_COLS.forEach(function (c) {
        var url = String(x.values[HEADERS.indexOf(c)] || '');
        var m = url.match(/\/d\/([A-Za-z0-9_-]+)/) || url.match(/[?&]id=([A-Za-z0-9_-]+)/);
        if (!m) return;
        try { DriveApp.getFileById(m[1]).setTrashed(true); filesTrashed++; } catch (e) { Logger.log('Could not trash ' + url + ': ' + e); }
      });
    });

    // 3a. Tracker rows, bottom up
    rows.sort(function (a, b) { return b.row - a.row; }).forEach(function (x) { tracker.deleteRow(x.row); });

    // 3b. Every other tab with a "Tracker ID" column
    ss.getSheets().forEach(function (sh) {
      var name = sh.getName();
      if (sh.getSheetId() === tracker.getSheetId() || name === TEST_ARCHIVE_SHEET_NAME || name === PINCODE_DIRECTORY_SHEET_NAME) return;
      var lr = sh.getLastRow(), lc = sh.getLastColumn();
      if (lr < 2 || lc < 1) return;
      var hdr = sh.getRange(1, 1, 1, lc).getDisplayValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
      var c = hdr.indexOf('tracker id');
      if (c === -1) return;
      var vals = sh.getRange(2, c + 1, lr - 1, 1).getDisplayValues();
      var del = [];
      vals.forEach(function (v, i) { if (ids[String(v[0]).trim().toLowerCase()]) del.push(i + 2); });
      // Delete in runs of consecutive rows, bottom up.
      for (var k = del.length - 1; k >= 0;) {
        var end = del[k], start = end;
        while (k - 1 >= 0 && del[k - 1] === start - 1) { k--; start--; }
        sh.deleteRows(start, end - start + 1);
        k--;
      }
      if (del.length) { otherRows += del.length; report.push(name + ': ' + del.length); }
    });
  } finally {
    lock.releaseLock();
  }
  var cache = CacheService.getScriptCache();
  cache.remove('gate_overdue');
  var msg = 'Deleted ' + Object.keys(ids).length + ' test order(s). ' + filesTrashed + ' file(s) moved to the Drive trash. ' +
    otherRows + ' row(s) removed from other tabs' + (report.length ? ' (' + report.join(', ') + ')' : '') + '.\n\n' +
    'The tracker rows are kept in the "' + TEST_ARCHIVE_SHEET_NAME + '" tab – delete that tab whenever you like.';
  logActivity_({ code: 'SYSTEM', name: 'Delete test entries', role: '' }, 'Deleted test orders', '', Object.keys(ids).length + ' order(s)');
  ui.alert('Delete test entries', msg, ui.ButtonSet.OK);
}
