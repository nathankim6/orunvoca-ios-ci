'use strict';
const SITE_ORIGIN = 'https://orunvoca.co.kr';

function parse(u) { try { return new URL(u); } catch { return null; } }
// URL.origin ignores credentials, so reject username/password explicitly.
function isSiteUrl(u) { const p = parse(u); return !!p && p.protocol === 'https:' && p.origin === SITE_ORIGIN && !p.username && !p.password; }
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

// Site test-paper printing: window.open('', '_blank') -> document.write(html) -> print() -> close().
// Exactly one same-origin about:blank popup opened by the trusted site page is allowed at a time.
const PRINT_POPUP_URL = 'about:blank';
const PRINT_POPUP_LIMIT = 1;
const PRINT_POPUP_DISPOSITIONS = Object.freeze(['foreground-tab', 'new-window']);
// window.open('') may be reported as '' or 'about:blank'; both are the creator-origin initial empty document.
const isBlankPopupUrl = (u) => u === PRINT_POPUP_URL || u === '';
function isPrintPopupRequest(details, openerUrl, openCount) {
  return !!details && isBlankPopupUrl(details.url) && PRINT_POPUP_DISPOSITIONS.includes(details.disposition) &&
    !details.postBody && isSiteUrl(openerUrl) && Number.isInteger(openCount) && openCount >= 0 && openCount < PRINT_POPUP_LIMIT;
}
// Checked again after creation against the popup's real (inherited) frame origin.
function isTrustedPrintPopup(childUrl, childOrigin) {
  return isBlankPopupUrl(childUrl) && childOrigin === SITE_ORIGIN;
}
function printPopupWindowOptions() {
  return { width: 900, height: 1000, title: '옳은VOCA 인쇄', autoHideMenuBar: true, show: true,
    webPreferences: { ...WEB_PREFERENCES, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false } };
}
module.exports = { SITE_ORIGIN, isSiteUrl, isAllowedNavigation, isSafeExternal, WEB_PREFERENCES,
  PRINT_POPUP_URL, PRINT_POPUP_LIMIT, isPrintPopupRequest, isTrustedPrintPopup, printPopupWindowOptions };
