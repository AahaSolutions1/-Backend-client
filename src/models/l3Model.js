import pool from '../config/db.js';
import { broadcast } from '../config/websocket.js';
import { 
  createL3DecisionNotifications, 
  sendL3DecisionEmails, 
  createL3CompletionNotifications, 
  sendL3CompletionEmails,
  createL3RejectionNotifications,
  sendL3RejectionEmails
} from './l3NotificationModel.js';

export const getL3Approvals = async () => {
  const [rows] = await pool.query(
    `SELECT c.id as changeNo, 
            c.status as status,
            DATE_FORMAT(c.date, '%e %b') as date, 
            COALESCE(NULLIF(u.name, ''), l1.request_by, c.requester) as requester,
            COALESCE(NULLIF(u.department, ''), l1.dept) as raisedDept,
            v.status as l2Decision,
            v.remarks as l2Remarks,
            COALESCE(l.ped, 'Pending') as ped,
            COALESCE(l.qad, 'Pending') as qad,
            COALESCE(l.production, 'Pending') as production,
            COALESCE(l.maintenance, 'Pending') as maintenance,
            COALESCE(l.pcl, 'Pending') as pcl,
            COALESCE(l.materials, 'Pending') as materials,
            COALESCE(l.marketing, 'Pending') as marketing,
            COALESCE(l.hr, 'Pending') as hr,
            COALESCE(l.safety, 'Pending') as safety,
            COALESCE(l.unit_head, 'Pending') as unitHead,
            e.qa_approval as qaApproval
     FROM change_requests c
     LEFT JOIN l1_requests l1 ON c.id = l1.change_no
     LEFT JOIN users u ON c.requester = u.email
     INNER JOIN l2_validation_logs v ON c.id = v.change_no AND v.status = 'Accepted'
     LEFT JOIN l3_approvals l ON c.id = l.change_no
     LEFT JOIN effectiveness_logs e ON c.id = e.change_no
     WHERE e.id IS NULL
     ORDER BY c.created_at DESC, CAST(SUBSTRING_INDEX(c.id, '-', -1) AS UNSIGNED) DESC`
  );
  return rows;
};

export const getL3DetailsByChangeNo = async (changeNo) => {
  const [rows] = await pool.query(
    `SELECT change_no as changeNo, ped, qad, production, maintenance, pcl, materials, marketing, hr, safety, unit_head as unitHead, date, requester
     FROM l3_approvals
     WHERE change_no = ?`,
    [changeNo]
  );
  return rows[0] || null;
};

export const addL3ApprovalLog = async (logData) => {
  const {
    changeNo, date, requester,
    ped, qad, production, maintenance, pcl, materials, marketing, hr, safety, unitHead
  } = logData;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

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
         VALUES (?, ?, ?, CURDATE(), 'Medium', 'Pending')`,
        [changeNo, `[L3 Auto] Approval for ${changeNo}`, adminEmail]
      );
    }

    // Fetch existing L3 approval before update to detect HOD decision changes
    const [existingL3Rows] = await connection.query(
      `SELECT ped, qad, production, maintenance, pcl, materials, marketing, hr, safety, unit_head as unitHead
       FROM l3_approvals WHERE change_no = ?`,
      [changeNo]
    );

    let wasAlreadyAllL3Decided = false;
    if (existingL3Rows.length > 0) {
      const dbL3 = existingL3Rows[0];
      wasAlreadyAllL3Decided = 
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
    }



    let finalPed = ped;
    let finalQad = qad;
    let finalProduction = production;
    let finalMaintenance = maintenance;
    let finalPcl = pcl;
    let finalMaterials = materials;
    let finalMarketing = marketing;
    let finalHr = hr;
    let finalSafety = safety;
    let finalUnitHead = unitHead;

    if (existingL3Rows.length > 0) {
      const dbL3 = existingL3Rows[0];
      if ((ped === 'Pending' || !ped) && dbL3.ped && dbL3.ped !== 'Pending') finalPed = dbL3.ped;
      if ((qad === 'Pending' || !qad) && dbL3.qad && dbL3.qad !== 'Pending') finalQad = dbL3.qad;
      if ((production === 'Pending' || !production) && dbL3.production && dbL3.production !== 'Pending') finalProduction = dbL3.production;
      if ((maintenance === 'Pending' || !maintenance) && dbL3.maintenance && dbL3.maintenance !== 'Pending') finalMaintenance = dbL3.maintenance;
      if ((pcl === 'Pending' || !pcl) && dbL3.pcl && dbL3.pcl !== 'Pending') finalPcl = dbL3.pcl;
      if ((materials === 'Pending' || !materials) && dbL3.materials && dbL3.materials !== 'Pending') finalMaterials = dbL3.materials;
      if ((marketing === 'Pending' || !marketing) && dbL3.marketing && dbL3.marketing !== 'Pending') finalMarketing = dbL3.marketing;
      if ((hr === 'Pending' || !hr) && dbL3.hr && dbL3.hr !== 'Pending') finalHr = dbL3.hr;
      if ((safety === 'Pending' || !safety) && dbL3.safety && dbL3.safety !== 'Pending') finalSafety = dbL3.safety;
      if ((unitHead === 'Pending' || !unitHead) && dbL3.unitHead && dbL3.unitHead !== 'Pending') finalUnitHead = dbL3.unitHead;
    }

    await connection.query(
      `INSERT INTO l3_approvals (
        change_no, date, requester, ped, qad, production, 
        maintenance, pcl, materials, marketing, hr, safety, unit_head
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        date = VALUES(date),
        requester = VALUES(requester),
        ped = VALUES(ped),
        qad = VALUES(qad),
        production = VALUES(production),
        maintenance = VALUES(maintenance),
        pcl = VALUES(pcl),
        materials = VALUES(materials),
        marketing = VALUES(marketing),
        hr = VALUES(hr),
        safety = VALUES(safety),
        unit_head = VALUES(unit_head)`,
      [
        changeNo, date, requester,
        finalPed || 'Pending', finalQad || 'Pending', finalProduction || 'Pending',
        finalMaintenance || 'Pending', finalPcl || 'Pending', finalMaterials || 'Pending',
        finalMarketing || 'Pending', finalHr || 'Pending', finalSafety || 'Pending', finalUnitHead || 'Pending'
      ]
    );

    // Fetch raisedDept, requesterEmail, title, date, date_start
    const [crRows] = await connection.query(
      `SELECT COALESCE(l1.dept, u.department) as raisedDept, c.requester as requesterEmail, c.title, 
              DATE_FORMAT(c.date, '%Y-%m-%d') as date, DATE_FORMAT(l1.date_start, '%Y-%m-%d') as dateStart
       FROM change_requests c
       LEFT JOIN l1_requests l1 ON c.id = l1.change_no
       LEFT JOIN users u ON c.requester = u.email
       WHERE c.id = ?`,
      [changeNo]
    );
    const raisedDept = crRows.length > 0 ? crRows[0].raisedDept : '';
    const requesterEmail = crRows.length > 0 ? crRows[0].requesterEmail : '';
    const title = crRows.length > 0 ? crRows[0].title : '';
    const dbDate = crRows.length > 0 ? crRows[0].date : new Date().toISOString().slice(0, 10);
    const dateStart = crRows.length > 0 && crRows[0].dateStart ? crRows[0].dateStart : dbDate;



    const isAllL3Decided = 
      finalPed !== 'Pending' &&
      finalQad !== 'Pending' &&
      finalProduction !== 'Pending' &&
      finalMaintenance !== 'Pending' &&
      finalPcl !== 'Pending' &&
      finalMaterials !== 'Pending' &&
      finalMarketing !== 'Pending' &&
      finalHr !== 'Pending' &&
      finalSafety !== 'Pending' &&
      finalUnitHead !== 'Pending';

    // Calculate if any of the decisions is 'Rejected'
    const rejectedDepts = [];
    const labelMap = {
      ped: 'PED',
      qad: 'QAD',
      production: 'Production',
      maintenance: 'Maintenance',
      pcl: 'PC & L',
      materials: 'Materials',
      marketing: 'Marketing',
      hr: 'HR',
      safety: 'Safety',
      unitHead: 'Unit Head'
    };
    if (finalPed === 'Rejected') rejectedDepts.push(labelMap.ped);
    if (finalQad === 'Rejected') rejectedDepts.push(labelMap.qad);
    if (finalProduction === 'Rejected') rejectedDepts.push(labelMap.production);
    if (finalMaintenance === 'Rejected') rejectedDepts.push(labelMap.maintenance);
    if (finalPcl === 'Rejected') rejectedDepts.push(labelMap.pcl);
    if (finalMaterials === 'Rejected') rejectedDepts.push(labelMap.materials);
    if (finalMarketing === 'Rejected') rejectedDepts.push(labelMap.marketing);
    if (finalHr === 'Rejected') rejectedDepts.push(labelMap.hr);
    if (finalSafety === 'Rejected') rejectedDepts.push(labelMap.safety);
    if (finalUnitHead === 'Rejected') rejectedDepts.push(labelMap.unitHead);

    const hasRejection = rejectedDepts.length > 0;

    const isAllL3Approved = 
      finalPed === 'Approved' &&
      finalQad === 'Approved' &&
      finalProduction === 'Approved' &&
      finalMaintenance === 'Approved' &&
      finalPcl === 'Approved' &&
      finalMaterials === 'Approved' &&
      finalMarketing === 'Approved' &&
      finalHr === 'Approved' &&
      finalSafety === 'Approved' &&
      finalUnitHead === 'Approved';

    if (isAllL3Decided) {
      await connection.query(
        `UPDATE change_requests SET status = 'Completed' WHERE id = ?`,
        [changeNo]
      );

      if (isAllL3Approved) {
        const [existingEff] = await connection.query(
          `SELECT id FROM effectiveness_logs WHERE change_no = ?`,
          [changeNo]
        );
        if (existingEff.length === 0) {
          const effId = `EFF-${Date.now().toString().substring(7)}`;
          await connection.query(
            `INSERT INTO effectiveness_logs (id, change_no, req_date, context, start_date, month_wise, remarks, attachment, status, qa_approval)
             VALUES (?, ?, ?, ?, ?, '', '', '', 'Pending', 'Pending')`,
            [effId, changeNo, dbDate, title, dateStart]
          );
        }
      } else {
        await connection.query(
          `DELETE FROM effectiveness_logs WHERE change_no = ?`,
          [changeNo]
        );
      }

      if (!wasAlreadyAllL3Decided) {
        const [l1Rows] = await connection.query(
          `SELECT dept, change_in, request_by FROM l1_requests WHERE change_no = ?`,
          [changeNo]
        );
        const l1Dept = l1Rows.length > 0 ? l1Rows[0].dept : '';
        const changeIn = l1Rows.length > 0 ? l1Rows[0].change_in : '';
        const requestBy = l1Rows.length > 0 ? l1Rows[0].request_by : requester;

        if (hasRejection) {
          await createL3RejectionNotifications(
            connection, changeNo, changeIn, requestBy, requesterEmail, l1Dept, rejectedDepts
          );
        } else {
          await createL3CompletionNotifications(
            connection, changeNo, changeIn, requestBy, requesterEmail, l1Dept
          );
        }
      }
    } else {
      const [crRow] = await connection.query(
        `SELECT status FROM change_requests WHERE id = ?`,
        [changeNo]
      );
      if (crRow.length > 0 && crRow[0].status === 'Completed') {
        await connection.query(
          `UPDATE change_requests SET status = 'Approved' WHERE id = ?`,
          [changeNo]
        );
      }
    }

    await connection.commit();
    broadcast({ type: 'REFRESH_CHANGES' });
    broadcast({ type: 'REFRESH_NOTIFICATIONS' });

    if (isAllL3Decided && !wasAlreadyAllL3Decided) {
      if (hasRejection) {
        sendL3RejectionEmails(changeNo, requesterEmail, rejectedDepts).catch(err =>
          console.error('Error sending L3 rejection emails:', err)
        );
      } else {
        sendL3CompletionEmails(changeNo, requesterEmail).catch(err =>
          console.error('Error sending L3 completion emails:', err)
        );
      }
    }

    return logData;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
