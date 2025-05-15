const HierarchyLevel = require('../models/HierarchyLevel');

exports.canAssignTaskTo = async (assignerLevel, assigneeLevel) => {
  try {
    const assigner = await HierarchyLevel.findById(assignerLevel);
    const assignee = await HierarchyLevel.findById(assigneeLevel);

    if (!assigner || !assignee) {
      return false;
    }

    // Lower level number means higher in hierarchy (e.g., 1 is higher than 2)
    return assigner.level < assignee.level;
  } catch (error) {
    console.error('Error checking hierarchy levels:', error);
    return false;
  }
}; 