import { Router } from 'express';
import { getDashboardChanges, getDashboardCounts } from '../controllers/dashboardController.js';
import { verifyToken } from '../middlewares/authMiddleware.js';

const router = Router();

router.get('/dashboard/changes', verifyToken, getDashboardChanges);
router.get('/dashboard/counts', verifyToken, getDashboardCounts);

export default router;
