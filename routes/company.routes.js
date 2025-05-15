const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  createCompany,
  createCompanyWithAdmin,
  getCompanies,
  getCompany,
  getCompanyStats,
  updateCompany
} = require('../controllers/company.controller');

// Make sure this route is before any routes with :id parameter
router.post('/with-admin', protect, authorize('super_admin'), createCompanyWithAdmin);

router.post('/', protect, authorize('super_admin'), createCompany);
router.get('/', protect, authorize('super_admin'), getCompanies);
// Move stats route before the :id route to prevent conflicts
router.get('/stats', protect, authorize('super_admin'), getCompanyStats);
router.get('/:id', protect, getCompany);

router.patch('/:id', protect, authorize('super_admin'), updateCompany);


module.exports = router;