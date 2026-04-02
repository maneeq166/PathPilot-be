const cheerio = require("cheerio");
const { scoreAndSortJobs } = require("./resumeMatcher");
const {
  getRandomProxy,
  getRandomUA,
  buildHeaders,
  retryWithBackoff,
  BACKUP_PROXIES,
} = require("./proxyService");

let puppeteer, puppeteerExtra, stealthPlugin;
try {
  puppeteerExtra = require("puppeteer-extra");
  stealthPlugin = require("puppeteer-extra-plugin-stealth");
  puppeteerExtra.use(stealthPlugin());
  puppeteer = puppeteerExtra;
  console.log("[LinkedIn] Puppeteer stealth mode enabled");
} catch (e) {
  puppeteer = require("puppeteer");
  console.log("[LinkedIn] Using standard puppeteer");
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = () => delay(Math.random() * 2000 + 1000);

const fillUrl = (template, ...args) => {
  let index = 0;
  return template.replace(/\{\}/g, () => encodeURIComponent(args[index++] || ""));
};

const toSlug = (value) =>
  (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const autoScroll = async (page) => {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 250);
    });
  });
};

const safeText = (value) => (value || "").toString().replace(/\s+/g, " ").trim();

const BLOCK_PAGE_PATTERNS = [
  "captcha",
  "verify you are human",
  "robot check",
  "security verification",
  "unusual traffic",
  "access denied",
  "sorry, something went wrong",
  "enable javascript",
];

const isBlockedPageContent = (content = "") => {
  const lower = content.toLowerCase();
  return BLOCK_PAGE_PATTERNS.some((pattern) => lower.includes(pattern));
};

const logPortalBlocked = (portalName, reason) => {
  console.warn(`[${portalName}] Blocked page detected${reason ? `: ${reason}` : ""}. Skipping portal.`);
};

const isNaukriBlocked = (html = "") => {
  const lower = html.toLowerCase();
  return (
    lower.includes("access denied") ||
    lower.includes("robot check") ||
    lower.includes("verify you are human") ||
    lower.includes("unusual traffic") ||
    lower.includes("captcha")
  );
};

const buildNaukriHeaders = () => ({
  ...buildHeaders(),
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "referer": "https://www.naukri.com/",
});

const fetchNaukriHtml = async (url) => {
  // Strategy 1: proxy + standard headers
  try {
    const { response, success } = await fetchWithProxy(url, {
      headers: buildNaukriHeaders(),
    });
    if (success && response) {
      const html = await response.text();
      if (html && !isNaukriBlocked(html)) return html;
      if (html) logPortalBlocked("Naukri", "proxy response");
      else console.warn("[Naukri] Proxy fetch returned empty HTML.");
    }
  } catch (err) {
    console.warn(`[Naukri] Proxy fetch failed: ${err.message}`);
  }

  // Strategy 2: direct fetch with alternate UA
  try {
    const res = await fetch(url, {
      headers: {
        ...buildNaukriHeaders(),
        "user-agent": getRandomUA(),
      },
    });
    const html = await res.text();
    if (html && !isNaukriBlocked(html)) return html;
    if (html) logPortalBlocked("Naukri", "direct response");
    else console.warn("[Naukri] Direct fetch returned empty HTML.");
  } catch (err) {
    console.warn(`[Naukri] Direct fetch failed: ${err.message}`);
  }

  // Strategy 3: puppeteer render fallback
  try {
    const puppeteer = require("puppeteer");
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1920,1080",
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(getRandomUA());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await randomDelay();
    const html = await page.content();
    await browser.close();
    if (html && !isNaukriBlocked(html)) return html;
    if (html) logPortalBlocked("Naukri", "browser render");
  } catch (err) {
    console.warn(`[Naukri] Puppeteer fallback failed: ${err.message}`);
  }

  return "";
};

const extractJobsFromJson = (data, limit = 200) => {
  const results = [];
  const seen = new Set();
  const queue = [{ value: data, depth: 0 }];
  const MAX_DEPTH = 6;

  const pushJob = (job) => {
    const title = safeText(job.title || job.jobTitle || job.job_title || "");
    const company = safeText(job.companyName || job.company || job.recruiterName || "");
    if (!title || !company) return;
    const url = job.url || job.jdURL || job.jobDetailUrl || job.applyUrl || "";
    const key = `${title}|${company}|${url}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      source: "Naukri",
      company_name: company,
      job_title: title,
      location: safeText(job.location || job.jobLocation || job.loc || "India"),
      job_url: url || "",
    });
  };

  while (queue.length && results.length < limit) {
    const { value, depth } = queue.shift();
    if (!value || depth > MAX_DEPTH) continue;

    if (Array.isArray(value)) {
      if (value.length && typeof value[0] === "object") {
        value.forEach((item) => {
          if (item && typeof item === "object") {
            pushJob(item);
          }
        });
      }
      value.forEach((item) => {
        if (item && typeof item === "object") queue.push({ value: item, depth: depth + 1 });
      });
    } else if (typeof value === "object") {
      Object.values(value).forEach((item) => {
        if (item && typeof item === "object") queue.push({ value: item, depth: depth + 1 });
      });
    }
  }

  return results;
};

const fetchNaukriJobsViaBrowser = async (url) => {
  const jobs = [];
  let jsonResponses = 0;
  let jobHits = 0;

  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1920,1080",
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(getRandomUA());

    page.on("response", async (response) => {
      try {
        const headers = response.headers() || {};
        const contentType = headers["content-type"] || "";
        if (!contentType.includes("application/json")) return;
        jsonResponses += 1;
        const data = await response.json();
        const extracted = extractJobsFromJson(data);
        if (extracted.length > 0) {
          jobHits += extracted.length;
          jobs.push(...extracted);
        }
      } catch (_) {
        // ignore JSON parse failures
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await delay(3000);
    await autoScroll(page);
    await delay(3000);

    await browser.close();
  } catch (err) {
    console.warn(`[Naukri] Puppeteer JSON capture failed: ${err.message}`);
  }

  const deduped = [];
  const seen = new Set();
  jobs.forEach((job) => {
    const key = `${job.job_title}|${job.company_name}|${job.job_url}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(job);
  });

  console.log(`[Naukri] JSON responses inspected: ${jsonResponses}, job hits: ${jobHits}, unique jobs: ${deduped.length}`);
  return deduped;
};

async function fetchWithProxy(url, options = {}) {
  let proxy = null;
  
  try {
    proxy = await getRandomProxy();
    console.log(`[Fetch] Using proxy: ${proxy}`);
  } catch (e) {
    console.warn(`[Fetch] Failed to get proxy: ${e.message}`);
  }

  const headers = {
    ...buildHeaders(),
    ...options.headers,
  };

  try {
    const response = await retryWithBackoff(async () => {
      console.log(`[Fetch] Requesting: ${url}`);
      const res = await fetch(url, {
        headers,
        ...options,
      });
      console.log(`[Fetch] Response status: ${res.status}`);
      
      if (res.status === 403 || res.status === 429) {
        throw new Error(`Blocked: HTTP ${res.status}`);
      }
      
      return res;
    }, 3, 2000);

    return { response, proxy, success: true };
  } catch (error) {
    console.warn(`[Fetch] Failed with proxy: ${error.message}`);
    
    console.log(`[Fetch] Trying direct connection...`);
    try {
      const res = await fetch(url, { headers });
      console.log(`[Fetch] Direct response: ${res.status}`);
      return { response: res, proxy: null, success: res.ok };
    } catch (directError) {
      console.warn(`[Fetch] Direct also failed: ${directError.message}`);
      return { response: null, proxy: null, success: false };
    }
  }
}

const normalizeLinkedInJobUrl = (url) => {
  if (!url) return "";
  const cleaned = url.startsWith("http") ? url : `https://www.linkedin.com${url}`;
  const noHash = cleaned.split("#")[0];
  return noHash.split("?")[0];
};

const buildLinkedInJobKey = (job) => [
  job.job_title,
  job.company_name,
  job.job_url,
]
  .filter(Boolean)
  .join("|")
  .toLowerCase();

const scrapeLinkedIn = async (query, location, portal, options = {}) => {
  console.log(`\n========== LinkedIn Scraper ==========`);
  console.log(`Query: "${query}", Location: "${location}"`);
  console.log(`Portal: ${portal.name}`);

  if (!puppeteer) {
    console.error(`[LinkedIn] Puppeteer not installed.`);
    return [];
  }

  const {
    maxPages = 1,
    targetHighMatch = 0,
    minMatchScore = 70,
    userProfile = null,
  } = options;

  const buildSearchUrl = (start = 0) =>
    `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location || "United States")}&f_TPR=r2592000&f_LF=f_AL&sortBy=DD&start=${start}`;

  let browser;
  try {
    console.log(`[LinkedIn] Launching browser with stealth...`);
    
    const launchOptions = {
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process,ChromeRuntime",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1920,1080",
        "--disable-infobars",
        "--ignore-certificate-errors",
        "--disable-extensions",
        "--no-zygote",
      ],
    };

    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {} };
    });

    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
    await page.setUserAgent(ua);

    const collected = [];
    const seen = new Set();
    let highMatchCount = 0;

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const start = pageIndex * 25;
      const searchUrl = buildSearchUrl(start);

      console.log(`[LinkedIn] Page ${pageIndex + 1}/${maxPages}: ${searchUrl}`);
      console.log(`[LinkedIn] Navigating to page...`);

      try {
        await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
        console.log(`[LinkedIn] Page loaded`);
      } catch (navError) {
        console.warn(`[LinkedIn] Navigation: ${navError.message}`);
      }

      await page.waitForSelector("body", { timeout: 15000 }).catch(() => {});
      await delay(2000);

      await page.waitForFunction(() => {
        return document.querySelectorAll(
          ".jobs-search-results__list-item, .job-card-container, [data-job-id], .base-card, .jobs-search__results-list li"
        ).length > 0;
      }, { timeout: 15000 }).catch(() => {});

      // Nudge lazy loading
      for (let i = 0; i < 3; i += 1) {
        await autoScroll(page);
        await delay(1500);
      }

      const pageCheck = await page.evaluate(() => {
        const bodyText = document.body?.innerText?.toLowerCase() || "";
        return {
          hasCaptcha: bodyText.includes("captcha") ||
            bodyText.includes("verify you are human") ||
            bodyText.includes("unusual traffic"),
          hasJobs: document.querySelectorAll(
            ".jobs-search-results__list-item, .job-card-container, [data-job-id], .base-card, .jobs-search__results-list li"
          ).length,
          title: document.title,
        };
      });

      console.log(`[LinkedIn] Check: captcha=${pageCheck.hasCaptcha}, jobs=${pageCheck.hasJobs}`);

      if (pageCheck.hasCaptcha) {
        console.log(`[LinkedIn] Blocked by captcha, trying scroll...`);
        await page.evaluate(() => window.scrollTo(0, 500));
        await delay(2000);
      }

      if (pageCheck.hasJobs > 0) {
        console.log(`[LinkedIn] Found ${pageCheck.hasJobs} job cards, extracting...`);
      }

      console.log(`[LinkedIn] Extracting job cards...`);
      
      const jobs = await page.evaluate(() => {
        const results = [];
        const cards = Array.from(document.querySelectorAll(
          ".jobs-search-results__list-item, .job-card-container, [data-job-id], .base-card, .jobs-search__results-list li"
        ));

        const pickText = (el, selectors) => {
          for (const sel of selectors) {
            const node = el.querySelector(sel);
            const text = node?.textContent?.trim();
            if (text) return text;
          }
          return "";
        };

        cards.forEach((card) => {
          const link = card.querySelector('a.base-card__full-link, a[href*="/jobs/view"]');
          const title = pickText(card, [
            ".base-search-card__title",
            "h3",
            ".job-card-list__title",
            "[class*='job-card'] h3",
          ]) || link?.textContent?.trim() || "";
          const company = pickText(card, [
            ".base-search-card__subtitle",
            ".job-card-container__company-name",
            "[class*='company']",
            ".subtle",
            "h4",
          ]);
          const location = pickText(card, [
            ".job-search-card__location",
            ".job-card-container__metadata-item",
            "[class*='location']",
          ]);

          if (title && company) {
            results.push({
              job_title: title,
              company_name: company,
              location: location || "Remote",
              job_url: link?.href || "",
            });
          }
        });

        if (results.length === 0) {
          document.querySelectorAll('a[href*="/jobs/view"]').forEach((link) => {
            const card = link.closest("li, article, .job, [data-job-id]");
            const title = link.textContent?.trim() || "";
            const company = card?.querySelector("[class*='company'], .base-search-card__subtitle, h4")?.textContent?.trim() || "";
            const location = card?.querySelector("[class*='location'], .job-search-card__location")?.textContent?.trim() || "";

            if (title && company && title.length < 200) {
              results.push({
                job_title: title,
                company_name: company,
                location: location || "Remote",
                job_url: link.href || "",
              });
            }
          });
        }

        return results;
      });

      const validJobs = jobs
        .map((job) => ({
          ...job,
          job_url: normalizeLinkedInJobUrl(job.job_url),
        }))
        .filter((j) => j.job_title && j.company_name && j.job_url);

      const beforeCount = collected.length;
      validJobs.forEach((job) => {
        const key = buildLinkedInJobKey(job);
        if (!key || seen.has(key)) return;
        seen.add(key);
        collected.push(job);
      });

      let scored = collected;
      if (userProfile) {
        scored = scoreAndSortJobs(collected, userProfile);
        highMatchCount = scored.filter((job) => job.matchScore?.overall >= minMatchScore).length;
      }

      console.log(`[LinkedIn] Page ${pageIndex + 1} summary: jobsFound=${validJobs.length}, uniqueTotal=${collected.length}, highMatchCount=${highMatchCount}`);

      if (collected.length === beforeCount) {
        console.log(`[LinkedIn] Stopping: no new jobs on this page`);
        break;
      }

      if (targetHighMatch && highMatchCount >= targetHighMatch) {
        console.log(`[LinkedIn] Stopping: reached ${targetHighMatch} high-match jobs`);
        break;
      }
    }

    const finalJobs = userProfile ? scoreAndSortJobs(collected, userProfile) : collected;
    console.log(`[LinkedIn] Valid unique jobs: ${finalJobs.length}`);
    console.log(`=====================================\n`);

    return finalJobs.map((job) => ({
      source: "LinkedIn",
      company_name: safeText(job.company_name),
      job_title: safeText(job.job_title),
      location: safeText(job.location) || "Remote",
      job_url: normalizeLinkedInJobUrl(job.job_url),
      matchScore: job.matchScore,
    }));

  } catch (error) {
    console.error(`[LinkedIn] Error: ${error.message}`);
    return [];
  } finally {
    if (browser) {
      await browser.close();
      console.log(`[LinkedIn] Browser closed`);
    }
  }
};

const scrapeNaukri = async (query, location, portal, options = {}) => {
  console.log(`\n========== Naukri Scraper ==========`);
  console.log(`Query: "${query}", Location: "${location}"`);

  const querySlug = toSlug(query);
  const locationSlug = toSlug(location);
  const baseUrl = locationSlug
    ? fillUrl(portal.baseUrl, querySlug, locationSlug)
    : `https://www.naukri.com/${querySlug}-jobs`;
  const urlObj = new URL(baseUrl);

  if (options.roleCatId) {
    urlObj.searchParams.set("clusters", "qbusinessSize,glbl_RoleCat");
    urlObj.searchParams.set("glbl_qcrc", String(options.roleCatId));
  }

  if (options.cityTypeGid) {
    urlObj.searchParams.set("cityTypeGid", String(options.cityTypeGid));
  }

  if (options.wfhType) {
    urlObj.searchParams.set("wfhType", String(options.wfhType));
  }

  const url = urlObj.toString();
  console.log(`[Naukri] URL: ${url}`);

  try {
    const html = await fetchNaukriHtml(url);
    if (!html) {
      console.warn(`[Naukri] Fetch failed`);
      return [];
    }
    console.log(`[Naukri] HTML length: ${html.length} chars`);

    const $ = cheerio.load(html);

    const pageTitle = $("title").first().text().trim();
    if (pageTitle) {
      console.log(`[Naukri] Title: ${pageTitle}`);
    }
    const robots = $('meta[name="robots"]').attr("content");
    if (robots) {
      console.log(`[Naukri] Robots: ${robots}`);
    }

    console.log(`[Naukri] Trying selectors...`);
    
    let results = [];
    const selectorCounts = {
      dataJobId: $("[data-job-id]").length,
      jobTuple: $(".jobTuple").length,
      genericJob: $("article, .job-item, [class*='job']").length,
    };
    console.log(`[Naukri] Selector counts: data-job-id=${selectorCounts.dataJobId}, jobTuple=${selectorCounts.jobTuple}, generic=${selectorCounts.genericJob}`);
    
    $("[data-job-id]").each((_, el) => {
      const title = safeText($(el).find(".title").text());
      const company = safeText($(el).find(".companyInfo .subTitle, .company-name").text());
      const loc = safeText($(el).find(".location").text() || $(el).find(".locWdth").text());
      const jobUrl = $(el).find(".title").attr("href");

      if (title && company) {
        results.push({
          source: "Naukri",
          company_name: company,
          job_title: title,
          location: loc || "India",
          job_url: jobUrl || "",
        });
      }
    });
    
    if (results.length === 0) {
      $(".jobTuple").each((_, el) => {
        const title = safeText($(el).find("a.title").text());
        const company = safeText($(el).find(".companyInfo .subTitle").text());
        const loc = safeText($(el).find(".locWdth").text());
        const jobUrl = $(el).find("a.title").attr("href");

        if (title && company) {
          results.push({
            source: "Naukri",
            company_name: company,
            job_title: title,
            location: loc || "India",
            job_url: jobUrl || "",
          });
        }
      });
    }
    
    if (results.length === 0) {
      $("article, .job-item, [class*='job']").each((_, el) => {
        const title = safeText($(el).find("h2, h3, .title").first().text());
        const company = safeText($(el).find(".company, .companyName").first().text());
        
        if (title && company && title.length < 200) {
          results.push({
            source: "Naukri",
            company_name: company,
            job_title: title,
            location: "India",
            job_url: $(el).find("a").first().attr("href") || "",
          });
        }
      });
    }

    if (results.length === 0) {
      console.log(`[Naukri] No jobs found via selectors, trying embedded data...`);
      const embeddedJobs = [];

      const nextData = $("#__NEXT_DATA__").html();
      if (nextData) {
        console.log(`[Naukri] __NEXT_DATA__ present (${nextData.length} chars)`);
      }

      const jsonCandidates = [
        { label: "__NEXT_DATA__", raw: nextData },
        { label: "__INITIAL_STATE__", match: html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/i) },
        { label: "__PRELOADED_STATE__", match: html.match(/window\.__PRELOADED_STATE__\s*=\s*({[\s\S]*?});/i) },
        { label: "__NUXT__", match: html.match(/window\.__NUXT__\s*=\s*({[\s\S]*?});/i) },
      ];

      for (const candidate of jsonCandidates) {
        const raw = candidate.raw || (candidate.match && candidate.match[1]);
        if (!raw) continue;
        try {
          const data = JSON.parse(raw.trim());
          const possibleLists = [];

          if (data?.props?.pageProps?.initialState?.search?.results?.jobs) {
            possibleLists.push(data.props.pageProps.initialState.search.results.jobs);
          }
          if (data?.props?.pageProps?.jobs?.data) {
            possibleLists.push(data.props.pageProps.jobs.data);
          }
          if (data?.search?.results?.jobs) {
            possibleLists.push(data.search.results.jobs);
          }
          if (data?.jobs) {
            possibleLists.push(data.jobs);
          }
          if (data?.state?.jobs) {
            possibleLists.push(data.state.jobs);
          }

          possibleLists
            .filter((list) => Array.isArray(list))
            .forEach((list) => {
              list.forEach((job) => {
                embeddedJobs.push({
                  source: "Naukri",
                  company_name: job.companyName || job.company || job.recruiterName || "",
                  job_title: job.title || job.jobTitle || job.job_title || "",
                  location: job.location || job.jobLocation || job.loc || "India",
                  job_url: job.url || job.jdURL || job.jobDetailUrl || job.applyUrl || "",
                });
              });
            });
        } catch (err) {
          console.warn(`[Naukri] Failed parsing ${candidate.label}: ${err.message}`);
        }
        if (embeddedJobs.length > 0) break;
      }

      if (embeddedJobs.length === 0) {
        const ldJsonScripts = $('script[type="application/ld+json"]').toArray();
        console.log(`[Naukri] ld+json scripts: ${ldJsonScripts.length}`);
        ldJsonScripts.forEach((el) => {
          const raw = $(el).html();
          if (!raw) return;
          try {
            const data = JSON.parse(raw.trim());
            const stack = Array.isArray(data) ? data : [data];
            stack.forEach((entry) => {
              if (!entry) return;
              if (entry["@type"] === "JobPosting") {
                embeddedJobs.push({
                  source: "Naukri",
                  company_name: entry?.hiringOrganization?.name || "",
                  job_title: entry?.title || "",
                  location: entry?.jobLocation?.address?.addressLocality || "India",
                  job_url: entry?.url || "",
                });
              }
              if (Array.isArray(entry["@graph"])) {
                entry["@graph"].forEach((node) => {
                  if (node["@type"] !== "JobPosting") return;
                  embeddedJobs.push({
                    source: "Naukri",
                    company_name: node?.hiringOrganization?.name || "",
                    job_title: node?.title || "",
                    location: node?.jobLocation?.address?.addressLocality || "India",
                    job_url: node?.url || "",
                  });
                });
              }
            });
          } catch (err) {
            console.warn(`[Naukri] Failed parsing ld+json: ${err.message}`);
          }
        });
      }

      if (embeddedJobs.length > 0) {
        results = embeddedJobs.filter((job) => job.job_title && job.company_name);
      } else {
        const bodySnippet = $("body").text().replace(/\s+/g, " ").slice(0, 200);
        if (bodySnippet) {
          console.log(`[Naukri] Body snippet: ${bodySnippet}`);
        }
      }
    }

    if (results.length === 0) {
      console.log(`[Naukri] Trying browser JSON capture fallback...`);
      const browserJobs = await fetchNaukriJobsViaBrowser(url);
      if (browserJobs.length > 0) {
        results = browserJobs;
      }
    }

    console.log(`[Naukri] Found ${results.length} jobs`);
    console.log(`=================================\n`);

    return results;
  } catch (error) {
    console.error(`[Naukri] Error: ${error.message}`);
    return [];
  }
};

const scrapeIndeedViaBrowser = async (query, location, portal) => {
  console.log(`\n========== Indeed Browser Scraper ==========`);
  const url = fillUrl(portal.baseUrl, query, location);
  console.log(`[IndeedBrowser] URL: ${url}`);

  try {
    if (!puppeteer) {
      console.warn(`[IndeedBrowser] Puppeteer not available`);
      return [];
    }

    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1920,1080",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(getRandomUA());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await delay(3000);
    await autoScroll(page);
    await delay(2000);

    const html = await page.content();
    await browser.close();

    if (isBlockedPageContent(html)) {
      logPortalBlocked("Indeed", "browser render verification page");
      return [];
    }

    const $ = cheerio.load(html);
    const results = [];

    $(".job_seen_beacon").each((_, el) => {
      const title = safeText($(el).find("h2.jobTitle span, h2 a").text());
      const company = safeText($(el).find(".companyName").text());
      const loc = safeText($(el).find(".companyLocation").text());
      const jobUrl = $(el).find("a").attr("href");

      if (title && company) {
        results.push({
          source: "Indeed",
          company_name: company,
          job_title: title,
          location: loc || "Remote",
          job_url: jobUrl ? `https://in.indeed.com${jobUrl}` : "",
        });
      }
    });

    if (results.length === 0) {
      $("[data-jk]").each((_, el) => {
        const $el = $(el);
        const title = safeText($el.find("h2 a span, .jobTitle span").first().text());
        const company = safeText($el.find(".company").text());
        const loc = safeText($el.find(".location").text());
        const jk = $el.attr("data-jk");

        if (title && company) {
          results.push({
            source: "Indeed",
            company_name: company,
            job_title: title,
            location: loc || "Remote",
            job_url: jk ? `https://in.indeed.com/viewjob?jk=${jk}` : "",
          });
        }
      });
    }

    const unique = results.filter((job, idx, arr) =>
      arr.findIndex(j => j.job_title === job.job_title && j.company_name === job.company_name) === idx
    );

    console.log(`[IndeedBrowser] Found ${unique.length} unique jobs`);
    console.log(`========================================\n`);
    return unique;
  } catch (error) {
    console.error(`[IndeedBrowser] Error: ${error.message}`);
    return [];
  }
};

const scrapeIndeed = async (query, location, portal) => {
  console.log(`\n========== Indeed Scraper ==========`);
  console.log(`Query: "${query}", Location: "${location}"`);

  const url = fillUrl(portal.baseUrl, query, location);
  console.log(`[Indeed] URL: ${url}`);

  try {
    const { response, success } = await fetchWithProxy(url);
    
    if (!success || !response) {
      console.warn(`[Indeed] Fetch failed, trying browser fallback`);
      return await scrapeIndeedViaBrowser(query, location, portal);
    }

    console.log(`[Indeed] Response status: ${response.status}`);
    const html = await response.text();
    console.log(`[Indeed] HTML length: ${html.length} chars`);

    if (isBlockedPageContent(html)) {
      logPortalBlocked("Indeed", "captcha or verification page");
      return await scrapeIndeedViaBrowser(query, location, portal);
    }

    const $ = cheerio.load(html);

    let results = [];

    $(".job_seen_beacon").each((_, el) => {
      const title = safeText($(el).find("h2.jobTitle span, h2 a").text());
      const company = safeText($(el).find(".companyName").text());
      const loc = safeText($(el).find(".companyLocation").text());
      const jobUrl = $(el).find("a").attr("href");

      if (title && company) {
        results.push({
          source: "Indeed",
          company_name: company,
          job_title: title,
          location: loc || "Remote",
          job_url: jobUrl ? `https://in.indeed.com${jobUrl}` : "",
        });
      }
    });

    if (results.length === 0) {
      $("[data-jk]").each((_, el) => {
        const $el = $(el);
        const title = safeText($el.find("h2 a span, .jobTitle span").first().text());
        const company = safeText($el.find(".company").text());
        const loc = safeText($el.find(".location").text());
        const jk = $el.attr("data-jk");

        if (title && company) {
          results.push({
            source: "Indeed",
            company_name: company,
            job_title: title,
            location: loc || "Remote",
            job_url: jk ? `https://in.indeed.com/viewjob?jk=${jk}` : "",
          });
        }
      });
    }

    if (results.length === 0) {
      $(".slider_container, .mosaic-provider-jobcards").find("a").each((_, el) => {
        const href = $(el).attr("href");
        if (href && href.includes("viewjob")) {
          const parent = $(el).closest("[data-jk], .job_seen_beacon, li");
          const title = safeText($(el).text()) || safeText($(parent).find("h2").text());
          const company = safeText($(parent).find(".company").text());
          
          if (title && company) {
            results.push({
              source: "Indeed",
              company_name: company,
              job_title: title,
              location: safeText($(parent).find(".location").text()) || "Remote",
              job_url: href.startsWith("http") ? href : `https://in.indeed.com${href}`,
            });
          }
        }
      });
    }

    const unique = results.filter((job, idx, arr) => 
      arr.findIndex(j => j.job_title === job.job_title && j.company_name === job.company_name) === idx
    );

    console.log(`[Indeed] Found ${unique.length} unique jobs`);
    console.log(`=============================\n`);

    return unique;
  } catch (error) {
    console.error(`[Indeed] Error: ${error.message}`);
    return [];
  }
};

const scrapeJobs2Careers = async (query, location) => {
  console.log(`\n========== Jobs2Careers Scraper ==========`);
  console.log(`Query: "${query}", Location: "${location}"`);

  try {
    const url = `https://www.jobs2careers.com/api/search.php?keyword=${encodeURIComponent(query)}&location=${encodeURIComponent(location || "USA")}&limit=20`;
    console.log(`[Jobs2Careers] URL: ${url}`);

    const response = await fetch(url, {
      headers: {
        "User-Agent": getRandomUA(),
        "Accept": "application/json",
      },
    });

    console.log(`[Jobs2Careers] Status: ${response.status}`);
    
    if (!response.ok) {
      console.warn(`[Jobs2Careers] HTTP error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    console.log(`[Jobs2Careers] Response:`, JSON.stringify(data).substring(0, 200));

    const results = [];
    
    if (data && typeof data === "object") {
      const jobs = data.results || data.jobs || data.data || [];
      
      jobs.forEach((job) => {
        results.push({
          source: "Jobs2Careers",
          company_name: job.company || job.employer || "",
          job_title: job.title || job.name || "",
          location: job.location || "Remote",
          job_url: job.url || job.link || "",
          job_description: job.description || job.snippet || "",
        });
      });
    }

    console.log(`[Jobs2Careers] Found ${results.length} jobs`);
    console.log(`=====================================\n`);

    return results;
  } catch (error) {
    console.error(`[Jobs2Careers] Error: ${error.message}`);
    return [];
  }
};

const scrapeIndeedAlternative = async (query, location) => {
  console.log(`\n========== Indeed Alternative Scraper ==========`);

  try {
    const url = `https://www.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location || "USA")}`;
    console.log(`[IndeedAlt] URL: ${url}`);

    const { response } = await fetchWithProxy(url);
    
    if (!response) return [];

    const html = await response.text();
    if (isBlockedPageContent(html)) {
      logPortalBlocked("Indeed", "alternate route captcha or verification page");
      return [];
    }
    const $ = cheerio.load(html);

    let results = [];

    $("td#results_body").find(".jobinfo").each((_, el) => {
      const title = safeText($(el).find(".jobtitle").text());
      const company = safeText($(el).find(".company").text());
      const loc = safeText($(el).find(".location").text());

      if (title && company) {
        results.push({
          source: "Indeed",
          company_name: company,
          job_title: title,
          location: loc || "Remote",
          job_url: $(el).find("a").attr("href") || "",
        });
      }
    });

    console.log(`[IndeedAlt] Found ${results.length} jobs`);
    console.log(`========================================\n`);

    return results;
  } catch (error) {
    console.error(`[IndeedAlt] Error: ${error.message}`);
    return [];
  }
};

const runScraper = async (portal, query, location, options = {}) => {
  try {
    console.log(`\n>>>>>> Running scraper: ${portal.name} <<<<<<`);
    
    let jobs = [];
    switch (portal.scraper) {
      case "linkedin":
        jobs = await scrapeLinkedIn(query, location, portal, options);
        break;
      case "naukri":
        jobs = await scrapeNaukri(query, location, portal, options);
        break;
      case "indeed":
        jobs = await scrapeIndeed(query, location, portal);
        break;
      default:
        console.warn(`[Scraper] Unknown scraper type: ${portal.scraper}`);
    }

    console.log(`[Scraper] ${portal.name} returned ${jobs.length} jobs`);
    return jobs;
  } catch (error) {
    console.error(`[Scraper] ${portal.name} crashed: ${error.message}`);
    return [];
  }
};

const runAllFallback = async (query, location, limit) => {
  console.log(`\n========== Running All Fallback Sources ==========`);
  console.log(`Query: "${query}", Location: "${location}", Limit: ${limit}`);

  const { PUBLIC_APIS } = require("./fallbackAPI");
  const { fetchJSearch, fetchJooble } = require("./fallbackAPI");
  const { getFallbackJobs } = require("./fallbackAPI");

  const allResults = [];

  for (const api of PUBLIC_APIS) {
    console.log(`\n--- Testing ${api.name} ---`);
    try {
      const result = await testPublicAPI(api, query, location);
      if (result.length > 0) {
        allResults.push(...result);
        console.log(`[${api.name}] SUCCESS: ${result.length} jobs`);
      } else {
        console.warn(`[${api.name}] No jobs found`);
      }
    } catch (e) {
      console.error(`[${api.name}] FAILED: ${e.message}`);
    }
  }

  console.log(`\nPublic APIs total: ${allResults.length} jobs`);

  if (allResults.length < limit) {
    console.log(`\n--- Trying RapidAPI sources ---`);
    
    if (process.env.J_SEARCH_API_KEY) {
      try {
        const jsearchJobs = await fetchJSearch(query, location, limit);
        if (jsearchJobs.length > 0) {
          allResults.push(...jsearchJobs);
          console.log(`[JSearch] SUCCESS: ${jsearchJobs.length} jobs`);
        }
      } catch (e) {
        console.error(`[JSearch] FAILED: ${e.message}`);
      }
    } else {
      console.warn(`[JSearch] No API key configured`);
    }

    if (process.env.JOOBLE_API_KEY && process.env.JOOBLE_API_KEY !== "your_jooble_key_here") {
      try {
        const joobleJobs = await fetchJooble(query, location, limit);
        if (joobleJobs.length > 0) {
          allResults.push(...joobleJobs);
          console.log(`[Jooble] SUCCESS: ${joobleJobs.length} jobs`);
        }
      } catch (e) {
        console.error(`[Jooble] FAILED: ${e.message}`);
      }
    } else {
      console.warn(`[Jooble] No API key configured`);
    }
  }

  console.log(`\n========== Total Fallback Jobs: ${allResults.length} ==========\n`);

  return allResults.slice(0, limit);
};

const testPublicAPI = async (api, query, location) => {
  try {
    const params = { ...api.params };
    if (params.keyword !== undefined) params.keyword = query;
    if (params.location !== undefined) params.location = location || "USA";

    const url = new URL(api.baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) url.searchParams.append(key, String(value));
    });

    console.log(`[${api.name}] URL: ${url}`);

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": getRandomUA(),
        "Accept": "application/json",
      },
    });

    console.log(`[${api.name}] Status: ${response.status}`);

    if (!response.ok) {
      console.warn(`[${api.name}] HTTP ${response.status}`);
      return [];
    }

    const data = await response.json();
    console.log(`[${api.name}] Data keys:`, Object.keys(data || {}));

    return api.parse(data);
  } catch (error) {
    console.error(`[${api.name}] Error: ${error.message}`);
    return [];
  }
};

module.exports = {
  runScraper,
  runAllFallback,
  fillUrl,
  delay,
  scrapeLinkedIn,
  scrapeNaukri,
  scrapeIndeed,
  scrapeJobs2Careers,
  fetchWithProxy,
  testPublicAPI,
};
