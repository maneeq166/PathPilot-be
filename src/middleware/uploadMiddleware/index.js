const multer = require("multer");
const path = require("path");

// Storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads");
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + "-" + Date.now() + path.extname(file.originalname));
  },
});

// File filter
const checkFileFilter = (req, file, cb) => {
  if (file.mimetype === "application/pdf" || 
      file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    cb(null, true);
  } else {
    cb(new Error("Only PDF and DOCX files are allowed!"), false);
  }
};

// Return Multer instance
const uploadMiddleware = multer({
  storage: storage,
  fileFilter: checkFileFilter,
  limits: {
    fileSize: 1 * 1024 * 1024, // 1MB
  },
});



module.exports = { uploadMiddleware };