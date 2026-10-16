# Ops login – go-live checklist (Oct 2026)

What changes for each person:

| Who | Before | After |
|---|---|---|
| CRE | Logged the order, printed the Wrapper PO, recorded the postal receipt for courier orders | Logs the order (no print). Ticks customer consent and adds an email if there is one. Takes over at delivery follow-up, as before |
| Accounts | Verified, then typed in Ops' pickup time + vehicle from the returned paper, then issued the gate pass | Verifies (no print). Issues the gate pass only when Ops has requested it – it shows in Needs Action |
| Ops (Manoj) | Got the paper, wrote the pickup time on it | Signs in at `…/exec?page=ops`. Taps **Acknowledge & pick up** (the system stamps the time), prints the PO, writes the verification code on it. Requests the gate pass with the vehicle no. Records courier posting with a receipt photo. Raises standby for customer delays |
| Admin / Director | – | Can put an order on standby directly (Admin page or dashboard) |
| Sanju (gate) | Checks the gate pass | No change – still the check that nothing leaves without the system |

## On go-live day (a quiet day)

1. **Get the code into Apps Script**: `git pull`, then `clasp push` from `G:\My Drive\ICF codebase`.
2. **Optional look before deploying**: the `/dev` test link (Deploy → Test deployments) shows the new pages with the new code. Ops buttons stay locked until step 4, so nothing gets written early.
3. **Deploy**: Deploy → Manage deployments → edit the live deployment → **New version**. The URL stays the same.
4. **Straight after**, in the spreadsheet: **ICF Admin → Ops login: set up and go live**. It:
   - makes a full backup copy of the spreadsheet first (link shown in the pop-up)
   - writes the 9 new column headers AW–BE (it stops and changes nothing if those cells hold anything else)
   - adds "Ops" to the Role dropdown and a row **OPS001 Manoj**
   - adds the Ops nudge rows to Settings (24 h / 48 h) and creates the **Notification Log** tab
   - marks the orders already with Ops as **cutover**: they show as "With Ops", get no false "overdue" alerts, and stay out of the pickup-time figures
5. **Staff tab**: type Manoj's PIN in column E of the OPS001 row. Add his email in column H if he has one (otherwise his alerts are only logged), and his phone in the Phone column.
6. **Optional, when Sambhu decides**: Settings tab rows *Customer messages: escalation level 2 / level 3*.
7. **Run one dummy order end to end**: CRE logs it, Accounts verifies, Ops picks it up and requests the gate pass, and it shows in Accounts' Needs Action. Don't issue its gate pass: cancel it through the normal cancellation request, which only works before dispatch.
8. Ten-minute walkthrough with each person. Sambhu announces the change.

Steps 3 and 4 belong together. Once the new version is live, Accounts no longer has the pickup form.

## If something goes wrong

- **Code**: Deploy → Manage deployments → choose the previous version. One switch.
- **Data**: nothing existing is rewritten. Only new columns AW–BE are added, plus the cutover "Y" marks. The backup copy made in step 4 is the full sheet as it was.

## Stage 2 (not in this build)

WhatsApp sending. All messages already go through one place (`notify_` in `Ops.js`) and are written to the **Notification Log**. Customer messages sit there as *Queued for WhatsApp (stage 2)*. Stage 2 adds the sender, plus approve/reject buttons for admins and alerts for orders aging at a stage.
