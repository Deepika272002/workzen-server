const Company = require('../models/Company');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

exports.createCompany = async (req, res) => {
  try {
    const { name, description } = req.body;

    const company = await Company.create({
      name,
      description,
      admin: req.user.id
    });

    res.status(201).json(company);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getCompanies = async (req, res) => {
  try {
    const companies = await Company.find()
      .populate('admin', 'name email');
    res.json(companies);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getCompany = async (req, res) => {
  try {
    const company = await Company.findById(req.params.id)
      .populate('admin', 'name email');
    
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.json(company);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Add this new function to the existing controller
exports.getCompanyStats = async (req, res) => {
  try {
    const totalCompanies = await Company.countDocuments();
    const activeCompanies = await Company.countDocuments({ active: true });
    const totalUsers = await User.countDocuments();

    res.json({
      totalCompanies,
      activeCompanies,
      totalUsers
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createCompanyWithAdmin = async (req, res) => {
  // Start a session for transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { name, description, admin } = req.body;
    console.log('Received request body:', req.body); // Debug log

    // Validate required fields
    if (!name || !admin?.name || !admin?.email || !admin?.password) {
      return res.status(400).json({ 
        message: 'Please provide all required fields: company name, admin name, email, and password' 
      });
    }

    // Check if admin email already exists
    const existingUser = await User.findOne({ email: admin.email });
    if (existingUser) {
      return res.status(400).json({ message: 'Admin email already exists' });
    }

    try {
      // Create company first (without admin)
      const company = await Company.create([{
        name,
        description,
        active: true,
      }], { session });

      // Hash password for admin
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(admin.password, salt);

      // Create admin user
      const adminUser = await User.create([{
        name: admin.name,
        email: admin.email,
        password: hashedPassword,
        role: 'company_admin',
        company: company[0]._id
      }], { session });

      // Update company with admin reference
      await Company.findByIdAndUpdate(
        company[0]._id,
        { admin: adminUser[0]._id },
        { session }
      );

      // Commit the transaction
      await session.commitTransaction();

      // Send success response
      res.status(201).json({
        message: 'Company and admin created successfully',
        company: {
          id: company[0]._id,
          name: company[0].name,
          description: company[0].description,
          admin: {
            id: adminUser[0]._id,
            name: adminUser[0].name,
            email: adminUser[0].email
          }
        }
      });
    } catch (error) {
      // If error occurs, abort transaction
      await session.abortTransaction();
      throw error;
    }
  } catch (error) {
    console.error('Error creating company with admin:', error);
    res.status(500).json({ 
      message: 'Failed to create company and admin',
      error: error.message 
    });
  } finally {
    // End session
    session.endSession();
  }
};

exports.updateCompany = async (req, res) => {
  try {
    const { name, description, active } = req.body;
    const companyId = req.params.id;

    const updatedCompany = await Company.findByIdAndUpdate(
      companyId,
      { name, description, active },
      { new: true, runValidators: true }
    );

    if (!updatedCompany) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.json(updatedCompany);
  } catch (error) {
    console.error('Error updating company:', error);
    res.status(500).json({ message: error.message });
  }
};