const mongoose = require('mongoose');

const hierarchyLevelSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  level: {
    type: Number,
    required: true,
  },
  canAssignTasks: {
    type: Boolean,
    default: false,
  },
  reportsTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HierarchyLevel',
  },
  permissions: {
    canCreateTasks: { type: Boolean, default: false },
    canAssignTasks: { type: Boolean, default: false },
    canEditTasks: { type: Boolean, default: false },
    canDeleteTasks: { type: Boolean, default: false },
    canViewReports: { type: Boolean, default: false },
    canManageUsers: { type: Boolean, default: false }
  },
  maxTasksPerDay: {
    type: Number,
    default: 10
  },
  departmentScope: [{
    type: String,
    enum: ['IT', 'HR', 'Finance', 'Operations', 'Marketing', 'Sales']
  }]
}, {
  timestamps: true
});

hierarchyLevelSchema.index({ company: 1, level: 1 });

module.exports = mongoose.model('HierarchyLevel', hierarchyLevelSchema);