import pool from '../config/db.js';
import { broadcast } from '../config/websocket.js';

export const getNotifications = async (email, role) => {
  let query = `
    SELECT id, title, details, change_no as changeNo, category, dept, time_str as time, is_read as isRead, type, color, recipient_email as recipientEmail 
    FROM notifications
  `;
  const params = [];

  const roleLower = (role || '').toLowerCase();
  const isAdmin = roleLower.includes('admin') || roleLower.includes('administrator');
  const isHOD = roleLower.includes('hod') || roleLower.includes('manager');

  const [userRows] = await pool.query('SELECT department FROM users WHERE email = ?', [email]);
  const department = userRows.length > 0 ? userRows[0].department : '';

  let userConditions = [];
  if (!isAdmin) {
    if (department) {
      userConditions.push(`(LOWER(dept) = LOWER(?) OR dept = '' OR dept IS NULL)`);
      params.push(department);
    } else {
      userConditions.push(`(dept = '' OR dept IS NULL)`);
    }

    if (!isHOD) {
      userConditions.push(`(id NOT LIKE 'L1-HOD-NOTIF-%' AND title NOT LIKE '%HOD Approval%' AND title NOT LIKE '%L3 Final Review%')`);
    }
  } else {
    // Admin only receives general notifications (where dept is 'General', empty, or null)
    userConditions.push(`(LOWER(dept) = 'general' OR dept = '' OR dept IS NULL)`);
  }

  let mainCondition = `(LOWER(recipient_email) = LOWER(?) OR ((recipient_email IS NULL OR recipient_email = '')`;
  params.unshift(email); // Put email as first parameter

  if (userConditions.length > 0) {
    mainCondition += ` AND ` + userConditions.join(' AND ');
  }
  mainCondition += `))`;

  query += ` WHERE ` + mainCondition;
  query += ` ORDER BY created_at DESC, id DESC `;

  const [rows] = await pool.query(query, params);
  return rows.map(r => ({ ...r, isRead: !!r.isRead }));
};

export const toggleReadStatus = async (id) => {
  // Toggle the is_read state
  await pool.query(
    `UPDATE notifications SET is_read = NOT is_read WHERE id = ?`,
    [id]
  );
  const [rows] = await pool.query(
    `SELECT id, title, details, change_no as changeNo, category, dept, time_str as time, is_read as isRead, type, color 
     FROM notifications 
     WHERE id = ?`,
    [id]
  );
  broadcast({ type: 'REFRESH_NOTIFICATIONS' });
  return rows.length > 0 ? { ...rows[0], isRead: !!rows[0].isRead } : null;
};

export const markAllRead = async (email, role) => {
  const roleLower = (role || '').toLowerCase();
  const isAdmin = roleLower.includes('admin') || roleLower.includes('administrator');
  const isHOD = roleLower.includes('hod') || roleLower.includes('manager');

  const [userRows] = await pool.query('SELECT department FROM users WHERE email = ?', [email]);
  const department = userRows.length > 0 ? userRows[0].department : '';

  let userConditions = [];
  const params = [];
  if (!isAdmin) {
    if (department) {
      userConditions.push(`(LOWER(dept) = LOWER(?) OR dept = '' OR dept IS NULL)`);
      params.push(department);
    } else {
      userConditions.push(`(dept = '' OR dept IS NULL)`);
    }

    if (!isHOD) {
      userConditions.push(`(id NOT LIKE 'L1-HOD-NOTIF-%' AND title NOT LIKE '%HOD Approval%' AND title NOT LIKE '%L3 Final Review%')`);
    }
  } else {
    // Admin only marks general notifications as read
    userConditions.push(`(LOWER(dept) = 'general' OR dept = '' OR dept IS NULL)`);
  }

  let mainCondition = `(LOWER(recipient_email) = LOWER(?) OR ((recipient_email IS NULL OR recipient_email = '')`;
  params.unshift(email); // Put email as first parameter

  if (userConditions.length > 0) {
    mainCondition += ` AND ` + userConditions.join(' AND ');
  }
  mainCondition += `))`;

  let query = `UPDATE notifications SET is_read = TRUE WHERE ` + mainCondition;

  await pool.query(query, params);
  broadcast({ type: 'REFRESH_NOTIFICATIONS' });
  return { success: true };
};

