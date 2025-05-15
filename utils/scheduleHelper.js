const cron = require('node-cron');
const Task = require('../models/Task');
const NotificationHelper = require('./notificationHelper');

const initializeScheduledTasks = () => {
  // Check for approaching deadlines daily at 9 AM
  cron.schedule('0 9 * * *', async () => {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const approachingDeadlines = await Task.find({
        status: { $ne: 'completed' },
        dueDate: {
          $gte: new Date(),
          $lte: tomorrow
        }
      });

      for (const task of approachingDeadlines) {
        await NotificationHelper.deadlineApproaching(task);
      }
    } catch (error) {
      console.error('Error checking approaching deadlines:', error);
    }
  });

  // Check for overdue tasks daily at 12 AM
  cron.schedule('0 0 * * *', async () => {
    try {
      const overdueTasks = await Task.find({
        status: { $ne: 'completed' },
        dueDate: { $lt: new Date() }
      });

      for (const task of overdueTasks) {
        await NotificationHelper.taskOverdue(task);
      }
    } catch (error) {
      console.error('Error checking overdue tasks:', error);
    }
  });
};

module.exports = { initializeScheduledTasks }; 