# CRE induction – go-live checklist (Nov 2026)

Code: `Induction.js`, `induction_cre.html` (CRE beta page), `induction_admin.html` (Admin page), plus three one-line hooks in `Code.js` (API map, activity log, auto-enrol at first sign-in).

## What changes for each person

| Who | What's new |
|---|---|
| New CRE | First sign-in: a **welcome screen** they must tick before using the page (60-day plan, the day-30 assessment, 80% pass mark, one retake, salary review if the retake is also below 80%). An **Induction** button on the rail: day X of 60, checklist by week, assessment card, day-60 date |
| CRE in induction | Ticks checklist items. "Sign-off" items go to the admin. Takes the assessment when it opens: timed (30 min), autosaved, score and section scores shown at once, correct answers never shown |
| Admin (Ananthu) | **CRE induction** card at the bottom of the Admin page: sign-offs and short answers waiting, trainees, enrol, open a test early, allow one more attempt, record the directors' decision, day-60 scorecard + rating. Emails for sign-offs, results and short answers to mark |
| Directors | Email when a CRE is below 80% after the retake (salary review). Email when a day-60 review is rated "Needs support" (conversation only) |
| Existing CREs (e.g. Greeshma) | Nothing. Only a CRE's **first ever** sign-in auto-enrols them |

## Rules (top of `Induction.js`, `IND_CFG`)

Pass mark 80% · test opens day 28 · 30 minutes · 25 questions per test · retake 15 days after the first attempt · 2 attempts (admin can allow more) · late enrolment: test opens 14 days after enrolling.

## On go-live day

1. `git pull`, then `clasp push` from `G:\My Drive\ICF codebase`.
2. Deploy → Manage deployments → edit the live deployment → **New version**. Same URL.
3. Open the Admin page once. This creates the six tabs: **Induction, Induction Plan, Induction Progress, Question Bank, Induction Tests, Induction Answers**. The plan and the bank are seeded with a **starter set**.
4. **Protect the Question Bank tab** (Data → Protect sheets and ranges → only you). It holds the answers.
5. Replace the starter content:
   - **Induction Plan**: edit titles / text / weeks, add KM video links in *Link*. *Sign-off* = `Self` or `Admin`. Keep Item IDs unique; set *Active* to `N` to retire an item (don't delete rows that trainees have ticked).
   - **Question Bank**: one row per question. *Type* = `MCQ`, `True/False` or `Short`. *Correct* = the letter (MCQ) or `True`/`False`; blank for Short (marked by the admin). *Plan Item* = the Item ID it tests (drives the "revise these" list after a fail). Greeshma fills *Validated By*. Aim for 50+ so the retake draws fresh questions.
   - Sections used for spreading questions: Products, Order flow & tracker, Payments & Accounts, CRM, Customer communication, Policies (others work too).
6. **Enrol Amrutha** on the Admin page with her real join date. Her test opens 14 days later unless you pick a date.
7. Make sure Admins and Directors have emails in the Staff tab (column H).
8. Test with a throwaway CRE code: create it in Staff, set a PIN, sign in on the CRE beta page → welcome screen → tick items → Admin opens the test early → take it. Then **Remove from induction** and set the code to Active = N.

## Not built yet / to decide

- Rules are in code (`IND_CFG`), not on the Settings page yet.
- The classic CRE page doesn't show induction (all CREs are on the beta page).
- Directors don't have an induction view; they get the emails, and the admin records their decision.
- Salary terms should be in the offer letter. The welcome screen states them, but the system only flags a result.
