const { createResume, getResumeByUserId, deleteResume } = require("../../repositories/resume");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const nlp = require("compromise");
const natural = require("natural");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

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

const parseAiJson = (text) => {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch (error) {
    console.warn("Failed to parse AI JSON:", error.message);
    return null;
  }
};

const enhanceWithAI = async (rawText, nlpResults) => {
  console.log("[AI] ==============================================");
  console.log("[AI] Starting AI enhancement process...");
  console.log("[AI] ----------------------------------------------");

  // Check if Gemini API key is configured
  if (!genAI) {
    console.log("[AI] ❌ GEMINI_API_KEY not found in environment");
    console.log("[AI] Skipping AI enhancement, using NLP results only");
    console.log("[AI] ==============================================");
    return null;
  }

  console.log("[AI] ✅ GEMINI_API_KEY found");
  console.log("[AI] 📋 NLP Results before AI enhancement:");
  console.log("[AI]    - Skills:", nlpResults.skills || []);
  console.log("[AI]    - Role:", nlpResults.inferredRole || "Not detected");
  console.log("[AI]    - Experience lines:", nlpResults.experience?.length || 0);

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    console.log("[AI] 🤖 Calling Gemini API...");
    const startTime = Date.now();

    const prompt = `
Analyze this resume and enhance the extracted data.
Current NLP extraction:
- Skills: ${(nlpResults.skills || []).join(", ")}
- Role: ${nlpResults.inferredRole || ""}
- Experience: ${(nlpResults.experience || []).join(" | ")}

Resume text:
${rawText.substring(0, 15000)}

Return JSON with:
{
  "enhancedSkills": [...additional skills AI finds],
  "refinedRole": "better job title if needed",
  "experienceSummary": "2 years at X as Y",
  "missingSkills": [...skills NLP missed],
  "confidence": 0.0-1.0
}
`;

    const result = await model.generateContent(prompt);
    const duration = Date.now() - startTime;
    console.log("[AI] ⏱️  Gemini API response time:", duration, "ms");

    const responseText = result.response?.text() || "";
    console.log("[AI] 📥 Raw AI response received");
    console.log("[AI] 🔍 Parsing AI JSON response...");

    const parsedResult = parseAiJson(responseText);

    if (parsedResult) {
      console.log("[AI] ✅ AI JSON parsed successfully!");
      console.log("[AI]    - Enhanced Skills:", parsedResult.enhancedSkills || []);
      console.log("[AI]    - Refined Role:", parsedResult.refinedRole || "No change");
      console.log("[AI]    - Missing Skills:", parsedResult.missingSkills || []);
      console.log("[AI]    - Confidence:", parsedResult.confidence || "N/A");
      console.log("[AI] ==============================================");
      return parsedResult;
    } else {
      console.log("[AI] ⚠️  AI response parsing failed - invalid JSON");
      console.log("[AI]    Raw response:", responseText.substring(0, 200) + "...");
      console.log("[AI] ==============================================");
      return null;
    }
  } catch (error) {
    console.log("[AI] ❌ AI enhancement failed!");
    console.log("[AI]    Error:", error.message);
    console.log("[AI]    Stack:", error.stack);
    console.log("[AI] ==============================================");
    return null;
  }
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

    console.log("\n[RESUME] =========================================");
    console.log("[RESUME] 📄 Resume Upload Started");
    console.log("[RESUME]    User ID:", userId);
    console.log("[RESUME]    File:", file.originalname, `(${fileExtension.toUpperCase()}, ${(file.size / 1024).toFixed(1)}KB)`);

    const rawText = await extractTextFromFile(file.path, fileExtension);
    console.log("[RESUME] 📝 Text extracted, length:", rawText.length, "chars");

    const normalizedText = normalizeText(rawText || "");
    if (!normalizedText) {
      console.log("[RESUME] ❌ Failed to extract text from file");
      return {
        data: null,
        message: "Could not extract text from file",
        statusCode: 400,
      };
    }

    console.log("[RESUME] 🔧 Running NLP extraction...");
    const skills = await extractSkills(normalizedText);
    const education = extractEducation(rawText);
    const experience = extractExperience(rawText);
    const inferredRole = inferRole(rawText);

    console.log("[RESUME]    NLP Skills found:", skills.length);
    console.log("[RESUME]    NLP Education lines:", education.length);
    console.log("[RESUME]    NLP Experience lines:", experience.length);
    console.log("[RESUME]    NLP Inferred role:", inferredRole || "None");

    const nlpResults = {
      skills,
      education,
      experience,
      inferredRole,
    };

    console.log("[RESUME] 🚀 Starting AI enhancement...");
    const aiResults = await enhanceWithAI(rawText, nlpResults);
    
    const parsedData = {
      ...nlpResults,
      ...(aiResults || {}),
      aiEnhanced: Boolean(aiResults),
    };

    if (aiResults) {
      console.log("[RESUME] ✅ AI Enhancement successful!");
      console.log("[RESUME]    Final role:", aiResults.refinedRole || inferredRole);
    } else {
      console.log("[RESUME] ℹ️  Using NLP results only (no AI enhancement)");
    }

    const finalInferredRole = aiResults?.refinedRole || inferredRole;

    console.log("[RESUME] 💾 Saving resume to database...");
    const existingResume = await getResumeByUserId(userId);
    if (existingResume) {
      console.log("[RESUME] 🗑️  Deleting old resume for user");
      safeUnlink(existingResume?.fileMeta?.storagePath);
      await deleteResume(userId);
    }

    const resume = await createResume(
      userId,
      fileMeta,
      normalizedText,
      parsedData,
      finalInferredRole
    );

    if (!resume) {
      console.log("[RESUME] ❌ Failed to create resume in database");
      return {
        data: null,
        message: "Couldn't create resume",
        statusCode: 400,
      };
    }

    resume.processingStatus = "completed";
    await resume.save();

    console.log("[RESUME] ✅ Resume uploaded successfully!");
    console.log("[RESUME]    Resume ID:", resume._id);
    console.log("[RESUME]    AI Enhanced:", parsedData.aiEnhanced ? "Yes" : "No");
    console.log("[RESUME] =========================================\n");

    return {
      data: {
        resumeId: resume._id,
        extractedSkills: resume.parsedData.skills,
        extractedRole: resume.inferredRole,
        education: resume.parsedData.education,
        experience: resume.parsedData.experience,
        aiEnhanced: resume.parsedData.aiEnhanced,
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
