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

Finish them the old way. The system has no step yet for items that are already at a site, so logging them would leave them stuck at “in transit”. When their items come back to the yard, count them into *Untagged In Yard*; they get IDs the next time they go out. If many long rentals are out, a one-time “already installed” import can be added.

## Decisions still with Sambhu

Overrun policy (provisional: overrun rate per item per day, entered at intake), damage liability (damage is recorded at inspection, nothing is charged automatically), the pickup deadline (provisional: 3 working days, in Settings) and the security deposit (Settings toggle, off).

## If something goes wrong

- **Code**: Deploy → Manage deployments → previous version. One switch. Sales pages are unaffected either way.
- **Data**: rentals live only in their own tabs. The sales tracker, its columns and its tabs are untouched.
