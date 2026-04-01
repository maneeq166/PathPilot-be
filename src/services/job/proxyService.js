const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91",
];

const FREE_PROXY_APIS = [
  {
    name: "GimmeProxy",
    url: "https://gimmeproxy.com/api/get?http=true&supportsHttps=true& anonymityLevel=high&country=US",
    parse: (data) => {
      if (!data || !data.ipPort) return null;
      return `http://${data.ipPort}`;
    },
  },
  {
    name: "ProxyScrape",
    url: "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=all&simplified=true",
    parse: (data) => {
      if (!data) return null;
      const proxies = data.trim().split("\r\n");
      if (proxies.length === 0) return null;
      const randomProxy = proxies[Math.floor(Math.random() * proxies.length)];
      return `http://${randomProxy}`;
    },
  },
  {
    name: "FreeProxyList",
    url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    parse: (data) => {
      if (!data) return null;
      const proxies = data.trim().split("\n").filter(Boolean);
      if (proxies.length === 0) return null;
      const randomProxy = proxies[Math.floor(Math.random() * proxies.length)];
      return `http://${randomProxy.trim()}`;
    },
  },
];

const BACKUP_PROXIES = [
  "http://103.161.17.70:80",
  "http://103.161.17.71:80",
  "http://103.161.17.72:80",
  "http://45.142.122.246:80",
  "http://45.142.122.247:80",
  "http://139.59.124.149:80",
  "http://139.59.124.150:80",
  "http://167.172.161.45:80",
  "http://167.172.161.46:80",
  "http://178.128.103.89:80",
  "http://178.128.103.90:80",
];

const proxyCache = {
  proxies: [],
  lastFetch: 0,
  fetchInterval: 5 * 60 * 1000,
};

const fetchWithTimeout = async (url, options = {}, timeout = 8000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
};

const testProxy = async (proxy) => {
  const testUrl = "https://www.google.com/generate_204";
  const start = Date.now();
  try {
    const response = await fetchWithTimeout(testUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Proxy-Authorization": undefined,
      },
      proxy,
    }, 5000);
    const latency = Date.now() - start;
    return response.ok && latency < 3000;
  } catch {
    return false;
  }
};

const fetchFreeProxies = async () => {
  const now = Date.now();
  if (proxyCache.proxies.length > 0 && now - proxyCache.lastFetch < proxyCache.fetchInterval) {
    return proxyCache.proxies;
  }

  const allProxies = [];
  
  for (const api of FREE_PROXY_APIS) {
    try {
      console.log(`[Proxy] Fetching from ${api.name}...`);
      const response = await fetchWithTimeout(api.url, {}, 10000);
      if (response.ok) {
        const text = await response.text();
        const parsed = api.parse(text);
        
        if (parsed && typeof parsed === "string") {
          allProxies.push(parsed);
        } else if (Array.isArray(parsed)) {
          allProxies.push(...parsed);
        }
      }
    } catch (error) {
      console.warn(`[Proxy] ${api.name} failed:`, error.message);
    }
  }

  if (allProxies.length === 0) {
    console.log("[Proxy] No free proxies fetched, using backup list");
    return [...BACKUP_PROXIES];
  }

  const shuffled = allProxies.sort(() => Math.random() - 0.5);
  const tested = [];
  
  const testCount = Math.min(shuffled.length, 10);
  for (let i = 0; i < testCount; i++) {
    const isWorking = await testProxy(shuffled[i]);
    if (isWorking) {
      tested.push(shuffled[i]);
    }
  }

  const finalProxies = tested.length > 0 ? tested : [...BACKUP_PROXIES];
  
  proxyCache.proxies = finalProxies;
  proxyCache.lastFetch = now;
  
  console.log(`[Proxy] Loaded ${finalProxies.length} working proxies`);
  return finalProxies;
};

const getRandomProxy = async () => {
  const proxies = await fetchFreeProxies();
  return proxies[Math.floor(Math.random() * proxies.length)];
};

const getRandomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const buildHeaders = (customUA) => ({
  "User-Agent": customUA || getRandomUA(),
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Cache-Control": "max-age=0",
});

const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      console.log(`[Retry] Attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};

const createProxyAgent = (proxyUrl) => {
  const { HttpsAgent } = require("http");
  return {
    http: new HttpsAgent({
      keepAlive: true,
      maxSockets: 1,
      proxy: proxyUrl,
    }),
  };
};

module.exports = {
  getRandomProxy,
  getRandomUA,
  buildHeaders,
  retryWithBackoff,
  fetchFreeProxies,
  testProxy,
  createProxyAgent,
  USER_AGENTS,
  BACKUP_PROXIES,
};
