// Render a Wireup project JSON to PNG using the real routing engine, for visual QA.
import fs from 'fs';
import { Resvg } from '@resvg/resvg-js';
import { computeAllRoutes } from '../src/utils/routeGraph.js';
import { getDefinition } from '../src/data/componentLibrary.js';
import { portPosition, nodeRect, portSnappedFraction } from '../src/utils/geometry.js';
import { typeColor } from '../src/data/wireTypes.js';

const file = process.argv[2] || 'examples/test.json';
const out = process.argv[3] || '/tmp/render.png';
const proj = JSON.parse(fs.readFileSync(file, 'utf8'));
const { nodes, edges, layers, customDefinitions = [] } = proj;

const { routes } = computeAllRoutes({ nodes, edges, layers, gridSize: 16, customDefinitions });

// bounds
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const ext = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
for (const n of nodes) {
  const def = getDefinition(n.data.definitionId, customDefinitions);
  const r = nodeRect(n, def);
  ext(r.x, r.y); ext(r.x + r.w, r.y + r.h);
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

// nodes
for (const n of nodes) {
  const def = getDefinition(n.data.definitionId, customDefinitions);
  const r = nodeRect(n, def);
  const border = n.data.color ?? '#d4d4d8';
  body += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6" fill="#232326" stroke="${border}" stroke-width="1.5"/>`;
  body += `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2 + 4}" fill="#d4d4d8" font-size="11" font-family="sans-serif" font-weight="600" text-anchor="middle">${esc(n.data.label)}</text>`;
  // ports
  for (const p of n.data.ports) {
    const pos = portPosition(n, p, def);
    const f = portSnappedFraction(n.data.ports, p, p.side === 'left' || p.side === 'right' ? def.height : def.width);
    body += `<circle cx="${pos.x}" cy="${pos.y}" r="4" fill="${typeColor(p.type)}" stroke="#111113" stroke-width="1"/>`;
    // port label
    let lx = pos.x, ly = pos.y, anchor = 'middle';
    if (p.side === 'left') { lx = r.x + 6; ly = pos.y + 3; anchor = 'start'; }
    else if (p.side === 'right') { lx = r.x + r.w - 6; ly = pos.y + 3; anchor = 'end'; }
    else if (p.side === 'top') { lx = pos.x; ly = r.y + 12; }
    else { lx = pos.x; ly = r.y + r.h - 6; }
    body += `<text x="${lx}" y="${ly}" fill="#c5c5cd" font-size="9" font-family="sans-serif" text-anchor="${anchor}">${esc(p.label)}</text>`;
  }
}

// wires
for (const [, rt] of routes) {
  body += `<path d="${rt.d}" fill="none" stroke="${rt.color}" stroke-width="2.5"/>`;
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
