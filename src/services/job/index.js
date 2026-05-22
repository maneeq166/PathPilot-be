const crypto = require("crypto");
const { upsertJob, findJobs, findJobsByIds } = require("../../repositories/job");
const { upsertJobMatch, findJobMatches, enforceJobMatchCap } = require("../../repositories/jobMatch");
const { extractJobSkills } = require("./jobSkillExtractor");
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
  cached: Boolean(job.cached),
  cached_at: job.cachedAt || null,
});

const buildJobKey = (job) => [
  job.source,
  job.job_url,
  job.company_name,
  job.job_title,
  job.location,
]
  .filter(Boolean)
  .join("|")
  .toLowerCase();

const runWithConcurrency = async (items, limit, handler) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  const results = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await handler(items[current], current);
    }
  };

  const concurrency = Math.max(1, Math.min(limit || 1, items.length));
  await Promise.all(new Array(concurrency).fill(0).map(worker));
  return results;
};

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
  userId = null,
  portalCookies = {},
  roleCatId,
  cityTypeGid,
  wfhType,
}) => {
  const normalizedQuery = (query || "").toString().trim();
  let effectiveQuery = normalizedQuery;
  if (!effectiveQuery && userResume?.inferredRole) {
    effectiveQuery = userResume.inferredRole;
    console.log(`[JobSearch] No query provided. Using inferred role: "${effectiveQuery}"`);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`JOB SEARCH INITIATED`);
  console.log(`Query: "${effectiveQuery || ""}", Location: "${location}"`);
  console.log(`='.repeat(50)}\n`);

  if (!effectiveQuery) {
    return { data: null, message: "query is required (or inferred role missing)", statusCode: 400 };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 15, 1), 15);
  const MIN_MATCH_SCORE = 70;
  const LINKEDIN_ONLY_TARGET = 2;
  const sourceLower = (source || "").toLowerCase();
  const isLinkedInOnly = sourceLower === "linkedin";

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
    const mockJobs = buildMockJobs(effectiveQuery, location).slice(0, safeLimit);
    const stored = await Promise.all(mockJobs.map((job) => upsertJob(job)));
    const normalized = stored.map((job) =>
      normalizeJob(job, { source: "mock", matched_query: query })
    );
    return { data: { jobs: normalized }, message: "Mock jobs generated", statusCode: 201 };
  }

  const linkedInJobs = [];
  const otherPortalJobs = [];
  let totalScraped = 0;
  const scrapeContext = { blockedPortals: [], cacheHits: [], portalAttempts: new Map() };

  const sortedPortals = [...JOB_PORTALS].sort((a, b) => (a.priority || 99) - (b.priority || 99));

  console.log(`\n--- PHASE 1: Portal Scraping (Priority Order) ---\n`);
  const portalsToRun = sortedPortals.filter((portal) => {
    if (source && source !== "all") {
      if (isLinkedInOnly) {
        return portal.name.toLowerCase().includes("linkedin");
      }
      return sourceLower === portal.name.toLowerCase();
    }
    return true;
  });

  const portalResults = await runWithConcurrency(portalsToRun, portalsToRun.length, async (portal) => {
    try {
      const isLinkedIn = portal.name.toLowerCase().includes("linkedin");
      const jobs = await runScraper(portal, effectiveQuery, location, {
        roleCatId,
        cityTypeGid,
        wfhType,
        portalCookies,
        ...(isLinkedIn ? {
          maxPages: 5,
          targetHighMatch: isLinkedInOnly ? LINKEDIN_ONLY_TARGET : 5,
          minMatchScore: MIN_MATCH_SCORE,
          userProfile,
        } : {}),
      }, scrapeContext);
      return { portal, jobs };
    } catch (error) {
      return { portal, error };
    }
  });

  portalResults.forEach((result) => {
    if (!result) return;
    const { portal, jobs, error } = result;
    if (error) {
      console.error(`[${portal.name}] CRASHED: ${error.message}`);
      return;
    }
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
  });

  console.log(`\nLinkedIn jobs: ${linkedInJobs.length}`);
  console.log(`Other portal jobs: ${otherPortalJobs.length}`);

  if (isLinkedInOnly) {
    console.log(`[LinkedInOnly] Skipping API and non-LinkedIn sources`);
  }

  console.log(`\n--- PHASE 2: API Sources (Primary when scraping fails) ---\n`);
  
  const apiJobs = [];
  
  if (!isLinkedInOnly && process.env.J_SEARCH_API_KEY && process.env.J_SEARCH_API_KEY !== "your_rapidapi_key_here") {
    console.log(`[Priority] Using JSearch API (aggregates LinkedIn jobs)`);
    const { fetchJSearch } = require("./fallbackAPI");
    const jsearchJobs = await fetchJSearch(effectiveQuery, location, safeLimit * 2);
    if (jsearchJobs.length > 0) {
      jsearchJobs.forEach((job) => {
        apiJobs.push({
          ...job,
          portal_priority: 1,
        });
      });
      console.log(`[JSearch] Got ${jsearchJobs.length} jobs`);
    }
  } else if (!isLinkedInOnly) {
    console.log(`[JSearch] No API key configured`);
  }
  
  const fallbackJobs = isLinkedInOnly ? [] : await getFallbackJobs(effectiveQuery, location, safeLimit * 2);
  
  const fallbackWithMeta = fallbackJobs.map((job) => ({
    ...job,
    portal_priority: 5,
  }));
  
  console.log(`Fallback APIs: ${fallbackJobs.length} jobs`);

  const allRawJobs = isLinkedInOnly
    ? [...linkedInJobs]
    : [
      ...linkedInJobs,
      ...apiJobs,
      ...otherPortalJobs,
      ...fallbackWithMeta,
    ];

  console.log(`\n--- TOTAL: ${allRawJobs.length} raw jobs ---\n`);

  const allNormalized = dedupeJobs(
    allRawJobs.map((job) =>
      normalizeJob(job, {
        source: job.source,
        portal_icon: job.portal_icon,
        portal_color: job.portal_color,
        matched_query: effectiveQuery,
        portal_priority: job.portal_priority,
      })
    )
  );

  let normalized = allNormalized;
  const linkedInPoolSorted = allNormalized.length > 0 && userProfile
    ? scoreAndSortJobs(
      allNormalized.filter((job) =>
        (job.source || "").toLowerCase().includes("linkedin")
      ),
      userProfile
    )
    : allNormalized.filter((job) =>
      (job.source || "").toLowerCase().includes("linkedin")
    );

  if (userProfile && normalized.length > 0) {
    normalized = scoreAndSortJobs(normalized, userProfile);
    console.log(`[Matching] Scored and sorted ${normalized.length} jobs`);

    const highMatchJobs = normalized.filter((job) => job.matchScore?.overall >= MIN_MATCH_SCORE);
    const belowThreshold = normalized.filter((job) => !job.matchScore?.overall || job.matchScore?.overall < MIN_MATCH_SCORE);
    
    console.log(`[Matching] Jobs with ${MIN_MATCH_SCORE}+% match: ${highMatchJobs.length}`);

    const curated = [];
    const seen = new Set();
    const addJobs = (jobs, options = {}) => {
      const { limitTotal, limitLinkedIn } = options;
      for (const job of jobs) {
        const key = buildJobKey(job);
        if (!key || seen.has(key)) continue;
        curated.push(job);
        seen.add(key);
        if (limitTotal && curated.length >= limitTotal) break;
        if (limitLinkedIn) {
          const linkedInCount = curated.filter((entry) =>
            (entry.source || "").toLowerCase().includes("linkedin")
          ).length;
          if (linkedInCount >= limitLinkedIn) break;
        }
      }
    };

    if (isLinkedInOnly) {
      const thresholds = [70, 60, 50, 40, 0];
      const targetCount = LINKEDIN_ONLY_TARGET;
      for (const threshold of thresholds) {
        const bucket = normalized.filter((job) => job.matchScore?.overall >= threshold);
        addJobs(bucket, { limitTotal: targetCount });
        if (curated.length >= targetCount) break;
      }
      normalized = curated;
    } else {
      const linkedInHighMatch = highMatchJobs.filter((job) =>
        (job.source || "").toLowerCase().includes("linkedin")
      );

      const TARGET_HIGH_MATCH = 5;

      // If we can satisfy "highly relevant only", return top 5 (LinkedIn first when possible).
      if (highMatchJobs.length >= TARGET_HIGH_MATCH) {
        if (linkedInHighMatch.length >= TARGET_HIGH_MATCH) {
          addJobs(linkedInHighMatch, { limitTotal: TARGET_HIGH_MATCH });
        } else {
          addJobs(linkedInHighMatch);
          addJobs(highMatchJobs, { limitTotal: TARGET_HIGH_MATCH });
        }
        normalized = curated;
      } else {
        // Not enough high-match jobs; include all high-match, then fill to 5 with best remaining.
        addJobs(highMatchJobs);
        addJobs(belowThreshold, { limitTotal: TARGET_HIGH_MATCH });
        normalized = curated;
      }
    }
  } else if (isLinkedInOnly && normalized.length > 0) {
    normalized = normalized.slice(0, LINKEDIN_ONLY_TARGET);
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

  if (!isLinkedInOnly && normalized.length > 0 && safeLimit >= 2) {
    if (linkedInPoolSorted.length >= 2) {
      const topLinkedIn = linkedInPoolSorted.slice(0, 2);
      const linkedInKeys = new Set(topLinkedIn.map((job) => buildJobKey(job)));
      normalized = [
        ...topLinkedIn,
        ...normalized.filter((job) => !linkedInKeys.has(buildJobKey(job))),
      ];
    } else if (linkedInPoolSorted.length > 0) {
      console.warn(`[LinkedIn] Only ${linkedInPoolSorted.length} LinkedIn jobs available; cannot guarantee 2.`);
    } else {
      console.warn(`[LinkedIn] No LinkedIn jobs available to prioritize.`);
    }
  }

  if (!isLinkedInOnly && normalized.length > 0) {
    const avgMatchScore = normalized.reduce((sum, j) => sum + (j.matchScore?.overall || 0), 0) / normalized.length;
    const lowRelevancy = avgMatchScore < 60;
    if (lowRelevancy) {
      const naukriPool = allNormalized.filter((job) =>
        (job.source || "").toLowerCase().includes("naukri")
      );
      const currentNaukri = normalized.filter((job) =>
        (job.source || "").toLowerCase().includes("naukri")
      ).length;
      if (naukriPool.length > 0 && currentNaukri < 2) {
        const naukriToAdd = naukriPool.slice(0, 3);
        const naukriKeys = new Set(naukriToAdd.map((job) => buildJobKey(job)));
        normalized = [
          ...naukriToAdd,
          ...normalized.filter((job) => !naukriKeys.has(buildJobKey(job))),
        ];
        console.log(`[Naukri] Low relevance detected; injecting ${Math.min(3, naukriToAdd.length)} Naukri jobs.`);
      }
    }
  }

  const finalJobs = normalized.slice(0, safeLimit);

  if (userProfile?.skills?.length) {
    finalJobs.forEach((job) => {
      const extracted = extractJobSkills(job.job_title, job.job_description);
      const missing = extracted.filter((skill) =>
        !userProfile.skills.includes(skill.toLowerCase())
      );
      job.missing_skills = missing;
    });
  }
  
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
    job._sourceId = sourceId;
  }

  console.log(`${'='.repeat(50)}`);
  console.log(`JOB SEARCH COMPLETE`);
  console.log(`Final: ${finalJobs.length} jobs returned (max ${safeLimit})`);
  console.log(`=${'='.repeat(50)}\n`);

  if (userId && userProfile?.skills?.length && finalJobs.length > 0) {
    const topMatches = [...finalJobs]
      .filter((job) => job.matchScore?.overall)
      .sort((a, b) => b.matchScore.overall - a.matchScore.overall)
      .slice(0, 10);

    const storedBySourceId = new Map(stored.map((doc) => [doc.sourceId, doc]));

    for (const job of topMatches) {
      const storedJob = storedBySourceId.get(job._sourceId);
      if (!storedJob) continue;
      await upsertJobMatch({
        userId,
        jobId: storedJob._id,
        query: effectiveQuery,
        location: location || "",
        source: job.source || "unknown",
        matchScore: {
          overall: job.matchScore?.overall || 0,
          skillMatch: job.matchScore?.skillMatch || 0,
          experienceMatch: job.matchScore?.experienceMatch || 0,
        },
        matchedSkills: job.matchScore?.matchedSkills || [],
        missingSkills: job.missing_skills || [],
        lastSeenAt: new Date(),
      });
    }
    await enforceJobMatchCap({
      userId,
      query: effectiveQuery,
      location: location || "",
      cap: 10,
    });
  }

  let mergedJobs = finalJobs;
  if (userId) {
    const savedMatches = await findJobMatches({
      userId,
      query: effectiveQuery,
      location: location || "",
      limit: 10,
    });
    if (savedMatches.length > 0) {
      const jobDocs = await findJobsByIds(savedMatches.map((m) => m.jobId));
      const jobDocById = new Map(jobDocs.map((doc) => [String(doc._id), doc]));
      const savedJobs = savedMatches
        .map((match) => {
          const doc = jobDocById.get(String(match.jobId));
          if (!doc) return null;
          const normalizedJob = normalizeJob(doc, { source: doc.source });
          normalizedJob.matchScore = {
            overall: match.matchScore?.overall || 0,
            skillMatch: match.matchScore?.skillMatch || 0,
            experienceMatch: match.matchScore?.experienceMatch || 0,
            matchedSkills: match.matchedSkills || [],
          };
          normalizedJob.missing_skills = match.missingSkills || [];
          normalizedJob.saved_best_match = true;
          return normalizedJob;
        })
        .filter(Boolean);

      const seen = new Set();
      const keyFor = (job) =>
        [
          job.source,
          job.job_url,
          job.company_name,
          job.job_title,
        ]
          .filter(Boolean)
          .join("|")
          .toLowerCase();

      mergedJobs = [];
      savedJobs.forEach((job) => {
        const key = keyFor(job);
        if (!key || seen.has(key)) return;
        seen.add(key);
        mergedJobs.push(job);
      });
      finalJobs.forEach((job) => {
        const key = keyFor(job);
        if (!key || seen.has(key)) return;
        seen.add(key);
        mergedJobs.push(job);
      });
    }
  }

  const mergedAvgMatch = mergedJobs.length
    ? mergedJobs.reduce((sum, j) => sum + (j.matchScore?.overall || 0), 0) / mergedJobs.length
    : 0;

  return {
    data: { 
      jobs: mergedJobs,
      summary: {
        total: mergedJobs.length,
        bySource,
        avgMatchScore: Math.round(mergedAvgMatch),
        hasResumeMatch: !!userProfile,
        userExperienceLevel: userProfile?.experienceLevel || null,
        blockedPortals: scrapeContext.blockedPortals,
        cacheHits: scrapeContext.cacheHits,
      }
    },
    message: `Found ${mergedJobs.length} matching jobs`,
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
