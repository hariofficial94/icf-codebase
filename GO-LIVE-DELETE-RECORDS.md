# Go-live: Admin "Delete a record" (14 Nov 2026)

For entries made by mistake: a duplicate order, the wrong customer, a rental logged twice.

## Where
Admin page (`?page=admin`) → last card, **Delete a record**. Admin only (Directors may call it too; the Admin page itself opens for the Admin).

## How it works
1. Search by quotation no., rental ID, phone or customer name.
2. The pane shows the stage, value and amount received, and everything that will be removed (rows per tab, files, rental items).
3. Warnings appear when money was already received, Ops already picked the order up, or the goods have left.
4. Give a reason, type the ID exactly, and confirm.

## What gets removed
- **Order:** the Tracker row; every row in any tab with a `Tracker ID` or `Came With Order` column naming it (line items, standby, payment exceptions and waivers, cancellations, returns, excess payments, access requests, Activity Log, Notification Log); its files (all Wrapper PO copies, gate pass, postal receipt, CRM PO, customer PO) go to the Drive trash. If it used a return credit, the credit goes back to the return.
- **Rental:** every Rental tab, the log lines, the agreement, photos and gate passes. Items are **released back to the yard, never deleted** (their ID is stencilled on). Lost, scrapped and under-repair units keep their status; only the link goes.

## What is kept
One line per deletion in the **Deletion Log** tab (created on first use, at the end): when, Order/Rental, the ID, customer, the stage it was at, who deleted it, and why. No dashboard or list reads this tab. Its ID column is headed `Deleted ID`, so no clean-up or report ever treats it as order data.

## Blocked
An order whose return gave credit to another order that still exists. Delete or correct that other order first.

## Setup
None. Pull, `clasp push`, then test once with a **Test Customer …** order before using it on a real entry.
