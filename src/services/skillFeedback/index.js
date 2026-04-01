const {
  createFeedback,
  createFeedbackBulk,
  getFeedbackByUserId,
  getApprovedFeedbackForResume,
  deletePendingFeedbackById,
  getPendingFeedback,
  updateFeedbackStatus,
} = require("../../repositories/skillFeedback");

const normalizeSkill = (value) => (value || "").toString().trim();

const validateFeedbackItem = (item) => {
  const skillName = normalizeSkill(item?.skillName);
  const feedbackType = item?.feedbackType;
  const correctedSkillName = normalizeSkill(item?.correctedSkillName);

  if (!skillName) {
    return { ok: false, message: "skillName is required" };
  }

  if (!feedbackType) {
    return { ok: false, message: "feedbackType is required" };
  }

  if (feedbackType === "correct_skill" && !correctedSkillName) {
    return { ok: false, message: "correctedSkillName is required for correct_skill" };
  }

  return { ok: true, skillName, correctedSkillName };
};

exports.submitSkillFeedback = async (userId, payload) => {
  if (!userId) {
    return { data: null, message: "User ID is required", statusCode: 401 };
  }

  const validation = validateFeedbackItem(payload);
  if (!validation.ok) {
    return { data: null, message: validation.message, statusCode: 400 };
  }

  const feedback = await createFeedback({
    userId,
    resumeId: payload.resumeId || null,
    skillName: validation.skillName,
    correctedSkillName: validation.correctedSkillName || null,
    feedbackType: payload.feedbackType,
    proficiency: payload.proficiency || null,
    status: "pending",
  });

  return {
    data: feedback,
    message: "Feedback submitted",
    statusCode: 201,
  };
};

exports.submitSkillFeedbackBulk = async (userId, items = []) => {
  if (!userId) {
    return { data: null, message: "User ID is required", statusCode: 401 };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { data: null, message: "Feedback list is required", statusCode: 400 };
  }

  const sanitized = [];
  for (const item of items) {
    const validation = validateFeedbackItem(item);
    if (!validation.ok) {
      return { data: null, message: validation.message, statusCode: 400 };
    }
    sanitized.push({
      userId,
      resumeId: item.resumeId || null,
      skillName: validation.skillName,
      correctedSkillName: validation.correctedSkillName || null,
      feedbackType: item.feedbackType,
      proficiency: item.proficiency || null,
      status: "pending",
    });
  }

  const feedback = await createFeedbackBulk(sanitized);

  return {
    data: feedback,
    message: "Feedback submitted",
    statusCode: 201,
  };
};

exports.getMyFeedback = async (userId) => {
  if (!userId) {
    return { data: null, message: "User ID is required", statusCode: 401 };
  }

  const feedback = await getFeedbackByUserId(userId);
  return { data: feedback, message: "Feedback fetched", statusCode: 200 };
};

exports.getCorrectedSkills = async (userId, resumeId) => {
  if (!userId || !resumeId) {
    return { data: null, message: "User ID and resume ID are required", statusCode: 400 };
  }

  const feedback = await getApprovedFeedbackForResume(userId, resumeId);
  return { data: feedback, message: "Approved feedback fetched", statusCode: 200 };
};

exports.deletePendingFeedback = async (userId, feedbackId) => {
  if (!userId || !feedbackId) {
    return { data: null, message: "User ID and feedback ID are required", statusCode: 400 };
  }

  const deleted = await deletePendingFeedbackById(feedbackId, userId);
  if (!deleted) {
    return { data: null, message: "Pending feedback not found", statusCode: 404 };
  }

  return { data: deleted, message: "Feedback deleted", statusCode: 200 };
};

exports.getPendingFeedbackAdmin = async () => {
  const feedback = await getPendingFeedback();
  return { data: feedback, message: "Pending feedback fetched", statusCode: 200 };
};

exports.approveFeedbackAdmin = async (adminId, feedbackId) => {
  if (!feedbackId) {
    return { data: null, message: "Feedback ID is required", statusCode: 400 };
  }
  const updated = await updateFeedbackStatus(feedbackId, "approved", adminId || null);
  if (!updated) {
    return { data: null, message: "Feedback not found", statusCode: 404 };
  }
  return { data: updated, message: "Feedback approved", statusCode: 200 };
};

exports.rejectFeedbackAdmin = async (adminId, feedbackId) => {
  if (!feedbackId) {
    return { data: null, message: "Feedback ID is required", statusCode: 400 };
  }
  const updated = await updateFeedbackStatus(feedbackId, "rejected", adminId || null);
  if (!updated) {
    return { data: null, message: "Feedback not found", statusCode: 404 };
  }
  return { data: updated, message: "Feedback rejected", statusCode: 200 };
};
