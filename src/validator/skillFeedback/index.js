const { body } = require("express-validator");

const feedbackTypeValues = ["add_skill", "remove_skill", "confirm_skill", "correct_skill"];
const proficiencyValues = ["beginner", "intermediate", "expert"];

exports.validateFeedback = [
  body("skillName")
    .notEmpty()
    .withMessage("skillName is required")
    .isString()
    .withMessage("skillName must be a string"),
  body("feedbackType")
    .notEmpty()
    .withMessage("feedbackType is required")
    .isIn(feedbackTypeValues)
    .withMessage("Invalid feedbackType"),
  body("correctedSkillName")
    .optional()
    .isString()
    .withMessage("correctedSkillName must be a string"),
  body("proficiency")
    .optional()
    .isIn(proficiencyValues)
    .withMessage("Invalid proficiency"),
  body().custom((payload) => {
    if (payload?.feedbackType === "correct_skill" && !payload?.correctedSkillName) {
      throw new Error("correctedSkillName is required for correct_skill");
    }
    return true;
  }),
];

exports.validateFeedbackBulk = [
  body("items")
    .isArray({ min: 1 })
    .withMessage("items must be a non-empty array"),
  body("items.*.skillName")
    .notEmpty()
    .withMessage("skillName is required")
    .isString()
    .withMessage("skillName must be a string"),
  body("items.*.feedbackType")
    .notEmpty()
    .withMessage("feedbackType is required")
    .isIn(feedbackTypeValues)
    .withMessage("Invalid feedbackType"),
  body("items.*.correctedSkillName")
    .optional()
    .isString()
    .withMessage("correctedSkillName must be a string"),
  body("items.*.proficiency")
    .optional()
    .isIn(proficiencyValues)
    .withMessage("Invalid proficiency"),
  body().custom((payload) => {
    const items = payload?.items || [];
    for (const item of items) {
      if (item?.feedbackType === "correct_skill" && !item?.correctedSkillName) {
        throw new Error("correctedSkillName is required for correct_skill");
      }
    }
    return true;
  }),
];
