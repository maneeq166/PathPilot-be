require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const express = require("express");
const morgan = require("morgan");
const logrotate = require("logrotate-stream");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");

const swaggerSpec = require("./src/config/swagger/index.js");
const ApiResponse = require("./src/utils/apiResponse");
const { connectToDatabase } = require("./src/config/connection/index");

const { MONGODB_URI, NODE_ENV } = process.env;
const PORT = process.env.PORT || 5000;

if (!MONGODB_URI || !NODE_ENV || !PORT) {
  console.error(
    "Missing required environment variables: MONGODB_URI, NODE_ENV, PORT",
    {
      MONGODB_URI,
      NODE_ENV,
      PORT,
    }
  );
  process.exit(1);
}

const app = express();
app.use(cors());

app.use(
  express.json({
    verify: (req, res, buf) => {
      try {
        JSON.parse(buf);
      } catch (e) {
        res
          .status(400)
          .json(
            new ApiResponse(
              400,
              null,
              "Invalid JSON format. Please check your request body."
            )
          );
        throw new Error("Invalid JSON");
      }
    },
  })
);
app.use(express.urlencoded({ extended: true }));

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Logging setup
if (NODE_ENV === "development") {
  app.use(morgan("dev"));
} else {
  const logDir = path.join(__dirname, "logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
  const accessLogStream = logrotate({
    file: path.join(logDir, "access.log"),
    size: "10M",
    keep: 3,
    compress: true,
  });
  app.use(morgan("combined", { stream: accessLogStream }));
}

// Routes
app.get("/", (req, res) => res.send("Welcome to the  API"));
app.use("/api/auth",require("./src/routes/auth/index.js"));


//  404 Fallback
app.use((req, res, next) => {
  return res
    .status(404)
    .json(
      new ApiResponse(404, null, `Route ${req.originalUrl} not found`, null)
    );
});

//  Connect to MongoDB
connectToDatabase(MONGODB_URI);

//  Start listening
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT} in ${NODE_ENV} mode`);
});