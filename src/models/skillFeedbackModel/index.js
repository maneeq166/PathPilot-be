const mongoose = require("mongoose");

const skillFeedbackSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
      index: true,
    },
    resumeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resume",
      required: false,
      index: true,
    },
    skillName: {
      type: String,
      required: true,
      trim: true,
    },
    correctedSkillName: {
      type: String,
      trim: true,
      default: null,
    },
    feedbackType: {
      type: String,
      enum: ["add_skill", "remove_skill", "confirm_skill", "correct_skill"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      default: null,
    },
    proficiency: {
      type: String,
      enum: ["beginner", "intermediate", "expert"],
      default: null,
    },
  },
  { timestamps: true }
);

skillFeedbackSchema.index({ userId: 1, resumeId: 1 });
skillFeedbackSchema.index({ skillName: 1 });
skillFeedbackSchema.index({ status: 1, createdAt: -1 });

const SkillFeedback = mongoose.model("SkillFeedback", skillFeedbackSchema);

module.exports = { SkillFeedback };
