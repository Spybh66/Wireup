// §11 Exports — canvas (PNG/JPEG/SVG/PDF) and sheet (CSV/Excel/PDF).
// Heavy export-only libraries (html-to-image, jspdf, jspdf-autotable, xlsx)
// are loaded lazily via dynamic import() so they don't inflate the main bundle.
import { sanitizeFilename, downloadBlob } from './saveLoadUtils';
import { buildComponentRows, buildWireRows, buildValidationRows, buildBom } from './sheetData';

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function canvasElement() {
  return document.querySelector('.react-flow__viewport')?.closest('.react-flow') || document.querySelector('.react-flow');
}

// Temporarily hide UI overlay panels (controls, layer panel, wire config) so
// they don't appear in the exported image.
async function withHiddenOverlays(fn) {
  const overlays = document.querySelectorAll(
    '.react-flow__controls, .react-flow__panel, [class*="pointer-events-auto absolute"]'
  );
  const hidden = [];
  for (const el of overlays) {
    hidden.push({ el, prev: el.style.visibility });
    el.style.visibility = 'hidden';
  }
  try {
    return await fn();
  } finally {
    for (const { el, prev } of hidden) el.style.visibility = prev;
  }
}

const RASTER_OPTS = { backgroundColor: '#1a1a1c', pixelRatio: 2 };

// ---- canvas exports ----
export async function exportCanvasPNG(name) {
  const el = canvasElement();
  if (!el) return;
  const { toPng } = await import('html-to-image');
  const url = await withHiddenOverlays(() => toPng(el, RASTER_OPTS));
  downloadDataUrl(url, `${sanitizeFilename(name)}.png`);
}

export async function exportCanvasJPEG(name) {
  const el = canvasElement();
  if (!el) return;
  const { toJpeg } = await import('html-to-image');
  const url = await withHiddenOverlays(() => toJpeg(el, { ...RASTER_OPTS, quality: 0.95 }));
  downloadDataUrl(url, `${sanitizeFilename(name)}.jpg`);
}

export async function exportCanvasSVG(name) {
  const el = canvasElement();
  if (!el) return;
  const { toSvg } = await import('html-to-image');
  const url = await withHiddenOverlays(() => toSvg(el, RASTER_OPTS));
  downloadDataUrl(url, `${sanitizeFilename(name)}.svg`);
}

export async function exportCanvasPDF(name) {
  const el = canvasElement();
  if (!el) return;
  const [{ toPng }, { jsPDF }] = await Promise.all([
    import('html-to-image'),
    import('jspdf'),
  ]);
  const url = await withHiddenOverlays(() => toPng(el, RASTER_OPTS));
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = url;
  });
  const w = img.width;
  const h = img.height;
  const doc = new jsPDF({
    orientation: w >= h ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [w, h],
  });
  doc.addImage(url, 'PNG', 0, 0, w, h);
  doc.save(`${sanitizeFilename(name)}.pdf`);
}

// ---- sheet exports ----
function rfc4180(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

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
const bomWireMatrix = (state) =>
  buildBom(state).wires.map((w) => [w.gauge, w.color, w.lengthIn, w.lengthFt]);
const bomConnMatrix = (state) => buildBom(state).connectors.map((c) => [c.name, c.qty]);

// §11 / decision 24 — two CSV files, downloaded sequentially.
export function exportSheetCSV(state, name) {
  const base = sanitizeFilename(name);
  const comps = toCSV(COMPONENT_HEADERS, componentMatrix(state));
  downloadBlob(new Blob([comps], { type: 'text/csv;charset=utf-8' }), `${base}-components.csv`);
  setTimeout(() => {
    const wires = toCSV(WIRE_HEADERS, wireMatrix(state));
    downloadBlob(new Blob([wires], { type: 'text/csv;charset=utf-8' }), `${base}-wires.csv`);
  }, 150);
  const issues = validationMatrix(state);
  if (issues.length) {
    setTimeout(() => {
      const v = toCSV(VALIDATION_HEADERS, issues);
      downloadBlob(new Blob([v], { type: 'text/csv;charset=utf-8' }), `${base}-validation.csv`);
    }, 300);
  }
  const wireBom = bomWireMatrix(state);
  const connBom = bomConnMatrix(state);
  if (wireBom.length || connBom.length) {
    setTimeout(() => {
      const bom = `Wire\r\n${toCSV(BOM_WIRE_HEADERS, wireBom)}\r\n\r\nConnectors\r\n${toCSV(BOM_CONN_HEADERS, connBom)}`;
      downloadBlob(new Blob([bom], { type: 'text/csv;charset=utf-8' }), `${base}-bom.csv`);
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
  if (wireBom.length || connBom.length) {
    const bomRows = [['Wire'], BOM_WIRE_HEADERS, ...wireBom, [], ['Connectors'], BOM_CONN_HEADERS, ...connBom];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bomRows), 'BOM');
  }
  XLSX.writeFile(wb, `${sanitizeFilename(name)}.xlsx`);
}

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
    body: componentMatrix(state),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [35, 35, 38] },
  });
  const afterFirst = doc.lastAutoTable.finalY + 28;
  doc.text('Wires', 40, afterFirst);
  autoTable(doc, {
    startY: afterFirst + 12,
    head: [WIRE_HEADERS],
    body: wireMatrix(state),
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
      body: issues,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [35, 35, 38] },
    });
  }
  const wireBom = bomWireMatrix(state);
  const connBom = bomConnMatrix(state);
  if (wireBom.length || connBom.length) {
    let y = doc.lastAutoTable.finalY + 28;
    doc.text('Bill of Materials — Wire', 40, y);
    autoTable(doc, {
      startY: y + 12,
      head: [BOM_WIRE_HEADERS],
      body: wireBom,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [35, 35, 38] },
    });
    y = doc.lastAutoTable.finalY + 28;
    doc.text('Bill of Materials — Connectors', 40, y);
    autoTable(doc, {
      startY: y + 12,
      head: [BOM_CONN_HEADERS],
      body: connBom,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [35, 35, 38] },
    });
  }
  doc.save(`${sanitizeFilename(name)}.pdf`);
}
