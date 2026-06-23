import { Router } from 'express';
import { getL3Approvals, getL3Details, createL3Approval } from '../controllers/l3Controller.js';
import { verifyToken } from '../middlewares/authMiddleware.js';

const router = Router();

router.get('/changes/l3', verifyToken, getL3Approvals);
router.get('/changes/l3/:changeNo', verifyToken, getL3Details);
router.post('/changes/l3', verifyToken, createL3Approval);

export default router;
