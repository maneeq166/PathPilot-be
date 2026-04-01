const { createResume, getResumeByUserId, deleteResume } = require("../../repositories/resume");
const { getApprovedFeedbackByUserId } = require("../../repositories/skillFeedback");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const nlp = require("compromise");
const natural = require("natural");
const { resolveAiEnabled, isAiConfigured, runGeminiPrompt } = require("./aiExtractor");

const SKILL_LABELS = {
  "javascript": "JavaScript",
  "typescript": "TypeScript",
  "python": "Python",
  "java": "Java",
  "php": "PHP",
  "scala": "Scala",
  "sql": "SQL",
  "html": "HTML",
  "css": "CSS",
  "react": "React",
  "next.js": "Next.js",
  "node.js": "Node.js",
  "express": "Express",
  "postgresql": "PostgreSQL",
  "mongodb": "MongoDB",
  "docker": "Docker",
  "git": "Git",
  "github": "GitHub",
  "rest": "REST",
  "oauth": "OAuth",
  "jwt": "JWT",
  "communication": "Communication",
  "leadership": "Leadership",
  "problem solving": "Problem Solving",
  "teamwork": "Teamwork",
  "collaboration": "Collaboration"
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
  "oauth2": "oauth",
  "rest api": "rest"
};

const SKILL_CATEGORY_MAP = {
  languages: ["TypeScript","Python","Java","PHP","Scala","SQL","JavaScript","HTML","CSS"],
  frameworks: ["React","Next.js","Node.js","Express"],
  databases: ["PostgreSQL","MongoDB"],
  tools: ["Docker","Git","GitHub"],
  concepts: ["REST","OAuth","JWT"],
  softSkills: ["Communication","Leadership","Problem Solving","Teamwork","Collaboration"]
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

const SKILL_CATEGORY_BY_LABEL = Object.entries(SKILL_CATEGORY_MAP).reduce((acc, [category, labels]) => {
  labels.forEach((label) => {
    acc[label.toLowerCase()] = category;
  });
  return acc;
}, {});

const SKILL_CANONICAL_BY_KEY = Object.values(SKILL_CATEGORY_MAP)
  .flat()
  .reduce((acc, label) => {
    acc[label.toLowerCase()] = label;
    return acc;
  }, {});

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

const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ["pdf", "docx"];
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];

const validateUploadedResume = (file) => {
  if (!file) return { ok: false, message: "No file uploaded" };
  const extension = path.extname(file.originalname).toLowerCase().slice(1);
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return { ok: false, message: "Invalid file type. Only PDF and DOCX are allowed" };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, message: "File too large. Maximum size is 1MB" };
  }
  if (file.mimetype && !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return { ok: false, message: "Invalid file type. Only PDF and DOCX are allowed" };
  }
  return { ok: true, extension };
};

const normalizeStructure = (rawText) => {
  if (!rawText) return "";
  const lines = rawText.replace(/\r/g, "").split("\n");
  const normalized = lines.map((line) => {
    let value = line.replace(/\u00A0/g, " ");
    value = value.replace(/([a-z])([A-Z])/g, "$1 $2");
    value = value.replace(/([A-Za-z])(\d)/g, "$1 $2");
    value = value.replace(/(\d)([A-Za-z])/g, "$1 $2");
    value = value.replace(/[ \t]+/g, " ").trimEnd();
    if (/^[•●▪◆\-\*]\s*/.test(value)) {
      value = value.replace(/^[•●▪◆\-\*]\s*/, "• ");
    }
    return value;
  });
  return normalized.join("\n").trim();
};

const splitLinesPreserve = (text) => text.replace(/\r/g, "").split("\n");

const SECTION_HEADERS = {
  summary: [/^summary\b/i, /^profile\b/i, /^objective\b/i, /^about\b/i],
  education: [/^education\b/i, /^academics?\b/i, /^qualifications?\b/i],
  experience: [/^experience\b/i, /^work experience\b/i, /^employment\b/i],
  projects: [/^projects?\b/i],
  skills: [/^skills?\b/i, /^technical skills\b/i, /^tech stack\b/i, /^tools\b/i],
  certifications: [/^certifications?\b/i, /^certificates?\b/i],
  achievements: [/^achievements?\b/i, /^awards?\b/i]
};

const detectSections = (lines) => {
  const sections = {
    summary: [],
    education: [],
    experience: [],
    projects: [],
    skills: [],
    certifications: [],
    achievements: [],
    other: []
  };
  let current = "other";

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current !== "other") sections[current].push("");
      else sections.other.push("");
      return;
    }

    const headerKey = Object.keys(SECTION_HEADERS).find((key) =>
      SECTION_HEADERS[key].some((pattern) => pattern.test(trimmed))
    );

    if (headerKey) {
      current = headerKey;
      const inline = trimmed.split(":").slice(1).join(":").trim();
      if (inline) sections[current].push(inline);
      return;
    }

    sections[current].push(trimmed);
  });

  return sections;
};

const extractContactInfo = (rawText) => {
  const emailMatch = rawText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = rawText.match(/(\+?\d[\d\s().-]{8,}\d)/);
  const linkedinMatch = rawText.match(/https?:\/\/(www\.)?linkedin\.com\/[^\s)]+/i);
  const githubMatch = rawText.match(/https?:\/\/(www\.)?github\.com\/[^\s)]+/i);

  return {
    email: emailMatch ? emailMatch[0] : "",
    phone: phoneMatch ? phoneMatch[0] : "",
    linkedin: linkedinMatch ? linkedinMatch[0] : "",
    github: githubMatch ? githubMatch[0] : ""
  };
};

const extractCandidateName = (lines) => {
  for (const line of lines) {
    const trimmed = (line || "").trim();
    if (!trimmed) continue;
    if (trimmed.length < 3) continue;
    const lower = trimmed.toLowerCase();
    if (/@/.test(trimmed)) continue;
    if (/linkedin\.com|github\.com|http/.test(lower)) continue;
    if (Object.keys(SECTION_HEADERS).some((key) =>
      SECTION_HEADERS[key].some((pattern) => pattern.test(trimmed))
    )) continue;
    return trimmed;
  }
  return "";
};

const looksLikeProjectHeader = (line) => {
  if (!line) return false;
  if (/https?:\/\//i.test(line)) return true;
  if (/\b(project|app|platform|system|tool)\b/i.test(line)) return true;
  if (/ - | \| /i.test(line)) return true;
  return false;
};

const parseProjectBlock = (block) => {
  const lines = splitLinesPreserve(block).filter(Boolean);
  if (!lines.length) return null;
  const first = lines[0];
  const urlMatch = block.match(/https?:\/\/[^\s)]+/i);
  const title = first.split("|")[0].split(" - ")[0].trim();
  const descriptionLines = lines.slice(1);
  const stack = dedupeList(
    lines
      .flatMap((line) => splitSkillTokens(line))
      .map((token) => canonicalizeSkill(token))
      .filter(Boolean)
  );

  return {
    name: title,
    description: descriptionLines.join("\n").trim(),
    stack,
    link: urlMatch ? urlMatch[0] : ""
  };
};

const extractProjects = (projectsLines) => {
  if (!projectsLines || projectsLines.length === 0) return [];
  const blocks = buildBlocks(projectsLines, { headerDetector: looksLikeProjectHeader });
  const parsed = blocks
    .map(parseProjectBlock)
    .filter((entry) => entry && entry.name && entry.name.length > 2);
  return parsed;
};

const DOMAIN_KEYWORDS = {
  tech: ["javascript", "react", "node", "api", "software", "backend", "frontend", "cloud", "devops"],
  marketing: ["seo", "marketing", "campaign", "brand", "content", "social", "growth"],
  finance: ["finance", "accounting", "audit", "investment", "bank", "ledger", "tax"],
  hr: ["recruitment", "talent", "hr", "people", "onboarding"],
  sales: ["sales", "pipeline", "crm", "lead", "deal", "quota"],
  design: ["design", "ux", "ui", "figma", "prototype", "visual"],
  operations: ["operations", "logistics", "supply", "process", "inventory"]
};

const detectDomain = (rawText, skills) => {
  const lower = (rawText || "").toLowerCase();
  const scores = {};
  Object.keys(DOMAIN_KEYWORDS).forEach((domain) => {
    scores[domain] = DOMAIN_KEYWORDS[domain].reduce((acc, keyword) => {
      if (lower.includes(keyword)) return acc + 1;
      return acc;
    }, 0);
  });

  const skillList = flattenSkills(skills).map((s) => s.toLowerCase());
  skillList.forEach((skill) => {
    Object.keys(DOMAIN_KEYWORDS).forEach((domain) => {
      if (DOMAIN_KEYWORDS[domain].some((keyword) => skill.includes(keyword))) {
        scores[domain] += 2;
      }
    });
  });

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] === 0) return "other";
  return best[0];
};

const inferRoleFromSkills = (skills) => {
  const categories = categorizeSkills(skills);
  const hasReact = categories.frameworks.some((s) => /react/i.test(s));
  const hasNode = categories.frameworks.some((s) => /node/i.test(s)) || categories.tools.some((s) => /node/i.test(s));
  const hasMongo = categories.databases.some((s) => /mongo/i.test(s));
  const hasSql = categories.databases.some((s) => /sql|postgres/i.test(s));
  const hasHtmlCss = categories.languages.some((s) => /html|css/i.test(s));

  if (hasReact && hasNode && hasMongo) return "Full Stack Developer";
  if (hasNode && (hasMongo || hasSql)) return "Backend Developer";
  if (hasReact && hasHtmlCss) return "Frontend Developer";
  return "";
};

const isGarbageText = (value) => {
  const text = (value || "").toString().trim();
  if (!text) return true;
  if (text.length < 3) return true;
  if (/^\W+$/.test(text)) return true;
  if (/^[a-z]{1,3}$/i.test(text)) return true;
  return false;
};

const validateEntries = (entries, rules = {}) => {
  const issues = [];
  const valid = [];

  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const fields = rules.required || [];
    const hasRequired = fields.every((field) => !isGarbageText(entry[field]));
    if (!hasRequired) {
      issues.push(`Incomplete ${rules.label || "entry"} removed`);
      return;
    }
    valid.push(entry);
  });

  return { valid, issues };
};

const isBulletLine = (line) => /^•\s+/.test(line);

const looksLikeDateRange = (text) => {
  return /\b(19|20)\d{2}\b\s*(?:-|–|—|to)\s*(present|current|now|(19|20)\d{2})/i.test(text) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b/i.test(text);
};

const looksLikeEducationHeader = (line) => {
  return DEGREE_KEYWORD_PATTERN.test(line) || EDUCATION_INSTITUTION_KEYWORDS.some((p) => p.test(line)) || looksLikeDateRange(line);
};

const looksLikeExperienceHeader = (line) => {
  return looksLikeDateRange(line) || /@| at | \| /i.test(line);
};

const ROLE_KEYWORDS = [
  "intern",
  "internship",
  "developer",
  "engineer",
  "freelance",
  "backend",
  "frontend",
  "full stack",
  "software",
  "analyst",
  "designer",
  "manager"
];

const isGarbageLine = (line) => {
  const text = (line || "").trim();
  if (!text) return true;
  if (text.length < 4) return true;
  if (/^[a-z]+$/i.test(text) && text.length <= 5) return true;
  return false;
};

const isFreelanceBlock = (line) => /freelance/i.test(line || "");

const isExperienceStartLine = (line) => {
  const lower = (line || "").toLowerCase();
  if (!lower) return false;
  const hasRole = ROLE_KEYWORDS.some((keyword) => lower.includes(keyword));
  const hasYear = /\b(19|20)\d{2}\b/.test(lower);
  return (hasRole && hasYear) || isFreelanceBlock(lower);
};


const DEGREE_KEYWORDS = [
  "diploma",
  "b.tech",
  "b.e",
  "b.sc",
  "bsc",
  "m.tech",
  "mba",
  "senior secondary",
  "class x",
  "class xii",
  "master",
  "bachelor"
];

const isEducationStartLine = (line) => {
  const lower = (line || "").toLowerCase();
  if (!lower) return false;
  if (DEGREE_KEYWORD_PATTERN.test(lower)) return true;
  if (DEGREE_KEYWORDS.some((keyword) => lower.includes(keyword))) return true;
  return false;
};

const isStandaloneInstitutionLine = (line) => {
  if (!line) return false;
  const trimmed = line.trim();
  if (trimmed.length >= 60) return false;
  if (/\b(19|20)\d{2}\b/.test(trimmed)) return false;
  if (isEducationStartLine(trimmed)) return false;
  return true;
};

const buildEducationBlocks = (lines) => {
  const cleaned = (lines || []).map((line) => (line || "").trim()).filter(Boolean);
  const blocks = [];
  let current = "";
  let pendingPrefix = "";

  cleaned.forEach((line) => {
    const isStart = isEducationStartLine(line);
    const isStandalone = isStandaloneInstitutionLine(line);

    if (isStandalone && !isStart) {
      pendingPrefix = pendingPrefix ? `${pendingPrefix} ${line}` : line;
      return;
    }

    if (isStart) {
      if (current) blocks.push(current.trim());
      current = [pendingPrefix, line].filter(Boolean).join(" ");
      pendingPrefix = "";
      return;
    }

    current = current ? `${current} ${line}` : [pendingPrefix, line].filter(Boolean).join(" ");
    pendingPrefix = "";
  });

  if (current) blocks.push(current.trim());
  return blocks;
};

const buildBlocks = (lines, { headerDetector }) => {
  const blocks = [];
  let current = [];

  lines.forEach((line) => {
    const trimmed = (line || "").trim();
    if (!trimmed) {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
      return;
    }

    if (!isBulletLine(trimmed) && headerDetector && headerDetector(trimmed) && current.length) {
      blocks.push(current);
      current = [];
    }

    current.push(trimmed);
  });

  if (current.length) blocks.push(current);
  return blocks.map((block) => block.join("\n"));
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
  return SKILL_CANONICAL_BY_KEY[key] || null;
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

const extractSkillsStrict = (rawText) => {
  const lowerText = (rawText || "").toLowerCase();
  const found = [];

  const addSkill = (label) => {
    if (!label) return;
    if (!skillAppearsInText(lowerText, label)) return;
    found.push(label);
  };

  Object.keys(SKILL_LABELS).forEach((key) => {
    const label = SKILL_LABELS[key];
    if (!label) return;
    if (key.includes(" ")) {
      if (lowerText.includes(key)) found.push(label);
      return;
    }
    if (key.length <= 3) {
      const regex = new RegExp(`\\b${escapeRegex(key)}\\b`, "i");
      if (regex.test(lowerText)) found.push(label);
      return;
    }
    if (lowerText.includes(key)) found.push(label);
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
      if (canonical) addSkill(canonical);
    });
  });

  const topics = nlp(rawText).topics().out("array");
  topics.forEach((topic) => {
    const canonical = canonicalizeSkill(topic);
    if (canonical) addSkill(canonical);
  });

  const tokenizer = new natural.WordTokenizer();
  const tokens = tokenizer.tokenize(lowerText);
  tokens.forEach((token) => {
    const canonical = canonicalizeSkill(token);
    if (canonical) addSkill(canonical);
  });

  const categorized = {
    languages: [],
    frameworks: [],
    databases: [],
    tools: [],
    concepts: [],
    softSkills: []
  };

  dedupeList(found).forEach((label) => {
    const key = label.toLowerCase();
    const category = SKILL_CATEGORY_BY_LABEL[key];
    if (!category) return;
    categorized[category].push(label);
  });

  return categorized;
};

const DEGREE_PATTERNS = [
  { pattern: /ph\.?d\.?/i, degree: "Ph.D" },
  { pattern: /master'?s?\s+degree|m\.tech|m\.sc\.?|mba|m\.e\.|m\.a\.?/i, degree: "Master's" },
  { pattern: /b\.?tech|b\.?e\.?|b\.?sc\.?|b\.?a\.?/i, degree: "Bachelor's" },
  { pattern: /diploma/i, degree: "Diploma" },
  { pattern: /senior\s+secondary|class\s+xii|xii|hsc/i, degree: "Senior Secondary" },
  { pattern: /secondary|class\s+x|xth/i, degree: "Secondary" }
];

const FIELD_PATTERNS = [
  /engineering|computer\s+science|information\s+technology|it\b/gi,
  /business\s+administration|management|commerce|economics/gi,
  /mathematics|physics|chemistry|statistics/gi,
  /arts?|law|medicine|health/gi
];

const YEAR_PATTERN = /\b(19|20)\d{2}\b/g;
const YEAR_RANGE_PATTERN = /\b(19|20)\d{2}\s*(?:-|–|—|to)\s*((19|20)\d{2}|present|current|now)\b/i;
const TWO_DIGIT_YEAR = /\b(\d{2})\b/g;

const EDUCATION_INSTITUTION_KEYWORDS = [
  /university/i,
  /college/i,
  /institute/i,
  /school/i,
  /academy/i,
  /polytechnic/i,
  /vidyalaya/i,
  /board/i,
  /campus/i,
  /technic/i,
  /technology/i
];

const EDUCATION_HEADER_PATTERN = /education|academics?|qualifications?|schooling/i;
const EDUCATION_STOP_PATTERN = /skills?|projects?|certifications?|summary|profile|objective|experience|work experience|employment|contact/i;

const DEGREE_KEYWORD_PATTERN = /ph\.?d\.?|doctorate|master'?s?|m\.?tech|m\.?e\.?|mba|m\.?sc\.?|bachelor'?s?|b\.?tech|b\.?e\.?|b\.?sc\.?|b\.?a\.?|associate|diploma|senior\s+secondary|higher\s+secondary|secondary\s+school|high\s+school|class\s*xii|\bxii\b|class\s*x\b|\bxth\b/i;

const cleanBrokenText = (text) => {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
};

const extractDegree = (line) => {
  for (const { pattern, degree } of DEGREE_PATTERNS) {
    if (pattern.test(line)) return degree;
  }
  return null;
};

const extractField = (line) => {
  for (const pattern of FIELD_PATTERNS) {
    const match = line.match(pattern);
    if (match) return match[0];
  }
  return null;
};

const extractYears = (line) => {
  const rangeMatch = line.match(YEAR_RANGE_PATTERN);
  if (rangeMatch) {
    let startYear = rangeMatch[1];
    let endYear = rangeMatch[2];
    
    if (startYear && startYear.length === 2) startYear = "20" + startYear;
    if (endYear && endYear.length === 2 && !isNaN(endYear)) endYear = "20" + endYear;
    if (endYear?.toLowerCase() === "present" || endYear?.toLowerCase() === "current") {
      endYear = "Present";
    }
    return { startYear, endYear };
  }
  
  const years = line.match(YEAR_PATTERN);
  if (years && years.length >= 2) {
    return { startYear: years[0], endYear: years[1] };
  }
  if (years && years.length === 1) {
    return { startYear: years[0], endYear: null };
  }
  
  const twoDigitYears = line.match(TWO_DIGIT_YEAR);
  if (twoDigitYears && twoDigitYears.length >= 2) {
    return { 
      startYear: "20" + twoDigitYears[0], 
      endYear: "20" + twoDigitYears[1] 
    };
  }
  
  return { startYear: null, endYear: null };
};

const extractInstitution = (line, degree) => {
  let cleaned = cleanBrokenText(line);
  
  const degreeMatch = cleaned.match(/ph\.?d\.?|master'?s?|b\.?tech|b\.?e\.?|diploma|senior\s+secondary|secondary|class\s+xii|xii|class\s+x|xth/i);
  if (degreeMatch) {
    cleaned = cleaned.replace(degreeMatch[0], "").trim();
  }
  
  cleaned = cleaned.replace(YEAR_RANGE_PATTERN, "").replace(YEAR_PATTERN, "").trim();
  
  const separators = [",", "-", "|", "â€¢"];
  for (const sep of separators) {
    const parts = cleaned.split(sep);
    if (parts.length > 1) {
      const candidate = parts.find(p => p.length > 3);
      if (candidate) return candidate.trim();
    }
  }
  
  return cleaned.length > 3 ? cleaned : null;
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

const fixMergedWords = (text) => {
  let result = text;
  
  result = result.replace(/([a-z])([A-Z])/g, "$1, $2");
  
  result = result.replace(/([a-zA-Z])(Jamia|Delhi|Mumbai|Bangalore|Chennai|Kolkata|Hyderabad|Pune|Jaipur|Noida|Gurgaon|Ghaziabad|Faridabad|Lucknow|Kanpur|Nagpur|Indore|Bhopal|Patna|Vadodara|Coimbatore|Madras|Bombay|Calcutta)([A-Z])/g, "$1$2, $3");
  
  result = result.replace(/(\d{4})\s*-\s*(\d{4})/g, "$1 - $2");
  
  result = result.replace(/\s+/g, " ").trim();
  
  return result;
};

const splitOnDegreePattern = (text) => {
  const degreeSplits = [
    /(?=\bPh\.?D\b)/i,
    /(?=\bMaster'?s?\b)/i,
    /(?=\bM\.?Tech\b)/i,
    /(?=\bM\.?E\.?\b)/i,
    /(?=\bM\.?Sc\.?\b)/i,
    /(?=\bMBA\b)/i,
    /(?=\bBachelor'?s?\b)/i,
    /(?=\bB\.?Tech\b)/i,
    /(?=\bB\.?E\.?\b)/i,
    /(?=\bB\.?Sc\.?\b)/i,
    /(?=\bDiploma\b)/i,
    /(?=\bSenior\s+Secondary\b)/i,
    /(?=\bHigher\s+Secondary\b)/i,
    /(?=\bClass\s+XII\b)/i,
    /(?=\bClass\s+X\b)/i,
    /(?=\bSecondary\b)/i,
    /(?=\bHigh\s+School\b)/i
  ];
  
  let parts = [text];
  for (const pattern of degreeSplits) {
    const newParts = [];
    for (const part of parts) {
      const splits = part.split(pattern);
      newParts.push(...splits);
    }
    parts = newParts;
  }
  
  return parts.filter(p => p.trim().length > 5);
};

const extractInstitutionFromText = (text, degree) => {
  let cleaned = fixMergedWords(text);
  
  cleaned = cleaned.replace(DEGREE_KEYWORD_PATTERN, "").trim();
  
  cleaned = cleaned.replace(YEAR_RANGE_PATTERN, "").replace(YEAR_PATTERN, "").trim();
  
  const locationPatterns = [
    /(.*?)\s*,\s*(Delhi|Mumbai|Bangalore|Chennai|Kolkata|Hyderabad|Pune|Jaipur|Noida|Gurgaon|Ghaziabad|Faridabad|Lucknow|Kanpur|Nagpur|Indore|Bhopal|Patna|Vadodara|Coimbatore|Madras|Bombay|Calcutta|New\s*Delhi)(?:\s*,|\s*$)/gi,
    /(.*?)\s*,\s*(India|Usa|UK|Canada|Australia|Germany|France|Japan|China|Singapore|Uae|Saudi)(?:\s*,|\s*$)/gi
  ];
  
  for (const pattern of locationPatterns) {
    const match = cleaned.match(pattern);
    if (match && match[1]) {
      cleaned = match[1].trim();
      break;
    }
  }
  
  cleaned = cleaned.replace(/^[,\s]+|[,\s]+$/g, "");
  
  const brokenFragments = ["diploma", "bachelor", "master", "degree", "year", "pass", "completed", "percentage", "cgpa", "gpa", "aggregate", "grade"];
  for (const frag of brokenFragments) {
    if (cleaned.toLowerCase().endsWith(frag)) {
      cleaned = cleaned.substring(0, cleaned.length - frag.length).trim();
    }
  }
  
  if (cleaned.length > 3 && !/^\d+$/.test(cleaned)) {
    return cleaned;
  }
  
  return "";
};

const extractFieldFromText = (text) => {
  const fieldPatterns = [
    { pattern: /computer\s*(?:science|engineering|technology)/i, field: "Computer Science" },
    { pattern: /information\s*technology|it\b/i, field: "Information Technology" },
    { pattern: /electronics\s*(?:and\s*)?communication/i, field: "Electronics & Communication" },
    { pattern: /electronics\s*(?:and\s*)?electrical/i, field: "Electronics & Electrical" },
    { pattern: /electrical\s*(?:and\s*)?electronics/i, field: "Electronics & Electrical" },
    { pattern: /mechanical\s*engineering/i, field: "Mechanical Engineering" },
    { pattern: /civil\s*engineering/i, field: "Civil Engineering" },
    { pattern: /business\s*administration/i, field: "Business Administration" },
    { pattern: /business\s*management/i, field: "Business Management" },
    { pattern: /computer\s*application/i, field: "Computer Applications" },
    { pattern: /artificial\s*intelligence|machine\s*learning|data\s*science/i, field: "AI/ML" },
    { pattern: /data\s*science/i, field: "Data Science" },
    { pattern: /cyber\s*security/i, field: "Cyber Security" },
    { pattern: /cloud\s*computing/i, field: "Cloud Computing" },
    { pattern: /software\s*engineering/i, field: "Software Engineering" },
    { pattern: /commerce/i, field: "Commerce" },
    { pattern: /economics/i, field: "Economics" },
    { pattern: /mathematics|statistics/i, field: "Mathematics/Statistics" },
    { pattern: /physics|chemistry/i, field: "Physics/Chemistry" },
    { pattern: /arts?\s*(?:and\s*)?science/i, field: "Arts & Science" },
    { pattern: /science\s*\(?pcm?\)?/i, field: "Science (PCM)" },
    { pattern: /science\s*\(?pcmb?\)?/i, field: "Science (PCMB)" },
    { pattern: /science\s*\(?commerce\)?/i, field: "Science/Commerce" },
    { pattern: /commerce\s*\(?math\)?/i, field: "Commerce with Math" }
  ];
  
  for (const { pattern, field } of fieldPatterns) {
    if (pattern.test(text)) return field;
  }
  
  return "";
};

const extractYearsFromText = (text) => {
  const rangeMatch = text.match(YEAR_RANGE_PATTERN);
  if (rangeMatch) {
    let startYear = rangeMatch[1];
    let endYear = rangeMatch[2];
    
    if (startYear && startYear.length === 2) startYear = "20" + startYear;
    if (endYear && endYear.length === 2 && !isNaN(endYear)) endYear = "20" + endYear;
    if (endYear?.toLowerCase() === "present" || endYear?.toLowerCase() === "current") {
      endYear = "Present";
    }
    return { startYear, endYear };
  }
  
  const years = text.match(YEAR_PATTERN);
  if (years && years.length >= 2) {
    return { startYear: years[0], endYear: years[1] };
  }
  if (years && years.length === 1) {
    return { startYear: "", endYear: years[0] };
  }
  
  return { startYear: "", endYear: "" };
};

const parseDegree = (text) => {
  const degreePatterns = [
    { pattern: /\bPh\.?D\.?\b/i, degree: "Ph.D" },
    { pattern: /\bMaster'?s?\s+degree\b/i, degree: "Master's" },
    { pattern: /\bM\.?Tech\b/i, degree: "M.Tech" },
    { pattern: /\bM\.?E\.?\b/i, degree: "M.E" },
    { pattern: /\bM\.?Sc\.?\b/i, degree: "M.Sc" },
    { pattern: /\bMBA\b/i, degree: "MBA" },
    { pattern: /\bBachelor'?s?\s+degree\b/i, degree: "Bachelor's" },
    { pattern: /\bB\.?Tech\b/i, degree: "B.Tech" },
    { pattern: /\bB\.?E\.?\b/i, degree: "B.E" },
    { pattern: /\bB\.?Sc\.?\b/i, degree: "B.Sc" },
    { pattern: /\bDiploma\b/i, degree: "Diploma" },
    { pattern: /\bSenior\s+Secondary\b/i, degree: "Senior Secondary" },
    { pattern: /\bHigher\s+Secondary\b/i, degree: "Higher Secondary" },
    { pattern: /\bClass\s+XII\b/i, degree: "Class XII" },
    { pattern: /\bClass\s+X\b/i, degree: "Class X" },
    { pattern: /\bHigh\s+School\b/i, degree: "High School" },
    { pattern: /\bSecondary\s+School\b/i, degree: "Secondary School" }
  ];
  
  for (const { pattern, degree } of degreePatterns) {
    if (pattern.test(text)) return degree;
  }
  
  return "";
};

const extractSingleEducationEntry = (text) => {
  const cleaned = fixMergedWords(text);
  
  const degree = parseDegree(cleaned);
  if (!degree) return null;
  
  const field = extractFieldFromText(cleaned);
  const { startYear, endYear } = extractYearsFromText(cleaned);
  const institution = extractInstitutionFromText(cleaned, degree);
  
  if (!institution && !startYear && !endYear && !field) {
    return null;
  }
  
  return {
    degree,
    field,
    institution,
    startYear,
    endYear
  };
};

const SIMPLE_DEGREE_MAP = {
  "diploma": "Diploma",
  "b.tech": "B.Tech",
  "b.e": "B.E",
  "b.e.": "B.E",
  "b.sc": "B.Sc",
  "bachelor": "Bachelor's",
  "master": "Master's",
  "m.tech": "M.Tech",
  "m.e": "M.E",
  "m.sc": "M.Sc",
  "mba": "MBA",
  "ph.d": "Ph.D",
  "phd": "Ph.D",
  "class x": "Class X",
  "class xii": "Class XII",
  "class xii.": "Class XII",
  "senior secondary": "Senior Secondary",
  "higher secondary": "Higher Secondary",
  "secondary": "Secondary",
  "high school": "High School"
};

const extractStructuredEducation = (rawText, partialEducation = []) => {
  const rawLines = rawText.split(/\r?\n/);
  
  let educationStartIndex = -1;
  let educationEndIndex = rawLines.length;
  
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].toLowerCase();
    if (/^(education|academics|qualifications|schooling)$/i.test(line.trim()) ||
        /^education\s*[:|-]*/i.test(line) ||
        /^\*{3,}/.test(line)) {
      educationStartIndex = i;
      break;
    }
  }
  
  if (educationStartIndex >= 0) {
    for (let i = educationStartIndex + 1; i < rawLines.length; i++) {
      const line = rawLines[i].toLowerCase();
      if (/^(experience|projects?|skills?|certifications?|summary|profile)$/i.test(line.trim()) ||
          /^\*{3,}/.test(line)) {
        educationEndIndex = i;
        break;
      }
    }
  }
  
  const educationLines = [];
  if (educationStartIndex >= 0) {
    for (let i = educationStartIndex; i < educationEndIndex; i++) {
      const line = rawLines[i].trim();
      if (line.length > 3) {
        educationLines.push(line);
      }
    }
  }
  
  if (educationLines.length === 0) {
    for (const line of rawLines) {
      const lower = line.toLowerCase();
      if (/diploma|b\.tech|b\.e|b\.sc|master|m\.tech|class\s*xii|class\s*x|senior\s+secondary|higher\s+secondary|university|college|institute/i.test(lower)) {
        educationLines.push(line.trim());
      }
    }
  }
  
  const entries = [];
  const seenDegrees = new Set();
  
  for (const line of educationLines) {
    if (entries.length >= 4) break;
    
    const lower = line.toLowerCase();
    let degree = "";
    
    for (const [key, value] of Object.entries(SIMPLE_DEGREE_MAP)) {
      if (lower.includes(key)) {
        degree = value;
        break;
      }
    }
    
    if (!degree) continue;
    
    if (seenDegrees.has(degree.toLowerCase())) continue;
    seenDegrees.add(degree.toLowerCase());
    
    let institution = "";
    const institutionPatterns = [
      /(?:university|college|institute|school|academy|polytechnic|board|vidyalaya)[^,\n]*/i,
      /^[A-Z][^,\n]+(?:University|College|Institute|School|Academy)/i
    ];
    
    for (const pattern of institutionPatterns) {
      const match = line.match(pattern);
      if (match) {
        institution = match[0].trim();
        break;
      }
    }
    
    if (!institution) {
      const parts = line.split(/[,-|]/);
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length > 4 && !/^(diploma|b\.tech|bachelor|master|class|secondary|pass|completed|year|%)/i.test(trimmed)) {
          institution = trimmed;
          break;
        }
      }
    }
    
    let startYear = "";
    let endYear = "";
    const yearMatches = line.match(/\b(19|20)\d{2}\b/g);
    if (yearMatches && yearMatches.length >= 2) {
      startYear = yearMatches[0];
      endYear = yearMatches[1];
    } else if (yearMatches && yearMatches.length === 1) {
      endYear = yearMatches[0];
    }
    
    entries.push({
      degree,
      field: "",
      institution: institution || "",
      startYear,
      endYear
    });
  }
  
  return entries;
};

const repairEducationWithAI = async (rawText, currentEntries) => {
  if (!isAiConfigured()) return null;
  
  try {
    const prompt = `
You are a resume parser. Extract ALL education entries from this resume.

Input raw text:
${rawText.substring(0, 15000)}

CRITICAL RULES:
1. Extract EVERY education entry - Diploma, Bachelor's, Master's, PhD, Class X, Class XII, etc.
2. DO NOT hallucinate - only use text that is EXPLICITLY in the resume
3. Fix broken text: "Jamia Millia IslamiaNew Delhi" → "Jamia Millia Islamia, New Delhi"
4. Handle multiple entries on same line - split them properly
5. For single year: if it's the END of education, put in endYear, leave startYear empty
6. Each entry MUST have: degree and institution (if available in text)

Output ONLY JSON array - no markdown:
[
  {"degree": "B.Tech", "field": "Computer Science", "institution": "Jamia Millia Islamia, New Delhi", "startYear": "2020", "endYear": "2024"},
  {"degree": "Diploma", "field": "Computer Engineering", "institution": "Polytechnic College", "startYear": "", "endYear": "2020"},
  {"degree": "Class XII", "field": "Science", "institution": "School Name", "startYear": "", "endYear": "2019"},
  {"degree": "Class X", "field": "", "institution": "School Name", "startYear": "", "endYear": "2017"}
]
Respond with JSON only (no markdown).
`;
    const parsed = await runGeminiPrompt({
      label: "EducationRepair:Full",
      prompt,
      parser: parseAiJson
    });
    
    if (Array.isArray(parsed)) {
      const validEntries = parsed.filter(e => {
        return e && (e.degree || e.institution);
      }).map(e => ({
        degree: e.degree || "",
        field: e.field || "",
        institution: e.institution || "",
        startYear: e.startYear || "",
        endYear: e.endYear || ""
      }));
      
      return validEntries.length > 0 ? validEntries : null;
    }
    return null;
  } catch (error) {
    console.warn("[Education Repair] AI failed:", error.message);
    return null;
  }
};

const needsEducationRepair = (entries) => {
  return false;
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

const ROLE_START_KEYWORDS = [
  "intern", "trainee", "freelance", "contract",
  "developer", "engineer", "designer", "analyst", "manager",
  "lead", "architect", "consultant", "associate", "specialist",
  "coordinator", "executive", "supervisor", "head", "director"
];

const COMPANY_INDICATORS = [
  /inc\.?$/i, /llc\.?$/i, /ltd\.?$/i, /corp\.?$/i, /pvt\.?$/i,
  /company/i, /technologies/i, /solutions/i, /systems/i, /labs?/i,
  /software/i, /services/i, /digital/i, /tech/i, /innovations/i,
  /ventures/i, /group/i, /holdings/i
];

const YEAR_RANGE_EXTRACT = /\b(19|20)\d{2}\s*[-–—to]+\s*((19|20)\d{2}|present|current|now)\b/i;
const SINGLE_YEAR_EXTRACT = /\b(19|20)\d{2}\b/g;
const MONTH_YEAR_EXTRACT = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s,-]*(19|20)\d{2}\b/i;

const fixBrokenExperienceText = (text) => {
  let result = text;
  
  result = result.replace(/([a-z])([A-Z])/g, "$1 $2");
  
  result = result.replace(/(intern|developer|engineer|designer|manager|analyst|consultant|lead)s+/gi, "$1 ");
  
  result = result.replace(/(\d{4})(intern|developer|engineer|designer)/gi, "$1 $2");
  
  result = result.replace(/(jun|jul|aug|sep|sept|oct|nov|dec|jan|feb|mar|apr|may)\s*(\d{4})/gi, "$1 $2");
  
  result = result.replace(/\s*[-–—]{1,2}\s*/g, " - ");
  
  result = result.replace(/•/g, " | ");
  result = result.replace(/◦/g, " | ");
  result = result.replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, " | ");
  
  result = result.replace(/\s+/g, " ").trim();
  
  return result;
};

const isLikelyRoleLine = (line) => {
  const lower = line.toLowerCase();
  const hasRoleKeyword = ROLE_START_KEYWORDS.some(kw => lower.includes(kw));
  const hasYear = YEAR_RANGE_EXTRACT.test(line) || MONTH_YEAR_EXTRACT.test(line);
  return hasRoleKeyword || (hasYear && lower.length < 100);
};

const extractDuration = (blockText) => {
  const rangeMatch = blockText.match(YEAR_RANGE_EXTRACT);
  if (rangeMatch) {
    return rangeMatch[0].replace(/\s*[-–—to]+\s*/i, " - ");
  }
  
  const monthMatches = blockText.match(MONTH_YEAR_EXTRACT);
  if (monthMatches && monthMatches.length >= 2) {
    return `${monthMatches[0]} - ${monthMatches[monthMatches.length - 1]}`;
  }
  
  const years = blockText.match(SINGLE_YEAR_EXTRACT);
  if (years && years.length >= 2) {
    return `${years[0]} - ${years[1]}`;
  }
  if (years && years.length === 1) {
    return years[0];
  }
  
  return "";
};

const extractRoughRole = (blockText) => {
  const cleaned = fixBrokenExperienceText(blockText);
  
  const rolePatterns = [
    /^(intern|trainee|freelance|contract)\b/i,
    /\b(freelance\s+)?(backend|frontend|full[- ]?stack|fullstack|web|mobile|software|data|ml|ai|devops|cloud)\s+(developer|engineer)/i,
    /\b(developer|engineer|designer|analyst|manager|lead|architect|consultant|associate|specialist)\b/i
  ];
  
  for (const pattern of rolePatterns) {
    const match = cleaned.match(pattern);
    if (match) return match[0];
  }
  
  return "";
};

const buildExperienceBlocks = (rawInput) => {
  const lines = Array.isArray(rawInput)
    ? rawInput.map((line) => (line || "").toString())
    : typeof rawInput === "string"
      ? rawInput.split(/\r?\n/)
      : [];

  const normalizedLines = lines
    .map((line) => (line || "").trim())
    .filter(Boolean)
    .filter((line) => !isGarbageLine(line));

  const rawText = typeof rawInput === "string"
    ? rawInput
    : normalizedLines.join("\n");

  const sectionLines = extractSectionLines(rawText, [
    /experience/i, /work experience/i, /professional experience/i, /employment/i
  ], 30)
    .map((line) => (line || "").trim())
    .filter(Boolean)
    .filter((line) => !isGarbageLine(line));

  const sourceLines = sectionLines.length ? sectionLines : normalizedLines.filter((line) => {
    const lower = line.toLowerCase();
    return ROLE_START_KEYWORDS.some((kw) => lower.includes(kw)) ||
      YEAR_RANGE_EXTRACT.test(line) ||
      MONTH_YEAR_EXTRACT.test(line) ||
      COMPANY_INDICATORS.some((ci) => ci.test(line));
  });

  const blocks = [];
  let currentBlock = [];
  let lastWasRole = false;

  for (const line of sourceLines) {
    const isRole = isLikelyRoleLine(line);

    if (isRole && currentBlock.length > 0 && lastWasRole) {
      blocks.push(currentBlock.join(" | "));
      currentBlock = [];
    }

    if (line.length > 5 && !/^[=-_*#]{3,}$/.test(line)) {
      currentBlock.push(fixBrokenExperienceText(line));
      lastWasRole = isRole;
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join(" | "));
  }

  const mergedBlocks = [];
  for (const block of blocks) {
    if (mergedBlocks.length === 0) {
      mergedBlocks.push(block);
    } else {
      const lastBlock = mergedBlocks[mergedBlocks.length - 1];
      if (lastBlock.length + block.length < 300 && !isLikelyRoleLine(block)) {
        mergedBlocks[mergedBlocks.length - 1] = lastBlock + " | " + block;
      } else {
        mergedBlocks.push(block);
      }
    }
  }

  return mergedBlocks.slice(0, 8);
};

const repairExperienceWithAI = async (rawBlock, partial) => {
  if (!isAiConfigured()) return null;
  
  try {
    const prompt = `
You are a resume parser. Extract ONE experience entry from this resume block.

Raw block:
${rawBlock.substring(0, 2500)}

CRITICAL RULES:
1. DO NOT hallucinate - only use text EXPLICITLY in the block
2. Fix broken text: "InternJune2025" → "Intern, June 2025" | "CITJamia" → "CIT Jamia"
3. Extract clean role: "Intern", "Backend Developer", "Freelance Engineer" - NOT with dates
4. Extract FULL company name - look for: Inc, LLC, Ltd, Company, Technologies, Solutions, University, College, Institute
5. Duration: extract month/year ranges like "June 2025 - July 2025" or "2023 - Present"
6. Description: 1-2 sentence summary of what was done - combine bullet points
7. If no valid company found, return empty strings for company

Output ONLY JSON - no markdown:
{"role": "Intern", "company": "FTK - CIT Jamia Millia Islamia", "duration": "June 2025 - July 2025", "description": "Developed a secure full-stack blogging platform with authentication and role-based access control."}
Respond with JSON only (no markdown).
`;
    const parsed = await runGeminiPrompt({
      label: "ExperienceRepair:Block",
      prompt,
      parser: parseAiJson
    });
    
    if (parsed && parsed.role && parsed.company) {
      return {
        role: parsed.role || "",
        company: parsed.company || "",
        duration: parsed.duration || "",
        description: parsed.description || ""
      };
    }
    return null;
  } catch (error) {
    console.warn("[Experience Repair] AI failed:", error.message);
    return null;
  }
};

const validateExperienceEntry = (entry) => {
  if (!entry || typeof entry !== "object") return false;
  
  const role = (entry.role || "").trim();
  const company = (entry.company || "").trim();
  
  if (!role || role.length < 2) return false;
  if (!company || company.length < 2) return false;
  
  const brokenFragments = ["tern", "nope", "none", "unknown", "n/a", "-", "nil", "null", "na", "nope", "yet", "working", "currently"];
  const lowerRole = role.toLowerCase();
  const lowerCompany = company.toLowerCase();
  
  if (brokenFragments.some(f => lowerRole === f)) return false;
  if (brokenFragments.some(f => lowerCompany === f)) return false;
  if (lowerRole.length < 3 && !/^(intern|trainee)$/i.test(lowerRole)) return false;
  if (/^\d+$/.test(company)) return false;
  
  return true;
};

const isValidDuration = (duration) => {
  if (!duration || typeof duration !== "string") return false;
  const clean = duration.replace(/\s/g, "");
  if (clean.length < 4) return false;
  if (/^\d+$/.test(clean)) return false;
  if (YEAR_RANGE_EXTRACT.test(duration) || MONTH_YEAR_EXTRACT.test(duration)) return true;
  if (/\d{4}/.test(duration)) return true;
  return false;
};

const extractStructuredExperience = async (rawText) => {
  const blocks = buildExperienceBlocks(rawText);
  
  if (blocks.length === 0) {
    return [];
  }
  
  const entries = [];
  const seenRoles = new Set();
  
  for (const block of blocks) {
    const partial = {
      role: extractRoughRole(block),
      duration: extractDuration(block)
    };
    
    const aiResult = await repairExperienceWithAI(block, partial);
    
    if (aiResult && validateExperienceEntry(aiResult)) {
      const roleKey = aiResult.role.toLowerCase().substring(0, 20);
      if (!seenRoles.has(roleKey)) {
        seenRoles.add(roleKey);
        entries.push(aiResult);
      }
    } else if (partial.role && partial.role.length > 2 && isValidDuration(partial.duration)) {
      const roleKey = partial.role.toLowerCase().substring(0, 20);
      if (!seenRoles.has(roleKey)) {
        seenRoles.add(roleKey);
        entries.push({
          role: partial.role,
          company: "",
          duration: partial.duration,
          description: ""
        });
      }
    }
  }
  
  return entries.slice(0, 6);
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

const normalizeForMatch = (value) => (value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const valueAppearsInText = (value, text) => {
  if (!value || !text) return false;
  const needle = normalizeForMatch(value);
  const haystack = normalizeForMatch(text);
  if (!needle) return false;
  return haystack.includes(needle);
};

const hasRealWords = (value) => {
  if (!value) return false;
  const cleaned = value.replace(/[^A-Za-z]/g, "");
  return cleaned.length >= 2;
};

const extractDurationFromText = (text) => {
  if (!text) return "";
  const rangePattern = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\s*(?:-|–|—|to)\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b/i;
  const yearRangePattern = /\b(19|20)\d{2}\b\s*(?:-|–|—|to)\s*(present|current|now|(19|20)\d{2})/i;
  const monthRange = text.match(rangePattern);
  if (monthRange) return monthRange[0];
  const yearRange = text.match(yearRangePattern);
  if (yearRange) return yearRange[0];
  const years = text.match(YEAR_PATTERN);
  if (years && years.length >= 2) return `${years[0]} - ${years[1]}`;
  return "";
};

const stripDurationFromLine = (line) => {
  if (!line) return "";
  return line
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\s*(?:-|–|—|to)\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b/ig, "")
    .replace(/\b(19|20)\d{2}\b\s*(?:-|–|—|to)\s*(present|current|now|(19|20)\d{2})/ig, "")
    .replace(/\b(19|20)\d{2}\b/ig, "")
    .replace(/\s+/g, " ")
    .trim();
};

const extractRoleAndCompany = (headerLine) => {
  if (!headerLine) return { role: "", company: "" };
  let line = stripDurationFromLine(headerLine);
  if (!line) line = headerLine;

  let role = "";
  let company = "";

  if (line.includes("@")) {
    const parts = line.split("@").map((p) => p.trim()).filter(Boolean);
    role = parts[0] || "";
    company = parts[1] || "";
    return { role, company };
  }

  const pipeParts = line.split("|").map((p) => p.trim()).filter(Boolean);
  if (pipeParts.length > 1) {
    role = pipeParts[0] || "";
    company = pipeParts[1] || "";
    return { role, company };
  }

  const dashParts = line.split(" - ").map((p) => p.trim()).filter(Boolean);
  if (dashParts.length > 1) {
    role = dashParts[0] || "";
    company = dashParts[1] || "";
    return { role, company };
  }

  const commaParts = line.split(",").map((p) => p.trim()).filter(Boolean);
  if (commaParts.length > 1) {
    role = commaParts[0] || "";
    company = commaParts[1] || "";
    return { role, company };
  }

  return { role: line.trim(), company: "" };
};

const buildEducationEntries = (blocks) => {
  return blocks.map((block) => {
    const combined = block.replace(/\n/g, " ");
    const degree = extractDegree(combined) || "";
    const field = extractFieldFromText(combined) || extractField(combined) || "";
    const years = extractYearsFromText(combined);
    const institution = extractInstitutionFromText(combined, degree) || extractInstitution(combined, degree) || "";

    return {
      degree: degree || "",
      field: field || "",
      institution: institution || "",
      startYear: years?.startYear || "",
      endYear: years?.endYear || ""
    };
  });
};

const buildExperienceEntries = (blocks) => {
  return blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const headerLine = lines.find((line) => !isBulletLine(line)) || lines[0] || "";
    const bullets = lines.filter((line) => isBulletLine(line)).map((line) => line.replace(/^•\s+/, ""));
    const duration = extractDurationFromText(block);
    const { role, company } = extractRoleAndCompany(headerLine);
    const description = bullets.length ? bullets.join(" • ") : lines.slice(1).join(" ");

    return {
      role: role || "",
      company: company || "",
      duration: duration || "",
      description: description || ""
    };
  });
};

const removeBrokenFragments = (value) => {
  if (!value) return "";
  const cleaned = value.replace(/\s+/g, " ").trim();
  const hasYearLike = /\b(19|20)\d{2}\b/.test(cleaned);
  if (!hasRealWords(cleaned) && !hasYearLike) return "";
  if (/^[\W_]+$/.test(cleaned)) return "";
  if (cleaned.length <= 2) return "";
  return cleaned;
};

const sanitizeEducationEntry = (entry) => ({
  degree: removeBrokenFragments(entry.degree),
  field: removeBrokenFragments(entry.field),
  institution: removeBrokenFragments(entry.institution),
  startYear: removeBrokenFragments(entry.startYear),
  endYear: removeBrokenFragments(entry.endYear)
});

const sanitizeExperienceEntry = (entry) => ({
  role: removeBrokenFragments(entry.role),
  company: removeBrokenFragments(entry.company),
  duration: removeBrokenFragments(entry.duration),
  description: removeBrokenFragments(entry.description)
});

const isValidEducationEntry = (entry) => {
  if (!entry) return false;
  return Boolean(entry.degree || entry.institution);
};

const isValidExperienceEntry = (entry) => {
  if (!entry) return false;
  return Boolean(entry.role && entry.company && entry.duration);
};

const needsEducationEntryRepair = (entry) => {
  if (!entry) return false;
  return !(entry.degree && entry.institution);
};

const needsExperienceRepair = (entry) => {
  if (!entry) return false;
  return !(entry.role && entry.company && entry.duration);
};

const sanitizeEducationRepair = (result, blockText) => {
  if (!result || typeof result !== "object") return null;
  const safe = {};
  if (result.degree && (DEGREE_KEYWORD_PATTERN.test(blockText) || valueAppearsInText(result.degree, blockText))) {
    safe.degree = result.degree;
  }
  if (result.field && valueAppearsInText(result.field, blockText)) safe.field = result.field;
  if (result.institution && valueAppearsInText(result.institution, blockText)) safe.institution = result.institution;

  if (result.startYear && valueAppearsInText(result.startYear, blockText)) safe.startYear = result.startYear;
  if (result.endYear && valueAppearsInText(result.endYear, blockText)) safe.endYear = result.endYear;
  return safe;
};

const sanitizeExperienceRepair = (result, blockText) => {
  if (!result || typeof result !== "object") return null;
  const safe = {};
  if (result.role && valueAppearsInText(result.role, blockText)) safe.role = result.role;
  if (result.company && valueAppearsInText(result.company, blockText)) safe.company = result.company;
  if (result.duration) {
    const years = result.duration.match(YEAR_PATTERN) || [];
    const yearsPresent = years.every((year) => blockText.includes(year));
    if (yearsPresent || valueAppearsInText(result.duration, blockText)) safe.duration = result.duration;
  }
  if (result.description) {
    const summaryTokens = normalizeForMatch(result.description)
      .split(" ")
      .filter((word) => word.length > 3);
    const blockNormalized = normalizeForMatch(blockText);
    const summaryLooksGrounded = summaryTokens.length
      ? summaryTokens.every((token) => blockNormalized.includes(token))
      : valueAppearsInText(result.description, blockText);
    if (summaryLooksGrounded) safe.description = result.description;
  }
  return safe;
};

const repairEducationBlocksWithAI = async (blocks, entries) => {
  if (!isAiConfigured()) return entries;
  const repaired = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const blockText = blocks[i] || "";
    if (!needsEducationEntryRepair(entry)) {
      repaired.push(entry);
      continue;
    }

    const prompt = `
You are repairing a single education block from a resume.
Block:
${blockText}

Extract ONLY what is present in the block. Do not invent.
Return JSON:
{
  "degree": "",
  "field": "",
  "institution": "",
  "startYear": "",
  "endYear": ""
}
Respond with JSON only.
`;

    try {
      const parsed = sanitizeEducationRepair(
        await runGeminiPrompt({
          label: "EducationRepair:Block",
          prompt,
          parser: parseAiJson
        }),
        blockText
      ) || {};
      repaired.push({ ...entry, ...parsed });
    } catch (error) {
      console.warn("[AI Repair] Education repair failed:", error.message);
      repaired.push(entry);
    }
  }

  return repaired;
};

const repairExperienceBlocksWithAI = async (blocks, entries) => {
  if (!isAiConfigured()) return entries;
  const repaired = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const blockText = blocks[i] || "";
    if (!needsExperienceRepair(entry)) {
      repaired.push(entry);
      continue;
    }

    const prompt = `
You are repairing a single experience block from a resume.
Block:
${blockText}

Extract ONLY what is present in the block. Do not invent.
Return JSON:
{
  "role": "",
  "company": "",
  "duration": "",
  "description": ""
}
Respond with JSON only.
`;

    try {
      const parsed = sanitizeExperienceRepair(
        await runGeminiPrompt({
          label: "ExperienceRepair:Block",
          prompt,
          parser: parseAiJson
        }),
        blockText
      ) || {};
      repaired.push({ ...entry, ...parsed });
    } catch (error) {
      console.warn("[AI Repair] Experience repair failed:", error.message);
      repaired.push(entry);
    }
  }

  return repaired;
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
  const match = text.match(/\{[\s\S]*\}/) || text.match(/\[[\s\S]*\]/);
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
  safe.shortTermAdvice = toStringList(result.shortTermAdvice);
  safe.longTermAdvice = toStringList(result.longTermAdvice);
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

  if (!isAiConfigured()) {
    console.log("[AI]  No AI API key found in environment");
    console.log("[AI] Skipping AI enhancement, using deterministic extraction only");
    console.log("[AI] ==============================================");
    return null;
  }

  console.log("[AI]  AI provider configured");
  console.log("[AI]  NLP Results before AI enhancement:");
  console.log("[AI]    - Skills:", nlpResults.skills || []);
  console.log("[AI]    - Role:", nlpResults.inferredRole || "Not detected");
  console.log("[AI]    - Experience lines:", nlpResults.experience?.length || 0);

  try {
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
  "shortTermAdvice": ["3-4 practical steps"],
  "longTermAdvice": ["3-4 career growth steps"],
  "confidence": 0.0-1.0,
  "feedbackSummary": "2-3 sentence feedback summary",
  "strengths": ["..."],
  "recommendations": ["..."],
  "issues": ["..."]
}
Respond with JSON only (no markdown).
`;

    const parsedResult = sanitizeAiResult(
      await runGeminiPrompt({
        label: "ResumeEnhance",
        prompt,
        parser: parseAiJson
      }),
      rawText
    );
    const duration = Date.now() - startTime;
    console.log("[AI]   Gemini API response time:", duration, "ms");

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

const flattenSkills = (skills) => {
  if (!skills) return [];
  if (Array.isArray(skills)) return skills;
  return [
    ...(skills.languages || []),
    ...(skills.frameworks || []),
    ...(skills.databases || []),
    ...(skills.tools || []),
    ...(skills.concepts || []),
    ...(skills.softSkills || [])
  ];
};

const applySkillFeedback = (skills, feedbackItems) => {
  if (!feedbackItems || feedbackItems.length === 0) return skills;

  const categorized = categorizeSkills(skills);

  const addToCategory = (skill) => {
    const clean = (skill || "").toString().trim();
    if (!clean) return;
    const canonical = canonicalizeSkill(clean) || clean;
    const category = SKILL_CATEGORY_BY_LABEL[canonical.toLowerCase()] || "tools";
    if (!categorized[category]) categorized[category] = [];
    const exists = categorized[category].some(
      (item) => item.toLowerCase() === canonical.toLowerCase()
    );
    if (!exists) categorized[category].push(canonical);
  };

  const removeFromCategories = (skill) => {
    const clean = (skill || "").toString().trim().toLowerCase();
    if (!clean) return;
    Object.keys(categorized).forEach((category) => {
      categorized[category] = (categorized[category] || []).filter(
        (item) => item.toLowerCase() !== clean
      );
    });
  };

  feedbackItems.forEach((item) => {
    if (item?.status !== "approved") return;
    const type = item.feedbackType;
    if (type === "remove_skill") {
      removeFromCategories(item.skillName);
      return;
    }
    if (type === "correct_skill") {
      removeFromCategories(item.skillName);
      addToCategory(item.correctedSkillName);
      return;
    }
    if (type === "confirm_skill" || type === "add_skill") {
      addToCategory(item.skillName);
    }
  });

  Object.keys(categorized).forEach((category) => {
    categorized[category] = dedupeList(categorized[category] || []);
  });

  return categorized;
};

const buildRecommendations = (role, skills, experience) => {
  const categorizedSkills = skills || {
    languages: [],
    frameworks: [],
    databases: [],
    tools: [],
    concepts: [],
    softSkills: []
  };
  const advice = generateRuleBasedAdvice(role, categorizedSkills, experience || []);
  return {
    shortTermAdvice: advice.shortTermAdvice || [],
    longTermAdvice: advice.longTermAdvice || [],
    missingSkills: []
  };
};

exports.uploadResumeService = async (userId, file, options = {}) => {
  let tempFilePath = null;
  try {
    if (!userId || !file) {
      return {
        data: null,
        message: "Authentication required and file is required",
        statusCode: 401,
      };
    }

    let validation = validateUploadedResume(file);
    if (!validation.ok) {
      return {
        data: null,
        message: validation.message,
        statusCode: 400
      };
    }

    const fileExtension = validation.extension;
    tempFilePath = file.path;

    const fileMeta = {
      originalName: file.originalname,
      fileType: fileExtension,
      fileSize: file.size,
      uploadedAt: new Date(),
      storagePath: null,
    };

    console.log("\n[RESUME] =========================================");
    console.log("[RESUME]  Resume Upload Started");
    console.log("[RESUME]    User ID:", userId);
    console.log("[RESUME]    File:", file.originalname, `(${fileExtension.toUpperCase()}, ${(file.size / 1024).toFixed(1)}KB)`);

    const rawText = await extractTextFromFile(file.path, fileExtension);
    console.log("[RESUME]  Text extracted, length:", rawText.length, "chars");

    const normalizedText = normalizeStructure(rawText || "");
    if (!normalizedText) {
      console.log("[RESUME]  Failed to extract text from file");
      return {
        data: null,
        message: "Could not extract text from file",
        statusCode: 400,
      };
    }

    const aiEnabled = resolveAiEnabled(options?.aiEnabled);
    console.log("[RESUME]  Normalizing structure and detecting sections...");
    const lines = splitLinesPreserve(normalizedText);
    const sections = detectSections(lines);
    const contact = extractContactInfo(normalizedText);
    const name = extractCandidateName(lines);

    const educationSource = sections.education.length ? sections.education : lines;
    const experienceSource = sections.experience.length ? sections.experience : lines;
    const projectsSource = sections.projects.length ? sections.projects : [];

    console.log("[RESUME]  Building blocks...");
    const educationBlocks = buildEducationBlocks(educationSource);
    const experienceBlocks = buildExperienceBlocks(experienceSource);

    console.log("[RESUME]  Running strict extraction...");
    const skills = extractSkillsStrict(normalizedText);
    const approvedFeedback = await getApprovedFeedbackByUserId(userId);
    const adjustedSkills = applySkillFeedback(skills, approvedFeedback);
    let educationEntries = buildEducationEntries(educationBlocks);
    let experienceEntries = buildExperienceEntries(experienceBlocks);
    let projectEntries = extractProjects(projectsSource);

    console.log("[RESUME]  Running AI repair if needed...");
    if (aiEnabled && educationEntries.some((entry) => !entry?.institution || !entry?.degree)) {
      educationEntries = await repairEducationBlocksWithAI(educationBlocks, educationEntries);
    }
    if (aiEnabled && experienceEntries.some((entry) => !entry?.role || !entry?.company)) {
      experienceEntries = await repairExperienceBlocksWithAI(experienceBlocks, experienceEntries);
    }

    const validatedEducation = educationEntries
      .map(sanitizeEducationEntry)
      .filter(isValidEducationEntry);

    const validatedExperience = experienceEntries
      .map(sanitizeExperienceEntry)
      .filter(isValidExperienceEntry);

    const validatedProjectsResult = validateEntries(projectEntries, {
      label: "project",
      required: ["name"]
    });

    const inferredRole = inferRole(rawText) || inferRoleFromSkills(adjustedSkills);
    const domain = detectDomain(normalizedText, adjustedSkills);

    let aiInsights = null;
    if (aiEnabled && isAiConfigured()) {
      aiInsights = await enhanceWithAI(normalizedText, {
        skills: flattenSkills(adjustedSkills),
        inferredRole,
        experience: validatedExperience.map((entry) => entry?.role).filter(Boolean)
      });
    }

    let recommendations = buildRecommendations(inferredRole, adjustedSkills, validatedExperience);
    if (aiEnabled && aiInsights) {
      recommendations = {
        shortTermAdvice: aiInsights.shortTermAdvice?.length
          ? aiInsights.shortTermAdvice
          : recommendations.shortTermAdvice,
        longTermAdvice: aiInsights.longTermAdvice?.length
          ? aiInsights.longTermAdvice
          : recommendations.longTermAdvice,
        missingSkills: aiInsights.missingSkills?.length
          ? aiInsights.missingSkills
          : recommendations.missingSkills
      };
    }

    const issues = [
      ...(validatedEducation.length ? [] : ["No valid education entries found"]),
      ...(validatedExperience.length ? [] : ["No valid experience entries found"]),
      ...validatedProjectsResult.issues
    ].filter(Boolean);

    validation = {
      status: issues.length ? "partial" : "success",
      issues
    };

    const parsedData = {
      rawText: normalizedText,
      name,
      contact,
      skills: adjustedSkills,
      education: validatedEducation,
      experience: validatedExperience,
      projects: validatedProjectsResult.valid,
      domain,
      recommendations,
      aiEnhanced: Boolean(aiInsights),
      enhancedSkills: aiInsights?.enhancedSkills || [],
      missingSkills: aiInsights?.missingSkills || [],
      experienceSummary: aiInsights?.experienceSummary || "",
      confidence: typeof aiInsights?.confidence === "number" ? aiInsights.confidence : null,
      feedbackSummary: aiInsights?.feedbackSummary || "",
      strengths: aiInsights?.strengths || [],
      issues: aiInsights?.issues || [],
      validation
    };

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
      parsedData,
      inferredRole
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
    console.log("[RESUME] =========================================\n");

    return {
      data: {
        resumeId: resume._id,
        name: resume.parsedData.name,
        contact: resume.parsedData.contact,
        extractedSkills: resume.parsedData.skills,
        extractedRole: resume.inferredRole,
        education: resume.parsedData.education,
        experience: resume.parsedData.experience,
        projects: resume.parsedData.projects,
        domain: resume.parsedData.domain,
        recommendations: resume.parsedData.recommendations,
        validation: resume.parsedData.validation,
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
  } finally {
    safeUnlink(tempFilePath);
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

const ROLE_CAREER_MAPPING = {
  "frontend developer": {
    shortTerm: [
      "Add TypeScript to your projects if not already using it",
      "Build a component library or reusable UI components",
      "Learn and implement automated testing (Jest + React Testing Library)"
    ],
    longTerm: [
      "Master state management patterns beyond Redux (Zustand, Jotai, or signals)",
      "Learn performance optimization techniques (bundle analysis, code splitting)",
      "Explore micro-frontends architecture for large applications"
    ]
  },
  "backend developer": {
    shortTerm: [
      "Add API documentation with Swagger/OpenAPI",
      "Implement proper error handling and logging middleware",
      "Add unit tests for business logic and API endpoints"
    ],
    longTerm: [
      "Learn distributed systems patterns (CQRS, Event Sourcing)",
      "Master containerization with Docker and Kubernetes",
      "Explore database optimization and indexing strategies"
    ]
  },
  "full stack developer": {
    shortTerm: [
      "Set up CI/CD pipeline for your projects",
      "Implement JWT authentication with refresh tokens",
      "Add comprehensive API documentation"
    ],
    longTerm: [
      "Learn microservices architecture patterns",
      "Master cloud deployment (AWS/GCP/Azure)",
      "Explore real-time features with WebSockets or SSE"
    ]
  },
  "data engineer": {
    shortTerm: [
      "Set up Airflow or Prefect for workflow orchestration",
      "Add data quality checks and validation in pipelines",
      "Learn dbt for data transformation"
    ],
    longTerm: [
      "Master streaming data processing with Kafka/Spark Streaming",
      "Learn cloud data warehouses (Snowflake, BigQuery, Redshift)",
      "Explore data mesh architecture patterns"
    ]
  },
  "data scientist": {
    shortTerm: [
      "Create a reproducible ML pipeline with MLflow",
      "Add model documentation and version control",
      "Build interactive dashboards for model results"
    ],
    longTerm: [
      "Learn MLOps practices and deployment",
      "Master deep learning frameworks for complex problems",
      "Explore LLM fine-tuning and prompt engineering"
    ]
  },
  "machine learning engineer": {
    shortTerm: [
      "Containerize ML models with Docker",
      "Set up model monitoring and drift detection",
      "Create ML pipeline documentation"
    ],
    longTerm: [
      "Master MLOps platforms (Kubeflow, SageMaker)",
      "Learn feature store architecture",
      "Explore model optimization and compression techniques"
    ]
  },
  "devops engineer": {
    shortTerm: [
      "Set up infrastructure as code with Terraform",
      "Implement monitoring and alerting (Prometheus + Grafana)",
      "Add security scanning in CI/CD pipeline"
    ],
    longTerm: [
      "Master Kubernetes deep dive (operators, service mesh)",
      "Learn GitOps with ArgoCD or Flux",
      "Explore platform engineering practices"
    ]
  },
  "software engineer": {
    shortTerm: [
      "Add comprehensive unit tests to your codebase",
      "Implement proper error handling and logging",
      "Set up code linting and formatting standards"
    ],
    longTerm: [
      "Learn system design for scalability",
      "Master architectural patterns (DDD, Clean Architecture)",
      "Explore domain-specific advanced topics in your field"
    ]
  }
};

const categorizeSkills = (skills) => {
  const categories = {
    languages: [],
    frameworks: [],
    databases: [],
    tools: [],
    concepts: [],
    softSkills: []
  };

  if (skills && !Array.isArray(skills)) {
    categories.languages = skills.languages || [];
    categories.frameworks = skills.frameworks || [];
    categories.databases = skills.databases || [];
    categories.tools = skills.tools || [];
    categories.concepts = skills.concepts || [];
    categories.softSkills = skills.softSkills || [];
    return categories;
  }

  const skillList = flattenSkills(skills);
  skillList.forEach((skill) => {
    const canonical = canonicalizeSkill(skill);
    if (!canonical) return;
    const category = SKILL_CATEGORY_BY_LABEL[canonical.toLowerCase()];
    if (!category) return;
    categories[category].push(canonical);
  });

  Object.keys(categories).forEach((key) => {
    categories[key] = dedupeList(categories[key]);
  });

  return categories;
};

const generateRuleBasedAdvice = (role, categorizedSkills, experience) => {
  const roleKey = role?.toLowerCase() || "software engineer";
  let mapped = ROLE_CAREER_MAPPING[roleKey] || ROLE_CAREER_MAPPING["software engineer"];
  
  const shortTerm = [...mapped.shortTerm];
  const longTerm = [...mapped.longTerm];
  
  if (categorizedSkills.languages.length < 2) {
    shortTerm.push("Add more programming languages relevant to your target role");
  }
  
  if (categorizedSkills.tools.length < 3 && !categorizedSkills.tools.some(t => t.toLowerCase().includes('docker'))) {
    shortTerm.push("Learn containerization with Docker");
  }
  
  if (experience.length < 2) {
    shortTerm.push("Add more detail to your experience section with specific achievements");
  }
  
  if (!categorizedSkills.tools.some(t => t.toLowerCase().includes('git'))) {
    shortTerm.push("Ensure Git is prominently listed with proper workflow knowledge");
  }
  
  if (!categorizedSkills.frameworks.some(f => f.toLowerCase().includes('test'))) {
    longTerm.push("Add automated testing expertise to your skillset");
  }
  
  if (categorizedSkills.databases.length === 0) {
    longTerm.push("Add database skills relevant to your role (SQL + NoSQL)");
  }
  
  return {
    shortTermAdvice: shortTerm.slice(0, 4),
    longTermAdvice: longTerm.slice(0, 4)
  };
};

const enhanceWithAIAdvice = async (role, parsedData) => {
  if (!isAiConfigured()) return null;
  
  try {
    const categories = categorizeSkills(parsedData.skills || []);
    const experienceList = Array.isArray(parsedData.experience) ? parsedData.experience : [];
    
    const prompt = `
Generate career advice for a ${role || 'software developer'} based on their resume data.

Resume Data:
- Languages: ${categories.languages.join(', ') || 'None listed'}
- Frameworks: ${categories.frameworks.join(', ') || 'None listed'}
- Databases: ${categories.databases.join(', ') || 'None listed'}
- Tools: ${categories.tools.join(', ') || 'None listed'}
- Experience: ${experienceList.slice(0, 3).map((entry) => {
  if (typeof entry === "string") return entry;
  return [entry.role, entry.company, entry.duration].filter(Boolean).join(" | ");
}).join(' | ')}

Rules:
1. ONLY use the data provided - do NOT suggest skills not mentioned
2. Make advice PRACTICAL and ACTIONABLE
3. Advice must align with the target role: ${role || 'software developer'}
4. shortTermAdvice: 3-4 steps achievable in 1-4 weeks
5. longTermAdvice: 3-4 steps for career growth over months
6. missingSkills should be relevant to the role but NOT present in the resume data

Output JSON:
{
  "shortTermAdvice": ["step 1", "step 2", "step 3", "step 4"],
  "longTermAdvice": ["step 1", "step 2", "step 3", "step 4"],
  "missingSkills": ["skill 1", "skill 2"]
}
Respond with JSON only (no markdown).
`;
    
    const parsed = await runGeminiPrompt({
      label: "Advice",
      prompt,
      parser: parseAiJson
    });
    
    if (parsed && parsed.shortTermAdvice && parsed.longTermAdvice) {
      return parsed;
    }
    return null;
  } catch (error) {
    console.warn("[AI Advice] Generation failed:", error.message);
    return null;
  }
};

exports.getCareerAdviceService = async (userId, targetRole) => {
  try {
    if (!userId) {
      return { data: null, message: "User ID is required", statusCode: 400 };
    }
    
    const resume = await getResumeByUserId(userId);
    if (!resume) {
      return { data: null, message: "Resume not found", statusCode: 404 };
    }
    
    const parsedData = resume.parsedData || {};
    const role = targetRole || resume.inferredRole || parsedData.inferredRole || "software engineer";
    const skills = parsedData.skills || {};
    const experienceList = Array.isArray(parsedData.experience) ? parsedData.experience : [];
    
    const categorizedSkills = categorizeSkills(skills);
    const ruleBasedAdvice = generateRuleBasedAdvice(role, categorizedSkills, experienceList);
    
    const aiAdvice = await enhanceWithAIAdvice(role, parsedData);
    
    const finalAdvice = aiAdvice || ruleBasedAdvice;
    
    return {
      data: {
        targetRole: role,
        skills: categorizedSkills,
        experience: experienceList,
        education: Array.isArray(parsedData.education) ? parsedData.education : [],
        shortTermAdvice: finalAdvice.shortTermAdvice,
        longTermAdvice: finalAdvice.longTermAdvice,
        missingSkills: finalAdvice.missingSkills || [],
        aiEnhanced: Boolean(aiAdvice)
      },
      message: "Career advice generated successfully",
      statusCode: 200
    };
  } catch (error) {
    console.error("Error in getCareerAdviceService:", error);
    return { data: null, message: "Server error", statusCode: 500 };
  }
};

exports.updateResumeService = async (userId, { skills, experience, education }) => {
  try {
    if (!userId) {
      return { data: null, message: "User ID is required", statusCode: 400 };
    }
    
    const resume = await getResumeByUserId(userId);
    if (!resume) {
      return { data: null, message: "Resume not found", statusCode: 404 };
    }
    
    const parsedData = resume.parsedData || {};
    const updateFields = {};
    
    if (skills) {
      updateFields.parsedData = {
        ...parsedData,
        skills: {
          ...(parsedData.skills || {}),
          ...skills
        }
      };
    }
    
    if (experience) {
      updateFields.parsedData = {
        ...updateFields.parsedData,
        experience: [
          ...(parsedData.experience || []),
          ...experience
        ]
      };
    }
    
    if (education) {
      updateFields.parsedData = {
        ...updateFields.parsedData,
        education: [
          ...(parsedData.education || []),
          ...education
        ]
      };
    }
    
    const updatedResume = await updateResume(userId, updateFields);
    
    return {
      data: updatedResume,
      message: "Resume updated successfully",
      statusCode: 200
    };
  } catch (error) {
    console.error("Error in updateResumeService:", error);
    return { data: null, message: "Server error", statusCode: 500 };
  }
};

