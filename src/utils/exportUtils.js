// §11 Exports — canvas (PNG/JPEG/SVG/PDF) and sheet (CSV/Excel/PDF).
import { toPng, toJpeg, toSvg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { sanitizeFilename, downloadBlob } from './saveLoadUtils';
import { buildComponentRows, buildWireRows } from './sheetData';

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

const RASTER_OPTS = { backgroundColor: '#1a1a1c', pixelRatio: 2 };

// ---- canvas exports ----
export async function exportCanvasPNG(name) {
  const el = canvasElement();
  if (!el) return;
  const url = await toPng(el, RASTER_OPTS);
  downloadDataUrl(url, `${sanitizeFilename(name)}.png`);
}

export async function exportCanvasJPEG(name) {
  const el = canvasElement();
  if (!el) return;
  const url = await toJpeg(el, { ...RASTER_OPTS, quality: 0.95 });
  downloadDataUrl(url, `${sanitizeFilename(name)}.jpg`);
}

export async function exportCanvasSVG(name) {
  const el = canvasElement();
  if (!el) return;
  // NOTE: html-to-image's toSvg embeds the HTML via <foreignObject>; this is not
  // a clean vector export (accepted limitation per §11 / decision 26).
  const url = await toSvg(el, RASTER_OPTS);
  downloadDataUrl(url, `${sanitizeFilename(name)}.svg`);
}

export async function exportCanvasPDF(name) {
  const el = canvasElement();
  if (!el) return;
  const url = await toPng(el, RASTER_OPTS);
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
  'Fitting',
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
    r.fitting,
    r.color,
    r.length ?? '',
    r.notes,
    r.layer,
  ]);

// §11 / decision 24 — two CSV files, downloaded sequentially.
export function exportSheetCSV(state, name) {
  const base = sanitizeFilename(name);
  const comps = toCSV(COMPONENT_HEADERS, componentMatrix(state));
  downloadBlob(new Blob([comps], { type: 'text/csv;charset=utf-8' }), `${base}-components.csv`);
  setTimeout(() => {
    const wires = toCSV(WIRE_HEADERS, wireMatrix(state));
    downloadBlob(new Blob([wires], { type: 'text/csv;charset=utf-8' }), `${base}-wires.csv`);
  }, 150);
}

export function exportSheetExcel(state, name) {
  const wb = XLSX.utils.book_new();
  const compSheet = XLSX.utils.aoa_to_sheet([COMPONENT_HEADERS, ...componentMatrix(state)]);
  const wireSheet = XLSX.utils.aoa_to_sheet([WIRE_HEADERS, ...wireMatrix(state)]);
  XLSX.utils.book_append_sheet(wb, compSheet, 'Components');
  XLSX.utils.book_append_sheet(wb, wireSheet, 'Wires');
  XLSX.writeFile(wb, `${sanitizeFilename(name)}.xlsx`);
}

export function exportSheetPDF(state, name) {
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
  doc.save(`${sanitizeFilename(name)}.pdf`);
}
