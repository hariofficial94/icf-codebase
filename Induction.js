/**
 * CRE INDUCTION (Nov 2026)
 * ---------------------------------------------------------------------
 * Every new CRE goes through a 60-day induction inside the tracker tool.
 *
 *   Day 1      First sign-in: a welcome screen they must acknowledge. It sets
 *              out the 60-day plan and says plainly that there is an
 *              assessment around day 30 with an 80% pass mark.
 *   Days 1-30  Phase 1 "Learn": a checklist (Induction Plan tab). Some items
 *              the CRE ticks themselves; practical ones (shadowing, practice
 *              orders) need an Admin's sign-off.
 *   Day ~28    The assessment unlocks (TEST_OPENS_DAY). Timed, questions drawn
 *              at random across sections from the Question Bank tab, scored on
 *              the server -- the correct answers never reach the browser.
 *              The CRE sees their overall % and section scores at once, but not
 *              which answers were right (so the bank survives the retake).
 *   Below 80%  One retake, RETAKE_GAP_DAYS after the first attempt, drawn from
 *              questions not seen the first time where possible. The questions
 *              they got wrong point to plan items, shown as "revise these".
 *              A second result below 80% goes to the directors for the salary
 *              review (email to Directors + Admins). The system only flags it;
 *              the decision is the directors'. The Admin records the outcome.
 *   Days 31-60 Phase 2 "Perform": independent work + weekly reviews.
 *   Day 60     Checkpoint: a scorecard built from the CRE's own orders in the
 *              tracker, plus the Admin's rating and note. It only triggers a
 *              conversation -- never a salary review (Hari, 6 Nov 2026).
 *
 * WHO IS ENROLLED
 *   - Automatically: a CRE signing in for the very first time (blank "Last
 *     Sign-in" on the Staff tab), with today as the join date.
 *   - By an Admin (Admin page -> CRE induction -> Enrol), with the real join
 *     date -- for someone already working (e.g. Amrutha). If day 28 has
 *     already passed, the test opens LATE_ENROL_DAYS after enrolment instead,
 *     so they have time to cover the plan first.
 *   Existing CREs who have signed in before are never auto-enrolled.
 *
 * TRAINING VIDEOS (Nov 2026): Greeshma's videos, uploaded to YouTube as
 * UNLISTED (embedding left on). Listed in the "Training Videos" tab; every CRE
 * sees the library ("For" = All) and trainees also see "Induction" ones. They
 * play in a pop-up on the CRE page; the page reports how far they got and a
 * video counts as watched at 90%. When every video linked to a Self checklist
 * item is watched, that item ticks itself.
 *
 * DIRECTORS see an Induction section on the Owner Dashboard (beta) and record
 * their own decision there after a below-80% retake.
 *
 * TABS (created on first use; the plan and the bank are seeded with a
 * starter set that Hari replaces -- Greeshma validates the questions):
 *   "Induction"          one row per trainee
 *   "Induction Plan"     the checklist (edit freely; Item IDs must stay unique)
 *   "Induction Progress" one row per trainee per ticked / signed-off item
 *   "Question Bank"      the questions WITH answers -- protect this tab
 *   "Induction Tests"    one row per attempt
 *   "Induction Answers"  one row per question per attempt
 */
var IND_SHEET_NAME = 'Induction';
var IND_PLAN_SHEET_NAME = 'Induction Plan';
var IND_PROGRESS_SHEET_NAME = 'Induction Progress';
var IND_QB_SHEET_NAME = 'Question Bank';
var IND_TESTS_SHEET_NAME = 'Induction Tests';
var IND_ANSWERS_SHEET_NAME = 'Induction Answers';
var IND_VIDEOS_SHEET_NAME = 'Training Videos';
var IND_VPROG_SHEET_NAME = 'Video Progress';
var IND_VIDEO_HEADERS = ['Video ID', 'Title', 'Section', 'Order', 'YouTube Link', 'Minutes', 'Plan Item', 'For', 'Active'];
var IND_VPROG_HEADERS = ['Staff Code', 'Video ID', 'First Opened', 'Last Opened', 'Opens', 'Max %', 'Watched At'];
var IND_WATCHED_PCT = 90;
var IND_SEED_VIDEOS = [
  ['V01', 'Example \u2013 replace with Greeshma\u2019s first video', 'Company', 1, 'https://youtu.be/XXXXXXXXXXX', 10, 'P1-03', 'All', 'N']
];

// Rules -- change here (move to the Settings page later if they need tuning often).
var IND_CFG = {
  totalDays: 60,
  phase1Days: 30,
  testOpensDay: 28,      // the assessment unlocks on this day of induction
  lateEnrolDays: 14,     // enrolled after day 28 -> test opens this many days after enrolment
  passPct: 80,
  durationMin: 30,
  questionsPerTest: 25,
  retakeGapDays: 15,
  maxAttempts: 2,        // first attempt + one retake; an Admin can allow more
  graceMin: 2            // a late submit is still accepted this long after time is up
};

var IND_HEADERS = ['Staff Code', 'Staff Name', 'Join Date', 'Enrolled At', 'Enrolled By', 'Welcome Seen At',
  'Test Opens On', 'Retake Opens On', 'Extra Attempts', 'Status', 'Attempts', 'Best Score %', 'Last Score %',
  'Director Review', 'Director Review By', 'Director Review At',
  'Day-60 Rating', 'Day-60 Note', 'Day-60 By', 'Day-60 At', 'History'];
var IND_PLAN_HEADERS = ['Item ID', 'Phase', 'Week', 'Title', 'What to do', 'Type', 'Link', 'Sign-off', 'Active'];
var IND_PROGRESS_HEADERS = ['Staff Code', 'Item ID', 'Status', 'Done At', 'Signed Off By', 'Signed Off At', 'Note'];
var IND_QB_HEADERS = ['Q ID', 'Section', 'Type', 'Question', 'A', 'B', 'C', 'D', 'Correct', 'Marks', 'Plan Item', 'Active', 'Validated By'];
var IND_TEST_HEADERS = ['Attempt ID', 'Staff Code', 'Staff Name', 'Attempt No', 'Started At', 'Deadline', 'Submitted At',
  'Question IDs', 'Draft Answers', 'Score', 'Max', 'Percent', 'Section Scores', 'Pending Marking', 'Result', 'Marked By', 'Marked At'];
var IND_ANSWER_HEADERS = ['Attempt ID', 'Staff Code', 'Q ID', 'Section', 'Type', 'Answer', 'Correct', 'Marks', 'Max Marks'];

var IND_SECTIONS = ['Products', 'Order flow & tracker', 'Payments & Accounts', 'CRM', 'Customer communication', 'Policies'];
var IND_TYPES = ['MCQ', 'True/False', 'Short'];

var IND_ST_ACTIVE = 'In induction';
var IND_ST_PASSED = 'Passed';
var IND_ST_RETAKE = 'Retake due';
var IND_ST_MARKING = 'Awaiting marking';
var IND_ST_REVIEW = 'Below 80% – director review';
var IND_ST_REVIEWED = 'Director review done';
var IND_ST_REMOVED = 'Removed';

// ---------------- Starter content (Hari replaces; seeded only when a tab is first created) ----------------
var IND_SEED_PLAN = [
  // [Item ID, Phase, Week, Title, What to do, Type, Link, Sign-off]
  ['P1-01', 1, 1, 'Welcome meeting', 'Meet Ananthu (and Sambhu if available): your role, who does what at ICF, how your work is judged.', 'Meet', '', 'Admin'],
  ['P1-02', 1, 1, 'Factory walk-through', 'See each product line being made and stored: bio-toilets, underground STPs, portable site cabins, container boxes, Bio Bacteria.', 'Shadow', '', 'Admin'],
  ['P1-03', 1, 1, 'Company and product videos', 'Watch the knowledge-management videos on ICF and the product range.', 'Watch', '', 'Self'],
  ['P1-04', 1, 1, 'Product catalogue and price list', 'Read the catalogue and price list. Note which products go by vehicle and which by courier.', 'Read', '', 'Self'],
  ['P1-05', 1, 1, 'Your tracker login', 'Change your PIN. Walk through the CRE page: My orders, Payments, Requests, New PO, Rentals.', 'Do', '', 'Self'],
  ['P1-06', 1, 2, 'Shadow Greeshma on calls', 'Sit with Greeshma for at least three days of enquiries, quotations and follow-ups.', 'Shadow', '', 'Admin'],
  ['P1-07', 1, 2, 'How an order moves', 'CRE logs the PO -> Accounts verifies payment -> Ops acknowledges and prepares -> Accounts issues the gate pass -> Gate marks it out -> CRE updates delivery.', 'Read', '', 'Self'],
  ['P1-08', 1, 2, 'Payment terms', 'End customer vs PO customer, advance %, balance before dispatch, "balance after delivery" (needs admin approval).', 'Read', '', 'Self'],
  ['P1-09', 1, 2, 'CRM basics', 'In the CRM: create a lead, a quotation and a PO. Download the CRM PO you will upload to the tracker.', 'Do', '', 'Admin'],
  ['P1-10', 1, 3, 'Practice orders', 'Log three practice orders named "Test Customer ..." with the CRM PO uploaded. Ask the admin to delete them afterwards.', 'Do', '', 'Admin'],
  ['P1-11', 1, 3, 'Order types', 'Standard, DACC (Delivery Against Consignor’s Copy) and Flipkart orders: when each is used and what you do.', 'Read', '', 'Self'],
  ['P1-12', 1, 3, 'Standby, cancellation and returns', 'When to ask for standby, when a cancellation can be requested (before dispatch only), how to raise a return.', 'Read', '', 'Self'],
  ['P1-13', 1, 3, 'Rentals', 'How a rental enquiry becomes a rental, and what you record.', 'Read', '', 'Self'],
  ['P1-14', 1, 4, 'Live calls with support', 'Handle live calls yourself with Greeshma listening in. Ask for feedback each day.', 'Shadow', '', 'Admin'],
  ['P1-15', 1, 4, 'Follow-ups and delivery updates', 'Set next follow-up dates on pending balances. Update delivery status on dispatched orders.', 'Do', '', 'Self'],
  ['P2-01', 2, 5, 'Own your leads and orders', 'From now on you handle your enquiries and orders independently.', 'Do', '', 'Self'],
  ['P2-02', 2, 5, 'Weekly review – week 5', 'Review your orders, follow-ups and open issues with Ananthu.', 'Meet', '', 'Admin'],
  ['P2-03', 2, 6, 'Weekly review – week 6', 'Review with Ananthu.', 'Meet', '', 'Admin'],
  ['P2-04', 2, 7, 'Handle an escalation end to end', 'Take one customer complaint from first call to closure, with Greeshma available for help.', 'Do', '', 'Admin'],
  ['P2-05', 2, 7, 'Weekly review – week 7', 'Review with Ananthu.', 'Meet', '', 'Admin'],
  ['P2-06', 2, 8, 'Day-60 review conversation', 'Go through your day-60 scorecard with Ananthu.', 'Meet', '', 'Admin']
];
var IND_SEED_QB = [
  // [Q ID, Section, Type, Question, A, B, C, D, Correct, Marks, Plan Item]
  ['Q001', 'Order flow & tracker', 'MCQ', 'Which document must be uploaded before Accounts can verify an order?', 'The CRM PO', 'The gate pass', 'The e-way bill', 'The Wrapper PO', 'A', 1, 'P1-10'],
  ['Q002', 'Policies', 'MCQ', 'What is the minimum advance for a DACC order?', '25%', '50%', '75%', '100%', 'B', 1, 'P1-11'],
  ['Q003', 'Policies', 'MCQ', 'Who decides a cancellation request?', 'Accounts', 'Ops', 'An Admin', 'The Gate', 'C', 1, 'P1-12'],
  ['Q004', 'Policies', 'True/False', 'A CRE can request a cancellation after the order has been dispatched.', '', '', '', '', 'False', 1, 'P1-12'],
  ['Q005', 'Order flow & tracker', 'True/False', 'Flipkart orders go to Ops without Accounts verification.', '', '', '', '', 'True', 1, 'P1-11'],
  ['Q006', 'Order flow & tracker', 'MCQ', 'How must practice or test orders be named in the tracker?', '"Demo ..."', '"Test Customer ..."', '"Sample ..."', 'Any name, then tell the admin', 'B', 1, 'P1-10'],
  ['Q007', 'Order flow & tracker', 'MCQ', 'Who marks a vehicle as out at the gate?', 'The CRE', 'Accounts', 'Ops', 'The Gate (Sanju)', 'D', 1, 'P1-07'],
  ['Q008', 'Payments & Accounts', 'MCQ', 'In a DACC order, what does the CRE do once the balance is paid and Accounts has verified it?', 'Nothing', 'Emails the transporter to release the goods', 'Raises a return', 'Asks Ops for a new gate pass', 'B', 1, 'P1-11'],
  ['Q009', 'Order flow & tracker', 'MCQ', 'What does a red sticker on an order mean?', 'Normal priority', 'Medium priority', 'High priority', 'Payment pending', 'C', 1, 'P1-07'],
  ['Q010', 'Customer communication', 'Short', 'In two or three sentences, explain to a customer what a DACC order means for them.', '', '', '', '', '', 2, 'P1-11']
];

// ================================================================
// Tabs
// ================================================================
function indTab_(name, headers, seed) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name, ss.getNumSheets());
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    if (seed && seed.length) {
      var rows = seed.map(function (r) {
        var out = headers.map(function () { return ''; });
        for (var i = 0; i < r.length && i < headers.length; i++) out[i] = r[i];
        return out;
      });
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
  } else {
    ensureColumns_(sheet, headers.length);
  }
  return sheet;
}
function indSheet_() { return indTab_(IND_SHEET_NAME, IND_HEADERS); }
function indPlanSheet_() {
  return indTab_(IND_PLAN_SHEET_NAME, IND_PLAN_HEADERS, IND_SEED_PLAN.map(function (r) { return r.concat(['Y']); }));
}
function indProgressSheet_() { return indTab_(IND_PROGRESS_SHEET_NAME, IND_PROGRESS_HEADERS); }
function indQbSheet_() {
  return indTab_(IND_QB_SHEET_NAME, IND_QB_HEADERS, IND_SEED_QB.map(function (r) { return r.concat(['Y', '']); }));
}
function indTestsSheet_() { return indTab_(IND_TESTS_SHEET_NAME, IND_TEST_HEADERS); }
function indAnswersSheet_() { return indTab_(IND_ANSWERS_SHEET_NAME, IND_ANSWER_HEADERS); }
function indVideosSheet_() { return indTab_(IND_VIDEOS_SHEET_NAME, IND_VIDEO_HEADERS, IND_SEED_VIDEOS); }
function indVProgSheet_() { return indTab_(IND_VPROG_SHEET_NAME, IND_VPROG_HEADERS); }

// ================================================================
// Training videos
// ================================================================
/** The 11-character YouTube id from any usual link (youtu.be, watch?v=, embed, shorts) or a bare id. */
function indYoutubeId_(link) {
  var s = String(link || '').trim();
  var m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : '';
}
function indVideos_() {
  return indRows_(indVideosSheet_(), IND_VIDEO_HEADERS)
    .filter(function (r) { return String(r['Video ID']).trim() && String(r['Active']).trim().toUpperCase() !== 'N'; })
    .map(function (r) {
      return {
        id: String(r['Video ID']).trim(), title: String(r['Title'] || '').trim(), section: String(r['Section'] || 'General').trim() || 'General',
        order: Number(r['Order']) || 999, yt: indYoutubeId_(r['YouTube Link']), minutes: Number(r['Minutes']) || null,
        planItem: String(r['Plan Item'] || '').trim(), forInduction: /induction/i.test(String(r['For'] || ''))
      };
    })
    .filter(function (v) { return v.yt; })
    .sort(function (a, b) { return a.order - b.order || (a.title < b.title ? -1 : 1); });
}
function indVProg_(code) {
  var all = indRows_(indVProgSheet_(), IND_VPROG_HEADERS);
  if (!code) return all;
  code = String(code).toUpperCase();
  return all.filter(function (r) { return String(r['Staff Code']).toUpperCase() === code; });
}
/** Videos this person may see, with their progress. Trainees see "Induction" ones too. */
function indVideosFor_(code, isTrainee) {
  var prog = {};
  indVProg_(code).forEach(function (p) { prog[String(p['Video ID'])] = p; });
  return indVideos_().filter(function (v) { return isTrainee || !v.forInduction; }).map(function (v) {
    var p = prog[v.id];
    return { id: v.id, title: v.title, section: v.section, yt: v.yt, minutes: v.minutes, planItem: v.planItem,
      pct: p ? Number(p['Max %']) || 0 : 0, watched: !!(p && p['Watched At']), opened: !!p };
  });
}

/** The CRE page reports progress while a video plays: { videoId, pct, opened }. */
function indVideoProgress_(form) {
  form = form || {};
  var me = indMe_();
  var v = indVideos_().filter(function (x) { return x.id === String(form.videoId || ''); })[0];
  if (!v) throw new Error('That video is no longer in the library.');
  var pct = Math.max(0, Math.min(100, Math.round(Number(form.pct) || 0)));
  var lock = indLock_();
  var nowWatched = false;
  try {
    var sheet = indVProgSheet_();
    var p = indVProg_(me.code).filter(function (r) { return String(r['Video ID']) === v.id; })[0];
    if (!p) {
      nowWatched = pct >= IND_WATCHED_PCT;
      indAppend_(sheet, IND_VPROG_HEADERS, { 'Staff Code': me.code, 'Video ID': v.id, 'First Opened': new Date(), 'Last Opened': new Date(),
        'Opens': 1, 'Max %': pct, 'Watched At': nowWatched ? new Date() : '' });
    } else {
      var f = {};
      if (form.opened) { f['Last Opened'] = new Date(); f['Opens'] = (Number(p['Opens']) || 0) + 1; }
      if (pct > (Number(p['Max %']) || 0)) f['Max %'] = pct;
      if (!p['Watched At'] && pct >= IND_WATCHED_PCT) { f['Watched At'] = new Date(); nowWatched = true; }
      if (Object.keys(f).length) indWrite_(sheet, IND_VPROG_HEADERS, p.row, f);
    }
    if (nowWatched && v.planItem) indAutoTickFromVideos_(me.code, v.planItem);
  } finally { lock.releaseLock(); }
  return { videoId: v.id, watched: nowWatched || undefined, pct: pct };
}

/** All videos of a Self checklist item watched -> the item is done. */
function indAutoTickFromVideos_(code, itemId) {
  if (!indTrainee_(code)) return;
  var item = indPlan_().filter(function (i) { return i.id === itemId; })[0];
  if (!item || item.signOff !== 'Self') return;
  var watched = {};
  indVProg_(code).forEach(function (p) { if (p['Watched At']) watched[String(p['Video ID'])] = true; });
  var vids = indVideos_().filter(function (v) { return v.planItem === itemId; });
  if (!vids.length || vids.some(function (v) { return !watched[v.id]; })) return;
  if (indProgress_(code).some(function (p) { return String(p['Item ID']) === itemId; })) return;
  indAppend_(indProgressSheet_(), IND_PROGRESS_HEADERS, { 'Staff Code': code, 'Item ID': itemId, 'Status': 'Done', 'Done At': new Date(), 'Note': 'All videos watched' });
}

function indRows_(sheet, headers) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, headers.length).getValues().map(function (r, i) {
    var o = { row: i + 2 };
    headers.forEach(function (h, j) { o[h] = r[j]; });
    return o;
  });
}
function indWrite_(sheet, headers, row, fields) {
  Object.keys(fields).forEach(function (k) {
    var c = headers.indexOf(k);
    if (c === -1) throw new Error('Unknown induction column: ' + k);
    sheet.getRange(row, c + 1).setValue(fields[k]);
  });
}
function indAppend_(sheet, headers, fields) {
  var vals = headers.map(function (h) { return fields[h] === undefined ? '' : fields[h]; });
  sheet.appendRow(vals);
}

// ---------------- Date helpers (IST, whole days) ----------------
function indTz_() { return Session.getScriptTimeZone(); }
function indYmd_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, indTz_(), 'yyyy-MM-dd');
  var s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function indToday_() { return Utilities.formatDate(new Date(), indTz_(), 'yyyy-MM-dd'); }
function indDate_(ymd) { var p = String(ymd).split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
function indAddDays_(ymd, n) { var d = indDate_(ymd); d.setDate(d.getDate() + n); return Utilities.formatDate(d, indTz_(), 'yyyy-MM-dd'); }
function indDaysBetween_(a, b) { return Math.round((indDate_(b).getTime() - indDate_(a).getTime()) / 86400000); }
function indFmt_(ymd) { return ymd ? Utilities.formatDate(indDate_(ymd), indTz_(), 'dd-MMM-yyyy') : ''; }
function indMs_(v) { return v instanceof Date && !isNaN(v.getTime()) ? v.getTime() : null; }
function indLock_() { var l = LockService.getScriptLock(); l.waitLock(20000); return l; }
function indHistory_(t, text) {
  var line = Utilities.formatDate(new Date(), indTz_(), 'dd-MMM HH:mm') + ' ' + text;
  return (String(t['History'] || '') ? String(t['History']) + '\n' : '') + line;
}
function indMe_() {
  if (!CURRENT_STAFF_) throw new Error('Not signed in.');
  return CURRENT_STAFF_;
}

// ================================================================
// Readers
// ================================================================
function indTrainee_(code) {
  code = String(code || '').trim().toUpperCase();
  var sheet = indSheet_();
  var t = indRows_(sheet, IND_HEADERS).filter(function (r) { return String(r['Staff Code']).trim().toUpperCase() === code; })[0];
  return t ? { sheet: sheet, t: t } : null;
}
function indPlan_() {
  return indRows_(indPlanSheet_(), IND_PLAN_HEADERS)
    .filter(function (r) { return String(r['Item ID']).trim() && String(r['Active']).trim().toUpperCase() !== 'N'; })
    .map(function (r) {
      return {
        id: String(r['Item ID']).trim(), phase: Number(r['Phase']) === 2 ? 2 : 1, week: Number(r['Week']) || 0,
        title: String(r['Title'] || ''), what: String(r['What to do'] || ''), type: String(r['Type'] || ''),
        link: String(r['Link'] || '').trim(), signOff: /admin/i.test(String(r['Sign-off'] || '')) ? 'Admin' : 'Self'
      };
    });
}
function indProgress_(code) {
  var all = indRows_(indProgressSheet_(), IND_PROGRESS_HEADERS);
  if (!code) return all;
  code = String(code).toUpperCase();
  return all.filter(function (r) { return String(r['Staff Code']).toUpperCase() === code; });
}
function indBank_() {
  return indRows_(indQbSheet_(), IND_QB_HEADERS)
    .filter(function (r) { return String(r['Q ID']).trim() && String(r['Question']).trim(); })
    .map(function (r) {
      var type = /short/i.test(r['Type']) ? 'Short' : (/true|false|tf/i.test(r['Type']) ? 'True/False' : 'MCQ');
      return {
        qid: String(r['Q ID']).trim(), section: String(r['Section'] || 'General').trim() || 'General', type: type,
        text: String(r['Question']).trim(),
        options: type === 'MCQ' ? ['A', 'B', 'C', 'D'].map(function (k) { return { key: k, text: String(r[k] || '').trim() }; }).filter(function (o) { return o.text; }) :
          type === 'True/False' ? [{ key: 'True', text: 'True' }, { key: 'False', text: 'False' }] : [],
        correct: String(r['Correct'] || '').trim(), marks: Number(r['Marks']) > 0 ? Number(r['Marks']) : 1,
        planItem: String(r['Plan Item'] || '').trim(),
        active: String(r['Active']).trim().toUpperCase() !== 'N',
        validatedBy: String(r['Validated By'] || '').trim()
      };
    });
}
function indAttempts_(code) {
  var all = indRows_(indTestsSheet_(), IND_TEST_HEADERS).filter(function (r) { return String(r['Attempt ID']).trim(); });
  if (!code) return all;
  code = String(code).toUpperCase();
  return all.filter(function (r) { return String(r['Staff Code']).toUpperCase() === code; });
}

// ================================================================
// Enrolment
// ================================================================
/** Test opens on day 28 -- or, for someone enrolled late, LATE_ENROL_DAYS after enrolment. */
function indDefaultTestOpens_(joinYmd) {
  var normal = indAddDays_(joinYmd, IND_CFG.testOpensDay - 1);
  var late = indAddDays_(indToday_(), IND_CFG.lateEnrolDays);
  return normal < indToday_() ? late : normal;
}

/** Called from staffLogin before "Last Sign-in" is stamped: a CRE's very first sign-in enrols them. Never throws. */
function indAutoEnrol_(staff) {
  try {
    if (!staff || staff.role !== 'CRE' || !staff.row) return;
    var st = SpreadsheetApp.openById(SHEET_ID).getSheetByName(STAFF_SHEET_NAME);
    if (!st || String(st.getRange(staff.row, 7).getValue() || '').trim() !== '') return; // has signed in before
    if (indTrainee_(staff.code)) return;
    var lock = indLock_();
    try {
      if (indTrainee_(staff.code)) return;
      var today = indToday_();
      indAppend_(indSheet_(), IND_HEADERS, {
        'Staff Code': staff.code, 'Staff Name': staff.name, 'Join Date': indDate_(today), 'Enrolled At': new Date(),
        'Enrolled By': 'Automatic (first sign-in)', 'Test Opens On': indDate_(indDefaultTestOpens_(today)),
        'Extra Attempts': 0, 'Status': IND_ST_ACTIVE, 'Attempts': 0,
        'History': Utilities.formatDate(new Date(), indTz_(), 'dd-MMM HH:mm') + ' Enrolled automatically at first sign-in'
      });
    } finally { lock.releaseLock(); }
  } catch (e) { Logger.log('indAutoEnrol_ failed: ' + e); }
}

function indEnrol_(form) {
  form = form || {};
  var code = String(form.staffCode || '').trim().toUpperCase();
  var staff = getStaffMap_(true)[code];
  if (!staff || !staff.active) throw new Error('Pick an active staff member.');
  if (staff.role !== 'CRE') throw new Error(staff.name + ' is not a CRE.');
  var joinYmd = indYmd_(form.joinYmd);
  if (!joinYmd) throw new Error('Enter the join date.');
  if (joinYmd > indToday_()) throw new Error('The join date can’t be in the future.');
  var opens = indYmd_(form.testOpensYmd) || indDefaultTestOpens_(joinYmd);
  if (opens < joinYmd) throw new Error('The test can’t open before the join date.');
  var me = indMe_();
  var lock = indLock_();
  try {
    var existing = indTrainee_(code);
    if (existing && existing.t['Status'] !== IND_ST_REMOVED) throw new Error(staff.name + ' is already in induction.');
    var fields = {
      'Staff Code': code, 'Staff Name': staff.name, 'Join Date': indDate_(joinYmd), 'Enrolled At': new Date(),
      'Enrolled By': me.name, 'Welcome Seen At': '', 'Test Opens On': indDate_(opens), 'Retake Opens On': '',
      'Extra Attempts': 0, 'Status': IND_ST_ACTIVE, 'Attempts': 0
    };
    if (existing) {
      fields['History'] = indHistory_(existing.t, 'Re-enrolled by ' + me.name);
      indWrite_(existing.sheet, IND_HEADERS, existing.t.row, fields);
    } else {
      fields['History'] = Utilities.formatDate(new Date(), indTz_(), 'dd-MMM HH:mm') + ' Enrolled by ' + me.name + ', join date ' + indFmt_(joinYmd);
      indAppend_(indSheet_(), IND_HEADERS, fields);
    }
  } finally { lock.releaseLock(); }
  return { staffCode: code, name: staff.name, testOpens: indFmt_(opens) };
}

function indRemove_(form) {
  var x = indTrainee_(form && form.staffCode);
  if (!x) throw new Error('Not in induction.');
  var me = indMe_();
  indWrite_(x.sheet, IND_HEADERS, x.t.row, { 'Status': IND_ST_REMOVED, 'History': indHistory_(x.t, 'Removed from induction by ' + me.name) });
  return { staffCode: x.t['Staff Code'] };
}

// ================================================================
// The trainee's view of themselves
// ================================================================
function indMaxAttempts_(t) { return IND_CFG.maxAttempts + (Number(t['Extra Attempts']) || 0); }

/** Finalises any attempt whose time ran out without a submit, from its saved draft. */
function indSweepExpired_(code) {
  var now = Date.now();
  indAttempts_(code).forEach(function (a) {
    if (a['Submitted At']) return;
    var dl = indMs_(a['Deadline']);
    if (dl && now > dl + IND_CFG.graceMin * 60000) {
      var draft = {};
      try { draft = JSON.parse(String(a['Draft Answers'] || '{}')) || {}; } catch (e) { draft = {}; }
      indFinalise_(a, draft, true);
    }
  });
}

function indTestState_(t, attempts) {
  var today = indToday_();
  var done = attempts.filter(function (a) { return a['Submitted At']; });
  var open = attempts.filter(function (a) { return !a['Submitted At']; })[0];
  var opens = indYmd_(t['Test Opens On']);
  var retake = indYmd_(t['Retake Opens On']);
  var max = indMaxAttempts_(t);
  var passed = done.some(function (a) { return a['Result'] === 'Pass'; });
  var pending = done.some(function (a) { return a['Result'] === 'Pending marking'; });
  var st;
  if (open) st = 'inProgress';
  else if (passed) st = 'passed';
  else if (pending) st = 'awaitingMarking';
  else if (done.length === 0) st = today >= opens ? 'open' : 'locked';
  else if (done.length < max) st = (!retake || today >= retake) ? 'retakeOpen' : 'retakeLocked';
  else st = t['Status'] === IND_ST_REVIEWED ? 'reviewed' : 'review';
  return { state: st, opensOn: opens, retakeOpensOn: retake, attemptsUsed: done.length, maxAttempts: max };
}

function indAttemptSummary_(a) {
  var sections = [];
  try { sections = JSON.parse(String(a['Section Scores'] || '[]')) || []; } catch (e) { sections = []; }
  return {
    attemptId: String(a['Attempt ID']), no: Number(a['Attempt No']) || 0,
    submittedAtMs: indMs_(a['Submitted At']), startedAtMs: indMs_(a['Started At']),
    score: Number(a['Score']) || 0, max: Number(a['Max']) || 0,
    pct: a['Percent'] === '' ? null : Number(a['Percent']), pendingMarks: Number(a['Pending Marking']) || 0,
    result: String(a['Result'] || ''), sections: sections
  };
}

/** Plan items behind the questions answered wrongly in the latest failed attempt. */
function indRevision_(code, attempts) {
  var failed = attempts.filter(function (a) { return a['Result'] === 'Below pass mark'; });
  if (!failed.length) return [];
  var last = failed[failed.length - 1];
  var wrongQ = {};
  indRows_(indAnswersSheet_(), IND_ANSWER_HEADERS).forEach(function (r) {
    if (String(r['Attempt ID']) === String(last['Attempt ID']) && Number(r['Marks']) < Number(r['Max Marks'])) wrongQ[String(r['Q ID'])] = true;
  });
  var items = {};
  indBank_().forEach(function (q) { if (wrongQ[q.qid] && q.planItem) items[q.planItem] = true; });
  return Object.keys(items);
}

function indGetMine_() {
  var me = indMe_();
  var x = indTrainee_(me.code);
  if (!x || x.t['Status'] === IND_ST_REMOVED) return { enrolled: false, videos: indVideosFor_(me.code, false), watchedPct: IND_WATCHED_PCT };
  indSweepExpired_(me.code);
  x = indTrainee_(me.code);
  var t = x.t;
  var joinYmd = indYmd_(t['Join Date']) || indToday_();
  var day = indDaysBetween_(joinYmd, indToday_()) + 1;
  var progress = {};
  indProgress_(me.code).forEach(function (p) { progress[String(p['Item ID'])] = p; });
  var items = indPlan_().map(function (it) {
    var p = progress[it.id];
    var status = !p ? 'todo' : (p['Status'] === 'Signed off' ? 'signed' : (p['Status'] === 'Waiting sign-off' ? 'waiting' : 'done'));
    return {
      id: it.id, phase: it.phase, week: it.week, title: it.title, what: it.what, type: it.type, link: it.link,
      signOff: it.signOff, status: status, doneAtMs: p ? indMs_(p['Done At']) : null,
      signedOffBy: p ? String(p['Signed Off By'] || '') : '', note: p ? String(p['Note'] || '') : ''
    };
  });
  var attempts = indAttempts_(me.code);
  var test = indTestState_(t, attempts);
  var bank = indBank_().filter(function (q) { return q.active; });
  var videos = indVideosFor_(me.code, true);
  items.forEach(function (it) { it.videos = videos.filter(function (v) { return v.planItem === it.id; }).map(function (v) { return v.id; }); });
  return {
    enrolled: true, videos: videos, watchedPct: IND_WATCHED_PCT,
    name: String(t['Staff Name'] || me.name),
    joinYmd: joinYmd, joinLabel: indFmt_(joinYmd),
    day: day, totalDays: IND_CFG.totalDays, phase: day <= IND_CFG.phase1Days ? 1 : 2,
    welcomeSeen: !!t['Welcome Seen At'],
    items: items,
    test: {
      state: test.state, opensOn: test.opensOn, opensLabel: indFmt_(test.opensOn),
      retakeOpensOn: test.retakeOpensOn, retakeLabel: indFmt_(test.retakeOpensOn),
      attemptsUsed: test.attemptsUsed, maxAttempts: test.maxAttempts,
      passPct: IND_CFG.passPct, durationMin: IND_CFG.durationMin,
      questionCount: Math.min(IND_CFG.questionsPerTest, bank.length),
      attempts: attempts.filter(function (a) { return a['Submitted At']; }).map(indAttemptSummary_)
    },
    revision: indRevision_(me.code, attempts),
    checkpoint: { dueYmd: indAddDays_(joinYmd, IND_CFG.totalDays - 1), dueLabel: indFmt_(indAddDays_(joinYmd, IND_CFG.totalDays - 1)), done: !!t['Day-60 At'] },
    retakeGapDays: IND_CFG.retakeGapDays
  };
}

function indAckWelcome_() {
  var me = indMe_();
  var x = indTrainee_(me.code);
  if (!x) throw new Error('You are not in induction.');
  if (!x.t['Welcome Seen At']) indWrite_(x.sheet, IND_HEADERS, x.t.row, { 'Welcome Seen At': new Date(), 'History': indHistory_(x.t, 'Read the welcome') });
  return { ok: true };
}

/** CRE ticks an item. Self items -> Done. Admin items -> Waiting sign-off. Un-ticking only before sign-off. */
function indTickItem_(form) {
  form = form || {};
  var me = indMe_();
  if (!indTrainee_(me.code)) throw new Error('You are not in induction.');
  var item = indPlan_().filter(function (i) { return i.id === String(form.itemId || ''); })[0];
  if (!item) throw new Error('That checklist item no longer exists. Refresh the page.');
  var lock = indLock_();
  try {
    var sheet = indProgressSheet_();
    var p = indProgress_(me.code).filter(function (r) { return String(r['Item ID']) === item.id; })[0];
    if (form.done) {
      if (p) return { itemId: item.id };
      indAppend_(sheet, IND_PROGRESS_HEADERS, {
        'Staff Code': me.code, 'Item ID': item.id, 'Status': item.signOff === 'Admin' ? 'Waiting sign-off' : 'Done',
        'Done At': new Date(), 'Note': String(form.note || '').slice(0, 300)
      });
      if (item.signOff === 'Admin') {
        cxMail_(cxEmailsFor_(['Admin']), [], 'Induction sign-off: ' + me.name + ' – ' + item.title,
          '<p><b>' + cxEsc_(me.name) + '</b> has marked this induction item done and needs your sign-off:</p>' +
          '<p><b>' + cxEsc_(item.title) + '</b><br>' + cxEsc_(item.what) + '</p>' +
          (form.note ? '<p>Their note: ' + cxEsc_(form.note) + '</p>' : ''),
          appUrl_() + '?page=admin', 'Open the Admin page');
      }
    } else {
      if (!p) return { itemId: item.id };
      if (p['Status'] === 'Signed off') throw new Error('This item is already signed off. Ask the admin if it needs reopening.');
      sheet.deleteRow(p.row);
    }
  } finally { lock.releaseLock(); }
  return { itemId: item.id };
}

// ================================================================
// The assessment
// ================================================================
function indShuffle_(arr) {
  for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  return arr;
}

/** Up to N active questions, spread evenly across sections; unseen questions first. */
function indDraw_(bank, seen, n) {
  var bySec = {};
  bank.forEach(function (q) { (bySec[q.section] = bySec[q.section] || []).push(q); });
  Object.keys(bySec).forEach(function (s) {
    var fresh = indShuffle_(bySec[s].filter(function (q) { return !seen[q.qid]; }));
    var old = indShuffle_(bySec[s].filter(function (q) { return seen[q.qid]; }));
    bySec[s] = fresh.concat(old);
  });
  var secs = indShuffle_(Object.keys(bySec)), out = [];
  while (out.length < n) {
    var added = false;
    for (var i = 0; i < secs.length && out.length < n; i++) {
      var q = bySec[secs[i]].shift();
      if (q) { out.push(q); added = true; }
    }
    if (!added) break;
  }
  // Keep questions of a section together, sections in a fixed order -- easier to read.
  return out.sort(function (a, b) {
    var ia = IND_SECTIONS.indexOf(a.section), ib = IND_SECTIONS.indexOf(b.section);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (a.section < b.section ? -1 : a.section > b.section ? 1 : 0);
  });
}

function indPublicQuestion_(q) {
  return { qid: q.qid, section: q.section, type: q.type, text: q.text, marks: q.marks, options: q.options.map(function (o) { return { key: o.key, text: o.text }; }) };
}

function indStartTest_() {
  var me = indMe_();
  var lock = indLock_();
  try {
    var x = indTrainee_(me.code);
    if (!x || x.t['Status'] === IND_ST_REMOVED) throw new Error('You are not in induction.');
    indSweepExpired_(me.code);
    var attempts = indAttempts_(me.code);
    var bankAll = indBank_();
    var byId = {};
    bankAll.forEach(function (q) { byId[q.qid] = q; });

    // Resume an attempt that is still running.
    var running = attempts.filter(function (a) { return !a['Submitted At']; })[0];
    if (running) {
      var ids = String(running['Question IDs'] || '').split(',').filter(String);
      var draft = {};
      try { draft = JSON.parse(String(running['Draft Answers'] || '{}')) || {}; } catch (e) { draft = {}; }
      return {
        attemptId: String(running['Attempt ID']), attemptNo: Number(running['Attempt No']) || 1,
        deadlineMs: indMs_(running['Deadline']), serverNowMs: Date.now(), resumed: true, saved: draft,
        questions: ids.map(function (id) { return byId[id]; }).filter(Boolean).map(indPublicQuestion_)
      };
    }

    var state = indTestState_(x.t, attempts).state;
    if (state === 'locked') throw new Error('The assessment opens on ' + indFmt_(indYmd_(x.t['Test Opens On'])) + '.');
    if (state === 'retakeLocked') throw new Error('Your retake opens on ' + indFmt_(indYmd_(x.t['Retake Opens On'])) + '.');
    if (state !== 'open' && state !== 'retakeOpen') throw new Error('There is no assessment for you to take right now.');

    var bank = bankAll.filter(function (q) { return q.active && (q.type === 'Short' || q.correct); });
    if (bank.length < 5) throw new Error('The question bank isn’t ready yet. Tell the admin.');
    var seen = {};
    attempts.forEach(function (a) { String(a['Question IDs'] || '').split(',').forEach(function (id) { if (id) seen[id] = true; }); });
    var picked = indDraw_(bank, seen, IND_CFG.questionsPerTest);

    var no = attempts.length + 1;
    var now = new Date();
    var deadline = new Date(now.getTime() + IND_CFG.durationMin * 60000);
    var attemptId = 'IT-' + me.code + '-' + Utilities.formatDate(now, indTz_(), 'yyMMdd') + '-' + no;
    indAppend_(indTestsSheet_(), IND_TEST_HEADERS, {
      'Attempt ID': attemptId, 'Staff Code': me.code, 'Staff Name': me.name, 'Attempt No': no,
      'Started At': now, 'Deadline': deadline, 'Question IDs': picked.map(function (q) { return q.qid; }).join(','), 'Draft Answers': '{}'
    });
    indWrite_(x.sheet, IND_HEADERS, x.t.row, { 'History': indHistory_(x.t, 'Started attempt ' + no) });
    return { attemptId: attemptId, attemptNo: no, deadlineMs: deadline.getTime(), serverNowMs: Date.now(), resumed: false, saved: {}, questions: picked.map(indPublicQuestion_) };
  } finally { lock.releaseLock(); }
}

function indOwnRunningAttempt_(attemptId) {
  var me = indMe_();
  var a = indAttempts_(me.code).filter(function (r) { return String(r['Attempt ID']) === String(attemptId || ''); })[0];
  if (!a) throw new Error('Assessment not found.');
  return a;
}
function indCleanAnswers_(answers) {
  var out = {};
  Object.keys(answers || {}).forEach(function (k) { out[String(k).slice(0, 20)] = String(answers[k] == null ? '' : answers[k]).slice(0, 1500); });
  return out;
}

function indSaveAnswers_(form) {
  form = form || {};
  var a = indOwnRunningAttempt_(form.attemptId);
  if (a['Submitted At']) return { submitted: true };
  var dl = indMs_(a['Deadline']);
  if (dl && Date.now() > dl + IND_CFG.graceMin * 60000) return { expired: true };
  indWrite_(indTestsSheet_(), IND_TEST_HEADERS, a.row, { 'Draft Answers': JSON.stringify(indCleanAnswers_(form.answers)) });
  return { saved: true };
}

function indSubmitTest_(form) {
  form = form || {};
  var lock = indLock_();
  try {
    var a = indOwnRunningAttempt_(form.attemptId);
    if (a['Submitted At']) return indAttemptSummary_(a);
    var dl = indMs_(a['Deadline']);
    var late = dl && Date.now() > dl + IND_CFG.graceMin * 60000;
    var answers;
    if (late) { // too late: score what was autosaved before time ran out
      try { answers = JSON.parse(String(a['Draft Answers'] || '{}')) || {}; } catch (e) { answers = {}; }
    } else {
      answers = indCleanAnswers_(form.answers);
    }
    var res = indFinalise_(a, answers, late);
    res.late = !!late;
    return res;
  } finally { lock.releaseLock(); }
}

/** Scores an attempt, writes Induction Answers, updates the trainee, sends the emails. */
function indFinalise_(a, answers, timedOut) {
  var byId = {};
  indBank_().forEach(function (q) { byId[q.qid] = q; });
  var ids = String(a['Question IDs'] || '').split(',').filter(String);
  var code = String(a['Staff Code']).toUpperCase();
  var score = 0, max = 0, pendingMarks = 0, rows = [], secs = {};
  ids.forEach(function (id) {
    var q = byId[id];
    if (!q) return; // deleted from the bank since -- not counted
    var ans = String(answers[id] == null ? '' : answers[id]).trim();
    var sec = secs[q.section] = secs[q.section] || { section: q.section, score: 0, max: 0, pending: 0 };
    max += q.marks; sec.max += q.marks;
    var marks = '', correct = '';
    if (q.type === 'Short') {
      if (!ans) { marks = 0; correct = 'N'; }
      else { pendingMarks += q.marks; sec.pending += q.marks; correct = 'Pending'; }
    } else {
      var ok = q.type === 'True/False'
        ? ans.charAt(0).toLowerCase() === q.correct.charAt(0).toLowerCase() && ans !== ''
        : ans.toUpperCase() === q.correct.charAt(0).toUpperCase();
      marks = ok ? q.marks : 0; correct = ok ? 'Y' : 'N';
    }
    if (marks !== '') { score += marks; sec.score += marks; }
    rows.push([a['Attempt ID'], code, id, q.section, q.type, ans, correct, marks, q.marks]);
  });
  if (rows.length) {
    var as = indAnswersSheet_();
    as.getRange(as.getLastRow() + 1, 1, rows.length, IND_ANSWER_HEADERS.length).setValues(rows);
  }
  var sections = Object.keys(secs).map(function (k) { var s = secs[k]; s.pct = s.max ? Math.round(s.score / s.max * 100) : 0; return s; });
  var fields = {
    'Submitted At': new Date(), 'Score': score, 'Max': max, 'Section Scores': JSON.stringify(sections),
    'Pending Marking': pendingMarks, 'Draft Answers': timedOut ? String(a['Draft Answers'] || '') + ' [time ran out]' : ''
  };
  if (pendingMarks > 0) { fields['Percent'] = ''; fields['Result'] = 'Pending marking'; }
  else { fields['Percent'] = max ? Math.round(score / max * 1000) / 10 : 0; fields['Result'] = fields['Percent'] >= IND_CFG.passPct ? 'Pass' : 'Below pass mark'; }
  indWrite_(indTestsSheet_(), IND_TEST_HEADERS, a.row, fields);
  for (var k in fields) a[k] = fields[k];
  indAfterResult_(code, a);
  return indAttemptSummary_(a);
}

/** Trainee row + emails once an attempt has a result (or is waiting for marking). */
function indAfterResult_(code, a) {
  var x = indTrainee_(code);
  if (!x) return;
  var t = x.t;
  var done = indAttempts_(code).filter(function (r) { return r['Submitted At']; });
  var finals = done.filter(function (r) { return r['Percent'] !== '' && r['Percent'] !== null; }).map(function (r) { return Number(r['Percent']) || 0; });
  var name = String(t['Staff Name'] || code);
  var pct = a['Percent'];
  var fields = {
    'Attempts': done.length,
    'Best Score %': finals.length ? Math.max.apply(null, finals) : '',
    'Last Score %': pct === '' ? '' : pct
  };
  var link = appUrl_() + '?page=admin';
  var secHtml = '';
  try {
    secHtml = '<table cellpadding="4" style="border-collapse:collapse;font-size:13px;">' + JSON.parse(String(a['Section Scores'] || '[]')).map(function (s) {
      return '<tr><td>' + cxEsc_(s.section) + '</td><td align="right"><b>' + s.score + ' / ' + s.max + '</b></td><td align="right">' + s.pct + '%</td></tr>';
    }).join('') + '</table>';
  } catch (e) { secHtml = ''; }
  var no = Number(a['Attempt No']) || done.length;
  var label = no === 1 ? 'assessment' : 'retake (attempt ' + no + ')';

  if (a['Result'] === 'Pending marking') {
    fields['Status'] = IND_ST_MARKING;
    fields['History'] = indHistory_(t, 'Submitted attempt ' + no + ' – short answers waiting to be marked');
    indWrite_(x.sheet, IND_HEADERS, t.row, fields);
    cxMail_(cxEmailsFor_(['Admin']), [], 'Induction: mark ' + name + '’s short answers',
      '<p>' + cxEsc_(name) + ' has submitted the induction ' + label + '. The short answers need marking before the result is final.</p>' + secHtml,
      link, 'Mark on the Admin page');
    return;
  }
  if (a['Result'] === 'Pass') {
    fields['Status'] = IND_ST_PASSED;
    fields['History'] = indHistory_(t, 'Passed attempt ' + no + ' with ' + pct + '%');
    indWrite_(x.sheet, IND_HEADERS, t.row, fields);
    cxMail_(cxEmailsFor_(['Admin']), [], 'Induction: ' + name + ' passed (' + pct + '%)',
      '<p>' + cxEsc_(name) + ' passed the induction ' + label + ' with <b>' + pct + '%</b> (pass mark ' + IND_CFG.passPct + '%).</p>' + secHtml, link, 'Open the Admin page');
    return;
  }
  // Below the pass mark
  if (done.length < indMaxAttempts_(t)) {
    var retake = indAddDays_(indYmd_(a['Submitted At']) || indToday_(), IND_CFG.retakeGapDays);
    fields['Status'] = IND_ST_RETAKE;
    fields['Retake Opens On'] = indDate_(retake);
    fields['History'] = indHistory_(t, 'Attempt ' + no + ': ' + pct + '% – retake opens ' + indFmt_(retake));
    indWrite_(x.sheet, IND_HEADERS, t.row, fields);
    cxMail_(cxEmailsFor_(['Admin']), [], 'Induction: ' + name + ' scored ' + pct + '% – retake on ' + indFmt_(retake),
      '<p>' + cxEsc_(name) + ' scored <b>' + pct + '%</b> on the induction ' + label + ' (pass mark ' + IND_CFG.passPct + '%).</p>' + secHtml +
      '<p>The retake opens on <b>' + indFmt_(retake) + '</b>. Their page lists the plan items to revise.</p>', link, 'Open the Admin page');
    return;
  }
  fields['Status'] = IND_ST_REVIEW;
  fields['History'] = indHistory_(t, 'Attempt ' + no + ': ' + pct + '% – below the pass mark again; sent to the directors for review');
  indWrite_(x.sheet, IND_HEADERS, t.row, fields);
  cxMail_(cxEmailsFor_(['Director']), cxEmailsFor_(['Admin']), 'Induction: ' + name + ' is below ' + IND_CFG.passPct + '% after the retake – salary review',
    '<p>' + cxEsc_(name) + ' scored <b>' + pct + '%</b> on the induction ' + label + '. Their best score is <b>' + fields['Best Score %'] + '%</b>; the pass mark is ' + IND_CFG.passPct + '%.</p>' + secHtml +
    '<p>Under the induction policy this goes to the directors for a salary review. Nothing has been changed automatically. Once you have decided, record the decision in the Induction section of the Owner Dashboard.</p>',
    appUrl_() + '?page=dashboard-beta', 'Open the Owner Dashboard');
}

// ================================================================
// Admin page
// ================================================================
function indAdminData_() {
  var staffMap = getStaffMap_(true);
  var plan = indPlan_();
  var planById = {};
  plan.forEach(function (i) { planById[i.id] = i; });
  var trainees = indRows_(indSheet_(), IND_HEADERS).filter(function (t) { return String(t['Staff Code']).trim(); });
  trainees.forEach(function (t) { indSweepExpired_(String(t['Staff Code']).toUpperCase()); });
  trainees = indRows_(indSheet_(), IND_HEADERS).filter(function (t) { return String(t['Staff Code']).trim(); });
  var progress = indProgress_();
  var attempts = indAttempts_();
  var today = indToday_();

  var list = trainees.map(function (t) {
    var code = String(t['Staff Code']).toUpperCase();
    var joinYmd = indYmd_(t['Join Date']);
    var mine = progress.filter(function (p) { return String(p['Staff Code']).toUpperCase() === code; });
    var myAttempts = attempts.filter(function (a) { return String(a['Staff Code']).toUpperCase() === code; });
    var test = indTestState_(t, myAttempts);
    var doneCount = mine.filter(function (p) { return p['Status'] === 'Done' || p['Status'] === 'Signed off'; }).length;
    var vids = indVideosFor_(code, true);
    var pmap = {};
    mine.forEach(function (p) { pmap[String(p['Item ID'])] = p; });
    return {
      code: code, name: String(t['Staff Name'] || (staffMap[code] && staffMap[code].name) || code),
      joinYmd: joinYmd, joinLabel: indFmt_(joinYmd), day: joinYmd ? indDaysBetween_(joinYmd, today) + 1 : null,
      status: String(t['Status'] || ''), removed: t['Status'] === IND_ST_REMOVED,
      welcomeSeen: !!t['Welcome Seen At'], enrolledBy: String(t['Enrolled By'] || ''),
      itemsDone: doneCount, itemsTotal: plan.length,
      videosWatched: vids.filter(function (v) { return v.watched; }).length, videosTotal: vids.length,
      videos: vids.map(function (v) { return { title: v.title, pct: v.pct, watched: v.watched }; }),
      items: plan.map(function (i) {
        var p = pmap[i.id];
        return { id: i.id, phase: i.phase, week: i.week, title: i.title, signOff: i.signOff,
          status: !p ? 'todo' : p['Status'] === 'Signed off' ? 'signed' : p['Status'] === 'Waiting sign-off' ? 'waiting' : 'done',
          signedOffBy: p ? String(p['Signed Off By'] || '') : '', note: p ? String(p['Note'] || '') : '' };
      }),
      test: { state: test.state, opensLabel: indFmt_(test.opensOn), retakeLabel: indFmt_(test.retakeOpensOn), attemptsUsed: test.attemptsUsed, maxAttempts: test.maxAttempts },
      attempts: myAttempts.filter(function (a) { return a['Submitted At']; }).map(indAttemptSummary_),
      bestPct: t['Best Score %'] === '' ? null : Number(t['Best Score %']),
      directorReview: String(t['Director Review'] || ''), directorReviewBy: String(t['Director Review By'] || ''),
      day60DueLabel: joinYmd ? indFmt_(indAddDays_(joinYmd, IND_CFG.totalDays - 1)) : '',
      day60Due: joinYmd ? indAddDays_(joinYmd, IND_CFG.totalDays - 1) <= today : false,
      day60: t['Day-60 At'] ? { rating: String(t['Day-60 Rating'] || ''), note: String(t['Day-60 Note'] || ''), by: String(t['Day-60 By'] || ''), atMs: indMs_(t['Day-60 At']) } : null,
      history: String(t['History'] || '')
    };
  });

  var waitingSignOff = [];
  list.forEach(function (tr) {
    if (tr.removed) return;
    tr.items.forEach(function (i) { if (i.status === 'waiting') waitingSignOff.push({ code: tr.code, name: tr.name, itemId: i.id, title: i.title, note: i.note }); });
  });
  var toMark = attempts.filter(function (a) { return a['Result'] === 'Pending marking'; }).map(function (a) {
    var s = indAttemptSummary_(a); s.code = String(a['Staff Code']).toUpperCase(); s.name = String(a['Staff Name'] || ''); return s;
  });
  var enrolled = {};
  list.forEach(function (tr) { if (!tr.removed) enrolled[tr.code] = true; });
  var cres = Object.keys(staffMap).map(function (k) { return staffMap[k]; })
    .filter(function (s) { return s.active && s.role === 'CRE' && !enrolled[s.code]; })
    .map(function (s) { return { code: s.code, name: s.name }; });

  var bank = indBank_();
  var bySection = {};
  bank.forEach(function (q) {
    if (!q.active) return;
    var b = bySection[q.section] = bySection[q.section] || { section: q.section, count: 0, unvalidated: 0 };
    b.count++; if (!q.validatedBy) b.unvalidated++;
  });
  return {
    trainees: list.filter(function (t) { return !t.removed; }),
    removed: list.filter(function (t) { return t.removed; }).map(function (t) { return { code: t.code, name: t.name }; }),
    waitingSignOff: waitingSignOff, toMark: toMark, cresNotEnrolled: cres,
    bank: { active: bank.filter(function (q) { return q.active; }).length, sections: Object.keys(bySection).map(function (k) { return bySection[k]; }),
      unvalidated: bank.filter(function (q) { return q.active && !q.validatedBy; }).length, perTest: IND_CFG.questionsPerTest },
    cfg: IND_CFG,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit'
  };
}

function indSignOff_(form) {
  form = form || {};
  var me = indMe_();
  var code = String(form.staffCode || '').toUpperCase();
  var p = indProgress_(code).filter(function (r) { return String(r['Item ID']) === String(form.itemId || ''); })[0];
  var sheet = indProgressSheet_();
  if (form.approve === false) {
    if (!p) return { itemId: form.itemId };
    if (p['Status'] === 'Signed off') throw new Error('Already signed off.');
    sheet.deleteRow(p.row); // sent back: the CRE ticks it again when it's really done
    return { itemId: form.itemId, sentBack: true };
  }
  if (p) {
    indWrite_(sheet, IND_PROGRESS_HEADERS, p.row, { 'Status': 'Signed off', 'Signed Off By': me.name, 'Signed Off At': new Date() });
  } else { // admin may sign off an item the CRE never ticked
    indAppend_(sheet, IND_PROGRESS_HEADERS, { 'Staff Code': code, 'Item ID': form.itemId, 'Status': 'Signed off', 'Done At': new Date(), 'Signed Off By': me.name, 'Signed Off At': new Date() });
  }
  return { itemId: form.itemId };
}

/** Opens the test (or the retake) today; with extraAttempt, allows one more attempt after the limit. */
function indUnlockTest_(form) {
  form = form || {};
  var x = indTrainee_(form.staffCode);
  if (!x) throw new Error('Not in induction.');
  var me = indMe_();
  var t = x.t, today = indDate_(indToday_()), fields = {};
  var test = indTestState_(t, indAttempts_(t['Staff Code']));
  if (form.extraAttempt) {
    fields['Extra Attempts'] = (Number(t['Extra Attempts']) || 0) + 1;
    fields['Retake Opens On'] = today;
    fields['Status'] = IND_ST_RETAKE;
    fields['History'] = indHistory_(t, 'Another attempt allowed by ' + me.name);
  } else if (test.state === 'locked') {
    fields['Test Opens On'] = today; fields['History'] = indHistory_(t, 'Test opened early by ' + me.name);
  } else if (test.state === 'retakeLocked') {
    fields['Retake Opens On'] = today; fields['History'] = indHistory_(t, 'Retake opened early by ' + me.name);
  } else {
    throw new Error('Nothing to unlock: the test is ' + test.state + '.');
  }
  indWrite_(x.sheet, IND_HEADERS, t.row, fields);
  return { staffCode: t['Staff Code'] };
}

function indAttemptDetail_(form) {
  var id = String((form && form.attemptId) || '');
  var a = indAttempts_().filter(function (r) { return String(r['Attempt ID']) === id; })[0];
  if (!a) throw new Error('Attempt not found.');
  var byId = {};
  indBank_().forEach(function (q) { byId[q.qid] = q; });
  var answers = indRows_(indAnswersSheet_(), IND_ANSWER_HEADERS).filter(function (r) { return String(r['Attempt ID']) === id; }).map(function (r) {
    var q = byId[String(r['Q ID'])] || {};
    var opt = function (k) { var o = (q.options || []).filter(function (x) { return x.key === k; })[0]; return o ? o.key + ') ' + o.text : k; };
    return {
      qid: String(r['Q ID']), section: String(r['Section']), type: String(r['Type']), text: q.text || '(question deleted from the bank)',
      answer: String(r['Answer'] || ''), answerText: r['Type'] === 'MCQ' && r['Answer'] ? opt(String(r['Answer'])) : String(r['Answer'] || ''),
      correctText: r['Type'] === 'MCQ' ? opt(q.correct) : (q.correct || ''),
      correct: String(r['Correct']), marks: r['Marks'] === '' ? null : Number(r['Marks']), max: Number(r['Max Marks']) || 0
    };
  });
  var s = indAttemptSummary_(a);
  s.code = String(a['Staff Code']); s.name = String(a['Staff Name']); s.answers = answers;
  return s;
}

function indMarkShort_(form) {
  form = form || {};
  var me = indMe_();
  var lock = indLock_();
  try {
    var id = String(form.attemptId || '');
    var a = indAttempts_().filter(function (r) { return String(r['Attempt ID']) === id; })[0];
    if (!a) throw new Error('Attempt not found.');
    if (a['Result'] !== 'Pending marking') throw new Error('This attempt is already marked.');
    var as = indAnswersSheet_();
    var rows = indRows_(as, IND_ANSWER_HEADERS).filter(function (r) { return String(r['Attempt ID']) === id; });
    var marks = form.marks || {};
    rows.forEach(function (r) {
      if (r['Correct'] !== 'Pending') return;
      var m = Number(marks[String(r['Q ID'])]);
      var max = Number(r['Max Marks']) || 0;
      if (marks[String(r['Q ID'])] === undefined || marks[String(r['Q ID'])] === '' || isNaN(m) || m < 0 || m > max) throw new Error('Enter marks between 0 and ' + max + ' for every short answer.');
      indWrite_(as, IND_ANSWER_HEADERS, r.row, { 'Marks': m, 'Correct': m >= max ? 'Y' : (m > 0 ? 'Part' : 'N') });
      r['Marks'] = m;
    });
    // Recompute the attempt from its answers
    var score = 0, max = 0, secs = {};
    rows.forEach(function (r) {
      var s = secs[r['Section']] = secs[r['Section']] || { section: String(r['Section']), score: 0, max: 0, pending: 0 };
      var m = Number(r['Marks']) || 0, mx = Number(r['Max Marks']) || 0;
      score += m; max += mx; s.score += m; s.max += mx;
    });
    var sections = Object.keys(secs).map(function (k) { var s = secs[k]; s.pct = s.max ? Math.round(s.score / s.max * 100) : 0; return s; });
    var pct = max ? Math.round(score / max * 1000) / 10 : 0;
    var fields = { 'Score': score, 'Max': max, 'Percent': pct, 'Section Scores': JSON.stringify(sections), 'Pending Marking': 0,
      'Result': pct >= IND_CFG.passPct ? 'Pass' : 'Below pass mark', 'Marked By': me.name, 'Marked At': new Date() };
    indWrite_(indTestsSheet_(), IND_TEST_HEADERS, a.row, fields);
    for (var k in fields) a[k] = fields[k];
    indAfterResult_(String(a['Staff Code']).toUpperCase(), a);
    return indAttemptSummary_(a);
  } finally { lock.releaseLock(); }
}

/** The admin records what the directors decided after a below-80% retake. */
function indRecordReview_(form) {
  form = form || {};
  var note = String(form.note || '').trim();
  if (note.length < 5) throw new Error('Write down what the directors decided.');
  var x = indTrainee_(form.staffCode);
  if (!x) throw new Error('Not in induction.');
  var me = indMe_();
  indWrite_(x.sheet, IND_HEADERS, x.t.row, { 'Director Review': note.slice(0, 1000), 'Director Review By': me.name, 'Director Review At': new Date(),
    'Status': IND_ST_REVIEWED, 'History': indHistory_(x.t, 'Director review recorded by ' + me.name) });
  return { staffCode: x.t['Staff Code'] };
}

/** Day-60 scorecard from the CRE's own orders in the tracker, logged since their join date. */
function indScorecard_(form) {
  var x = indTrainee_(form && form.staffCode);
  if (!x) throw new Error('Not in induction.');
  var t = x.t, code = String(t['Staff Code']).toUpperCase();
  var joinYmd = indYmd_(t['Join Date']);
  var endYmd = indAddDays_(joinYmd, IND_CFG.totalDays - 1);
  var from = indDate_(joinYmd).getTime(), to = indDate_(indAddDays_(endYmd, 1)).getTime();
  var m = { orders: 0, value: 0, cancelled: 0, withCrmPo: 0, dispatched: 0, deliveryUpdated: 0, balances: 0, balancesWithFollowUp: 0 };
  opsReadOrders_().rows.forEach(function (o) {
    if (String(o.get('CRE Code') || '').toUpperCase() !== code) return;
    var d = o.get('Date Logged');
    var ms = d instanceof Date ? d.getTime() : null;
    if (!ms || ms < from || ms >= to) return;
    var status = String(o.get('Status') || '');
    if (status === 'Cancelled') { m.cancelled++; return; }
    if (TEST_MATCH_RE.test(String(o.get('Institution / Customer') || '')) || TEST_MATCH_RE.test(String(o.get('Tracker ID') || ''))) return;
    m.orders++;
    m.value += Number(o.get('Total Order Value')) || 0;
    if (String(o.get('CRM PO URL') || '').trim()) m.withCrmPo++;
    if (isDispatchedStatus_(status)) {
      m.dispatched++;
      if (/Delivered|In Transit|Returned/i.test(String(o.get('Delivery Status') || ''))) m.deliveryUpdated++;
    }
    if (computeBalanceDue(o.get('Total Order Value'), o.get('Advance Received')) > 0) {
      m.balances++;
      if (o.get('Payment Follow-up Date')) m.balancesWithFollowUp++;
    }
  });
  var pct = function (a, b) { return b ? Math.round(a / b * 100) : null; };
  var plan = indPlan_();
  var done = indProgress_(code).filter(function (p) { return p['Status'] === 'Done' || p['Status'] === 'Signed off'; }).length;
  return {
    staffCode: code, name: String(t['Staff Name'] || ''), fromLabel: indFmt_(joinYmd), toLabel: indFmt_(endYmd),
    rows: [
      { label: 'Checklist completed', value: done + ' / ' + plan.length, pct: pct(done, plan.length) },
      (function () { var v = indVideosFor_(code, true); var w = v.filter(function (x) { return x.watched; }).length; return { label: 'Training videos watched', value: w + ' / ' + v.length, pct: pct(w, v.length) }; })(),
      { label: 'Assessment (best score)', value: t['Best Score %'] === '' ? 'Not taken' : t['Best Score %'] + '%', pct: t['Best Score %'] === '' ? null : Number(t['Best Score %']) },
      { label: 'Orders logged', value: String(m.orders) + (m.cancelled ? ' (+' + m.cancelled + ' cancelled)' : ''), pct: null },
      { label: 'Order value logged', value: 'Rs. ' + Math.round(m.value).toLocaleString('en-IN'), pct: null },
      { label: 'Orders with the CRM PO uploaded', value: m.withCrmPo + ' / ' + m.orders, pct: pct(m.withCrmPo, m.orders) },
      { label: 'Dispatched orders with delivery updated', value: m.deliveryUpdated + ' / ' + m.dispatched, pct: pct(m.deliveryUpdated, m.dispatched) },
      { label: 'Open balances with a follow-up date set', value: m.balancesWithFollowUp + ' / ' + m.balances, pct: pct(m.balancesWithFollowUp, m.balances) }
    ],
    day60: t['Day-60 At'] ? { rating: String(t['Day-60 Rating'] || ''), note: String(t['Day-60 Note'] || ''), by: String(t['Day-60 By'] || '') } : null
  };
}

function indRecordDay60_(form) {
  form = form || {};
  var rating = String(form.rating || '').trim();
  if (['Strong', 'On track', 'Needs support'].indexOf(rating) === -1) throw new Error('Pick a rating.');
  var note = String(form.note || '').trim();
  if (note.length < 5) throw new Error('Add a short note on the conversation.');
  var x = indTrainee_(form.staffCode);
  if (!x) throw new Error('Not in induction.');
  var me = indMe_();
  indWrite_(x.sheet, IND_HEADERS, x.t.row, { 'Day-60 Rating': rating, 'Day-60 Note': note.slice(0, 1000), 'Day-60 By': me.name, 'Day-60 At': new Date(),
    'History': indHistory_(x.t, 'Day-60 review recorded by ' + me.name + ': ' + rating) });
  if (rating === 'Needs support') {
    cxMail_(cxEmailsFor_(['Director']), [], 'Induction day-60: ' + String(x.t['Staff Name']) + ' needs support',
      '<p>' + cxEsc_(me.name) + ' recorded the day-60 review for <b>' + cxEsc_(x.t['Staff Name']) + '</b> as <b>Needs support</b>.</p><p>' + cxEsc_(note) + '</p>' +
      '<p>This is for a conversation only; it does not trigger a salary review.</p>', '', '');
  }
  return { staffCode: x.t['Staff Code'] };
}

// ================================================================
// Wiring
// ================================================================
function inductionApiMap_() {
  var CRE = ['CRE'];
  return {
    indGetMine:      { fn: indGetMine_,      roles: CRE },
    indAckWelcome:   { fn: indAckWelcome_,   roles: CRE, log: 'Induction: read the welcome' },
    indTickItem:     { fn: indTickItem_,     roles: CRE, log: 'Induction: checklist' },
    indStartTest:    { fn: indStartTest_,    roles: CRE, log: 'Induction: started the assessment' },
    indSaveAnswers:  { fn: indSaveAnswers_,  roles: CRE },
    indSubmitTest:   { fn: indSubmitTest_,   roles: CRE, log: 'Induction: submitted the assessment' },
    indAdminData:    { fn: indAdminData_,    roles: ['Director'] },
    indVideoProgress:{ fn: indVideoProgress_, roles: CRE },
    indEnrol:        { fn: indEnrol_,        roles: [], log: 'Induction: enrolled' },
    indRemove:       { fn: indRemove_,       roles: [], log: 'Induction: removed' },
    indSignOff:      { fn: indSignOff_,      roles: [], log: 'Induction: sign-off' },
    indUnlockTest:   { fn: indUnlockTest_,   roles: [], log: 'Induction: unlocked test' },
    indAttemptDetail:{ fn: indAttemptDetail_, roles: ['Director'] },
    indMarkShort:    { fn: indMarkShort_,    roles: [], log: 'Induction: marked short answers' },
    indRecordReview: { fn: indRecordReview_, roles: ['Director'], log: 'Induction: director review recorded' },
    indScorecard:    { fn: indScorecard_,    roles: ['Director'] },
    indRecordDay60:  { fn: indRecordDay60_,  roles: [], log: 'Induction: day-60 review' }
  };
}

function inductionActivityDetail_(fnName, a, result) {
  a = a || {}; result = result || {};
  switch (fnName) {
    case 'indTickItem': return (a.itemId || '') + (a.done ? ' ticked' : ' unticked');
    case 'indStartTest': return result.attemptId || '';
    case 'indSubmitTest': return (result.attemptId || '') + ' – ' + (result.pct === null ? 'pending marking' : result.pct + '%') + (result.late ? ' (after time)' : '');
    case 'indEnrol': return (result.name || a.staffCode || '') + ', join ' + (a.joinYmd || '') + ', test opens ' + (result.testOpens || '');
    case 'indRemove': case 'indRecordReview': case 'indUnlockTest': return (a.staffCode || '') + (a.extraAttempt ? ' (extra attempt)' : '');
    case 'indSignOff': return (a.staffCode || '') + ' ' + (a.itemId || '') + (a.approve === false ? ' sent back' : ' signed off');
    case 'indMarkShort': return (a.attemptId || '') + ' – ' + (result.pct === null ? '' : result.pct + '%');
    case 'indRecordDay60': return (a.staffCode || '') + ' – ' + (a.rating || '');
    default: return '';
  }
}
