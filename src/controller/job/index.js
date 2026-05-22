const { scrapeJobsService, getJobsService } = require("../../services/job");
const {
  setPortalCookies,
  clearPortalCookies,
  getAllPortalStatus,
  getUserPortalCookiesMap,
} = require("../../services/job/portalAuth");
const { fetchFreeProxies, testProxy, BACKUP_PROXIES } = require("../../services/job/proxyService");
const { PUBLIC_APIS, fetchJSearch, fetchJooble } = require("../../services/job/fallbackAPI");
const { testPublicAPI, scrapeLinkedIn, scrapeNaukri, scrapeIndeed } = require("../../services/job/scrapers");
const { JOB_PORTALS } = require("../../config/jobPortals");
const { asyncHandler } = require("../../utils/asyncHandler");
const ApiResponse = require("../../utils/apiResponse");

exports.handleScrapeJobs = asyncHandler(async (req, res) => {
  let userResume = null;
  
  if (req.id) {
    try {
      const Resume = require("../../models/resumeModel");
      const resume = await Resume.findOne({ userId: req.id }).select("parsedData inferredRole");
      if (resume?.parsedData) {
        userResume = {
          ...resume.parsedData,
          inferredRole: resume.inferredRole || null,
        };
        console.log("[JobController] Loaded user resume for matching");
      }
    } catch (err) {
      console.warn("[JobController] Could not fetch user resume:", err.message);
    }
  }

  const portalCookies = req.id ? getUserPortalCookiesMap(req.id) : {};

  const result = await scrapeJobsService({
    query: req.body?.query,
    location: req.body?.location,
    limit: req.body?.limit,
    source: req.body?.source,
    roleCatId: req.body?.roleCatId,
    cityTypeGid: req.body?.cityTypeGid,
    wfhType: req.body?.wfhType,
    userResume,
    userId: req.id || null,
    portalCookies,
  });

  return res
    .status(result.statusCode)
    .json(new ApiResponse(result.statusCode, result.data, result.message));
});

exports.handleGetJobs = asyncHandler(async (req, res) => {
  const result = await getJobsService({
    query: req.query?.q,
    location: req.query?.location,
    jobType: req.query?.jobType,
    experienceLevel: req.query?.experienceLevel,
    salaryRange: req.query?.salaryRange,
    source: req.query?.source,
    page: req.query?.page,
    limit: req.query?.limit,
  });

  return res
    .status(result.statusCode)
    .json(new ApiResponse(result.statusCode, result.data, result.message));
});

exports.handleRefreshProxies = asyncHandler(async (req, res) => {
  console.log("[Admin] Manually refreshing proxy pool...");
  const proxies = await fetchFreeProxies();
  
  return res
    .status(200)
    .json(new ApiResponse(200, { 
      proxies,
      count: proxies.length,
      backupProxies: BACKUP_PROXIES.length,
    }, "Proxies refreshed successfully"));
});

exports.handleGetProxyStatus = asyncHandler(async (req, res) => {
  const proxies = await fetchFreeProxies();
  const tested = await Promise.all(
    proxies.slice(0, 5).map(async (proxy) => {
      const isWorking = await testProxy(proxy);
      return { proxy, isWorking };
    })
  );

  return res
    .status(200)
    .json(new ApiResponse(200, {
      activeProxies: proxies.length,
      backupProxies: BACKUP_PROXIES.length,
      testedProxies: tested,
      apiKeys: {
        J_SEARCH_API_KEY: !!process.env.J_SEARCH_API_KEY,
        JOOBLE_API_KEY: !!process.env.JOOBLE_API_KEY && process.env.JOOBLE_API_KEY !== "your_jooble_key_here",
      },
    }, "Proxy status retrieved"));
});

exports.handleTestSources = asyncHandler(async (req, res) => {
  const { query = "software engineer", location = "USA" } = req.query;
  
  console.log(`\n${"=".repeat(50)}`);
  console.log(`DEBUG: Testing all sources`);
  console.log(`Query: "${query}", Location: "${location}"`);
  console.log(`=${"=".repeat(50)}\n`);

  const results = {
    scrapers: {},
    apis: {},
  };

  for (const portal of JOB_PORTALS) {
    console.log(`\nTesting scraper: ${portal.name}...`);
    try {
      let jobs = [];
      switch (portal.scraper) {
        case "linkedin":
          jobs = await scrapeLinkedIn(query, location, portal);
          break;
        case "naukri":
          jobs = await scrapeNaukri(query, location, portal);
          break;
        case "indeed":
          jobs = await scrapeIndeed(query, location, portal);
          break;
      }
      results.scrapers[portal.name] = {
        success: true,
        count: jobs.length,
        jobs: jobs.slice(0, 3),
      };
    } catch (e) {
      results.scrapers[portal.name] = {
        success: false,
        error: e.message,
      };
    }
  }

  console.log(`\nTesting public APIs...`);
  for (const api of PUBLIC_APIS) {
    try {
      const jobs = await testPublicAPI(api, query, location);
      results.apis[api.name] = {
        success: true,
        count: jobs.length,
        jobs: jobs.slice(0, 3),
      };
    } catch (e) {
      results.apis[api.name] = {
        success: false,
        error: e.message,
      };
    }
  }

  console.log(`\nTesting RapidAPI sources...`);
  const jsearchJobs = await fetchJSearch(query, location, 5);
  results.apis["JSearch"] = {
    success: !!jsearchJobs.length,
    hasKey: !!(process.env.J_SEARCH_API_KEY),
    count: jsearchJobs.length,
    jobs: jsearchJobs.slice(0, 3),
  };

  const joobleJobs = await fetchJooble(query, location, 5);
  results.apis["Jooble"] = {
    success: !!joobleJobs.length,
    hasKey: !!(process.env.JOOBLE_API_KEY && process.env.JOOBLE_API_KEY !== "your_jooble_key_here"),
    count: joobleJobs.length,
    jobs: joobleJobs.slice(0, 3),
  };

  console.log(`\n${"=".repeat(50)}`);
  console.log(`DEBUG COMPLETE`);
  console.log(`=${"=".repeat(50)}\n`);

  return res
    .status(200)
    .json(new ApiResponse(200, results, "Test complete"));
});

exports.handleSetPortalCookies = asyncHandler(async (req, res) => {
  const userId = req.id;
  const { portal, cookies } = req.body || {};
  const result = setPortalCookies(userId, portal, cookies);
  const statusCode = result.ok ? 200 : 400;
  return res
    .status(statusCode)
    .json(new ApiResponse(statusCode, null, result.message));
});

exports.handleGetPortalStatus = asyncHandler(async (req, res) => {
  const userId = req.id;
  const data = getAllPortalStatus(userId);
  return res
    .status(200)
    .json(new ApiResponse(200, data, "Portal status retrieved"));
});

exports.handleClearPortalCookies = asyncHandler(async (req, res) => {
  const userId = req.id;
  const portal = req.params?.portal;
  const result = clearPortalCookies(userId, portal);
  const statusCode = result.ok ? 200 : 400;
  return res
    .status(statusCode)
    .json(new ApiResponse(statusCode, null, result.message));
});
