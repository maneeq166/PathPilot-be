const { GoogleGenerativeAI } = require("@google/generative-ai");

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
let geminiClient = null;
let warnedMissingKey = false;

if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
  console.warn("[AI] No OPENAI_API_KEY or GEMINI_API_KEY found in environment.");
}

const normalizeFlag = (value, fallback = true) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "off", "no"].includes(normalized)) return false;
  if (["true", "1", "on", "yes"].includes(normalized)) return true;
  return fallback;
};

const resolveAiEnabled = (requestFlag) => {
  const envEnabled = normalizeFlag(process.env.AI_ENABLED, true);
  if (!envEnabled) return false;
  return normalizeFlag(requestFlag, true);
};

const isAiConfigured = () => Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);

const getGeminiClient = () => {
  if (!process.env.GEMINI_API_KEY) {
    if (!warnedMissingKey) {
      console.warn("[AI] GEMINI_API_KEY missing. AI features disabled.");
      warnedMissingKey = true;
    }
    return null;
  }

  if (!geminiClient) {
    geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return geminiClient;
};

const runGeminiPrompt = async ({ label, prompt, parser, model }) => {
  const client = getGeminiClient();
  if (!client) return null;

  const trimmedPrompt = (prompt || "").toString();
  console.log(`[AI:${label}] Prompt input:`, trimmedPrompt.slice(0, 2000));

  try {
    const geminiModel = client.getGenerativeModel({ model: model || DEFAULT_MODEL });
    const result = await geminiModel.generateContent(trimmedPrompt);
    const rawText = result.response?.text() || "";
    console.log(`[AI:${label}] Raw response:`, rawText.slice(0, 2000));

    const parsed = parser ? parser(rawText) : rawText;
    console.log(`[AI:${label}] Parsed output:`, parsed);
    return parsed;
  } catch (error) {
    console.error(`[AI:${label}] ERROR:`, error.message);
    return null;
  }
};

module.exports = {
  resolveAiEnabled,
  isAiConfigured,
  runGeminiPrompt,
};
