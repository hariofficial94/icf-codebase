# Workflow follow-ups: go-live checklist (13 Nov 2026)

These changes come from the 13 Nov workflow review. That review asked, stage by stage, whether anyone is blind at any point.
Code: the new `FollowUps.js` and `flipkart_accounts.html`, plus small changes in `Code.js`, `Ops.js`, `Cancellations.js`, `OrderTypes.js`, `Standby.js`, `ops.html`, `cre_beta.html`, `accounts.html`, `dashboard_beta.html` and `settings.html`.

## What changes for each person

| Who | What's new |
|---|---|
| Ops (Manoj) | **No more "Site not ready – hold".** When requesting the gate pass, Ops ticks that the customer confirmed the site is ready. If the site isn't ready, Ops asks for **standby** and an admin decides. Orders already on the old hold stay under a "Site not ready (old)" tile until they move. That tile disappears once it's empty. **New tile "Cancelled – clear out"**: an order cancelled after Ops picked it up shows here. Ops unloads the goods, bins the Internal PO and the CRM PO printout, and taps **Cancelled order cleared**. If a request is waiting for the admin (for example a cancellation), the order card says **Locked**, and Ops isn't reminded or escalated about it. |
| CRE | **Needs Action** also shows: courier orders held for the balance ("collect ₹X so Ops can post it"), orders Accounts can't verify because a PO is missing, and deliveries not confirmed 2+ days after the wanted-by date. **Requests → "Orders on standby"**: every standby on the CRE's orders, with reason, dates and status. A small "On standby" block also shows on the home page while something is paused. |
| Accounts | New **Flipkart settlements** pane, under Refunds to process. When Flipkart's monthly payout arrives, tick the orders it covers, enter the UTR and date, and save. That closes those orders. Reminder emails come for orders not verified within 4 office hours. |
| Ananthu (first approver) | Escalation emails for: orders not verified within 1 working day, courier balances not collected in 3 working days, deliveries not confirmed 5 days after the wanted-by date, cancelled orders Ops hasn't cleared in 2 working days, refunds past their deadline, and cancellation or return requests left waiting. Messages meant for a CRE who is no longer active now come to him instead of going nowhere. |
| Owner dashboard | **Flipkart orders have their own panel**, under the pipeline, and are left out of every other figure (money, pipeline, stuck, departments, states, trend, products). **Faster:** the top of the page (money, right now, pipeline, Flipkart) draws first. The sections below draw when you scroll to them or when the page is idle, and product data loads only when that panel is needed. |
| Directors | Settings page has a new **Follow-ups** group with all the timings above. |

## On go-live day

1. `git pull`, then `clasp push` from `G:\My Drive\ICF codebase`.
2. **Check the tracker's header row.** The 4 new columns are **CG to CJ** (Flipkart Settlement … Flipkart Settled At). Those cells must be **empty**, because the code writes the headers itself. On the **Order Cancellations** tab, columns **Z to AD** must be empty too.
3. Deploy → Manage deployments → edit the live deployment → **New version**. The URL stays the same.
4. Open any page once (this writes the headers). Then open **Settings → Follow-ups** and press **Save** once.
5. **Staff tab:**
   - Add emails in column H. Only Sony, Sambhu and Ananthu have one today, so most reminders to the CREs and Ops currently only reach the Notification Log.
   - Give Adarsh his own code. **CRE003 is used twice** (Pavithra and Adarsh).
   - Set Test CRE to Active = N if it's no longer needed.
6. **Flipkart backlog:** every Flipkart order logged so far shows as awaiting settlement. Accounts ticks off the past payouts once (one save per payout) to clear the list.

## The first day

- The first alert check after deployment marks the go-live time. Waiting times for verification and courier balances count from then, so the old backlog doesn't arrive as dozens of separate emails.
- **Delivery reminders are different.** They count from the wanted-by date, so orders that were already overdue arrive as **one list per CRE and one list for Ananthu** on the first run. That list is the clean-up to-do: mark them delivered or chase them.

## Test with "Test Customer …" orders

- **Site:** pick up a vehicle test order and try to request the gate pass without ticking the site box. It refuses and points to standby.
- **Cancellation:** pick up a test order, raise a cancellation (CRE), and approve it (admin). It should appear under Ops → Cancelled – clear out. Clear it.
- **Courier balance:** log a Bio Bacteria order with a part advance and verify it. The CRE should see it in red in Needs Action.
- **Flipkart:** log one and record the hand-over. It should show in Accounts → Flipkart settlements, and on the dashboard under Flipkart only. Settle it with a test UTR.

## If something goes wrong

- **Code:** Deploy → Manage deployments → choose the previous version.
- **Data:** nothing existing is rewritten. New columns are added at the ends of the Tracker and Order Cancellations tabs. Reminder marks go into the existing "Ops Alerts Sent" column. Rolling back the code stops every new reminder; the new columns can simply stay.

## Still open

- The classic dashboard (`?page=dashboard`) still counts Flipkart with the other orders. Only the beta, which the owner uses, keeps it apart.
- The Accounts reminder for unverified orders is email-only (Sony has an email). Everything else also shows inside the app.
- WhatsApp (stage 2) will carry all of these messages. They already go through `notify_` and the Notification Log.
