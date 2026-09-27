# Airtime & Data Expense Claim App

Google Apps Script web app for employee airtime/data claims with supervisor approval, HR verification, and sheet-driven Finance payment tracking.

## Project files

- `Code.gs` contains authentication, rates/eligibility, claim tracking, notifications, decisions, and Finance payment handling.
- `Index.html` contains the employee sign-in/claim form and the single-use email decision page.
- `appsscript.json` configures the Apps Script runtime and public web-app entry point.

## Create the spreadsheet

1. Create a Google spreadsheet owned by the account that will deploy and operate the app.
2. Open **Extensions > Apps Script**, replace the starter files with this project, and enable **Show appsscript.json manifest file** in Project Settings.
3. Run `setupApplication()` from the Apps Script editor and approve its requested spreadsheet, email, and trigger permissions. It creates `Employee Master`, `Grade Limits`, `Claims Tracker`, and `App Config` tabs. Run it from a script bound to the claims spreadsheet.
4. Populate `Employee Master` with one row per employee using the exact headers created by setup: `Employee ID`, `Full Name`, `Email`, `Department`, `Grade`, `Designation`, `Supervisor Name`, `Supervisor Email`, `Active`. Use each employee's `@indorama.com` email and set `Active` to `Y`. Running `setupApplication()` removes the obsolete `Password` or `Password Hash` column from this sheet.
5. Populate `Grade Limits` with the confirmed company rates. Set `Has Fixed Cap (Y/N)` to `Y` only when both category limits are known. A non-`Y` value treats claims as uncapped and flags them for manual review; a missing grade row or incomplete fixed rate blocks submission.
6. In `App Config`, set `HR_EMAIL` to the HR verification mailbox. After deploying, set `WEB_APP_URL` to the deployment URL. The web-app URL is needed to construct decision links in approval emails.

The rate lookup ignores case, spaces, punctuation, and an optional `Grade` prefix, and accepts the standard rate headers shown above plus common shortened versions (for example, `Airtime Limit`). Rate values may be numeric cells or currency-formatted text. Each claim category is checked against its own grade limit; an over-cap category blocks submission, while uncapped grades continue through manual review. After changing Apps Script code, create a new deployment version (or edit the current deployment to use the new version) before testing; an existing deployment continues running its deployed version.

Do not deploy with invented or placeholder employee records, rates, or HR addresses. The BRD confirms Grade VI at NGN 25,000 airtime and NGN 25,000 data; enter it using the exact grade code present in Employee Master. Confirm remaining rates with Admin/HR before go-live. Grades with no fixed cap should be configured with `N` and are passed to approvers for manual review.

## Deploy

1. Select **Deploy > New deployment > Web app**.
2. Set **Execute as** to the deploying/owner account and **Who has access** to **Anyone**, including anonymous users. This is required so decision links work without a Google sign-in; employee claimants prove access to their registered company email using a one-time code. Workspace policy may disable anonymous web apps; confirm this with the Workspace administrator if the option is unavailable.
3. Deploy, copy the web-app URL into `App Config` as `WEB_APP_URL`, and authorize the app owner to send mail and update the tracker.
4. Verify with test accounts and non-production rates: company-domain validation, email code delivery/expiry/attempt limit, eligibility and manual-review paths, missing supervisor/HR configuration, duplicate period submission, HOD approve/decline, HR verify/reject, repeated decision links, and Finance marking a verified claim `Paid`.

## Claim lifecycle

Submission creates one `Pending Supervisor` tracker row and emails the mapped supervisor. Supervisor approval sends the same claim to HR; decline ends the flow. HR verification changes the claim to `Verified - Awaiting Payment`; rejection ends the flow. Finance sets `Finance Status` to `Paid` in the tracker and the installed edit trigger records `Payment Date`, changes `Overall Status` to `Paid`, and emails the employee.

Decision links contain random, single-use tokens; only SHA-256 token hashes are stored in the tracker. A repeated click displays an already-actioned message. Sign-in codes are emailed only to active employees whose roster email ends exactly in `@indorama.com`; codes expire after five minutes and are limited to five verification attempts. The email endpoint is public, so review Apps Script quotas and organizational abuse controls before production.

If a decision or employee notification email fails after a tracker update, the app preserves the claim/decision, reports the delivery issue in the interface when applicable, and records a failure note in `Remarks` for Admin/HR follow-up.

## Operational notes

- Keep Employee Master supervisor mappings, employee active status, rates, and the HR mailbox current.
- Finance should only set a claim to `Paid` after HR verification.
- Back up and archive the tracker according to the company retention policy; that policy is not defined in the BRD.
- Apps Script quotas apply to email delivery, execution time, and spreadsheet operations. Monitor Apps Script executions and failed notifications after deployment.