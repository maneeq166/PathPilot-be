const JOB_PORTALS = [
  {
    name: "LinkedIn",
    baseUrl: "https://www.linkedin.com/jobs/search/?keywords={}&location={}&f_TPR=r2592000&f_LF=f_AL",
    scraper: "linkedin",
    icon: "fab fa-linkedin",
    color: "#0A66C2",
    priority: 1,
  },
  {
    name: "LinkedIn_Recent",
    baseUrl: "https://www.linkedin.com/jobs/search/?keywords={}&location={}&f_TPR=r604800&f_LF=f_AL",
    scraper: "linkedin",
    icon: "fab fa-linkedin",
    color: "#0A66C2",
    priority: 1,
  },
  {
    name: "Naukri",
    baseUrl: "https://www.naukri.com/{}-jobs-in-{}",
    scraper: "naukri",
    icon: "fas fa-building",
    color: "#FF7555",
    priority: 2,
  },
  {
    name: "Indeed",
    baseUrl: "https://www.indeed.com/jobs?q={}&l={}&sort=date",
    scraper: "indeed",
    icon: "fas fa-search-dollar",
    color: "#003A9B",
    priority: 3,
  },
];

module.exports = { JOB_PORTALS };
