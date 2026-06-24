import pool from '../config/db.js';
import { broadcast } from '../config/websocket.js';
import { triggerEffectivenessQADAlert } from './effectivenessNotificationModel.js';

// Self-healing: Ensure effectiveness tables exist on load
const ensureTablesExist = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS effectiveness_logs (
        id VARCHAR(50) PRIMARY KEY,
        change_no VARCHAR(50) NOT NULL,
        req_date DATE NOT NULL,
        context VARCHAR(255) NOT NULL DEFAULT '',
        start_date DATE NOT NULL,
        month_wise VARCHAR(20) NOT NULL DEFAULT '',
        remarks TEXT,
        attachment VARCHAR(255) NOT NULL DEFAULT '',
        status VARCHAR(50) NOT NULL DEFAULT '',
        qa_approval VARCHAR(50) NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (change_no) REFERENCES change_requests(id) ON UPDATE CASCADE ON DELETE CASCADE
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS effectiveness_attachments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        log_id VARCHAR(50) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_data LONGTEXT NOT NULL,
        file_type VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (log_id) REFERENCES effectiveness_logs(id) ON UPDATE CASCADE ON DELETE CASCADE
      )
    `);

    // Ensure qa_update_count column exists in effectiveness_logs
    try {
      const [columns] = await pool.query("SHOW COLUMNS FROM effectiveness_logs LIKE 'qa_update_count'");
      if (columns.length === 0) {
        await pool.query("ALTER TABLE effectiveness_logs ADD COLUMN qa_update_count INT NOT NULL DEFAULT 0");
        console.log('✅ Added column qa_update_count to effectiveness_logs table.');
      }
    } catch (err) {
      console.error('⚠️ Error adding qa_update_count column to effectiveness_logs:', err.message);
    }
  } catch (err) {
    console.error('Error ensuring and seeding effectiveness tables:', err);
  }
};

// Execute immediately when model is loaded
ensureTablesExist();


const parseToISODate = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getLogs = async (tab) => {
  let whereClause = '';
  if (tab === 'closed') {
    whereClause = "AND e.qa_approval = 'Approved'";
  } else if (tab === 'rejected') {
    whereClause = "AND e.qa_approval = 'Rejected'";
  } else if (tab === 'ongoing') {
    whereClause = "AND (e.qa_approval IS NULL OR (e.qa_approval != 'Approved' AND e.qa_approval != 'Rejected'))";
  }

  const [rows] = await pool.query(
    `SELECT COALESCE(e.id, CONCAT('EFF-PENDING-', c.id)) as id,
            c.id as changeNo,
            DATE_FORMAT(COALESCE(c.date, e.req_date), '%Y-%m-%d') as reqDate,
            COALESCE(c.title, e.context) as context,
            DATE_FORMAT(COALESCE(l1.date_start, e.start_date, c.date), '%Y-%m-%d') as startDate,
            COALESCE(e.month_wise, '') as monthWise,
            COALESCE(e.remarks, '') as remarks,
            COALESCE(e.attachment, '') as attachment,
            COALESCE(e.status, 'Pending') as status,
            COALESCE(e.qa_approval, 'Pending') as qaApproval,
            COALESCE(e.qa_update_count, 0) as qaUpdateCount,
            CASE WHEN e.id IS NULL THEN 1 ELSE 0 END as isPending
     FROM change_requests c
     LEFT JOIN l1_requests l1 ON c.id = l1.change_no
     LEFT JOIN l3_approvals l3 ON c.id = l3.change_no
     LEFT JOIN effectiveness_logs e ON c.id = e.change_no
     WHERE (e.id IS NOT NULL 
        OR (
           l3.ped = 'Approved' AND
           l3.qad = 'Approved' AND
           l3.production = 'Approved' AND
           l3.maintenance = 'Approved' AND
           l3.pcl = 'Approved' AND
           l3.materials = 'Approved' AND
           l3.marketing = 'Approved' AND
           l3.hr = 'Approved' AND
           l3.safety = 'Approved' AND
           l3.unit_head = 'Approved'
        )) ${whereClause}
     ORDER BY COALESCE(e.created_at, c.created_at) DESC, CAST(SUBSTRING_INDEX(c.id, '-', -1) AS UNSIGNED) DESC`
  );
  return rows;
};

export const getCounts = async () => {
  const [rows] = await pool.query(
    `SELECT 
       COALESCE(SUM(CASE WHEN e.qa_approval = 'Approved' THEN 1 ELSE 0 END), 0) as closed,
       COALESCE(SUM(CASE WHEN e.qa_approval = 'Rejected' THEN 1 ELSE 0 END), 0) as rejected,
       COALESCE(SUM(CASE WHEN e.qa_approval IS NULL OR (e.qa_approval != 'Approved' AND e.qa_approval != 'Rejected') THEN 1 ELSE 0 END), 0) as ongoing
     FROM change_requests c
     LEFT JOIN l3_approvals l3 ON c.id = l3.change_no
     LEFT JOIN effectiveness_logs e ON c.id = e.change_no
     WHERE e.id IS NOT NULL 
        OR (
           l3.ped = 'Approved' AND
           l3.qad = 'Approved' AND
           l3.production = 'Approved' AND
           l3.maintenance = 'Approved' AND
           l3.pcl = 'Approved' AND
           l3.materials = 'Approved' AND
           l3.marketing = 'Approved' AND
           l3.hr = 'Approved' AND
           l3.safety = 'Approved' AND
           l3.unit_head = 'Approved'
        )`
  );
  if (rows.length > 0) {
    const r = rows[0];
    return {
      closed: Number(r.closed),
      rejected: Number(r.rejected),
      ongoing: Number(r.ongoing)
    };
  }
  return { ongoing: 0, closed: 0, rejected: 0 };
};

export const createLog = async (logData, attachments) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { id, changeNo, reqDate, context, startDate, monthWise, remarks, attachment, status, qaApproval } = logData;
    
    const [existing] = await connection.query(
      `SELECT id FROM effectiveness_logs WHERE change_no = ?`,
      [changeNo]
    );
    if (existing.length > 0) {
      throw new Error(`An effectiveness log already exists for change request ${changeNo}`);
    }

    const formattedReqDate = parseToISODate(reqDate) || reqDate;
    const formattedStartDate = parseToISODate(startDate) || startDate;
    
    await connection.query(
      `INSERT INTO effectiveness_logs (id, change_no, req_date, context, start_date, month_wise, remarks, attachment, status, qa_approval) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, changeNo, formattedReqDate, context, formattedStartDate, monthWise, remarks, attachment || '', status, qaApproval]
    );
    
    if (attachments && attachments.length > 0) {
      for (const file of attachments) {
        await connection.query(
          `INSERT INTO effectiveness_attachments (log_id, file_name, file_data, file_type) 
           VALUES (?, ?, ?, ?)`,
          [id, file.name, file.data, file.type]
        );
      }
    }
    
    await connection.commit();
    broadcast({ type: 'REFRESH_EFFECTIVENESS' });
    broadcast({ type: 'REFRESH_CHANGES' });

    if (qaApproval === 'Approved' || qaApproval === 'Rejected') {
      triggerEffectivenessQADAlert(changeNo, qaApproval, remarks).catch(err =>
        console.error('Error triggering effectiveness QAD alert in createLog:', err)
      );
    }

    return logData;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const updateLog = async (id, logData, attachments, isQaUser = false) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { monthWise, remarks, attachment, status, qaApproval } = logData;
    
    // 1. Update the log details
    if (isQaUser) {
      await connection.query(
        `UPDATE effectiveness_logs 
         SET month_wise = ?, remarks = ?, attachment = ?, status = ?, qa_approval = ?, qa_update_count = qa_update_count + 1 
         WHERE id = ?`,
        [monthWise, remarks, attachment || '', status, qaApproval, id]
      );
    } else {
      await connection.query(
        `UPDATE effectiveness_logs 
         SET month_wise = ?, remarks = ?, attachment = ?, status = ?, qa_approval = ? 
         WHERE id = ?`,
        [monthWise, remarks, attachment || '', status, qaApproval, id]
      );
    }
    
    // 2. Delete any attachments that are no longer in the updated attachment list
    const currentAttachments = attachment ? attachment.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (currentAttachments.length > 0) {
      await connection.query(
        `DELETE FROM effectiveness_attachments 
         WHERE log_id = ? AND file_name NOT IN (?)`,
        [id, currentAttachments]
      );
    } else {
      await connection.query(
        `DELETE FROM effectiveness_attachments WHERE log_id = ?`,
        [id]
      );
    }
    
    // 3. Insert new attachments
    if (attachments && attachments.length > 0) {
      for (const file of attachments) {
        await connection.query(
          `INSERT INTO effectiveness_attachments (log_id, file_name, file_data, file_type) 
           VALUES (?, ?, ?, ?) 
           ON DUPLICATE KEY UPDATE file_data = ?, file_type = ?`,
          [id, file.name, file.data, file.type, file.data, file.type]
        );
      }
    }
    
    // Fetch the change_no to send alerts
    const [logRows] = await connection.query(
      'SELECT change_no FROM effectiveness_logs WHERE id = ?',
      [id]
    );
    const changeNo = logRows.length > 0 ? logRows[0].change_no : null;

    await connection.commit();
    broadcast({ type: 'REFRESH_EFFECTIVENESS' });
    broadcast({ type: 'REFRESH_CHANGES' });

    if ((qaApproval === 'Approved' || qaApproval === 'Rejected') && changeNo) {
      triggerEffectivenessQADAlert(changeNo, qaApproval, remarks).catch(err =>
        console.error('Error triggering effectiveness QAD alert in updateLog:', err)
      );
    }
    
    const [rows] = await connection.query(
      `SELECT e.id, e.change_no as changeNo, 
              DATE_FORMAT(COALESCE(c.date, e.req_date), '%Y-%m-%d') as reqDate, 
              COALESCE(c.title, e.context) as context, 
              DATE_FORMAT(COALESCE(l1.date_start, e.start_date, c.date), '%Y-%m-%d') as startDate, 
              e.month_wise as monthWise, e.remarks, e.attachment, e.status, e.qa_approval as qaApproval,
              e.qa_update_count as qaUpdateCount
       FROM effectiveness_logs e
       LEFT JOIN change_requests c ON e.change_no = c.id
       LEFT JOIN l1_requests l1 ON e.change_no = l1.change_no
       WHERE e.id = ?`,
      [id]
    );
    return rows.length > 0 ? rows[0] : { id, ...logData, qaUpdateCount: isQaUser ? 1 : 0 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const deleteLog = async (id) => {
  await pool.query('DELETE FROM effectiveness_logs WHERE id = ?', [id]);
  broadcast({ type: 'REFRESH_EFFECTIVENESS' });
  broadcast({ type: 'REFRESH_CHANGES' });
  return { id };
};

export const getAttachment = async (logId, fileName) => {
  const [rows] = await pool.query(
    `SELECT file_name as name, file_data as data, file_type as type 
     FROM effectiveness_attachments 
     WHERE log_id = ? AND file_name = ?`,
    [logId, fileName]
  );
  return rows.length > 0 ? rows[0] : null;
};
