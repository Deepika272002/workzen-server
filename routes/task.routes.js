const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/fileUpload');
const taskController = require('../controllers/task.controller');

// Wrap async route handlers with error handling
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Task analytics routes
router.get('/analytics', protect, authorize('company_admin'), asyncHandler(taskController.getTaskAnalytics));

// Get tasks for current employee
router.get('/my-tasks', protect, asyncHandler(taskController.getMyTasks));
router.get('/my-stats', protect, asyncHandler(taskController.getMyStats));
router.get('/my-tasks-createdby', protect, asyncHandler(taskController.getMyTasksCreatedBy));
router.get('/assigned-tasks', protect, asyncHandler(taskController.getAssignedTasks));

// Other task routes
router.post('/', protect, upload.array('attachments'), asyncHandler(taskController.createTask));
router.get('/', protect, asyncHandler(taskController.getTasks));
router.get('/hierarchy', protect, asyncHandler(taskController.getTasksByHierarchy));
router.get('/department/:dept', protect, asyncHandler(taskController.getTasksByDepartment));
router.get('/timeline', protect, asyncHandler(taskController.getTaskTimeline));
router.get('/:id', protect, asyncHandler(taskController.getTaskById));
// router.put('/:id', protect, upload.array('attachments'), asyncHandler(taskController.updateTask));
router.delete('/:id', protect, asyncHandler(taskController.deleteTask));
router.post('/:id/comments', protect, asyncHandler(taskController.addComment));

router.patch('/:id/status', protect, asyncHandler(taskController.updateTaskStatus));
router.patch('/:id', protect, asyncHandler(taskController.updateTask));
router.get('/created-by-me', protect, taskController.getTasksCreatedByMe);

router.patch('/:id/comments', protect, asyncHandler(taskController.patchAddComment));

// Add the new route for task completion submission
router.post('/:id/complete', protect, upload.array('attachments'), asyncHandler(taskController.submitTaskCompletion));

// Add route for adding attachments to a completed task
router.post('/:id/attachments', protect, upload.array('attachments'), asyncHandler(taskController.addTaskAttachments));

module.exports = router;