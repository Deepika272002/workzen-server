const Task = require('../models/Task');
const User = require('../models/User');
const HierarchyLevel = require('../models/HierarchyLevel');
const Notification = require('../models/Notification');
const { io } = require('../socket');
const { createNotification } = require('./notification.controller');
const { canAssignTaskTo } = require('../utils/hierarchyHelper');
const mongoose = require('mongoose');
const { sendEmail } = require('../utils/emailService');
const NotificationHelper = require('../utils/notificationHelper');

// Add a helper function for error handling
const handleError = (res, error, defaultMessage) => {
  console.error(`Error: ${defaultMessage}`, error);

  if (error instanceof mongoose.Error.CastError) {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid ID format',
      details: error.message
    });
  }

  if (error instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({
      status: 'error',
      message: 'Validation error',
      details: error.errors
    });
  }

  return res.status(500).json({
    status: 'error',
    message: error.message || defaultMessage
  });
};

exports.createTask = async (req, res) => {
  try {
    const {
      title,
      description,
      assignedTo,
      dueDate,
      priority,
      category,
      estimatedHours,
      subtasks,
      reviewers
    } = req.body;

    // Validate required fields
    if (!title || !description || !assignedTo || !dueDate || !category) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields'
      });
    }

    // Get the assigner's and assignee's hierarchy levels
    const assigner = await User.findById(req.user.id).populate('hierarchyLevel');
    const assignee = await User.findById(assignedTo).populate('hierarchyLevel');

    if (!assigner || !assignee) {
      return res.status(404).json({
        status: 'error',
        message: 'Assigner or assignee not found'
      });
    }

    if (!assigner.hierarchyLevel || !assignee.hierarchyLevel) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Both assigner and assignee must have hierarchy levels assigned' 
      });
    }

    // Check if assigner can assign to assignee
    const canAssign = await canAssignTaskTo(
      assigner.hierarchyLevel._id,
      assignee.hierarchyLevel._id
    );

    if (!canAssign) {
      return res.status(403).json({ 
        status: 'error',
        message: 'You cannot assign tasks to employees at the same or higher level' 
      });
    }

    // Check daily task limit for assignee
    const todayTasks = await Task.countDocuments({
      assignedTo,
      createdAt: {
        $gte: new Date().setHours(0, 0, 0, 0),
        $lt: new Date().setHours(23, 59, 59, 999)
      }
    });

    if (todayTasks >= assignee.hierarchyLevel.maxTasksPerDay) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Daily task limit exceeded for this user' 
      });
    }

    // Create task with proper data validation
    const taskData = {
      title,
      description,
      company: req.user.company,
      assignedBy: req.user.id,
      assignedByName: req.user.name,
      assignedTo,
      assignedToName: assignee.name,
      createdBy: req.user.id,
      dueDate,
      priority: priority || 'medium',
      category,
      estimatedHours: estimatedHours || 0,
      history: [{
        action: 'TASK_CREATED',
        performedBy: req.user.id,
        newStatus: 'pending'
      }]
    };

    // Only add subtasks and reviewers if they exist and are valid
    if (subtasks && Array.isArray(subtasks)) {
      taskData.subtasks = subtasks;
    }
    
    if (reviewers && Array.isArray(reviewers)) {
      taskData.reviewers = reviewers;
    }

    // Handle file attachments if any
    if (req.files && req.files.length > 0) {
      taskData.attachments = req.files.map(file => ({
        filename: file.originalname,
        path: file.path,
        uploadedAt: new Date()
      }));
    }

    const task = await Task.create(taskData);

    // Populate task with user details
    await task.populate([
      { path: 'assignedTo', select: 'name email' },
      { path: 'createdBy', select: 'name email' }
    ]);

    // Send notification
    try {
      await NotificationHelper.taskAssigned(task, req.user.id);
    } catch (notificationError) {
      console.error('Error sending notification:', notificationError);
      // Continue execution even if notification fails
    }
    
    // Send email notification with proper error handling
    try {
      // Check if assignee has an email before sending
      if (assignee && assignee.email) {
        await sendEmail({
          to: assignee.email,
          type: 'TASK_ASSIGNED',
          data: task
        });
      } else {
        console.warn('Cannot send email: Assignee email is missing');
      }
    } catch (emailError) {
      console.error('Error sending email:', emailError);
      // Continue execution even if email fails
    }

    // Emit socket event
    try {
      io.to(`user-${assignedTo}`).emit('notification', task);
    } catch (socketError) {
      console.error('Error emitting socket event:', socketError);
      // Continue execution even if socket fails
    }

    // Notify reviewers if any
    if (reviewers && reviewers.length > 0) {
      for (const reviewer of reviewers) {
        try {
          if (reviewer && reviewer.user) {
            const reviewerNotification = await Notification.create({
              type: 'REVIEW_REQUESTED',
              user: reviewer.user,
              task: task._id,
              message: `You have been assigned as a reviewer for task: ${title}`
            });
            io.to(`user-${reviewer.user}`).emit('notification', reviewerNotification);
          }
        } catch (error) {
          console.error('Error notifying reviewer:', error);
          // Continue execution even if notification fails
        }
      }
    }

    // Return success response
    res.status(201).json({
      status: 'success',
      data: task
    });
  } catch (error) {
    console.error('Task creation error:', error);
    
    // Check if a task was already created before the error
    if (error.taskCreated) {
      return res.status(201).json({
        status: 'success',
        data: error.taskCreated,
        warning: 'Task created but some notifications failed'
      });
    }
    
    handleError(res, error, 'Error creating task');
  }
};

exports.updateTaskStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const taskId = req.params.id;

    // Add validation for status
    const validStatuses = ['pending', 'in_progress', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid status value. Must be one of: pending, in_progress, completed'
      });
    }

    // Convert IDs
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const companyId = new mongoose.Types.ObjectId(req.user.company);

    const task = await Task.findOneAndUpdate({ 
      _id: taskId,
      company: companyId,
      $or: [
        { assignedTo: userId },
        { assignedBy: userId }
      ]
    }, {
      $set: {
        status: status,
        'history.$push': {
          action: 'STATUS_UPDATED',
          performedBy: userId,
          newStatus: status,
          timestamp: new Date()
        }
      }
    }, 
    { new: true });

    if (!task) {
      return res.status(404).json({
        status: 'error',
        message: 'Task not found or access denied'
      });
    }

    // Send response with updated task
    res.json({
      status: 'success',
      data: task
    });

  } catch (error) {
    handleError(res, error, 'Error updating task status');
  }
};

// Update the canAccessTask helper function
const canAccessTask = async (userId, taskId) => {
  const user = await User.findById(userId).populate('hierarchyLevel');
  const task = await Task.findById(taskId).populate({
    path: 'assignedTo',
    populate: { path: 'hierarchyLevel' }
  });

  if (!user || !task) return false;

  // Company admins can access all tasks
  if (user.role === 'company_admin') return true;

  // Users can access tasks they created
  if (task.assignedBy.toString() === userId) return true;

  // Users can access their own assigned tasks
  if (task.assignedTo._id.toString() === userId) return true;

  // Users can access tasks of those below them in hierarchy
  return user.hierarchyLevel.level < task.assignedTo.hierarchyLevel.level;
};

// Update the updateTask function
exports.updateTask = async (req, res) => {
  try {
    const taskId = req.params.id;
    const {
      content,
      status,
      priority,
      dueDate
    } = req.body;

    // First find the task
    const task = await Task.findById(taskId);
    
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Check if user is the creator or has hierarchy access
    const isCreator = task.assignedBy.toString() === req.user.id;
    const hasHierarchyAccess = await canAccessTask(req.user.id, taskId);

    if (!isCreator && !hasHierarchyAccess) {
      return res.status(403).json({ 
        message: 'You do not have permission to update this task' 
      });
    }

    // Create update record
    const update = {
      content,
      updatedBy: req.user.id,
      attachments: req.files ? req.files.map(file => ({
        filename: file.originalname,
        path: file.path,
        type: 'update',
        uploadedBy: req.user.id
      })) : []
    };

    task.updates.push(update);

    // Update task fields if provided
    if (status) task.status = status;
    if (priority) task.priority = priority;
    if (dueDate) task.dueDate = dueDate;

    await task.save();

    // Send appropriate notifications
    if (task.status !== status) {
      await NotificationHelper.taskStatusChanged(task, req.user.id, status);
      
      if (status === 'completed') {
        await NotificationHelper.taskCompleted(task, req.user.id);
      }
    } else {
      await NotificationHelper.taskUpdated(task, req.user.id);
    }

    // Populate necessary fields before sending response
    await task.populate([
      { path: 'assignedTo', select: 'name email' },
      { path: 'assignedBy', select: 'name email' },
      { path: 'updates.updatedBy', select: 'name email' }
    ]);

    res.json({
      status: 'success',
      data: task
    });
  } catch (error) {
    handleError(res, error, 'Error updating task');
  }
};

exports.submitTaskReport = async (req, res) => {
  try {
    const taskId = req.params.id;
    const { content } = req.body;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    if (task.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only assigned user can submit report' });
    }

    const report = {
      content,
      reportedBy: req.user.id,
      attachments: req.files ? req.files.map(file => ({
        filename: file.originalname,
        path: file.path,
        type: 'report',
        uploadedBy: req.user.id
      })) : []
    };

    task.reports.push(report);
    task.status = 'under_review';
    await task.save();

    // Notify task creator
    await createNotification({
      user: task.assignedBy,
      type: 'TASK_REPORT_SUBMITTED',
      message: `New report submitted for task "${task.title}"`,
      task: task._id
    });

    res.json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getTasksByHierarchy = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('hierarchyLevel');
    
    let query = { company: req.user.company };
    
    // If not company admin, only show tasks based on hierarchy
    if (req.user.role !== 'company_admin') {
      const subordinates = await User.find({
        company: req.user.company,
        'hierarchyLevel.level': { $gt: user.hierarchyLevel.level }
      }).select('_id');

      query.$or = [
        { assignedTo: req.user.id },
        { assignedTo: { $in: subordinates.map(s => s._id) } }
      ];
    }

    const tasks = await Task.find(query)
      .populate('assignedTo', 'name email hierarchyLevel')
      .populate('assignedBy', 'name email')
      .sort('-createdAt');

    res.json(tasks);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getTasks = async (req, res) => {
  try {
    const tasks = await Task.find({ company: req.user.company })
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
exports.getTaskById = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .populate('comments.user', 'name email');
    
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }
    
    res.json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};



exports.deleteTask = async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }
    
    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.addComment = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    task.comments.push({
      user: req.user._id,
      content: req.body.content
    });

    await task.save();

    await NotificationHelper.commentAdded(task, req.body.content, req.user.id);

    res.json(task);
  } catch (error) {
    handleError(res, error, 'Error adding comment');
  }
};

exports.getTaskAnalytics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = { company: req.user.company };

    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Get task statistics with default values if no data exists
    const [
      totalTasks,
      completedTasks,
      pendingTasks,
      inProgressTasks,
      tasksByPriority,
      recentTasks
    ] = await Promise.all([
      Task.countDocuments(query).catch(() => 0),
      Task.countDocuments({ ...query, status: 'completed' }).catch(() => 0),
      Task.countDocuments({ ...query, status: 'pending' }).catch(() => 0),
      Task.countDocuments({ ...query, status: 'in_progress' }).catch(() => 0),
      Task.aggregate([
        { $match: query },
        { $group: { _id: '$priority', count: { $sum: 1 } } }
      ]).catch(() => []),
      Task.find(query)
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('assignedTo', 'name')
        .catch(() => [])
    ]);

    const analytics = {
      totalTasks: totalTasks || 0,
      completedTasks: completedTasks || 0,
      pendingTasks: pendingTasks || 0,
      inProgressTasks: inProgressTasks || 0,
      tasksByPriority: tasksByPriority.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
      }, {
        low: 0,
        medium: 0,
        high: 0
      }),
      completionRate: totalTasks ? ((completedTasks / totalTasks) * 100).toFixed(1) : 0,
      recentTasks: recentTasks || []
    };

    res.json(analytics);
  } catch (error) {
    console.error('Error getting task analytics:', error);
    // Send a more user-friendly response with default values
    res.status(200).json({
      totalTasks: 0,
      completedTasks: 0,
      pendingTasks: 0,
      inProgressTasks: 0,
      tasksByPriority: {
        low: 0,
        medium: 0,
        high: 0
      },
      completionRate: 0,
      recentTasks: [],
      error: 'Unable to fetch task analytics'
    });
  }
};

exports.getTasksByDepartment = async (req, res) => {
  try {
    const { dept } = req.params;
    
    // Get all users in the department
    const departmentUsers = await User.find({
      company: req.user.company,
      'hierarchyLevel.departmentScope': dept
    }).select('_id');

    const tasks = await Task.find({
      company: req.user.company,
      assignedTo: { $in: departmentUsers.map(user => user._id) }
    })
    .populate('assignedTo', 'name email hierarchyLevel')
    .populate('assignedBy', 'name email')
    .sort('-createdAt');

    res.json(tasks);
  } catch (error) {
    console.error('Error getting department tasks:', error);
    res.status(500).json({ message: error.message });
  }
};

exports.getTaskTimeline = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = { company: req.user.company };

    if (startDate && endDate) {
      query.dueDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const tasks = await Task.find(query)
      .select('title status dueDate priority')
      .sort('dueDate');

    // Group tasks by date
    const timeline = tasks.reduce((acc, task) => {
      const date = task.dueDate.toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(task);
      return acc;
    }, {});

    res.json(timeline);
  } catch (error) {
    console.error('Error getting task timeline:', error);
    res.status(500).json({ message: error.message });
  }
};

exports.getCompanyStats = async (req, res) => {
  try {
    const companyId = req.user.company;

    if (!companyId) {
      return res.status(400).json({ message: 'Company ID not found' });
    }

    const [
      totalTasks,
      completedTasks,
      pendingTasks,
      inProgressTasks,
      highPriorityTasks,
      mediumPriorityTasks,
      lowPriorityTasks,
      recentTasks
    ] = await Promise.all([
      Task.countDocuments({ company: companyId }),
      Task.countDocuments({ company: companyId, status: 'completed' }),
      Task.countDocuments({ company: companyId, status: 'pending' }),
      Task.countDocuments({ company: companyId, status: 'in_progress' }),
      Task.countDocuments({ company: companyId, priority: 'high' }),
      Task.countDocuments({ company: companyId, priority: 'medium' }),
      Task.countDocuments({ company: companyId, priority: 'low' }),
      Task.find({ company: companyId })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('assignedTo', 'name')
    ]);

    res.json({
      totalTasks,
      completedTasks,
      pendingTasks,
      inProgressTasks,
      tasksByPriority: {
        high: highPriorityTasks,
        medium: mediumPriorityTasks,
        low: lowPriorityTasks
      },
      completionRate: totalTasks ? (completedTasks / totalTasks) * 100 : 0,
      recentTasks
    });
  } catch (error) {
    console.error('Error getting company task stats:', error);
    res.status(500).json({ 
      message: 'Error getting task statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getMyTasks = async (req, res) => {
  try {
    // Validate user and company exist
    if (!req.user?.id || !req.user?.company) {
      return res.status(400).json({
        status: 'error',
        message: 'User or company information missing'
      });
    }

    // Convert IDs to ObjectId
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const companyId = new mongoose.Types.ObjectId(req.user.company);

    // Find tasks with proper error handling
    const tasks = await Task.find({
      $or: [
        { assignedTo: userId },
        { assignedBy: userId }
      ],
      company: companyId
    })
    .populate({
      path: 'assignedTo',
      select: 'name email hierarchyLevel',
      populate: {
        path: 'hierarchyLevel',
        select: 'name level'
      }
    })
    .populate({
      path: 'assignedBy',
      select: 'name email hierarchyLevel',
      populate: {
        path: 'hierarchyLevel',
        select: 'name level'
      }
    })
    .populate({
      path: 'comments.user',
      select: 'name email'
    })
    .sort('-createdAt')
    .lean()
    .exec(); // Add exec() for proper promise handling

    // Transform dates safely
    const transformedTasks = tasks.map(task => ({
      ...task,
      createdAt: task.createdAt?.toISOString() || null,
      updatedAt: task.updatedAt?.toISOString() || null,
      dueDate: task.dueDate?.toISOString() || null,
      comments: task.comments?.map(comment => ({
        ...comment,
        createdAt: comment.createdAt?.toISOString() || null
      })) || []
    }));

    res.json({
      status: 'success',
      data: transformedTasks
    });
  } catch (error) {
    handleError(res, error, 'Error fetching tasks');
  }
};

exports.getMyStats = async (req, res) => {
  try {
    // Validate user and company exist
    if (!req.user?.id || !req.user?.company) {
      return res.status(400).json({
        status: 'error',
        message: 'User or company information missing'
      });
    }

    // Convert IDs to ObjectId
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const companyId = new mongoose.Types.ObjectId(req.user.company);

    // Get task counts with proper status filters
    const [totalTasks, completedTasks, pendingTasks, inProgressTasks] = await Promise.all([
      Task.countDocuments({ 
        assignedTo: userId,
        company: companyId 
      }),
      Task.countDocuments({ 
        assignedTo: userId,
        company: companyId,
        status: 'completed'  // Make sure this matches your status value exactly
      }),
      Task.countDocuments({ 
        assignedTo: userId,
        company: companyId,
        status: 'pending'
      }),
      Task.countDocuments({ 
        assignedTo: userId,
        company: companyId,
        status: 'in_progress'
      })
    ]);

    res.json({
      status: 'success',
      data: {
        totalTasks,
        completedTasks,
        pendingTasks,
        inProgressTasks,
        completionRate: totalTasks ? ((completedTasks / totalTasks) * 100).toFixed(1) : 0
      }
    });
  } catch (error) {
    handleError(res, error, 'Error fetching task statistics');
  }
};

// Get tasks created by the logged-in user
exports.getMyTasksCreatedBy = async (req, res) => {
  try {
    const tasks = await Task.find({ createdBy: req.user._id });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch tasks' });
  }
};

// Get tasks assigned to the logged-in user
exports.getAssignedTasks = async (req, res) => {
  try {
    const tasks = await Task.find({ assignedTo: req.user._id });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch tasks' });
  }
};

exports.getTasksCreatedByMe = async (req, res) => {
  try {
    const tasks = await Task.find({ 
      createdBy: req.user.id,
      company: req.user.company 
    })
      .populate('assignedTo', 'name email')
      .populate('assignedBy', 'name email')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      status: 'success',
      count: tasks.length,
      data: tasks
    });
  } catch (error) {
    handleError(res, error, 'Error fetching created tasks');
  }
};

// Ensure indexes are created
const ensureIndexes = async () => {
  try {
    await Task.collection.createIndex({ assignedTo: 1, company: 1 });
    await Task.collection.createIndex({ assignedBy: 1, company: 1 });
    await Task.collection.createIndex({ createdAt: -1 });
    console.log('Task indexes created successfully');
  } catch (error) {
    console.error('Error creating task indexes:', error);
  }
};

ensureIndexes();

exports.patchAddComment = async (req, res) => {
  try {
    const taskId = req.params.id;
    const { content } = req.body;

    const task = await Task.findById(taskId);
    
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    task.comments.push({
      user: req.user._id,
      content
    });

    await task.save();

    await NotificationHelper.commentAdded(task, content, req.user.id);

    res.json({
      status: 'success',
      data: task
    });
  } catch (error) {
    handleError(res, error, 'Error adding comment');
  }
};

exports.submitTaskCompletion = async (req, res) => {
  try {
    const taskId = req.params.id;
    const { completionNotes } = req.body;
    
    // Find the task
    const task = await Task.findById(taskId);
    
    if (!task) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Task not found' 
      });
    }
    
    // Verify the user is the assignee
    if (task.assignedTo.toString() !== req.user.id) {
      return res.status(403).json({ 
        status: 'error',
        message: 'Only the assigned user can submit task completion' 
      });
    }
    
    // Create completion submission
    const completionSubmission = {
      notes: completionNotes,
      submittedBy: req.user.id,
      submittedAt: new Date(),
      attachments: req.files ? req.files.map(file => ({
        filename: file.originalname,
        path: file.path,
        type: 'completion',
        uploadedBy: req.user.id
      })) : []
    };
    
    // Update task with completion data and change status
    task.completionSubmission = completionSubmission;
    task.status = 'completed';
    task.history.push({
      action: 'TASK_COMPLETED',
      performedBy: req.user.id,
      newStatus: 'completed',
      timestamp: new Date()
    });
    
    await task.save();
    
    // Send notification to task creator
    await NotificationHelper.taskCompleted(task, req.user.id);
    
    // Send email notification
    try {
      await sendEmail({
        to: task.assignedBy.email,
        type: 'TASK_COMPLETED',
        data: {
          ...task.toObject(),
          completionNotes
        }
      });
    } catch (emailError) {
      console.error('Error sending completion email:', emailError);
      // Continue execution even if email fails
    }
    
    // Populate necessary fields before sending response
    await task.populate([
      { path: 'assignedTo', select: 'name email' },
      { path: 'assignedBy', select: 'name email' }
    ]);
    
    res.json({
      status: 'success',
      data: task
    });
  } catch (error) {
    handleError(res, error, 'Error submitting task completion');
  }
};

exports.addTaskAttachments = async (req, res) => {
  try {
    const taskId = req.params.id;
    
    // Find the task
    const task = await Task.findById(taskId);
    
    if (!task) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Task not found' 
      });
    }
    
    // Check if user has permission to add attachments
    // Either the task creator or the assigned user can add attachments
    if (task.assignedTo.toString() !== req.user.id && 
        task.assignedBy.toString() !== req.user.id) {
      return res.status(403).json({ 
        status: 'error',
        message: 'You do not have permission to add attachments to this task' 
      });
    }
    
    // Process file attachments
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No files uploaded'
      });
    }
    
    // Create attachment objects
    const newAttachments = req.files.map(file => ({
      filename: file.originalname,
      path: file.path,
      uploadedAt: new Date()
    }));
    
    // Add new attachments to the task
    if (!task.attachments) {
      task.attachments = [];
    }
    
    task.attachments.push(...newAttachments);
    
    // Add history entry
    task.history.push({
      action: 'ATTACHMENTS_ADDED',
      performedBy: req.user.id,
      timestamp: new Date()
    });
    
    await task.save();
    
    // Skip notifications for now since they're causing issues
    // We'll just return the updated task
    
    res.status(200).json({
      status: 'success',
      data: task
    });
  } catch (error) {
    handleError(res, error, 'Error adding attachments to task');
  }
};


