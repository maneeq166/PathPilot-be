const router = require("express").Router();
const {
  handleScrapeJobs,
  handleGetJobs,
  handleRefreshProxies,
  handleGetProxyStatus,
  handleTestSources,
  handleSetPortalCookies,
  handleGetPortalStatus,
  handleClearPortalCookies,
} = require("../../controller/job");
const { isUserOrAdmin } = require("../../middleware/authMiddleware");

router.route("/").get(handleGetJobs);

router.route("/scrape").post(isUserOrAdmin, handleScrapeJobs);

router.route("/proxy/refresh").post(isUserOrAdmin, handleRefreshProxies);

router.route("/proxy/status").get(handleGetProxyStatus);

router.route("/debug/test").get(handleTestSources);

router.route("/portals/cookies").get(isUserOrAdmin, handleGetPortalStatus);
router.route("/portals/cookies").post(isUserOrAdmin, handleSetPortalCookies);
router.route("/portals/cookies/:portal").delete(isUserOrAdmin, handleClearPortalCookies);

module.exports = router;
