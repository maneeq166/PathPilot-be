const mongoose = require("mongoose");

const jobMatchSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "user", index: true, required: true },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", index: true, required: true },
    query: { type: String, required: true, trim: true },
    location: { type: String, default: "", trim: true },
    source: { type: String, default: "unknown", index: true },
    matchScore: {
      overall: { type: Number, default: 0 },
      skillMatch: { type: Number, default: 0 },
      experienceMatch: { type: Number, default: 0 },
    },
    matchedSkills: { type: [String], default: [] },
    missingSkills: { type: [String], default: [] },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

jobMatchSchema.index({ userId: 1, jobId: 1, query: 1, location: 1 }, { unique: true });

const JobMatch = mongoose.model("JobMatch", jobMatchSchema);

module.exports = { JobMatch };
