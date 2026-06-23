import pool from '../config/db.js';
import { sendMail } from '../config/email.js';
import { broadcast } from '../config/websocket.js';

/**
 * Creates L3 approval decision notifications in the database for all departments.
 */
export const createL3DecisionNotifications = async (connection, changeNo, updatedDeptField, newDecision, changeIn, requestBy, requester, l1Dept) => {
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} Today`;
  const color = newDecision === 'Approved' ? 'green' : 'red';
  const notifIdsToSend = [];

  // Fetch all users to notify HODs and admins
  const [users] = await connection.query('SELECT email, role, department FROM users');

  const targetUsers = [];
  const seenEmails = new Set();

  if (requester) {
    seenEmails.add(requester.toLowerCase());
    targetUsers.push({ email: requester, department: l1Dept || 'General' });
  }

  for (const u of users) {
    const role = (u.role || '').toLowerCase();
    const isAdmin = role.includes('admin') || role.includes('administrator');
    const isHOD = role.includes('hod') || role.includes('manager');
    if (isAdmin || isHOD) {
      if (!seenEmails.has(u.email.toLowerCase())) {
        seenEmails.add(u.email.toLowerCase());
        targetUsers.push(u);
      }
    }
  }

  const requestDept = l1Dept || 'General';

  for (const targetUser of targetUsers) {
    const email = targetUser.email;
    const notifId = `L3-DECISION-NOTIF-${changeNo}-${requestDept.replace(/\s+/g, '_')}-${email.replace(/[@.]/g, '_')}-${Date.now()}`;
    const title = `L3 Approval ${newDecision} by ${updatedDeptField} HOD – ${changeNo}`;
    const details = `Change Request ${changeNo}${changeIn ? ` (${changeIn})` : ''} raised by ${requestBy} has been ${newDecision.toLowerCase()} by the ${updatedDeptField} HOD at L3 (Status: L3 HOD Review - ${newDecision} by ${updatedDeptField}).`;

    await connection.query(
      `INSERT INTO notifications (id, title, details, change_no, category, dept, time_str, is_read, type, color, recipient_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, 'System Logs', ?, ?)`,
      [notifId, title, details, changeNo, changeIn || 'GENERAL', requestDept, timeStr, color, email]
    );
    notifIdsToSend.push(notifId);
  }

  return notifIdsToSend;
};

/**
 * Sends email notifications to requester, HODs, and admins when an L3 decision is made.
 */
export const sendL3DecisionEmails = async (changeNo, updatedDeptField, newDecision, remarks, requester) => {
  try {
    // 1. Fetch details of the L1 request
    const [crRows] = await pool.query(
      `SELECT l1.change_no, l1.dept, l1.change_in, l1.request_by, l1.process_name, cr.title
       FROM change_requests cr
       LEFT JOIN l1_requests l1 ON cr.id = l1.change_no
       WHERE cr.id = ?`,
      [changeNo]
    );
    if (crRows.length === 0) return;
    const cr = crRows[0];

    // 2. Fetch target users (all department HODs and admins)
    const [users] = await pool.query('SELECT email, role, department FROM users');

    const recipientEmails = new Set();
    if (requester) recipientEmails.add(requester);

    for (const u of users) {
      const role = (u.role || '').toLowerCase();
      const isAdmin = role.includes('admin') || role.includes('administrator');
      const isHOD = role.includes('hod') || role.includes('manager');
      if (isAdmin || isHOD) {
        recipientEmails.add(u.email);
      }
    }

    const emailList = [...recipientEmails].filter(Boolean);
    if (emailList.length === 0) return;

    const themeColor = newDecision === 'Approved' ? '#10b981' : '#ef4444';
    const bgLight = newDecision === 'Approved' ? '#f0fdf4' : '#fef2f2';
    const badgeText = newDecision === 'Approved' ? 'L3 APPROVED' : 'L3 REJECTED';
    const badgeTextColor = newDecision === 'Approved' ? '#15803d' : '#991b1b';
    const borderLeftColor = newDecision === 'Approved' ? '#10b981' : '#ef4444';
    const emailSubject = `[4M-CMS] Status Update: L3 Review ${newDecision} for ${changeNo}`;

    const emailHtml = `
      <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); background-color: #ffffff;">
        <div style="background-color: ${themeColor}; color: white; padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">4M Change Management System</h1>
          <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px;">L3 Review Decision</p>
        </div>
        <div style="padding: 24px;">
          <h2 style="margin-top: 0; color: #1e293b; font-size: 18px; font-weight: 600;">Hello Team,</h2>
          <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
            A review decision has been recorded for L3 Change Request <strong>${changeNo}</strong> by the <strong>${updatedDeptField}</strong> HOD (Status: L3 HOD Review - ${newDecision} by ${updatedDeptField}).
          </p>
          <div style="background-color: ${bgLight}; border-left: 4px solid ${borderLeftColor}; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
            <div style="font-size: 12px; text-transform: uppercase; color: ${badgeTextColor}; font-weight: 600; letter-spacing: 0.5px;">Review Status</div>
            <div style="font-size: 18px; font-weight: 700; color: ${badgeTextColor}; margin-top: 4px;">${badgeText} by ${updatedDeptField}</div>
            <p style="margin: 6px 0 0 0; font-size: 13.5px; color: #334155; line-height: 1.5;">
              ${newDecision === 'Approved' ? 'This L3 reviewer HOD has approved the request. Once all L3 departments approve, the request proceeds.' : 'This L3 reviewer HOD has rejected the request. Please review the comments and feedback below.'}
            </p>
          </div>
          
          <h3 style="color: #0f172a; font-size: 14px; font-weight: 600; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 24px; margin-bottom: 12px;">Request Details</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13.5px; color: #475569;">
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b; width: 35%;"><strong>Change Request #</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600; font-family: monospace;">${changeNo}</td></tr>
            ${cr.title ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Title</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600;">${cr.title}</td></tr>` : ''}
            ${cr.change_in ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Category</strong></td><td style="padding: 10px 0; color: #1e293b;">${cr.change_in}</td></tr>` : ''}
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Requested By</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 500;">${cr.request_by || 'Requester'} (${cr.dept || ''})</td></tr>
            ${remarks ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b; vertical-align: top; padding-top: 10px;"><strong>HOD Remarks</strong></td><td style="padding: 10px 0; color: #334155; line-height: 1.5; font-size: 13px;">${remarks}</td></tr>` : ''}
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

    for (const email of emailList) {
      await sendMail({
        to: email,
        subject: emailSubject,
        html: emailHtml
      });
    }
  } catch (err) {
    console.error('Error sending L3 email decision alerts:', err);
  }
};

/**
 * Creates L3 completion notifications in the database for all department HODs, admins, and the requester.
 */
export const createL3CompletionNotifications = async (connection, changeNo, changeIn, requestBy, requester, l1Dept) => {
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} Today`;
  const notifIdsToSend = [];

  // Fetch all users to notify HODs and admins
  const [users] = await connection.query('SELECT email, role, department FROM users');

  const targetUsers = [];
  const seenEmails = new Set();

  if (requester) {
    seenEmails.add(requester.toLowerCase());
    targetUsers.push({ email: requester, department: l1Dept || 'General' });
  }

  for (const u of users) {
    const role = (u.role || '').toLowerCase();
    const isAdmin = role.includes('admin') || role.includes('administrator');
    const isHOD = role.includes('hod') || role.includes('manager');
    if (isAdmin || isHOD) {
      if (!seenEmails.has(u.email.toLowerCase())) {
        seenEmails.add(u.email.toLowerCase());
        targetUsers.push(u);
      }
    }
  }

  const requestDept = l1Dept || 'General';

  for (const targetUser of targetUsers) {
    const email = targetUser.email;
    const notifId = `L3-COMPLETION-NOTIF-${changeNo}-${requestDept.replace(/\s+/g, '_')}-${email.replace(/[@.]/g, '_')}-${Date.now()}`;
    const title = `L3 All Department Approvals Completed – ${changeNo}`;
    const details = `Change Request ${changeNo}${changeIn ? ` (${changeIn})` : ''} raised by ${requestBy} has been fully signed off by all department HODs at L3 (Status: L3 Completed).`;

    await connection.query(
      `INSERT INTO notifications (id, title, details, change_no, category, dept, time_str, is_read, type, color, recipient_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, 'System Logs', 'green', ?)`,
      [notifId, title, details, changeNo, changeIn || 'GENERAL', requestDept, timeStr, email]
    );
    notifIdsToSend.push(notifId);
  }

  return notifIdsToSend;
};

/**
 * Sends email notifications to requester, HODs, and admins when L3 approvals are fully completed.
 */
export const sendL3CompletionEmails = async (changeNo, requester) => {
  try {
    // 1. Fetch details of the L1 request
    const [crRows] = await pool.query(
      `SELECT l1.change_no, l1.dept, l1.change_in, l1.request_by, l1.process_name, cr.title
       FROM change_requests cr
       LEFT JOIN l1_requests l1 ON cr.id = l1.change_no
       WHERE cr.id = ?`,
      [changeNo]
    );
    if (crRows.length === 0) return;
    const cr = crRows[0];

    // 2. Fetch target users (all department HODs and admins)
    const [users] = await pool.query('SELECT email, role, department FROM users');

    const recipientEmails = new Set();
    if (requester) recipientEmails.add(requester);

    for (const u of users) {
      const role = (u.role || '').toLowerCase();
      const isAdmin = role.includes('admin') || role.includes('administrator');
      const isHOD = role.includes('hod') || role.includes('manager');
      if (isAdmin || isHOD) {
        recipientEmails.add(u.email);
      }
    }

    const emailList = [...recipientEmails].filter(Boolean);
    if (emailList.length === 0) return;

    const emailSubject = `[4M-CMS] L3 All Department Approvals Completed: ${changeNo}`;

    const emailHtml = `
      <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); background-color: #ffffff;">
        <div style="background-color: #10b981; color: white; padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">4M Change Management System</h1>
          <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px;">L3 Review Completed</p>
        </div>
        <div style="padding: 24px;">
          <h2 style="margin-top: 0; color: #1e293b; font-size: 18px; font-weight: 600;">Hello Team,</h2>
          <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
            We are pleased to inform you that Change Request <strong>${changeNo}</strong> has been <strong>fully approved and signed off by all departments at L3</strong> (Status: L3 Completed).
          </p>
          <div style="background-color: #f0fdf4; border-left: 4px solid #10b981; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
            <div style="font-size: 12px; text-transform: uppercase; color: #15803d; font-weight: 600; letter-spacing: 0.5px;">Final Workflow Status</div>
            <div style="font-size: 18px; font-weight: 700; color: #15803d; margin-top: 4px;">L3 FULLY COMPLETED</div>
            <p style="margin: 6px 0 0 0; font-size: 13.5px; color: #334155; line-height: 1.5;">
              All mandatory department HOD reviews are completed and the request has transitioned to the Completed stage.
            </p>
          </div>
          
          <h3 style="color: #0f172a; font-size: 14px; font-weight: 600; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 24px; margin-bottom: 12px;">Request Details</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13.5px; color: #475569;">
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b; width: 35%;"><strong>Change Request #</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600; font-family: monospace;">${changeNo}</td></tr>
            ${cr.title ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Title</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600;">${cr.title}</td></tr>` : ''}
            ${cr.change_in ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Category</strong></td><td style="padding: 10px 0; color: #1e293b;">${cr.change_in}</td></tr>` : ''}
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Requested By</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 500;">${cr.request_by || 'Requester'} (${cr.dept || ''})</td></tr>
          </table>
          
          <div style="text-align: center; margin: 32px 0 12px 0;">
            <a href="${process.env.APP_URL || 'http://localhost:5173'}" style="background-color: #10b981; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.2);">
              Go to Dashboard
            </a>
          </div>
        </div>
        <div style="background-color: #f8fafc; padding: 16px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9;">
          This is an automated notification from the 4M Change Management System.
        </div>
      </div>
    `;

    for (const email of emailList) {
      await sendMail({
        to: email,
        subject: emailSubject,
        html: emailHtml
      }).catch(mailErr => console.error(`Error sending L3 completion email to ${email}:`, mailErr));
    }
  } catch (err) {
    console.error('Error sending L3 completion email alerts:', err);
  }
};

/**
 * Creates L3 rejection notifications in the database for all department HODs, admins, and the requester.
 */
export const createL3RejectionNotifications = async (connection, changeNo, changeIn, requestBy, requester, l1Dept, rejectedDepts) => {
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} Today`;
  const notifIdsToSend = [];

  // Fetch all users to notify HODs and admins
  const [users] = await connection.query('SELECT email, role, department FROM users');

  const targetUsers = [];
  const seenEmails = new Set();

  if (requester) {
    seenEmails.add(requester.toLowerCase());
    targetUsers.push({ email: requester, department: l1Dept || 'General' });
  }

  for (const u of users) {
    const role = (u.role || '').toLowerCase();
    const isAdmin = role.includes('admin') || role.includes('administrator');
    const isHOD = role.includes('hod') || role.includes('manager');
    if (isAdmin || isHOD) {
      if (!seenEmails.has(u.email.toLowerCase())) {
        seenEmails.add(u.email.toLowerCase());
        targetUsers.push(u);
      }
    }
  }

  const requestDept = l1Dept || 'General';
  const rejectedDeptsStr = rejectedDepts.join(', ');

  for (const targetUser of targetUsers) {
    const email = targetUser.email;
    const notifId = `L3-REJECTION-NOTIF-${changeNo}-${requestDept.replace(/\s+/g, '_')}-${email.replace(/[@.]/g, '_')}-${Date.now()}`;
    const title = `L3 Approval Rejected – ${changeNo}`;
    const details = `Change Request ${changeNo}${changeIn ? ` (${changeIn})` : ''} raised by ${requestBy} has been rejected at L3 HOD review by the following department(s): ${rejectedDeptsStr} (Status: L3 Rejected).`;

    await connection.query(
      `INSERT INTO notifications (id, title, details, change_no, category, dept, time_str, is_read, type, color, recipient_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, 'System Logs', 'red', ?)`,
      [notifId, title, details, changeNo, changeIn || 'GENERAL', requestDept, timeStr, email]
    );
    notifIdsToSend.push(notifId);
  }

  // Also add an Action Required notification for the requester and admins
  const targetEmailsForL3Action = new Set();
  if (requester) {
    targetEmailsForL3Action.add(requester.toLowerCase().trim());
  }
  for (const u of users) {
    const uRole = (u.role || '').toLowerCase();
    if (uRole.includes('admin') || uRole.includes('administrator')) {
      targetEmailsForL3Action.add(u.email.toLowerCase().trim());
    }
  }

  const actionTitle = `L3 Rejected – ${changeNo}`;
  const actionDetails = `Change Request ${changeNo} has been rejected during the L3 Multi-Department HOD review (Status: L3 Rejected). Rejected by: ${rejectedDeptsStr}.`;

  for (const email of targetEmailsForL3Action) {
    const actionNotifId = `L3-REJECT-ACTION-${changeNo}-${email.replace(/[@.]/g, '_')}-${Date.now()}`;
    await connection.query(
      `INSERT INTO notifications (id, title, details, change_no, category, dept, time_str, is_read, type, color, recipient_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, 'Action Required', 'red', ?)`,
      [actionNotifId, actionTitle, actionDetails, changeNo, changeIn || 'GENERAL', requestDept, timeStr, email]
    );
  }

  return notifIdsToSend;
};

/**
 * Sends email notifications to requester, HODs, and admins when L3 approvals are rejected.
 */
export const sendL3RejectionEmails = async (changeNo, requester, rejectedDepts) => {
  try {
    // 1. Fetch details of the L1 request
    const [crRows] = await pool.query(
      `SELECT l1.change_no, l1.dept, l1.change_in, l1.request_by, l1.process_name, cr.title
       FROM change_requests cr
       LEFT JOIN l1_requests l1 ON cr.id = l1.change_no
       WHERE cr.id = ?`,
      [changeNo]
    );
    if (crRows.length === 0) return;
    const cr = crRows[0];

    // 2. Fetch target users (all department HODs and admins)
    const [users] = await pool.query('SELECT email, role, department FROM users');

    const recipientEmails = new Set();
    if (requester) recipientEmails.add(requester);

    for (const u of users) {
      const role = (u.role || '').toLowerCase();
      const isAdmin = role.includes('admin') || role.includes('administrator');
      const isHOD = role.includes('hod') || role.includes('manager');
      if (isAdmin || isHOD) {
        recipientEmails.add(u.email);
      }
    }

    const emailList = [...recipientEmails].filter(Boolean);
    if (emailList.length === 0) return;

    const rejectedDeptsStr = rejectedDepts.join(', ');
    const emailSubject = `[4M-CMS] Alert: L3 Approval Rejected for ${changeNo}`;

    const emailHtml = `
      <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); background-color: #ffffff;">
        <div style="background-color: #ef4444; color: white; padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">4M Change Management System</h1>
          <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px;">L3 Rejection Alert</p>
        </div>
        <div style="padding: 24px;">
          <h2 style="margin-top: 0; color: #1e293b; font-size: 18px; font-weight: 600;">Hello Team,</h2>
          <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
            A change request has been <strong>rejected at L3 HOD review</strong> (Status: L3 Rejected).
          </p>
          <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
            <div style="font-size: 12px; text-transform: uppercase; color: #991b1b; font-weight: 600; letter-spacing: 0.5px;">Review Status</div>
            <div style="font-size: 18px; font-weight: 700; color: #991b1b; margin-top: 4px;">L3 REJECTED</div>
            <p style="margin: 6px 0 0 0; font-size: 13.5px; color: #334155; line-height: 1.5;">
              The request was rejected during the L3 Multi-Department HOD reviews by: <strong>${rejectedDeptsStr}</strong>.
            </p>
          </div>
          
          <h3 style="color: #0f172a; font-size: 14px; font-weight: 600; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 24px; margin-bottom: 12px;">Request Details</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13.5px; color: #475569;">
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b; width: 35%;"><strong>Change Request #</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600; font-family: monospace;">${changeNo}</td></tr>
            ${cr.title ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Title</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600;">${cr.title}</td></tr>` : ''}
            ${cr.change_in ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Category</strong></td><td style="padding: 10px 0; color: #1e293b;">${cr.change_in}</td></tr>` : ''}
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Requested By</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 500;">${cr.request_by || 'Requester'} (${cr.dept || ''})</td></tr>
          </table>
          
          <div style="text-align: center; margin: 32px 0 12px 0;">
            <a href="${process.env.APP_URL || 'http://localhost:5173'}" style="background-color: #ef4444; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 2px 4px rgba(239, 68, 68, 0.2);">
              Go to Dashboard
            </a>
          </div>
        </div>
        <div style="background-color: #f8fafc; padding: 16px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9;">
          This is an automated notification from the 4M Change Management System.
        </div>
      </div>
    `;

    for (const email of emailList) {
      await sendMail({
        to: email,
        subject: emailSubject,
        html: emailHtml
      }).catch(mailErr => console.error(`Error sending L3 rejection email to ${email}:`, mailErr));
    }
  } catch (err) {
    console.error('Error sending L3 rejection email alerts:', err);
  }
};
