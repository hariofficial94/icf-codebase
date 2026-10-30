# Rentals – go-live checklist (Oct 2026)

Rentals get their own page (`…/exec?page=rental`) and their own tabs. Nothing in the sales tracker changes.

| Who | Before | After |
|---|---|---|
| CRE | Logged a rental as a normal order | Logs it on the **Rentals** page, only once the advance is paid: customer, site, toilets requested, billing (per event / day / week / month), agreed value, overrun rate, dates, advance + UTR, and the rest of the payment as agreed. Records **off-hires** and **extensions**, and marks payments the customer says they made |
| Accounts | Verified it like a sale | Verifies the advance (or sends it back to the CRE), issues the **rental gate pass** (lists every item ID), verifies later payments, settles and closes |
| Ananthu | Coordinated by phone | **Acknowledges** – or, for a rental needed 15+ days away, sets a **reminder date** instead. Enters the **component configuration** (toilets, septic tanks, water tanks, stands). Marks **installations** with the plumber’s site photo (rent starts), records **suction**, plans the **pickup**, logs vendor jobs |
| Manoj | Loaded what he was told | **Tags** items (the system issues T-/S-/W-/ST- numbers to stencil), loads a trip and requests the gate pass. **Inspects** what comes back: OK or damaged |
| Sanju | – | Rental trips and pickups show on his **Gate** page: marks trips out, and pickups in (ticks off anything missing) |
| Directors | – | Same steps as Ananthu, plus the **Overview** (fleet by status, money, shortages) and write-offs |

## On go-live day

1. **Get the code into Apps Script**: `git pull`, then `clasp push` from `G:\My Drive\ICF codebase`.
2. **Deploy**: Deploy → Manage deployments → edit the live deployment → **New version**. The URL stays the same. Until step 3 the Rentals page says “not switched on yet” and saves nothing.
3. **In the spreadsheet**: **ICF Admin → Rentals: set up and go live**. It:
   - creates the nine Rental tabs (Orders, Payments, Configuration, Items, Trips, Deployments, Off-hires, Vendor Jobs, Item Types)
   - adds the Rentals rows to Settings (deposit **off**, 15-day warning, reminder timings)
   - creates the Drive folders *ICF Rental Documents* and *ICF Rental Gate Passes*
   - switches rentals on. Safe to run again.
4. **Rental Item Types tab**: one row per category is there. Add variants if they matter (e.g. *Toilet – IWC*, *Toilet – EWC*) and type the **yard count** of untagged items in *Untagged In Yard*. Tagging lowers it automatically.
5. **Settings tab**: check *First approver* is Ananthu’s code (rental reminders go to him) and *Escalate to* is Sambhu’s.
6. **Stencils**: one set of numerals plus the letters T, S, W, ST, and paint. Manoj picks two fixed spots per item type. Rule: **no tag, no load**.
7. **One test rental end to end**, customer named **“Test Customer …”**: CRE logs → Accounts verifies → Ananthu acknowledges + configures → Manoj tags and loads → Accounts issues the gate pass → Sanju marks it out → Ananthu marks it installed → CRE records the off-hire → Ananthu records suction and the pickup → Sanju marks it in → Manoj inspects → Accounts closes. Then **ICF Admin → Delete rental test entries** removes it, deletes the test-tagged items and puts them back in the yard count.
8. Ten minutes with each person. Sambhu announces that rentals go through the Rentals page from today.

## Rentals already out at go-live

Ananthu (or a Director) enters each one with **+ Already on site** on the Rentals page: customer, site, CRE, the date it was installed, billing, and what is at the site. The items get IDs straight away and show as on hire; rent counts from the installation date. Manoj gets a “not stencilled yet – paint T-0040 on it now” prompt when each item comes back for inspection. An advance entered there goes to Accounts to verify.

## Round 2 (30 Oct 2026) – what changed

Deploy as before: `git pull`, `clasp push`, **New version**. No menu step is needed; the new columns are added to the Rental tabs automatically the first time the page is opened. There is one new file, `rental_dashboard.html`, and `clasp push` sends it.

| What | Who | Where |
|---|---|---|
| **Undo a gate tap** within 30 minutes | Sanju (or the Admin) | Gate page → *Rentals through the gate today* → Undo |
| **Correct an installation or off-hire date**, with a reason | Ananthu / Directors | Rental → Installations / Off-hires → *Correct this* |
| **Undo an installation or off-hire** recorded by mistake | Ananthu / Directors; a CRE can undo their own off-hire on the same day | Same place |
| **Cancel a planned pickup** | Ananthu, Manoj | Rental → Trips → *Cancel pickup* |
| **CRE cover**: the covering CRE sees and acts on the away CRE’s rentals and gets their reminders | Uses the leave cover already set on the Admin page | – |
| **Reassign a rental** to another CRE | Admin | Rental → *Reassign to another CRE* |
| **Standby** for a customer-side delay. Pauses the acknowledge, prepare, install and pickup reminders; rent, overrun and payment reminders keep running. Ends by itself on the resume date. Can move the installation date. | CRE / Manoj ask, Ananthu approves; Ananthu / Directors can set it directly | Rental → *Ask Ananthu for standby*; Ananthu’s **Standby** tile |
| **Loading photo** on a dispatch trip (recommended, not required – `RN_LOAD_PHOTO_REQUIRED` in RentalFleet.js) | Manoj | Prepare and load |
| **Damage photo** – required when an item is marked damaged | Manoj | To inspect → Damaged… |
| **Bill damage** in one tap (charge kind *Damage*); the list shows billed / not billed | Accounts | Rental → Money → *Damage found at inspection* |
| **Bill rent automatically** every week or month (time-based rentals only). At each period end the system raises the rent owed beyond what is paid and already billed (the advance is used first), and emails Accounts and the CRE | CRE sets it at intake | New rental → *Bill the rent automatically* |
| **Rentals card** on the Owner Dashboard | Directors | Dashboard, under *Right now* |

**Billing fix:** rent and overrun now count **toilets only**. Tanks and stands go with the toilet, which matches “rate per toilet” on the intake form. The first build counted every item. The estimates are worked out live, so they correct themselves; only an overrun or rent charge someone already added by hand from the old estimate needs a check.

## Decisions still with Sambhu

Overrun policy (provisional: overrun rate per toilet per day, entered at intake), damage liability (damage is recorded at inspection, nothing is charged automatically), the pickup deadline (provisional: 3 working days, in Settings) and the security deposit (Settings toggle, off).

## If something goes wrong

- **Code**: Deploy → Manage deployments → previous version. One switch. Sales pages are unaffected either way.
- **Data**: rentals live only in their own tabs. The sales tracker, its columns and its tabs are untouched.
