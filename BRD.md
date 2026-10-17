# Business Requirements Document

## Airtime and Internet Data Expense Claim Application

**Version:** 1.0  
**Status:** Draft for business review  
**Business owner:** To be confirmed  
**System owner:** HR / Apps Script administrator  
**Last updated:** 2026-10-15

## 1. Executive Summary

The Airtime and Internet Data Expense Claim Application replaces email, paper, and ad-hoc spreadsheet submissions with a Google Apps Script web app backed by a Google spreadsheet. Employees authenticate using their Employee ID and a one-time code sent to the company email recorded in Employee Master. The app checks grade-based rates, creates one tracker row per claim, and routes the request for approval.

Normal employee claims follow the Reporting Supervisor (HOD) to HR workflow. Qualified managers (Grade V or above and designated Team Leader or HOD) may submit on behalf of an active direct report. Such claims identify both claimant and submitter, bypass the supervisor approval step, and go directly to HR. A registered account officer records reimbursement in the app after HR verification. An admin assigns the Employee, Account Officer, and Admin roles.

## 2. Business Objectives

- Reduce employee claim preparation and submission effort.
- Check grade limits before a claim is submitted for approval.
- Route employee claims to the reporting supervisor recorded in Employee Master.
- Let eligible Team Leaders and HODs submit for direct reports when needed.
- Provide HR and supervisors with secure, single-use email decision links and comment entry.
- Maintain one row-wise tracker as the audit record for submission, decisions, and payment.
- Notify the employee of submission and decision outcomes by email.

## 3. Scope

### 3.1 In Scope

- Airtime and mobile data expense claims.
- Employee ID sign-in verified by a one-time code sent to the employee's registered `@indorama.com` address.
- Employee and reporting-manager data sourced from Employee Master.
- Grade-based airtime and data caps, including uncapped grades routed for manual review.
- Regular employee approval: Supervisor (HOD) followed by HR verification.
- Manager submission on behalf of an active, directly reporting employee, subject to Grade V+ and Team Leader/HOD designation.
- Single-use tokenized email decisions without requiring the approver to sign in.
- A single Claims Tracker row created at submission and updated at each stage.
- Account-officer reimbursement of HR-verified claims, recorded on the tracker.
- Employee and submitting-manager notifications where applicable.

### 3.2 Out of Scope

- Payroll or bank-run integration.
- Native mobile applications.
- Bulk submission or historical-claim migration.
- Automated Finance payment confirmation beyond tracker entry.
- Escalation and delegation rules beyond the defined supervisor, HR, and manager-on-behalf paths.
- Employee claim-history portal.

## 4. Stakeholders and Roles

| Role | Eligibility / Source | Responsibilities |
|---|---|---|
| Claimant | Active employee in Employee Master | Sign in, submit a personal claim, provide period, amounts, and justification, and receive status emails. |
| Reporting Supervisor (HOD) | Supervisor mapped in Employee Master | Approve or decline a regular employee claim and optionally comment. |
| Team Leader / HOD submitting on behalf | Active employee, Grade V or above, and Designation identifies Team Leader or HOD | Select an active direct report and submit that employee's claim directly to HR. The manager is recorded as submitter, not claimant. |
| HR Verifier | HR mailbox configured in App Config | Verify or reject supervisor-approved or manager-submitted claims and optionally comment. |
| Account Officer | Active employee whose Employee Master Role is Account Officer | Sign in and mark HR-verified claims as reimbursed. The tracker records Finance Status, Payment Date, Overall Status, and the officer who recorded it. |
| Admin | Active employee whose Employee Master Role is Admin | Assign Employee, Account Officer, and Admin roles. May also record reimbursement. |
| Finance sheet editor | Authorized Claims Tracker editor | May still set Finance Status to Paid directly in the tracker after HR verification. The installed edit trigger completes the paid status. |

## 5. Process Overview

### 5.1 Employee Personal Claim

1. Employee enters Employee ID.
2. The app checks for an active matching record and a valid registered company email.
3. The app emails a six-digit sign-in code to the registered address. The code expires after five minutes and allows up to five verification attempts; a new code request is limited by a one-minute cooldown.
4. After successful verification, the claim form displays the recorded employee details.
5. Employee enters claim period, airtime amount, data amount, and justification.
6. The app checks the employee's grade rates. Fixed-cap amounts are checked against their respective airtime and data caps. Uncapped grades are flagged for manual review.
7. Submission creates one tracker row with Overall Status Pending Supervisor and emails the mapped supervisor.
8. Supervisor approves or declines using the single-use email link and may enter a comment.
9. On approval, the same tracker row is updated and HR receives a Verify/Reject email. On decline, the flow ends.
10. HR verifies or rejects. Verification sets the status to Verified - Awaiting Payment; rejection ends the flow.
11. An account officer or admin marks the verified claim reimbursed in the app. Finance Status becomes Paid, Payment Date and Overall Status are recorded, and the employee is notified.

### 5.2 Manager Claim on Behalf of a Direct Report

1. A qualified manager signs in using the normal Employee ID and email-code process.
2. The claim form presents the on-behalf selector. The app lists only active employees whose Supervisor Email matches the manager's registered company email.
3. The manager selects the employee, enters the claim period, amounts, and justification, and sees eligibility based on the selected employee's grade.
4. The server independently validates manager eligibility and the direct-report relationship during rate lookup and submission.
5. Submission creates one tracker row for the employee, records the manager in Submitted By fields, marks HOD Status as bypassed, and sets Overall Status to Pending HR.
6. HR receives the decision email directly. No supervisor approval email is sent for this path.
7. HR verifies or rejects; Finance then records payment as in the personal-claim process.

If the qualified manager has no active direct reports mapped to their email, the on-behalf section remains visible and explains that HR must update Supervisor Email in Employee Master. The manager cannot submit for an arbitrary employee ID.

## 6. Business Rules

1. Employee authentication is based on Employee ID and a one-time code sent only to the active employee's registered `@indorama.com` address. Password authentication is not used.
2. Employee ID matching is case-insensitive after trimming. Employee account Active must be Y.
3. Sign-in code lifetime is five minutes, with a maximum of five verification attempts and a one-minute resend cooldown.
4. Fixed-cap eligibility is evaluated independently by category: Airtime Claimed must not exceed Airtime Limit, and Data Claimed must not exceed Data Limit. An over-cap category blocks submission.
5. For uncapped grades marked Has Fixed Cap = N, claims are allowed through and flagged Needs Manual Review. No fixed-rate value should be invented for these grades.
6. Recommended amount for fixed-cap claims is the sum of the lesser of each claimed category and its category limit. For manual-review claims, the full total is forwarded for discretion.
7. A normal employee submission requires a valid Supervisor Email mapping. Missing mapping blocks submission.
8. A manager may submit on behalf only if the manager is active, has Grade V or above, has a Designation identifying Team Leader or HOD, and the selected active employee's Supervisor Email matches the manager's registered email.
9. Manager-on-behalf claims bypass HOD approval and route directly to HR. The employee remains claimant; the manager is recorded as submitter.
10. One open claim is permitted per employee per claim period. Pending Supervisor, Pending HR, Verified - Awaiting Payment, and Paid block another submission for that month. A claim declined by the supervisor or rejected by HR does not block a new claim for the same month.
11. Decision tokens are single-use and tied to a tracker row and stage. A reused token must not change the row again.
12. Decisions update the existing claim row; they do not create a second row.
13. An account officer or admin may mark a claim reimbursed only after HR verification. Payment Date is recorded in the same row. Employees cannot record reimbursement. A blank Role is treated as Employee. At least one active Admin must remain.
14. Claim write/decision outcomes remain recorded if email notification fails. The failure is reported or logged in Remarks for follow-up.

## 7. Functional Requirements

### BR1 - Authentication

- The sign-in screen shall request Employee ID and a six-digit verification code.
- The application shall look up the active employee and send the code to the Email value stored in Employee Master, only if the address ends in `@indorama.com`.
- An invalid or inactive Employee ID shall not receive a code. The response should avoid disclosing whether an ID exists.
- Missing or invalid company email on an active employee record shall display a clear instruction to contact HR to update Employee Master.
- Codes shall expire, have limited attempts, and be invalidated after successful verification.

### BR2 - Claim Form and Employee Details

- Required inputs: claim period, airtime claimed, data claimed, and justification.
- Amounts shall be non-negative, and at least one category shall be greater than zero.
- Employee name, email, department, grade, designation, and supervisor shall be sourced from Employee Master, not accepted as editable claimant identity values.
- Eligible managers shall be able to select a direct report for an on-behalf claim.

### BR3 - Rate Lookup and Eligibility

- The app shall match the Employee Master grade to Grade Limits.
- The app shall display the airtime and data caps and evaluate each category against its own cap before submission.
- Missing or incomplete fixed rates shall block submission with an Admin/HR correction message.
- Uncapped grades shall be flagged Needs Manual Review and permitted to proceed without an automatic cap.

### BR4 - Supervisor Routing

- Personal claims shall route to the reporting supervisor's email from Employee Master.
- A missing supervisor mapping shall block a personal submission.
- Manager-on-behalf claims shall bypass the HOD stage and route directly to HR.

### BR5 - Supervisor Email Decisions

- Supervisor email shall show the claim summary and prominent Approve and Decline actions.
- The decision page shall allow an optional comment before the decision is submitted.
- Decision links shall be token-authenticated and single-use.

### BR6 - HR Verification

- HR shall receive a claim only after supervisor approval, or directly for an authorized manager-on-behalf submission.
- HR shall be able to Verify or Reject and enter an optional comment.

### BR7 - Reimbursement

- An account officer or admin shall see HR-verified claims that are awaiting reimbursement.
- Marking a claim reimbursed shall set Finance Status to Paid, record Payment Date, set Overall Status to Paid, and store the officer's name and employee ID.
- The employee shall be notified. A claim that is not HR-verified, or is already reimbursed, shall not be changed.
- An admin shall be able to assign Employee, Account Officer, and Admin on registered Employee Master rows.

### BR8 - Tracker and Audit

- Each submission shall create exactly one row.
- The row shall preserve claimant identity, submission source, decision statuses, comments, timestamps, and payment details.
- Manager-on-behalf submissions shall record Submitted By Employee ID, Submitted By Name, and Submitted By Email.
- Approval, HR, and payment processing shall update the same row.

### BR9 - Notifications and Failure Handling

- Employees shall be notified after submission and each stage outcome.
- A manager submitting on behalf shall also receive a submission notification.
- A failed notification shall not roll back a saved claim or decision. The user interface and Remarks field shall indicate follow-up is required.

## 8. Data Requirements

### Employee Master

One row per employee: Employee ID, Full Name, Email, Department, Grade, Designation, Supervisor Name, Supervisor Email, Active, Role. Role is Employee, Account Officer, or Admin. A blank Role means Employee.

### Grade Limits

One row per grade: Grade Code, Designation Examples, Airtime Limit (NGN), Data Limit (NGN), Has Fixed Cap (Y/N), Notes.

### Claims Tracker

One row per claim: Claim ID, S/N, Submitted At, Employee ID, Employee Name, Employee Email, Department, Grade, Designation, Claim Period, Airtime Claimed (NGN), Data Claimed (NGN), Total Claimed (NGN), Approved Limit (NGN), Excess Claimed (NGN), Amount Recommended (NGN), Justification, Needs Manual Review, HOD Name, HOD Email, HOD Status, HOD Comment, HOD Decision Timestamp, HOD Token Hash, HOD Token Used, HR Status, HR Comment, HR Decision Timestamp, HR Token Hash, HR Token Used, Finance Status, Payment Date, Overall Status, Remarks, Submitted By Employee ID, Submitted By Name, Submitted By Email, Evidence File ID, Evidence File Name, Evidence URL, Reimbursed By Employee ID, Reimbursed By Name, Reimbursement Note.

### App Config

Key/value configuration including HR_EMAIL and WEB_APP_URL.

## 9. Non-Functional Requirements and Constraints

- The web app executes as the deploying owner and is deployed for anonymous access so tokenized approval links do not require Google sign-in. Employee access is protected by the custom Employee ID/email-code flow.
- Spreadsheet and Apps Script editor access shall be restricted to authorized administrators.
- Decision tokens and verification codes shall not be stored in plaintext in the tracker. The tracker stores hashes for decision tokens; email sign-in codes are held temporarily in script cache as hashes.
- The application depends on Apps Script, Google Sheets, Apps Script Cache, and MailApp quotas and availability.
- The tracker is the system of record. Retention, archival, and backup policy must be defined by the business owner.
- Public repository/source distribution must not include employee records, live claim data, or secret configuration.

## 10. Acceptance Criteria

1. An active employee with a valid `@indorama.com` email can request and verify a short-lived code and sign in.
2. Missing/invalid email, inactive employee, expired code, incorrect code, and excessive attempts are handled with the required messages and no unauthorized sign-in.
3. A personal claim within each category's cap creates one Pending Supervisor row and sends the supervisor email.
4. A personal claim above either category cap is blocked before submission.
5. An uncapped grade is clearly flagged for manual review and can be submitted.
6. A missing supervisor mapping blocks a personal claim.
7. An eligible Grade V+ Team Leader/HOD sees the on-behalf selector. A mapped active direct report can be selected, the claim row records both claimant and submitter, and the claim goes directly to HR.
8. A non-manager, below-Grade-V employee, or manager selecting a non-report cannot submit on behalf.
9. Clicking the email decision link opens a claim summary and comment form without recording a decision. Submitting the decision updates the same tracker row; a second click does not process it again.
10. Supervisor approval triggers HR; supervisor decline ends the flow. Manager-on-behalf bypasses supervisor and goes directly to HR.
11. An employee cannot mark a claim reimbursed. An account officer or admin can mark only an HR-verified claim, which records Paid, the payment date, and the officer, then notifies the employee. A second attempt does not change the row. An admin can assign the three roles and cannot remove the last active admin.
12. Notification failure does not erase a saved submission or decision and is visible for operational follow-up.

## 11. Risks, Assumptions, and Open Decisions

- Employee Master, supervisor mappings, grade limits, and HR_EMAIL must be accurate and maintained by HR/Admin.
- The BRD records Grade VI as NGN 25,000 airtime and NGN 25,000 data; other fixed rates must be confirmed by the business owner before go-live.
- Junior I-II and Senior VII+ have historically lacked fixed caps and therefore require manual review unless the business approves rates.
- The implementation's category-by-category cap enforcement should be confirmed by the business owner as the intended interpretation of the grade rate table.
- The manager rule depends on Designation text identifying Team Leader/HOD and a recognizable Grade V+ value. HR must standardize these fields in Employee Master.
- A supervisor decline or an HR rejection allows the employee to submit a new claim for the same month. Pending, verified, and paid claims do not.
- No supervisor mapping blocks personal submission. A fallback HR/Admin notification process is not specified.
- Claims Tracker retention and archival duration are undecided.
- Email delivery and anonymous web-app access may be restricted by Google Workspace policy or Apps Script quotas.

## 12. Approval and Sign-Off

| Stakeholder | Name | Decision | Date |
|---|---|---|---|
| Business Owner | To be completed | Pending | Pending |
| HR Lead | To be completed | Pending | Pending |
| Finance Lead | To be completed | Pending | Pending |
| IT/Admin (System Owner) | To be completed | Pending | Pending |