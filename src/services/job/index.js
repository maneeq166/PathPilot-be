const crypto = require("crypto");
const { upsertJob, findJobs } = require("../../repositories/job");
const { JOB_PORTALS } = require("../../config/jobPortals");
const { runScraper, delay, runAllFallback } = require("./scrapers");
const { getFallbackJobs } = require("./fallbackAPI");
const {
  extractSkills,
  extractExperienceLevel,
  enhanceJobSearchQuery,
  scoreAndSortJobs,
} = require("./resumeMatcher");

const normalizeText = (value) =>
  (value || "")
    .toString()
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();

const stripHtml = (value) => {
  if (!value) return "";
  return normalizeText(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li>/gi, "• ")
      .replace(/<[^>]+>/g, " ")
  );
};

const formatDescription = (raw) => {
  const cleaned = stripHtml(raw);
  if (!cleaned) return "";
  const lines = cleaned
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  return lines.join("\n");
};

const normalizeJob = (job, context = {}) => ({
  source: job.source || context.source || "unknown",
  company_name: normalizeText(job.company || job.company_name),
  job_title: normalizeText(job.title || job.job_title),
  location: normalizeText(job.location),
  job_url: job.url || job.job_url || null,
  job_description: formatDescription(job.description || job.job_description),
  portal_icon: context.portal_icon || null,
  portal_color: context.portal_color || null,
  matched_query: context.matched_query || null,
  experience_level: normalizeText(job.experienceLevel || job.experience_level),
  salary_range: normalizeText(job.salaryRange || job.salary_range),
  job_type: normalizeText(job.employmentType || job.job_type),
});

const buildMockJobs = (query, location) => [
  {
    title: `${query || "Software"} Engineer`,
    company: "PathPilot Labs",
    location: location || "Remote",
    employmentType: "Full-time",
    experienceLevel: "mid",
    salaryRange: null,
    description: "Build career intelligence features for PathPilot.",
    skills: ["JavaScript", "Node.js", "MongoDB"],
    tags: ["JavaScript", "Node.js", "MongoDB"],
    url: null,
    source: "mock",
    sourceId: `mock-${Date.now()}-1`,
    postedAt: new Date(),
    scrapedAt: new Date(),
  },
  {
    title: `${query || "Full Stack"} Developer`,
    company: "PathPilot Studio",
    location: location || "Remote",
    employmentType: "Contract",
    experienceLevel: "junior",
    salaryRange: null,
    description: "Ship frontend and backend features in a fast-moving team.",
    skills: ["React", "Express", "SQL"],
    tags: ["React", "Express", "SQL"],
    url: null,
    source: "mock",
    sourceId: `mock-${Date.now()}-2`,
    postedAt: new Date(),
    scrapedAt: new Date(),
  },
];

exports.scrapeJobsService = async ({
  query,
  location,
  limit = 15,
  source = "all",
  userResume = null,
  roleCatId,
  cityTypeGid,
  wfhType,
}) => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`JOB SEARCH INITIATED`);
  console.log(`Query: "${query}", Location: "${location}"`);
  console.log(`='.repeat(50)}\n`);

  if (!query) {
    return { data: null, message: "query is required", statusCode: 400 };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 15, 1), 15);
  const MIN_MATCH_SCORE = 70;

  const userProfile = userResume ? {
    skills: extractSkills(userResume),
    experienceLevel: extractExperienceLevel(userResume),
  } : null;

  if (userProfile?.skills?.length > 0) {
    console.log(`[UserProfile] Skills: ${userProfile.skills.length}, Level: ${userProfile.experienceLevel}`);
    console.log(`[UserProfile] Skill list: ${userProfile.skills.slice(0, 5).join(", ")}...`);
  } else {
    console.log(`[UserProfile] No resume found, skipping skill matching`);
  }

  if (source === "mock") {
    const mockJobs = buildMockJobs(query, location).slice(0, safeLimit);
    const stored = await Promise.all(mockJobs.map((job) => upsertJob(job)));
    const normalized = stored.map((job) =>
      normalizeJob(job, { source: "mock", matched_query: query })
    );
    return { data: { jobs: normalized }, message: "Mock jobs generated", statusCode: 201 };
  }

  const linkedInJobs = [];
  const otherPortalJobs = [];
  let totalScraped = 0;

  const sortedPortals = [...JOB_PORTALS].sort((a, b) => (a.priority || 99) - (b.priority || 99));

  console.log(`\n--- PHASE 1: Portal Scraping (Priority Order) ---\n`);
  for (const portal of sortedPortals) {
    if (source && source !== "all" && source.toLowerCase() !== portal.name.toLowerCase()) {
      continue;
    }

    try {
      const jobs = await runScraper(portal, query, location, {
        roleCatId,
        cityTypeGid,
        wfhType,
      });
      totalScraped += jobs.length;
      
      if (jobs.length > 0) {
        console.log(`[${portal.name}] Got ${jobs.length} jobs (Priority: ${portal.priority || 99})`);
        
        const jobsWithMeta = jobs.map((job) => ({
          ...job,
          portal_icon: portal.icon,
          portal_color: portal.color,
          portal_priority: portal.priority || 99,
        }));

        if (portal.name.toLowerCase().includes("linkedin")) {
          linkedInJobs.push(...jobsWithMeta);
        } else {
          otherPortalJobs.push(...jobsWithMeta);
        }
      } else {
        console.warn(`[${portal.name}] No jobs returned`);
      }
    } catch (error) {
      console.error(`[${portal.name}] CRASHED: ${error.message}`);
    }
    await delay(1500);
  }

  console.log(`\nLinkedIn jobs: ${linkedInJobs.length}`);
  console.log(`Other portal jobs: ${otherPortalJobs.length}`);

  console.log(`\n--- PHASE 2: API Sources (Primary when scraping fails) ---\n`);
  
  const apiJobs = [];
  
  if (process.env.J_SEARCH_API_KEY && process.env.J_SEARCH_API_KEY !== "your_rapidapi_key_here") {
    console.log(`[Priority] Using JSearch API (aggregates LinkedIn jobs)`);
    const { fetchJSearch } = require("./fallbackAPI");
    const jsearchJobs = await fetchJSearch(query, location, safeLimit * 2);
    if (jsearchJobs.length > 0) {
      jsearchJobs.forEach((job) => {
        apiJobs.push({
          ...job,
          portal_priority: 1,
        });
      });
      console.log(`[JSearch] Got ${jsearchJobs.length} jobs`);
    }
  } else {
    console.log(`[JSearch] No API key configured`);
  }
  
  const fallbackJobs = await getFallbackJobs(query, location, safeLimit * 2);
  
  const fallbackWithMeta = fallbackJobs.map((job) => ({
    ...job,
    portal_priority: 5,
  }));
  
  console.log(`Fallback APIs: ${fallbackJobs.length} jobs`);

  const allRawJobs = [
    ...linkedInJobs,
    ...apiJobs,
    ...otherPortalJobs,
    ...fallbackWithMeta,
  ];

  console.log(`\n--- TOTAL: ${allRawJobs.length} raw jobs ---\n`);

  let normalized = dedupeJobs(
    allRawJobs.map((job) =>
      normalizeJob(job, {
        source: job.source,
        portal_icon: job.portal_icon,
        portal_color: job.portal_color,
        matched_query: query,
        portal_priority: job.portal_priority,
      })
    )
  );

  if (userProfile && normalized.length > 0) {
    normalized = scoreAndSortJobs(normalized, userProfile);
    console.log(`[Matching] Scored and sorted ${normalized.length} jobs`);

    const highMatchJobs = normalized.filter((job) => job.matchScore?.overall >= MIN_MATCH_SCORE);
    const belowThreshold = normalized.filter((job) => !job.matchScore?.overall || job.matchScore?.overall < MIN_MATCH_SCORE);
    
    console.log(`[Matching] Jobs with ${MIN_MATCH_SCORE}+% match: ${highMatchJobs.length}`);
    
    normalized = [...highMatchJobs, ...belowThreshold.slice(0, 5)];
  }

  const sourceOrder = { 
    "linkedin": 1, 
    "jsearch": 2, 
    "themuse": 3, 
    "remotive": 4, 
    "adzuna": 5, 
    "naukri": 6,
    "indeed": 7,
    "default": 99 
  };
  
  normalized = normalized.sort((a, b) => {
    const aSource = (sourceOrder[a.source?.toLowerCase()] || sourceOrder.default);
    const bSource = (sourceOrder[b.source?.toLowerCase()] || sourceOrder.default);
    
    if (aSource !== bSource) {
      return aSource - bSource;
    }
    
    if (a.matchScore?.overall && b.matchScore?.overall) {
      return b.matchScore.overall - a.matchScore.overall;
    }
    
    return 0;
  });

  const finalJobs = normalized.slice(0, safeLimit);
  
  console.log(`\n--- FINAL RESULTS ---`);
  console.log(`Total: ${finalJobs.length} jobs`);
  
  const bySource = {};
  finalJobs.forEach((job) => {
    const src = job.source || "unknown";
    bySource[src] = (bySource[src] || 0) + 1;
  });
  console.log(`By source:`, bySource);
  
  const avgMatch = finalJobs.reduce((sum, j) => sum + (j.matchScore?.overall || 0), 0) / finalJobs.length;
  console.log(`Average match score: ${avgMatch.toFixed(1)}%`);
  console.log(`===================\n`);

  const stored = [];
  for (const job of finalJobs) {
    const sourceId = crypto
      .createHash("sha1")
      .update([job.source, job.job_url, job.company_name, job.job_title].join("|"))
      .digest("hex");

    stored.push(
      await upsertJob({
        title: job.job_title,
        company: job.company_name,
        location: job.location,
        employmentType: job.job_type || null,
        experienceLevel: job.experience_level || null,
        salaryRange: job.salary_range || null,
        description: job.job_description || null,
        skills: job.matchScore?.matchedSkills || [],
        tags: [],
        url: job.job_url || null,
        source: job.source || "unknown",
        sourceId,
        postedAt: null,
        scrapedAt: new Date(),
      })
    );
  }

  console.log(`${'='.repeat(50)}`);
  console.log(`JOB SEARCH COMPLETE`);
  console.log(`Final: ${finalJobs.length} jobs returned (max ${safeLimit})`);
  console.log(`=${'='.repeat(50)}\n`);

  return {
    data: { 
      jobs: finalJobs,
      summary: {
        total: finalJobs.length,
        bySource,
        avgMatchScore: Math.round(avgMatch),
        hasResumeMatch: !!userProfile,
        userExperienceLevel: userProfile?.experienceLevel || null,
      }
    },
    message: `Found ${finalJobs.length} matching jobs`,
    statusCode: 201,
  };
};

const dedupeJobs = (items) => {
  const seen = new Set();
  return items.filter((job) => {
    const key = [
      job.source,
      job.job_url,
      job.company_name,
      job.job_title,
      job.location,
    ]
      .filter(Boolean)
      .join("|")
      .toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

exports.getJobsService = async ({
  query,
  location,
  jobType,
  experienceLevel,
  salaryRange,
  source,
  page = 1,
  limit = 20,
}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const safePage = Math.max(Number(page) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const { jobs, total } = await findJobs({
    query,
    location,
    jobType,
    experienceLevel,
    salaryRange,
    source,
    skip,
    limit: safeLimit,
  });

  const normalized = dedupeJobs(
    jobs.map((job) => normalizeJob(job, { source: job.source }))
  );

  return {
    data: {
      items: normalized,
      page: safePage,
      limit: safeLimit,
      total,
    },
    message: "Jobs fetched successfully",
    statusCode: 200,
  };
};
