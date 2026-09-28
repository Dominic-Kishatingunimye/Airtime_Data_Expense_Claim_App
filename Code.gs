const SHEETS = {
  employees: 'Employee Master',
  rates: 'Grade Limits',
  claims: 'Claims Tracker',
  config: 'App Config'
};

const HEADERS = {
  employees: ['Employee ID', 'Full Name', 'Email', 'Department', 'Grade', 'Designation', 'Supervisor Name', 'Supervisor Email', 'Active'],
  rates: ['Grade Code', 'Designation Examples', 'Airtime Limit (NGN)', 'Data Limit (NGN)', 'Has Fixed Cap (Y/N)', 'Notes'],
  claims: [
    'Claim ID', 'S/N', 'Submitted At', 'Employee ID', 'Employee Name', 'Employee Email', 'Department', 'Grade', 'Designation',
    'Claim Period', 'Airtime Claimed (NGN)', 'Data Claimed (NGN)', 'Total Claimed (NGN)', 'Approved Limit (NGN)',
    'Excess Claimed (NGN)', 'Amount Recommended (NGN)', 'Justification', 'Needs Manual Review', 'HOD Name', 'HOD Email',
    'HOD Status', 'HOD Comment', 'HOD Decision Timestamp', 'HOD Token Hash', 'HOD Token Used', 'HR Status', 'HR Comment',
    'HR Decision Timestamp', 'HR Token Hash', 'HR Token Used', 'Finance Status', 'Payment Date', 'Overall Status', 'Remarks',
    'Submitted By Employee ID', 'Submitted By Name', 'Submitted By Email'
  ],
  config: ['Key', 'Value']
};

const ACTIVE_CLAIM_STATUSES = ['Pending Supervisor', 'Pending HR', 'Verified - Awaiting Payment', 'Rejected', 'Paid'];
const SESSION_TTL_SECONDS = 21600;
const LOGIN_CODE_TTL_SECONDS = 300;
const LOGIN_CODE_MAX_ATTEMPTS = 5;

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const token = /^[0-9a-f-]{36}$/i.test(params.token || '') ? params.token : '';
  const allowedActions = ['approve', 'decline', 'verify', 'reject'];
  const action = allowedActions.indexOf((params.action || '').toLowerCase()) >= 0 ? params.action.toLowerCase() : '';
  const template = HtmlService.createTemplateFromFile('Index');
  template.initialDecision = JSON.stringify({ token: token, action: action });
  return template.evaluate()
    .setTitle('Airtime & Data Expense Claims')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function setupApplication() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open this script from the claims spreadsheet before running setup.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheet.getId());
  Object.keys(HEADERS).forEach(function (key) {
    ensureSheet_(spreadsheet, SHEETS[key], HEADERS[key]);
  });
  ensureHeaders_(spreadsheet.getSheetByName(SHEETS.claims), HEADERS.claims);
  removeLegacyPasswordColumn_(spreadsheet.getSheetByName(SHEETS.employees));
  seedConfig_(spreadsheet.getSheetByName(SHEETS.config));
  installFinancePaymentTrigger_();
  return 'Sheets are ready. Add employees, grade rates, and HR_EMAIL in the workbook before opening submissions.';
}

function sendLoginCode(employeeId) {
  const normalizedId = normalizeEmployeeId_(employeeId);
  if (!normalizedId) throw new Error('Enter your Employee ID.');

  const employee = findActiveEmployeeById_(normalizedId);
  const response = { message: 'If this Employee ID is active, a sign-in code has been sent to the company email on file.' };
  if (!employee) return response;
  const recipient = normalizeEmail_(employee.Email);
  if (!isCompanyEmail_(recipient)) throw new Error('Your company email is missing or invalid in Employee Master. Contact Admin/HR.');

  const cache = CacheService.getScriptCache();
  const employeeKey = hashText_(normalizedId);
  const cooldownKey = 'login-cooldown:' + employeeKey;
  if (cache.get(cooldownKey)) throw new Error('A sign-in code was requested recently. Wait one minute before requesting another.');

  let code = '';
  while (code.length < 6) code += Utilities.getUuid().replace(/\D/g, '');
  code = code.slice(0, 6);
  const codeKey = 'login-code:' + employeeKey;
  try {
    cache.put(codeKey, JSON.stringify({ codeHash: hashText_(code), attempts: 0 }), LOGIN_CODE_TTL_SECONDS);
    cache.put(cooldownKey, '1', 60);
    MailApp.sendEmail({
      to: recipient,
      subject: 'Your Airtime & Data Claim sign-in code',
      body: 'Your sign-in code is ' + code + '. It expires in five minutes. If you did not request it, you can ignore this email.'
    });
  } catch (error) {
    cache.remove(cooldownKey);
    cache.remove(codeKey);
    console.error('Login code email failed: ' + error.message);
    throw new Error('Could not send the sign-in code. Contact Admin/HR or try again later.');
  }
  return response;
}

function verifyLoginCode(employeeId, verificationCode) {
  const normalizedId = normalizeEmployeeId_(employeeId);
  const code = String(verificationCode || '').trim();
  if (!normalizedId) throw new Error('Enter your Employee ID.');
  if (!/^\d{6}$/.test(code)) throw new Error('Enter the six-digit code sent to your company email.');

  const cache = CacheService.getScriptCache();
  const codeKey = 'login-code:' + hashText_(normalizedId);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const serializedState = cache.get(codeKey);
    if (!serializedState) throw new Error('The code has expired or was not requested. Request a new sign-in code.');
    const state = JSON.parse(serializedState);
    if (hashText_(code) !== state.codeHash) {
      state.attempts += 1;
      if (state.attempts >= LOGIN_CODE_MAX_ATTEMPTS) {
        cache.remove(codeKey);
        throw new Error('Too many incorrect attempts. Request a new sign-in code.');
      }
      cache.put(codeKey, JSON.stringify(state), LOGIN_CODE_TTL_SECONDS);
      throw new Error('That sign-in code is incorrect. Check the email and try again.');
    }
    cache.remove(codeKey);
  } finally {
    lock.releaseLock();
  }

  const employee = findActiveEmployeeById_(normalizedId);
  if (!employee) throw new Error('This employee account is unavailable. Contact Admin/HR.');
  const sessionToken = Utilities.getUuid();
  CacheService.getScriptCache().put('session:' + hashText_(sessionToken), normalizedId, SESSION_TTL_SECONDS);
  return { token: sessionToken, employee: publicEmployee_(employee) };
}

function getManagedEmployees(sessionToken) {
  const manager = requireEmployee_(sessionToken);
  const managerEmail = normalizeEmail_(manager.Email);
  if (!isCompanyEmail_(managerEmail)) return [];
  return readTable_(SHEETS.employees).rows.filter(function (row) {
    return String(row.Active || '').trim().toUpperCase() === 'Y' &&
      normalizeEmail_(row['Supervisor Email']) === managerEmail &&
      normalizeEmployeeId_(row['Employee ID']) !== normalizeEmployeeId_(manager['Employee ID']);
  }).map(publicEmployee_);
}

function getEligibility(sessionToken, airtime, data, targetEmployeeId) {
  const context = resolveClaimEmployee_(sessionToken, targetEmployeeId);
  const amounts = validateAmounts_(airtime, data);
  const result = eligibilityFor_(context.employee, amounts.airtime, amounts.data);
  return { employee: publicEmployee_(context.employee), eligibility: result };
}

function submitClaim(sessionToken, claim) {
  const request = claim || {};
  const context = resolveClaimEmployee_(sessionToken, request.employeeId);
  const submitter = context.submitter;
  const employee = context.employee;
  const onBehalf = context.onBehalf;
  const amounts = validateAmounts_(request.airtime, request.data);
  const period = String(request.period || '').trim();
  const justification = String(request.justification || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Select a valid claim period.');
  if (!justification || justification.length > 1000) throw new Error('Add a justification (maximum 1,000 characters).');
  if (!isCompanyEmail_(employee.Email)) throw new Error('The employee company email is missing or invalid. Contact Admin/HR; this claim has not been submitted.');
  if (!onBehalf && (!employee['Supervisor Email'] || !isEmail_(employee['Supervisor Email']))) {
    throw new Error('Your reporting supervisor is not mapped. Contact Admin/HR; this claim has not been submitted.');
  }

  const hrEmail = getConfigValue_('HR_EMAIL');
  if (!isEmail_(hrEmail)) throw new Error('HR_EMAIL is not configured. Contact Admin/HR; this claim has not been submitted.');
  const webAppUrl = getWebAppUrl_();
  const eligibility = eligibilityFor_(employee, amounts.airtime, amounts.data);
  if (!eligibility.configured) throw new Error(eligibility.message);
  if (!eligibility.needsManualReview && !eligibility.eligible) throw new Error(eligibility.message);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let claimRecord;
  let hodToken;
  let hrToken;
  try {
    const table = readTable_(SHEETS.claims);
    const duplicate = table.rows.some(function (row) {
      return String(row['Employee ID']).trim().toUpperCase() === String(employee['Employee ID']).trim().toUpperCase() &&
        String(row['Claim Period']).trim() === period && ACTIVE_CLAIM_STATUSES.indexOf(String(row['Overall Status'])) >= 0;
    });
    if (duplicate) throw new Error('An active claim already exists for this period.');

    const total = amounts.airtime + amounts.data;
    if (onBehalf) hrToken = Utilities.getUuid();
    else hodToken = Utilities.getUuid();
    claimRecord = {
      'Claim ID': Utilities.getUuid(),
      'S/N': Math.max(0, table.sheet.getLastRow() - 1) + 1,
      'Submitted At': new Date(),
      'Employee ID': employee['Employee ID'],
      'Employee Name': employee['Full Name'],
      'Employee Email': employee.Email,
      Department: employee.Department,
      Grade: employee.Grade,
      Designation: employee.Designation,
      'Claim Period': period,
      'Airtime Claimed (NGN)': amounts.airtime,
      'Data Claimed (NGN)': amounts.data,
      'Total Claimed (NGN)': total,
      'Approved Limit (NGN)': eligibility.needsManualReview ? 'Manual Review' : eligibility.limit,
      'Excess Claimed (NGN)': eligibility.needsManualReview ? 0 : eligibility.excess,
      'Amount Recommended (NGN)': eligibility.needsManualReview ? total : eligibility.recommended,
      Justification: justification,
      'Needs Manual Review': eligibility.needsManualReview ? 'Y' : 'N',
      'HOD Name': employee['Supervisor Name'],
      'HOD Email': employee['Supervisor Email'],
      'HOD Status': onBehalf ? 'Bypassed - Manager submitted on behalf' : 'Pending',
      'HOD Token Hash': hodToken ? hashText_(hodToken) : '',
      'HR Status': onBehalf ? 'Pending' : '',
      'HR Token Hash': hrToken ? hashText_(hrToken) : '',
      'Finance Status': 'Pending',
      'Overall Status': onBehalf ? 'Pending HR' : 'Pending Supervisor',
      'Submitted By Employee ID': submitter['Employee ID'],
      'Submitted By Name': submitter['Full Name'],
      'Submitted By Email': submitter.Email
    };
    table.sheet.appendRow(table.headers.map(function (header) { return claimRecord[header] === undefined ? '' : claimRecord[header]; }));
  } finally {
    lock.releaseLock();
  }

  const decisionNotified = onBehalf
    ? trySendDecisionEmail_(claimRecord, 'hr', hrToken, webAppUrl)
    : trySendDecisionEmail_(claimRecord, 'supervisor', hodToken, webAppUrl);
  const employeeNotified = sendEmployeeEmail_(claimRecord['Employee Email'], 'Claim submitted', decisionNotified
    ? 'A claim for you (' + claimRecord['Claim ID'] + ') was submitted ' + (onBehalf ? 'by your manager and sent directly to HR.' : 'and sent to your supervisor.')
    : 'Your claim ' + claimRecord['Claim ID'] + ' was saved, but the approval notification could not be sent. Contact Admin/HR.');
  if (!employeeNotified) recordNotificationFailure_(claimRecord['Claim ID'], claimRecord['Employee Email'], 'Employee submission notification could not be delivered.');
  let submitterNotified = true;
  if (onBehalf) {
    submitterNotified = sendEmployeeEmail_(submitter.Email, 'Claim submitted on behalf', 'Claim ' + claimRecord['Claim ID'] + ' for ' + employee['Full Name'] + ' was ' + (decisionNotified ? 'sent directly to HR.' : 'saved, but the HR notification could not be sent. Contact Admin/HR.'));
    if (!submitterNotified) recordNotificationFailure_(claimRecord['Claim ID'], submitter.Email, 'Manager submission notification could not be delivered.');
  }
  return {
    claimId: claimRecord['Claim ID'], status: claimRecord['Overall Status'], needsManualReview: eligibility.needsManualReview,
    notificationSent: decisionNotified && employeeNotified && submitterNotified,
    onBehalf: onBehalf,
    employeeName: employee['Full Name']
  };
}

function resolveClaimEmployee_(sessionToken, targetEmployeeId) {
  const submitter = requireEmployee_(sessionToken);
  const requestedId = normalizeEmployeeId_(targetEmployeeId);
  const submitterId = normalizeEmployeeId_(submitter['Employee ID']);
  if (!requestedId || requestedId === submitterId) return { submitter: submitter, employee: submitter, onBehalf: false };

  const employee = findActiveEmployeeById_(requestedId);
  if (!employee || normalizeEmail_(employee['Supervisor Email']) !== normalizeEmail_(submitter.Email)) {
    throw new Error('You may submit claims only for active employees who report directly to you.');
  }
  return { submitter: submitter, employee: employee, onBehalf: true };
}

function getDecisionInfo(token, action) {
  const context = findDecision_(token);
  if (context.used) return { alreadyActioned: true };
  if (!isActionAllowed_(context.stage, action)) throw new Error('This decision link does not match an available action.');
  return {
    alreadyActioned: false,
    action: String(action).toLowerCase(),
    stage: context.stage,
    claim: decisionSummary_(context.row)
  };
}

function submitDecision(token, action, comment) {
  const normalizedAction = String(action || '').toLowerCase();
  const decisionComment = String(comment || '').trim();
  if (decisionComment.length > 1000) throw new Error('Comments must be 1,000 characters or fewer.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let context;
  let nextHrToken = '';
  let webAppUrl = '';
  let notificationSent = true;
  try {
    context = findDecision_(token);
    if (context.used) return { alreadyActioned: true };
    if (!isActionAllowed_(context.stage, normalizedAction)) throw new Error('This decision is no longer available.');
    const row = context.row;
    const now = new Date();
    if (context.stage === 'supervisor') {
      row['HOD Status'] = normalizedAction === 'approve' ? 'Approved' : 'Declined';
      row['HOD Comment'] = decisionComment;
      row['HOD Decision Timestamp'] = now;
      row['HOD Token Used'] = now;
      if (normalizedAction === 'approve') {
        nextHrToken = Utilities.getUuid();
        row['HR Status'] = 'Pending';
        row['HR Token Hash'] = hashText_(nextHrToken);
        row['Overall Status'] = 'Pending HR';
        webAppUrl = getWebAppUrl_();
      } else {
        row['Overall Status'] = 'Declined';
      }
    } else {
      row['HR Status'] = normalizedAction === 'verify' ? 'Verified' : 'Rejected';
      row['HR Comment'] = decisionComment;
      row['HR Decision Timestamp'] = now;
      row['HR Token Used'] = now;
      row['Overall Status'] = normalizedAction === 'verify' ? 'Verified - Awaiting Payment' : 'Rejected';
    }
    context.sheet.getRange(context.sheetRow, 1, 1, context.headers.length)
      .setValues([context.headers.map(function (header) { return row[header] === undefined ? '' : row[header]; })]);
  } finally {
    lock.releaseLock();
  }

  if (nextHrToken) notificationSent = trySendDecisionEmail_(context.row, 'hr', nextHrToken, webAppUrl);
  const outcome = context.stage === 'supervisor'
    ? (normalizedAction === 'approve' ? 'approved by your supervisor and sent to HR' : 'declined by your supervisor')
    : (normalizedAction === 'verify' ? 'verified by HR and is awaiting Finance payment' : 'rejected by HR');
  const employeeNotified = sendEmployeeEmail_(context.row['Employee Email'], 'Claim update', 'Your claim ' + context.row['Claim ID'] + ' was ' + outcome + '.');
  if (!employeeNotified) recordNotificationFailure_(context.row['Claim ID'], context.row['Employee Email'], 'Employee decision notification could not be delivered.');
  return { alreadyActioned: false, status: context.row['Overall Status'], notificationSent: notificationSent && employeeNotified };
}

function onFinanceStatusEdit(e) {
  if (!e || !e.range || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEETS.claims || e.range.getRow() < 2) return;
  const headers = HEADERS.claims;
  const financeColumn = headers.indexOf('Finance Status') + 1;
  if (e.range.getColumn() !== financeColumn || String(e.value || '').trim().toLowerCase() !== 'paid') return;

  const rowNumber = e.range.getRow();
  const row = rowObject_(headers, sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0]);
  if (String(row['Overall Status']) === 'Paid') return;
  if (String(row['Overall Status']) !== 'Verified - Awaiting Payment') {
    e.range.setValue(e.oldValue || '');
    e.source.toast('HR must verify this claim before Finance can mark it paid.', 'Payment status not updated', 6);
    return;
  }
  const now = new Date();
  sheet.getRange(rowNumber, headers.indexOf('Payment Date') + 1).setValue(row['Payment Date'] || now);
  sheet.getRange(rowNumber, headers.indexOf('Overall Status') + 1).setValue('Paid');
  if (!sendEmployeeEmail_(row['Employee Email'], 'Claim paid', 'Finance marked claim ' + row['Claim ID'] + ' as paid.')) {
    recordNotificationFailure_(row['Claim ID'], row['Employee Email'], 'Employee payment notification could not be delivered.');
  }
}

function requireEmployee_(sessionToken) {
  const token = String(sessionToken || '');
  const id = CacheService.getScriptCache().get('session:' + hashText_(token));
  if (!id) throw new Error('Your session has expired. Please sign in again.');
  const table = readTable_(SHEETS.employees);
  const employee = table.rows.find(function (row) {
    return String(row['Employee ID'] || '').trim().toUpperCase() === id && String(row.Active || '').trim().toUpperCase() === 'Y';
  });
  if (!employee) throw new Error('Employee account is unavailable. Contact Admin/HR.');
  return employee;
}

function eligibilityFor_(employee, airtime, data) {
  const table = readTable_(SHEETS.rates);
  const grade = normalizeGradeCode_(employee.Grade);
  if (!grade) return { configured: false, message: 'Your employee grade is missing. Contact Admin/HR; this claim has not been submitted.' };
  const matchingRates = table.rows.filter(function (row) {
    const rateGrade = normalizeGradeCode_(getFieldValue_(row, ['Grade Code', 'Grade', 'Grade Level']));
    return rateGrade && rateGrade === grade;
  });
  if (!matchingRates.length) return { configured: false, message: 'No Grade Limits record matches grade "' + String(employee.Grade || '').trim() + '". Check the Grade Code values in the Grade Limits sheet; this claim has not been submitted.' };
  if (matchingRates.length > 1) return { configured: false, message: 'More than one Grade Limits row matches your grade. Contact Admin/HR to remove the duplicate; this claim has not been submitted.' };

  const rate = matchingRates[0];
  const airtimeLimit = parseRateAmount_(getFieldValue_(rate, ['Airtime Limit (NGN)', 'Airtime Limit', 'Approved Airtime Limit']));
  const dataLimit = parseRateAmount_(getFieldValue_(rate, ['Data Limit (NGN)', 'Data Limit', 'Internet Data Limit', 'Approved Data Limit']));
  const capValue = getFieldValue_(rate, ['Has Fixed Cap (Y/N)', 'Has Fixed Cap', 'Fixed Cap']);
  const capFlag = String(capValue == null ? '' : capValue).trim().toUpperCase();
  if (['N', 'NO', 'FALSE', 'NO FIXED CAP'].indexOf(capFlag) >= 0) {
    return { configured: true, needsManualReview: true, total: airtime + data, limit: null, message: 'Needs Manual Review: no fixed cap is configured for this grade.' };
  }
  if (!Number.isFinite(airtimeLimit) || !Number.isFinite(dataLimit) || airtimeLimit < 0 || dataLimit < 0) {
    return { configured: false, message: 'The approved rate for your grade is incomplete. Contact Admin/HR; this claim has not been submitted.' };
  }
  if (capFlag && ['Y', 'YES', 'TRUE', 'FIXED'].indexOf(capFlag) < 0) {
    return { configured: false, message: 'The fixed-cap setting for your grade must be Y or N. Contact Admin/HR; this claim has not been submitted.' };
  }
  const limit = airtimeLimit + dataLimit;
  const total = airtime + data;
  const airtimeExcess = Math.max(0, airtime - airtimeLimit);
  const dataExcess = Math.max(0, data - dataLimit);
  const eligible = airtimeExcess === 0 && dataExcess === 0;
  const excess = airtimeExcess + dataExcess;
  return {
    configured: true, needsManualReview: false, eligible: eligible, total: total, limit: limit,
    airtimeLimit: airtimeLimit, dataLimit: dataLimit,
    airtimeExcess: airtimeExcess, dataExcess: dataExcess, excess: excess,
    recommended: Math.min(airtime, airtimeLimit) + Math.min(data, dataLimit),
    message: eligible ? 'Within the approved airtime and data caps.' :
      'Not eligible: ' + [airtimeExcess > 0 ? 'airtime exceeds its cap by ' + money_(airtimeExcess) : '', dataExcess > 0 ? 'data exceeds its cap by ' + money_(dataExcess) : ''].filter(Boolean).join('; ') + '.'
  };
}

function getFieldValue_(row, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader_);
  const key = Object.keys(row).find(function (header) { return normalizedAliases.indexOf(normalizeHeader_(header)) >= 0; });
  return key === undefined ? undefined : row[key];
}

function normalizeHeader_(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeGradeCode_(value) {
  return normalizeHeader_(value).replace(/^grade/, '');
}

function parseRateAmount_(value) {
  if (typeof value === 'number') return value;
  const normalized = String(value == null ? '' : value).replace(/,/g, '').replace(/[^0-9.-]/g, '');
  return normalized ? Number(normalized) : NaN;
}

function validateAmounts_(airtime, data) {
  if (String(airtime == null ? '' : airtime).trim() === '' || String(data == null ? '' : data).trim() === '') {
    throw new Error('Enter an amount for both airtime and data; use 0 for any unused category.');
  }
  const airtimeAmount = Number(airtime);
  const dataAmount = Number(data);
  if (!Number.isFinite(airtimeAmount) || !Number.isFinite(dataAmount) || airtimeAmount < 0 || dataAmount < 0 || airtimeAmount + dataAmount <= 0) {
    throw new Error('Enter valid non-negative amounts. The combined claim must be greater than zero.');
  }
  return { airtime: airtimeAmount, data: dataAmount };
}

function findDecision_(token) {
  if (!/^[0-9a-f-]{36}$/i.test(String(token || ''))) throw new Error('This decision link is invalid or expired.');
  const tokenHash = hashText_(token);
  const table = readTable_(SHEETS.claims);
  for (let index = 0; index < table.rows.length; index += 1) {
    const row = table.rows[index];
    if (row['HOD Token Hash'] === tokenHash) return { sheet: table.sheet, headers: table.headers, sheetRow: index + 2, row: row, stage: 'supervisor', used: Boolean(row['HOD Token Used']) };
    if (row['HR Token Hash'] === tokenHash) return { sheet: table.sheet, headers: table.headers, sheetRow: index + 2, row: row, stage: 'hr', used: Boolean(row['HR Token Used']) };
  }
  throw new Error('This decision link is invalid or expired.');
}

function isActionAllowed_(stage, action) {
  return stage === 'supervisor' ? ['approve', 'decline'].indexOf(action) >= 0 : ['verify', 'reject'].indexOf(action) >= 0;
}

function decisionSummary_(row) {
  return {
    claimId: row['Claim ID'], employeeName: row['Employee Name'], employeeId: row['Employee ID'],
    department: row.Department, grade: row.Grade, period: row['Claim Period'], airtime: row['Airtime Claimed (NGN)'],
    data: row['Data Claimed (NGN)'], total: row['Total Claimed (NGN)'], approvedLimit: row['Approved Limit (NGN)'],
    recommended: row['Amount Recommended (NGN)'], manualReview: row['Needs Manual Review'] === 'Y', justification: row.Justification,
    submittedByEmployeeId: row['Submitted By Employee ID'], submittedByName: row['Submitted By Name'], submittedByEmail: row['Submitted By Email']
  };
}

function sendDecisionEmail_(claim, stage, token, webAppUrl) {
  const isSupervisor = stage === 'supervisor';
  const recipient = isSupervisor ? claim['HOD Email'] : getConfigValue_('HR_EMAIL');
  const actions = isSupervisor ? [['approve', 'Approve'], ['decline', 'Decline']] : [['verify', 'Verify'], ['reject', 'Reject']];
  const links = actions.map(function (item) {
    return '<a style="display:inline-block;margin:0 10px 10px 0;padding:11px 18px;background:#175e55;color:#fff;text-decoration:none;border-radius:4px" href="' +
      escapeHtml_(webAppUrl + '?token=' + encodeURIComponent(token) + '&action=' + item[0]) + '">' + item[1] + '</a>';
  }).join('');
  const summary = decisionSummary_(claim);
  const body = '<p>A claim requires your ' + (isSupervisor ? 'approval' : 'verification') + '.</p>' +
    '<p><b>Employee:</b> ' + escapeHtml_(summary.employeeName) + ' (' + escapeHtml_(summary.employeeId) + ')<br>' +
    '<b>Department / grade:</b> ' + escapeHtml_(summary.department) + ' / ' + escapeHtml_(summary.grade) + '<br>' +
    '<b>Period:</b> ' + escapeHtml_(summary.period) + '<br>' +
    '<b>Airtime / data:</b> ' + money_(summary.airtime) + ' / ' + money_(summary.data) + '<br>' +
    '<b>Total:</b> ' + money_(summary.total) + '<br>' +
    '<b>Recommended:</b> ' + money_(summary.recommended) + (summary.manualReview ? ' (manual review)' : '') + '<br>' +
    (summary.submittedByEmployeeId && normalizeEmployeeId_(summary.submittedByEmployeeId) !== normalizeEmployeeId_(summary.employeeId)
      ? '<b>Submitted by manager:</b> ' + escapeHtml_(summary.submittedByName) + ' (' + escapeHtml_(summary.submittedByEmployeeId) + ')<br>'
      : '') +
    '<b>Justification:</b> ' + escapeHtml_(summary.justification) + '</p>' +
    '<p>' + links + '</p><p>The link opens a confirmation page where you can add an optional comment.</p>';
  MailApp.sendEmail({ to: recipient, subject: 'Claim ' + claim['Claim ID'] + ' requires ' + (isSupervisor ? 'supervisor action' : 'HR verification'), htmlBody: body });
}

function trySendDecisionEmail_(claim, stage, token, webAppUrl) {
  const recipient = stage === 'supervisor' ? claim['HOD Email'] : getConfigValue_('HR_EMAIL');
  try {
    sendDecisionEmail_(claim, stage, token, webAppUrl);
    return true;
  } catch (error) {
    console.error('Decision notification failed: ' + error.message);
    recordNotificationFailure_(claim['Claim ID'], recipient, error.message);
    return false;
  }
}

function sendEmployeeEmail_(email, subject, message) {
  if (!email || !isEmail_(email)) return false;
  try {
    MailApp.sendEmail({ to: email, subject: subject, body: message });
    return true;
  } catch (error) {
    console.error('Employee notification failed: ' + error.message);
    return false;
  }
}

function recordNotificationFailure_(claimId, recipient, reason) {
  try {
    const table = readTable_(SHEETS.claims);
    const index = table.rows.findIndex(function (row) { return String(row['Claim ID']) === String(claimId); });
    if (index < 0) return;
    const remarksColumn = table.headers.indexOf('Remarks') + 1;
    const cell = table.sheet.getRange(index + 2, remarksColumn);
    const existing = String(cell.getValue() || '').trim();
    const note = new Date().toISOString() + ' - Email to ' + String(recipient || 'unknown recipient') + ' failed: ' + String(reason || 'delivery error').slice(0, 250);
    cell.setValue(existing ? existing + '\n' + note : note);
  } catch (error) {
    console.error('Could not record notification failure: ' + error.message);
  }
}

function getWebAppUrl_() {
  const configuredUrl = getConfigValue_('WEB_APP_URL');
  const url = configuredUrl || ScriptApp.getService().getUrl();
  if (!url) throw new Error('Deploy the web app and configure WEB_APP_URL before accepting claims.');
  return url;
}

function getConfigValue_(key) {
  const table = readTable_(SHEETS.config);
  const entry = table.rows.find(function (row) { return String(row.Key || '').trim() === key; });
  return entry ? String(entry.Value || '').trim() : '';
}

function readTable_(sheetName) {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 1) throw new Error('Run setupApplication() before using the app.');
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  return { sheet: sheet, headers: headers, rows: values.slice(1).map(function (valuesRow) { return rowObject_(headers, valuesRow); }) };
}

function rowObject_(headers, values) {
  const row = {};
  headers.forEach(function (header, index) { row[header] = values[index]; });
  return row;
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const spreadsheet = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Claims spreadsheet is not configured. Run setupApplication() from the workbook.');
  return spreadsheet;
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function ensureHeaders_(sheet, headers) {
  if (!sheet || sheet.getLastRow() === 0) return;
  const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const missingHeaders = headers.filter(function (header) { return currentHeaders.indexOf(header) < 0; });
  if (missingHeaders.length) {
    sheet.getRange(1, currentHeaders.length + 1, 1, missingHeaders.length).setValues([missingHeaders]);
  }
}

function removeLegacyPasswordColumn_(sheet) {
  if (!sheet || sheet.getLastColumn() === 0) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (let index = headers.length - 1; index >= 0; index -= 1) {
    if (['password', 'password hash'].indexOf(String(headers[index] || '').trim().toLowerCase()) >= 0) {
      sheet.deleteColumn(index + 1);
    }
  }
}

function seedConfig_(sheet) {
  const existingKeys = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat() : [];
  [['HR_EMAIL', ''], ['WEB_APP_URL', '']].forEach(function (entry) {
    if (existingKeys.indexOf(entry[0]) < 0) sheet.appendRow(entry);
  });
}

function installFinancePaymentTrigger_() {
  const existing = ScriptApp.getProjectTriggers().some(function (trigger) { return trigger.getHandlerFunction() === 'onFinanceStatusEdit'; });
  if (!existing) ScriptApp.newTrigger('onFinanceStatusEdit').forSpreadsheet(getSpreadsheet_()).onEdit().create();
}

function publicEmployee_(employee) {
  return {
    employeeId: employee['Employee ID'], name: employee['Full Name'], email: employee.Email,
    department: employee.Department, grade: employee.Grade, designation: employee.Designation,
    supervisor: employee['Supervisor Name']
  };
}

function findActiveEmployeeById_(employeeId) {
  const table = readTable_(SHEETS.employees);
  return table.rows.find(function (row) {
    return normalizeEmployeeId_(row['Employee ID']) === employeeId && String(row.Active || '').trim().toUpperCase() === 'Y';
  }) || null;
}

function hashText_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return bytes.map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function money_(value) {
  const amount = Number(value);
  return 'NGN ' + (Number.isFinite(amount) ? amount.toLocaleString('en-NG') : String(value || '0'));
}

function escapeHtml_(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
  });
}

function isEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeEmployeeId_(value) {
  return String(value || '').trim().toUpperCase();
}

function isCompanyEmail_(email) {
  return /^[^\s@]+@indorama\.com$/i.test(String(email || '').trim());
}