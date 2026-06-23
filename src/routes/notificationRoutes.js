import { Router } from 'express';
import { getNotifications, toggleRead, markAllRead } from '../controllers/notificationController.js';
import { verifyToken } from '../middlewares/authMiddleware.js';

const router = Router();

router.get('/notifications', verifyToken, getNotifications);
router.put('/notifications/mark-all-read', verifyToken, markAllRead);
router.put('/notifications/:id/read', verifyToken, toggleRead);

export default router;
