const cheerio = require("cheerio");
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

const scrapeLinkedIn = async (query, location, portal) => {
  console.log(`\n========== LinkedIn Scraper ==========`);
  console.log(`Query: "${query}", Location: "${location}"`);
  console.log(`Portal: ${portal.name}`);

  let puppeteerCore;
  try {
    puppeteerCore = require("puppeteer");
  } catch (error) {
    console.error(`[LinkedIn] Puppeteer not installed: ${error.message}`);
    return [];
  }

  const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location || "United States")}&f_TPR=r2592000&f_LF=f_AL&sortBy=DD`;
  console.log(`[LinkedIn] URL: ${searchUrl}`);

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

    browser = await puppeteerCore.launch(launchOptions);

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

    console.log(`[LinkedIn] Navigating to page...`);
    
    try {
      await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
      console.log(`[LinkedIn] Page loaded`);
    } catch (navError) {
      console.warn(`[LinkedIn] Navigation: ${navError.message}`);
      await delay(5000);
    }

    await delay(3000);

    const pageCheck = await page.evaluate(() => {
      return {
        hasCaptcha: document.body.innerText.toLowerCase().includes('captcha') || 
                    document.body.innerText.toLowerCase().includes('verify you are human') ||
                    document.body.innerText.toLowerCase().includes('unusual traffic'),
        hasJobs: document.querySelectorAll('.job-card-container, [data-job-id], .jobs-search-results__list-item').length,
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
      
      document.querySelectorAll('.job-card-container').forEach((card) => {
        const link = card.querySelector('a[href*="/jobs/view"]');
        const title = card.querySelector('h3')?.textContent?.trim() || 
                      link?.textContent?.trim() || "";
        const company = card.querySelector('.job-card-container__company-name, .subtle')?.textContent?.trim() || "";
        const location = card.querySelector('.job-card-container__metadata-item')?.textContent?.trim() || "";
        
        if (title && company) {
          results.push({
            job_title: title,
            company_name: company,
            location: location || "Remote",
            job_url: link?.href ? (link.href.startsWith('http') ? link.href : 'https://www.linkedin.com' + link.href) : "",
          });
        }
      });

      if (results.length === 0) {
        document.querySelectorAll('[data-job-id]').forEach((card) => {
          const link = card.querySelector('a[href*="/jobs/view"]');
          const title = link?.textContent?.trim() || card.querySelector('h3, .title')?.textContent?.trim() || "";
          const company = card.querySelector('.company, .company-name, [class*="company"]')?.textContent?.trim() || "";
          
          if (title && company) {
            results.push({
              job_title: title,
              company_name: company,
              location: "Remote",
              job_url: link?.href || "",
            });
          }
        });
      }

      if (results.length === 0) {
        document.querySelectorAll('a[href*="/jobs/view/?"]').forEach((link) => {
          const card = link.closest('li, article, .job, [data-job-id]');
          const title = link.textContent?.trim() || "";
          const company = card?.querySelector('.company, [class*="company"]')?.textContent?.trim() || 
                        card?.querySelector('[class*="subtitle"]')?.textContent?.trim() || "";
          
          if (title && company && title.length < 200) {
            results.push({
              job_title: title,
              company_name: company,
              location: "Remote",
              job_url: link.href || "",
            });
          }
        });
      }

      return results;
    });

    const validJobs = jobs.filter((j) => j.job_title && j.company_name && j.job_url);
    const uniqueJobs = validJobs.filter((job, idx, arr) => 
      arr.findIndex(j => j.job_title === job.job_title && j.company_name === job.company_name) === idx
    );

    console.log(`[LinkedIn] Valid unique jobs: ${uniqueJobs.length}`);
    console.log(`=====================================\n`);

    return uniqueJobs.map((job) => ({
      source: "LinkedIn",
      company_name: safeText(job.company_name),
      job_title: safeText(job.job_title),
      location: safeText(job.location) || "Remote",
      job_url: job.job_url,
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

  const baseUrl = fillUrl(portal.baseUrl, toSlug(query), toSlug(location));
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

    console.log(`[Naukri] Trying selectors...`);
    
    let results = [];
    
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

    console.log(`[Naukri] Found ${results.length} jobs`);
    console.log(`=================================\n`);

    return results;
  } catch (error) {
    console.error(`[Naukri] Error: ${error.message}`);
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
      console.warn(`[Indeed] Fetch failed`);
      return [];
    }

    console.log(`[Indeed] Response status: ${response.status}`);
    const html = await response.text();
    console.log(`[Indeed] HTML length: ${html.length} chars`);

    if (isBlockedPageContent(html)) {
      logPortalBlocked("Indeed", "captcha or verification page");
      return [];
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
        jobs = await scrapeLinkedIn(query, location, portal);
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
