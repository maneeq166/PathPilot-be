const { handleRegistration, handleLogin } = require("../../controller/auth");

const router = require("express").Router();

router.route("/register").post(handleRegistration);
router.route("/login").post(handleLogin);

module.exports = router