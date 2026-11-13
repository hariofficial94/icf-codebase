# Balance waivers + CRE payment requests – go-live checklist (13 Nov 2026)

Code: the new `Waivers.js` and `waive_admin.html`, plus small changes in `Code.js`, `Ops.js`, `Locks.js`, `FollowUps.js`, `Standby.js`, `admin.html`, `cre_beta.html` and `dashboard_beta.html`.

## What changes for each person

| Who | What's new |
|---|---|
| Admin (Ananthu) | **Admin page → "Waive a balance"**. Find the order, see what's still due, give a reason, and waive it. Up to the limit, it applies at once. Above the limit, it goes to the directors. Recent waivers are listed under the card. |
| Directors | **Settings → Approvers → "Admin: waive a balance up to (₹)"**. The default is ₹100, and 0 sends every waiver to a director. Waivers over the limit appear on the dashboard under **Waiting for a director**, with Approve and Decline buttons. |
| CRE | **Requests → "Payment requests"**: every request she sent about money ("dispatch without full payment", "balance after delivery"), plus any payment approval or waiver on her orders. It shows whether each is waiting, approved or declined. A decline also counts on the Requests badge. |
| Accounts / CRE | An email (or a Notification Log entry) when a balance on one of their orders is waived. |
| Owner dashboard | The money card's footer shows the **total waived** and on how many orders. Click it for the list. |

## What a waiver does to the order

- **Total Order Value** goes down by the waived amount, so every balance check sees nothing left to pay. The billed value is kept in **Original Order Value**. The waiver is written in the new columns (**Waived Amount / By / At / Reason**) and in **Remarks**. The request is a row in **Payment Exceptions** (type `WAIVE_BALANCE`).
- If the order is waiting at **Ready – payment pending**, it goes straight back to Ops as **Cleared** so the gate pass can be requested. A courier order **On Hold – Balance Due** goes to Ops.
- If the order is already delivered, it simply closes.
- A waiver waiting for a director does **not** lock the order.
- **Not for TDS.** TDS is still owed until the certificate comes.

## On go-live day

1. `git pull`, then `clasp push`.
2. **Tracker header row:** the 4 new columns are **CK to CN** (Waived Amount … Waive Reason). They must be empty, because the code writes the headers.
3. Deploy → Manage deployments → edit the live deployment → **New version**.
4. A director opens **Settings** and saves the waiver limit once.

## K V Jacob & Sons (ICESPL-6678-R1-26-27)

Waive the ₹20 from the Admin page with the reason "bank charges". The order goes back to Ops as Cleared. The goods have already gone, though, so the gate pass and gate-out still need recording: either through the normal steps (they will carry today's date), or by correcting the dates in the sheet once.

## If something goes wrong

- **Code:** Deploy → Manage deployments → previous version.
- **Data:** a waiver changes only the order it was applied to (Total Order Value, the new columns and Remarks). To undo one, set Total Order Value back to Original Order Value and clear the four Waived columns.
