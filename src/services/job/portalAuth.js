const VALID_PORTALS = ["linkedin", "naukri", "indeed"];

const normalizePortal = (portal = "") => {
  const lower = (portal || "").toLowerCase();
  if (lower.includes("linkedin")) return "linkedin";
  if (lower.includes("naukri")) return "naukri";
  if (lower.includes("indeed")) return "indeed";
  return lower;
};

const isValidPortal = (portal) => VALID_PORTALS.includes(normalizePortal(portal));

const isValidCookieArray = (cookies) =>
  Array.isArray(cookies) &&
  cookies.every((cookie) => cookie && typeof cookie.name === "string" && typeof cookie.value !== "undefined");

const STORE = new Map();

const getUserEntry = (userId) => {
  if (!STORE.has(userId)) {
    STORE.set(userId, new Map());
  }
  return STORE.get(userId);
};

const setPortalCookies = (userId, portal, cookies) => {
  if (!userId) {
    return { ok: false, message: "User ID is required" };
  }
  const normalized = normalizePortal(portal);
  if (!isValidPortal(normalized)) {
    return { ok: false, message: "Invalid portal" };
  }
  if (!isValidCookieArray(cookies)) {
    return { ok: false, message: "Invalid cookie array" };
  }

  const entry = getUserEntry(userId);
  entry.set(normalized, {
    cookies,
    updatedAt: Date.now(),
  });
  return { ok: true, message: "Portal cookies saved" };
};

const getPortalCookies = (userId, portal) => {
  if (!userId) return null;
  const normalized = normalizePortal(portal);
  if (!isValidPortal(normalized)) return null;
  const entry = STORE.get(userId);
  if (!entry) return null;
  return entry.get(normalized) || null;
};

const getAllPortalStatus = (userId) => {
  const entry = STORE.get(userId);
  const status = {};
  VALID_PORTALS.forEach((portal) => {
    const data = entry?.get(portal);
    status[portal] = {
      connected: Boolean(data?.cookies?.length),
      cookieCount: data?.cookies?.length || 0,
      updatedAt: data?.updatedAt || null,
    };
  });
  return status;
};

const clearPortalCookies = (userId, portal) => {
  if (!userId) {
    return { ok: false, message: "User ID is required" };
  }
  const normalized = normalizePortal(portal);
  if (!isValidPortal(normalized)) {
    return { ok: false, message: "Invalid portal" };
  }
  const entry = STORE.get(userId);
  if (entry) {
    entry.delete(normalized);
  }
  return { ok: true, message: "Portal cookies cleared" };
};

const getUserPortalCookiesMap = (userId) => {
  const entry = STORE.get(userId);
  if (!entry) return {};
  const result = {};
  VALID_PORTALS.forEach((portal) => {
    const data = entry.get(portal);
    if (data?.cookies?.length) {
      result[portal] = data.cookies;
    }
  });
  return result;
};

module.exports = {
  setPortalCookies,
  getPortalCookies,
  clearPortalCookies,
  getAllPortalStatus,
  getUserPortalCookiesMap,
  normalizePortal,
  isValidPortal,
  isValidCookieArray,
};
