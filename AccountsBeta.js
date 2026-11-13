/**
 * ACCOUNTS BETA PAGE (13 Nov 2026) -- ?page=accounts-beta (accounts_beta.html)
 * ---------------------------------------------------------------------
 * Same look as the CRE beta. It opens on ONE "to do" queue: everything waiting
 * on Accounts, most urgent first, each item opening in a side drawer with its
 * action. The classic Accounts page is untouched. Since 13 Nov 2026 the beta
 * also covers what used to be classic-only: payment with excess, standby
 * (list, request, resume early), withdrawing a request, and verified-payments
 * history -- so the classic page can eventually be retired.
 *
 * This file only adds getAccountsQueue_: the whole queue in one call (one tracker
 * read plus the small request tabs), so the page loads in a single round trip.
 * Every action the drawer takes calls the SAME server functions as the classic
 * page (submitVerification, recordBalancePayment, submitDispatch,
 * markRefundProcessed, markFlipkartSettled, requestPaymentException,
 * markCrmPoPrinted), so the rules can't drift apart.
 */
function getAccountsQueue_() {
  var data = opsReadOrders_();
  var cfg = getAlertSettings_();
  var now = Date.now();
  var locks = (typeof pendingLockSet_ === 'function') ? pendingLockSet_() : {};
  var verify = [], held = [];
  data.rows.forEach(function (o) {
    var st = String(o.get('Status') || '');
    if (st === STATUS_HOLD_BALANCE) { // courier order verified, held until its balance comes in
      var hid = String(o.get('Tracker ID'));
      var bal = computeBalanceDue(Number(o.get('Total Order Value')) || 0, Number(o.get('Advance Received')) || 0);
      held.push({ trackerId: hid, institution: String(o.get('Institution / Customer') || ''), cre: String(o.get('CRE Name') || ''),
        balanceDue: bal, priority: normalizePriority_(o.get('Priority Level')), dispatchType: 'Courier',
        orderType: normalizeOrderType_(o.get('Order Type')), customerSaysPaid: String(o.get('Customer Says Paid') || ''),
        locked: locks[hid.toLowerCase()] || '' });
      return;
    }
    if (st !== 'Logged') return;
    var id = String(o.get('Tracker ID'));
    var docs = docsInfo_({ 'Status': 'Logged', 'Payment Terms Type': o.get('Payment Terms Type'),
      'CRM PO URL': o.get('CRM PO URL'), 'Customer PO URL': o.get('Customer PO URL'), 'CRM PO Printed': o.get('CRM PO Printed') });
    var loggedMs = opsMs_(o.get('Date Logged')) || 0;
    verify.push({
      trackerId: id, institution: String(o.get('Institution / Customer') || ''), cre: String(o.get('CRE Name') || ''),
      value: Number(o.get('Total Order Value')) || 0, advance: Number(o.get('Advance Received')) || 0,
      terms: String(o.get('Payment Terms Type') || 'End Customer'), priority: normalizePriority_(o.get('Priority Level')),
      dispatchType: normalizeDispatchType_(o.get('Dispatch Type')), orderType: normalizeOrderType_(o.get('Order Type')),
      loggedAt: opsFmt_(o.get('Date Logged')), loggedMs: loggedMs,
      officeMins: loggedMs ? officeMinutesBetween_(loggedMs, now, cfg) : 0,
      docsMissing: docs.missing.join(' and '), crmPrinted: !!docs.crmPrinted,
      customerSaysPaid: String(o.get('Customer Says Paid') || ''), locked: locks[id.toLowerCase()] || ''
    });
  });
  var safe = function (fn) { try { return fn(); } catch (e) { Logger.log('accounts queue: ' + e); return null; } };
  var fu = (typeof getFollowUpSettings_ === 'function') ? safe(getFollowUpSettings_) : null;
  return {
    verify: verify,
    held: held,
    standby: safe(getStandbyPanel_) || { items: [] },
    verifyRemindMins: fu ? fu.verifyRemindHours * 60 : 240,
    gatePasses: safe(getGatePassQueue_) || [],
    nudges: safe(getPaymentNudges_) || [],
    refunds: safe(getRefundsToProcess_) || [],
    flipkart: (typeof getFlipkartSettlements_ === 'function' ? safe(getFlipkartSettlements_) : null) || { items: [], total: 0 },
    approvals: safe(getPaymentApprovalsPanel_) || [],
    summary: safe(getAccountsSummary_) || {},
    classicUrl: (function () { var u = appUrl_(); return u ? u + '?page=accounts' : ''; })()
  };
}

function accountsBetaApiMap_() {
  return {
    getAccountsQueue: { fn: getAccountsQueue_, roles: ['Accounts'] }
  };
}
