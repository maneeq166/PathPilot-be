const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    company: { type: String, required: true, trim: true },
    location: { type: String, default: "Remote", trim: true },
    employmentType: { type: String, default: null },
    experienceLevel: { type: String, default: null },
    salaryRange: { type: String, default: null },
    description: { type: String, default: null },
    skills: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    url: { type: String, default: null },
    source: { type: String, default: "manual", index: true },
    sourceId: { type: String, default: null, index: true },
    postedAt: { type: Date, default: null },
    scrapedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

jobSchema.index({ source: 1, sourceId: 1 }, { unique: true, sparse: true });
jobSchema.index({ url: 1 }, { unique: true, sparse: true });
jobSchema.index({ title: "text", company: "text", description: "text" });

const Job = mongoose.model("Job", jobSchema);

module.exports = { Job };
