const router = require("express").Router();
const { handleScrapeJobs, handleGetJobs, handleRefreshProxies, handleGetProxyStatus, handleTestSources } = require("../../controller/job");
const { isUserOrAdmin } = require("../../middleware/authMiddleware");

router.route("/").get(handleGetJobs);

router.route("/scrape").post(isUserOrAdmin, handleScrapeJobs);

router.route("/proxy/refresh").post(isUserOrAdmin, handleRefreshProxies);

router.route("/proxy/status").get(handleGetProxyStatus);

router.route("/debug/test").get(handleTestSources);

module.exports = router;
