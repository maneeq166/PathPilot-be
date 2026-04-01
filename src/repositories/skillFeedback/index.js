const { SkillFeedback } = require("../../models/skillFeedbackModel");

exports.createFeedback = async (payload) => {
  return SkillFeedback.create(payload);
};

exports.createFeedbackBulk = async (items) => {
  if (!items || items.length === 0) return [];
  return SkillFeedback.insertMany(items, { ordered: false });
};

exports.getFeedbackByUserId = async (userId) => {
  return SkillFeedback.find({ userId }).sort({ createdAt: -1 });
};

exports.getApprovedFeedbackByUserId = async (userId) => {
  return SkillFeedback.find({ userId, status: "approved" }).sort({ createdAt: -1 });
};

exports.getApprovedFeedbackForResume = async (userId, resumeId) => {
  return SkillFeedback.find({ userId, resumeId, status: "approved" }).sort({ createdAt: -1 });
};

exports.getFeedbackById = async (id) => {
  return SkillFeedback.findById(id);
};

exports.deletePendingFeedbackById = async (id, userId) => {
  return SkillFeedback.findOneAndDelete({ _id: id, userId, status: "pending" });
};

exports.getPendingFeedback = async () => {
  return SkillFeedback.find({ status: "pending" }).sort({ createdAt: -1 });
};

exports.updateFeedbackStatus = async (id, status, adminId) => {
  return SkillFeedback.findByIdAndUpdate(
    id,
    { $set: { status, reviewedBy: adminId } },
    { new: true }
  );
};
