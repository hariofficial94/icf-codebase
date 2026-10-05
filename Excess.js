/**
 * EXCESS PAYMENTS (Oct 2026) -- the customer paid more than the order needs
 * ------------------------------------------------------------------------
 * Usually old dues from before this system (pre-system credit) arriving in
 * the same transfer. The system is order-based, so the extra must never
 * land on the order: the dashboard reads Advance Received as income.
 *
 * RULES
 *   - An order's Advance Received never goes above its Total Order Value.
 *     CRE intake, verification and balance payments all refuse more.
 *   - Accounts enters the full bank amount anyway: the Accounts page shows
 *     the split ("order Rs. X + excess Rs. Y") and sends the WHOLE entry to
 *     an admin as a payment exception of type PX_EXCESS, with the UTR and a
 *     note saying what the extra is for. Nothing is recorded yet.
 *   - On approval (applyExcessPayment_, called from decidePaymentException_):
 *       at "Logged"   -> the verification is completed in Accounts' name with
 *                        the order's share (= the order value), and
 *       afterwards    -> the balance payment is recorded with the order's
 *                        share (= what's still due, possibly 0),
 *     and the remainder goes to the "Excess Payments" tab (created on first
 *     use). The dashboard never reads that tab.
 *   - Declined -> nothing recorded; Accounts re-enters the right amount.
 */
var EXCESS_SHEET_NAME = 'Excess Payments';
// PX_EXCESS ('EXCESS_PAYMENT') is defined in Code.js beside the other request types.
var EXCESS_HEADERS = ['Request ID', 'Recorded At', 'Customer', 'Came With Order', 'Entered At', 'Bank Amount',
  'Applied To Order', 'Excess Amount', 'Bank Reference / UTR', 'What It Is For', 'Entered By', 'Approved By', 'Notes'];
// Set only while applyExcessPayment_ completes a verification, so "Verified By" names the Accounts person who entered it.
var VERIFY_AS_NAME_ = null;

function getOrCreateExcessSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(EXCESS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(EXCESS_SHEET_NAME);
    sheet.getRange(1, 1, 1, EXCESS_HEADERS.length).setValues([EXCESS_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    ensureColumns_(sheet, EXCESS_HEADERS.length);
  }
  return sheet;
}

function exRupees_(n) { return '\u20b9' + formatAmount(Math.round((Number(n) || 0) * 100) / 100); }

/**
 * Works out the split for an excess entry on this order as it stands now.
 * Returns { stage: 'verification'|'balance', share, excess, total, advance, balance, institution }.
 * Throws if there's no excess (then it's a normal entry, no approval needed).
 */
function excessSplit_(sheet, row, amount) {
  var d = getRowFields(sheet, row, ['Tracker ID', 'Institution / Customer', 'Status', 'Total Order Value', 'Advance Received']);
  var total = Number(d['Total Order Value']) || 0;
  var advance = Number(d['Advance Received']) || 0;
  amount = Math.round(Number(amount) * 100) / 100;
  if (d['Status'] === 'Logged') {
    if (!(total > 0) || amount <= total) {
      throw new Error('That isn\u2019t more than the order value (' + exRupees_(total) + ') \u2013 verify it the normal way.');
    }
    return { stage: 'verification', share: total, excess: Math.round((amount - total) * 100) / 100, total: total, advance: advance, balance: total,
             institution: String(d['Institution / Customer'] || ''), trackerId: String(d['Tracker ID']) };
  }
  var balance = computeBalanceDue(total, advance);
  if (amount <= balance + BALANCE_DUE_TOLERANCE) {
    throw new Error('That isn\u2019t more than the balance due (' + exRupees_(balance) + ') \u2013 record it as a normal payment.');
  }
  return { stage: 'balance', share: balance, excess: Math.round((amount - balance) * 100) / 100, total: total, advance: advance, balance: balance,
           institution: String(d['Institution / Customer'] || ''), trackerId: String(d['Tracker ID']) };
}

/** Validates an excess request (called by requestPaymentException_). Returns the amount note to store. */
function prepareExcessRequest_(sheet, row, form) {
  var amount = Number(String(form.amountReceived == null ? '' : form.amountReceived).replace(/[,\s\u20b9]/g, ''));
  if (!amount || isNaN(amount) || amount <= 0) throw new Error('Enter the full amount the bank shows.');
  var utr = String(form.bankReference || '').trim();
  if (!utr) throw new Error('Enter the Bank Reference / UTR No. for this payment.');
  var s = excessSplit_(sheet, row, amount);
  return {
    amount: Math.round(amount * 100) / 100, utr: utr,
    amountNote: 'Bank shows ' + exRupees_(amount) + ' \u2192 this order ' + exRupees_(s.share) + ' + excess ' + exRupees_(s.excess) +
      (s.stage === 'verification' ? ' (at verification; order ' + exRupees_(s.total) + ')' : ' (balance payment; balance was ' + exRupees_(s.balance) + ')') +
      ', UTR ' + utr
  };
}

/**
 * On approval: records the order's share the normal way and the rest in the
 * Excess Payments tab. Called inside decidePaymentException_'s lock, before
 * the request is marked Approved -- if anything here fails, nothing is marked.
 */
function applyExcessPayment_(r, me) {
  var sheet = getSheet();
  var row = resolveTrackerId(sheet, r.trackerId);
  if (row === -1) throw new Error('Order not found.');
  if (!(r.amountReceived > 0) || !r.bankReference) throw new Error('This request has no amount or UTR on it.');
  var s = excessSplit_(sheet, row, r.amountReceived); // recomputed now: the order may have changed since the request
  LOCK_SKIP_REQUEST_ID_ = r.requestId; // this request is still "Pending" until applied -- let its own steps through
  try {
  var requester = getStaffMap_(false)[r.requestedBy];
  var ref = r.bankReference + ' (incl. excess ' + exRupees_(s.excess) + ', ' + r.requestId + ')';
  var out = { stage: s.stage, share: s.share, excess: s.excess };

  if (s.stage === 'verification') {
    // submitVerification_ treats "logged 0, bank shows X" as a new payment and
    // records X as the advance -- exactly what's wanted for the order's share.
    // Clear the logged figure first (it may be wrong; the admin approved the
    // bank amount) and put it back if verification refuses for any reason.
    var prevAdvance = getRowFields(sheet, row, ['Advance Received'])['Advance Received'];
    setRowFields(sheet, row, { 'Advance Received': 0 });
    VERIFY_AS_NAME_ = requester ? requester.name : r.requestedByName;
    try {
      var v = submitVerification_({ trackerId: s.trackerId, amountReceived: s.share, bankReference: ref });
      out.verificationCode = v.verificationCode;
      out.heldForBalance = v.heldForBalance;
      out.dispatchType = v.dispatchType;
    } catch (e) {
      setRowFields(sheet, row, { 'Advance Received': prevAdvance });
      throw e;
    } finally {
      VERIFY_AS_NAME_ = null;
    }
  } else if (s.share > 0) {
    var b = recordBalancePayment_({ trackerId: s.trackerId, amountReceived: s.share, bankReference: ref });
    out.releasedToOps = b.releasedToOps;
  }
  } finally {
    LOCK_SKIP_REQUEST_ID_ = null;
  }

  getOrCreateExcessSheet_().appendRow([
    r.requestId, new Date(), s.institution, s.trackerId, r.requestedAtMs ? new Date(r.requestedAtMs) : '',
    r.amountReceived, s.share, s.excess, r.bankReference, r.reason,
    r.requestedByName + ' (' + r.requestedBy + ')', me.name + ' (' + me.code + ')',
    s.stage === 'verification' ? 'Entered at payment verification' : 'Entered as a balance payment'
  ]);
  logActivity_(me, 'Excess payment recorded', s.trackerId, r.requestId + ' \u2013 order ' + exRupees_(s.share) + ', excess ' + exRupees_(s.excess) + ' (' + r.reason + ')');
  return out;
}

/**
 * Accounts page: what an approved excess payment on this order did, so the
 * person can see the split and (if it completed the verification) the
 * Verification Code to write on the PO. Accounts-only (see excessApiMap_):
 * the code isn't part of the general lookup, which the CRE page also uses.
 */
function getExcessOutcome_(trackerId) {
  var r = latestPaymentException_(trackerId, PX_EXCESS);
  if (!r || r.status !== 'Approved') return { found: false };
  var out = { found: true, requestId: r.requestId, decidedBy: r.decidedBy, share: null, excess: null, verificationCode: '' };
  var sheet = getOrCreateExcessSheet_();
  var last = sheet.getLastRow();
  if (last >= 2) {
    var rows = sheet.getRange(2, 1, last - 1, EXCESS_HEADERS.length).getValues();
    for (var i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][0]) === r.requestId) {
        out.share = Number(rows[i][6]) || 0;
        out.excess = Number(rows[i][7]) || 0;
        out.atVerification = /verification/i.test(String(rows[i][12] || ''));
        break;
      }
    }
  }
  if (out.atVerification) {
    var tSheet = getSheet();
    var row = findRowByTrackerId(tSheet, r.trackerId);
    if (row !== -1) out.verificationCode = String(getRowFields(tSheet, row, ['Verification Code'])['Verification Code'] || '');
  }
  return out;
}

/** Merged into apiMap_() like standbyApiMap_(). */
function excessApiMap_() {
  return { getExcessOutcome: { fn: getExcessOutcome_, roles: ['Accounts'] } };
}