const { createResume, getResumeByUserId, deleteResume } = require("../../repositories/resume");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const nlp = require("compromise");
const natural = require("natural");

const extractTextFromFile = async (filePath, fileType) => {
  try {
    if (fileType === "pdf") {
      const buffer = await fs.promises.readFile(filePath);
      const data = await pdfParse(buffer);
      return data?.text || "";
    }

    if (fileType === "docx") {
      const data = await mammoth.extractRawText({ path: filePath });
      return data?.value || "";
    }

    return "";
  } catch (error) {
    console.error("Error extracting text:", error);
    throw error;
  }
};

const extractSkills = async (rawText) => {
  const commonSkills = [
    "javascript", "python", "java", "c++", "c#", "ruby", "go", "rust",
    "react", "angular", "vue", "node", "express", "django", "flask",
    "mongodb", "mysql", "postgresql", "sql", "redis", "docker", "kubernetes",
    "aws", "azure", "gcp", "git", "html", "css", "typescript", "rest", "api"
  ];

  const lowerText = rawText.toLowerCase();
  const listSkills = commonSkills.filter((skill) => lowerText.includes(skill));

  const topics = nlp(rawText).topics().out("array");
  const topicSkills = topics
    .map((topic) => topic.toLowerCase())
    .filter((topic) => commonSkills.includes(topic));

  const tokenizer = new natural.WordTokenizer();
  const tokens = tokenizer.tokenize(lowerText);
  const tokenSkills = commonSkills.filter((skill) => tokens.includes(skill));

  return Array.from(new Set([...listSkills, ...topicSkills, ...tokenSkills]));
};

const extractEducation = (rawText) => {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const educationKeywords = [
    "bachelor", "master", "phd", "b.tech", "m.tech", "b.sc", "m.sc",
    "mba", "b.e", "m.e", "university", "college", "institute",
  ];

  const matches = lines.filter((line) => {
    const lower = line.toLowerCase();
    return educationKeywords.some((keyword) => lower.includes(keyword));
  });

  return matches.slice(0, 5);
};

const extractExperience = (rawText) => {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const expKeywords = ["experience", "intern", "developer", "engineer", "lead", "manager"];
  const yearPattern = /\b(19|20)\d{2}\b/;

  const matches = lines.filter((line) => {
    const lower = line.toLowerCase();
    return expKeywords.some((keyword) => lower.includes(keyword)) || yearPattern.test(line);
  });

  return matches.slice(0, 7);
};

const inferRole = (rawText) => {
  const roles = [
    "software engineer",
    "frontend developer",
    "backend developer",
    "full stack developer",
    "data scientist",
    "data analyst",
    "product manager",
    "ui/ux designer",
    "devops engineer",
    "qa engineer",
  ];

  const lowerText = rawText.toLowerCase();
  const match = roles.find((role) => lowerText.includes(role));
  return match || null;
};

const normalizeText = (rawText) => {
  return rawText.replace(/\s+/g, " ").trim();
};

const safeUnlink = (filePath) => {
  if (!filePath) return;
  fs.unlink(filePath, (err) => {
    if (err) {
      console.warn("Failed to delete previous resume file:", err.message);
    }
  });
};

exports.uploadResumeService = async (userId, file) => {
  try {
    if (!userId || !file) {
      return {
        data: null,
        message: "Authentication required and file is required",
        statusCode: 401,
      };
    }

    const fileExtension = path.extname(file.originalname).toLowerCase().slice(1);
    if (!["pdf", "docx"].includes(fileExtension)) {
      return {
        data: null,
        message: "Invalid file type. Only PDF and DOCX are allowed",
        statusCode: 400,
      };
    }

    const fileMeta = {
      originalName: file.originalname,
      fileType: fileExtension,
      fileSize: file.size,
      uploadedAt: new Date(),
      storagePath: file.path,
    };

    const rawText = await extractTextFromFile(file.path, fileExtension);
    const normalizedText = normalizeText(rawText || "");
    if (!normalizedText) {
      return {
        data: null,
        message: "Could not extract text from file",
        statusCode: 400,
      };
    }

    const skills = await extractSkills(normalizedText);
    const education = extractEducation(rawText);
    const experience = extractExperience(rawText);

    const parsedData = {
      skills,
      education,
      experience,
    };

    const inferredRole = inferRole(rawText);

    const existingResume = await getResumeByUserId(userId);
    if (existingResume) {
      safeUnlink(existingResume?.fileMeta?.storagePath);
      await deleteResume(userId);
    }

    const resume = await createResume(userId, fileMeta, normalizedText, parsedData, inferredRole);

    if (!resume) {
      return {
        data: null,
        message: "Couldn't create resume",
        statusCode: 400,
      };
    }

    resume.processingStatus = "completed";
    await resume.save();

    return {
      data: {
        resumeId: resume._id,
        extractedSkills: resume.parsedData.skills,
        extractedRole: resume.inferredRole,
        education: resume.parsedData.education,
        experience: resume.parsedData.experience,
        fileMeta: resume.fileMeta,
      },
      message: "Resume uploaded successfully",
      statusCode: 201,
    };
  } catch (error) {
    console.error("Error in uploadResumeService:", error);
    return {
      data: null,
      message: "Server error: " + error.message,
      statusCode: 500,
    };
  }
};

exports.getResumeService = async (userId) => {
  try {
    if (!userId) {
      return {
        data: null,
        message: "User ID is required",
        statusCode: 400
      };
    }

    const resume = await getResumeByUserId(userId);

    if (!resume) {
      return {
        data: null,
        message: "Resume not found",
        statusCode: 404
      };
    }

    return {
      data: resume,
      message: "Resume fetched successfully",
      statusCode: 200
    };
  } catch (error) {
    console.error("Error in getResumeService:", error);
    return {
      data: null,
      message: "Server error",
      statusCode: 500
    };
  }
};
