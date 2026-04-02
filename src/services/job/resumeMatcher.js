const normalizeText = (value) =>
  (value || "")
    .toString()
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase();

const extractSkills = (parsedData) => {
  const skills = [];
  const skillsObj = parsedData?.skills || {};
  
  const skillCategories = [
    skillsObj.languages || [],
    skillsObj.frameworks || [],
    skillsObj.tools || [],
    skillsObj.databases || [],
    skillsObj.concepts || [],
    skillsObj.softSkills || [],
  ];
  
  skillCategories.forEach(category => {
    if (Array.isArray(category)) {
      skills.push(...category.map(s => normalizeText(s)));
    }
  });
  
  return [...new Set(skills)];
};

const extractExperienceLevel = (parsedData) => {
  const experience = parsedData?.experience || [];
  
  if (!Array.isArray(experience) || experience.length === 0) {
    return "entry";
  }
  
  const totalYears = experience.reduce((sum, exp) => {
    const duration = exp.duration || exp.years || "0";
    const years = parseFloat(duration.replace(/[^0-9.]/g, "")) || 0;
    return sum + years;
  }, 0);
  
  if (totalYears >= 7) return "senior";
  if (totalYears >= 3) return "mid";
  if (totalYears >= 1) return "junior";
  return "entry";
};

const extractEducationLevel = (parsedData) => {
  const education = parsedData?.education || [];
  const degreeText = education.map(e => normalizeText(e.degree || "")).join(" ");
  
  if (degreeText.includes("phd") || degreeText.includes("doctorate")) return "phd";
  if (degreeText.includes("master") || degreeText.includes("m.s") || degreeText.includes("mba")) return "masters";
  if (degreeText.includes("bachelor") || degreeText.includes("b.s") || degreeText.includes("b.e")) return "bachelors";
  if (degreeText.includes("associate") || degreeText.includes("diploma")) return "associate";
  return "high_school";
};

const extractKeywords = (parsedData) => {
  const keywords = new Set();
  
  const skills = extractSkills(parsedData);
  skills.forEach(s => keywords.add(s));
  
  const experience = parsedData?.experience || [];
  experience.forEach(exp => {
    if (exp.role) {
      exp.role.split(/[\s,]+/).forEach(word => {
        if (word.length > 3) keywords.add(normalizeText(word));
      });
    }
  });
  
  return [...keywords];
};

const buildJobText = (jobDescription, jobTitle, companyName) => {
  return normalizeText(
    [jobDescription, jobTitle, companyName].filter(Boolean).join(" ")
  );
};

const calculateSkillMatch = (jobDescription, userSkills, jobTitle, companyName) => {
  if (!userSkills.length) return 0;
  
  const desc = buildJobText(jobDescription, jobTitle, companyName);
  if (!desc) return 0;
  let matched = 0;
  
  userSkills.forEach(skill => {
    if (desc.includes(skill.toLowerCase())) {
      matched++;
    }
  });
  
  return Math.round((matched / userSkills.length) * 100);
};

const calculateExperienceMatch = (jobDescription, userLevel, jobTitle) => {
  const desc = buildJobText(jobDescription, jobTitle, "");
  if (!desc) return 50;
  const levelMap = {
    "senior": { keywords: ["senior", "lead", "principal", "staff", "5+ years", "7+ years", "5-7 years"], weight: 80 },
    "mid": { keywords: ["mid-level", "intermediate", "3+ years", "3-5 years", "2-4 years"], weight: 70 },
    "junior": { keywords: ["junior", "entry", "entry-level", "1+ years", "0-2 years", "fresher", "graduate"], weight: 60 },
    "entry": { keywords: ["intern", "trainee", "fresher", "entry-level", "new grad"], weight: 50 },
  };
  
  const config = levelMap[userLevel] || levelMap.entry;
  let score = config.weight;
  
  config.keywords.forEach(kw => {
    if (desc.includes(kw)) score += 10;
  });
  
  const higherLevel = userLevel === "senior" ? ["junior", "entry"] : 
                      userLevel === "mid" ? ["senior", "junior", "entry"] : ["senior"];
  
  higherLevel.forEach(kw => {
    if (desc.includes(kw)) score -= 15;
  });
  
  return Math.max(0, Math.min(100, score));
};

const calculateOverallMatch = (job, userProfile) => {
  const description = job.job_description || job.description || "";
  const title = job.job_title || job.title || "";
  const company = job.company_name || job.company || "";
  const skillScore = calculateSkillMatch(description, userProfile.skills, title, company);
  const experienceScore = calculateExperienceMatch(description, userProfile.experienceLevel, title);
  
  const weights = {
    skill: 0.6,
    experience: 0.4,
  };
  
  const overall = Math.round(
    (skillScore * weights.skill) + (experienceScore * weights.experience)
  );
  
  return {
    overall: Math.max(10, overall),
    skillMatch: skillScore,
    experienceMatch: experienceScore,
    matchedSkills: findMatchedSkills(description, userProfile.skills, title, company),
  };
};

const findMatchedSkills = (jobDescription, userSkills, jobTitle, companyName) => {
  if (!userSkills.length) return [];
  
  const desc = buildJobText(jobDescription, jobTitle, companyName);
  if (!desc) return [];
  return userSkills.filter(skill => desc.includes(skill.toLowerCase()));
};

const enhanceJobSearchQuery = (parsedData, originalQuery, location) => {
  const skills = extractSkills(parsedData);
  const experienceLevel = extractExperienceLevel(parsedData);
  
  let enhancedQuery = originalQuery;
  
  if (skills.length > 0) {
    const topSkills = skills.slice(0, 3);
    enhancedQuery = `${originalQuery} ${topSkills.join(" ")}`;
  }
  
  return {
    query: enhancedQuery,
    location: location || "",
    experienceLevel,
    skills,
  };
};

const scoreAndSortJobs = (jobs, userProfile) => {
  return jobs
    .map(job => ({
      ...job,
      matchScore: calculateOverallMatch(job, userProfile),
    }))
    .sort((a, b) => b.matchScore.overall - a.matchScore.overall);
};

module.exports = {
  extractSkills,
  extractExperienceLevel,
  extractEducationLevel,
  extractKeywords,
  calculateSkillMatch,
  calculateExperienceMatch,
  calculateOverallMatch,
  findMatchedSkills,
  enhanceJobSearchQuery,
  scoreAndSortJobs,
  normalizeText,
};
