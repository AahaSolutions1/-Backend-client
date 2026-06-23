import pool from '../config/db.js';

export const getDashboardChanges = async () => {
  // Self-healing: auto-complete any change requests that have all L3 department approvals set,
  // and reset any that were completed too early back to Approved.
  try {
    // 1. Reset back to Approved if marked Completed too early
    await pool.query(`
      UPDATE change_requests cr
      INNER JOIN l3_approvals l3 ON cr.id = l3.change_no
      SET cr.status = 'Approved'
      WHERE cr.status = 'Completed'
        AND (
          l3.ped = 'Pending' OR
          l3.qad = 'Pending' OR
          l3.production = 'Pending' OR
          l3.maintenance = 'Pending' OR
          l3.pcl = 'Pending' OR
          l3.materials = 'Pending' OR
          l3.marketing = 'Pending' OR
          l3.hr = 'Pending' OR
          l3.safety = 'Pending' OR
          l3.unit_head = 'Pending'
        )
    `);

    // 2. Mark Completed if all departments have voted
    await pool.query(`
      UPDATE change_requests cr
      INNER JOIN l3_approvals l3 ON cr.id = l3.change_no
      SET cr.status = 'Completed'
      WHERE cr.status != 'Completed'
        AND l3.ped != 'Pending'
        AND l3.qad != 'Pending'
        AND l3.production != 'Pending'
        AND l3.maintenance != 'Pending'
        AND l3.pcl != 'Pending'
        AND l3.materials != 'Pending'
        AND l3.marketing != 'Pending'
        AND l3.hr != 'Pending'
        AND l3.safety != 'Pending'
        AND l3.unit_head != 'Pending'
    `);
  } catch (err) {
    console.error('Error self-healing L3 requests in getDashboardChanges:', err);
  }

  const [rows] = await pool.query(
    `SELECT c.id, c.title, 
            COALESCE(NULLIF(u.name, ''), l1.request_by, c.requester) as requester, 
            DATE_FORMAT(c.date, '%b %d, %Y') as date, c.priority, c.status,
            COALESCE(NULLIF(u.department, ''), l1.dept) as dept, l1.process_name as processName, l1.machine_no as machineNo, l1.change_in as changeIn,
            COALESCE(NULLIF(u.name, ''), l1.request_by) as requestBy,
            l1.improvement_area as improvementArea,
            l1.improvement_table_data as improvementTableData,
            c.requester as requesterEmail,
            v.status as l2Status,
            ha.status as hodStatus,
            COALESCE(
              CASE 
                WHEN LOWER(COALESCE(l1.dept, u.department)) = 'qad' THEN l3.qad
                WHEN LOWER(COALESCE(l1.dept, u.department)) = 'ped' THEN l3.ped
                WHEN LOWER(COALESCE(l1.dept, u.department)) = 'production' THEN l3.production
                WHEN LOWER(COALESCE(l1.dept, u.department)) = 'maintenance' THEN l3.maintenance
                WHEN LOWER(COALESCE(l1.dept, u.department)) IN ('pc & l', 'pcl') THEN l3.pcl
                WHEN LOWER(COALESCE(l1.dept, u.department)) = 'materials' THEN l3.materials
                WHEN LOWER(COALESCE(l1.dept, u.department)) = 'marketing' THEN l3.marketing
                WHEN LOWER(COALESCE(l1.dept, u.department)) = 'hr' THEN l3.hr
                WHEN LOWER(COALESCE(l1.dept, u.department)) = 'safety' THEN l3.safety
                WHEN LOWER(COALESCE(l1.dept, u.department)) IN ('unit head', 'unit_head') THEN l3.unit_head
              END, 
              'Pending'
            ) as l3Status,
            DATE_FORMAT(c.date, '%Y-%m-%d') as rawDate,
            DATE_FORMAT(l1.date_start, '%Y-%m-%d') as dateStart,
            DATE_FORMAT(l1.date_close, '%Y-%m-%d') as dateClose,
            CASE WHEN (
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
                    ) THEN 1 ELSE 0 END as isL3Approved,
            CASE WHEN (
                      l3.ped = 'Rejected' OR
                      l3.qad = 'Rejected' OR
                      l3.production = 'Rejected' OR
                      l3.maintenance = 'Rejected' OR
                      l3.pcl = 'Rejected' OR
                      l3.materials = 'Rejected' OR
                      l3.marketing = 'Rejected' OR
                      l3.hr = 'Rejected' OR
                      l3.safety = 'Rejected' OR
                      l3.unit_head = 'Rejected'
                    ) THEN 1 ELSE 0 END as hasL3Rejection,
            CASE WHEN l3.change_no IS NULL THEN 0
                 WHEN (
                      l3.ped = 'Pending' OR
                      l3.qad = 'Pending' OR
                      l3.production = 'Pending' OR
                      l3.maintenance = 'Pending' OR
                      l3.pcl = 'Pending' OR
                      l3.materials = 'Pending' OR
                      l3.marketing = 'Pending' OR
                      l3.hr = 'Pending' OR
                      l3.safety = 'Pending' OR
                      l3.unit_head = 'Pending'
                    ) THEN 0 ELSE 1 END as isL3Complete,
            e.qa_approval as qaApproval
     FROM change_requests c
     LEFT JOIN l1_requests l1 ON c.id = l1.change_no
     LEFT JOIN users u ON c.requester = u.email
     LEFT JOIN l2_validation_logs v ON c.id = v.change_no
     LEFT JOIN l3_approvals l3 ON c.id = l3.change_no
     LEFT JOIN effectiveness_logs e ON c.id = e.change_no
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
     ORDER BY c.created_at DESC, CAST(SUBSTRING_INDEX(c.id, '-', -1) AS UNSIGNED) DESC`
  );
  return rows;
};

export const getDashboardCounts = async () => {
  const [rows] = await pool.query(
    `SELECT c.status,
            v.status as l2Status,
            ha.status as hodStatus,
            CASE WHEN (
                      l3.ped = 'Rejected' OR
                      l3.qad = 'Rejected' OR
                      l3.production = 'Rejected' OR
                      l3.maintenance = 'Rejected' OR
                      l3.pcl = 'Rejected' OR
                      l3.materials = 'Rejected' OR
                      l3.marketing = 'Rejected' OR
                      l3.hr = 'Rejected' OR
                      l3.safety = 'Rejected' OR
                      l3.unit_head = 'Rejected'
                    ) THEN 1 ELSE 0 END as hasL3Rejection,
            CASE WHEN l3.change_no IS NULL THEN 0
                 WHEN (
                      l3.ped = 'Pending' OR
                      l3.qad = 'Pending' OR
                      l3.production = 'Pending' OR
                      l3.maintenance = 'Pending' OR
                      l3.pcl = 'Pending' OR
                      l3.materials = 'Pending' OR
                      l3.marketing = 'Pending' OR
                      l3.hr = 'Pending' OR
                      l3.safety = 'Pending' OR
                      l3.unit_head = 'Pending'
                    ) THEN 0 ELSE 1 END as isL3Complete,
            e.qa_approval as qaApproval
     FROM change_requests c
     LEFT JOIN l1_requests l1 ON c.id = l1.change_no
     LEFT JOIN users u ON c.requester = u.email
     LEFT JOIN l2_validation_logs v ON c.id = v.change_no
     LEFT JOIN l3_approvals l3 ON c.id = l3.change_no
     LEFT JOIN effectiveness_logs e ON c.id = e.change_no
     LEFT JOIN (
        SELECT change_no,
               COALESCE(
                 MIN(CASE WHEN status = 'Rejected' THEN 'Rejected' END),
                 MAX(CASE WHEN status = 'Approved' THEN 'Approved' END),
                 'Pending'
               ) as status
        FROM hod_approvals
        GROUP BY change_no
       ) ha ON c.id = ha.change_no`
  );

  let approved = 0;
  let closed = 0;
  let rejected = 0;
  let pending = 0;

  for (const row of rows) {
    const hodStatus = row.hodStatus;
    const l2Status = row.l2Status;
    const qaApproval = row.qaApproval;
    const isL3Complete = row.isL3Complete;
    const hasL3Rejection = row.hasL3Rejection;
    const status = row.status;

    let dispStatus = 'Pending L1 HOD';

    if (hodStatus === 'Rejected' || l2Status === 'Rejected') {
      dispStatus = 'Rejected';
    } else if (qaApproval === 'Approved') {
      dispStatus = 'Closed';
    } else if (qaApproval === 'Rejected') {
      dispStatus = 'Rejected';
    } else if (isL3Complete === 1 || isL3Complete === true) {
      if (hasL3Rejection === 1 || hasL3Rejection === true) {
        dispStatus = 'Rejected';
      } else {
        dispStatus = 'L3 Approved';
      }
    } else if (status === 'Completed') {
      dispStatus = 'Closed';
    } else if (status === 'Approved' || (hodStatus === 'Approved' && l2Status === 'Accepted')) {
      dispStatus = 'Pending L3';
    } else if (hodStatus === 'Approved') {
      dispStatus = 'Pending L2';
    } else {
      dispStatus = 'Pending L1 HOD';
    }

    if (dispStatus === 'L3 Approved') {
      approved++;
    } else if (dispStatus === 'Closed') {
      closed++;
    } else if (dispStatus === 'Rejected') {
      rejected++;
    } else if (dispStatus.startsWith('Pending')) {
      pending++;
    }
  }

  return {
    total: rows.length,
    approved,
    closed,
    rejected,
    pending
  };
};
