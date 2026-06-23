import pool from '../config/db.js';
import { broadcast } from '../config/websocket.js';
import { createL1DecisionNotifications, sendL1DecisionEmails } from './l1NotificationModel.js';

/**
 * Get all HOD approval requests — joins change_requests with l1_requests.
 * Completely separate from l3_approvals.
 */
export const getHodApprovals = async () => {
  const [rows] = await pool.query(
    `SELECT 
       cr.id          AS changeNo,
       cr.status      AS crStatus,
       DATE_FORMAT(cr.date, '%e %b %Y') AS date,
       COALESCE(l1.request_by, u.name, cr.requester) AS requestBy,
       cr.requester   AS requesterEmail,
       COALESCE(l1.dept, u.department, '') AS dept,
       l1.description AS description,
       l1.change_type AS changeType,
       l1.hod_approval AS hodApprovalNote,
       ha.hod_email   AS hodEmail,
       ha.hod_dept    AS hodDept,
       ha.status      AS hodStatus,
       ha.remarks     AS hodRemarks,
       ha.decided_at  AS decidedAt,
       uh.name        AS hodName,
       (SELECT COUNT(*) FROM hod_approvals WHERE change_no = cr.id AND status = 'Rejected') AS rejectCount,
       e.qa_approval  AS qaApproval
     FROM change_requests cr
     LEFT JOIN l1_requests l1 ON cr.id = l1.change_no
     LEFT JOIN users u ON cr.requester = u.email
     LEFT JOIN hod_approvals ha ON cr.id = ha.change_no AND ha.hod_dept = l1.hod_approval
     LEFT JOIN users uh ON ha.hod_email = uh.email
     LEFT JOIN effectiveness_logs e ON cr.id = e.change_no
     ORDER BY cr.created_at DESC, CAST(SUBSTRING_INDEX(cr.id, '-', -1) AS UNSIGNED) DESC`
  );
  return rows;
};

/**
 * Get HOD approvals for a specific department HOD.
 */
export const getHodApprovalsByDept = async (dept) => {
  const [rows] = await pool.query(
    `SELECT 
       cr.id          AS changeNo,
       cr.status      AS crStatus,
       DATE_FORMAT(cr.date, '%e %b %Y') AS date,
       COALESCE(l1.request_by, u.name, cr.requester) AS requestBy,
       cr.requester   AS requesterEmail,
       COALESCE(l1.dept, u.department, '') AS dept,
       l1.description AS description,
       l1.change_type AS changeType,
       l1.hod_approval AS hodApprovalNote,
       ha.hod_email   AS hodEmail,
       ha.hod_dept    AS hodDept,
       ha.status      AS hodStatus,
       ha.remarks     AS hodRemarks,
       ha.decided_at  AS decidedAt,
       uh.name        AS hodName,
       (SELECT COUNT(*) FROM hod_approvals WHERE change_no = cr.id AND status = 'Rejected') AS rejectCount,
       e.qa_approval  AS qaApproval
     FROM change_requests cr
     LEFT JOIN l1_requests l1 ON cr.id = l1.change_no
     LEFT JOIN users u ON cr.requester = u.email
     LEFT JOIN hod_approvals ha ON cr.id = ha.change_no AND ha.hod_dept = l1.hod_approval
     LEFT JOIN users uh ON ha.hod_email = uh.email
     LEFT JOIN effectiveness_logs e ON cr.id = e.change_no
     WHERE l1.change_no IS NOT NULL
     ORDER BY cr.created_at DESC, CAST(SUBSTRING_INDEX(cr.id, '-', -1) AS UNSIGNED) DESC`
  );
  return rows;
};

/**
 * Get a single HOD approval record for a specific change_no + dept.
 */
export const getHodApprovalByChangeAndDept = async (changeNo, dept) => {
  const [rows] = await pool.query(
    `SELECT * FROM hod_approvals WHERE change_no = ? AND hod_dept = ?`,
    [changeNo, dept]
  );
  return rows[0] || null;
};

/**
 * Save HOD approval decision — INSERT or UPDATE.
 */
export const saveHodApproval = async ({ changeNo, hodEmail, hodDept, status, remarks }) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Upsert into hod_approvals
    await connection.query(
      `INSERT INTO hod_approvals (change_no, hod_email, hod_dept, status, remarks, decided_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         hod_email  = VALUES(hod_email),
         status     = VALUES(status),
         remarks    = VALUES(remarks),
         decided_at = NOW()`,
      [changeNo, hodEmail, hodDept, status, remarks || '']
    );

    // Update the change_request status based on decision
    if (status === 'Approved') {
      await connection.query(
        `UPDATE change_requests SET status = 'Evaluating' WHERE id = ? AND status = 'Pending'`,
        [changeNo]
      );
    } else if (status === 'Rejected') {
      await connection.query(
        `UPDATE change_requests SET status = 'Pending' WHERE id = ?`,
        [changeNo]
      );
    }

    // Create decision notifications and retrieve details for emails
    const { crDetails } = await createL1DecisionNotifications(connection, changeNo, hodDept, status, remarks);

    await connection.commit();

    // Broadcast real-time update to all connected clients
    broadcast({ type: 'REFRESH_CHANGES' });
    broadcast({ type: 'REFRESH_NOTIFICATIONS' });

    // Send email notifications asynchronously after commit
    sendL1DecisionEmails(changeNo, hodDept, status, remarks, crDetails).catch(err =>
      console.error('Error sending L1 decision emails:', err)
    );

    return { changeNo, hodEmail, hodDept, status, remarks };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Ensure hod_approvals table exists (run once on startup if needed).
 * The table is created in schema.sql, this is a safety check.
 */
export const ensureHodApprovalsTable = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS hod_approvals (
       id         INT AUTO_INCREMENT PRIMARY KEY,
       change_no  VARCHAR(50) NOT NULL,
       hod_email  VARCHAR(255) NOT NULL,
       hod_dept   VARCHAR(100) NOT NULL,
       status     VARCHAR(50) NOT NULL DEFAULT 'Pending',
       remarks    TEXT,
       decided_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       UNIQUE KEY uk_change_dept (change_no, hod_dept),
       FOREIGN KEY (change_no) REFERENCES change_requests(id) ON UPDATE CASCADE ON DELETE CASCADE
     )`
  );
};
