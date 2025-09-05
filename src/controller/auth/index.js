const { registerUser, loginUser } = require("../../services/auth");

const { asyncHandler } = require("../../utils/asyncHandler/index");
const ApiResponse = require("../../utils/apiResponse/index");

exports.handleRegistration = asyncHandler(async (req, res) => {
  const { username, password, email, profilePicture } = req.body;

  const result = await registerUser(username, password, email, profilePicture);

  const { message, statusCode, data } = result;
  return res
    .status(statusCode)
    .json(new ApiResponse(statusCode, data, message));
});

exports.handleLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const result = await loginUser(email, password);
  const { message, statusCode, data } = result;
  return res
    .status(statusCode)
    .json(new ApiResponse(statusCode, data, message));
});
