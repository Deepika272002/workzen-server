const User = require('../models/User');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// Get Company Employees
exports.getCompanyEmployees = async (req, res) => {
  try {
    const employees = await User.find({
      company: req.user.company,
      role: 'employee'
    })
      .populate('hierarchyLevel', 'name level')
      .populate('reportsTo', 'name email')
      .select('-password');

    res.json(employees);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update Employee Profile (by company admin)
exports.updateEmployeeProfile = async (req, res) => {
  try {
    const { name, email, phone, hierarchyLevel, reportsTo, status } = req.body;

    const employee = await User.findOne({
      _id: req.params.id,
      company: req.user.company,
      role: 'employee'
    });

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    // Update fields
    if (name) employee.name = name;
    if (email) employee.email = email;
    if (phone) employee.phone = phone;
    if (hierarchyLevel) employee.hierarchyLevel = hierarchyLevel;
    if (reportsTo) employee.reportsTo = reportsTo;
    if (status !== undefined) employee.active = status;

    await employee.save();

    // Populate references before sending response
    await employee.populate('hierarchyLevel', 'name level');
    await employee.populate('reportsTo', 'name email');

    const employeeResponse = employee.toObject();
    delete employeeResponse.password;

    res.json(employeeResponse);
  } catch (error) {
    console.error('Error updating employee profile:', error);
    res.status(500).json({ message: error.message });
  }
};

// Update User
exports.updateUser = async (req, res) => {
  try {
    const { name, email, hierarchyLevel, reportsTo } = req.body;
    const user = await User.findById(req.params.id).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (req.user.role !== 'company_admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ message: 'Not authorized to update this user' });
    }

    user.name = name || user.name;
    user.email = email || user.email;

    if (req.user.role === 'company_admin') {
      user.hierarchyLevel = hierarchyLevel || user.hierarchyLevel;
      user.reportsTo = reportsTo || user.reportsTo;
    }

    await user.save();
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get User Profile
exports.getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password')
      .populate('hierarchyLevel', 'name level')
      .populate('reportsTo', 'name email');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update Profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, email, phone, bio } = req.body;
    const user = await User.findById(req.user.id).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update fields
    if (name) user.name = name;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    if (bio) user.bio = bio;

    await user.save();
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Change Password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id).select('+password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    user.password = await bcrypt.hash(newPassword, 10);

    await user.save();
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Upload Avatar
exports.uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Store the relative path
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    user.avatar = avatarUrl;
    await user.save();

    res.json({
      message: 'Avatar uploaded successfully',
      avatar: avatarUrl
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ message: 'Error uploading avatar' });
  }
};

// Delete Employee
exports.deleteEmployee = async (req, res) => {
  try {
    const employee = await User.findOneAndDelete({
      _id: req.params.id,
      company: req.user.company,
      role: 'employee'
    });

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    res.json({ message: 'Employee deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get My Team


exports.getMyTeam = async (req, res) => {
  try {
    // Get the current user's hierarchy level
    const currentUser = await User.findById(req.user._id).populate('hierarchyLevel', 'level');
    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const currentLevel = currentUser.hierarchyLevel?.level;
    if (currentLevel === undefined) {
      return res.status(400).json({ message: 'Hierarchy level not assigned to the user' });
    }

    console.log("Current User Level:", currentLevel);

    // Use aggregation to lookup hierarchy levels and filter users with greater levels
    const users = await User.aggregate([
      {
        $match: { company: new mongoose.Types.ObjectId(req.user.company) }
      },
      {
        $lookup: {
          from: "hierarchylevels", // Match with the collection name in MongoDB
          localField: "hierarchyLevel",
          foreignField: "_id",
          as: "hierarchyLevelData"
        }
      },
      {
        $unwind: "$hierarchyLevelData"
      },
      {
        $match: { "hierarchyLevelData.level": { $gt: currentLevel } }
      },
      {
        $lookup: {
          from: "users",
          localField: "reportsTo",
          foreignField: "_id",
          as: "reportsToData"
        }
      },
      {
        $project: {
          password: 0,
          "reportsToData.password": 0
        }
      }
    ]);

    console.log("Filtered Users:", users);
    res.json(users);
  } catch (error) {
    console.error('Error fetching users with higher hierarchy level:', error);
    res.status(500).json({ message: error.message });
  }
};


// Get My Stats
exports.getMyStats = async (req, res) => {
  try {
    const stats = await User.aggregate([
      {
        $match: {
          _id: req.user._id,
          company: req.user.company
        }
      },
      {
        $lookup: {
          from: 'tasks',
          localField: '_id',
          foreignField: 'assignedTo',
          as: 'tasks'
        }
      },
      {
        $project: {
          totalTasks: { $size: '$tasks' },
          completedTasks: {
            $size: {
              $filter: {
                input: '$tasks',
                as: 'task',
                cond: { $eq: ['$$task.status', 'completed'] }
              }
            }
          }
        }
      }
    ]);

    res.json(stats[0] || { totalTasks: 0, completedTasks: 0 });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ message: 'Error fetching user statistics' });
  }
};

// Get Company Users
exports.getCompanyUsers = async (req, res) => {
  try {
    const users = await User.find({
      company: req.user.company,
      _id: { $ne: req.user._id } // Exclude current user
    })
      .select('-password')
      .populate('hierarchyLevel', 'name level')
      .populate('reportsTo', 'name email')
      .sort({ name: 1 }); // Sort by name alphabetically

    // Format the response
    const formattedUsers = users.map(user => ({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      hierarchyLevel: user.hierarchyLevel,
      reportsTo: user.reportsTo,
      active: user.active
    }));

    res.status(200).json(formattedUsers);
  } catch (error) {
    console.error('Error fetching company users:', error);
    res.status(500).json({ message: error.message });
  }
};