# Wireup — Implementation Plan

**TL;DR:** Build a 100% static React + Vite SPA (GitHub Pages hosted) using React Flow for the diagram canvas and Zustand for state. The app has two views: an interactive wiring diagram canvas and a spreadsheet breakdown. Projects save/load as JSON. All 30 user decisions are baked in below.

---

## Stack Decisions

| Concern | Choice |
|---|---|
| Framework | React 18 + Vite |
| Diagram engine | React Flow (`@xyflow/react` v11) |
| Styling | Tailwind CSS (always dark, white/silver accent) |
| Fonts | Rajdhani + Oswald (Google Fonts) |
| State | Zustand + `zundo` temporal middleware (undo/redo, 100-action history) |
| Exports | `html-to-image`, `jsPDF`, `jspdf-autotable`, SheetJS (`xlsx`) |
| Deploy | `gh-pages` |

---

## Phase 1: Project Scaffolding

1. `npm create vite@latest wireup -- --template react`; set `base` in `vite.config.js` to repo name
2. Install all deps: `@xyflow/react`, `zustand`, `zundo`, `tailwindcss`, `html-to-image`, `jspdf`, `jspdf-autotable`, `xlsx`, `lucide-react`, `gh-pages`
3. Configure Tailwind with custom color palette (surfaces, accent, wire-type colors)
4. Load Google Fonts (Rajdhani 400/600/700, Oswald 400/600) in `index.html`
5. Create full `src/` directory structure: `assets/`, `components/canvas/`, `components/sidebar/`, `components/header/`, `components/modal/`, `components/sheet/`, `components/shared/`, `data/`, `store/`, `utils/`
6. Configure `gh-pages` deploy script; verify blank dark page deploys

**Key files:** `vite.config.js`, `tailwind.config.js`, `index.html`, `index.css`, `package.json`

---

## Phase 2: State Management (Zustand Store)

1. Define full state shape: `projectName`, `nodes`, `edges`, `layers` (4 defaults + custom), `wireLabelTemplate` (`{type}{index:03d}`), UI state (`sidebarOpen`, `activeTab`, `gridSize`, `snapToGrid`)
2. Define `node.data` shape: `definitionId`, `label`, `color`, `notes`, `locked`, `canId`, `ipAddress`, `ports[]`
3. Define `edge.data` shape: `type`, `layerId`, `color`, `wireGauge`, `wireFitting`, `label`, `length`, `notes`
4. Implement all actions: `addNode`, `updateNode`, `removeNode`, `addEdge`, `updateEdge`, `removeEdge`, `addLayer`, `updateLayer`, `removeLayer`, `setProjectName`, `loadProject`, `newProject`
5. Wrap with `zundo` temporal middleware; exclude UI state from history; expose `undo()`/`redo()`
6. Add debounced (500ms) localStorage auto-save; on app init check for autosave → show restore banner

**Key files:** `src/store/diagramStore.js`

---

## Phase 3: Component Library Data *(can run parallel with Phase 4)*

1. Write component definition schema and all 13 pre-built components across 4 categories:
   - **Controllers:** RoboRIO 2, Orange Pi 5
   - **Power:** Battery, PDH, VRM
   - **Motors:** Kraken x60, SPARK MAX, Generic Motor Controller
   - **Sensors:** CANcoder, Pigeon 2, CANdle, Generic Sensor
   - **Networking:** VH-109 Radio
2. Each definition includes: `id`, `name`, `category`, `svgIcon`, `width`, `height`, `defaultPorts[]`, `trackedFields[]`
3. Create SVG icons for all 13 components: 40×40px, white/silver strokes, block diagram style, as React components in `src/assets/icons/`
4. Define default wire colors per type: PWR+ red, PWR- black, CAN H yellow, CAN L green, ETH blue, USB purple
5. Define wire gauge options (22–2 AWG) and fitting options (Anderson Powerpole, Ring Terminal, Ferrule, Wago, Bare Wire, JST)

**Key files:** `src/data/componentLibrary.js`, `src/data/defaultWireColors.js`, `src/assets/icons/*.jsx`

---

## Phase 4: Canvas — Core React Flow Setup *(can run parallel with Phase 3)*

1. Build `ComponentNode.jsx`: header (SVG icon + label + lock indicator), port `<Handle>` components distributed along assigned sides, colored 8px port dots, always-visible 10px port labels, colored border for custom color
2. Build `WireEdge.jsx`: custom SVG path with 2-segment 45-degree routing (H/V first then diagonal), stroke color from edge data or type default, layer-aware visibility, selection highlight
3. Build `DiagramCanvas.jsx`: React Flow with `snapToGrid`, `Background` dots, `Controls`, `onConnect` → `addEdge`, drag-to-connect, `onDrop` for sidebar components using `screenToFlowPosition()`
4. Implement all keyboard shortcuts: `Ctrl+Z/Y`, `Ctrl+C/V` (clone nodes, no edges), `Delete`, `Escape`
5. Implement multi-select (marquee + shift-click) and group move
6. Wire `onConnect` to auto-assign edge type, layerId, gauge, fitting, and auto-generated label from source port

**Key files:** `src/components/canvas/ComponentNode.jsx`, `src/components/canvas/WireEdge.jsx`, `src/components/canvas/DiagramCanvas.jsx`

---

## Phase 5: Component Sidebar *(can run parallel with Phase 6)*

1. Build categorized accordion sidebar (260px): search bar → filters all categories in real-time; categories are collapsible
2. Each item: 24×24 SVG icon + name, `draggable`, `onDragStart` sets `dataTransfer` with `componentDefinitionId`
3. "+ New Custom Component" button → opens Create Component modal with name, category, dimensions, port list
4. Custom components appear in "Custom" category in sidebar, saved in `customDefinitions` in project JSON
5. Collapse/expand toggle button on right edge, smooth CSS width transition

**Key files:** `src/components/sidebar/ComponentSidebar.jsx`, `src/components/sidebar/CreateComponentModal.jsx`

---

## Phase 6: Layer Panel *(can run parallel with Phase 5)*

1. Floating panel bottom-left of canvas; always visible on Diagram tab
2. Default layers (Power, CAN Bus, Ethernet, USB): eye toggle only, no rename/delete
3. Custom layers: eye toggle + rename (inline edit) + delete (with confirmation dialog)
4. "+" button to add new named layer
5. Delete layer → wires on it move to Power layer (fallback)

**Key files:** `src/components/canvas/LayerPanel.jsx`

---

## Phase 7: Component Configuration Modal *(depends on Phase 4)*

1. Triggered by single-click on a node (not a port handle)
2. Sections:
   - **Header:** editable name, color picker (`<input type="color">`), lock toggle
   - **General:** notes textarea
   - **Tracked Fields:** CAN ID (1–63), IP Address — shown only if component definition tracks them
   - **Ports:** list with type/label/side/gauge/fitting, add/remove
3. Removing a port deletes attached edges automatically (no confirmation)
4. "Connected Wires" read-only list: click wire label → selects edge on canvas + closes modal
5. "Delete Component" red button with confirmation: deletes node + all attached edges

**Key files:** `src/components/modal/ComponentConfigModal.jsx`

---

## Phase 8: Wire Configuration Panel *(depends on Phase 7)*

1. Clicking an edge selects it and opens a floating panel (top-right of canvas, not a full modal)
2. Fields: wire label (editable), color picker, layer dropdown, wire type (read-only), gauge (for Power/CAN), fitting (for Power/CAN), notes
3. All changes immediately call `updateEdge(id, partial)`

**Key files:** `src/components/canvas/WireConfigPanel.jsx`

---

## Phase 9: Spreadsheet / Sheet View *(depends on Phase 8)*

1. Header tab switch → replaces canvas DOM with sheet view; Zustand state preserved
2. **Table 1 — Components:** Name, Type, Category, CAN ID, IP Address, Notes — read-only, sorted alphabetically
3. **Table 2 — Wires:** Wire Label, Type, From, To, Gauge, Fitting, Color swatch, Length (editable), Notes (editable), Layer — sorted by type then label
4. Column headers clickable to sort; filter text input above wire table
5. Wire label template editor above Table 2: text input + available token hints; on Enter → regenerate all labels
6. Inline cell editing for Length and Notes calls `updateEdge`

**Key files:** `src/components/sheet/SheetView.jsx`, `src/components/sheet/WireTable.jsx`, `src/components/sheet/ComponentTable.jsx`

---

## Phase 10: Export & Save/Load *(depends on Phase 9)*

1. **Project JSON:** Download as `{projectName}.wireup.json`; upload via `<input type="file">`; validate version on load
2. **Canvas PNG/JPEG/SVG:** `html-to-image` capturing entire React Flow element after `fitView()`; background `#1a1a1a`
3. **Canvas PDF:** PNG embedded in `jsPDF` sized to content (fit-to-content, landscape)
4. **Sheet CSV:** native string concatenation + download
5. **Sheet Excel (.xlsx):** SheetJS with two sheets (Components + Wires)
6. **Sheet PDF:** `jspdf-autotable` formatted table, portrait Letter
7. Export button in header → dropdown: Canvas (PNG | JPEG | SVG | PDF) / Sheet (CSV | Excel | PDF)

**Key files:** `src/utils/exportUtils.js`, `src/utils/saveLoadUtils.js`

---

## Phase 11: Settings Panel *(depends on Phase 10)*

1. Gear icon in header → right-side drawer or modal
2. Settings: Grid Size (px input), Snap to Grid (toggle), Wire Label Template (text), Show Port Labels (toggle), Grid Visible (toggle)
3. All settings persisted to `localStorage['wireup_settings']`, **not** in project JSON

**Key files:** `src/components/header/SettingsPanel.jsx`

---

## Phase 12: Polish & Deploy *(depends on Phase 11)*

1. Edge case guards: block self-connections; warn on type-mismatch connections; offset overlapping drops; handle layer deletion fallback
2. Mobile banner: "Wireup is best used on desktop"
3. Restore banner on autosave detected at startup
4. ARIA labels on all interactive elements; modal focus trap
5. Lazy-load Sheet view; debounce all writes
6. Set correct `base` in `vite.config.js`, run `npm run deploy`, verify on GitHub Pages URL

---

## All Source Files

| File | Purpose |
|---|---|
| `src/store/diagramStore.js` | Entire app state (Zustand + zundo) |
| `src/data/componentLibrary.js` | 13 component definitions |
| `src/data/defaultWireColors.js` | Wire type → default color map |
| `src/assets/icons/*.jsx` | 13 SVG icon components |
| `src/components/canvas/DiagramCanvas.jsx` | React Flow root |
| `src/components/canvas/ComponentNode.jsx` | Custom node renderer |
| `src/components/canvas/WireEdge.jsx` | Custom 45-degree edge renderer |
| `src/components/canvas/LayerPanel.jsx` | Layer visibility panel |
| `src/components/canvas/WireConfigPanel.jsx` | Wire config floating panel |
| `src/components/sidebar/ComponentSidebar.jsx` | Draggable component library |
| `src/components/sidebar/CreateComponentModal.jsx` | Custom component builder |
| `src/components/modal/ComponentConfigModal.jsx` | Component configuration modal |
| `src/components/sheet/SheetView.jsx` | Sheet tab root |
| `src/components/sheet/WireTable.jsx` | Wire spreadsheet |
| `src/components/sheet/ComponentTable.jsx` | Component spreadsheet |
| `src/components/header/SettingsPanel.jsx` | Settings drawer |
| `src/utils/exportUtils.js` | PNG/PDF/SVG/CSV/XLSX export |
| `src/utils/saveLoadUtils.js` | Project JSON save/load |
| `src/utils/labelUtils.js` | Wire label template engine |

---

## Verification Checklist

- [ ] `npm run dev` → drag RoboRIO 2 to canvas, drag wire from CAN H to PDH CAN H, wire appears yellow, routed with 45-degree break
- [ ] Click wire → wire config panel opens, changing color updates wire stroke
- [ ] Click RoboRIO 2 → modal opens, rename it, label on canvas updates
- [ ] Toggle Power layer off → all red wires disappear
- [ ] Switch to Sheet tab → wire appears with auto-label `CAN001`, editing Length persists after tab switch
- [ ] Save project → download JSON → reload → open file → full diagram restored
- [ ] Export PNG → image captures entire diagram on dark background
- [ ] `npm run deploy` → GitHub Pages URL loads the app

---

## Key Decisions

- Fixed component sizes (no resizing); 45-degree 2-segment wire routing; port labels always visible; always-dark theme; single diagram per project; no server/backend
- Custom components saved in project JSON `customDefinitions`, not globally
- Layer deletion moves orphaned wires to "Power" layer as fallback
- Mismatched-type wire connections allowed with warning toast (not blocked)
- Settings are per-user (`localStorage` only), not per-project
