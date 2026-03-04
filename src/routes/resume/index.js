const express = require("express");
const multer = require("multer");
const router = express.Router();
const { handleResumeUpload, handleResumeGet } = require("../../controller/resume");
const { isUserOrAdmin } = require("../../middleware/authMiddleware/index");
const { uploadMiddleware } = require("../../middleware/uploadMiddleware/index");
const ApiResponse = require("../../utils/apiResponse/index");

// Middleware to handle multer errors
const handleMulterError = (err) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return "File too large. Maximum size is 1MB";
    }
    return err.message;
  } else if (err) {
    return err.message;
  }
  return null;
};

// POST /api/resume/upload - Upload a resume
// Uses uploadMiddleware for file handling and isUserOrAdmin for authentication
router.route("/upload").post(
  isUserOrAdmin,
  (req, res, next) => {
    console.log("Route: About to call uploadMiddleware.single('resume')");
    uploadMiddleware.single("resume")(req, res, (err) => {
      console.log("Route: After uploadMiddleware, err =", err);
      console.log("Route: req.file =", req.file);
      if (err) {
        const errorMessage = handleMulterError(err);
        return res.status(400).json(new ApiResponse(400, null, errorMessage || "File upload error"));
      }
      next();
    });
  },
  handleResumeUpload
);

// GET /api/resume - Get user's resume
router.route("/").get(isUserOrAdmin, handleResumeGet);

module.exports = router;

