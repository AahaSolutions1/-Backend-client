import * as l1Model from '../models/l1Model.js';
import { validateLimits } from '../utils/validation.js';

export const createL1Request = async (req, res) => {
  const { l1Data, attachments } = req.body;
  const userEmail = req.user?.email || 'unknown@cms.com';

  const lengthError = validateLimits(req.body);
  if (lengthError) {
    return res.status(400).json({ error: lengthError });
  }

  if (!l1Data || !l1Data.changeNo || !l1Data.unit || !l1Data.dept || !l1Data.context || !l1Data.description) {
    return res.status(400).json({ error: 'Required L1 change request data fields are missing.' });
  }

  const changeIn = l1Data.changeIn || 'General';
  const constructedTitle = `[L1 Request - ${changeIn}] ${l1Data.context}`;
  if (constructedTitle.length > 255) {
    const excess = constructedTitle.length - 255;
    return res.status(400).json({ 
      error: `The Context of Change is too long. Please shorten it by at least ${excess} characters to fit database limits.`
    });
  }

  try {
    const newChange = await l1Model.addL1Request(l1Data, attachments, userEmail);
    res.status(201).json({ message: 'L1 Change request created successfully', change: newChange });
  } catch (error) {
    console.error('Error in createL1Request:', error);
    res.status(500).json({ error: 'Failed to save L1 request to the database.' });
  }
};

export const getNextChangeNo = async (req, res) => {
  try {
    const nextNo = await l1Model.getNextChangeNo();
    res.status(200).json({ nextNo });
  } catch (error) {
    console.error('Error in getNextChangeNo:', error);
    res.status(500).json({ error: 'Failed to calculate next change number.' });
  }
};

export const getL1Details = async (req, res) => {
  const { changeNo } = req.params;
  try {
    const details = await l1Model.getL1Details(changeNo);
    if (!details) {
      return res.status(404).json({ error: 'L1 change request not found' });
    }
    res.status(200).json(details);
  } catch (error) {
    console.error('Error in getL1Details:', error);
    res.status(500).json({ error: 'Failed to fetch L1 request details' });
  }
};

export const getL1AttachmentFile = async (req, res) => {
  const { changeNo, fileName } = req.params;
  try {
    const file = await l1Model.getL1Attachment(changeNo, fileName);
    if (!file) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    const fileBuffer = Buffer.from(file.data, 'base64');
    res.setHeader('Content-Type', file.type);
    res.setHeader('Content-Disposition', `inline; filename="${file.name}"`);
    res.send(fileBuffer);
  } catch (error) {
    console.error('Error in getL1AttachmentFile:', error);
    res.status(500).json({ error: 'Failed to retrieve attachment file' });
  }
};
