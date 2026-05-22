const KEYWORDS = [
  "javascript",
  "typescript",
  "react",
  "vue",
  "angular",
  "node",
  "node.js",
  "express",
  "next.js",
  "nuxt",
  "svelte",
  "redux",
  "html",
  "css",
  "sass",
  "tailwind",
  "bootstrap",
  "python",
  "django",
  "flask",
  "fastapi",
  "java",
  "spring",
  "spring boot",
  "kotlin",
  "golang",
  "go",
  "c#",
  "dotnet",
  ".net",
  "php",
  "laravel",
  "ruby",
  "rails",
  "sql",
  "mysql",
  "postgres",
  "postgresql",
  "mongodb",
  "redis",
  "sqlite",
  "graphql",
  "rest",
  "aws",
  "gcp",
  "azure",
  "docker",
  "kubernetes",
  "git",
  "linux",
  "ci/cd",
  "jenkins",
  "github actions",
  "terraform",
  "ansible",
  "microservices",
  "testing",
  "jest",
  "cypress",
  "selenium",
  "playwright",
  "storybook",
  "ml",
  "machine learning",
  "data science",
  "pandas",
  "numpy",
  "pytorch",
  "tensorflow",
  "llm",
  "ai",
  "nlp",
];

const normalize = (value) =>
  (value || "")
    .toString()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const extractJobSkills = (title, description) => {
  const text = normalize([title, description].filter(Boolean).join(" "));
  if (!text) return [];
  const hits = new Set();
  KEYWORDS.forEach((kw) => {
    const needle = normalize(kw);
    if (!needle) return;
    if (text.includes(needle)) {
      hits.add(kw);
    }
  });
  return Array.from(hits);
};

module.exports = {
  extractJobSkills,
  KEYWORDS,
};
