import * as allRequestsModel from '../models/allRequestsModel.js';
import pool from '../config/db.js';
import { validateLimits } from '../utils/validation.js';

export const createChange = async (req, res) => {
  const lengthError = validateLimits(req.body);
  if (lengthError) {
    return res.status(400).json({ error: lengthError });
  }

  const { title, requester, priority } = req.body;
  if (!title || !requester) {
    return res.status(400).json({ error: 'Title and Requester are required fields.' });
  }
  try {
    const newChange = await allRequestsModel.addChange(title, requester, priority);
    res.status(201).json({ message: 'Change request created successfully', change: newChange });
  } catch (error) {
    console.error('Error in createChange:', error);
    res.status(500).json({ error: 'Failed to create change request' });
  }
};

export const updateChangeStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: 'Status is required.' });
  }
  try {
    const [closedRows] = await pool.query(
      `SELECT qa_approval FROM effectiveness_logs WHERE change_no = ?`,
      [id]
    );
    if (closedRows.length > 0 && closedRows[0].qa_approval === 'Approved') {
      return res.status(403).json({ error: 'Access Denied: The change request is Closed and cannot be modified.' });
    }

    const updated = await allRequestsModel.updateChangeStatus(id, status);
    res.status(200).json({ message: 'Change request status updated successfully', change: updated });
  } catch (error) {
    console.error('Error in updateChangeStatus:', error);
    res.status(500).json({ error: 'Failed to update change request status' });
  }
};

export const updateChangeDetails = async (req, res) => {
  const { id } = req.params;
  const { level } = req.query; // 'l1', 'l2', 'l3'
  const { updateData, attachments } = req.body;

  const lengthError = validateLimits(req.body);
  if (lengthError) {
    return res.status(400).json({ error: lengthError });
  }

  if (!level || !updateData) {
    return res.status(400).json({ error: 'Level and updateData are required.' });
  }

  if (level === 'l1' && updateData.title && updateData.title.length > 255) {
    const excess = updateData.title.length - 255;
    return res.status(400).json({
      error: `The change request title is too long. Please shorten it by at least ${excess} characters.`
    });
  }

  try {
    const [closedRows] = await pool.query(
      `SELECT qa_approval FROM effectiveness_logs WHERE change_no = ?`,
      [id]
    );
    if (closedRows.length > 0 && closedRows[0].qa_approval === 'Approved') {
      return res.status(403).json({ error: 'Access Denied: The change request is Closed and cannot be modified.' });
    }

    let isAllowed = req.user?.role === 'Admin';

    if (!isAllowed) {
      const [crRows] = await pool.query('SELECT requester FROM change_requests WHERE id = ?', [id]);
      if (crRows.length > 0) {
        const creatorEmail = crRows[0].requester;
        if (req.user?.email && creatorEmail && req.user.email.toLowerCase() === creatorEmail.toLowerCase()) {
          isAllowed = true;
        }
      }
    }

    if (!isAllowed) {
      return res.status(403).json({ error: 'Only Admins or the creator of this request can update details.' });
    }

    await allRequestsModel.updateChangeDetails(id, level, updateData, attachments);
    res.status(200).json({ message: `${level.toUpperCase()} details updated successfully.` });
  } catch (error) {
    console.error('Error in updateChangeDetails:', error);
    res.status(500).json({ error: 'Failed to update change details.' });
  }
};
