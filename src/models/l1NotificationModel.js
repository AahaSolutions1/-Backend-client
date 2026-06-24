import pool from '../config/db.js';
import { sendMail } from '../config/email.js';

/**
 * Creates L1-specific HOD approval required notifications in the DB.
 */
export const createL1RequestNotifications = async (connection, changeNo, hodApproval, changeIn, requestBy, dept) => {
  const selectedDepts = hodApproval ? hodApproval.split(',').map(s => s.trim()).filter(Boolean) : [];
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} Today`;
  const notifIds = [];

  // Query all users to resolve target users
  const [users] = await connection.query('SELECT email, role, department FROM users');
  
  // Get requester email from change_requests table
  const [crRows] = await connection.query(
    'SELECT requester FROM change_requests WHERE id = ?',
    [changeNo]
  );
  const requesterEmail = crRows.length > 0 ? crRows[0].requester : null;

  const selectedDeptsLower = selectedDepts.map(d => d.toLowerCase());
  const targetUsers = [];
  const seenEmails = new Set();

  if (requesterEmail) {
    seenEmails.add(requesterEmail.toLowerCase());
  }

  for (const user of users) {
    const userEmail = user.email.toLowerCase();
    const userRole = (user.role || '').toLowerCase();
    const userDept = (user.department || '').toLowerCase();
    
    const isHOD = userRole.includes('hod') || userRole.includes('manager');
    const isAdmin = userRole.includes('admin') || userRole.includes('administrator');
    
    if (isAdmin || (isHOD && selectedDeptsLower.includes(userDept))) {
      if (!seenEmails.has(userEmail)) {
        seenEmails.add(userEmail);
        targetUsers.push(user);
      }
    }
  }

  // Send HOD approval required notifications to target HODs/Admins (excluding requester)
  for (const targetUser of targetUsers) {
    const notifId = `L1-HOD-NOTIF-${changeNo}-${targetUser.email.replace(/[@.]/g, '_')}-${Date.now()}`;
    const notifTitle = `HOD Approval Required – ${changeNo}`;
    const notifDetails = `Change Request ${changeNo} created by ${requestBy} (${dept} department) requires HOD approval/validation (Approved or Rejected decision) from the selected department(s) (${hodApproval}) (Status: Pending L1 HOD Approval).`;
    
    await connection.query(
      `INSERT INTO notifications (id, title, details, change_no, category, dept, time_str, is_read, type, color, recipient_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, 'Action Required', 'blue', ?)`,
      [notifId, notifTitle, notifDetails, changeNo, changeIn || 'GENERAL', dept || 'General', timeStr, targetUser.email]
    );
    notifIds.push(notifId);
  }

  // Send personal confirmation notification to the requester
  if (requesterEmail) {
    const requesterNotifId = `L1-REQUESTER-CONFIRM-${changeNo}-${Date.now()}`;
    const requesterNotifTitle = `L1 Change Request Submitted – ${changeNo}`;
    const requesterNotifDetails = `L1 Change Request ${changeNo} has been submitted successfully and is now awaiting HOD approval/validation (Status: Pending L1 HOD Approval).`;
    
    await connection.query(
      `INSERT INTO notifications (id, title, details, change_no, category, dept, time_str, is_read, type, color, recipient_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, 'Info', 'blue', ?)`,
      [requesterNotifId, requesterNotifTitle, requesterNotifDetails, changeNo, changeIn || 'GENERAL', dept || 'General', timeStr, requesterEmail]
    );
    notifIds.push(requesterNotifId);
  }

  return notifIds;
};

/**
 * Sends email alerts to selected department HODs and all system Admins for the new L1 Change Request.
 */
export const sendL1RequestEmails = async (changeNo, hodApproval, changeIn, requestBy, dept) => {
  try {
    const selectedDepts = hodApproval ? hodApproval.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (selectedDepts.length === 0) return;

    // Fetch L1 details to populate the email table
    const [l1Rows] = await pool.query(
      `SELECT l1.change_no, l1.dept, l1.change_in, l1.request_by, l1.process_name, l1.process_line, l1.machine_no, l1.description, cr.title, cr.requester as requesterEmail
       FROM l1_requests l1
       LEFT JOIN change_requests cr ON l1.change_no = cr.id
       WHERE l1.change_no = ?`,
      [changeNo]
    );
    if (l1Rows.length === 0) return;
    const l1Details = l1Rows[0];

    // Fetch all users
    const [users] = await pool.query('SELECT email, role, department FROM users');

    const targetEmails = new Set();
    const requesterEmail = l1Details.requesterEmail ? l1Details.requesterEmail.toLowerCase().trim() : null;
    const selectedDeptsLower = selectedDepts.map(d => d.toLowerCase());

    for (const user of users) {
      const userEmail = user.email.toLowerCase().trim();
      const userRole = (user.role || '').toLowerCase();
      const userDept = (user.department || '').toLowerCase();
      
      const isHOD = userRole.includes('hod') || userRole.includes('manager');
      const isAdmin = userRole.includes('admin') || userRole.includes('administrator');
      
      // Add admins and HODs of selected departments (excluding requester)
      if (userEmail !== requesterEmail) {
        if (isAdmin || (isHOD && selectedDeptsLower.includes(userDept))) {
          targetEmails.add(userEmail);
        }
      }
    }
    const emailList = [...targetEmails].filter(Boolean);
    
    // Send main review required alert to HODs & Admins
    if (emailList.length > 0) {
      const emailContent = `
        <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); background-color: #ffffff;">
          <div style="background-color: #1e40af; color: white; padding: 24px; text-align: center;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">4M Change Management System</h1>
            <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px;">HOD & Admin Review Request</p>
          </div>
          <div style="padding: 24px;">
            <h2 style="margin-top: 0; color: #1e293b; font-size: 18px; font-weight: 600;">Hello Team,</h2>
            <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
              A new change request has been submitted and requires review and approval/validation from the selected department HOD(s).
            </p>
            <div style="background-color: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
              <div style="font-size: 12px; text-transform: uppercase; color: #1e40af; font-weight: 600; letter-spacing: 0.5px;">Action Required</div>
              <div style="font-size: 16px; font-weight: 700; color: #1e3a8a; margin-top: 4px;">Awaiting HOD Approval / Validation</div>
              <p style="margin: 6px 0 0 0; font-size: 13px; color: #1e40af; line-height: 1.4;">
                HOD approval is pending from: <strong>${selectedDepts.join(', ')}</strong>. System administrators have also been notified.
              </p>
            </div>
            
            <h3 style="color: #0f172a; font-size: 14px; font-weight: 600; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 24px; margin-bottom: 12px;">Request Details</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13.5px; color: #475569;">
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b; width: 35%;"><strong>Change Request #</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600; font-family: monospace;">${changeNo}</td></tr>
              ${l1Details.title ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Title</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600;">${l1Details.title}</td></tr>` : ''}
              ${l1Details.change_in ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Change Category</strong></td><td style="padding: 10px 0; color: #1e293b;">${l1Details.change_in}</td></tr>` : ''}
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Requested By</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 500;">${l1Details.request_by} (${l1Details.dept})</td></tr>
              ${l1Details.process_name ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Process Name</strong></td><td style="padding: 10px 0; color: #1e293b;">${l1Details.process_name} ${l1Details.process_line ? `(Line: ${l1Details.process_line})` : ''}</td></tr>` : ''}
              ${l1Details.machine_no ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Machine No</strong></td><td style="padding: 10px 0; color: #1e293b; font-family: monospace;">${l1Details.machine_no}</td></tr>` : ''}
              ${l1Details.description ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b; vertical-align: top; padding-top: 10px;"><strong>Description</strong></td><td style="padding: 10px 0; color: #334155; line-height: 1.5; font-size: 13px;">${l1Details.description}</td></tr>` : ''}
            </table>
            
            <div style="text-align: center; margin: 32px 0 12px 0;">
              <a href="${process.env.APP_URL || 'http://localhost:5173'}" style="background-color: #1e40af; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 2px 4px rgba(30, 64, 175, 0.2);">
                Go to Dashboard
              </a>
            </div>
          </div>
          <div style="background-color: #f8fafc; padding: 16px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9;">
            This is an automated notification from the Nippon QAD 4M Change Management System.<br />
            Please do not reply directly to this email.
          </div>
        </div>
      `;
      
      for (const email of emailList) {
        await sendMail({
          to: email,
          subject: `[4M-CMS] Action Required: HOD & Admin Review for ${changeNo}`,
          html: emailContent
        });
      }
    }

    // Send confirmation email to the requester
    if (requesterEmail) {
      const confirmHtml = `
        <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); background-color: #ffffff;">
          <div style="background-color: #2563eb; color: white; padding: 24px; text-align: center;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">4M Change Management System</h1>
            <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px;">L1 Submission Confirmed</p>
          </div>
          <div style="padding: 24px;">
            <h2 style="margin-top: 0; color: #1e293b; font-size: 18px; font-weight: 600;">Hello ${l1Details.request_by || 'Requester'},</h2>
            <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
              L1 Change Request has been successfully submitted and is now awaiting validation.
            </p>
            <div style="background-color: #f0fdf4; border-left: 4px solid #10b981; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
              <div style="font-size: 12px; text-transform: uppercase; color: #15803d; font-weight: 600; letter-spacing: 0.5px;">Submission Status</div>
              <div style="font-size: 16px; font-weight: 700; color: #166534; margin-top: 4px;">Pending HOD Approval</div>
              <p style="margin: 6px 0 0 0; font-size: 13px; color: #166534; line-height: 1.4;">
                The request is queued for HOD review from: <strong>${selectedDepts.join(', ')}</strong>.
              </p>
            </div>
            
            <h3 style="color: #0f172a; font-size: 14px; font-weight: 600; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 24px; margin-bottom: 12px;">Request Details</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13.5px; color: #475569;">
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b; width: 35%;"><strong>Change Request #</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600; font-family: monospace;">${changeNo}</td></tr>
              ${l1Details.title ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Title</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600;">${l1Details.title}</td></tr>` : ''}
              ${l1Details.change_in ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Change Category</strong></td><td style="padding: 10px 0; color: #1e293b;">${l1Details.change_in}</td></tr>` : ''}
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Requested By</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 500;">${l1Details.request_by} (${l1Details.dept})</td></tr>
              ${l1Details.process_name ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Process Name</strong></td><td style="padding: 10px 0; color: #1e293b;">${l1Details.process_name}</td></tr>` : ''}
              ${l1Details.machine_no ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Machine No</strong></td><td style="padding: 10px 0; color: #1e293b; font-family: monospace;">${l1Details.machine_no}</td></tr>` : ''}
            </table>
            
            <p style="color: #64748b; font-size: 13px; line-height: 1.6; margin-bottom: 0;">
              The HOD(s) and system administrators have been notified. You will receive an email update as soon as a decision is made.
            </p>
            
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
        to: requesterEmail,
        subject: `[4M-CMS] Submission Confirmed: L1 Change Request ${changeNo}`,
        html: confirmHtml
      });
    }

  } catch (error) {
    console.error('Error sending L1 HOD and Admin emails:', error);
  }
};

/**
 * Creates L1 approval decision notifications in the DB.
 */
export const createL1DecisionNotifications = async (connection, changeNo, hodDept, status, remarks) => {
  // Fetch requester email to notify them
  const [crRows] = await connection.query(
    `SELECT cr.requester, COALESCE(l1.dept, u.department) as raisedDept, u.department as userDept, l1.change_in as changeIn
     FROM change_requests cr
     LEFT JOIN l1_requests l1 ON cr.id = l1.change_no
     LEFT JOIN users u ON cr.requester = u.email
     WHERE cr.id = ?`,
    [changeNo]
  );

  const notifIds = [];

  if (crRows.length > 0) {
    const { requester, raisedDept, userDept, changeIn } = crRows[0];
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} Today`;
    
    // Resolve target users (requester, admins, HODs of raisedDept, and HODs of approved hodDept)
    const [users] = await connection.query('SELECT email, role, department FROM users');
    const raisedDeptLower = (raisedDept || '').toLowerCase();
    const hodDeptLower = (hodDept || '').toLowerCase();
    const targetUsers = [];
    const seenEmails = new Set();

    if (requester) {
      seenEmails.add(requester.toLowerCase());
      targetUsers.push({ email: requester, department: userDept || raisedDept || 'General' });
    }

    for (const user of users) {
      const userEmail = user.email.toLowerCase();
      const userRole = (user.role || '').toLowerCase();
      const userDeptName = (user.department || '').toLowerCase();
      
      const isAdmin = userRole.includes('admin') || userRole.includes('administrator');
      const isHOD = userRole.includes('hod') || userRole.includes('manager');
      
      if (!seenEmails.has(userEmail)) {
        if (status === 'Rejected') {
          if (isAdmin || isHOD) {
            seenEmails.add(userEmail);
            targetUsers.push(user);
          }
        } else {
          if (isAdmin || (isHOD && (userDeptName === raisedDeptLower || userDeptName === hodDeptLower))) {
            seenEmails.add(userEmail);
            targetUsers.push(user);
          }
        }
      }
    }

    const color = status === 'Approved' ? 'green' : 'red';
    const title = `HOD ${status} – ${changeNo}`;
    const nextProcessStr = status === 'Approved' ? ' The next process is L2 Requester Validation (Requester uploads setup validation documentation).' : '';
    const details = `Change Request ${changeNo}${changeIn ? ` (${changeIn})` : ''} has been ${status.toLowerCase()} by the ${hodDept} HOD (Status: L1 ${status}).${remarks ? ` Remarks: ${remarks}` : ''}${nextProcessStr}`;

    for (const targetUser of targetUsers) {
      const notifId = `HOD-DECISION-${changeNo}-${hodDept.replace(/\s+/g, '_')}-${targetUser.email.replace(/[@.]/g, '_')}-${Date.now()}`;
      await connection.query(
        `INSERT INTO notifications (id, title, details, change_no, category, dept, time_str, is_read, type, color, recipient_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, 'System Logs', ?, ?)`,
        [notifId, title, details, changeNo, changeIn || 'GENERAL', raisedDept || userDept || 'General', timeStr, color, targetUser.email]
      );
      notifIds.push(notifId);
    }

    // Add an Action Required notification for the requester and admins
    if (status === 'Approved' || status === 'Rejected') {
      const targetEmailsForL1L2Action = new Set();
      if (requester) {
        targetEmailsForL1L2Action.add(requester.toLowerCase().trim());
      }
      for (const u of users) {
        const uRole = (u.role || '').toLowerCase();
        if (uRole.includes('admin') || uRole.includes('administrator')) {
          targetEmailsForL1L2Action.add(u.email.toLowerCase().trim());
        }
      }

      const isApp = status === 'Approved';
      const actionTitle = isApp ? `L1 Approved - Proceed to L2 Validation` : `L1 Rejected – ${changeNo}`;
      const actionDetails = isApp 
        ? `Change Request ${changeNo} has been approved by the HOD (Status: L1 Approved). The next process is L2 Requester Validation (Requester uploads setup validation documentation).`
        : `Change Request ${changeNo} has been rejected by the HOD (Status: L1 Rejected). Please review the remarks.`;
      const actionColor = isApp ? 'blue' : 'red';
      const notifPrefix = isApp ? 'L2-ACTION' : 'L1-REJECT-ACTION';

      for (const email of targetEmailsForL1L2Action) {
        const actionNotifId = `${notifPrefix}-${changeNo}-${email.replace(/[@.]/g, '_')}-${Date.now()}`;
        await connection.query(
          `INSERT INTO notifications (id, title, details, change_no, category, dept, time_str, is_read, type, color, recipient_email)
           VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, 'Action Required', ?, ?)`,
          [actionNotifId, actionTitle, actionDetails, changeNo, changeIn || 'GENERAL', raisedDept || userDept || 'General', timeStr, actionColor, email]
        );
        notifIds.push(actionNotifId);
      }
    }
  }

  return { notifIds, crDetails: crRows[0] };
};

/**
 * Sends email alerts for the L1 HOD decision (Approval/Rejection).
 */
export const sendL1DecisionEmails = async (changeNo, hodDept, status, remarks, crDetails) => {
  try {
    if (!crDetails) return;
    const { requester, raisedDept, userDept, changeIn } = crDetails;

    // Retrieve L1 details
    const [l1Rows] = await pool.query(
      `SELECT cr.title, COALESCE(l1.request_by, u.name) as requesterName
       FROM change_requests cr
       LEFT JOIN l1_requests l1 ON cr.id = l1.change_no
       LEFT JOIN users u ON cr.requester = u.email
       WHERE cr.id = ?`,
      [changeNo]
    );
    const crTitle = l1Rows.length > 0 ? l1Rows[0].title : '';
    const requesterName = l1Rows.length > 0 ? l1Rows[0].requesterName : 'Requester';

    // Find all users in the raised department or admin to notify about decision
    const [users] = await pool.query('SELECT email, role, department FROM users');
    const targetEmails = new Set();
    
    // Always email the requester
    if (requester) {
      targetEmails.add(requester);
    }

    const raisedDeptLower = (raisedDept || '').toLowerCase();
    const hodDeptLower = (hodDept || '').toLowerCase();
    for (const user of users) {
      const userEmail = user.email;
      const userRole = (user.role || '').toLowerCase();
      const userDept = (user.department || '').toLowerCase();
      
      const isAdmin = userRole.includes('admin') || userRole.includes('administrator');
      const isHOD = userRole.includes('hod') || userRole.includes('manager');
      
      // Email admins, HODs of raised department, and HODs of approved department (or all HODs/Admins on rejection)
      if (status === 'Rejected') {
        if (isAdmin || isHOD || userEmail.toLowerCase() === requester.toLowerCase()) {
          targetEmails.add(userEmail);
        }
      } else {
        if (isAdmin || (isHOD && (userDept === raisedDeptLower || userDept === hodDeptLower)) || userEmail.toLowerCase() === requester.toLowerCase()) {
          targetEmails.add(userEmail);
        }
      }
    }

    const emailList = [...targetEmails].filter(Boolean);
    if (emailList.length === 0) return;

    const themeColor = status === 'Approved' ? '#10b981' : '#ef4444';
    const bgLight = status === 'Approved' ? '#f0fdf4' : '#fef2f2';
    const badgeText = status === 'Approved' ? 'L1 APPROVED' : 'L1 REJECTED';
    const badgeTextColor = status === 'Approved' ? '#15803d' : '#991b1b';
    const borderLeftColor = status === 'Approved' ? '#10b981' : '#ef4444';

    const emailHtml = `
      <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); background-color: #ffffff;">
        <div style="background-color: ${themeColor}; color: white; padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">4M Change Management System</h1>
          <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px;">L1 Review Decision</p>
        </div>
        <div style="padding: 24px;">
          <h2 style="margin-top: 0; color: #1e293b; font-size: 18px; font-weight: 600;">Hello Team,</h2>
          <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
            A decision has been recorded for L1 Change Request <strong>${changeNo}</strong> by the <strong>${hodDept}</strong> HOD (Status: L1 ${status}).
          </p>
          <div style="background-color: ${bgLight}; border-left: 4px solid ${borderLeftColor}; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
            <div style="font-size: 12px; text-transform: uppercase; color: ${badgeTextColor}; font-weight: 600; letter-spacing: 0.5px;">Decision Status</div>
            <div style="font-size: 18px; font-weight: 700; color: ${badgeTextColor}; margin-top: 4px;">${badgeText}</div>
            <p style="margin: 6px 0 0 0; font-size: 13.5px; color: #334155; line-height: 1.5;">
              ${status === 'Approved' ? 'The request is approved at L1. The next process is <strong>L2 Requester Validation (Requester uploads setup validation documentation)</strong>.' : 'The request was rejected at L1. Please review the comments and feedback below.'}
            </p>
          </div>
          
          <h3 style="color: #0f172a; font-size: 14px; font-weight: 600; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 24px; margin-bottom: 12px;">Request Information</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13.5px; color: #475569;">
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b; width: 35%;"><strong>Change Request #</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600; font-family: monospace;">${changeNo}</td></tr>
            ${crTitle ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Title</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600;">${crTitle}</td></tr>` : ''}
            ${changeIn ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Category</strong></td><td style="padding: 10px 0; color: #1e293b;">${changeIn}</td></tr>` : ''}
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Requester</strong></td><td style="padding: 10px 0; color: #1e293b;">${requesterName}</td></tr>
            ${remarks ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b; vertical-align: top; padding-top: 10px;"><strong>HOD Remarks</strong></td><td style="padding: 10px 0; color: #334155; line-height: 1.5; font-size: 13px;">${remarks}</td></tr>` : ''}
          </table>
          
          <div style="text-align: center; margin: 32px 0 12px 0;">
            <a href="${process.env.APP_URL || 'http://localhost:5173'}" style="background-color: #1e40af; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 2px 4px rgba(30, 64, 175, 0.2);">
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
        subject: `[4M-CMS] L1 Decision Update: ${status} for ${changeNo}`,
        html: emailHtml
      });
    }
  } catch (error) {
    console.error('Error sending L1 HOD decision emails:', error);
  }
};
