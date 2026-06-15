// §2.1 Project JSON serialize / validate / load helpers + filename sanitizing.

// Wire type aliases for projects saved before the pair→unified refactor.
const TYPE_ALIASES = { 'PWR+': 'PWR', 'PWR-': 'PWR', CANH: 'CAN', CANL: 'CAN' };

function migrateTypes(data) {
  const migrate = (t) => TYPE_ALIASES[t] ?? t;
  return {
    ...data,
    nodes: data.nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        ports: (n.data.ports ?? []).map((p) => ({ ...p, type: migrate(p.type) })),
      },
    })),
    edges: data.edges.map((e) => ({
      ...e,
      data: { ...e.data, type: migrate(e.data?.type) },
    })),
    customDefinitions: (data.customDefinitions ?? []).map((d) => ({
      ...d,
      defaultPorts: (d.defaultPorts ?? []).map((p) => ({ ...p, type: migrate(p.type) })),
    })),
  };
}

// Current project schema version. Bump when the on-disk shape changes and add a
// migration step below so older files keep loading.
export const SCHEMA_VERSION = 2;

// Upgrade a validated project object from `fromVersion` to SCHEMA_VERSION by
// applying each step in order. Steps must be idempotent and pure.
function migrateProject(data, fromVersion) {
  let d = data;
  // v1 → v2: split power/CAN port & wire types were unified (PWR+/PWR-→PWR,
  // CANH/CANL→CAN). Pre-v1 (versionless) files get the same treatment.
  if (fromVersion < 2) d = migrateTypes(d);
  // (future migrations chain here: `if (fromVersion < 3) d = migrateV3(d);`)
  return d;
}

export function serializeProject(state) {
  return {
    app: 'wireup',
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    projectName: state.projectName,
    nodes: state.nodes,
    edges: state.edges,
    layers: state.layers,
    wireLabelTemplate: state.wireLabelTemplate,
    customDefinitions: state.customDefinitions,
  };
}

// Returns { ok, error?, data? }. error messages mirror §2.1.
export function validateProject(obj) {
  if (!obj || typeof obj !== 'object' || obj.app !== 'wireup') {
    return { ok: false, error: 'Invalid or corrupted project file.' };
  }
  if (typeof obj.version === 'number' && obj.version > SCHEMA_VERSION) {
    return { ok: false, error: 'This file was made with a newer version of Wireup.' };
  }
  const required = ['nodes', 'edges', 'layers'];
  for (const key of required) {
    if (!Array.isArray(obj[key])) {
      return { ok: false, error: 'Invalid or corrupted project file.' };
    }
  }
  // Shape check: malformed nodes/edges would crash on first render otherwise.
  // Component nodes must carry a ports array; annotations (note/zone) need not.
  const nodesOk = obj.nodes.every(
    (n) =>
      n &&
      typeof n.id === 'string' &&
      n.data &&
      typeof n.data === 'object' &&
      (n.type === 'note' || n.type === 'zone' || Array.isArray(n.data.ports))
  );
  const edgesOk = obj.edges.every(
    (e) =>
      e &&
      typeof e.id === 'string' &&
      typeof e.source === 'string' &&
      typeof e.target === 'string' &&
      e.data &&
      typeof e.data === 'object'
  );
  if (!nodesOk || !edgesOk) {
    return { ok: false, error: 'Invalid or corrupted project file.' };
  }
  const raw = {
    projectName: typeof obj.projectName === 'string' ? obj.projectName : 'Untitled Project',
    nodes: obj.nodes,
    edges: obj.edges,
    layers: obj.layers,
    wireLabelTemplate:
      typeof obj.wireLabelTemplate === 'string' ? obj.wireLabelTemplate : '{type}{index}',
    customDefinitions: Array.isArray(obj.customDefinitions) ? obj.customDefinitions : [],
  };
  const fromVersion = typeof obj.version === 'number' ? obj.version : 0;
  return { ok: true, data: migrateProject(raw, fromVersion) };
}

// §11 — strip illegal filename chars; fall back to a default.
export function sanitizeFilename(name) {
  const cleaned = (name || '').replace(/[\\/:*?"<>|]/g, '').trim();
  return cleaned || 'wireup-project';
}

// Generic browser download from a Blob.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  downloadBlob(blob, filename);
}

// ---- shareable links (project encoded into the URL hash) ----
function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function gzip(str) {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  w.write(new TextEncoder().encode(str));
  w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function gunzip(bytes) {
  const ds = new DecompressionStream('gzip');
  const w = ds.writable.getWriter();
  w.write(bytes);
  w.close();
  return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
}

// Encode a serialized project to a compact, URL-safe string ('g'=gzip, 'r'=raw).
export async function encodeProjectToHash(project) {
  const json = JSON.stringify(project);
  const gz = await gzip(json);
  return gz ? 'g' + bytesToB64url(gz) : 'r' + bytesToB64url(new TextEncoder().encode(json));
}

// Decode a hash payload (without the leading "p=") back to a project object.
export async function decodeProjectFromHash(payload) {
  const flag = payload[0];
  const bytes = b64urlToBytes(payload.slice(1));
  const json = flag === 'g' ? await gunzip(bytes) : new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

// ---- autosave (single slot) ----
const AUTOSAVE_KEY = 'wireup_autosave';

// Returns true on success, false on failure (quota exhausted / private mode /
// storage blocked) so callers can warn the user instead of losing work silently.
export function writeAutosave(project) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}

export function readAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
