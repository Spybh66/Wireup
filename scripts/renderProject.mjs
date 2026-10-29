// Render a Wireup project JSON to PNG using the real routing engine, for visual QA.
import fs from 'fs';
import { Resvg } from '@resvg/resvg-js';
import { computeAllRoutes } from '../src/utils/routeGraph.js';
import { getDefinition } from '../src/data/componentLibrary.js';
import { portPosition, nodeRect, nodeRotation, nodeSize, orientedPorts } from '../src/utils/geometry.js';
import { nameLayout, PORT_FONT, CHAR_W, LABEL_INSET, LABEL_MAX_W } from '../src/utils/nodeLabels.js';
import { typeColor } from '../src/data/wireTypes.js';

const file = process.argv[2] || 'examples/test.json';
const out = process.argv[3] || '/tmp/render.png';
const proj = JSON.parse(fs.readFileSync(file, 'utf8'));
const { nodes: allNodes, edges, layers, customDefinitions = [] } = proj;

// Split component nodes (routable, have a definition) from annotations (zones/notes).
const nodes = allNodes.filter((n) => getDefinition(n.data?.definitionId, customDefinitions));
const zones = allNodes.filter((n) => n.type === 'zone');
const notes = allNodes.filter((n) => n.type === 'note');

// Zones go to the router too: their title strips are routing keep-outs.
const { routes } = computeAllRoutes({ nodes: [...nodes, ...zones], edges, layers, customDefinitions });

// bounds
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const ext = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
for (const n of nodes) {
  const def = getDefinition(n.data.definitionId, customDefinitions);
  const r = nodeRect(n, def);
  ext(r.x, r.y); ext(r.x + r.w, r.y + r.h);
}
for (const z of zones) {
  ext(z.position.x, z.position.y);
  ext(z.position.x + (z.data.width ?? 240), z.position.y + (z.data.height ?? 160));
}
for (const [, rt] of routes) {
  // rough: extend by label positions
  ext(rt.labelPos.x, rt.labelPos.y);
}
const pad = 60;
minX -= pad; minY -= pad; maxX += pad; maxY += pad;
const W = maxX - minX, H = maxY - minY;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
let body = `<rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="#1a1a1c"/>`;
let svg = ''; // assembled at the end

// zones (translucent boxes behind everything, with a corner label)
for (const z of zones) {
  const { x, y } = z.position;
  const w = z.data.width ?? 240, h = z.data.height ?? 160;
  const c = z.data.color ?? '#3b82f6';
  body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${c}14" stroke="${c}" stroke-width="1.5" stroke-dasharray="6 5"/>`;
  // matches ZoneNode: uppercase text-xs semibold, tracking-wide, inset 4px
  body += `<text x="${x + 8}" y="${y + 17}" fill="${c}" font-size="12" font-family="sans-serif" font-weight="600" letter-spacing="0.3">${esc((z.data.text ?? 'Zone').toUpperCase())}</text>`;
}

// same colours as ComponentNode's breaker/fuse readout
const BREAKER_COLOR = { 10: '#ef4444', 20: '#eab308', 30: '#22c55e', 40: '#f97316' };
const FUSE_RING = '#67e8f9';

// nodes
for (const n of nodes) {
  const def = getDefinition(n.data.definitionId, customDefinitions);
  const r = nodeRect(n, def);
  const border = n.data.color ?? '#d4d4d8';
  body += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6" fill="#232326" stroke="${border}" stroke-width="1.5"/>`;
  // name: same placement/wrapping as ComponentNode (utils/nodeLabels)
  const oriented = orientedPorts(n.data.ports, nodeRotation(n));
  const partType = n.data.label && n.data.label !== def.name ? def.name : null;
  const name = nameLayout(oriented, nodeSize(n, def), { name: n.data.label, sub: partType });
  const lineH = name.fontSize * 1.25;
  const block = name.lines.length * lineH + name.subLines.length * 11;
  let ty = r.y + name.box.y + (name.box.h - block) / 2 + name.fontSize;
  for (const line of name.lines) {
    body += `<text x="${r.x + name.box.x + name.box.w / 2}" y="${ty}" fill="#d4d4d8" font-size="${name.fontSize}" font-family="sans-serif" font-weight="600" text-anchor="middle">${esc(line)}</text>`;
    ty += lineH;
  }
  for (const line of name.subLines) {
    body += `<text x="${r.x + name.box.x + name.box.w / 2}" y="${ty + 1}" fill="#a3a3a3" font-size="9" font-family="sans-serif" text-anchor="middle">${esc(line)}</text>`;
    ty += 11;
  }
  // ports (labels scaled and ellipsized as in the app)
  for (const p of n.data.ports) {
    const pos = portPosition(n, p, def);
    body += `<circle cx="${pos.x}" cy="${pos.y}" r="4" fill="${typeColor(p.type)}" stroke="#111113" stroke-width="1"/>`;
    const scale = name.scale[pos.side];
    const fs = PORT_FONT * scale;
    const maxChars = Math.floor(LABEL_MAX_W / CHAR_W);
    const text = p.label.length > maxChars ? `${p.label.slice(0, maxChars - 1)}…` : p.label;
    // pos.side is the side after the node's rotation
    let lx = pos.x, ly = pos.y, anchor = 'middle';
    if (pos.side === 'left') { lx = r.x + LABEL_INSET; ly = pos.y + fs / 3; anchor = 'start'; }
    else if (pos.side === 'right') { lx = r.x + r.w - LABEL_INSET; ly = pos.y + fs / 3; anchor = 'end'; }
    else if (pos.side === 'top') { ly = r.y + 4 + fs * 0.8; }
    else { ly = r.y + r.h - 4 - fs * 0.2; }
    body += `<text x="${lx}" y="${ly}" fill="#c5c5cd" font-size="${fs}" font-family="sans-serif" text-anchor="${anchor}">${esc(text)}</text>`;
    // breaker/fuse readout just inboard of the label, coloured as in the app
    if (p.type === 'PWR' && p.breaker != null) {
      const amps = `${p.breaker}A`;
      const color = p.slot === 'fuse' ? FUSE_RING : (BREAKER_COLOR[p.breaker] ?? '#fbbf24');
      const tw = text.length * CHAR_W * scale + 4 * scale;
      let ax = lx, ay = ly;
      if (pos.side === 'left') ax = lx + tw;
      else if (pos.side === 'right') ax = lx - tw;
      else if (pos.side === 'top') ay = ly + fs + 1;
      else ay = ly - fs - 1;
      body += `<text x="${ax}" y="${ay}" fill="${color}" font-size="${fs}" font-family="sans-serif" font-weight="600" text-anchor="${anchor}">${amps}</text>`;
    }
  }
}

// wires (solid base, plus a dashed second-color stripe for PWR/CAN)
for (const [, rt] of routes) {
  body += `<path d="${rt.d}" fill="none" stroke="${rt.color}" stroke-width="2.5"/>`;
  if (rt.color2) {
    body += `<path d="${rt.d}" fill="none" stroke="${rt.color2}" stroke-width="2.5" stroke-dasharray="7 7"/>`;
  }
}
// wire labels
for (const e of edges) {
  const rt = routes.get(e.id);
  if (!rt || !e.data.label) continue;
  const t = e.data.label;
  const w = t.length * 6 + 6;
  body += `<rect x="${rt.labelPos.x - w / 2}" y="${rt.labelPos.y - 7}" width="${w}" height="14" rx="3" fill="#111113e6" stroke="${rt.color}55"/>`;
  body += `<text x="${rt.labelPos.x}" y="${rt.labelPos.y + 3}" fill="${rt.color}" font-size="9" font-family="sans-serif" text-anchor="middle">${esc(t)}</text>`;
}
// Assemble. Optional crop arg "x,y,w,h" renders a 2x-zoomed sub-region.
const crop = process.argv[4];
let vb = [minX, minY, W, H];
let scale = 1;
if (crop) { vb = crop.split(',').map(Number); scale = 2; }
svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${vb[2]}" height="${vb[3]}">${body}</svg>`;
const renderOpts = { background: '#1a1a1c', fitTo: { mode: 'width', value: Math.round(vb[2] * scale) } };

const png = new Resvg(svg, renderOpts).render().asPng();
fs.writeFileSync(out, png);
console.log(`bounds minX=${Math.round(minX)} minY=${Math.round(minY)} W=${Math.round(W)} H=${Math.round(H)} -> ${out}`);
