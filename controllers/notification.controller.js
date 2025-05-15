const Notification = require('../models/Notification');
const { getIo } = require('../socket');
const { sendEmail } = require('../utils/emailService');

// Create notification helper function
exports.createNotification = async ({ user, type, title, message, task, from, priority, company }) => {
  try {
    const notification = new Notification({
      user,
      type,
      title,
      message,
      task,
      from,
      priority,
      company
    });

    await notification.save();
    console.log('Notification created successfully');
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

// Get user's notifications with pagination
exports.getNotifications = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const unreadOnly = req.query.unread === 'true';

    const query = { 
      user: req.user.id,
      company: req.user.company
    };

    if (unreadOnly) {
      query.read = false;
    }

    const notifications = await Notification.find(query)
      .populate('task', 'title status priority')
      .populate('from', 'name avatar')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Notification.countDocuments(query);

    res.json({
      notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: 'Error fetching notifications' });
  }
};

// Get unread notification count
exports.getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      user: req.user.id,
      read: false
    });

    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: 'Error getting unread count' });
  }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { read: true },
      { new: true }
    ).populate('task', 'title status priority')
     .populate('from', 'name avatar');

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Emit updated unread count
    const unreadCount = await Notification.countDocuments({
      user: req.user.id,
      read: false
    });
    getIo().to(`user-${req.user.id}`).emit('unreadNotifications', unreadCount);

    res.json(notification);
  } catch (error) {
    res.status(500).json({ message: 'Error updating notification' });
  }
};

// Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user.id, read: false },
      { read: true }
    );

    // Emit updated unread count (0)
    getIo().to(`user-${req.user.id}`).emit('unreadNotifications', 0);

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating notifications' });
  }
};

// Delete a notification
exports.deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id
    });

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting notification' });
  }
};

// Clear all notifications
exports.clearAllNotifications = async (req, res) => {
  try {
    await Notification.deleteMany({
      user: req.user.id,
      read: true
    });

    res.json({ message: 'All read notifications cleared' });
  } catch (error) {
    res.status(500).json({ message: 'Error clearing notifications' });
  }
};