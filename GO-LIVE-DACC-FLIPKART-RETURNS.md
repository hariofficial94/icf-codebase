# DACC, Flipkart orders and returns – go-live checklist (Oct 2026)

Code: `OrderTypes.js`, `Returns.js`, `orders_cre.html`, `returns_admin.html`, `returns_gate.html`, plus small changes in the existing files.
The new screens are on the **CRE beta page** (`?page=cre-beta`). The classic CRE page still logs standard orders only.

## What changes for each person

| Who | What's new |
|---|---|
| CRE | New PO has **Order type**: Standard / DACC / Flipkart. **Apply return credit** for replacements. In an order: the DACC steps, and **Goods coming back?** to raise a return. Requests view has a **Returns** list |
| Accounts | DACC balances never block the gate pass. The gate pass pop-up pre-fills the DACC transporter. Return refunds appear in the existing **Refunds to process** pane. Orders paid partly by return credit show the credit separately; Accounts verifies only the new money |
| Ops (Manoj) | Flipkart orders arrive without Accounts, marked **Flipkart** with the ship-by date. **Handed over at Flipkart? Record it** replaces the postal form for them. DACC orders show the transporter |
| Sanju (gate) | **Returns – coming in / to inspect / done today** under the gate lists. Logs goods in (count per product) and records restock / repair / scrap / another customer |
| Admin | **Returns** card on the Admin page: approve or decline, write off what the customer never paid for, choose refund / replacement / credit / nothing. Counts in the approvals badge |
| Director | Settings page has a **DACC & Flipkart** group: minimum advance (50%), free days at the transporter (4), reminder (1 day before) |

## On go-live day

1. `git pull`, then `clasp push` from `G:\My Drive\ICF codebase`.
2. **Check the tracker's header row**: the 13 new columns are **BT to CF** (Order Type … Original Order Value). Those cells must be **empty** – the code fills the headers in by itself the first time a page loads. If anything is typed there, move it first.
3. Deploy → Manage deployments → edit the live deployment → **New version**. Same URL.
4. Open any page once (this writes the headers), then in the spreadsheet:
   - **Transporters** tab (created on first use; open the CRE beta New PO form once): Safe Express is there. Add its **email** in column C – the CRE's ready-made DACC-cancellation email goes there. Add more transporters as rows; set Active to N to retire one.
   - **Staff** tab: make sure Sanju (Gate) has an email in column H if he should be told about returns coming in.
5. Settings page → **DACC & Flipkart** → Save once, so the three rows are written to the Settings tab.
6. Test with **Test Customer …** orders (ICF Admin → Delete test entries clears them, including the Returns tabs):
   - DACC: log at 60%, verify, Ops requests the gate pass (it is not blocked), issue it, gate out, mark "at the warehouse", record the balance, release, mark delivered.
   - Flipkart: log a Bio Bacteria order with a ship-by date – it lands straight in Ops' New list. Acknowledge, record the hand-over.
   - Return: on a delivered test order, raise a return, approve it with a refund, log it in at the gate, mark the refund paid, close it.

## How the money works on a return

- **Reduce what the customer owes** writes off unpaid balance at approval (rejected DACC goods, retrieval for non-payment). The order's Total Order Value goes down; the old value is kept in **Original Order Value** and noted in Remarks.
- **Refund** goes to Accounts once Sanju logs the goods in (or at once, if the admin ticks *Refund now*), due within the days the admin sets.
- **Replacement / credit**: the original order is not cancelled or reopened. The CRE logs a new PO with *Apply return credit* = the RT- number. The credit counts as paid, the two orders are linked, and any price difference is an ordinary balance on the new order. Unused credit stays on the return.

## If something goes wrong

- **Code**: Deploy → Manage deployments → previous version.
- **Data**: no existing value is rewritten except where a person acts: a return approval with a write-off changes that order's Total Order Value (old value saved alongside). New tabs: **Transporters**, **Returns**, **Return Lines**.

## Still open – for Sambhu / Hari

- **Damaged Flipkart returns**: the system records the return and the inspection outcome. Whether ICF claims from Flipkart (and how) is not built in.
- **Inventory**: "Restock" is recorded on the return only. It feeds stock once the inventory build exists.
- **Return freight**: ICF bears it. The cost isn't recorded per return yet.
- **DACC partial acceptance**: handled as a return for the rejected lines, with what was accepted typed in. The admin writes off the rejected goods' value so the CRE collects only the accepted part.
