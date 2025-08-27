const { handleRegistration } = require("../../controller/auth");

const router = require("express").Router();

router.route("/register").post(handleRegistration);