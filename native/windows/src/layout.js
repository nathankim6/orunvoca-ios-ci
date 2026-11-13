'use strict';
const PHONE_WIDTH = 390;
const TOOLBAR_HEIGHT = 40;
const MODES = Object.freeze({ DESKTOP: 'desktop', PHONE: 'phone' });

function normalizeMode(m) { return m === MODES.PHONE ? MODES.PHONE : MODES.DESKTOP; }

// Returns actual bounds for the remote WebContentsView (real viewport width).
function computeRemoteBounds(mode, contentWidth, contentHeight, toolbarHeight = TOOLBAR_HEIGHT) {
  const w = Math.max(0, Math.floor(contentWidth));
  const h = Math.max(0, Math.floor(contentHeight) - toolbarHeight);
  const y = toolbarHeight;
  if (normalizeMode(mode) === MODES.PHONE) {
    const width = Math.min(PHONE_WIDTH, w);
    return { x: Math.floor((w - width) / 2), y, width, height: h };
  }
  return { x: 0, y, width: w, height: h };
}
function computeToolbarBounds(contentWidth, toolbarHeight = TOOLBAR_HEIGHT) {
  return { x: 0, y: 0, width: Math.max(0, Math.floor(contentWidth)), height: toolbarHeight };
}
module.exports = { PHONE_WIDTH, TOOLBAR_HEIGHT, MODES, normalizeMode, computeRemoteBounds, computeToolbarBounds };
