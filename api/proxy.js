/**
 * api/proxy.js — Vercel serverless CORS proxy for the VCP Swing Trader.
 *
 * Browsers block direct calls to Angel One (CORS). On Vercel this function
 * runs on the SAME domain as the static page, fetches the target on the
 * server side (servers don't enforce CORS), and returns it with CORS headers.
 *
 * Usage — in the app's login modal set the CORS Proxy Prefix to:
 *     https://<your-app>.vercel.app/api/proxy?url={url}
 * Keep the literal {url}; the app replaces it with the URL-encoded target,
 * e.g.  /api/proxy?url=https%3A%2F%2Fapiconnect.angelone.in%2Frest%2F...
 *
 * No dependencies — uses the global fetch available in Vercel's Node runtime.
 */

// Headers we should not forward upstream (host/length are set by fetch;
// encoding/connection are hop-by-hop; vercel/cookie are platform noise).
const STRIP = new Set([
  'host', 'connection', 'content-length', 'accept-encoding',
  'cookie', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest',
]);

function setCors(res, req) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  // Reflect the custom headers the browser asked for (X-PrivateKey, Authorization, ...)
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// Read the raw request body (handles both pre-parsed and streamed bodies).
function readRawBody(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'string') return resolve(req.body);
      if (Buffer.isBuffer(req.body)) return resolve(req.body);
      try { return resolve(JSON.stringify(req.body)); } catch (e) { return resolve(''); }
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.alloc(0)));
  });
}

module.exports = async (req, res) => {
  setCors(res, req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // Target comes from ?url=<encoded full URL>
  let target = req.query && req.query.url;
  if (Array.isArray(target)) target = target[0];
  if (!target || !/^https?:\/\//i.test(target)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Missing or invalid ?url= target.\n' +
      'Example: /api/proxy?url=' + encodeURIComponent('https://apiconnect.angelone.in/rest/...'));
  }

  // Forward the relevant request headers
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    if (STRIP.has(lk)) continue;
    if (lk.startsWith('x-vercel') || lk.startsWith('x-forwarded')) continue;
    headers[k] = v;
  }

  const method = req.method || 'GET';
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = await readRawBody(req);
  }

  try {
    const upstream = await fetch(target, init);
    const buf = Buffer.from(await upstream.arrayBuffer());

    res.statusCode = upstream.status;
    upstream.headers.forEach((val, key) => {
      const lk = key.toLowerCase();
      if (lk.startsWith('access-control-')) return;            // we set our own
      if (lk === 'content-encoding' || lk === 'transfer-encoding' || lk === 'content-length') return;
      res.setHeader(key, val);
    });
    setCors(res, req);                                          // make sure CORS survives
    res.setHeader('Content-Length', buf.length);
    return res.end(buf);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Upstream error: ' + err.message);
  }
};
