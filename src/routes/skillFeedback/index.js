const router = require("express").Router();
const {
  handleSubmitFeedback,
  handleSubmitFeedbackBulk,
  handleGetMyFeedback,
  handleGetCorrectedSkills,
  handleDeleteFeedback,
  handleAdminPending,
  handleAdminApprove,
  handleAdminReject,
} = require("../../controller/skillFeedback");
const { validateRequest } = require("../../middleware/validateRequest");
const { isUserOrAdmin, OnlyAdmin } = require("../../middleware/authMiddleware");
const {
  validateFeedback,
  validateFeedbackBulk,
} = require("../../validator/skillFeedback");

router
  .route("/")
  .post(isUserOrAdmin, validateFeedback, validateRequest, handleSubmitFeedback);

router
  .route("/bulk")
  .post(isUserOrAdmin, validateFeedbackBulk, validateRequest, handleSubmitFeedbackBulk);

router.route("/my").get(isUserOrAdmin, handleGetMyFeedback);

router.route("/corrected/:id").get(isUserOrAdmin, handleGetCorrectedSkills);

router.route("/:id").delete(isUserOrAdmin, handleDeleteFeedback);

router.route("/admin/pending").get(OnlyAdmin, handleAdminPending);

router.route("/admin/approve/:id").patch(OnlyAdmin, handleAdminApprove);

router.route("/admin/reject/:id").patch(OnlyAdmin, handleAdminReject);

module.exports = router;
