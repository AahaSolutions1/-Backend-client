import pool from '../config/db.js';
import { sendMail } from '../config/email.js';
import { broadcast } from '../config/websocket.js';

const DEPARTMENTS = [
  { col: 'ped', name: 'PED' },
  { col: 'qad', name: 'QAD' },
  { col: 'production', name: 'Production' },
  { col: 'maintenance', name: 'Maintenance' },
  { col: 'pcl', name: 'PC & L' },
  { col: 'materials', name: 'Materials' },
  { col: 'marketing', name: 'Marketing' },
  { col: 'hr', name: 'HR' },
  { col: 'safety', name: 'Safety' },
  { col: 'unit_head', name: 'Unit Head' }
];

export const checkAndTriggerL3Reminders = async () => {
  console.log('⏰ Running checkAndTriggerL3Reminders cron check...');
  try {
    // 1. Fetch L3 approvals that are in progress for more than 24 hours
    // Joined with change_requests to make sure status is 'Approved' (active L3)
    const [pendingL3Requests] = await pool.query(`
      SELECT l3.change_no, l3.created_at, cr.title,
             l3.ped, l3.qad, l3.production, l3.maintenance, l3.pcl, 
             l3.materials, l3.marketing, l3.hr, l3.safety, l3.unit_head
      FROM l3_approvals l3
      INNER JOIN change_requests cr ON l3.change_no = cr.id
      WHERE cr.status = 'Approved'
        AND l3.created_at < NOW() - INTERVAL 24 HOUR
    `);

    if (pendingL3Requests.length === 0) {
      console.log('✅ No pending L3 requests requiring 24h HOD reminder.');
      return;
    }

    console.log(`🔍 Found ${pendingL3Requests.length} change requests in L3 stage for >24h. Checking individual department HODs...`);

    let newNotificationsCreated = false;

    for (const req of pendingL3Requests) {
      const { change_no, title } = req;

      for (const dept of DEPARTMENTS) {
        // If the approval status is 'Pending'
        if (req[dept.col] === 'Pending') {
          // Find the HOD user(s) for this department
          const [hods] = await pool.query(
            `SELECT email, name FROM users WHERE LOWER(role) = 'hod' AND department = ?`,
            [dept.name]
          );

          if (hods.length === 0) {
            console.warn(`⚠️ No HOD users found in database for department "${dept.name}". Cannot send L3 reminder.`);
            continue;
          }

          for (const hod of hods) {
            const email = hod.email;
            const name = hod.name || 'HOD';
            const notifId = `L3-REMINDER-24H-${change_no}-${dept.col}-${email.replace(/[@.]/g, '_')}`;

            // Check if reminder notification has already been triggered for this HOD
            const [existing] = await pool.query(
              `SELECT 1 FROM notifications WHERE id = ?`,
              [notifId]
            );

            if (existing.length > 0) {
              // Already sent, skip
              continue;
            }

            console.log(`📧 Triggering L3 24h pending reminder for change request ${change_no}, department: ${dept.name}, HOD: ${email}`);

            // Insert notification
            const now = new Date();
            const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} Today`;
            const notifTitle = `Action Required: L3 Approval Pending – ${change_no}`;
            const notifDetails = `Change Request ${change_no} is pending your review/decision at the L3 stage for more than 24 hours. Please update your decision.`;

            await pool.query(
              `INSERT INTO notifications (id, title, details, change_no, category, dept, time_str, is_read, type, color, recipient_email)
               VALUES (?, ?, ?, ?, 'GENERAL', ?, ?, FALSE, 'Action Required', 'amber', ?)`,
              [notifId, notifTitle, notifDetails, change_no, dept.name, timeStr, email]
            );

            newNotificationsCreated = true;

            // Send email
            const emailSubject = `[4M-CMS] Action Required: L3 HOD Approval Reminder - ${change_no}`;
            const emailHtml = `
              <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); background-color: #ffffff;">
                <div style="background-color: #d97706; color: white; padding: 24px; text-align: center;">
                  <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">4M Change Management System</h1>
                  <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px;">L3 Approval Pending Reminder</p>
                </div>
                <div style="padding: 24px;">
                  <h2 style="margin-top: 0; color: #1e293b; font-size: 18px; font-weight: 600;">Hello ${name},</h2>
                  <p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
                    This is an automated reminder that Change Request <strong>${change_no}</strong> is pending your review and decision at the <strong>L3 Multi-Department HOD Review</strong> stage for more than 24 hours.
                  </p>
                  
                  <div style="background-color: #fef3c7; border-left: 4px solid #d97706; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
                    <div style="font-size: 12px; text-transform: uppercase; color: #b45309; font-weight: 600; letter-spacing: 0.5px;">Awaiting Decision</div>
                    <div style="font-size: 18px; font-weight: 700; color: #b45309; margin-top: 4px;">L3 REVIEW PENDING (&gt;24 Hours)</div>
                    <p style="margin: 6px 0 0 0; font-size: 13.5px; color: #78350f; line-height: 1.5;">
                      Please review the request details on the dashboard and record your vote (Approved or Rejected) to allow the request to proceed.
                    </p>
                  </div>
                  
                  <h3 style="color: #0f172a; font-size: 14px; font-weight: 600; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 24px; margin-bottom: 12px;">Request Details</h3>
                  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13.5px; color: #475569;">
                    <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b; width: 35%;"><strong>Change Request #</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600; font-family: monospace;">${change_no}</td></tr>
                    <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Title</strong></td><td style="padding: 10px 0; color: #1e293b; font-weight: 600;">${title || 'Untitled Request'}</td></tr>
                    <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 0; color: #64748b;"><strong>Pending Department</strong></td><td style="padding: 10px 0; color: #d97706; font-weight: 600;">${dept.name}</td></tr>
                  </table>
                  
                  <div style="text-align: center; margin: 32px 0 12px 0;">
                    <a href="${process.env.APP_URL || 'http://localhost:5173'}" style="background-color: #d97706; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 2px 4px rgba(217, 119, 6, 0.2);">
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
              to: email,
              subject: emailSubject,
              html: emailHtml
            });
          }
        }
      }
    }

    if (newNotificationsCreated) {
      broadcast({ type: 'REFRESH_NOTIFICATIONS' });
    }
  } catch (err) {
    console.error('❌ Error in checkAndTriggerL3Reminders:', err);
  }
};

export const startL3ReminderScheduler = () => {
  // Execute check immediately at server start
  setTimeout(() => {
    checkAndTriggerL3Reminders();
  }, 5000); // 5s delay to allow DB/WebSocket to fully initialize

  // Run the check every 1 hour
  const intervalMs = 60 * 60 * 1000;
  setInterval(() => {
    checkAndTriggerL3Reminders();
  }, intervalMs);

  console.log('⏰ L3 HOD 24h Reminder Scheduler initialized. (Interval: 1 Hour)');
};
