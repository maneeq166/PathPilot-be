# PathPilot Job Scraper Documentation

> **Last Updated:** April 2026  
> **Version:** 2.0.0

## Overview

Multi-portal job scraping system that aggregates job listings from various sources, normalizes them, and matches them against user resumes.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Request                           │
│                    POST /api/jobs/scrape                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Job Controller                                │
│                  handleScrapeJobs                                │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Job Service                                 │
│                    scrapeJobsService                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  1. Load user resume (optional)                           │  │
│  │  2. Load portal cookies                                   │  │
│  │  3. Run portal scrapers in parallel                       │  │
│  │  4. Run fallback APIs                                     │  │
│  │  5. Normalize all results                                 │  │
│  │  6. Deduplicate jobs                                      │  │
│  │  7. Score jobs against resume                             │  │
│  │  8. Store jobs and matches                                │  │
│  │  9. Return sorted results                                │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Response                                    │
│          { jobs: [...], summary: {...} }                        │
└─────────────────────────────────────────────────────────────────┘
```

## Supported Sources

### Primary Scrapers (Puppeteer/Cheerio)

| Portal | Status | Requires Auth | Notes |
|--------|--------|--------------|-------|
| LinkedIn | Active | Recommended | Stealth mode, rate-limited |
| Naukri | Active | Optional | Indian job portal |
| Indeed | Active | Optional | Global job search |

### Fallback APIs

| API | Provider | Requires Key | Status |
|-----|----------|--------------|--------|
| JSearch | RapidAPI | Yes (J_SEARCH_API_KEY) | Active |
| Jooble | Jooble | Yes (JOOBLE_API_KEY) | Active |
| Adzuna | Adzuna | No | Available |
| The Muse | The Muse | No | Available |
| Remotive | Remotive | No | Available |

## Key Files

### Entry Points
- `src/routes/job/index.js` - Route definitions
- `src/controller/job/index.js` - Request handlers
- `src/services/job/index.js` - Main scraping orchestration

### Scraping Implementation
- `src/services/job/scrapers.js` - Portal-specific scrapers
- `src/services/job/fallbackAPI.js` - External API clients
- `src/services/job/proxyService.js` - Proxy rotation
- `src/services/job/portalAuth.js` - Portal authentication

### Matching and Normalization
- `src/services/job/resumeMatcher.js` - Resume-to-job matching
- `src/services/job/jobSkillExtractor.js` - Skill extraction from job descriptions

### Configuration
- `src/config/jobPortals.js` - Portal URLs and settings

## Scraping Flow

### 1. Portal Scraping

```javascript
// Each portal scraper follows this pattern:
async function scrapePortal(portal, query, location, options) {
  // 1. Build URL
  const url = buildPortalUrl(portal, query, location);
  
  // 2. Fetch page (direct or via proxy)
  const html = await fetchWithProxy(url, options);
  
  // 3. Detect blocks
  if (detectBlock(html, portal.name)) {
    return { blocked: true, jobs: [] };
  }
  
  // 4. Parse HTML
  const jobs = parseHtml(html, portal.name);
  
  // 5. Return normalized jobs
  return { blocked: false, jobs };
}
```

### 2. Block Detection

```javascript
const detectBlock = (html, portalName) => {
  const patterns = {
    linkedin: ['captcha', 'unavailable', 'verify-human', 'security check'],
    naukri: ['blocked', 'access denied', 'captcha'],
    indeed: ['sorry', 'unusual traffic', 'captcha'],
  };
  
  const portalPatterns = patterns[portalName] || patterns.linkedin;
  return portalPatterns.some(p => html.toLowerCase().includes(p));
};
```

### 3. Job Normalization

All scraped jobs are normalized to a standard format:

```javascript
const normalizeJob = (rawJob, source) => ({
  title: rawJob.title || rawJob.jobTitle,
  company: rawJob.company || rawJob.company_name,
  location: rawJob.location || 'Remote',
  employmentType: normalizeType(rawJob.type),
  experienceLevel: normalizeExperience(rawJob.experience),
  salaryRange: rawJob.salary || null,
  description: rawJob.description || rawJob.snippet || '',
  skills: extractSkills(rawJob.description),
  url: rawJob.url || rawJob.link,
  source: source,
  sourceId: `${source}_${hash(rawJob.url || rawJob.title)}`,
  postedAt: parseDate(rawJob.date || rawJob.postedAt),
});
```

### 4. Resume Matching

```javascript
const calculateMatchScore = (job, userResume) => {
  const userSkills = flattenSkills(userResume.skills);
  const jobSkills = extractSkills(job.description);
  
  // Skill match (60% weight)
  const matchedSkills = userSkills.filter(s => 
    jobSkills.some(js => fuzzyMatch(s, js))
  );
  const skillMatch = (matchedSkills.length / jobSkills.length) * 100;
  
  // Experience match (40% weight)
  const expMatch = calculateExperienceMatch(
    userResume.matchingMeta?.experienceLevel,
    job.experienceLevel
  );
  
  // Overall score
  const overall = Math.min(100, Math.max(10, 
    (skillMatch * 0.6) + (expMatch * 0.4)
  ));
  
  return {
    overall: Math.round(overall),
    skillMatch: Math.round(skillMatch),
    experienceMatch: Math.round(expMatch),
    matchedSkills,
    missingSkills: jobSkills.filter(s => !matchedSkills.includes(s))
  };
};
```

## API Endpoints

### POST /api/jobs/scrape

Scrape jobs from all configured sources.

**Request:**
```json
{
  "query": "software engineer",
  "location": "bangalore",
  "limit": 15,
  "source": "all"
}
```

**Response:**
```json
{
  "statusCode": 201,
  "success": true,
  "data": {
    "jobs": [
      {
        "title": "Software Engineer",
        "company": "Google",
        "location": "Bangalore",
        "source": "LinkedIn",
        "matchScore": {
          "overall": 85,
          "skillMatch": 80,
          "experienceMatch": 90
        }
      }
    ],
    "summary": {
      "total": 15,
      "bySource": {
        "LinkedIn": 8,
        "Naukri": 4,
        "JSearch": 3
      }
    }
  }
}
```

### GET /api/jobs/

Retrieve stored jobs with filters.

**Query:** `?q=developer&location=remote&source=linkedin&page=1&limit=20`

### POST /api/jobs/proxy/refresh

Refresh the proxy pool.

### GET /api/jobs/proxy/status

Get proxy health and API key status.

### GET /api/jobs/debug/test

Test all scrapers and APIs.

### POST /api/jobs/portals/cookies

Set portal cookies for authenticated scraping.

**Request:**
```json
{
  "portal": "linkedin",
  "cookies": [{"name": "li_at", "value": "AQED..."}]
}
```

### DELETE /api/jobs/portals/cookies/:portal

Clear portal cookies.

## Configuration

### Portal URLs

Configured in `src/config/jobPortals.js`:

```javascript
const JOB_PORTALS = [
  {
    name: "LinkedIn",
    baseUrl: "https://www.linkedin.com/jobs/search/?keywords={}&location={}&f_TPR=r2592000&f_LF=f_AL",
    scraper: "linkedin",
    icon: "fab fa-linkedin",
    color: "#0A66C2",
    priority: 1
  },
  {
    name: "Naukri",
    baseUrl: "https://www.naukri.com/{}-jobs-in-{}",
    scraper: "naukri",
    priority: 2
  },
  {
    name: "Indeed",
    baseUrl: "https://in.indeed.com/jobs?q={}&l={}&sort=date",
    scraper: "indeed",
    priority: 3
  }
];
```

### Environment Variables

```env
# API Keys (optional but recommended)
J_SEARCH_API_KEY=your-rapidapi-key
JOOBLE_API_KEY=your-jooble-key

# Portal Cookies (optional, improves success rate)
LINKEDIN_COOKIES_JSON=[{"name":"li_at","value":"..."}]
NAUKRI_COOKIES_JSON=[...]
INDEED_COOKIES_JSON=[...]
```

## Troubleshooting

### Scraping Returns Empty Results

1. Check proxy status: `GET /api/jobs/proxy/status`
2. Test scrapers: `GET /api/jobs/debug/test`
3. Verify portal cookies are set
4. Check if portals are blocking requests

### Portals Being Blocked

1. Set portal cookies via `POST /api/jobs/portals/cookies`
2. Use proxy rotation (enabled by default)
3. Wait and retry with delay
4. Fallback to external APIs (JSearch, Jooble)

### Rate Limiting

1. Reduce scraping frequency
2. Use authenticated requests (cookies)
3. Rotate proxies more frequently
4. Rely on fallback APIs during high-traffic periods

### Inconsistent Results

1. Portal HTML changes frequently
2. Implement caching for stable results
3. Normalize results before storage
4. Log parsing failures for debugging

## Performance Notes

- Scrapers run in parallel for faster results
- Blocked portals are skipped gracefully
- Results are cached in memory (15-minute TTL)
- Maximum 50 jobs per request
- Deduplication happens before storage

## Future Enhancements

- Add more job portals (Foundit, FreshersWorld, TimesJobs, Instahyre)
- Implement Redis caching for stable results
- Add webhook support for real-time job alerts
- Integrate with job board APIs directly
- Add salary prediction based on skills and location

---

*Version: 2.0.0 | Last Updated: April 2026*
