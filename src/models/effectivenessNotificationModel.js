import pool from '../config/db.js';
import { sendMail } from '../config/email.js';
import { broadcast } from '../config/websocket.js';

/**
 * Sends DB notifications and emails to requester, all HODs, and admins
 * when QA effectiveness evaluation is decided (Approved or Rejected).
 */
export const triggerEffectivenessQAAlert = async (changeNo, qaApproval, remarks) => {
  try {
    // 1. Fetch requester email and change request details
    const [crRows] = await pool.query(
      `SELECT cr.id, cr.title, cr.requester as requesterEmail, 
              COALESCE(l1.request_by, u.name, cr.requester) as requesterName,
              COALESCE(l1.dept, u.department) as dept, l1.process_name as processName, l1.machine_no as machineNo
       FROM change_requests cr
       LEFT JOIN l1_requests l1 ON cr.id = l1.change_no
       LEFT JOIN users u ON cr.requester = u.email
       WHERE cr.id = ?`,
      [changeNo]
    );

    if (crRows.length === 0) return;
    const cr = crRows[0];

    // 2. Fetch all users to find HODs and Admins
    const [users] = await pool.query('SELECT email, role, department FROM users');

    const recipientEmails = new Set();
    // Add requester
    if (cr.requesterEmail) {
      recipientEmails.add(cr.requesterEmail.toLowerCase());
    }

    // Add HODs and Admins
    for (const user of users) {
      const role = (user.role || '').toLowerCase();
      const isAdmin = role.includes('admin') || role.includes('administrator');
      const isHOD = role.includes('hod') || role.includes('manager');
      if (isAdmin || isHOD) {
        recipientEmails.add(user.email.toLowerCase());
      }
    }

    const isApproved = qaApproval === 'Approved';
    const color = isApproved ? 'green' : 'red';
    const headerBg = isApproved ? '#16a34a' : '#dc2626';
    const borderLeftColor = isApproved ? '#16a34a' : '#dc2626';
    const remarksTextColor = isApproved ? '#15803d' : '#991b1b';
    const remarksBg = isApproved ? '#f0fdf4' : '#fef2f2';

    // 3. Create a notification in the DB for each target user specifically (no department broadcast)
    const title = `Effectiveness QA ${qaApproval} – ${changeNo}`;
    const details = `The effectiveness monitoring observations for Change Request ${changeNo} have been ${qaApproval} by QA. Remarks: ${remarks}`;
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} Today`;

    for (const email of recipientEmails) {
      const personalNotifId = `EFF-QA-${qaApproval.toUpperCase()}-${changeNo}-${email.replace(/[@.]/g, '_')}-${Date.now()}`;
      await pool.query(
        `INSERT INTO notifications (id, title, details, change_no, category, dept, time_str, is_read, type, color, recipient_email)
         VALUES (?, ?, ?, ?, 'SYSTEM', ?, ?, FALSE, 'Action Required', ?, ?)`,
        [personalNotifId, title, details, changeNo, cr.dept || 'General', timeStr, color, email]
      );
    }

    broadcast({ type: 'REFRESH_NOTIFICATIONS' });

    // 4. Send email notification to all recipients (using BCC to save SMTP requests)
    const emailContent = `
      <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); background-color: #ffffff;">
         <div style="background-color: ${headerBg}; color: white; padding: 24px; text-align: center;">
           <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">4M Change Management System</h1>
           <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px;">Effectiveness Evaluation ${qaApproval.toUpperCase()}</p>
         </div>
         <div style="padding: 24px;">
           <h2 style="margin-top: 0; color: #1e293b; font-size: 18px; font-weight: 600;">Hello Team,</h2>
           <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
             The QAD department has recorded the effectiveness monitoring evaluation decision for Change Request <strong>${changeNo}</strong>.
           </p>
          
          <div style="background-color: ${remarksBg}; border-left: 4px solid ${borderLeftColor}; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
            <div style="font-size: 12px; text-transform: uppercase; color: ${remarksTextColor}; font-weight: 600; letter-spacing: 0.5px;">Evaluation Status</div>
            <div style="font-size: 18px; font-weight: 700; color: ${remarksTextColor}; margin-top: 4px;">Effectiveness: ${qaApproval.toUpperCase()}</div>
            <p style="margin: 6px 0 0 0; font-size: 13.5px; color: #334155; line-height: 1.5;">
              <strong>QA Decision comments / remarks:</strong><br />
              ${remarks || 'No remarks provided.'}
            </p>
          </div>
          
          <h3 style="color: #0f172a; font-size: 14px; font-weight: 600; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 24px; margin-bottom: 12px;">Request Details</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13.5px; color: #475569;">
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b; width: 35%;"><strong>Change Request #</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600; font-family: monospace;">${changeNo}</td></tr>
            ${cr.title ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Title</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600;">${cr.title}</td></tr>` : ''}
            ${cr.requesterName ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Requested By</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 500;">${cr.requesterName} ${cr.dept ? `(${cr.dept})` : ''}</td></tr>` : ''}
            ${cr.processName ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Process Name</strong></td><td style="padding: 10px 0; color: #1e293b;">${cr.processName}</td></tr>` : ''}
            ${cr.machineNo ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Machine No</strong></td><td style="padding: 10px 0; color: #1e293b; font-family: monospace;">${cr.machineNo}</td></tr>` : ''}
          </table>
          
          <div style="text-align: center; margin: 32px 0 12px 0;">
            <a href="${process.env.APP_URL || 'http://localhost:5173'}" style="background-color: ${headerBg}; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">
              Go to Dashboard
            </a>
          </div>
        </div>
        <div style="background-color: #f8fafc; padding: 16px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9;">
          This is an automated notification from the Nippon QA 4M Change Management System.<br />
          Please do not reply directly to this email.
        </div>
      </div>
    `;

    const emailList = [...recipientEmails].filter(Boolean);
    if (emailList.length > 0) {
      for (const email of emailList) {
        await sendMail({
          to: email,
          subject: `[4M-CMS] Status Update: Effectiveness Evaluation ${qaApproval} for ${changeNo}`,
          html: emailContent,
          text: `Effectiveness Evaluation ${qaApproval} for Change Request ${changeNo}\n\nQA Comments: ${remarks}`
        });
      }
    }
  } catch (error) {
    console.error('Error triggering effectiveness QA alert:', error);
  }
};
