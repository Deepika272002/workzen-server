const HierarchyLevel = require('../models/HierarchyLevel');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

exports.createHierarchyLevel = async (req, res) => {
  try {
    const { name, level, canAssignTasks, reportsTo, permissions, maxTasksPerDay, departmentScope } = req.body;

    if (req.user.role !== 'company_admin') {
      return res.status(403).json({ message: 'Only company admins can create hierarchy levels' });
    }

    const hierarchyLevel = await HierarchyLevel.create({
      company: req.user.company,
      name,
      level,
      canAssignTasks,
      reportsTo,
      permissions,
      maxTasksPerDay,
      departmentScope
    });

    res.status(201).json(hierarchyLevel);
  } catch (error) {
    console.error('Error creating hierarchy level:', error);
    res.status(500).json({ message: error.message });
  }
};

exports.getCompanyHierarchy = async (req, res) => {
  try {
    const hierarchy = await HierarchyLevel.find({ company: req.user.company })
      .populate('reportsTo', 'name level')
      .sort('level');
    
    res.json(hierarchy);
  } catch (error) {
    console.error('Error fetching hierarchy:', error);
    res.status(500).json({ message: error.message });
  }
};

exports.updateHierarchyLevel = async (req, res) => {
  try {
    const { name, canAssignTasks, reportsTo, permissions, maxTasksPerDay, departmentScope } = req.body;
    const hierarchyLevel = await HierarchyLevel.findOne({
      _id: req.params.id,
      company: req.user.company
    });

    if (!hierarchyLevel) {
      return res.status(404).json({ message: 'Hierarchy level not found' });
    }

    hierarchyLevel.name = name || hierarchyLevel.name;
    hierarchyLevel.canAssignTasks = canAssignTasks ?? hierarchyLevel.canAssignTasks;
    hierarchyLevel.reportsTo = reportsTo || hierarchyLevel.reportsTo;
    hierarchyLevel.permissions = permissions || hierarchyLevel.permissions;
    hierarchyLevel.maxTasksPerDay = maxTasksPerDay || hierarchyLevel.maxTasksPerDay;
    hierarchyLevel.departmentScope = departmentScope || hierarchyLevel.departmentScope;

    await hierarchyLevel.save();
    res.json(hierarchyLevel);
  } catch (error) {
    console.error('Error updating hierarchy level:', error);
    res.status(500).json({ message: error.message });
  }
};

exports.addEmployee = async (req, res) => {
  try {
    const { email, name, phone, hierarchyLevel, reportsTo } = req.body;

    if (req.user.role !== 'company_admin') {
      return res.status(403).json({ message: 'Only company admins can add employees' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const password = phone.replace(/[^0-9]/g, '');
    if (password.length < 6) {
      return res.status(400).json({ message: 'Phone number must be at least 6 digits' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const employee = await User.create({
      name,
      email,
      password: hashedPassword,
      phone,
      role: 'employee',
      company: req.user.company,
      hierarchyLevel,
      reportsTo: reportsTo || null
    });

    const employeeResponse = employee.toObject();
    delete employeeResponse.password;

    res.status(201).json({
      message: 'Employee added successfully',
      employee: employeeResponse,
      initialPassword: password
    });
  } catch (error) {
    console.error('Error adding employee:', error);
    res.status(500).json({ message: error.message });
  }
};

exports.bulkCreateHierarchyLevels = async (req, res) => {
  try {
    const hierarchyLevels = req.body;

    if (req.user.role !== 'company_admin') {
      return res.status(403).json({ message: 'Only company admins can create hierarchy levels' });
    }

    // Step 1: Create hierarchy levels without reportsTo field
    const createdLevels = await HierarchyLevel.insertMany(hierarchyLevels.map(level => ({
      company: req.user.company,
      name: level.name,
      level: level.level,
      canAssignTasks: level.canAssignTasks,
      permissions: level.permissions,
      maxTasksPerDay: level.maxTasksPerDay,
      departmentScope: level.departmentScope
    })));

    // Step 2: Update hierarchy levels with correct reportsTo ObjectId
    for (const level of hierarchyLevels) {
      if (level.reportsTo) {
        const parentLevel = await HierarchyLevel.findOne({
          company: req.user.company,
          name: level.reportsTo
        });

        if (parentLevel) {
          await HierarchyLevel.updateOne(
            { company: req.user.company, name: level.name },
            { reportsTo: parentLevel._id }
          );
        }
      }
    }

    res.status(201).json(createdLevels);
  } catch (error) {
    console.error('Error creating hierarchy levels:', error);
    res.status(500).json({ message: error.message });
  }
};