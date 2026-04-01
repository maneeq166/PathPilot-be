const Resume = require("../../models/resumeModel");

exports.createResume = async (userId, fileMeta, parsedData, inferredRole) => {
  try {
    const resume = new Resume({
      userId,
      fileMeta,
      parsedData,
      inferredRole,
      processingStatus: "processing",
      matchingMeta: {
        totalSkills: parsedData.skills
          ? [
              ...(parsedData.skills.languages || []),
              ...(parsedData.skills.frameworks || []),
              ...(parsedData.skills.databases || []),
              ...(parsedData.skills.tools || []),
              ...(parsedData.skills.concepts || []),
              ...(parsedData.skills.softSkills || [])
            ].length
          : 0,
        experienceLevel: "fresher"
      }
    });

    const savedResume = await resume.save();
    return savedResume;
  } catch (error) {
    console.error("Error creating resume:", error);
    throw error;
  }
};

exports.getResumeByUserId = async (userId) => {
  try {
    const resume = await Resume.findOne({ userId });
    return resume;
  } catch (error) {
    console.error("Error fetching resume:", error);
    throw error;
  }
};

exports.updateResume = async (userId, updateData) => {
  try {
    const resume = await Resume.findOneAndUpdate(
      { userId },
      updateData,
      { new: true }
    );
    return resume;
  } catch (error) {
    console.error("Error updating resume:", error);
    throw error;
  }
};

exports.deleteResume = async (userId) => {
  try {
    const resume = await Resume.findOneAndDelete({ userId });
    return resume;
  } catch (error) {
    console.error("Error deleting resume:", error);
    throw error;
  }
};
