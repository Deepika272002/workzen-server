const { createNotification } = require('../controllers/notification.controller');
const { getIo } = require('../socket');

const NotificationHelper = {
  async taskAssigned(task, assignedBy) {
    try {
      if (!task.assignedTo || !task._id) {
        throw new Error('Invalid task data for notification');
      }

      const notification = await createNotification({
        user: task.assignedTo._id || task.assignedTo, // Handle both populated and unpopulated
        type: 'TASK_ASSIGNED',
        title: 'New Task Assigned',
        message: `You have been assigned a new task: ${task.title}`,
        task: task._id,
        from: assignedBy,
        priority: task.priority,
        company: task.company
      });

      // Emit socket event if notification was created successfully
      if (notification) {
        const io = getIo();
        io.to(`user-${task.assignedTo._id || task.assignedTo}`).emit('notification', notification);
      }

    } catch (error) {
      console.error('Error creating task assigned notification:', error);
      // Throw the error to be handled by the caller
      throw error;
    }
  },

  async taskUpdated(task, updatedBy, changes) {
    try {
      await createNotification({
        user: task.assignedTo,
        type: 'TASK_UPDATED',
        title: 'Task Updated',
        message: `Task "${task.title}" has been updated`,
        task: task._id,
        from: updatedBy,
        priority: task.priority,
        company: task.company
      });
    } catch (error) {
      console.error('Error creating task updated notification:', error);
    }
  },

  async taskStatusChanged(task, updatedBy, newStatus) {
    try {
      await createNotification({
        user: task.assignedTo,
        type: 'STATUS_CHANGED',
        title: 'Task Status Changed',
        message: `Task "${task.title}" status changed to ${newStatus}`,
        task: task._id,
        from: updatedBy,
        priority: task.priority,
        company: task.company
      });
    } catch (error) {
      console.error('Error creating status change notification:', error);
    }
  },

  async taskCompleted(task, completedBy) {
    try {
      // Notify task creator
      await createNotification({
        user: task.createdBy,
        type: 'TASK_COMPLETED',
        title: 'Task Completed',
        message: `Task "${task.title}" has been completed`,
        task: task._id,
        from: completedBy,
        priority: task.priority,
        company: task.company
      });
    } catch (error) {
      console.error('Error creating task completed notification:', error);
    }
  },

  async commentAdded(task, comment, commentedBy) {
    try {
      // Notify task assignee and creator (if different from commenter)
      const notifyUsers = new Set([task.assignedTo, task.createdBy]);
      notifyUsers.delete(commentedBy);

      for (const userId of notifyUsers) {
        await createNotification({
          user: userId,
          type: 'COMMENT_ADDED',
          title: 'New Comment on Task',
          message: `New comment on task "${task.title}"`,
          task: task._id,
          from: commentedBy,
          priority: 'medium',
          company: task.company
        });
      }
    } catch (error) {
      console.error('Error creating comment notification:', error);
    }
  },

  async deadlineApproaching(task) {
    try {
      await createNotification({
        user: task.assignedTo,
        type: 'DEADLINE_APPROACHING',
        title: 'Task Deadline Approaching',
        message: `Task "${task.title}" is due soon`,
        task: task._id,
        from: task.createdBy,
        priority: 'high',
        company: task.company
      });
    } catch (error) {
      console.error('Error creating deadline notification:', error);
    }
  },

  async taskOverdue(task) {
    try {
      await createNotification({
        user: task.assignedTo,
        type: 'TASK_OVERDUE',
        title: 'Task Overdue',
        message: `Task "${task.title}" is overdue`,
        task: task._id,
        from: task.createdBy,
        priority: 'high',
        company: task.company
      });
    } catch (error) {
      console.error('Error creating overdue notification:', error);
    }
  }
};

module.exports = NotificationHelper; 