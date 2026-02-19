const {
  registerUser,
  loginUser,
  readUser,
  readSingleUser,
  updatedUser,
  deletedUser,
} = require("../../services/auth");

const { asyncHandler } = require("../../utils/asyncHandler/index");
const ApiResponse = require("../../utils/apiResponse/index");

exports.handleRegistration = asyncHandler(async (req, res) => {
  const { username, password, email } = req.body;

  const result = await registerUser(username, password, email);

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

exports.handleQuery = asyncHandler(async (req, res) => {
  const { email, username } = req.query;
  const result = await readUser(email, username);
  const { message, statusCode, data } = result;
  return res
    .status(statusCode)
    .json(new ApiResponse(statusCode, data, message));
});

exports.handleId = asyncHandler(async (req, res) => {
  const id = req.id;  
  const result = await readSingleUser(id);
  const { message, statusCode, data } = result;
  return res
    .status(statusCode)
    .json(new ApiResponse(statusCode, data, message));
});

exports.handleUpdation = asyncHandler(async (req, res) => {
  const id = req.id;
  const { updatedData } = req.body;

  const { message, statusCode, data } = await updatedUser(id, updatedData);
  return res
    .status(statusCode)
    .json(new ApiResponse(statusCode, data, message));
});

exports.handleDeletion = asyncHandler(async(req,res)=>{
  const id = req.id;
  const result = await deletedUser(id);
  const { message, statusCode, data } = result;
  return res
    .status(statusCode)
    .json(new ApiResponse(statusCode, data, message));
})