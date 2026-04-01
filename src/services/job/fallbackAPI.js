const { getRandomUA } = require("./proxyService");

const fetchJSearch = async (query, location, limit = 20) => {
  console.log(`\n[========== JSearch API ==========`);
  console.log(`Query: "${query}", Location: "${location}"`);

  const apiKey = process.env.J_SEARCH_API_KEY;
  
  if (!apiKey || apiKey === "your_rapidapi_key_here" || apiKey.startsWith("your_")) {
    console.warn(`[JSearch] No valid API key configured`);
    return [];
  }

  try {
    const searchQuery = location 
      ? `${query} in ${location}` 
      : query;
    
    const url = new URL("https://jsearch.p.rapidapi.com/search");
    url.searchParams.append("query", searchQuery);
    url.searchParams.append("page", "1");
    url.searchParams.append("num_pages", "1");
    url.searchParams.append("limit", String(Math.min(limit, 50)));
    url.searchParams.append("date_posted", "month");
    url.searchParams.append("sort_by", "recentness");

    console.log(`[JSearch] Query: ${searchQuery}`);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
    });

    console.log(`[JSearch] Status: ${response.status}`);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        console.error(`[JSearch] Invalid API key or quota exceeded`);
      } else if (response.status === 429) {
        console.warn(`[JSearch] Rate limited`);
      } else {
        console.warn(`[JSearch] HTTP Error: ${response.status}`);
      }
      return [];
    }

    const data = await response.json();
    
    if (!data?.data || !Array.isArray(data.data)) {
      console.warn(`[JSearch] Invalid response format`);
      return [];
    }

    const jobs = data.data.map((job) => ({
      source: job.source || "JSearch",
      company_name: job.employer_name || job.company_name || "",
      job_title: job.job_title || "",
      location: job.job_location || job.job_country || "Remote",
      job_url: job.job_google_link || job.job_link || "",
      job_description: job.job_description || "",
      salary_range: job.salary ? `${job.salary.minimum || 0} - ${job.salary.maximum || 0} ${job.salary.currency || "USD"}` : null,
      employment_type: job.job_employment_type || "",
      posted_date: job.job_posted_at_datetime_utc || null,
    }));

    console.log(`[JSearch] Found ${jobs.length} jobs`);
    console.log(`================================\n`);

    return jobs;
  } catch (error) {
    console.error(`[JSearch] Error: ${error.message}`);
    return [];
  }
};

const fetchJooble = async (query, location, limit = 20) => {
  console.log(`\n[========== Jooble API ==========`);
  console.log(`Query: "${query}", Location: "${location}"`);

  if (!process.env.JOOBLE_API_KEY || process.env.JOOBLE_API_KEY === "your_jooble_key_here") {
    console.warn(`[Jooble] No API key configured`);
    return [];
  }

  try {
    console.log(`[Jooble] Sending POST request...`);

    const response = await fetch("https://jooble.org/api/" + process.env.JOOBLE_API_KEY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: JSON.stringify({
        keywords: query,
        location: location || "",
        page: 1,
        resultPerPage: Math.min(limit, 50),
      }),
    });

    console.log(`[Jooble] Status: ${response.status}`);

    if (!response.ok) {
      console.warn(`[Jooble] HTTP ${response.status}`);
      return [];
    }

    const data = await response.json();
    console.log(`[Jooble] Response keys:`, Object.keys(data || {}));

    if (!data?.jobs) {
      console.warn(`[Jooble] No jobs in response`);
      return [];
    }

    const jobs = data.jobs.map((job) => ({
      source: "Jooble",
      company_name: job.company || "",
      job_title: job.title || "",
      location: job.location || "Remote",
      job_url: job.link || "",
      job_description: job.snippet || job.description || "",
      salary_range: job.salary || null,
      employment_type: job.type || "",
    }));

    console.log(`[Jooble] Found ${jobs.length} jobs`);
    console.log(`===============================\n`);

    return jobs;
  } catch (error) {
    console.error(`[Jooble] Error: ${error.message}`);
    return [];
  }
};

const PUBLIC_APIS = [
  {
    name: "Adzuna",
    baseUrl: "https://api.adzuna.com/v1/api/jobs/us/search/1",
    params: {
      app_id: "demo",
      app_key: "demo",
    },
    parse: (data) => {
      if (!data?.results) return [];
      return data.results.map((job) => ({
        source: "Adzuna",
        company_name: job.company?.display_name || job.company || "",
        job_title: job.title || "",
        location: job.location?.display_name || job.location || "Remote",
        job_url: job.redirect_url || job.url || "",
        job_description: job.description || "",
        salary_range: job.salary_min ? `$${job.salary_min} - $${job.salary_max}` : null,
        employment_type: job.contract_type || "",
      }));
    },
  },
  {
    name: "The Muse",
    baseUrl: "https://www.themuse.com/api/public/jobs",
    params: {
      page: 0,
      desc: true,
      location: "United States",
      keyword: "",
    },
    parse: (data) => {
      if (!data?.results) return [];
      return data.results.map((job) => ({
        source: "TheMuse",
        company_name: job.company?.name || "",
        job_title: job.name || "",
        location: job.locations?.[0]?.name || "Remote",
        job_url: job.refs?.landing_page || "",
        job_description: job.contents || "",
        employment_type: job.employment_type || "",
      }));
    },
  },
  {
    name: "Remotive",
    baseUrl: "https://remotive.com/api/remote-jobs",
    params: {
      category: "software-development",
      limit: 50,
      keyword: "",
    },
    parse: (data) => {
      if (!data?.jobs) return [];
      return data.jobs.map((job) => ({
        source: "Remotive",
        company_name: job.company_name || "",
        job_title: job.title || "",
        location: job.candidate_required_location || "Remote",
        job_url: job.url || "",
        job_description: job.description || "",
        salary_range: job.salary || null,
        employment_type: job.job_type || "",
      }));
    },
  },
  {
    name: "RemotiveAll",
    baseUrl: "https://remotive.com/api/remote-jobs",
    params: {
      category: "",
      limit: 50,
      keyword: "",
    },
    parse: (data) => {
      if (!data?.jobs) return [];
      return data.jobs.map((job) => ({
        source: "Remotive",
        company_name: job.company_name || "",
        job_title: job.title || "",
        location: job.candidate_required_location || "Remote",
        job_url: job.url || "",
        job_description: job.description || "",
        salary_range: job.salary || null,
        employment_type: job.job_type || "",
      }));
    },
  },
];

const fetchFromAPI = async (api, query, location) => {
  try {
    const params = { ...api.params };
    
    if (params.keyword !== undefined) {
      params.keyword = query;
    }
    if (params.location !== undefined) {
      params.location = location || "USA";
    }

    const url = new URL(api.baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") {
        url.searchParams.append(key, String(value));
      }
    });

    console.log(`[${api.name}] URL: ${url.toString().substring(0, 100)}...`);

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
    const jobs = api.parse(data);

    console.log(`[${api.name}] Found ${jobs.length} jobs`);
    return jobs;
  } catch (error) {
    console.error(`[${api.name}] Failed: ${error.message}`);
    return [];
  }
};

const getFallbackJobs = async (query, location, limit = 20) => {
  console.log(`\n========================================`);
  console.log(`FALLBACK JOB SEARCH`);
  console.log(`Query: "${query}", Location: "${location}"`);
  console.log(`========================================\n`);

  const results = [];

  for (const api of PUBLIC_APIS) {
    console.log(`\n--- ${api.name} ---`);
    const jobs = await fetchFromAPI(api, query, location);
    if (jobs.length > 0) {
      results.push(...jobs);
      console.log(`[${api.name}] +${jobs.length} jobs`);
    }
  }

  console.log(`\nPublic APIs: ${results.length} jobs`);

  if (results.length < limit) {
    console.log(`\n--- RapidAPI Sources ---`);
    
    const jsearchJobs = await fetchJSearch(query, location, limit);
    if (jsearchJobs.length > 0) {
      results.push(...jsearchJobs);
      console.log(`[JSearch] +${jsearchJobs.length} jobs`);
    }

    const joobleJobs = await fetchJooble(query, location, limit);
    if (joobleJobs.length > 0) {
      results.push(...joobleJobs);
      console.log(`[Jooble] +${joobleJobs.length} jobs`);
    }
  }

  const unique = results.filter((job, idx, arr) => {
    const key = `${job.job_title}-${job.company_name}-${job.location}`;
    return arr.findIndex(j => `${j.job_title}-${j.company_name}-${j.location}` === key) === idx;
  });

  console.log(`\n========================================`);
  console.log(`TOTAL: ${unique.length} unique jobs`);
  console.log(`========================================\n`);

  return unique.slice(0, limit);
};

module.exports = {
  getFallbackJobs,
  fetchJSearch,
  fetchJooble,
  PUBLIC_APIS,
  fetchFromAPI,
};
