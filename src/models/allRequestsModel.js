import pool from '../config/db.js';
import { broadcast } from '../config/websocket.js';


export const addChange = async (title, requester, priority) => {
  const newId = `CHG-${Math.floor(1000 + Math.random() * 9000)}`;
  const status = 'Pending';

  await pool.query(
    'INSERT INTO change_requests (id, title, requester, date, priority, status) VALUES (?, ?, ?, CURDATE(), ?, ?)',
    [newId, title, requester, priority || 'Medium', status]
  );

  broadcast({ type: 'REFRESH_CHANGES' });

  return {
    id: newId,
    title,
    requester,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    priority: priority || 'Medium',
    status
  };
};

export const updateChangeStatus = async (id, status) => {
  await pool.query(
    'UPDATE change_requests SET status = ? WHERE id = ?',
    [status, id]
  );
  broadcast({ type: 'REFRESH_CHANGES' });
  return { id, status };
};

export const updateChangeDetails = async (changeNo, level, updateData, attachments) => {
  if (!updateData || Object.keys(updateData).length === 0) return;
  
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const tableName = level === 'l1' ? 'l1_requests' : level === 'l2' ? 'l2_validation_logs' : 'l3_approvals';
    
    // Exclude fields that are read-only or not in table schema
    const excludedKeys = ['id', 'change_no', 'changeNo', 'crDate', 'requested_time', 'crStatus', 'crRequester', 'hodStatus', 'hodRemarks', 'hodDept', 'raisedDept', 'l2Decision', 'l2Remarks'];
    const cleanedData = {};
    for (const [k, v] of Object.entries(updateData)) {
      if (!excludedKeys.includes(k)) {
        cleanedData[k] = v;
      }
    }

    if (level === 'l1') {
      // Update title/priority in change_requests
      if (updateData.title !== undefined) {
        await connection.query('UPDATE change_requests SET title = ? WHERE id = ?', [updateData.title, changeNo]);
      }
      if (updateData.priority !== undefined) {
        await connection.query('UPDATE change_requests SET priority = ? WHERE id = ?', [updateData.priority, changeNo]);
      }

      // Auto-populate processes/machines tables if updated values do not exist
      if (cleanedData.process_name !== undefined && cleanedData.process_name !== null) {
        const trimmedProcess = String(cleanedData.process_name).trim();
        if (trimmedProcess) {
          await connection.query('INSERT IGNORE INTO processes (name) VALUES (?)', [trimmedProcess]);
        }
      }
      if (cleanedData.machine_no !== undefined && cleanedData.machine_no !== null) {
        const trimmedMachine = String(cleanedData.machine_no).trim();
        if (trimmedMachine) {
          await connection.query('INSERT IGNORE INTO machines (name) VALUES (?)', [trimmedMachine]);
        }
      }
      
      // Keep only l1_requests table columns in cleanedData
      const l1Columns = [
        'unit', 'requested_time', 'change_in', 'dept', 'request_by',
        'process_name', 'process_line', 'machine_no', 'description',
        'improvement_area', 'change_type', 'date_start', 'trace_from',
        'date_close', 'trace_to', 'risk_analysis', 'sop_update',
        'hod_approval', 'customer_approval', 'effectiveness_monitoring',
        'file_desc', 'file_improvement', 'file_trace_from', 'file_trace_to',
        'file_risk', 'file_sop', 'file_effectiveness', 'improvement_table_data'
      ];
      for (const k of Object.keys(cleanedData)) {
        if (!l1Columns.includes(k)) {
          delete cleanedData[k];
        }
      }
    } else if (level === 'l2') {
      // Map L2 fields to database columns
      const l2Map = {
        date: 'validation_date',
        weldTest: 'weld_test',
        qaTest: 'qa_test',
        requester: 'requester',
        status: 'status',
        remarks: 'remarks'
      };
      const mappedData = {};
      for (const [k, v] of Object.entries(cleanedData)) {
        if (l2Map[k]) {
          mappedData[l2Map[k]] = v;
        }
      }
      // Replace cleanedData content with mapped L2 columns
      for (const k of Object.keys(cleanedData)) {
        delete cleanedData[k];
      }
      Object.assign(cleanedData, mappedData);

      // Keep change_requests status in sync with validation status
      if (cleanedData.status) {
        const crStatus = cleanedData.status === 'Accepted' ? 'Approved' : 'Evaluating';
        await connection.query('UPDATE change_requests SET status = ? WHERE id = ?', [crStatus, changeNo]);

        if (cleanedData.status === 'Accepted') {
          const [crRows] = await connection.query('SELECT requester, DATE_FORMAT(date, "%Y-%m-%d") as date FROM change_requests WHERE id = ?', [changeNo]);
          const requester = crRows.length > 0 ? crRows[0].requester : 'Admin';
          const date = crRows.length > 0 ? crRows[0].date : new Date().toISOString().slice(0, 10);
          
          await connection.query(
            `INSERT INTO l3_approvals (change_no, date, requester, ped, qad, production, maintenance, pcl, materials, marketing, hr, safety, unit_head)
             VALUES (?, ?, ?, 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending')
             ON DUPLICATE KEY UPDATE change_no = change_no`,
            [changeNo, date, requester]
          );
        }
      }
    } else if (level === 'l3') {
      // Map L3 fields to database columns
      const l3Map = {
        unitHead: 'unit_head'
      };
      const mappedData = {};
      for (const [k, v] of Object.entries(cleanedData)) {
        if (l3Map[k]) {
          mappedData[l3Map[k]] = v;
        } else {
          mappedData[k] = v;
        }
      }
      // Replace cleanedData content with mapped L3 columns
      for (const k of Object.keys(cleanedData)) {
        delete cleanedData[k];
      }
      Object.assign(cleanedData, mappedData);
    }

    const keys = Object.keys(cleanedData);
    const setString = keys.map(k => `${k} = ?`).join(', ');
    const values = Object.values(cleanedData);

    const [existing] = await connection.query(`SELECT 1 FROM ${tableName} WHERE change_no = ?`, [changeNo]);
    if (existing.length === 0) {
      let insertData = { change_no: changeNo };
      if (level === 'l1') {
        insertData.requested_time = updateData.requested_time || '00:00:00';
      } else if (level === 'l2') {
        insertData.validation_date = cleanedData.validation_date || new Date().toISOString().slice(0, 10);
        insertData.requester = cleanedData.requester || 'Admin';
        insertData.status = cleanedData.status || 'Pending';
        insertData.remarks = cleanedData.remarks || '';
      } else if (level === 'l3') {
        insertData.date = cleanedData.date || new Date().toISOString().slice(0, 10);
        insertData.requester = cleanedData.requester || 'Admin';
      }
      
      // Override default values with user edits
      for (const [k, v] of Object.entries(cleanedData)) {
        insertData[k] = v;
      }
      
      const insKeys = Object.keys(insertData);
      const insPlaceholders = insKeys.map(() => '?').join(', ');
      const insValues = Object.values(insertData);
      await connection.query(
        `INSERT INTO ${tableName} (${insKeys.join(', ')}) VALUES (${insPlaceholders})`,
        insValues
      );
    } else {
      if (keys.length > 0) {
        await connection.query(`UPDATE ${tableName} SET ${setString} WHERE change_no = ?`, [...values, changeNo]);
      }
    }

    // Sync attachments for any modified file fields
    const fileFields = level === 'l1' 
      ? ['file_desc', 'file_improvement', 'file_trace_from', 'file_trace_to', 'file_risk', 'file_sop', 'file_effectiveness']
      : (level === 'l2' ? ['weld_test', 'qa_test'] : []);
      
    const attachmentTable = level === 'l1' ? 'l1_attachments' : 'l2_attachments';
    
    for (const field of fileFields) {
      if (cleanedData[field] !== undefined) {
        const val = cleanedData[field] || '';
        const filesList = val.split(',').map(s => s.trim()).filter(Boolean);
        if (filesList.length === 0) {
          await connection.query(
            `DELETE FROM ${attachmentTable} WHERE change_no = ? AND field_name = ?`,
            [changeNo, field]
          );
        } else {
          await connection.query(
            `DELETE FROM ${attachmentTable} WHERE change_no = ? AND field_name = ? AND file_name NOT IN (${filesList.map(() => '?').join(', ')})`,
            [changeNo, field, ...filesList]
          );
        }
      }
    }

    // Save newly uploaded attachments
    if (attachments && attachments.length > 0) {
      for (const file of attachments) {
        let dbFieldName = file.fieldName;
        if (level === 'l2') {
          if (file.fieldName === 'weldTest') dbFieldName = 'weld_test';
          if (file.fieldName === 'qaTest') dbFieldName = 'qa_test';
        }
        await connection.query(
          `DELETE FROM ${attachmentTable} WHERE change_no = ? AND field_name = ? AND file_name = ?`,
          [changeNo, dbFieldName, file.name]
        );
        await connection.query(
          `INSERT INTO ${attachmentTable} (change_no, field_name, file_name, file_data, file_type) 
           VALUES (?, ?, ?, ?, ?)`,
          [changeNo, dbFieldName, file.name, file.data, file.type]
        );
      }
    }

    // Keep change_requests status in sync if level === 'l3'
    if (level === 'l3') {
      const [l3Row] = await connection.query(
        `SELECT ped, qad, production, maintenance, pcl, materials, marketing, hr, safety, unit_head as unitHead
         FROM l3_approvals WHERE change_no = ?`,
        [changeNo]
      );
      if (l3Row.length > 0) {
        const dbL3 = l3Row[0];
        const isAllL3Decided = 
          dbL3.ped && dbL3.ped !== 'Pending' &&
          dbL3.qad && dbL3.qad !== 'Pending' &&
          dbL3.production && dbL3.production !== 'Pending' &&
          dbL3.maintenance && dbL3.maintenance !== 'Pending' &&
          dbL3.pcl && dbL3.pcl !== 'Pending' &&
          dbL3.materials && dbL3.materials !== 'Pending' &&
          dbL3.marketing && dbL3.marketing !== 'Pending' &&
          dbL3.hr && dbL3.hr !== 'Pending' &&
          dbL3.safety && dbL3.safety !== 'Pending' &&
          dbL3.unitHead && dbL3.unitHead !== 'Pending';
          
        const crStatus = isAllL3Decided ? 'Completed' : 'Approved';
        await connection.query('UPDATE change_requests SET status = ? WHERE id = ?', [crStatus, changeNo]);

        const isAllL3Approved = 
          dbL3.ped === 'Approved' &&
          dbL3.qad === 'Approved' &&
          dbL3.production === 'Approved' &&
          dbL3.maintenance === 'Approved' &&
          dbL3.pcl === 'Approved' &&
          dbL3.materials === 'Approved' &&
          dbL3.marketing === 'Approved' &&
          dbL3.hr === 'Approved' &&
          dbL3.safety === 'Approved' &&
          dbL3.unitHead === 'Approved';

        if (isAllL3Approved) {
          const [existingEff] = await connection.query(
            `SELECT id FROM effectiveness_logs WHERE change_no = ?`,
            [changeNo]
          );
          if (existingEff.length === 0) {
            const [crRows] = await connection.query(
              `SELECT c.title, DATE_FORMAT(c.date, "%Y-%m-%d") as date, DATE_FORMAT(l1.date_start, "%Y-%m-%d") as dateStart
               FROM change_requests c
               LEFT JOIN l1_requests l1 ON c.id = l1.change_no
               WHERE c.id = ?`,
              [changeNo]
            );
            const title = crRows.length > 0 ? crRows[0].title : '';
            const date = crRows.length > 0 ? crRows[0].date : new Date().toISOString().slice(0, 10);
            const dateStart = crRows.length > 0 && crRows[0].dateStart ? crRows[0].dateStart : date;
            const effId = `EFF-${Date.now().toString().substring(7)}`;

            await connection.query(
              `INSERT INTO effectiveness_logs (id, change_no, req_date, context, start_date, month_wise, remarks, attachment, status, qa_approval)
               VALUES (?, ?, ?, ?, ?, '', '', '', 'Pending', 'Pending')`,
              [effId, changeNo, date, title, dateStart]
            );
          }
        } else {
          await connection.query(
            `DELETE FROM effectiveness_logs WHERE change_no = ?`,
            [changeNo]
          );
        }
      }
    }
    
    await connection.commit();
    broadcast({ type: 'REFRESH_CHANGES' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
