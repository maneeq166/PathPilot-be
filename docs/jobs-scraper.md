# PathPilot - Job Scraper

## Overview

Multi-portal job scraping system using direct scraping (Puppeteer/Cheerio).

## Supported Portals

- LinkedIn
- Naukri
- Indeed
- Foundit
- FreshersWorld
- TimesJobs
- Instahyre

## Flow

```
Client → POST /api/jobs/scrape
      → Controller
      → Service Layer
      → Portal Scrapers
      → Normalize Data
      → Deduplicate
      → Store in DB
      → Return Response
```

## Implementation

- Job model
- Puppeteer/Cheerio scrapers
- Proxy rotation
- Data normalization
- Deduplication

## Endpoints (Pending)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/jobs/scrape | Scrape job listings |
| GET | /api/jobs/match | Get matched jobs |
| POST | /api/jobs/save | Save job |
| GET | /api/jobs/saved | Get saved jobs |
