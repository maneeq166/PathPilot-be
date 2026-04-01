const {
  submitSkillFeedback,
  submitSkillFeedbackBulk,
  getMyFeedback,
  getCorrectedSkills,
  deletePendingFeedback,
  getPendingFeedbackAdmin,
  approveFeedbackAdmin,
  rejectFeedbackAdmin,
} = require("../../services/skillFeedback");

const { asyncHandler } = require("../../utils/asyncHandler");
const ApiResponse = require("../../utils/apiResponse");

exports.handleSubmitFeedback = asyncHandler(async (req, res) => {
  const result = await submitSkillFeedback(req.id, req.body);
  return res
    .status(result.statusCode)
    .json(new ApiResponse(result.statusCode, result.data, result.message));
});

exports.handleSubmitFeedbackBulk = asyncHandler(async (req, res) => {
  const result = await submitSkillFeedbackBulk(req.id, req.body?.items || []);
  return res
    .status(result.statusCode)
    .json(new ApiResponse(result.statusCode, result.data, result.message));
});

exports.handleGetMyFeedback = asyncHandler(async (req, res) => {
  const result = await getMyFeedback(req.id);
  return res
    .status(result.statusCode)
    .json(new ApiResponse(result.statusCode, result.data, result.message));
});

exports.handleGetCorrectedSkills = asyncHandler(async (req, res) => {
  const result = await getCorrectedSkills(req.id, req.params.id);
  return res
    .status(result.statusCode)
    .json(new ApiResponse(result.statusCode, result.data, result.message));
});

exports.handleDeleteFeedback = asyncHandler(async (req, res) => {
  const result = await deletePendingFeedback(req.id, req.params.id);
  return res
    .status(result.statusCode)
    .json(new ApiResponse(result.statusCode, result.data, result.message));
});

exports.handleAdminPending = asyncHandler(async (req, res) => {
  const result = await getPendingFeedbackAdmin();
  return res
    .status(result.statusCode)
    .json(new ApiResponse(result.statusCode, result.data, result.message));
});

exports.handleAdminApprove = asyncHandler(async (req, res) => {
  const result = await approveFeedbackAdmin(req.id, req.params.id);
  return res
    .status(result.statusCode)
    .json(new ApiResponse(result.statusCode, result.data, result.message));
});

exports.handleAdminReject = asyncHandler(async (req, res) => {
  const result = await rejectFeedbackAdmin(req.id, req.params.id);
  return res
    .status(result.statusCode)
    .json(new ApiResponse(result.statusCode, result.data, result.message));
});
