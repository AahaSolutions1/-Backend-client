import { Router } from 'express';
import { getLogs, getCounts, createLog, updateLog, deleteLog, getAttachmentFile } from '../controllers/effectivenessController.js';
import { verifyToken } from '../middlewares/authMiddleware.js';

const router = Router();

router.get('/effectiveness', verifyToken, getLogs);
router.get('/effectiveness/counts', verifyToken, getCounts);
router.post('/effectiveness', verifyToken, createLog);
router.put('/effectiveness/:id', verifyToken, updateLog);
router.delete('/effectiveness/:id', verifyToken, deleteLog);
router.get('/effectiveness/attachment/:logId/:fileName', verifyToken, getAttachmentFile);

export default router;
