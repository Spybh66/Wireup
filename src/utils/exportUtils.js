// §11 Exports — canvas (PNG/JPEG/SVG/PDF) and sheet (CSV/Excel/PDF).
// Heavy export-only libraries (html-to-image, jspdf, jspdf-autotable, xlsx)
// are loaded lazily via dynamic import() so they don't inflate the main bundle.
import { sanitizeFilename, downloadBlob } from './saveLoadUtils';
import { getNodesBounds, getViewportForBounds } from '@xyflow/react';
import { buildComponentRows, buildWireRows, buildValidationRows, buildBom } from './sheetData';

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function viewportElement() {
  return document.querySelector('.react-flow__viewport');
}

// Temporarily hide UI overlay panels (controls, layer panel, wire config) and
// selection styling so they don't appear in the exported image.
async function withHiddenOverlays(fn) {
  const overlays = document.querySelectorAll(
    '.react-flow__controls, .react-flow__panel, .react-flow__nodesselection, [class*="pointer-events-auto absolute"]'
  );
  const hidden = [];
  for (const el of overlays) {
    hidden.push({ el, prev: el.style.visibility });
    el.style.visibility = 'hidden';
  }
  const selected = [...document.querySelectorAll('.react-flow__node.selected, .react-flow__edge.selected')];
  for (const el of selected) el.classList.remove('selected');
  try {
    return await fn();
  } finally {
    for (const { el, prev } of hidden) el.style.visibility = prev;
    for (const el of selected) el.classList.add('selected');
  }
}

const BG = '#1a1a1c';
const EXPORT_PAD = 40; // flow px of margin around the diagram
const MAX_SIDE = 16000; // keep the canvas under browser size limits
const MAX_SCALE = 2; // output px per flow px

// Flow-space bounds of everything rendered: nodes (from their DOM transform +
// size, fed through React Flow's getNodesBounds) unioned with edge paths
// (routed wires can extend past the nodes).
function diagramBounds(viewport) {
  const nodeLookup = new Map();
  for (const el of viewport.querySelectorAll('.react-flow__node')) {
    const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform);
    if (!m) continue;
    const id = el.dataset.id;
    const positionAbsolute = { x: Number(m[1]), y: Number(m[2]) };
    nodeLookup.set(id, {
      id,
      position: positionAbsolute,
      measured: { width: el.offsetWidth, height: el.offsetHeight },
      internals: { positionAbsolute },
    });
  }
  const box = nodeLookup.size ? getNodesBounds([...nodeLookup.keys()], { nodeLookup }) : null;
  let x1 = box ? box.x : Infinity;
  let y1 = box ? box.y : Infinity;
  let x2 = box ? box.x + box.width : -Infinity;
  let y2 = box ? box.y + box.height : -Infinity;
  for (const path of viewport.querySelectorAll('.react-flow__edge path')) {
    try {
      const b = path.getBBox();
      if (!b.width && !b.height) continue;
      x1 = Math.min(x1, b.x);
      y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.width);
      y2 = Math.max(y2, b.y + b.height);
    } catch {
      // getBBox throws on detached/unrendered SVG — nodes alone are fine
    }
  }
  if (!Number.isFinite(x1)) return null;
  return { x: x1 - EXPORT_PAD, y: y1 - EXPORT_PAD, width: x2 - x1 + EXPORT_PAD * 2, height: y2 - y1 + EXPORT_PAD * 2 };
}

// Render the whole diagram (not just the on-screen viewport) at up to
// MAX_SCALE px per flow px — React Flow v12's recommended image-export recipe:
// compute bounds, derive a viewport transform for them, and render
// `.react-flow__viewport` with that transform at the target size.
async function renderDiagram(render, extra = {}) {
  const viewport = viewportElement();
  if (!viewport) return null;
  const bounds = diagramBounds(viewport);
  if (!bounds) return null;
  const lib = await import('html-to-image');
  const scale = Math.min(MAX_SCALE, MAX_SIDE / bounds.width, MAX_SIDE / bounds.height);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const vp = getViewportForBounds(bounds, width, height, 0.01, scale, 0);
  const url = await withHiddenOverlays(() =>
    lib[render](viewport, {
      backgroundColor: BG,
      width,
      height,
      pixelRatio: 1,
      style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
      ...extra,
    })
  );
  return { url, width, height, scale };
}

// ---- canvas exports ----
// Signatures unchanged: each takes the project name. Header's fitView before
// export is no longer required (the export frames the full diagram itself).
export async function exportCanvasPNG(name) {
  const out = await renderDiagram('toPng');
  if (out) downloadDataUrl(out.url, `${sanitizeFilename(name)}.png`);
}

export async function exportCanvasJPEG(name) {
  const out = await renderDiagram('toJpeg', { quality: 0.95 });
  if (out) downloadDataUrl(out.url, `${sanitizeFilename(name)}.jpg`);
}

export async function exportCanvasSVG(name) {
  const out = await renderDiagram('toSvg');
  if (out) downloadDataUrl(out.url, `${sanitizeFilename(name)}.svg`);
}

export async function exportCanvasPDF(name) {
  const { jsPDF } = await import('jspdf');
  const out = await renderDiagram('toPng');
  if (!out) return;
  const { url, width: w, height: h, scale } = out;
  // Page at 1 pt per flow px (the raster keeps its full resolution), shrunk
  // if needed to stay within the PDF 14400 pt page limit.
  const fit = Math.min(1 / scale, 14400 / w, 14400 / h);
  const pw = w * fit;
  const ph = h * fit;
  const doc = new jsPDF({
    orientation: pw >= ph ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [pw, ph],
  });
  doc.addImage(url, 'PNG', 0, 0, pw, ph);
  doc.save(`${sanitizeFilename(name)}.pdf`);
}

// ---- sheet exports ----
function rfc4180(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// UTF-8 byte-order mark so Excel opens the CSVs as UTF-8 (Ω, −, ×, …).
const CSV_BOM = '\uFEFF';
const csvBlob = (text) => new Blob([CSV_BOM + text], { type: 'text/csv;charset=utf-8' });

function toCSV(headers, rows) {
  const lines = [headers.map(rfc4180).join(',')];
  for (const r of rows) lines.push(r.map(rfc4180).join(','));
  return lines.join('\r\n');
}

const COMPONENT_HEADERS = ['Name', 'Type', 'Category', 'CAN ID', 'IP Address', 'Notes'];
const WIRE_HEADERS = [
  'Wire Label',
  'Type',
  'From',
  'To',
  'Gauge',
  'Fitting (From)',
  'Fitting (To)',
  'Color',
  'Length (in)',
  'Notes',
  'Layer',
];

const componentMatrix = (state) =>
  buildComponentRows(state).map((r) => [
    r.name,
    r.type,
    r.category,
    r.canId ?? '',
    r.ipAddress ?? '',
    r.notes,
  ]);

const wireMatrix = (state) =>
  buildWireRows(state).map((r) => [
    r.label,
    r.group,
    r.from,
    r.to,
    r.gauge,
    r.fittingFrom,
    r.fittingTo,
    r.color,
    r.length ?? '',
    r.notes,
    r.layer,
  ]);

const VALIDATION_HEADERS = ['Severity', 'Rule', 'Issue', 'Components'];
const validationMatrix = (state) =>
  buildValidationRows(state).map((r) => [r.severity, r.rule, r.message, r.elements]);

const BOM_WIRE_HEADERS = ['Gauge', 'Color', 'Length (in)', 'Length (ft)'];
const BOM_CONN_HEADERS = ['Connector', 'Qty'];
const BOM_INST_HEADERS = ['Installed Adapter', 'Qty'];
const bomWireMatrix = (state) =>
  buildBom(state).wires.map((w) => [w.gauge, w.color, w.lengthIn, w.lengthFt]);
const bomConnMatrix = (state) => buildBom(state).connectors.map((c) => [c.name, c.qty]);
const bomInstMatrix = (state) => buildBom(state).installedConnectors.map((c) => [c.name, c.qty]);

// §11 / decision 24 — separate CSV files (components, wires, validation, BOM),
// downloaded sequentially on short timers so the browser doesn't drop them
// (some browsers still prompt to allow multiple downloads).
export function exportSheetCSV(state, name) {
  const base = sanitizeFilename(name);
  const comps = toCSV(COMPONENT_HEADERS, componentMatrix(state));
  downloadBlob(csvBlob(comps), `${base}-components.csv`);
  setTimeout(() => {
    const wires = toCSV(WIRE_HEADERS, wireMatrix(state));
    downloadBlob(csvBlob(wires), `${base}-wires.csv`);
  }, 150);
  const issues = validationMatrix(state);
  if (issues.length) {
    setTimeout(() => {
      const v = toCSV(VALIDATION_HEADERS, issues);
      downloadBlob(csvBlob(v), `${base}-validation.csv`);
    }, 300);
  }
  const wireBom = bomWireMatrix(state);
  const connBom = bomConnMatrix(state);
  const instBom = bomInstMatrix(state);
  if (wireBom.length || connBom.length || instBom.length) {
    setTimeout(() => {
      let bom = `Wire\r\n${toCSV(BOM_WIRE_HEADERS, wireBom)}\r\n\r\nConnectors\r\n${toCSV(BOM_CONN_HEADERS, connBom)}`;
      if (instBom.length) bom += `\r\n\r\nInstalled Adapters\r\n${toCSV(BOM_INST_HEADERS, instBom)}`;
      downloadBlob(csvBlob(bom), `${base}-bom.csv`);
    }, 450);
  }
}

export async function exportSheetExcel(state, name) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const compSheet = XLSX.utils.aoa_to_sheet([COMPONENT_HEADERS, ...componentMatrix(state)]);
  const wireSheet = XLSX.utils.aoa_to_sheet([WIRE_HEADERS, ...wireMatrix(state)]);
  XLSX.utils.book_append_sheet(wb, compSheet, 'Components');
  XLSX.utils.book_append_sheet(wb, wireSheet, 'Wires');
  const issues = validationMatrix(state);
  if (issues.length) {
    const vSheet = XLSX.utils.aoa_to_sheet([VALIDATION_HEADERS, ...issues]);
    XLSX.utils.book_append_sheet(wb, vSheet, 'Validation');
  }
  const wireBom = bomWireMatrix(state);
  const connBom = bomConnMatrix(state);
  const instBom = bomInstMatrix(state);
  if (wireBom.length || connBom.length || instBom.length) {
    const bomRows = [['Wire'], BOM_WIRE_HEADERS, ...wireBom, [], ['Connectors'], BOM_CONN_HEADERS, ...connBom];
    if (instBom.length) bomRows.push([], ['Installed Adapters'], BOM_INST_HEADERS, ...instBom);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bomRows), 'BOM');
  }
  XLSX.writeFile(wb, `${sanitizeFilename(name)}.xlsx`);
}

// jsPDF's built-in Helvetica only covers WinAnsi (≈Latin-1): map the symbols we
// use to ASCII, and reduce anything else outside Latin-1 to its closest ASCII
// (accents stripped) or '?', so cells don't render as junk.
const PDF_CHAR_MAP = {
  '\u2212': '-', // minus
  '\u2013': '-', // en dash
  '\u2014': '-', // em dash
  '\u2026': '...',
  '\u2018': "'",
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u2190': '<-',
  '\u2192': '->',
  '\u2194': '<->',
  '\u2264': '<=',
  '\u2265': '>=',
  '\u2022': '*',
  '\u2126': 'Ohm', // ohm sign
  '\u03A9': 'Ohm', // Greek capital omega
};
export function pdfText(value) {
  if (value == null) return '';
  return String(value).replace(/[\u0100-\u{10FFFF}]/gu, (c) => {
    if (PDF_CHAR_MAP[c]) return PDF_CHAR_MAP[c];
    const ascii = c.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    return /^[\x20-\x7E]+$/.test(ascii) ? ascii : '?';
  });
}
const pdfRows = (rows) => rows.map((r) => r.map(pdfText));

export async function exportSheetPDF(state, name) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  doc.setFontSize(14);
  doc.text('Components', 40, 40);
  autoTable(doc, {
    startY: 52,
    head: [COMPONENT_HEADERS],
    body: pdfRows(componentMatrix(state)),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [35, 35, 38] },
  });
  const afterFirst = doc.lastAutoTable.finalY + 28;
  doc.text('Wires', 40, afterFirst);
  autoTable(doc, {
    startY: afterFirst + 12,
    head: [WIRE_HEADERS],
    body: pdfRows(wireMatrix(state)),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [35, 35, 38] },
  });
  const issues = validationMatrix(state);
  if (issues.length) {
    const afterWires = doc.lastAutoTable.finalY + 28;
    doc.text('Validation', 40, afterWires);
    autoTable(doc, {
      startY: afterWires + 12,
      head: [VALIDATION_HEADERS],
      body: pdfRows(issues),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [35, 35, 38] },
    });
  }
  const wireBom = bomWireMatrix(state);
  const connBom = bomConnMatrix(state);
  const instBom = bomInstMatrix(state);
  if (wireBom.length || connBom.length || instBom.length) {
    let y = doc.lastAutoTable.finalY + 28;
    doc.text('Bill of Materials - Wire', 40, y);
    autoTable(doc, {
      startY: y + 12,
      head: [BOM_WIRE_HEADERS],
      body: pdfRows(wireBom),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [35, 35, 38] },
    });
    y = doc.lastAutoTable.finalY + 28;
    doc.text('Bill of Materials - Connectors', 40, y);
    autoTable(doc, {
      startY: y + 12,
      head: [BOM_CONN_HEADERS],
      body: pdfRows(connBom),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [35, 35, 38] },
    });
    if (instBom.length) {
      y = doc.lastAutoTable.finalY + 28;
      doc.text('Bill of Materials - Installed Adapters', 40, y);
      autoTable(doc, {
        startY: y + 12,
        head: [BOM_INST_HEADERS],
        body: pdfRows(instBom),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [35, 35, 38] },
      });
    }
  }
  doc.save(`${sanitizeFilename(name)}.pdf`);
}
