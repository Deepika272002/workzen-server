const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications
} = require('../controllers/notification.controller');

// Get user's notifications with pagination
router.get('/', auth, getNotifications);

// Get unread notification count
router.get('/unread-count', auth, getUnreadCount);

// Mark notification as read
router.put('/:id/read', auth, markAsRead);

// Mark all notifications as read
router.put('/mark-all-read', auth, markAllAsRead);

// Delete a notification
router.delete('/:id', auth, deleteNotification);

// Clear all read notifications
router.delete('/clear-all', auth, clearAllNotifications);

module.exports = router;