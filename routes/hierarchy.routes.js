const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const hierarchyController = require('../controllers/hierarchy.controller');

// Add protect middleware to all routes
router.use(protect);

router.post('/', authorize('company_admin'), hierarchyController.createHierarchyLevel);
router.get('/', hierarchyController.getCompanyHierarchy);
router.put('/:id', authorize('company_admin'), hierarchyController.updateHierarchyLevel);
router.post('/add-employee', authorize('company_admin'), hierarchyController.addEmployee);
router.post('/bulk-create', authorize('company_admin'), hierarchyController.bulkCreateHierarchyLevels);


module.exports = router;