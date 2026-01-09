const { handleRegistration, handleLogin, handleQuery, handleId, handleUpdation, handleDeletion } = require("../../controller/auth");

const router = require("express").Router();

router.route("/register").post(handleRegistration);
router.route("/login").post(handleLogin);
router.route("/").get(handleQuery).get(handleId).patch(handleUpdation).delete(handleDeletion);

module.exports = router