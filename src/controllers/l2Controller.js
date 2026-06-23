import * as l2Model from '../models/l2Model.js';
import pool from '../config/db.js';
import { validateLimits } from '../utils/validation.js';

export const getL2ValidationLogs = async (req, res) => {
  try {
    const logs = await l2Model.getL2ValidationLogs();
    res.status(200).json(logs);
  } catch (error) {
    console.error('Error in getL2ValidationLogs:', error);
    res.status(500).json({ error: 'Failed to fetch L2 validation logs' });
  }
};

export const createL2ValidationLog = async (req, res) => {
  const lengthError = validateLimits(req.body);
  if (lengthError) {
    return res.status(400).json({ error: lengthError });
  }

  const { logData, attachments } = req.body;
  const userEmail = req.user?.email;

  if (!logData || !logData.changeNo || !logData.date || !logData.requester) {
    return res.status(400).json({ error: 'Required L2 validation log data fields are missing.' });
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

    let isQuality = false;
    let isQualityOrAdmin = false;
    let isRequester = false;
    let isAdmin = false;

    if (userEmail) {
      const [userRows] = await pool.query('SELECT department, role FROM users WHERE email = ?', [userEmail]);
      if (userRows.length > 0) {
        const user = userRows[0];
        const dept = (user.department || '').toLowerCase();
        const role = (user.role || '').toLowerCase();
        isQuality = dept === 'qad';
        isAdmin = role === 'admin' || role === 'administrator';
        isQualityOrAdmin = isAdmin || isQuality;
      }

      const [crRows] = await pool.query(
        'SELECT requester FROM change_requests WHERE id = ?',
        [logData.changeNo]
      );
      isRequester =
        crRows.length > 0 &&
        crRows[0].requester?.toLowerCase().trim() === userEmail.toLowerCase().trim();

      if (!isQualityOrAdmin && !isRequester) {
        return res.status(403).json({
          error: 'Access Denied: L2 validation can only be submitted by the person who raised the change request or QAD department members.'
        });
      }
    }

    // Verify permissions per field if log already exists
    const [existingL2] = await pool.query(
      `SELECT status, weld_test, qa_test, remarks FROM l2_validation_logs WHERE change_no = ?`,
      [logData.changeNo]
    );

    // Enforce mandatory L2 validation fields
    if (isQualityOrAdmin) {
      if (!logData.status || (logData.status !== 'Accepted' && logData.status !== 'Rejected')) {
        return res.status(400).json({ error: 'Validation status must be "Accepted" or "Rejected".' });
      }
      if (!logData.remarks || !logData.remarks.trim()) {
        return res.status(400).json({ error: 'Remarks are required.' });
      }
      
      const hasQaFile = (attachments && attachments.some(a => a.fieldName === 'qa_test')) || 
                        (existingL2.length > 0 && existingL2[0].qa_test && existingL2[0].qa_test !== '-');
      if (!hasQaFile) {
        return res.status(400).json({ error: 'QA Setup Verification Attachment is required.' });
      }

      const hasPedFile = (attachments && attachments.some(a => a.fieldName === 'weld_test')) || 
                         (existingL2.length > 0 && existingL2[0].weld_test && existingL2[0].weld_test !== '-');
      if (!hasPedFile) {
        return res.status(400).json({ error: 'Requester Validation Attachment is required.' });
      }
    } else if (isRequester) {
      const hasPedFile = (attachments && attachments.some(a => a.fieldName === 'weld_test')) || 
                         (existingL2.length > 0 && existingL2[0].weld_test && existingL2[0].weld_test !== '-');
      if (!hasPedFile) {
        return res.status(400).json({ error: 'Requester Validation Attachment is required.' });
      }
    }


    if (existingL2.length > 0) {
      const current = existingL2[0];
      
      if (current.status === 'Accepted' && !isAdmin) {
        return res.status(403).json({ error: 'Access Denied: L2 validation has already been Accepted and cannot be modified.' });
      }

      const hasNewPedAttachment = attachments && attachments.some(a => a.fieldName === 'weld_test');
      if (current.status === 'Rejected' && !hasNewPedAttachment && !isAdmin) {
        return res.status(403).json({ error: 'Access Denied: L2 validation has already been Rejected. Requester must upload a new validation attachment to reset the status before it can be updated.' });
      }
      
      if (current.status === 'Pending' && !isQualityOrAdmin) {
        const hasPedFile = current.weld_test && current.weld_test !== '-';
        if (hasPedFile && attachments && attachments.some(a => a.fieldName === 'weld_test')) {
          return res.status(403).json({ error: 'Access Denied: L2 Requester Validation attachment is already uploaded and awaiting QA review.' });
        }
      }

      // If the user is NOT Quality/Admin, they are the requester.
      // As the requester, if they upload a new PED attachment, the status MUST be reset to 'Pending'.
      if (!isQualityOrAdmin) {
        const hasNewPedAttachment = attachments && attachments.some(a => a.fieldName === 'weld_test');
        if (hasNewPedAttachment) {
          logData.status = 'Pending';
        }

        const allowedStatus = hasNewPedAttachment ? 'Pending' : current.status;

        if ((logData.status && logData.status !== allowedStatus) || 
            (logData.remarks && logData.remarks !== current.remarks) || 
            (attachments && attachments.some(a => a.fieldName === 'qa_test'))) {
          return res.status(403).json({ error: 'Access Denied: Only QAD department members or Admins are allowed to update L2 validation status, remarks, or QA attachments.' });
        }
      }
      
      // Only the creator of the change request or Admins are allowed to update the PED attachment
      if (!isRequester && !isAdmin) {
        if (attachments && attachments.some(a => a.fieldName === 'weld_test')) {
          return res.status(403).json({ error: 'Access Denied: Only the creator of the change request or Admins are allowed to update the Requester Validation attachment.' });
        }
      }
    } else {
      // For new log inserts, a non-Quality/Admin user cannot set status, remarks, or QA files
      if (!isQualityOrAdmin) {
        logData.status = 'Pending';
        logData.remarks = '';
        if (attachments && attachments.some(a => a.fieldName === 'qa_test')) {
          return res.status(403).json({ error: 'Access Denied: Only QAD department members or Admins are allowed to upload QA attachments.' });
        }
      }
    }

    const newLog = await l2Model.addL2ValidationLog(logData, attachments);
    res.status(201).json({ message: 'L2 Validation log created successfully', log: newLog });
  } catch (error) {
    console.error('Error in createL2ValidationLog:', error);
    if (error.message && error.message.includes('already exists')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to save L2 validation log to database.' });
  }
};

export const getL2Details = async (req, res) => {
  const { changeNo } = req.params;
  try {
    const details = await l2Model.getL2Details(changeNo);
    if (!details) {
      return res.status(404).json({ error: 'L2 validation log not found' });
    }
    res.status(200).json(details);
  } catch (error) {
    console.error('Error in getL2Details:', error);
    res.status(500).json({ error: 'Failed to fetch L2 validation details' });
  }
};

export const getL2AttachmentFile = async (req, res) => {
  const { changeNo, fileName } = req.params;
  try {
    const file = await l2Model.getL2Attachment(changeNo, fileName);
    if (!file) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    const fileBuffer = Buffer.from(file.data, 'base64');
    res.setHeader('Content-Type', file.type);
    res.setHeader('Content-Disposition', `inline; filename="${file.name}"`);
    res.send(fileBuffer);
  } catch (error) {
    console.error('Error in getL2AttachmentFile:', error);
    res.status(500).json({ error: 'Failed to retrieve L2 attachment file' });
  }
};
