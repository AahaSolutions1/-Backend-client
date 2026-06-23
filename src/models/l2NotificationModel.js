import pool from '../config/db.js';
import { sendMail } from '../config/email.js';

/**
 * Creates L2 validation-related database notifications based on status.
 */
export const createL2Notifications = async (connection, changeNo, status, logData, l1Dept, requestBy, crTitle, crRequesterEmail, crRequesterDept, changeIn, processName, machineNo) => {
  const { date, requester, weldTest, qaTest, remarks } = logData;
  
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} Today`;

  let targetUsers = [];
  let title = '';
  let details = '';
  let statusColor = 'blue';

  if (status === 'Pending') {
    const [rows] = await connection.query(
      `SELECT email, name, department, role FROM users 
       WHERE department != '' AND department IS NOT NULL 
         AND (
           LOWER(department) IN ('qad', 'general') 
           OR LOWER(role) IN ('admin', 'administrator')
           OR (
             LOWER(department) = LOWER(?)
              AND (LOWER(role) LIKE '%hod%' OR LOWER(role) LIKE '%manager%')
           )
         )`,
      [l1Dept || '']
    );
    targetUsers = rows.filter(u => u.email.toLowerCase() !== (crRequesterEmail || '').toLowerCase());
    title = `L2 Setup Validation Awaiting QA Review – ${changeNo}`;
    details = `Change Request ${changeNo} ("${crTitle}")${changeIn ? ` (${changeIn})` : ''} has updated L2 requester validation attachment by ${requestBy} (Status: Pending L2 QA Review). The next process is L2 QA Validation (QAD Department setup verification review).`;
    statusColor = 'blue';
  } else if (status === 'Accepted') {
    const seenEmails = new Set();

    // 1. Requester
    if (crRequesterEmail) {
      const [requesterDetails] = await connection.query(
        `SELECT email, name, department, role FROM users WHERE email = ?`,
        [crRequesterEmail]
      );
      if (requesterDetails.length > 0) {
        const u = requesterDetails[0];
        if (!seenEmails.has(u.email.toLowerCase())) {
          seenEmails.add(u.email.toLowerCase());
          targetUsers.push(u);
        }
      } else if (!seenEmails.has(crRequesterEmail.toLowerCase())) {
        seenEmails.add(crRequesterEmail.toLowerCase());
        targetUsers.push({
          email: crRequesterEmail,
          name: requester || 'Requester',
          department: crRequesterDept || 'General',
          role: 'User'
        });
      }
    }

    // 2. Admins
    const [admins] = await connection.query(
      `SELECT email, name, department, role FROM users 
       WHERE LOWER(role) IN ('admin', 'administrator')`
    );
    for (const u of admins) {
      if (!seenEmails.has(u.email.toLowerCase())) {
        seenEmails.add(u.email.toLowerCase());
        targetUsers.push(u);
      }
    }

    // 3. All Department HODs
    const [hods] = await connection.query(
      `SELECT email, name, department, role FROM users 
       WHERE department != '' AND department IS NOT NULL AND (LOWER(role) LIKE '%hod%' OR LOWER(role) LIKE '%manager%')`
    );
    for (const u of hods) {
      if (!seenEmails.has(u.email.toLowerCase())) {
        seenEmails.add(u.email.toLowerCase());
        targetUsers.push(u);
      }
    }

    // 4. QAD department users (both HOD and standard user)
    const [qadUsers] = await connection.query(
      `SELECT email, name, department, role FROM users 
       WHERE department != '' AND department IS NOT NULL AND LOWER(department) = 'qad'`
    );
    for (const u of qadUsers) {
      if (!seenEmails.has(u.email.toLowerCase())) {
        seenEmails.add(u.email.toLowerCase());
        targetUsers.push(u);
      }
    }

    title = `L2 Validation Approved – ${changeNo}`;
    details = `Change Request ${changeNo} ("${crTitle}")${changeIn ? ` (${changeIn})` : ''} has been approved at L2 validation by ${requestBy} (Status: L2 Approved).${processName ? ` Process: ${processName}.` : ''}${machineNo ? ` Machine: ${machineNo}.` : ''}${remarks ? ` Remarks: ${remarks}` : ''} The next process is L3 Multi-Department HOD Decisions (Awaiting decision / acknowledgement from all selected department HODs and Admin).`;
    statusColor = 'green';
  } else if (status === 'Rejected') {
    const [rows] = await connection.query(
      `SELECT email, name, department, role FROM users 
       WHERE department != '' AND department IS NOT NULL 
         AND (
           LOWER(department) = 'qad'
           OR LOWER(role) IN ('admin', 'administrator') 
           OR LOWER(role) LIKE '%hod%' 
           OR LOWER(role) LIKE '%manager%'
           OR LOWER(email) = LOWER(?)
         )`,
      [crRequesterEmail || '']
    );
    targetUsers = rows;
    title = `L2 Validation Rejected – ${changeNo}`;
    details = `Change Request ${changeNo} ("${crTitle}")${changeIn ? ` (${changeIn})` : ''} has been rejected at L2 validation by QAD (Status: L2 Rejected).${processName ? ` Process: ${processName}.` : ''}${machineNo ? ` Machine: ${machineNo}.` : ''}${remarks ? ` Remarks: ${remarks}` : ''} The next process is L2 Requester Validation (Requester re-uploads/corrects setup validation documentation).`;
    statusColor = 'red';
  }

  // Insert Database Notifications
  const seenNotifEmails = new Set();
  const notifDept = l1Dept || crRequesterDept || 'General';

  if (status === 'Accepted' || status === 'Rejected') {
    const isAccepted = status === 'Accepted';
    
    // 1. Resolve Action Required targets first to prevent duplicates in System Logs
    const targetEmailsForL2Action = new Set();
    if (crRequesterEmail) {
      targetEmailsForL2Action.add(crRequesterEmail.toLowerCase().trim());
    }
    // Fetch all admins
    const [admins] = await connection.query(
      `SELECT email FROM users WHERE LOWER(role) IN ('admin', 'administrator')`
    );
    for (const admin of admins) {
      targetEmailsForL2Action.add(admin.email.toLowerCase().trim());
    }

    const targetEmailsForL3Action = new Set();
    if (isAccepted) {
      // Fetch all HODs
      const [hodsRows] = await connection.query(
        `SELECT email FROM users 
         WHERE department != '' AND department IS NOT NULL AND (LOWER(role) LIKE '%hod%' OR LOWER(role) LIKE '%manager%')`
      );
      for (const u of hodsRows) {
        targetEmailsForL3Action.add(u.email.toLowerCase().trim());
      }
      // Add Admins
      for (const admin of admins) {
        targetEmailsForL3Action.add(admin.email.toLowerCase().trim());
      }
    }

    // 2. Insert System Logs notification for targetUsers (excluding those getting Action Required)
    for (const targetUser of targetUsers) {
      const email = targetUser.email;
      if (!email) continue;
      const emailClean = email.toLowerCase().trim();
      
      // Skip if they are already getting an Action Required notification for this event
      if (targetEmailsForL2Action.has(emailClean) || targetEmailsForL3Action.has(emailClean)) {
        continue;
      }
      
      if (seenNotifEmails.has(emailClean)) continue;
      seenNotifEmails.add(emailClean);

      const notifId = `L2-LOG-${status.toUpperCase()}-${changeNo}-${email.replace(/[@.]/g, '_')}-${Date.now()}`;
      await connection.query(
        `INSERT INTO notifications (id, title, details, change_no, category, dept, time_str, is_read, type, color, recipient_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, 'System Logs', ?, ?)`,
        [notifId, title, details, changeNo, changeIn || 'GENERAL', notifDept, timeStr, statusColor, email]
      );
    }

    // 3. Insert Action Required notification for L2 action (requester and admins)
    const actionTitle = isAccepted ? `L2 Approved - Proceed to L3 Review` : `L2 Rejected – ${changeNo}`;
    const actionDetails = isAccepted
      ? `Change Request ${changeNo} ("${crTitle}") has been approved at L2 validation (Status: L2 Approved). The next process is L3 Multi-Department HOD Decisions (Awaiting decision / acknowledgement from all selected department HODs and Admin).`
      : `Change Request ${changeNo} ("${crTitle}") has been rejected at L2 validation (Status: L2 Rejected). The next process is L2 Requester Validation (Requester re-uploads/corrects setup validation documentation).`;
    const actionColor = isAccepted ? 'blue' : 'red';
    const notifPrefix = isAccepted ? 'L2-VAL-ACTION-ACCEPTED' : 'L2-VAL-ACTION-REJECTED';

    for (const email of targetEmailsForL2Action) {
      const actionNotifId = `${notifPrefix}-${changeNo}-${email.replace(/[@.]/g, '_')}-${Date.now()}`;
      await connection.query(
        `INSERT INTO notifications (id, title, details, change_no, category, dept, time_str, is_read, type, color, recipient_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, 'Action Required', ?, ?)`,
        [actionNotifId, actionTitle, actionDetails, changeNo, changeIn || 'GENERAL', notifDept, timeStr, actionColor, email]
      );
    }

    if (isAccepted) {
      // 4. Insert Action Required notification for L3 HOD and Admin review
      const l3ActionTitle = `L3 Approval Required – ${changeNo}`;
      const l3ActionDetails = `Change Request ${changeNo} ("${crTitle}")${changeIn ? ` (${changeIn})` : ''} is awaiting department review and sign-off at L3 (Status: Awaiting L3 HOD Decisions).`;
      const l3ActionColor = 'orange';

      for (const email of targetEmailsForL3Action) {
        const l3ActionNotifId = `L3-VAL-ACTION-REQUIRED-${changeNo}-${email.replace(/[@.]/g, '_')}-${Date.now()}`;
        await connection.query(
          `INSERT INTO notifications (id, title, details, change_no, category, dept, time_str, is_read, type, color, recipient_email)
           VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, 'Action Required', ?, ?)`,
          [l3ActionNotifId, l3ActionTitle, l3ActionDetails, changeNo, changeIn || 'GENERAL', notifDept, timeStr, l3ActionColor, email]
        );
      }
    }
  } else {
    // This is the status === 'Pending' block
    for (const targetUser of targetUsers) {
      const email = targetUser.email;
      if (!email || seenNotifEmails.has(email.toLowerCase())) continue;
      seenNotifEmails.add(email.toLowerCase());

      const dept = targetUser.department || 'General';
      const deptLower = dept.toLowerCase();
      const l1DeptLower = (l1Dept || '').toLowerCase();
      const isL1DeptHODOnly = status === 'Pending' && deptLower === l1DeptLower && !['qad', 'general'].includes(deptLower);

      const notifId = isL1DeptHODOnly
        ? `L1-HOD-NOTIF-L2-${changeNo}-${email.replace(/[@.]/g, '_')}-${Date.now()}`
        : `L2-NOTIF-${changeNo}-${email.replace(/[@.]/g, '_')}-${Date.now()}`;

      await connection.query(
        `INSERT INTO notifications (id, title, details, change_no, category, dept, time_str, is_read, type, color, recipient_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, 'Action Required', ?, ?)`,
        [notifId, title, details, changeNo, changeIn || 'GENERAL', notifDept, timeStr, statusColor, email]
      );
    }
  }

  // Send personal confirmation notification to the requester when they submit their PED validation
  if (status === 'Pending' && crRequesterEmail) {
    const [reqUserDeptRow] = await connection.query(
      `SELECT department FROM users WHERE email = ?`,
      [crRequesterEmail]
    );
    const reqDept = reqUserDeptRow.length > 0 ? reqUserDeptRow[0].department : '';
    const notifDept = l1Dept || reqDept || 'General';
    if (notifDept) {
      const requesterNotifId = `L2-REQUESTER-CONFIRM-${changeNo}-${Date.now()}`;
      const requesterNotifTitle = `L2 Validation Submitted – ${changeNo}`;
      const requesterNotifDetails = `L2 Requester Validation attachment for Change Request ${changeNo} ("${crTitle}")${changeIn ? ` (${changeIn})` : ''} has been submitted successfully (Status: Pending L2 QA Review). The next process is L2 QA Validation (QAD Department setup verification review).`;
      await connection.query(
        `INSERT INTO notifications (id, title, details, change_no, category, dept, time_str, is_read, type, color, recipient_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, ?, ?, ?)`,
        [requesterNotifId, requesterNotifTitle, requesterNotifDetails, changeNo, changeIn || 'GENERAL', notifDept, timeStr, 'Info', 'blue', crRequesterEmail]
      );
    }
  }

  return targetUsers;
};

/**
 * Sends email notifications for the L2 validation step.
 */
export const sendL2Emails = async (changeNo, status, logData, l1Dept, requestBy, crRequesterEmail, crRequesterDept, crTitle, changeIn, processName, machineNo, resolvedTargetUsers) => {
  try {
    const { remarks } = logData;
    let users = [];

    if (status === 'Pending') {
      const [rows] = await pool.query(
        `SELECT email, name, department, role FROM users 
         WHERE department != '' AND department IS NOT NULL 
           AND (
             LOWER(department) = 'qad'
             OR LOWER(role) IN ('admin', 'administrator')
             OR (
               LOWER(department) = LOWER(?)
                AND (LOWER(role) LIKE '%hod%' OR LOWER(role) LIKE '%manager%')
             )
           )`,
        [l1Dept || '']
      );
      users = rows.filter(u => u.email.toLowerCase() !== (crRequesterEmail || '').toLowerCase());

      // Also send a confirmation email to the requester themselves
      if (crRequesterEmail) {
        const [reqNameRow] = await pool.query(
          `SELECT name FROM users WHERE LOWER(email) = LOWER(?)`,
          [crRequesterEmail]
        );
        const reqName = reqNameRow.length > 0 ? reqNameRow[0].name : requestBy;
        const confirmHtml = `
          <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); background-color: #ffffff;">
            <div style="background-color: #2563eb; color: white; padding: 24px; text-align: center;">
              <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">4M Change Management System</h1>
              <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px;">L2 Validation Confirmed</p>
            </div>
            <div style="padding: 24px;">
              <h2 style="margin-top: 0; color: #1e293b; font-size: 18px; font-weight: 600;">Hello ${reqName},</h2>
              <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
                L2 Requester Validation attachment has been submitted successfully and the status is now <strong>Pending QA Review</strong>.
              </p>
              <div style="background-color: #f0f9ff; border-left: 4px solid #3b82f6; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
                <div style="font-size: 12px; text-transform: uppercase; color: #0284c7; font-weight: 600; letter-spacing: 0.5px;">Submission Status</div>
                <div style="font-size: 16px; font-weight: 700; color: #0369a1; margin-top: 4px;">Pending QA Review</div>
                <p style="margin: 6px 0 0 0; font-size: 13px; color: #0369a1; line-height: 1.4;">
                  The next process is <strong>L2 QA Validation (QAD Department setup verification review)</strong>. The QA department will now review and verify the setup. You will be notified once a decision is made.
                </p>
              </div>
              <h3 style="color: #0f172a; font-size: 14px; font-weight: 600; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 24px; margin-bottom: 12px;">Submission Details</h3>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13.5px; color: #475569;">
                <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b; width: 35%;"><strong>Change Request #</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600; font-family: monospace;">${changeNo}</td></tr>
                ${crTitle ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Title</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600;">${crTitle}</td></tr>` : ''}
                ${changeIn ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Change Category</strong></td><td style="padding: 10px 0; color: #1e293b;">${changeIn}</td></tr>` : ''}
                ${processName ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Process Name</strong></td><td style="padding: 10px 0; color: #1e293b;">${processName}</td></tr>` : ''}
                ${machineNo ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Machine No</strong></td><td style="padding: 10px 0; color: #1e293b; font-family: monospace;">${machineNo}</td></tr>` : ''}
                <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Submitted By</strong></td><td style="padding: 10px 0; color: #1e293b;">${requestBy}</td></tr>
              </table>
              <div style="text-align: center; margin: 32px 0 12px 0;">
                <a href="${process.env.APP_URL || 'http://localhost:5173'}" style="background-color: #2563eb; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);">
                  Go to Dashboard
                </a>
              </div>
            </div>
            <div style="background-color: #f8fafc; padding: 16px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9;">
              This is an automated notification from the 4M Change Management System.
            </div>
          </div>
        `;
        await sendMail({
          to: crRequesterEmail,
          subject: `[4M-CMS] Submission Confirmed: L2 Requester Validation ${changeNo}`,
          html: confirmHtml
        });
      }
    } else if (status === 'Accepted') {
      users = resolvedTargetUsers || [];
    } else if (status === 'Rejected') {
      const [rows] = await pool.query(
        `SELECT email, name, department, role FROM users 
         WHERE department != '' AND department IS NOT NULL 
           AND (LOWER(department) = 'qad'
                OR LOWER(role) IN ('admin', 'administrator') 
                OR LOWER(role) LIKE '%hod%' 
                OR LOWER(role) LIKE '%manager%'
                OR LOWER(email) = LOWER(?))`,
        [crRequesterEmail || '']
      );
      users = rows;
    }

    if (users && users.length > 0) {
      const themeColor = status === 'Accepted' ? '#10b981' : (status === 'Rejected' ? '#ef4444' : '#2563eb');
      const bgLight = status === 'Accepted' ? '#f0fdf4' : (status === 'Rejected' ? '#fef2f2' : '#eff6ff');
      const statusLabel = status === 'Accepted' ? 'Approved' : (status === 'Rejected' ? 'Rejected' : 'Pending QA Review');
      const badgeTextColor = status === 'Accepted' ? '#15803d' : (status === 'Rejected' ? '#991b1b' : '#1e40af');

      let emailSubject = `[4M-CMS] Action Required: L3 Review for ${changeNo}`;
      let emailIntro = `A change request has been evaluated at <strong>L2 Validation</strong> and is now pending department review at <strong>L3</strong>.`;
      let headerSubtitle = 'L2 Validation Alert';

      if (status === 'Pending') {
        emailSubject = `[4M-CMS] Action Required: QA Setup Verification for ${changeNo}`;
        emailIntro = `A change request has updated <strong>L2 Requester Validation documentation</strong> (Status: Pending L2 QA Review). The next process is <strong>L2 QA Validation (QAD Department setup verification review)</strong>.`;
        headerSubtitle = 'L2 Validation Alert';
      } else if (status === 'Accepted') {
        emailSubject = `[4M-CMS] L2 Validation Approved for Request: ${changeNo}`;
        emailIntro = `Change Request <strong>${changeNo}</strong> has successfully completed and been <strong>Approved</strong> at L2 setup validation (Status: L2 Approved). The next process is <strong>L3 Multi-Department HOD Decisions (Awaiting decision / acknowledgement from all selected department HODs and Admin)</strong>.`;
        headerSubtitle = 'L2 Validation Approved';
      } else if (status === 'Rejected') {
        emailSubject = `[4M-CMS] Alert: L2 Validation Rejected for ${changeNo}`;
        emailIntro = `A change request L2 validation has been <strong>rejected</strong> by the QAD department (Status: L2 Rejected). The next process is <strong>L2 Requester Validation (Requester re-uploads/corrects setup validation documentation)</strong>.`;
        headerSubtitle = 'L2 Validation Rejected';
      }

      const recipientEmails = [...new Set(users.map(u => u.email).filter(Boolean))];

      const emailHtml = `
        <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); background-color: #ffffff;">
          <div style="background-color: ${themeColor}; color: white; padding: 24px; text-align: center;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">4M Change Management System</h1>
            <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px;">${headerSubtitle}</p>
          </div>
          <div style="padding: 24px;">
            <h2 style="margin-top: 0; color: #1e293b; font-size: 18px; font-weight: 600;">Hello Team,</h2>
            <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
              ${emailIntro}
            </p>
            <div style="background-color: ${bgLight}; border-left: 4px solid ${themeColor}; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
              <div style="font-size: 12px; text-transform: uppercase; color: ${badgeTextColor}; font-weight: 600; letter-spacing: 0.5px;">Validation Status</div>
              <div style="font-size: 18px; font-weight: 700; color: ${badgeTextColor}; margin-top: 4px;">L2 Status: ${statusLabel}</div>
              <p style="margin: 6px 0 0 0; font-size: 13.5px; color: #334155; line-height: 1.5;">
                ${status === 'Pending' ? 'The next process is <strong>L2 QA Validation (QAD Department setup verification review)</strong>.' : 
                  (status === 'Accepted' ? 'The next process is <strong>L3 Multi-Department HOD Decisions (Awaiting decision / acknowledgement from all selected department HODs and Admin)</strong>.' : 
                   'The next process is <strong>L2 Requester Validation (Requester re-uploads/corrects setup validation documentation)</strong>.')}
              </p>
            </div>
            
            <h3 style="color: #0f172a; font-size: 14px; font-weight: 600; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 24px; margin-bottom: 12px;">Validation Details</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13.5px; color: #475569;">
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b; width: 35%;"><strong>Change Request #</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600; font-family: monospace;">${changeNo}</td></tr>
              ${crTitle ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Title</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600;">${crTitle}</td></tr>` : ''}
              ${changeIn ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Change Category</strong></td><td style="padding: 10px 0; color: #1e293b;">${changeIn}</td></tr>` : ''}
              ${processName ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Process Name</strong></td><td style="padding: 10px 0; color: #1e293b;">${processName}</td></tr>` : ''}
              ${machineNo ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Machine No</strong></td><td style="padding: 10px 0; color: #1e293b; font-family: monospace;">${machineNo}</td></tr>` : ''}
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Change Requested By</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 500;">${requestBy} ${l1Dept ? `(${l1Dept})` : ''}</td></tr>
              ${remarks ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b; vertical-align: top; padding-top: 10px;"><strong>Remarks</strong></td><td style="padding: 10px 0; color: #334155; line-height: 1.5; font-size: 13px;">${remarks}</td></tr>` : ''}
            </table>
            
            <div style="text-align: center; margin: 32px 0 12px 0;">
              <a href="${process.env.APP_URL || 'http://localhost:5173'}" style="background-color: #1e40af; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 2px 4px rgba(30, 64, 175, 0.2);">
                Go to Dashboard
              </a>
            </div>
          </div>
          <div style="background-color: #f8fafc; padding: 16px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9;">
            This is an automated notification from the 4M Change Management System.
          </div>
        </div>
      `;

      if (recipientEmails.length > 0) {
        for (const email of recipientEmails) {
          await sendMail({ to: email, subject: emailSubject, html: emailHtml });
        }
      }
    }
  } catch (err) {
    console.error('Error sending L2 email notifications:', err);
  }
};
