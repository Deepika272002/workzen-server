const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const emailTemplates = {
  TASK_ASSIGNED: (task, user) => ({
    subject: `New Task Assigned: ${task.title}`,
    html: `
      <h2>You have been assigned a new task</h2>
      <p><strong>Title:</strong> ${task.title}</p>
      <p><strong>Due Date:</strong> ${new Date(task.dueDate).toLocaleString()}</p>
      <p><strong>Priority:</strong> ${task.priority}</p>
      <p><strong>Description:</strong> ${task.description}</p>
      <a href="${process.env.FRONTEND_URL}/tasks/${task._id}">View Task</a>
    `
  }),
  TASK_UPDATED: (task, update) => ({
    subject: `Task Updated: ${task.title}`,
    html: `
      <h2>Task Update Notification</h2>
      <p>The task "${task.title}" has been updated</p>
      <p><strong>Update:</strong> ${update}</p>
      <a href="${process.env.FRONTEND_URL}/tasks/${task._id}">View Task</a>
    `
  }),
  DEADLINE_APPROACHING: (task) => ({
    subject: `Deadline Approaching: ${task.title}`,
    html: `
      <h2>Task Deadline Reminder</h2>
      <p>The deadline for task "${task.title}" is approaching</p>
      <p><strong>Due Date:</strong> ${new Date(task.dueDate).toLocaleString()}</p>
      <a href="${process.env.FRONTEND_URL}/tasks/${task._id}">View Task</a>
    `
  })
};

exports.sendEmail = async ({ to, type, data }) => {
  try {
    // Validate email address
    if (!to) {
      console.warn('Email not sent: recipient email address is missing');
      return { success: false, message: 'Recipient email address is missing' };
    }

    const template = emailTemplates[type](data);
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      ...template
    });
    return { success: true };
  } catch (error) {
    console.error('Email sending error:', error);
    return { success: false, error: error.message };
  }
};