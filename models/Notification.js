const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: [
      'TASK_ASSIGNED',
      'TASK_UPDATED',
      'TASK_COMPLETED',
      'TASK_OVERDUE',
      'DEADLINE_APPROACHING',
      'COMMENT_ADDED',
      'REVIEW_REQUESTED',
      'STATUS_CHANGED',
      'PRIORITY_CHANGED',
      'MENTION',
      'TEAM_UPDATE',
      'MEETING_INVITATION'
    ],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  task: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task'
  },
  from: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  read: {
    type: Boolean,
    default: false
  },
  emailSent: {
    type: Boolean,
    default: false
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  meetingCode: {
    type: String
  }
}, {
  timestamps: true
});

// Indexes for better query performance
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
notificationSchema.index({ company: 1, createdAt: -1 });
notificationSchema.index({ task: 1, type: 1 });

module.exports = mongoose.model('Notification', notificationSchema);