/**
 * Owner dashboard -- new layout on trial (Oct 2026). Opened with ?page=dashboard-beta
 * (dashboard_beta.html). The classic dashboard (dashboard.html) is untouched.
 *
 * This file only adds:
 *   - DASH_TARGET_ROWS: department targets the beta measures against. They live in
 *     the Settings tab like every other setting and show on the Settings page under
 *     "Dashboard targets" (sbSettingsSchema_ in Standby.gs picks them up).
 *   - getDashboardBetaInfo_: the targets, the office hours (so the page can count
 *     office time the same way the alerts do) and the links the page needs.
 * The order data itself comes from getDashboardData_ (Code.gs), as for the
 * classic dashboard.
 */

// [label, default, explanation, min, max] -- the label is what the code looks up; don't rename it.
var DASH_TARGET_ROWS = [
  ['Dashboard target: Accounts verifies payment within (office hours)', '4', 'From the CRE logging the order to Accounts verifying the payment.', 1, 200],
  ['Dashboard target: Ops picks up within (office hours)', '9', 'From Accounts verifying to Ops acknowledging (picking up) the order. 9 office hours = one office day.', 1, 200],
  ['Dashboard target: Ops ready for the gate pass within (office hours)', '27', 'From Ops picking up to Ops asking Accounts for the gate pass. Standby and waiting for the customer’s payment are left out.', 1, 400],
  ['Dashboard target: Accounts issues the gate pass within (office hours)', '2', 'From Ops asking for the gate pass to Accounts issuing it.', 1, 200],
  ['Dashboard target: vehicle leaves the gate within (office hours)', '6', 'From the gate pass to the gate marking the vehicle out.', 1, 200],
  ['Dashboard target: on-time delivery (%)', '90', 'Share of delivered orders that reached the customer by their requested date.', 1, 100],
  ['Dashboard target: stuck at a stage after (days)', '3', 'An open order sitting this many days at one stage shows as stuck.', 1, 30]
];
var DASH_TARGET_KEYS = ['accVerify', 'opsPickup', 'opsReady', 'accGatePass', 'gateOut', 'onTimePct', 'stuckDays'];

/** Targets as { key: number }, defaults for anything missing or out of range. */
function dashTargets_() {
  var map = (typeof sbReadSettingsMap_ === 'function') ? sbReadSettingsMap_() : {};
  var out = {};
  DASH_TARGET_ROWS.forEach(function (r, i) {
    var raw = map[r[0].toLowerCase()];
    var v = Number(String(raw == null ? '' : raw).replace(/[,\s%]/g, ''));
    if (raw === undefined || raw === '' || isNaN(v) || v < r[3] || v > r[4]) v = Number(r[1]);
    out[DASH_TARGET_KEYS[i]] = v;
  });
  return out;
}

/** Director / Admin: what the beta dashboard needs besides the orders. */
function getDashboardBetaInfo_() {
  var cfg = getAlertSettings_();
  var url = appUrl_();
  var me = CURRENT_STAFF_ || {};
  return {
    targets: dashTargets_(),
    office: { openMin: cfg.openMin, closeMin: cfg.closeMin, workingDays: cfg.workingDays, holidays: cfg.holidays },
    urls: {
      rental: url ? url + '?page=rental' : '',
      settings: url ? url + '?page=settings' : '',
      classic: url ? url + '?page=dashboard' : ''
    },
    canEditSettings: me.role === 'Director' // the Settings page is Directors only
  };
}

function dashboardBetaApiMap_() {
  return {
    getDashboardBetaInfo: { fn: getDashboardBetaInfo_, roles: ['Director'] }
  };
}
