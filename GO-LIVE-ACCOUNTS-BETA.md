# Accounts page – new layout (beta)

Opened with `…/exec?page=accounts-beta`. The classic Accounts page (`?page=accounts`) is unchanged, and both show the same live data.

## What it does
- **To do (home):** one list of everything that is waiting on Accounts, with the most urgent first. Tabs filter it by kind:
  - **Verify** – orders that were logged and need their payment checked. The CRM PO has to be printed and ticked first, as before.
  - **Payments in** – the CRE says the customer has paid. Lines where the goods are ready and only the payment is missing come first.
  - **Gate passes** – Ops has asked for one. If a balance is still due, the line says to record the payment first.
  - **Refunds** – approved refunds, with the days left before each is due.
  - **Admin replies** – the admin has approved or declined a request from Accounts.
  - **Flipkart** – orders that have been handed over and are waiting for Flipkart's monthly payout. You enter what Flipkart actually paid for each order, and any amount is accepted.
- Click a line to open a panel on the right with the action for that line: verify, record a payment, generate the gate pass, mark the refund paid, or match the Flipkart payout.
- **Pending payments** (second icon on the left) lists every order with a balance still due.
- **Find any order** (top bar, Ctrl K) searches by quotation number, phone number or customer name.
- **Grey lines** are waiting on someone else, such as the admin or the CRE. They don't count towards the red badge.

## Also in the beta (13 Nov 2026 update)
Everything that was only on the classic page is now here too:
- **Pending payments filters:** search, payment terms (including Flipkart and DACC), stage, CRE, and sort order. The total due updates to match the filters.
- **On standby** (third icon on the left): orders paused for the customer and standby requests waiting for a decision. From an order's panel you can request standby, or resume it early.
- **Verified payments** (fourth icon on the left): history with a date range and filters for CRE, type, who verified it, and a search box.
- **Payment with excess:** when the bank amount is more than the order needs, either at verification or when recording a payment. It goes to an admin first.
- **Withdraw request:** a locked order shows what it is waiting for and lets you withdraw the request.
- **Timeline** on every order.
- **Courier orders on hold for their balance** now appear in the To do list.
- The **At a glance** panel can be hidden (the icon at its top right) and brought back (the tab on the right edge). The page remembers your choice.

Nothing on the Accounts side needs the classic page any more. It stays available until the team has switched over.

## Deploy
1. Run `git pull` and then `clasp push`.
2. Go to Deploy → Manage deployments → Edit → New version → Deploy.
3. Open `…/exec?page=accounts-beta` and sign in with an Accounts PIN.
