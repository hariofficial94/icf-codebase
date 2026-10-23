# Gate login + PO uploads – go-live checklist (Oct 2026)

What changes for each person:

| Who | Before | After |
|---|---|---|
| CRE | Logged the order | Also attaches the **CRM PO** (always) and the **customer's PO** (required for PO Customer orders), as a PDF or photo, on the intake form. Can upload a missing one later, or replace one before Accounts verifies, from Look Up an Enquiry. Delivery follow-up opens only once the vehicle has left the gate. |
| Accounts | Verified from the CRE's figures | Opens the CRM PO from the verify screen, checks the address, products and amounts, ticks the box, then verifies. Can't verify while a required PO is missing. Open / Print on any order afterwards. |
| Ops (Manoj) | – | Open / Print buttons for both POs on the order, once picked up. |
| Sanju (gate) | Checked the paper gate pass | Signs in at `…/exec?page=gate` on his phone. Checks the paper gate pass against the card and taps **Vehicle left**. The system records that moment as the dispatch time and sets the order to **In Transit**. A wrong tap can be undone within 30 minutes. |

## On go-live day

1. `git pull`, then `clasp push` from `G:\My Drive\ICF codebase`.
2. Deploy → Manage deployments → edit the live deployment → **New version**. The URL stays the same.
   - PO uploads start working straight away. Orders already logged but not yet verified need the CRE to upload the CRM PO from Look Up before Accounts can verify them. Tell the CREs this.
   - Gate passes keep working the old way until step 3.
3. In the spreadsheet: **ICF Admin → Gate login + PO uploads: set up and go live**. It:
   - writes 5 new tracker headers after "Balance After Delivery" (it stops and changes nothing if those cells hold anything else)
   - adds "Gate" to the Role dropdown and a row **GATE001 Sanju**
   - creates the Drive folder **ICF Order POs**
   - switches the gate login on. From then on, issuing a gate pass no longer stamps the dispatch time. The gate does. Gate passes issued before this are left as they are.
4. **Staff tab**: type Sanju's PIN in column E of the GATE001 row.
5. Bookmark `…/exec?page=gate` on Sanju's phone and sign him in once.
6. **Dummy run**: CRE logs a test order with a PO photo → Accounts opens it, ticks, verifies → … → Accounts issues the gate pass → it appears on Sanju's list → he taps Vehicle left → the CRE sees In Transit. Cancel the test order before the gate pass, or use a real one.

## If something goes wrong

- **Code**: Deploy → Manage deployments → choose the previous version.
- **Data**: nothing existing is rewritten. Only new columns are added. Uploaded files sit in the ICF Order POs folder. Replaced files are renamed "(replaced …)", never deleted.
- To switch the gate login back off, delete the script property `gate_go_live_ms` (Project Settings → Script properties). Gate passes then stamp the dispatch time again.

## Later (agreed with Hari, 23 Oct 2026)

- **Gate nudge**: a vehicle normally leaves within about 3 hours of its gate pass. If it isn't marked out after 6–8 office hours, nudge Sanju and Ananthu. It would hook into the 10-minute sweep (`opsSweep_`), the same way the Ops nudges do.
- Settled: Ops may see prices on the CRM PO, and verification stays blocked until the CRE uploads the PO.
