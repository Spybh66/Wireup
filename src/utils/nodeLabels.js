// Where a component's port labels and centred name go. Shared by ComponentNode
// (CSS) and scripts/renderProject.mjs (SVG) so both agree. Pure, no DOM — text
// widths are estimates from per-character averages (measured on the canvas
// fonts and rounded up so estimates err toward "doesn't fit").
import { sidePitch, portOffsetPx } from './geometry';

export const PORT_FONT = 10;
export const CHAR_W = 5.6; // port label glyph width at PORT_FONT
export const LABEL_CHARS = 9; // longer port labels are ellipsized...
export const LABEL_MAX_W = 56; // ...at this width (× the side's scale)
export const LABEL_INSET = 6; // port label distance from the node edge

export const NAME_FONT = 11;
export const NAME_MIN_FONT = 8;
const NAME_CHAR_W = 5.6 / 11; // name glyph width per px of font size
const NAME_LEADING = 1.25;
const ICON_H = 22; // icon + gap above the name
const SUB_H = 11; // part-type line under the name
const SUB_CHAR_W = 4.1; // its glyph width (9px, measured ~4.05)
const MAX_LINES = 3;

export const ampsText = (p) => (p.type === 'PWR' && p.breaker != null ? `${p.breaker}A` : '');

// Per-side font scale so neighbouring port labels never overlap. Left/right
// labels stack vertically, so only the pitch vs line height matters; top/bottom
// labels sit side by side, so the widest label (or its amp readout, stacked
// under it) must fit within one pitch.
export function sideLabelScale(ports, size) {
  const bySide = { top: [], right: [], bottom: [], left: [] };
  for (const p of ports) bySide[p.side].push(p);
  const scaleFor = (side) => {
    const list = bySide[side];
    if (list.length <= 1) return 1;
    const vertical = side === 'left' || side === 'right';
    const spacing = sidePitch(ports, side, vertical ? size.height : size.width);
    if (vertical) return Math.max(0.55, Math.min(1, spacing / 11));
    const chars = Math.max(...list.map((p) => Math.max(Math.min(p.label.length, LABEL_CHARS), ampsText(p).length)));
    return Math.max(0.55, Math.min(1, (spacing - 4) / (chars * CHAR_W)));
  };
  return { top: scaleFor('top'), right: scaleFor('right'), bottom: scaleFor('bottom'), left: scaleFor('left') };
}

// Rendered width of one port label (ellipsized past LABEL_MAX_W) plus its amp
// readout, at the side's scale.
function portLabelWidth(p, scale) {
  const text = Math.min(p.label.length * CHAR_W, LABEL_MAX_W) * scale;
  const amps = ampsText(p) ? (ampsText(p).length * CHAR_W + 3) * scale : 0;
  return text + amps;
}

// Vertical room the labels on a top/bottom side take (one line, or two when a
// channel shows its amp rating under its name).
function sideLabelDepth(ports, side, scale) {
  const list = ports.filter((p) => p.side === side);
  if (!list.length) return 4;
  const lines = list.some((p) => ampsText(p)) ? 2 : 1;
  return Math.ceil(lines * 11 * scale) + 6;
}

// Horizontal room the port labels on a left/right side take up.
function sideLabelWidth(ports, side, scale) {
  const list = ports.filter((p) => p.side === side);
  if (!list.length) return 4;
  return Math.ceil(LABEL_INSET + Math.max(...list.map((p) => portLabelWidth(p, scale))) + 4);
}

// Greedy word wrap at a glyph width; words are never split.
function wrap(words, cw, width) {
  const lines = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && (last.length + 1 + w.length) * cw <= width) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  return lines;
}

// Fit the name into a box: the largest font (NAME_MIN_FONT..NAME_FONT) at which
// every word fits the width and the wrapped lines fit the height. Returns null
// when even the minimum font doesn't fit.
function fitName(words, box) {
  for (let fs = NAME_FONT; fs >= NAME_MIN_FONT; fs -= 0.5) {
    if (Math.max(...words.map((w) => w.length)) * NAME_CHAR_W * fs > box.w) continue;
    const lines = wrap(words, NAME_CHAR_W * fs, box.w);
    if (lines.length > MAX_LINES || lines.length * fs * NAME_LEADING > box.h) continue;
    return { fontSize: fs, lines };
  }
  return null;
}

// Layout of a node's name: the box it sits in (node-local px), its font size
// and wrapped lines, and whether the icon / part-type line fit too.
//   ports — oriented ports (sides after rotation); size — { width, height }.
// The name normally sits in the middle, padded clear of the port labels on
// every side. When side labels leave the middle too narrow (crowded or
// rotated parts), it moves to the clear band above or below the rows those
// labels occupy.
export function nameLayout(ports, size, { name = '', sub = null, showPortLabels = true } = {}) {
  const words = String(name).split(/\s+/).filter(Boolean);
  const { width: W, height: H } = size;
  const scale = sideLabelScale(ports, size);
  const pad = showPortLabels
    ? {
        l: sideLabelWidth(ports, 'left', scale.left),
        r: sideLabelWidth(ports, 'right', scale.right),
        t: sideLabelDepth(ports, 'top', scale.top),
        b: sideLabelDepth(ports, 'bottom', scale.bottom),
      }
    : { l: 8, r: 8, t: 8, b: 8 };
  const boxes = [{ x: pad.l, y: pad.t, w: W - pad.l - pad.r, h: H - pad.t - pad.b }];
  if (showPortLabels) {
    // rows (node-local y) taken by left/right labels, with half a line of slack
    const rows = ports.filter((p) => p.side === 'left' || p.side === 'right').map((p) => portOffsetPx(ports, p, H));
    if (rows.length) {
      const top = Math.min(...rows) - 8, bottom = Math.max(...rows) + 8;
      boxes.push({ x: 8, y: pad.t, w: W - 16, h: top - pad.t });
      boxes.push({ x: 8, y: bottom, w: W - 16, h: H - pad.b - bottom });
    }
  }
  // First box (middle first) where the name fits at full size; failing that,
  // whichever fits largest; failing that, the middle at the minimum font.
  let best = null;
  for (const box of boxes) {
    if (box.w <= 0 || box.h <= 0) continue;
    const fit = words.length ? fitName(words, box) : { fontSize: NAME_FONT, lines: [] };
    if (fit && (!best || fit.fontSize > best.fontSize)) best = { box, ...fit };
    if (best?.fontSize === NAME_FONT) break;
  }
  if (!best) {
    const box = boxes[0];
    best = { box: { ...box, w: Math.max(box.w, 0) }, fontSize: NAME_MIN_FONT, lines: wrap(words, NAME_CHAR_W * NAME_MIN_FONT, box.w) };
  }
  const textH = best.lines.length * best.fontSize * NAME_LEADING;
  // The part type wraps onto up to two lines between words; it's shown whole
  // or not at all — a clipped one reads as noise.
  const subWords = String(sub ?? '').split(/\s+/).filter(Boolean);
  let subLines = subWords.length ? wrap(subWords, SUB_CHAR_W, best.box.w) : [];
  const subFits =
    subLines.length > 0 &&
    subLines.length <= 2 &&
    Math.max(...subWords.map((w) => w.length)) * SUB_CHAR_W <= best.box.w &&
    best.box.h >= textH + subLines.length * SUB_H;
  if (!subFits) subLines = [];
  const showSub = subLines.length > 0;
  const showIcon = best.box.h >= textH + ICON_H + subLines.length * SUB_H;
  return { ...best, showIcon, showSub, subLines, scale };
}
