#!/usr/bin/env node
/**
 * angel-cors-proxy.js — tiny zero-dependency CORS proxy for the
 * VCP Swing Trader (vcp_swing_trader_angelone.html).
 *
 * Why: browsers block direct calls to Angel One (CORS). This proxy
 * runs on your machine, forwards the request to Angel One (servers
 * don't enforce CORS), and adds the CORS header on the way back so
 * the HTML page can read the real rates.
 *
 * Usage:
 *   node angel-cors-proxy.js            # listens on http://localhost:8080
 *   node angel-cors-proxy.js 9000       # custom port
 *
 * Then in the app's login modal set:
 *   CORS Proxy Prefix = http://localhost:8080/
 *
 * The page calls:  http://localhost:8080/https://apiconnect.angelone.in/rest/...
 * i.e. the FULL target URL is appended after the prefix (cors-anywhere style).
 *
 * No npm install needed — uses only Node's built-in modules.
 */

const http  = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = parseInt(process.argv[2], 10) || 8080;

// Headers we must NOT forward upstream (hop-by-hop / browser-managed)
const STRIP_REQ_HEADERS = new Set([
  'host', 'origin', 'referer', 'connection', 'content-length',
  'accept-encoding', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'user-agent'
]);

function setCors(res, reqHeaders) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  // Reflect whatever custom headers the browser asked for (X-PrivateKey, Authorization, etc.)
  const reqd = reqHeaders['access-control-request-headers'];
  res.setHeader('Access-Control-Allow-Headers', reqd || '*');
  res.setHeader('Access-Control-Max-Age', '86400');
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCors(res, req.headers);
    res.writeHead(204);
    return res.end();
  }

  // The target URL is everything after the leading "/"
  let target = req.url.slice(1);
  try { target = decodeURIComponent(target); } catch (e) { /* keep raw */ }

  if (!/^https?:\/\//i.test(target)) {
    setCors(res, req.headers);
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Bad request. Expected: /<full-target-url>\n' +
      'Example: /https://apiconnect.angelone.in/rest/auth/...');
  }

  let upstreamUrl;
  try {
    upstreamUrl = new URL(target);
  } catch (e) {
    setCors(res, req.headers);
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Invalid target URL: ' + target);
  }

  // Build forwarded headers (strip the browser-managed ones)
  const fwdHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!STRIP_REQ_HEADERS.has(k.toLowerCase())) fwdHeaders[k] = v;
  }
  fwdHeaders['host'] = upstreamUrl.host;

  const lib = upstreamUrl.protocol === 'http:' ? http : https;
  const options = {
    method: req.method,
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port || (upstreamUrl.protocol === 'http:' ? 80 : 443),
    path: upstreamUrl.pathname + upstreamUrl.search,
    headers: fwdHeaders
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    setCors(res, req.headers);
    // Copy upstream headers (except CORS ones we set ourselves)
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (k.toLowerCase().startsWith('access-control-')) continue;
      res.setHeader(k, v);
    }
    res.writeHead(proxyRes.statusCode || 502);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    setCors(res, req.headers);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Upstream error: ' + err.message);
  });

  // Forward the request body (POST/PUT)
  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log('───────────────────────────────────────────────────────────');
  console.log('  Angel One CORS proxy running');
  console.log('  Prefix to paste in the app:  http://localhost:' + PORT + '/');
  console.log('  Forwards to any https/http target appended after the "/".');
  console.log('  Press Ctrl+C to stop.');
  console.log('───────────────────────────────────────────────────────────');
});
