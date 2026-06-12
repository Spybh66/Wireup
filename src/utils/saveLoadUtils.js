// §2.1 Project JSON serialize / validate / load helpers + filename sanitizing.

export const SCHEMA_VERSION = 1;

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
  return {
    ok: true,
    data: {
      projectName: typeof obj.projectName === 'string' ? obj.projectName : 'Untitled Project',
      nodes: obj.nodes,
      edges: obj.edges,
      layers: obj.layers,
      wireLabelTemplate:
        typeof obj.wireLabelTemplate === 'string' ? obj.wireLabelTemplate : '{type}{index}',
      customDefinitions: Array.isArray(obj.customDefinitions) ? obj.customDefinitions : [],
    },
  };
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

// ---- autosave (single slot) ----
const AUTOSAVE_KEY = 'wireup_autosave';

export function writeAutosave(project) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
  } catch {
    /* quota / private mode — ignore */
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
