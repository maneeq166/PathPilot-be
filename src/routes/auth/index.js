const {
  handleRegistration,
  handleLogin,
  handleQuery,
  handleId,
  handleUpdation,
  handleDeletion,
} = require("../../controller/auth");
const { validateRequest } = require("../../middleware/validateRequest");
const {
  validateRegistration,
  validateLogin,
  validateCheckUser,
  validateUpdation,
  validateDeletion,
} = require("../../validator/auth");
const { isUserOrAdmin, OnlyAdmin } = require("../../middleware/authMiddleware/index");
const router = require("express").Router();

router
  .route("/register")
  .post(validateRegistration, validateRequest, handleRegistration);
router
  .route("/login")
  .post(validateLogin, validateRequest, handleLogin);
router
  .route("/admin")
  .get(OnlyAdmin, validateCheckUser, validateRequest, handleQuery);
router
  .route("/")
  .get(isUserOrAdmin, validateCheckUser, validateRequest, handleId)
  .patch(isUserOrAdmin, validateUpdation, validateRequest, handleUpdation)
  .delete(isUserOrAdmin, validateDeletion, validateRequest, handleDeletion);

module.exports = router;
