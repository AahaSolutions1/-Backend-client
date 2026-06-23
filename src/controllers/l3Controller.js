import * as l3Model from '../models/l3Model.js';
import pool from '../config/db.js';
import { validateLimits } from '../utils/validation.js';

// Department fields mapping
const deptFields = {
  'PED': 'ped',
  'QAD': 'qad',
  'Production': 'production',
  'Maintenance': 'maintenance',
  'PC & L': 'pcl',
  'Materials': 'materials',
  'Marketing': 'marketing',
  'HR': 'hr',
  'Safety': 'safety',
  'Unit Head': 'unitHead'
};

const mapDbDeptToL3Dept = (dbDept) => {
  if (!dbDept) return 'QAD';
  const dept = dbDept.trim().toLowerCase();
  if (dept === 'qad') return 'QAD';
  if (dept === 'ped') return 'PED';
  if (dept === 'production') return 'Production';
  if (dept === 'maintenance') return 'Maintenance';
  if (dept === 'pc & l' || dept === 'pcl') return 'PC & L';
  if (dept === 'materials') return 'Materials';
  if (dept === 'marketing') return 'Marketing';
  if (dept === 'hr') return 'HR';
  if (dept === 'safety') return 'Safety';
  if (dept === 'unit head' || dept === 'unit_head') return 'Unit Head';
  return 'QAD'; // Fallback
};

export const getL3Approvals = async (req, res) => {
  try {
    const approvals = await l3Model.getL3Approvals();
    res.status(200).json(approvals);
  } catch (error) {
    console.error('Error in getL3Approvals:', error);
    res.status(500).json({ error: 'Failed to fetch L3 approvals' });
  }
};

export const getL3Details = async (req, res) => {
  try {
    const { changeNo } = req.params;
    const details = await l3Model.getL3DetailsByChangeNo(changeNo);
    res.status(200).json(details || {});
  } catch (error) {
    console.error('Error in getL3Details:', error);
    res.status(500).json({ error: 'Failed to fetch L3 details' });
  }
};

export const createL3Approval = async (req, res) => {
  const lengthError = validateLimits(req.body);
  if (lengthError) {
    return res.status(400).json({ error: lengthError });
  }

  const { logData } = req.body;
  if (!logData || !logData.changeNo || !logData.date || !logData.requester) {
    return res.status(400).json({ error: 'Required L3 approval data fields are missing.' });
  }

  try {
    // Check if the change request is Closed
    const [closedRows] = await pool.query(
      `SELECT qa_approval FROM effectiveness_logs WHERE change_no = ?`,
      [logData.changeNo]
    );
    if (closedRows.length > 0 && closedRows[0].qa_approval === 'Approved') {
      return res.status(403).json({ error: 'Access Denied: The change request is Closed and cannot be modified.' });
    }

    // Look up logged-in user details to enforce security
    const [userRows] = await pool.query(
      'SELECT role, department FROM users WHERE email = ?',
      [req.user.email]
    );

    if (userRows.length === 0) {
      return res.status(403).json({ error: 'User not found in system.' });
    }

    const user = userRows[0];
    const roleLower = (user.role || '').toLowerCase();
    const isAdmin = roleLower === 'admin' || roleLower === 'administrator';

    if (!isAdmin) {
      const isHOD = roleLower.includes('hod') || 
                    roleLower.includes('unit head') || 
                    roleLower.includes('unit_head') ||
                    roleLower.includes('manager');

      if (!isHOD) {
        return res.status(403).json({ error: 'Access denied. Only department HODs or Administrators can sign off at L3.' });
      }

      const userMappedDept = mapDbDeptToL3Dept(user.department);

      // Map user department to L3 department key
      const allowedField = deptFields[userMappedDept];

      // Fetch existing L3 approval
      const [existingL3] = await pool.query(
        `SELECT ped, qad, production, maintenance, pcl, materials, marketing, hr, safety, unit_head as unitHead
         FROM l3_approvals WHERE change_no = ?`,
        [logData.changeNo]
      );

      const dbValues = existingL3.length > 0 ? existingL3[0] : {
        ped: 'Pending',
        qad: 'Pending',
        production: 'Pending',
        maintenance: 'Pending',
        pcl: 'Pending',
        materials: 'Pending',
        marketing: 'Pending',
        hr: 'Pending',
        safety: 'Pending',
        unitHead: 'Pending'
      };

      // Check all fields to see if any unauthorized field was modified
      const fieldsToCheck = ['ped', 'qad', 'production', 'maintenance', 'pcl', 'materials', 'marketing', 'hr', 'safety', 'unitHead'];
      for (const field of fieldsToCheck) {
        const incomingVal = logData[field] || 'Pending';
        const dbVal = dbValues[field] || 'Pending';
        if (incomingVal !== dbVal) {
          if (field !== allowedField) {
            return res.status(403).json({ 
              error: `Access denied. You are only authorized to sign off for the '${userMappedDept}' department (field: '${allowedField}').` 
            });
          }
        }
      }
    }

    const newLog = await l3Model.addL3ApprovalLog(logData);
    res.status(201).json({ message: 'L3 Approval log created/updated successfully', log: newLog });
  } catch (error) {
    console.error('Error in createL3Approval:', error);
    res.status(500).json({ error: 'Failed to save L3 approval log to database.' });
  }
};
