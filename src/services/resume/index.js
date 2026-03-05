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

const SKILL_LABELS = {
  "javascript": "JavaScript",
  "typescript": "TypeScript",
  "python": "Python",
  "java": "Java",
  "c++": "C++",
  "c#": "C#",
  "go": "Go",
  "golang": "Go",
  "rust": "Rust",
  "php": "PHP",
  "ruby": "Ruby",
  "swift": "Swift",
  "kotlin": "Kotlin",
  "scala": "Scala",
  "dart": "Dart",
  "sql": "SQL",
  "bash": "Bash",
  "html": "HTML",
  "css": "CSS",
  "react": "React",
  "react native": "React Native",
  "redux": "Redux",
  "redux toolkit": "Redux Toolkit",
  "angular": "Angular",
  "vue": "Vue",
  "vuex": "Vuex",
  "svelte": "Svelte",
  "next.js": "Next.js",
  "nuxt": "Nuxt",
  "tailwind": "Tailwind CSS",
  "bootstrap": "Bootstrap",
  "material ui": "Material UI",
  "node.js": "Node.js",
  "express": "Express",
  "nestjs": "NestJS",
  "django": "Django",
  "flask": "Flask",
  "fastapi": "FastAPI",
  "spring": "Spring",
  "laravel": "Laravel",
  "rails": "Ruby on Rails",
  "mongodb": "MongoDB",
  "mysql": "MySQL",
  "postgresql": "PostgreSQL",
  "sqlite": "SQLite",
  "redis": "Redis",
  "elasticsearch": "Elasticsearch",
  "kafka": "Kafka",
  "rabbitmq": "RabbitMQ",
  "spark": "Apache Spark",
  "hadoop": "Hadoop",
  "airflow": "Airflow",
  "databricks": "Databricks",
  "snowflake": "Snowflake",
  "bigquery": "BigQuery",
  "redshift": "Redshift",
  "aws": "AWS",
  "azure": "Azure",
  "gcp": "GCP",
  "docker": "Docker",
  "kubernetes": "Kubernetes",
  "terraform": "Terraform",
  "ansible": "Ansible",
  "ci/cd": "CI/CD",
  "git": "Git",
  "github": "GitHub",
  "github actions": "GitHub Actions",
  "gitlab": "GitLab",
  "jenkins": "Jenkins",
  "jest": "Jest",
  "mocha": "Mocha",
  "cypress": "Cypress",
  "playwright": "Playwright",
  "api": "API",
  "rest": "REST",
  "graphql": "GraphQL",
  "grpc": "gRPC",
  "oauth": "OAuth",
  "jwt": "JWT",
  "microservices": "Microservices",
  "serverless": "Serverless",
  "aws lambda": "AWS Lambda",
  "linux": "Linux",
  "windows": "Windows",
  "macos": "macOS",
  "pandas": "Pandas",
  "numpy": "NumPy",
  "pytorch": "PyTorch",
  "tensorflow": "TensorFlow",
  "tableau": "Tableau",
  "power bi": "Power BI"
};

const SKILL_ALIASES = {
  "js": "javascript",
  "ts": "typescript",
  "node": "node.js",
  "nodejs": "node.js",
  "react.js": "react",
  "reactnative": "react native",
  "vue.js": "vue",
  "nextjs": "next.js",
  "ci cd": "ci/cd",
  "cicd": "ci/cd",
  "gcp": "gcp",
  "postgres": "postgresql",
  "postgre": "postgresql",
  "mongo": "mongodb",
  "redisdb": "redis",
  "mui": "material ui"
};

const SKILL_KEYWORDS_BY_LABEL = Object.entries(SKILL_LABELS).reduce((acc, [key, label]) => {
  const labelKey = label.toLowerCase();
  if (!acc[labelKey]) acc[labelKey] = new Set();
  acc[labelKey].add(key);
  return acc;
}, {});

Object.entries(SKILL_ALIASES).forEach(([alias, key]) => {
  const label = SKILL_LABELS[key];
  if (!label) return;
  const labelKey = label.toLowerCase();
  if (!SKILL_KEYWORDS_BY_LABEL[labelKey]) SKILL_KEYWORDS_BY_LABEL[labelKey] = new Set();
  SKILL_KEYWORDS_BY_LABEL[labelKey].add(alias);
});

const SECTION_STOP_HEADERS = [
  /education/i,
  /skills/i,
  /projects/i,
  /certifications?/i,
  /summary/i,
  /profile/i,
  /objective/i,
  /contact/i
];

const SKILL_SECTION_STOP_HEADERS = [
  /education/i,
  /projects/i,
  /certifications?/i,
  /summary/i,
  /profile/i,
  /objective/i,
  /contact/i,
  /experience/i
];

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

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const skillAppearsInText = (rawTextLower, label) => {
  if (!rawTextLower || !label) return false;
  const labelKey = label.toLowerCase();
  const keywords = SKILL_KEYWORDS_BY_LABEL[labelKey] || new Set([labelKey]);

  for (const keyword of keywords) {
    if (!keyword) continue;
    if (keyword.length <= 3) {
      const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
      if (regex.test(rawTextLower)) return true;
      continue;
    }
    if (rawTextLower.includes(keyword)) return true;
  }

  return false;
};

const dedupeList = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = (item || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const canonicalizeSkill = (token) => {
  if (!token) return null;
  const cleaned = token
    .replace(/^[\s\-*]+/, "")
    .replace(/\s+/g, " ")
    .replace(/^\w+:\s*/, "")
    .trim();
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();
  const alias = SKILL_ALIASES[lower];
  const key = alias || lower;
  if (SKILL_LABELS[key]) return SKILL_LABELS[key];
  return null;
};

const extractSectionLines = (rawText, headerPatterns, maxLines = 15, stopHeaders = SECTION_STOP_HEADERS) => {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const results = [];
  let inSection = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lower = line.toLowerCase();

    if (headerPatterns.some((pattern) => pattern.test(lower))) {
      inSection = true;
      const inline = line.split(":").slice(1).join(":").trim();
      if (inline) {
        results.push(inline);
      }
      continue;
    }

    if (inSection && stopHeaders.some((pattern) => pattern.test(lower))) {
      break;
    }

    if (inSection) {
      results.push(line);
      if (results.length >= maxLines) break;
    }
  }

  return results;
};

const splitSkillTokens = (line) => {
  if (!line) return [];
  const cleaned = line.replace(/skills?/i, "").replace(/technologies?/i, "");
  return cleaned
    .split(/[,\u2022|/;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
};

const extractSkills = async (rawText) => {
  const lowerText = rawText.toLowerCase();
  const found = [];

  // Detect known skills by keyword scan (including multi-word skills).
  Object.keys(SKILL_LABELS).forEach((key) => {
    if (key.includes(" ")) {
      if (lowerText.includes(key)) found.push(SKILL_LABELS[key]);
      return;
    }

    if (key.length <= 3) {
      const regex = new RegExp(`\\b${escapeRegex(key)}\\b`, "i");
      if (regex.test(lowerText)) found.push(SKILL_LABELS[key]);
      return;
    }

    if (lowerText.includes(key)) found.push(SKILL_LABELS[key]);
  });

  Object.keys(SKILL_ALIASES).forEach((alias) => {
    const canonicalKey = SKILL_ALIASES[alias];
    const label = SKILL_LABELS[canonicalKey];
    if (!label) return;

    if (alias.length <= 3) {
      const regex = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
      if (regex.test(lowerText)) found.push(label);
      return;
    }

    if (lowerText.includes(alias)) found.push(label);
  });

  // Skills section parsing.
  const skillSectionLines = extractSectionLines(rawText, [
    /skills/i,
    /technical skills/i,
    /technologies/i,
    /tech stack/i,
    /tools/i,
    /expertise/i
  ], 12, SKILL_SECTION_STOP_HEADERS);

  skillSectionLines.forEach((line) => {
    splitSkillTokens(line).forEach((token) => {
      const canonical = canonicalizeSkill(token);
      if (canonical) found.push(canonical);
    });
  });

  // NLP topics and tokens for additional hits.
  const topics = nlp(rawText).topics().out("array");
  topics.forEach((topic) => {
    const canonical = canonicalizeSkill(topic);
    if (canonical) found.push(canonical);
  });

  const tokenizer = new natural.WordTokenizer();
  const tokens = tokenizer.tokenize(lowerText);
  tokens.forEach((token) => {
    const canonical = canonicalizeSkill(token);
    if (canonical && SKILL_LABELS[(SKILL_ALIASES[token] || token)]) {
      found.push(canonical);
    }
  });

  return dedupeList(found);
};

const extractEducation = (rawText) => {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const educationKeywords = [
    "bachelor", "master", "phd", "b.tech", "m.tech", "b.sc", "m.sc",
    "mba", "b.e", "m.e", "university", "college", "institute", "degree"
  ];

  const sectionLines = extractSectionLines(rawText, [/education/i, /academics?/i, /qualifications?/i], 8);
  const combined = sectionLines.length ? sectionLines : lines;

  const matches = combined.filter((line) => {
    const lower = line.toLowerCase();
    return educationKeywords.some((keyword) => lower.includes(keyword));
  });

  return dedupeList(matches).slice(0, 6);
};

const extractExperience = (rawText) => {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sectionLines = extractSectionLines(rawText, [
    /experience/i,
    /work experience/i,
    /professional experience/i,
    /employment/i
  ], 18);

  const expKeywords = [
    "experience", "intern", "developer", "engineer", "lead", "manager",
    "designer", "analyst", "consultant", "architect", "director"
  ];

  const dateRangePattern = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b/i;
  const yearPattern = /\b(19|20)\d{2}\b/;
  const presentPattern = /\b(present|current)\b/i;
  const companyPattern = /\b(inc|llc|ltd|corp|company|technologies|solutions|systems|labs)\b/i;

  const sourceLines = sectionLines.length ? sectionLines : lines;
  const matches = sourceLines.filter((line) => {
    const lower = line.toLowerCase();
    return (
      expKeywords.some((keyword) => lower.includes(keyword)) ||
      dateRangePattern.test(line) ||
      yearPattern.test(line) ||
      presentPattern.test(line) ||
      companyPattern.test(line)
    );
  });

  return dedupeList(matches).slice(0, 10);
};

const inferRole = (rawText) => {
  const roles = [
    "software engineer",
    "frontend developer",
    "backend developer",
    "full stack developer",
    "full-stack developer",
    "frontend engineer",
    "backend engineer",
    "data engineer",
    "data scientist",
    "data analyst",
    "machine learning engineer",
    "ai engineer",
    "product manager",
    "ui/ux designer",
    "ux designer",
    "ui designer",
    "mobile developer",
    "android developer",
    "ios developer",
    "devops engineer",
    "qa engineer",
    "qa analyst",
  ];

  const lowerText = rawText.toLowerCase();
  const match = roles.find((role) => lowerText.includes(role));
  return match || null;
};

const normalizeText = (rawText) => {
  return rawText.replace(/\s+/g, " ").trim();
};

const mergeSkills = (baseSkills, extraSkills) => {
  const base = Array.isArray(baseSkills) ? baseSkills : [];
  const extra = Array.isArray(extraSkills) ? extraSkills : [];
  return dedupeList([...base, ...extra]);
};

const generateResumeFeedback = (rawText, parsedData) => {
  const feedback = {
    feedbackSummary: null,
    strengths: [],
    recommendations: [],
    issues: []
  };

  const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(rawText);
  const hasPhone = /(\+?\d[\d\s().-]{7,}\d)/.test(rawText);
  const hasLinkedIn = /linkedin\.com/i.test(rawText);
  const hasSummary = /(summary|profile|objective|about)/i.test(rawText);
  const hasMetrics = /(\d+%|\$\d+|\b\d+\s?(years?|yrs?|months?)\b|increased|reduced|improved|saved|grew|boosted|decreased)/i.test(rawText);
  const hasDates = /\b(19|20)\d{2}\b/.test(rawText);

  const skillsCount = parsedData?.skills?.length || 0;
  const expCount = parsedData?.experience?.length || 0;
  const eduCount = parsedData?.education?.length || 0;

  if (skillsCount >= 8) feedback.strengths.push(`Broad skills coverage detected (${skillsCount} skills).`);
  if (expCount >= 3) feedback.strengths.push(`Experience section has multiple entries (${expCount}).`);
  if (eduCount >= 1) feedback.strengths.push("Education section present.");
  if (hasMetrics) feedback.strengths.push("Includes quantified impact (numbers, % or outcomes).");

  if (!hasSummary) feedback.recommendations.push("Add a 2-3 line summary targeting the role you want.");
  if (!hasMetrics) feedback.recommendations.push("Quantify impact (%, $, time saved, scale, users).");
  if (skillsCount < 6) feedback.recommendations.push("Expand skills section with relevant tools and technologies.");
  if (expCount < 2) feedback.recommendations.push("Add more experience detail: role, dates, responsibilities, impact.");
  if (!hasLinkedIn) feedback.recommendations.push("Add a LinkedIn or portfolio link for credibility.");

  if (!hasEmail) feedback.issues.push("Missing email address.");
  if (!hasPhone) feedback.issues.push("Missing phone number.");
  if (!hasDates) feedback.issues.push("Missing dates for education or experience.");

  const summaryParts = [];
  if (skillsCount) summaryParts.push(`${skillsCount} skills detected`);
  if (expCount) summaryParts.push(`${expCount} experience entries`);
  if (eduCount) summaryParts.push(`${eduCount} education items`);
  if (summaryParts.length) {
    feedback.feedbackSummary = `Resume parsed: ${summaryParts.join(", ")}.`;
  }

  return feedback;
};

const mergeFeedback = (ruleFeedback, aiResults) => {
  if (!aiResults) return ruleFeedback;
  const merged = { ...ruleFeedback };

  if (aiResults.feedbackSummary) merged.feedbackSummary = aiResults.feedbackSummary;
  if (Array.isArray(aiResults.strengths) && aiResults.strengths.length) {
    merged.strengths = aiResults.strengths;
  }
  if (Array.isArray(aiResults.recommendations) && aiResults.recommendations.length) {
    merged.recommendations = aiResults.recommendations;
  }
  if (Array.isArray(aiResults.issues) && aiResults.issues.length) {
    merged.issues = aiResults.issues;
  }

  return merged;
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

const sanitizeAiResult = (result, rawText) => {
  if (!result || typeof result !== "object") return null;

  const toStringList = (value, limit = 16) => {
    if (!Array.isArray(value)) return [];
    return dedupeList(
      value.map((item) => String(item || "").trim()).filter(Boolean)
    ).slice(0, limit);
  };

  const rawTextLower = (rawText || "").toLowerCase();

  const toSkillList = (value, options = {}) => {
    const { requireInText = false, limit = 16 } = options;
    const normalized = toStringList(value, limit)
      .map((item) => canonicalizeSkill(item))
      .filter(Boolean);

    if (!requireInText) return dedupeList(normalized);
    return dedupeList(normalized).filter((skill) => skillAppearsInText(rawTextLower, skill));
  };

  const safe = {};
  safe.enhancedSkills = toSkillList(result.enhancedSkills, { requireInText: true, limit: 20 });
  safe.missingSkills = toSkillList(result.missingSkills, { requireInText: false, limit: 20 });
  safe.strengths = toStringList(result.strengths);
  safe.recommendations = toStringList(result.recommendations);
  safe.issues = toStringList(result.issues);

  if (typeof result.refinedRole === "string" && result.refinedRole.trim()) {
    safe.refinedRole = result.refinedRole.trim();
  }

  if (typeof result.experienceSummary === "string" && result.experienceSummary.trim()) {
    safe.experienceSummary = result.experienceSummary.trim();
  }

  if (typeof result.feedbackSummary === "string" && result.feedbackSummary.trim()) {
    safe.feedbackSummary = result.feedbackSummary.trim();
  }

  if (typeof result.confidence === "number" && Number.isFinite(result.confidence)) {
    safe.confidence = Math.max(0, Math.min(1, result.confidence));
  }

  return safe;
};

const enhanceWithAI = async (rawText, nlpResults) => {
  console.log("[AI] ==============================================");
  console.log("[AI] Starting AI enhancement process...");
  console.log("[AI] ----------------------------------------------");

  // Check if Gemini API key is configured
  if (!genAI) {
    console.log("[AI]  GEMINI_API_KEY not found in environment");
    console.log("[AI] Skipping AI enhancement, using NLP results only");
    console.log("[AI] ==============================================");
    return null;
  }

  console.log("[AI]  GEMINI_API_KEY found");
  console.log("[AI]  NLP Results before AI enhancement:");
  console.log("[AI]    - Skills:", nlpResults.skills || []);
  console.log("[AI]    - Role:", nlpResults.inferredRole || "Not detected");
  console.log("[AI]    - Experience lines:", nlpResults.experience?.length || 0);

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    console.log("[AI]  Calling Gemini API...");
    const startTime = Date.now();

    const prompt = `
Analyze this resume and enhance the extracted data.
Current NLP extraction:
- Skills: ${(nlpResults.skills || []).join(", ")}
- Role: ${nlpResults.inferredRole || ""}
- Experience: ${(nlpResults.experience || []).join(" | ")}

Resume text:
${rawText.substring(0, 15000)}

Rules:
- Only include enhancedSkills that are explicitly present in the resume text.
- missingSkills should be relevant to the role but not present in the resume text.
- Do not include generic items or non-skills. If unsure, return an empty array.
- Keep feedback concise and professional.

Return JSON with:
{
  "enhancedSkills": [...additional skills AI finds],
  "refinedRole": "better job title if needed",
  "experienceSummary": "2 years at X as Y",
  "missingSkills": [...skills NLP missed],
  "confidence": 0.0-1.0,
  "feedbackSummary": "2-3 sentence feedback summary",
  "strengths": ["..."],
  "recommendations": ["..."],
  "issues": ["..."]
}
Respond with JSON only (no markdown).
`;

    const result = await model.generateContent(prompt);
    const duration = Date.now() - startTime;
    console.log("[AI]   Gemini API response time:", duration, "ms");

    const responseText = result.response?.text() || "";
    console.log("[AI]  Raw AI response received");
    console.log("[AI]  Parsing AI JSON response...");

    const parsedResult = sanitizeAiResult(parseAiJson(responseText), rawText);

    if (parsedResult) {
      console.log("[AI]  AI JSON parsed successfully!");
      console.log("[AI]    - Enhanced Skills:", parsedResult.enhancedSkills || []);
      console.log("[AI]    - Refined Role:", parsedResult.refinedRole || "No change");
      console.log("[AI]    - Missing Skills:", parsedResult.missingSkills || []);
      console.log("[AI]    - Confidence:", parsedResult.confidence || "N/A");
      console.log("[AI] ==============================================");
      return parsedResult;
    } else {
      console.log("[AI]   AI response parsing failed - invalid JSON");
      console.log("[AI]    Raw response:", responseText.substring(0, 200) + "...");
      console.log("[AI] ==============================================");
      return null;
    }
  } catch (error) {
    console.log("[AI]  AI enhancement failed!");
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
    console.log("[RESUME]  Resume Upload Started");
    console.log("[RESUME]    User ID:", userId);
    console.log("[RESUME]    File:", file.originalname, `(${fileExtension.toUpperCase()}, ${(file.size / 1024).toFixed(1)}KB)`);

    const rawText = await extractTextFromFile(file.path, fileExtension);
    console.log("[RESUME]  Text extracted, length:", rawText.length, "chars");

    const normalizedText = normalizeText(rawText || "");
    if (!normalizedText) {
      console.log("[RESUME]  Failed to extract text from file");
      return {
        data: null,
        message: "Could not extract text from file",
        statusCode: 400,
      };
    }

    console.log("[RESUME]  Running NLP extraction...");
    const skills = await extractSkills(rawText);
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

    console.log("[RESUME]  Starting AI enhancement...");
    const aiResults = await enhanceWithAI(rawText, nlpResults);
    const mergedSkills = mergeSkills(skills, aiResults?.enhancedSkills);
    const ruleFeedback = generateResumeFeedback(rawText, {
      skills: mergedSkills,
      education,
      experience
    });
    const feedbackFromAi = mergeFeedback(ruleFeedback, aiResults);

    const parsedData = {
      skills: mergedSkills,
      education,
      experience,
      inferredRole,
      ...(aiResults || {}),
      ...feedbackFromAi,
      aiEnhanced: Boolean(aiResults),
    };

    if (aiResults) {
      console.log("[RESUME]  AI Enhancement successful!");
      console.log("[RESUME]    Final role:", aiResults.refinedRole || inferredRole);
    } else {
      console.log("[RESUME]   Using NLP results only (no AI enhancement)");
    }

    const finalInferredRole = aiResults?.refinedRole || inferredRole;

    console.log("[RESUME]  Saving resume to database...");
    const existingResume = await getResumeByUserId(userId);
    if (existingResume) {
      console.log("[RESUME]   Deleting old resume for user");
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
      console.log("[RESUME]  Failed to create resume in database");
      return {
        data: null,
        message: "Couldn't create resume",
        statusCode: 400,
      };
    }

    resume.processingStatus = "completed";
    await resume.save();

    console.log("[RESUME]  Resume uploaded successfully!");
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

