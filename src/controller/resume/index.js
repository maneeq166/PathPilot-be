const { uploadResumeService, getResumeService } = require("../../services/resume");
const { asyncHandler } = require("../../utils/asyncHandler/index");
const ApiResponse = require("../../utils/apiResponse/index");

exports.handleResumeUpload = asyncHandler(async (req, res) => {
  // Get user ID from auth middleware
  const userId = req.id;
  console.log("Controller: userId =", userId);
  console.log("Controller: req.file =", req.file);
  
  // Check if file exists in request
  if (!req.file) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "No file uploaded"));
  }
  

  // Check for multer errors
  if (req.fileValidationError) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, req.fileValidationError.message));
  }

  try {
    const result = await uploadResumeService(userId, req.file);
    const { message, statusCode, data } = result;
    
    return res
      .status(statusCode)
      .json(new ApiResponse(statusCode, data, message));
  } catch (error) {
    console.error("Controller error:", error);
    return res
      .status(500)
      .json(new ApiResponse(500, null, "Server error: " + error.message));
  }
});

exports.handleResumeGet = asyncHandler(async (req, res) => {
  const userId = req.id;
  
  const result = await getResumeService(userId);
  const { message, statusCode, data } = result;
  
  return res
    .status(statusCode)
    .json(new ApiResponse(statusCode, data, message));
});
