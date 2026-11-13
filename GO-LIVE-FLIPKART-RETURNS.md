# CRE order filter, Flipkart returns + Flipkart net payout – go-live note (13 Nov 2026)

Code: `Returns.js`, `FollowUps.js`, `Code.js`, `orders_cre.html`, `cre_beta.html`, `flipkart_accounts.html`, `dashboard_beta.html`.

## What changes

| Who | What's new |
|---|---|
| CRE | **My orders → Filters → "Payment terms / order type"** now also has **Flipkart** and **DACC**. |
| CRE | On a Flipkart order, **Returns → "Flipkart sent it back?"** records the return: the kind (courier return before delivery, or a customer return), Flipkart's return / shipment ID, quantity, the reason Flipkart gives, and the expected date. **No admin approval**, because Flipkart has already accepted it and refunds the buyer. A return recorded by mistake can be withdrawn until the packet is in. |
| Sanju (gate) | The packet appears under **Returns – coming in**, as usual. He logs it in and inspects it. If anything is **Repair** or **Scrap**, a Flipkart claim opens. |
| CRE | If there's damage, the return shows **"Damaged – claim it from Flipkart"**. The CRE files the claim on the seller panel and enters the claim ID. Later she records **Approved (₹)** or **Rejected (reason)**, or **Not claiming (reason)**. The return can only be closed once the claim is decided. |
| Accounts | In **Flipkart settlements**, a returned order shows **RETURNED**. If Flipkart won't pay for it, tick it and press **Close ticked as "No payout – returned"**, with no UTR needed. If the order was already settled in a payout before the return, the CRE is told to expect Flipkart to deduct it later. |
| Owner dashboard | Returned / no-payout Flipkart orders count as closed and aren't added to "Settled, last 30 days". |

## On go-live day

1. `git pull`, then `clasp push`, then deploy a **New version**.
2. The **Returns** tab gets 5 new columns at the end (Flipkart Return ID … Flipkart Claim Note). Those cells must be empty, because the headers fill themselves in.
3. Test with a "Test Customer" Flipkart order: record a return, log it in at the gate as **Scrap**, file a claim, mark it Rejected, close the return, then close the order as **No payout** in Accounts.

## Flipkart net payout (added later the same day)

Flipkart pays less than the ₹1,350 sale price. The amount depends on how far away the buyer is (for example ₹1,100 or ₹1,250).

- **Accounts → Flipkart settlements:** ticking an order opens a **"Flipkart paid"** box beside it.
  - Leave it blank if Flipkart paid the full sale price, or type what actually came in.
  - **Any amount is accepted** and nothing is blocked.
  - The pane shows the ticked total ("sale ₹X, received ₹Y, Flipkart kept ₹Z").
  - If the total payout amount is entered, the pane compares it with the orders and only warns if they differ.
- **What's recorded:** the order keeps its sale price, and nothing is ever shown as a balance due. Two new columns record **Flipkart Net Received** and **Flipkart Deductions** (sale − received).
- **Owner dashboard → Flipkart orders:** "Settled, last 30 days" shows what was received against the sale value. The note under the panel shows how much Flipkart kept in total, as a percentage, and per order.

On go-live day: the Tracker gets 2 new columns, **CO and CP**, after the waiver columns (CK–CN). They must be empty, because the headers fill themselves in.
