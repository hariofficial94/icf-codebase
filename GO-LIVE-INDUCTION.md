# CRE induction – go-live checklist (Nov 2026)

Code: `Induction.js`, `induction_cre.html` (CRE beta page), `induction_admin.html` (Admin page), `induction_dash.html` (Owner Dashboard beta), plus three one-line hooks in `Code.js` (API map, activity log, auto-enrol at first sign-in).

## What changes for each person

| Who | What's new |
|---|---|
| New CRE | First sign-in: a **welcome screen** they must tick before using the page (60-day plan, the day-30 assessment, 80% pass mark, one retake, salary review if the retake is also below 80%). An **Induction** button on the rail: day X of 60, checklist by week, assessment card, day-60 date |
| CRE in induction | Ticks checklist items. "Sign-off" items go to the admin. Takes the assessment when it opens: timed (30 min), autosaved, score and section scores shown at once, correct answers never shown |
| Admin (Ananthu) | **CRE induction** card at the bottom of the Admin page: sign-offs and short answers waiting, trainees, enrol, open a test early, allow one more attempt, record the directors' decision, day-60 scorecard + rating. Emails for sign-offs, results and short answers to mark |
| Directors | **CRE induction** section on the Owner Dashboard (beta), under the director panel: every trainee's day, checklist, videos, assessment, day-60 review; click a row for details, answers and the work scorecard. When someone is below 80% after the retake, the row says **Your decision needed** and the directors record the decision there. Emails for that, and for a day-60 "Needs support" |
| Every CRE | **Training Material** page (rail button *Training*; inside *Induction* for trainees): the "All" videos plus the checklist's reading material (Read / Watch items, or any item with a link or videos), read-only. Greeshma's YouTube videos play in a pop-up on the page |
| Existing CREs (e.g. Greeshma) | Nothing. Only a CRE's **first ever** sign-in auto-enrols them |

## Training videos (YouTube, unlisted)

1. Upload each video to YouTube as **Unlisted**. Leave **Allow embedding** on (YouTube Studio → video → Show more).
2. Add a row to the **Training Videos** tab: *Video ID* (V01, V02…), *Title*, *Section* (groups the library), *Order*, *YouTube Link* (any normal link), *Minutes*, *Plan Item* (e.g. P1-03 – puts a **Watch** button on that checklist item), *For* = `All` (every CRE) or `Induction` (trainees only), *Active* = Y. The example row V01 is inactive – overwrite it.
3. The page counts seconds actually played (skipping ahead doesn't count); **90% = watched**. When all videos on a *Self* checklist item are watched, the item ticks itself. Progress is in the **Video Progress** tab.
4. If the pop-up ever shows a YouTube error instead of the video, the **Open on YouTube** button still works. If the YouTube script can't load at all, the plain player is shown and an "I've watched it" button unlocks after 80% of the video's minutes.

## Training documents

One row per document in the **Training Documents** tab: *Doc ID* (D1, D2…), *Title*, *Section*, *Order*, *Link*, *Plan Item*, *For* (`All` / `Induction`), *Active*. Drive files and Google Docs / Sheets / Slides open in a preview pop-up on the page (share them as "Anyone in the organisation / with the link can view"); any other link opens in a new tab. The example row D1 is inactive – overwrite it.

The page is called **Training Material** and has two tabs: **Read** (the documents, plus – for existing CREs – the checklist's reading topics) and **Watch** (the videos). A search box matches title, number (D2, V3) or section.

**Videos and documents each have their own tab, one row per item.** The Induction Plan row only describes the task; put its ID in a video's or document's *Plan Item* and the item gets a V1 / D1 button. Leave the plan's own *Link* column empty unless it's a one-off link.

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
- Salary terms should be in the offer letter. The welcome screen states them, but the system only flags a result.
