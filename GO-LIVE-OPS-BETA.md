# Go-live: Operations page beta with the Flipkart lane (14 Nov 2026)

## Where
`?page=ops-beta`. Ops signs in as usual (same staff code and PIN as the classic Ops page, which stays untouched at `?page=ops`).

## What's new
- **Flipkart lane on top, as a collapsible bar.** The bar shows the counts (to pack, waiting for the run, handed over today). Tap it to open the three columns: **To pack → Packed, waiting for the run → Handed over today.** Flipkart orders no longer appear in any other Ops list.
- **The bar turns red** while anything is waiting to be packed, and amber when a run isn't confirmed. **It opens by itself when a new order lands** (and on sign-in if anything is waiting). Otherwise it stays the way Manoj left it. The browser tab shows the count. The page refreshes every minute.
- **Packed · RTD**: one tap records the time and who. For Flipkart this is also the pickup. **No Internal PO** for Flipkart orders, on the classic page too.
- **Going with**: tick the packed parcels and choose who is taking them: Ops staff or the Admin (Manoj or Ananthu today), or **Someone else** with a typed name and phone. The card shows a **Call** button.
- **Mark handed over**: when the carrier calls or messages Manoj, tick the parcels and save. It's the same hand-over record as before: status Posted, delivery In Transit, and the Flipkart order ID as the shipment number.
- **Undo**: an order marked packed by mistake can go back to To pack, from the order screen.
- Same dark/light look as the CRE and Accounts beta pages (it shares their theme setting).

## Reminders (emails, office hours only)
| When | To |
|---|---|
| Not packed after **2 office hours** | Ops |
| Not packed after **4 office hours** | First approver, Ops copied |
| Packed but hand-over not recorded by **11:00 the next working day** | Ops, first approver copied (the card also turns red) |

All three numbers are on the **Settings** page under *DACC & Flipkart*. The existing "ship by today" and "late for Flipkart" emails continue. Flipkart orders no longer get the general 24-hour pickup and posting reminders, since these replace them.

## Data
Four new tracker columns are added automatically at the end: *Flipkart Packed At, Flipkart Packed By, Flipkart Carrier, Flipkart Carrier Phone*. Nothing existing is rewritten.

## Setup
None. Pull, `clasp push`, and ask Manoj to try `?page=ops-beta` alongside the classic page. Test with a **Test Customer …** Flipkart order.
