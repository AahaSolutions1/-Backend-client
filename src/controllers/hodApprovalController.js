import {
  getHodApprovals,
  getHodApprovalsByDept,
  saveHodApproval,
  ensureHodApprovalsTable
} from '../models/hodApprovalModel.js';
import pool from '../config/db.js';
import { validateLimits } from '../utils/validation.js';

// Ensure table exists when module first loads
ensureHodApprovalsTable().catch(err =>
  console.error('HOD approvals table check failed:', err)
);

/**
 * GET /hod-approvals
 * Returns all HOD approval requests (admin view — all departments).
 */
export const getAllHodApprovals = async (req, res) => {
  try {
    const rows = await getHodApprovals();
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error in getAllHodApprovals:', error);
    res.status(500).json({ error: 'Failed to fetch HOD approval requests.' });
  }
};

/**
 * GET /hod-approvals/dept/:dept
 * Returns HOD approval requests filtered by department.
 * Used by the HOD "All Approvals" page.
 */
export const getHodApprovalsByDeptHandler = async (req, res) => {
  const { dept } = req.params;
  try {
    const rows = await getHodApprovalsByDept(dept);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error in getHodApprovalsByDeptHandler:', error);
    res.status(500).json({ error: 'Failed to fetch HOD approvals for department.' });
  }
};

/**
 * POST /hod-approvals
 * Save an HOD approval decision (Approved / Rejected).
 * Body: { changeNo, hodDept, status, remarks }
 */
export const submitHodApproval = async (req, res) => {
  const lengthError = validateLimits(req.body);
  if (lengthError) {
    return res.status(400).json({ error: lengthError });
  }

  const userEmail = req.user?.email;
  const { changeNo, hodDept, status, remarks } = req.body;

  if (!changeNo || !hodDept || !status) {
    return res.status(400).json({ error: 'changeNo, hodDept, and status are required.' });
  }

  if (!['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be "Approved" or "Rejected".' });
  }

  try {
    // Check if the change request is Closed
    const [closedRows] = await pool.query(
      `SELECT qa_approval FROM effectiveness_logs WHERE change_no = ?`,
      [changeNo]
    );
    if (closedRows.length > 0 && closedRows[0].qa_approval === 'Approved') {
      return res.status(403).json({ error: 'Access Denied: The change request is Closed and cannot be modified.' });
    }

    // Verify the user is an HOD/Admin
    const [userRows] = await pool.query(
      'SELECT role, department FROM users WHERE email = ?',
      [userEmail]
    );

    if (userRows.length === 0) {
      return res.status(403).json({ error: 'User not found.' });
    }

    const { role } = userRows[0];
    const isAdmin = role.toLowerCase() === 'admin' || role.toLowerCase() === 'administrator';
    const isHOD = role.toLowerCase().includes('hod') ||
      role.toLowerCase().includes('manager') ||
      role.toLowerCase().includes('unit head');

    if (!isAdmin && !isHOD) {
      return res.status(403).json({ error: 'Access Denied: Only HODs or Admins can submit approvals.' });
    }

    const result = await saveHodApproval({
      changeNo,
      hodEmail: userEmail,
      hodDept,
      status,
      remarks: remarks || ''
    });

    res.status(200).json({ message: `HOD approval saved successfully.`, data: result });
  } catch (error) {
    console.error('Error in submitHodApproval:', error);
    res.status(500).json({ error: 'Failed to save HOD approval decision.' });
  }
};
