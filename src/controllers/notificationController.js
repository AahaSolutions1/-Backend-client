import * as notificationModel from '../models/notificationModel.js';

export const getNotifications = async (req, res) => {
  try {
    const { email, role } = req.user;
    const list = await notificationModel.getNotifications(email, role);
    res.status(200).json(list);
  } catch (error) {
    console.error('Error in getNotifications controller:', error);
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
};

export const toggleRead = async (req, res) => {
  const { id } = req.params;
  try {
    const updated = await notificationModel.toggleReadStatus(id);
    if (!updated) {
      return res.status(404).json({ error: 'Notification not found.' });
    }
    res.status(200).json(updated);
  } catch (error) {
    console.error('Error in toggleRead controller:', error);
    res.status(500).json({ error: 'Failed to update notification.' });
  }
};

export const markAllRead = async (req, res) => {
  try {
    const { email, role } = req.user;
    await notificationModel.markAllRead(email, role);
    res.status(200).json({ message: 'All notifications marked as read.' });
  } catch (error) {
    console.error('Error in markAllRead controller:', error);
    res.status(500).json({ error: 'Failed to mark notifications read.' });
  }
};
