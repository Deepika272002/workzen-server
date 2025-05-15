const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { addEmployee } = require('../controllers/auth.controller');
const {
  getCompanyEmployees,
  updateUser,
  getUserProfile,
  updateProfile,
  changePassword,
  uploadAvatar,
  updateEmployeeProfile,
  deleteEmployee,
  getMyTeam,
  getMyStats,
  getCompanyUsers
} = require('../controllers/user.controller');

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const errorHandler = require('../middleware/error');

// Create uploads directory if it doesn't exist
const uploadDir = 'uploads/avatars';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for avatar uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only .png, .jpg and .jpeg format allowed!'));
  }
});

// Employee routes
router.get('/my-team', protect, authorize('employee'), getMyTeam);
router.get('/my-stats', protect, authorize('employee'), getMyStats);
router.get('/company-users', protect, getCompanyUsers);


// Employee management routes (company admin only)
router.post('/add-employee', protect, authorize('company_admin'), addEmployee);
router.get('/employees', protect, authorize('company_admin'), getCompanyEmployees);
router.patch('/employees/:id', protect, authorize('company_admin'), updateEmployeeProfile);
router.delete('/employees/:id', protect, authorize('company_admin'), deleteEmployee);


// Profile routes
router.get('/profile', protect, getUserProfile);
router.patch('/profile', protect, updateProfile);
router.patch('/profile/password', protect, changePassword);
router.patch('/profile/avatar', protect, upload.single('avatar'), uploadAvatar, errorHandler);



module.exports = router;