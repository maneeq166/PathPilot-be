const { handleRegistration, handleLogin, handleQuery, handleId, handleUpdation, handleDeletion } = require("../../controller/auth");
const { validateRequest } = require("../../middleware/validateRequest");
const { validateRegistration, validateLogin } = require("../../validator/auth");
const {isUserOrAdmin,OnlyAdmin} = require("../../middleware/authMiddleware/index");
const router = require("express").Router();

router.route("/register").post(validateRegistration,validateRequest, handleRegistration);
router.route("/login").post(validateLogin,validateRequest, handleLogin);
router.route("/admin").get(OnlyAdmin,handleQuery);
router.route("/").get(isUserOrAdmin,handleId).patch(isUserOrAdmin,handleUpdation).delete(handleDeletion)

module.exports = router