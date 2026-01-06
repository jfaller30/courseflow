/* ============================================================================
   CONFIG / CONSTANTS
============================================================================ */

// Layout constants
export const NODE = { width: 300, height: 150, gapX: 400, gapY: 50, colPadTop: 75, colPadSide: 50 };
const EDGE = { pad: 5 };

// Routing tunables
const GUTTER = 40;
const TRACK_CLEAR = 8;
const TRACK_STEP = 20;
const IN_LANE_STEP = 14;
const SLOT_MARGIN = 10;

/* ============================================================================
   GEOMETRY + ROUTING
============================================================================ */

const colLeft = (t) => t * NODE.gapX + NODE.colPadSide;
const colRight = (t) => colLeft(t) + NODE.width;
const gutR = (t) => colRight(t) + GUTTER;
const gutL = (t) => colLeft(t) - GUTTER;

function laneXLeftOfTarget(targetTerm, idx, n) {
  const center = gutL(targetTerm);
  const k = idx - (n - 1) / 2;
  return center - k * IN_LANE_STEP;
}

function laneXRightOfTarget(targetTerm, idx, n) {
  const center = gutR(targetTerm);
  const k = idx - (n - 1) / 2;
  return center + k * IN_LANE_STEP;
}

function slotYOnTarget(targetRect, idx, n) {
  const { y, h } = targetRect;
  const usable = Math.max(6, h - 2 * SLOT_MARGIN);
  return y + SLOT_MARGIN + usable * ((idx + 0.5) / Math.max(1, n));
}

export function rectFor(course) {
  const x = course.term * NODE.gapX + NODE.colPadSide;
  const y = NODE.colPadTop + course.row * (NODE.height + NODE.gapY);
  return { x, y, w: NODE.width, h: NODE.height };
}

/**
 * Edge path generator.
 */
export function trackRouter(from, to, type = "prereq", idx = -1, n = 0, obstacles = []) {
  const IN_LANE_X_OFFSET = 18;
  const DETOUR_EXTRA = 10;
  const MID_Y_BIAS = 44;
  const BASE_DETOUR_PAD = 10;
  const CLAMP_EXTRA = 10;

  const a = rectFor(from);
  const b = rectFor(to);

  const goingForward = from.term < to.term;
  const startX = goingForward ? (a.x + a.w + EDGE.pad) : (a.x - EDGE.pad);
  const startY = a.y + a.h / 2;
  const endX = goingForward ? (b.x - EDGE.pad) : (b.x + b.w + EDGE.pad);

  const sameRow = from.row === to.row;
  const termDelta = Math.abs(to.term - from.term);

  const inLaneX = goingForward
    ? laneXLeftOfTarget(to.term, Math.max(0, idx), Math.max(1, n))
    : laneXRightOfTarget(to.term, Math.max(0, idx), Math.max(1, n)) + IN_LANE_X_OFFSET;

  const landY = slotYOnTarget(b, Math.max(0, idx), Math.max(1, n));

  if (from.term === to.term) {
    const x = a.x + a.w / 2;
    return to.row > from.row
      ? `M ${x} ${a.y + a.h} V ${b.y}`
      : `M ${x} ${a.y} V ${b.y + b.h}`;
  }

  if (sameRow && termDelta === 1) {
    if (n <= 1) return `M ${startX} ${startY} H ${endX}`;
    return [`M ${startX} ${startY}`, `H ${inLaneX}`, `V ${landY}`, `H ${endX}`].join(" ");
  }

  if (sameRow && termDelta > 1) {
    const k = Math.max(0, idx) - (Math.max(1, n) - 1) / 2;
    const above = k < 0;
    const rowTop = a.y;
    const rowBottom = a.y + a.h;
    const trackY = above
      ? rowTop - TRACK_CLEAR - Math.abs(k) * TRACK_STEP + BASE_DETOUR_PAD
      : rowBottom + TRACK_CLEAR + Math.abs(k) * TRACK_STEP + BASE_DETOUR_PAD;

    const outLaneX = goingForward ? gutR(from.term) : gutL(from.term);
    return [
      `M ${startX} ${startY}`,
      `H ${outLaneX - IN_LANE_X_OFFSET}`,
      `V ${trackY}`,
      `H ${inLaneX - 2 * IN_LANE_X_OFFSET}`,
      `V ${landY}`,
      `H ${endX}`,
    ].join(" ");
  }

  if (!sameRow && termDelta >= 2) {
    const rects = (obstacles || []).map((o) => ({
      left: o.x,
      right: o.x + o.w,
      top: o.y - TRACK_CLEAR,
      bot: o.y + o.h + TRACK_CLEAR,
    }));

    const y0 = Math.min(startY, landY);
    const y1 = Math.max(startY, landY);
    const band = rects.filter((r) => !(r.bot < y0 || r.top > y1));

    const CLAMP_PAD = TRACK_CLEAR + TRACK_STEP + CLAMP_EXTRA;
    const clampTop = Math.min(a.y, b.y) - CLAMP_PAD;
    const clampBottom = Math.max(a.y + a.h, b.y + b.h) + CLAMP_PAD;

    if (band.length === 0) {
      const leadX = startX + IN_LANE_X_OFFSET;
      const nearX = endX - IN_LANE_X_OFFSET;
      const midBias = from.row <= to.row ? CLAMP_PAD : -CLAMP_PAD;
      const midY = Math.max(clampTop, Math.min(clampBottom, (startY + landY) / 2 + midBias));
      return [
        `M ${startX} ${startY}`,
        `H ${leadX}`,
        `V ${midY - MID_Y_BIAS}`,
        `H ${nearX - 2 * IN_LANE_X_OFFSET}`,
        `V ${landY}`,
        `H ${endX}`,
      ].join(" ");
    }

    const minBlock = Math.min(...band.map((r) => r.top));
    const maxBlock = Math.max(...band.map((r) => r.bot));
    const k = Math.max(0, idx) - (Math.max(1, n) - 1) / 2;
    const sep = Math.abs(k) * TRACK_STEP;

    let detourY;
    if (from.row > to.row) detourY = maxBlock + sep + DETOUR_EXTRA;
    else if (from.row < to.row) detourY = maxBlock + sep + DETOUR_EXTRA;
    else detourY = minBlock - sep - DETOUR_EXTRA;

    detourY = Math.max(clampTop, Math.min(clampBottom, detourY));

    const leadX = startX + IN_LANE_X_OFFSET;
    return [
      `M ${startX} ${startY}`,
      `H ${leadX}`,
      `V ${detourY}`,
      `H ${inLaneX - 2 * IN_LANE_X_OFFSET}`,
      `V ${landY}`,
      `H ${endX}`,
    ].join(" ");
  }

  if (!sameRow && termDelta === 1) {
    const y0 = Math.min(startY, landY);
    const y1 = Math.max(startY, landY);
    const overlap = (obstacles || [])
      .map((o) => ({ top: o.y - TRACK_CLEAR, bot: o.y + o.h + TRACK_CLEAR }))
      .filter((r) => !(r.bot < y0 || r.top > y1));

    if (overlap.length === 0) {
      return [`M ${startX} ${startY}`, `H ${inLaneX - 2 * IN_LANE_X_OFFSET}`, `V ${landY}`, `H ${endX}`].join(" ");
    }

    const minBlock = Math.min(...overlap.map((r) => r.top));
    const maxBlock = Math.max(...overlap.map((r) => r.bot));
    const k = Math.max(0, idx) - (Math.max(1, n) - 1) / 2;
    const sep = Math.abs(k) * TRACK_STEP;
    const detourY = from.row < to.row ? minBlock - sep : maxBlock + sep;

    const nearX = endX - IN_LANE_X_OFFSET;
    return [`M ${startX} ${startY}`, `H ${inLaneX}`, `V ${detourY}`, `H ${nearX}`, `V ${landY}`, `H ${endX}`].join(" ");
  }

  const outLaneX = gutR(from.term);
  const k = Math.max(0, idx) - (Math.max(1, n) - 1) / 2;
  const spread = Math.abs(k) * TRACK_STEP;
  const topBoth = Math.min(a.y, b.y);
  const bottomBoth = Math.max(a.y + a.h, b.y + b.h);
  const goUp = to.row < from.row;
  const trackY = goUp ? topBoth - TRACK_CLEAR - spread : bottomBoth + TRACK_CLEAR + spread;

  return [`M ${startX} ${startY}`, `H ${outLaneX}`, `V ${trackY}`, `H ${inLaneX}`, `V ${landY}`, `H ${endX}`].join(" ");
}