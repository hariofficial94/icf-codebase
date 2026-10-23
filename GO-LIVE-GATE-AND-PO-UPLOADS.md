# Gate login + PO uploads – go-live checklist (Oct 2026)

What changes for each person:

| Who | Before | After |
|---|---|---|
| CRE | Logged the order | Also attaches the **CRM PO** (always) and the **customer's PO** (required for PO Customer orders), as a PDF or photo, on the intake form. Can upload a missing one later, or replace one before Accounts verifies, from Look Up an Enquiry. Delivery follow-up opens only once the vehicle has left the gate. |
| Accounts | Verified from the CRE's figures | On the verify screen: **Step 1 – Print CRM PO** (required; the system records who printed it and when), **Step 2 – check the printout** (address, products, amounts) and tick, then verify. Can't verify while a required PO is missing or before printing. Keeps the printout for Ops. |
| Ops (Manoj) | – | After printing the Internal PO, **collects the printed CRM PO from Accounts and attaches it**. The Ops page reminds him, naming who printed it. They travel together through the factory until dispatch. Open / Print buttons for both POs if a copy is needed. |
| Sanju (gate) | Checked the paper gate pass | Signs in at `…/exec?page=gate` on his phone. Checks the paper gate pass against the card and taps **Vehicle left**. The system records that moment as the dispatch time and sets the order to **In Transit**. A wrong tap can be undone within 30 minutes. |

## On go-live day

1. `git pull`, then `clasp push` from `G:\My Drive\ICF codebase`.
2. Deploy → Manage deployments → edit the live deployment → **New version**. The URL stays the same.
   - PO uploads start working straight away. Orders already logged but not yet verified need the CRE to upload the CRM PO from Look Up before Accounts can verify them. Tell the CREs this.
   - Gate passes keep working the old way until step 3.
3. In the spreadsheet: **ICF Admin → Gate login + PO uploads: set up and go live**. It:
   - writes 6 new tracker headers after "Balance After Delivery" (it stops and changes nothing if those cells hold anything else)
   - adds "Gate" to the Role dropdown and a row **GATE001 Sanju**
   - creates the Drive folder **ICF Order POs**
   - switches the gate login on. From then on, issuing a gate pass no longer stamps the dispatch time. The gate does. Gate passes issued before this are left as they are.
4. **Staff tab**: type Sanju's PIN in column E of the GATE001 row.
5. Bookmark `…/exec?page=gate` on Sanju's phone and sign him in once.
6. **Dummy run**: CRE logs a test order with a PO photo → Accounts prints it, ticks, verifies → Ops picks it up and collects the printout → … → Accounts issues the gate pass → it appears on Sanju's list → he taps Vehicle left → the CRE sees In Transit. Cancel the test order before the gate pass, or use a real one.

## If something goes wrong

- **Code**: Deploy → Manage deployments → choose the previous version.
- **Data**: nothing existing is rewritten. Only new columns are added. Uploaded files sit in the ICF Order POs folder. Replaced files are renamed "(replaced …)", never deleted.
- To switch the gate login back off, delete the script property `gate_go_live_ms` (Project Settings → Script properties). Gate passes then stamp the dispatch time again.

## Gate nudge (in the web app only)

- A vehicle normally leaves within about 3 hours of its gate pass. If it isn't marked out after **6 office hours**, it shows **red** on Sanju's gate page with a banner at the top. A red **"⚠ N vehicles not out at the gate"** badge also appears in the bar of every page for the admins (Ananthu) and links to the gate page. An admin can mark the vehicle out there on Sanju's behalf.
- The hours are counted in office hours only, so a gate pass issued at 5 PM isn't flagged overnight. Directors can change the number on the Settings page under "Ops nudges" ("Gate: flag a vehicle not out within (office hours)", 1–48). The setup step adds this row.
- No email or WhatsApp is sent.

## Decisions (Hari, 23 Oct 2026)

- Ops may see prices on the CRM PO.
- Verification stays blocked until the CRE uploads the PO.
