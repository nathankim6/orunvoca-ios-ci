'use strict';
const TABLET_WIDTH = 768;
const PHONE_WIDTH = 390;
const TOOLBAR_HEIGHT = 40;
const MODES = Object.freeze({ DESKTOP: 'desktop', TABLET: 'tablet', PHONE: 'phone' });
// User-facing order: 데스크톱, 태블릿, 휴대폰.
const MODE_ORDER = Object.freeze([MODES.DESKTOP, MODES.TABLET, MODES.PHONE]);
// Maximum real view width per mode; desktop (null) fills the content width.
const MODE_WIDTHS = Object.freeze({ [MODES.DESKTOP]: null, [MODES.TABLET]: TABLET_WIDTH, [MODES.PHONE]: PHONE_WIDTH });

// Exact mode names only; anything else (case variants, padding, unknown) is desktop.
function normalizeMode(m) { return typeof m === 'string' && MODE_ORDER.includes(m) ? m : MODES.DESKTOP; }

// Returns actual bounds for the remote WebContentsView (real viewport width, full available height).
function computeRemoteBounds(mode, contentWidth, contentHeight, toolbarHeight = TOOLBAR_HEIGHT) {
  const w = Math.max(0, Math.floor(contentWidth) || 0);
  const h = Math.max(0, (Math.floor(contentHeight) || 0) - toolbarHeight);
  const y = toolbarHeight;
  const limit = MODE_WIDTHS[normalizeMode(mode)];
  if (limit) {
    const width = Math.min(limit, w);
    return { x: Math.floor((w - width) / 2), y, width, height: h };
  }
  return { x: 0, y, width: w, height: h };
}
function computeToolbarBounds(contentWidth, toolbarHeight = TOOLBAR_HEIGHT) {
  return { x: 0, y: 0, width: Math.max(0, Math.floor(contentWidth) || 0), height: toolbarHeight };
}
module.exports = { TABLET_WIDTH, PHONE_WIDTH, TOOLBAR_HEIGHT, MODES, MODE_ORDER, MODE_WIDTHS, normalizeMode, computeRemoteBounds, computeToolbarBounds };
