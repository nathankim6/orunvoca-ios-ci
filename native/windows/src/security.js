'use strict';
const SITE_ORIGIN = 'https://orunvoca.co.kr';

function parse(u) { try { return new URL(u); } catch { return null; } }
function isSiteUrl(u) { const p = parse(u); return !!p && p.protocol === 'https:' && p.origin === SITE_ORIGIN; }
// Exact site only (www and other subdomains are NOT allowed in-app).
function isAllowedNavigation(u) { return isSiteUrl(u); }
function isSafeExternal(u) {
  const p = parse(u);
  return !!p && p.protocol === 'https:' && !p.username && !p.password && p.origin !== SITE_ORIGIN;
}
const WEB_PREFERENCES = Object.freeze({
  contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
  allowRunningInsecureContent: false, experimentalFeatures: false
});
module.exports = { SITE_ORIGIN, isSiteUrl, isAllowedNavigation, isSafeExternal, WEB_PREFERENCES };
