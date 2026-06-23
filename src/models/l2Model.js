import pool from '../config/db.js';
import { broadcast } from '../config/websocket.js';
import { createL2Notifications, sendL2Emails } from './l2NotificationModel.js';

export const getL2ValidationLogs = async () => {
  const [rows] = await pool.query(
    `SELECT c.id as changeNo, 
            COALESCE(v.validation_date, DATE_FORMAT(c.date, '%Y-%m-%d')) as date, 
            COALESCE(NULLIF(u.name, ''), l1.request_by, v.requester) as requester, 
            COALESCE(v.weld_test, '-') as weldTest, 
            COALESCE(v.qa_test, '-') as qaTest, 
            COALESCE(v.status, 'Pending') as status, 
            COALESCE(v.remarks, '-') as remarks,
            c.requester as requesterEmail,
            CASE WHEN v.status IS NULL THEN 1 ELSE 0 END as isPending
     FROM change_requests c
     LEFT JOIN l1_requests l1 ON c.id = l1.change_no
     LEFT JOIN change_requests cr ON c.id = cr.id
     LEFT JOIN users u ON c.requester = u.email
     LEFT JOIN l2_validation_logs v ON c.id = v.change_no
     LEFT JOIN (
        SELECT change_no,
               COALESCE(
                 MIN(CASE WHEN status = 'Rejected' THEN 'Rejected' END),
                 MAX(CASE WHEN status = 'Approved' THEN 'Approved' END),
                 'Pending'
               ) as status
        FROM hod_approvals
        GROUP BY change_no
     ) ha ON c.id = ha.change_no
     LEFT JOIN effectiveness_logs e ON c.id = e.change_no
     WHERE ha.status = 'Approved'
       AND (v.status IS NULL OR v.status != 'Accepted')
       AND (e.qa_approval IS NULL OR e.qa_approval != 'Approved')
     ORDER BY c.created_at DESC, CAST(SUBSTRING_INDEX(c.id, '-', -1) AS UNSIGNED) DESC`
  );
  return rows;
};

export const addL2ValidationLog = async (logData, attachments) => {
  const { changeNo, date, requester, weldTest, qaTest, status, remarks } = logData;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existingL2] = await connection.query(
      `SELECT status FROM l2_validation_logs WHERE change_no = ?`,
      [changeNo]
    );

    if (existingL2.length > 0) {
      if (status === 'Accepted') {
        await connection.query(
          `UPDATE change_requests SET status = 'Approved' WHERE id = ?`,
          [changeNo]
        );
      } else if (status === 'Rejected' || status === 'Pending') {
        await connection.query(
          `UPDATE change_requests SET status = 'Evaluating' WHERE id = ?`,
          [changeNo]
        );
      }

      await connection.query(
        `UPDATE l2_validation_logs 
         SET validation_date = ?, 
             requester = ?, 
             weld_test = ?, 
             qa_test = ?, 
             status = COALESCE(NULLIF(?, ''), status), 
             remarks = COALESCE(NULLIF(?, ''), remarks)
         WHERE change_no = ?`,
        [date, requester, weldTest || '', qaTest || '', status || '', remarks || '', changeNo]
      );
    } else {
      const [existing] = await connection.query(
        `SELECT id FROM change_requests WHERE id = ?`,
        [changeNo]
      );
      if (existing.length === 0) {
        const [adminRows] = await connection.query("SELECT email FROM users WHERE role = 'Admin'");
        if (adminRows.length === 0) {
          throw new Error("No admin user found in database");
        }
        const adminEmail = adminRows[0].email;
        await connection.query(
          `INSERT INTO change_requests (id, title, requester, date, priority, status) 
           VALUES (?, ?, ?, CURDATE(), 'Medium', ?)`,
          [changeNo, `[L2 Auto] Validation for ${changeNo}`, adminEmail, status === 'Accepted' ? 'Approved' : 'Pending']
        );
      } else if (status === 'Accepted') {
        await connection.query(
          `UPDATE change_requests SET status = 'Approved' WHERE id = ?`,
          [changeNo]
        );
      } else if (status === 'Rejected' || status === 'Pending') {
        await connection.query(
          `UPDATE change_requests SET status = 'Evaluating' WHERE id = ?`,
          [changeNo]
        );
      }

      await connection.query(
        `INSERT INTO l2_validation_logs (change_no, validation_date, requester, weld_test, qa_test, status, remarks) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [changeNo, date, requester, weldTest || '', qaTest || '', status || 'Pending', remarks || '']
      );
    }

    if (status === 'Accepted') {
      await connection.query(
        `INSERT INTO l3_approvals (change_no, date, requester, ped, qad, production, maintenance, pcl, materials, marketing, hr, safety, unit_head)
         VALUES (?, ?, ?, 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending')
         ON DUPLICATE KEY UPDATE change_no = change_no`,
        [changeNo, date, requester]
      );
    }

    // Sync weld_test attachments in table
    const weldFiles = (weldTest || '').split(',').map(s => s.trim()).filter(Boolean);
    if (weldFiles.length === 0 || weldTest === '-') {
      await connection.query(
        `DELETE FROM l2_attachments WHERE change_no = ? AND field_name = 'weld_test'`,
        [changeNo]
      );
    } else {
      await connection.query(
        `DELETE FROM l2_attachments WHERE change_no = ? AND field_name = 'weld_test' AND file_name NOT IN (${weldFiles.map(() => '?').join(', ')})`,
        [changeNo, ...weldFiles]
      );
    }

    // Sync qa_test attachments in table
    const qaFilesList = (qaTest || '').split(',').map(s => s.trim()).filter(Boolean);
    if (qaFilesList.length === 0 || qaTest === '-') {
      await connection.query(
        `DELETE FROM l2_attachments WHERE change_no = ? AND field_name = 'qa_test'`,
        [changeNo]
      );
    } else {
      await connection.query(
        `DELETE FROM l2_attachments WHERE change_no = ? AND field_name = 'qa_test' AND file_name NOT IN (${qaFilesList.map(() => '?').join(', ')})`,
        [changeNo, ...qaFilesList]
      );
    }

    // Save newly uploaded L2 attachments
    if (attachments && attachments.length > 0) {
      for (const file of attachments) {
        await connection.query(
          `DELETE FROM l2_attachments WHERE change_no = ? AND field_name = ? AND file_name = ?`,
          [changeNo, file.fieldName, file.name]
        );
        await connection.query(
          `INSERT INTO l2_attachments (change_no, field_name, file_name, file_data, file_type) 
           VALUES (?, ?, ?, ?, ?)`,
          [changeNo, file.fieldName, file.name, file.data, file.type]
        );
      }
    }
    // Create notifications based on validation status
    const [l1Rows] = await connection.query(
      `SELECT dept, change_in, request_by, process_name, machine_no FROM l1_requests WHERE change_no = ?`,
      [changeNo]
    );
    const l1Dept = l1Rows.length > 0 ? l1Rows[0].dept : '';
    const changeIn = l1Rows.length > 0 ? l1Rows[0].change_in : '';
    const requestBy = l1Rows.length > 0 ? l1Rows[0].request_by : requester;
    const processName = l1Rows.length > 0 ? l1Rows[0].process_name : '';
    const machineNo = l1Rows.length > 0 ? l1Rows[0].machine_no : '';

    // Fetch requester email and title of the change request
    const [crRequesterRow] = await connection.query(
      `SELECT requester, title FROM change_requests WHERE id = ?`,
      [changeNo]
    );
    const crRequesterEmail = crRequesterRow.length > 0 ? crRequesterRow[0].requester : '';
    const crTitle = crRequesterRow.length > 0 ? crRequesterRow[0].title : '';
    const [reqUserRow] = await connection.query(
      `SELECT department FROM users WHERE email = ?`,
      [crRequesterEmail]
    );
    const crRequesterDept = reqUserRow.length > 0 ? reqUserRow[0].department : '';

    const resolvedTargetUsers = await createL2Notifications(
      connection, changeNo, status, logData, l1Dept, requestBy, crTitle, crRequesterEmail, crRequesterDept, changeIn, processName, machineNo
    );

    await connection.commit();
    broadcast({ type: 'REFRESH_CHANGES' });
    broadcast({ type: 'REFRESH_NOTIFICATIONS' });

    // Send L2 emails asynchronously
    sendL2Emails(
      changeNo, status, logData, l1Dept, requestBy, crRequesterEmail, crRequesterDept, crTitle, changeIn, processName, machineNo, resolvedTargetUsers
    ).catch(err => console.error('Error sending L2 email notifications:', err));

    return logData;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const getL2Details = async (changeNo) => {
  const [rows] = await pool.query(
    `SELECT v.change_no as changeNo, v.validation_date as date, 
            COALESCE(NULLIF(u.name, ''), l1.request_by, v.requester) as requester, 
            v.weld_test as weldTest, v.qa_test as qaTest, v.status, v.remarks 
     FROM l2_validation_logs v
     LEFT JOIN l1_requests l1 ON v.change_no = l1.change_no
     LEFT JOIN change_requests c ON v.change_no = c.id
     LEFT JOIN users u ON c.requester = u.email
     WHERE v.change_no = ?`,
    [changeNo]
  );
  return rows.length > 0 ? rows[0] : null;
};

export const getL2Attachment = async (changeNo, fileName) => {
  const [rows] = await pool.query(
    `SELECT file_name as name, file_data as data, file_type as type 
     FROM l2_attachments 
     WHERE change_no = ? AND file_name = ?`,
    [changeNo, fileName]
  );
  return rows.length > 0 ? rows[0] : null;
};
