# Wireup — Integration Plan (v2 — Final, Zero-Ambiguity)

**Audience:** the implementing agent. Every decision in this document is final and has been confirmed by the project owner. Do not re-ask anything in §13 (Decision Log). If something is genuinely unspecified, prefer the simplest implementation consistent with this document.

**TL;DR:** A 100% static React + Vite SPA hosted on GitHub Pages at `https://spybh66.github.io/Wireup/`. Two views: an interactive wiring-diagram canvas (React Flow v12) with **obstacle-avoiding wire routing and crossing hop indicators**, and a spreadsheet breakdown. State in Zustand with zundo undo/redo. Projects save/load as JSON. Always-dark theme. Built for FRC robot wiring.

---

## 1. Stack (corrected)

| Concern | Choice | Notes |
|---|---|---|
| Framework | React 18 + Vite | JS (not TS) to match original plan |
| Diagram engine | **`@xyflow/react` v12** | The original plan said "v11" — that is wrong. v11 is the legacy `reactflow` package. Use v12 APIs throughout: `<ReactFlow>`, `<Handle>`, `<BaseEdge>`, `useReactFlow().screenToFlowPosition()`, `<Background>`, `<Controls>` |
| Styling | Tailwind CSS | Always-dark; no theme toggle |
| Fonts | Rajdhani 400/600/700 (UI/body), Oswald 400/600 (headings/labels) via Google Fonts `<link>` in `index.html` |
| State | Zustand + `zundo` temporal middleware | 100-step history |
| Exports | `html-to-image`, `jspdf`, `jspdf-autotable`, `xlsx` (SheetJS) | |
| Icons (UI chrome) | `lucide-react` | Component icons are hand-written SVG (§5) |
| Deploy | `gh-pages` | `base: '/Wireup/'` in `vite.config.js` (repo: `https://github.com/Spybh66/Wireup`) |
| Browser targets | Evergreen Chrome / Firefox / Edge / Safari only | No legacy support work |

---

## 2. Data Model (exact schemas)

All IDs are strings generated with `crypto.randomUUID()`.

### 2.1 Project JSON (save file: `{sanitizedProjectName}.wireup.json`)

```js
{
  app: "wireup",            // literal, required
  version: 1,               // integer schema version
  savedAt: "ISO-8601",      // informational only
  projectName: string,
  nodes: Node[],            // React Flow node objects (id, type:'component', position, data)
  edges: Edge[],            // React Flow edge objects (id, source, target, sourceHandle, targetHandle, type:'wire', data)
  layers: Layer[],
  wireLabelTemplate: string,    // per-project. Default "{type}{index}"
  customDefinitions: ComponentDefinition[]   // user-created components, project-scoped
}
```

**Load validation:** must have `app === "wireup"`. If `version > 1` → reject with error toast "This file was made with a newer version of Wireup." If `version <= 1` → load; if any unknown fields, ignore them; if required fields missing, reject with "Invalid or corrupted project file."

### 2.2 Node

```js
{
  id, type: "component", position: {x, y},
  data: {
    definitionId: string,     // references built-in or customDefinitions entry
    label: string,            // display name, defaults to definition name (+ " 2", " 3"… if duplicate)
    color: string | null,     // hex; null = default silver border
    notes: string,            // default ""
    locked: boolean,          // default false
    canId: number | null,     // 0–63 inclusive; only meaningful if definition tracks it
    ipAddress: string | null, // free text; only meaningful if definition tracks it
    ports: Port[]             // INSTANCE copy of definition.defaultPorts, independently editable
  }
}
```

**Lock semantics (final):** a locked node cannot be moved (set React Flow `draggable: false`) and cannot be deleted (Delete key and the modal's Delete button are both blocked with a toast "Component is locked"). Editing all other properties through the modal **is** allowed, including unlocking.

### 2.3 Port

```js
{
  id: string,
  type: "PWR+" | "PWR-" | "CANH" | "CANL" | "ETH" | "USB" | "DATA",
  label: string,            // e.g. "CAN H", "CH0+", shown always at 10px
  side: "top" | "right" | "bottom" | "left",
  order: number,            // 0-based position along its side, top→bottom / left→right
  gauge: string | null,     // default AWG suggestion (only PWR/CAN types; null otherwise)
  fitting: string | null    // default fitting suggestion (only PWR/CAN types; null otherwise)
}
```

Handles are rendered evenly distributed along their side in `order` sequence. Every port is rendered as a single React Flow `<Handle type="source" ...>` with `isConnectableStart` and `isConnectableEnd` both true (any port can start or receive a wire).

### 2.4 Edge

```js
{
  id, source, target, sourceHandle, targetHandle, type: "wire",
  data: {
    type: PortType,           // ALWAYS inherited from the SOURCE port at creation/reconnection
    layerId: string,          // auto-assigned from type (§3.3); user may change
    color: string | null,     // null = default color for type (§3.1)
    wireGauge: string | null, // only for PWR*/CAN* types; null for ETH/USB/DATA
    wireFitting: string | null, // same rule
    label: string,            // auto-generated from template at creation (§4)
    labelEdited: boolean,     // true once user manually edits the label
    length: number | null,    // inches; free numeric ≥ 0; null = unset
    notes: string             // default ""
  }
}
```

### 2.5 Layer

```js
{ id, name, visible: boolean, builtIn: boolean }
```

**Five default layers** (all `builtIn: true`, cannot be renamed or deleted): `Power`, `CAN Bus`, `Ethernet`, `USB`, `Data`. Custom layers are `builtIn: false`. Deleting a custom layer moves its wires to **Power** (after a confirmation dialog stating exactly that).

### 2.6 ComponentDefinition

```js
{
  id: string,               // built-ins: stable slugs e.g. "roborio2"; customs: UUID
  name: string,
  category: string,         // one of §5 categories, or "Custom"
  width: number, height: number,   // px; FIXED — no node resizing exists anywhere
  icon: string,             // key into the icon registry (built-ins) or "generic" (customs)
  defaultPorts: Port[],
  trackedFields: ("canId" | "ipAddress")[]
}
```

### 2.7 Settings — `localStorage['wireup_settings']` (per-user, NOT in project JSON)

```js
{
  gridSize: 16,             // px, integer 4–100
  snapToGrid: true,
  gridVisible: true,
  showPortLabels: true,
  showWireLabels: false     // canvas wire labels hidden by default (§4.4)
}
```

On app start, hydrate these into the store; persist on every change. **Excluded from undo history and from project JSON.** `wireLabelTemplate` is **per-project** (in project JSON), is **not** a setting, and does not appear in the Settings panel — this overrides the original plan's Phase 11, which contradicted Phase 2.

### 2.8 Autosave — `localStorage['wireup_autosave']`

Full project JSON, written debounced 500 ms after any history-tracked change. Single slot. On startup, if present, show a non-blocking banner: "Restore your last session? [Restore] [Dismiss]". Dismiss hides the banner but **keeps** the autosave (it will simply be overwritten by the next autosave). Restore loads it and clears the banner.

### 2.9 Undo/redo

zundo tracks: `nodes`, `edges`, `layers`, `projectName`, `wireLabelTemplate`, `customDefinitions`. It does NOT track settings, sidebar/tab/selection state, or panel visibility. Limit 100. **Atomic actions** (must be one undo step each): node deletion + its cascaded edge deletions; port removal + its cascaded edge deletions; layer deletion + wire reassignment; "regenerate all labels"; paste of a multi-node selection.

---

## 3. Wire Type System

### 3.1 Port/wire types, default colors, label groups

| Type | Default color | Hex | Label group (`{type}` token) | Default layer |
|---|---|---|---|---|
| PWR+ | red | `#ef4444` | `PWR` | Power |
| PWR- | black* | `#525252` | `PWR` | Power |
| CANH | yellow | `#eab308` | `CAN` | CAN Bus |
| CANL | green | `#22c55e` | `CAN` | CAN Bus |
| ETH  | blue | `#3b82f6` | `ETH` | Ethernet |
| USB  | purple | `#a855f7` | `USB` | USB |
| DATA | gray | `#9ca3af` | `DATA` | Data |

\* Pure black is invisible on the dark canvas; use dark gray `#525252` with a subtle lighter outline on selection.

### 3.2 Type inheritance & mismatch rule

A wire's `data.type` is **always the source port's type**, set at creation and re-derived if the source end is reconnected. Connecting two ports of different types is **allowed** but fires a one-shot warning toast: "Type mismatch: {sourceType} → {targetType}". Reconnecting either end of an existing edge to a new handle is allowed (React Flow `onReconnect`); it re-runs type/layer/gauge/fitting auto-assignment and the mismatch check. Connections where source node === target node (any ports) are **blocked** silently (no edge created, brief toast "Can't connect a component to itself").

### 3.3 Auto-assignment on connect

When an edge is created: `type` ← source port type; `layerId` ← default layer for type (§3.1); `wireGauge` ← source port's `gauge` (else type default below); `wireFitting` ← source port's `fitting` (else type default); `label` ← generated from template (§4); `color` ← null (renders type default).

### 3.4 Gauges & fittings

Gauge options (PWR* and CAN* wires only): `2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22 AWG`.
Fitting options: `Anderson Powerpole, Anderson SB50, Ring Terminal, Ferrule, Wago Lever Nut, JST, Bare Wire`.

Type defaults: PWR battery-side leads **6 AWG / Anderson SB50** (set on Battery & Main Breaker ports); general PWR **12 AWG / Ferrule**; low-current PWR (sensor/radio power) **18 AWG / Ferrule** (set on those ports); CAN **22 AWG / Wago Lever Nut**. ETH/USB/DATA: gauge & fitting are `null` and their inputs are hidden in all UIs.

---

## 4. Wire Labels

### 4.1 Template engine (`src/utils/labelUtils.js`)

Template is a plain string with tokens. Supported tokens (only these four):

| Token | Expands to |
|---|---|
| `{type}` | Label group: `PWR`, `CAN`, `ETH`, `USB`, `DATA` |
| `{index}` | **Per-group** counter, zero-padded to 3 digits: first CAN wire → `001`, first PWR wire → `001` independently |
| `{from}` | Source component's `label` |
| `{to}` | Target component's `label` |

Default template: `{type}{index}` → `CAN001`, `CAN002`, `PWR001`… A CAN H and CAN L pair are both group `CAN` and consume consecutive indices (`CAN001`, `CAN002`); same for PWR+/PWR−. Indices are assigned in edge-creation order and are not recycled when wires are deleted (next new CAN wire after deleting CAN002 is CAN003 — simple, predictable).

### 4.2 Regeneration

The template editor lives **above the Wire table in Sheet view** (text input + token hint row). Pressing Enter (or a "Regenerate" button): if any edge has `labelEdited === true`, show confirm dialog "N manually edited labels will be overwritten. Continue?"; on confirm, reassign every edge's label in deterministic order (sort: group, then creation order), reset all `labelEdited` to false. One undo step.

### 4.3 Manual edits

Editing a label in the Wire Config Panel or Sheet sets `labelEdited: true`. No uniqueness enforcement.

### 4.4 Canvas display

Wire labels are **hidden on canvas by default**. Settings toggle "Show wire labels" renders every wire's label at its path midpoint (10px, Oswald, color = wire color, dark pill background). Independent of the toggle, the **selected** wire always shows its label.

---

## 5. Component Library (`src/data/componentLibrary.js`)

Built-in definitions below — **32 components, 8 categories** (the original plan's "13 components across 4 categories" was self-contradictory; this supersedes it). Port shorthand: `P±` = PWR+ & PWR− pair, `CAN` = CANH & CANL pair. Sides chosen by the implementer for visual sense (convention: power in on left, power out on right, CAN on bottom, ETH/USB on top), evenly spaced. Sizes: small sensors 100×60, motors/controllers 120×70, mid devices 140×80, hubs/PD 180×110, roboRIO 200×120.

**Tracked fields:** `canId` for every device with CAN ports except power-distribution inputs noted below; `ipAddress` for roboRIO 2, Orange Pi 5, Raspberry Pi 5, Limelight 4, VH-109, Ethernet Switch.

| Category | Component | Default ports | Tracked |
|---|---|---|---|
| Controllers | **roboRIO 2** | P± (in, left), CAN, ETH, USB ×2 — per owner decision, no PWM/DIO/analog port fan-out | canId? no; ipAddress |
| Controllers | **Orange Pi 5** | P±, ETH, USB ×2 | ipAddress |
| Controllers | **Raspberry Pi 5** | P±, ETH, USB ×2 | ipAddress |
| Power | **Battery (12V)** | PWR+ (6 AWG/SB50), PWR− (6 AWG/SB50) | — |
| Power | **Main Breaker (120A)** | PWR+ IN, PWR+ OUT (both 6 AWG/SB50) — breaker sits in the + lead only | — |
| Power | **PDH (REV)** | P± IN (6 AWG), CAN, 8 output pairs `CH0±`…`CH7±` (12 AWG/Ferrule). Users add more channel ports via the modal if needed | canId |
| Power | **PDP 2.0 (CTRE)** | same shape as PDH | canId |
| Power | **PDP (CTRE, legacy)** | same shape as PDH | canId |
| Power | **VRM** | P± IN, `12V±` pair, `5V±` pair (18 AWG) | — |
| Power | **Radio Power Module (REV RPM)** | P± IN (18 AWG), ETH IN, ETH OUT (PoE), `AUX±` pair | — |
| Power | **Mini Power Module (CTRE MPM)** | P± IN, 4 output pairs (18 AWG) | — |
| Motor Controllers | **SPARK MAX** | `V±` in (12 AWG), CAN, `M±` out (12 AWG), DATA ("Encoder") | canId |
| Motor Controllers | **SPARK Flex** | same as SPARK MAX | canId |
| Motor Controllers | **Talon FXS** | `V±` in, CAN, `M±` out, DATA ("Data port") | canId |
| Motor Controllers | **Talon SRX (legacy)** | `V±`, CAN, `M±`, DATA | canId |
| Motor Controllers | **Victor SPX (legacy)** | `V±`, CAN, `M±` | canId |
| Motor Controllers | **Generic Motor Controller** | `V±`, CAN, `M±`, DATA | canId |
| Motors | **Kraken X60** (integrated Talon FX) | P± (12 AWG), CAN | canId |
| Motors | **Kraken X44** | P±, CAN | canId |
| Motors | **Falcon 500 (legacy)** | P±, CAN | canId |
| Motors | **Minion** | P±, DATA ("Hall") — simplified 2-wire power model | — |
| Motors | **NEO** / **NEO 550** / **NEO Vortex** (3 entries) | P±, DATA ("Encoder") | — |
| Motors | **Generic Motor** | P± | — |
| Sensors | **CANcoder** | P± (18 AWG), CAN | canId |
| Sensors | **Pigeon 2** | P±, CAN | canId |
| Sensors | **CANdle** | P±, CAN, DATA ("LED out") | canId |
| Sensors | **CANrange** | P±, CAN | canId |
| Sensors | **CANdi** | P±, CAN, DATA ×2 ("S1","S2") | canId |
| Sensors | **Limelight 4** | P± (18 AWG), ETH | ipAddress |
| Sensors | **Generic Sensor** | P±, DATA | — |
| Networking | **VH-109 Radio** | P± (18 AWG), ETH ×2 ("RIO/PoE", "AUX") | ipAddress |
| Networking | **Ethernet Switch** | P±, ETH ×5 | ipAddress |
| Pneumatics | **Pneumatic Hub (REV)** | P±, CAN | canId |
| Pneumatics | **PCM (CTRE)** | P±, CAN | canId |
| Pneumatics | **Compressor** | P± | — |
| Pneumatics | **Solenoid** | P± | — |
| Other | **Robot Signal Light (RSL)** | P± (18 AWG) | — |
| Other | **Servo Hub (REV)** | P±, CAN | canId |

(Rows with multiple entries count individually; total 38 rows ≈ final count — exact count is whatever the table yields; "32" above is approximate and not load-bearing.)

### 5.1 Icons

One SVG React component per definition in `src/assets/icons/`, 40×40 viewBox, stroke-only white/silver (`#e5e5e5`) line art ~1.5px, block-diagram abstraction (e.g., battery = cell symbol, motor = circle+M, radio = antenna arcs, breaker = switch symbol, Limelight = camera lens). Customs and generics use a shared `GenericIcon` (rounded rect + chip notches). Sidebar renders them at 24×24; node headers at 20×20.

---

## 6. Wire Routing Engine — **REVISED SCOPE** (`src/utils/routingUtils.js`)

Owner decision: **wires must never pass over or under (through) component bodies; wires may cross each other, and crossings must be visually indicated.** This replaces the original "2-segment 45°" spec. Implement as follows — this is the hardest part of the project; build and unit-test it as pure functions before wiring into React Flow.

### 6.1 Pathfinding

- **Routing lattice:** A* over a uniform grid of `max(8, gridSize/2)` px, restricted to the bounding box of the two endpoints expanded by 250 px on all sides (perf cap).
- **Obstacles:** every node's rect inflated by **10 px padding** is impassable — including the source/target nodes themselves, *except* each path begins/ends with a fixed **16 px stub** exiting perpendicular from the port in the direction of its side (the stub is exempt from collision).
- **Costs:** orthogonal step = 1; **bend penalty = 4** (favors long straight runs); optional diagonal moves at cost 1.42 are permitted to preserve the app's 45° aesthetic (diagonals may not cut obstacle corners — both adjacent orthogonal cells must be free).
- **Post-processing:** collapse collinear points; chamfer each 90° corner into a short 45° segment (8 px) when space allows, so output keeps the 45° visual language.
- **Failure fallback:** if A* finds no path (endpoint fully enclosed), render a straight dashed line in the wire's color and show a one-time toast "No clear route found for {label}". Never crash.
- **Determinism:** tie-break A* expansion by (x, then y) so paths are stable across renders.

### 6.2 Recompute triggers

- On edge create/reconnect, node add/delete, and **node drag end** for all edges touching moved nodes — synchronous full A*.
- **During drag**, affected edges re-route with a cheap live preview: straight source-stub → direct line → target-stub (no A*), so dragging stays 60 fps. Full route restores on drop.
- Memoize per-edge by a hash of (source pos, target pos, set of obstacle rects). Cache invalidates only when inputs change.

### 6.3 Crossing hops

After all visible-layer paths are computed: detect pairwise segment intersections between different edges (skip intersections within 12 px of either edge's endpoints). At each crossing, the edge **later in the `edges` array** (higher z) renders a semicircular **hop**: the path detours over the crossing with an arc of radius 5 px, gap underneath left clear. Implement by splitting that edge's SVG path at the intersection and inserting an `A 5 5` arc. Hops recompute whenever any path or layer visibility changes. Hidden-layer wires produce no hops.

### 6.4 Rendering (`WireEdge.jsx`)

Custom edge using `<BaseEdge path={d}>` with the computed `d`. Stroke 2 px (3 px + outer glow `#ffffff40` when selected). Color: `data.color ?? typeDefault`. Visibility: if the edge's layer is hidden, render nothing (also exclude from hop detection). Click target: invisible 12 px-wide stroke overlay for easy selection.

---

## 7. Views & Components (phase-by-phase)

### Phase 1 — Scaffolding
1. `npm create vite@latest wireup -- --template react`; set `base: '/Wireup/'`.
2. Install: `@xyflow/react zustand zundo tailwindcss postcss autoprefixer html-to-image jspdf jspdf-autotable xlsx lucide-react gh-pages`.
3. Tailwind config: surfaces `#111113 / #1a1a1c / #232326`, borders `#333`, accent silver `#d4d4d8`, plus the §3.1 wire palette as named colors. Fonts wired into `fontFamily`.
4. Directory skeleton per §10. Deploy scripts: `"predeploy": "npm run build", "deploy": "gh-pages -d dist"`.
**Done when:** blank dark page with header bar deploys to the Pages URL.

### Phase 2 — Store (`src/store/diagramStore.js`)
State + actions per §2. Actions: `addNode, updateNodeData, moveNode, removeNode, addEdge, updateEdgeData, removeEdge, reconnectEdge, addLayer, renameLayer, toggleLayer, removeLayer, setProjectName, setWireLabelTemplate, addCustomDefinition, loadProject, newProject, undo, redo` + non-temporal UI slice (`activeTab, sidebarOpen, selection, settings…`). zundo config per §2.9. Autosave per §2.8. `newProject` shows a confirm ("Unsaved changes will be lost") whenever any history-tracked change exists since the last explicit save/load.
**Done when:** unit tests cover atomic undo of cascaded deletes and autosave round-trip.

### Phase 3 — Library data *(parallel with 4)*
§5 definitions, §3 color/gauge/fitting tables, all SVG icons.
**Done when:** every definition renders its icon and ports in a Storybook-style scratch page (a temp route is fine).

### Phase 4 — Canvas core *(parallel with 3)*
1. `ComponentNode.jsx`: header (20px icon + label + lock icon when locked), body, port handles per §2.3 with 8 px colored dots (port-type color) and always-visible 10 px labels (respecting `showPortLabels`), 1.5 px border in `data.color ?? silver`.
2. `DiagramCanvas.jsx`: React Flow v12 with `snapToGrid={settings.snapToGrid}` `snapGrid={[gridSize, gridSize]}`, dot `<Background>` (hidden when `gridVisible` false), `<Controls>`, `fitView` on load.
3. DnD from sidebar: `onDrop` reads `dataTransfer('application/wireup-definition')`, places via `screenToFlowPosition()`; if a node already occupies that exact snapped cell, offset +24/+24 until clear.
4. `onConnect` / `onReconnect` → §3.2/3.3 logic. Same-node connections blocked.
5. Selection: single click selects; marquee + shift-click multi-select; group drag moves the selection (locked nodes stay put and are excluded with a toast if the user attempts to drag them directly).
6. Keyboard: `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Y` and `Ctrl/Cmd+Shift+Z` redo, `Ctrl/Cmd+C/V` copy/paste, `Delete`/`Backspace` delete selection (skipping locked nodes; deleting selected edges is allowed), `Escape` = close any open modal/panel first, otherwise clear selection.
7. **Copy/paste:** clones selected nodes (new IDs, `label` reused verbatim) offset +24/+24, cascading +24 per repeated paste; clones edges **whose both endpoints are inside the copied set**; edges to outside nodes are not cloned. One undo step.
**Done when:** nodes drag, connect, multi-select, copy/paste, undo — with straight placeholder edges (routing comes next).

### Phase 5 — Routing engine *(depends on 4)*
Implement §6 in full. Pure functions + Vitest unit tests for: route around a single obstacle, stub direction per side, fallback when enclosed, hop insertion at a known crossing, determinism.
**Done when:** dragging a node between two connected nodes makes the wire route around it, and two crossing wires show a hop on the top wire.

### Phase 6 — Component sidebar
260 px left accordion; search input filters by component **name only**, case-insensitive, across all categories in real time (empty categories collapse away); categories collapsible; items draggable (24 px icon + name). "+ New Custom Component" opens `CreateComponentModal`: name (required), category (free text, defaults "Custom"), width/height (60–400 px), port list builder (type/label/side rows, add/remove). Saved into `customDefinitions`; appears under "Custom". Sidebar collapse toggle on its right edge, 200 ms width transition.

### Phase 7 — Layer panel
Floating bottom-left, visible only on Diagram tab. Rows: eye toggle + name; built-ins: eye only; customs: eye, inline rename (double-click name), delete (confirm dialog per §2.5). "+" adds "Layer N" custom layer. Hiding a layer hides its wires (and removes them from hop math).

### Phase 8 — Component config modal *(depends on 4)*
Opens on **double-click** of a node (single-click only selects — this supersedes the original plan). Centered modal, `Escape`/backdrop closes. Sections:
- **Header:** editable name, `<input type="color">`, lock toggle.
- **General:** notes textarea.
- **Tracked fields:** CAN ID numeric input clamped **0–63** (shown only if definition tracks it); IP address text input (shown only if tracked).
- **Ports:** rows of type select / label / side select / gauge / fitting (gauge+fitting inputs hidden for ETH/USB/DATA), add/remove. Removing a port deletes its attached edges immediately, no confirmation, one undo step with the port removal.
- **Connected wires:** read-only list of `{label} → {other component}`; clicking selects that edge on canvas and closes the modal.
- **Delete Component:** red button, confirm dialog "Delete {name} and N attached wires?" (blocked with toast if locked).

### Phase 9 — Wire config panel *(depends on 8)*
Clicking an edge selects it and opens a floating panel pinned top-right of the canvas (not a modal; `Escape` or canvas-click closes). Fields: label (text; sets `labelEdited`), color picker, layer dropdown, type (read-only badge), gauge + fitting selects (PWR/CAN only), **length (inches, numeric)** — added per owner decision, notes. Every field change calls `updateEdgeData` immediately.

### Phase 10 — Sheet view *(depends on 9)*
Header tab switch swaps the main area (canvas unmounts visually but Zustand state persists; lazy-load this view with `React.lazy`). Layer panel hidden here.
- **Table 1 — Components:** Name, Type (definition name), Category, CAN ID, IP Address, Notes. Read-only. Default sort: Name A→Z.
- **Table 2 — Wires:** Wire Label, Type (group), From, To, Gauge, Fitting, Color (swatch), Length (in) *(editable)*, Notes *(editable)*, Layer. Default sort: type group, then label. **From/To format: `Component (Port)`**, e.g. `roboRIO 2 (CAN H)`.
- Clickable column headers toggle asc/desc; a filter text input above the wire table matches label/from/to.
- Template editor above Table 2 per §4.2.
- Inline edits (Length numeric, Notes text) commit on blur/Enter via `updateEdgeData` and survive tab switches.

### Phase 11 — Export & save/load *(depends on 10)*
Header "Export ▾" dropdown: **Canvas:** PNG | JPEG | SVG | PDF — **Sheet:** CSV | Excel | PDF, plus separate header buttons "Save" (download project JSON) and "Open" (file input). All filenames: `sanitize(projectName)` (strip `\/:*?"<>|`, trim, fall back to `wireup-project`) + proper extension.
- If a canvas export is chosen while on the Sheet tab (or vice versa), **auto-switch to the needed tab, run the export, and stay on that tab.**
- Canvas raster: `fitView({padding: 0.1})`, then `html-to-image` `toPng`/`toJpeg` on the `.react-flow` element, `backgroundColor: '#1a1a1c'`, `pixelRatio: 2`.
- Canvas SVG: `toSvg` — note in code comments this embeds HTML via `<foreignObject>` (accepted limitation; not a clean vector).
- Canvas PDF: the PNG embedded in a `jsPDF` page sized to the image aspect (landscape, fit-to-content).
- Sheet CSV: **two files**, `{name}-components.csv` and `{name}-wires.csv`, RFC-4180 quoting, downloaded sequentially.
- Sheet Excel: one `.xlsx`, sheets "Components" and "Wires".
- Sheet PDF: `jspdf-autotable`, portrait Letter, both tables stacked with headings.
- Project name: inline-editable text in the header (click to edit, Enter/blur commits).

### Phase 12 — Settings panel *(depends on 11)*
Gear icon → right-side drawer. Exactly five settings (§2.7): Grid size (number input 4–100), Snap to grid, Grid visible, Show port labels, Show wire labels. All persist to localStorage immediately. **No wire-label-template here** (it's per-project, in Sheet view).

### Phase 13 — Polish & deploy
1. Guard rails recap: same-node block, mismatch toast, locked-node protections, drop-offset, layer-fallback, routing fallback.
2. Mobile: **dismissible** top banner "Wireup is best used on desktop" at viewport `< 768px`; app remains usable.
3. Restore banner (§2.8). 4. ARIA labels on all interactive controls; focus trap + `Escape` in modals; focus returns to trigger on close. 5. Debounce: autosave 500 ms, search 150 ms, settings writes 250 ms. 6. `npm run deploy`; verify at `https://spybh66.github.io/Wireup/`, including a hard-refresh deep test of save→reload→open.

---

## 8. Header layout (final)

Left → right: **Wireup wordmark** (Oswald) · editable project name · tab switch [Diagram | Sheet] · spacer · Undo/Redo buttons · New · Open · Save · Export ▾ · Settings gear.

---

## 9. Toasts

One shared toast system (`src/components/shared/Toast.jsx`), bottom-center, auto-dismiss 3.5 s, max 3 stacked. Used for: type mismatch, locked-node block, self-connection block, routing fallback, load errors, "newer version" rejection.

---

## 10. File map

| File | Purpose |
|---|---|
| `src/store/diagramStore.js` | All state (Zustand + zundo), autosave |
| `src/data/componentLibrary.js` | §5 definitions |
| `src/data/wireTypes.js` | §3 colors / layer map / gauges / fittings / defaults |
| `src/assets/icons/*.jsx` | SVG icon components + registry |
| `src/components/canvas/DiagramCanvas.jsx` | React Flow root, DnD, keyboard, selection |
| `src/components/canvas/ComponentNode.jsx` | Node renderer |
| `src/components/canvas/WireEdge.jsx` | Edge renderer (routed path + hops) |
| `src/components/canvas/LayerPanel.jsx` | Layer visibility panel |
| `src/components/canvas/WireConfigPanel.jsx` | Floating wire editor |
| `src/components/sidebar/ComponentSidebar.jsx` | Library + search |
| `src/components/sidebar/CreateComponentModal.jsx` | Custom component builder |
| `src/components/modal/ComponentConfigModal.jsx` | Component editor |
| `src/components/sheet/SheetView.jsx` | Sheet tab root (lazy) |
| `src/components/sheet/ComponentTable.jsx` / `WireTable.jsx` | Tables |
| `src/components/header/Header.jsx` / `SettingsPanel.jsx` | Header + settings drawer |
| `src/components/shared/Toast.jsx`, `ConfirmDialog.jsx` | Shared UI |
| `src/utils/routingUtils.js` | §6 A* router + hop detection (pure, unit-tested) |
| `src/utils/labelUtils.js` | §4 template engine |
| `src/utils/exportUtils.js` | All exports |
| `src/utils/saveLoadUtils.js` | JSON save/load/validate, autosave helpers |

---

## 11. Verification checklist (must all pass before deploy)

- [ ] Drag roboRIO 2 + PDH onto canvas; connect CAN H → CAN H: wire is yellow, labeled `CAN001`, on CAN Bus layer, 22 AWG / Wago.
- [ ] Drag a Battery **between** them: the wire reroutes around the battery, never under it.
- [ ] Create two wires that cross: the top wire shows a semicircular hop at the crossing.
- [ ] Connect CAN H → PWR+: edge is created (type CAN H) and a mismatch toast appears.
- [ ] Try to connect a component to itself: blocked with toast.
- [ ] Double-click roboRIO: modal opens; rename; canvas label updates; set CAN ID 64 → clamped/rejected to 63; lock it; drag → doesn't move; Delete → toast.
- [ ] Single click only selects (no modal). Marquee-select 3 nodes, Ctrl+C/V: clones + the edges between them appear at +24/+24; Ctrl+Z removes all in one step.
- [ ] Click a wire: panel opens; change color/layer/length; toggle that layer off: wire disappears and its hops vanish.
- [ ] Delete a custom layer containing wires: confirm dialog; wires land on Power.
- [ ] Sheet tab: tables populated; From/To shows `Component (Port)`; edit Length, switch tabs and back: persists.
- [ ] Change template to `{type}-{index}-{from}` and regenerate with one manually edited label present: confirm dialog mentions 1 edited label; labels rebuild.
- [ ] Save JSON → New (confirm fires) → Open the file: identical diagram, layers, customs, template.
- [ ] Reload the page mid-edit: restore banner appears; Restore brings everything back; Dismiss leaves the autosave intact.
- [ ] All 6 export formats download with sanitized project-name filenames; canvas PNG shows the full diagram on dark background; choosing a Sheet export from the Diagram tab auto-switches.
- [ ] Settings persist across reloads; "Show wire labels" toggles canvas labels; template box is NOT in settings.
- [ ] `npm run deploy` → app fully functional at `https://spybh66.github.io/Wireup/` (assets load under the `/Wireup/` base).
- [ ] Window < 768 px: dismissible banner appears.
- [ ] Routing unit tests pass (`vitest`).

---

## 12. Explicit non-goals (do not build)

No backend/server, no multi-diagram projects, no node resizing, no light theme, no PWM/DIO breakout realism on the roboRIO, no obstacle-aware label placement, no auto-layout, no collaborative editing, no mobile-optimized UI, no global (cross-project) custom components.

---

## 13. Decision Log (owner-confirmed — do not re-litigate)

1. React Flow **v12** (`@xyflow/react`); original "v11" was an error.
2. Library expanded to full current FRC ecosystem (§5); categories restructured to 8.
3. `wireLabelTemplate` is **per-project** (project JSON), edited in Sheet view, absent from Settings.
4. Grid/snap/visibility/port-label/wire-label settings: store-held, localStorage-persisted, never in project JSON or undo history.
5. **Double-click** opens the component modal; single-click selects.
6. Lock = no move, no delete; modal editing allowed.
7. Escape closes modal/panel first, then deselects.
8. Edge endpoint reconnection allowed; re-runs auto-assignment.
9. Paste offset +24 px cascading; edges internal to the copied set are cloned; external edges are not.
10. All same-node connections blocked.
11. Wire type inherits from the **source** port; mismatches allowed with warning toast.
12. 7th port type **DATA** (gray) + 5th default layer **Data**.
13. `{index}` is per label-group.
14. Tokens: `{type}`, `{index}`, `{from}`, `{to}` only.
15. Regenerate overwrites all labels after a confirm dialog when manual edits exist.
16. Canvas wire labels off by default; Settings toggle; selected wire always labeled.
17. Label groups collapse pairs: CAN H/L → `CAN`, PWR± → `PWR`.
18. Library: "everything you can find" — §5 is the canonical list.
19. roboRIO 2 ports limited to power-in, CAN, ETH, USB×2.
20. CAN ID range **0–63**.
21. Gauges 2–22 even AWG; per-type defaults per §3.4.
22. Length unit: **inches**.
23. From/To format `Component (Port)`.
24. CSV export = two files.
25. Wrong-tab export auto-switches and stays.
26. SVG export kept with documented `foreignObject` caveat.
27. Filenames = sanitized project name.
28. Dismissing the restore banner keeps the autosave.
29. New Project confirms when unsaved changes exist.
30. Project name inline-edited in header; doubles as export filename.
31. Version field `1`; reject only newer-version files.
32. Single autosave slot.
33. Repo `Spybh66/Wireup` → `base: '/Wireup/'`.
34. **Routing: full obstacle avoidance + crossing hops (§6)** — supersedes "2-segment 45°"; 45° survives as corner chamfers.
35. Mobile: dismissible banner below 768 px.
36. Wire length editable in the Wire Config Panel and the Sheet.
37. Cascading operations are atomic undo steps.
38. Evergreen browsers only.
