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

## Still on the classic page
These are used less often and stay on the classic page for now:
- payments with an excess amount;
- standby requests;
- verified-payments history;
- refunds report.

The avatar menu has a link back to the classic page.

## Deploy
1. Run `git pull` and then `clasp push`.
2. Go to Deploy → Manage deployments → Edit → New version → Deploy.
3. Open `…/exec?page=accounts-beta` and sign in with an Accounts PIN.
