# Design Rule Check (DRC) — Implementation Plan

A validation system that turns Wireup from a drawing tool into one that catches
real wiring mistakes. Combines structural checks (unconnected ports, CAN bus
integrity, channel oversubscription) with CAN ID / IP conflict detection. Every
rule is individually toggleable.

## Architecture

A pure, testable DRC **engine** + a **rule registry** (data objects), fed by
store state, surfaced in a **panel** and (later) on the canvas.

### Data shapes

```js
// src/utils/drc/rules.js — one entry per rule
{
  id: 'duplicate-can-id',
  label: 'Duplicate CAN ID',
  description: 'Two or more devices of the same type share a CAN ID.',
  severity: 'error',          // 'error' | 'warning' | 'info'
  run(ctx) { return [ ...violations ]; }   // ctx = { nodes, edges, defOf, portEdges, ... }
}

// A violation produced by run()
{
  ruleId: 'duplicate-can-id',
  severity: 'error',
  message: 'CAN ID 3 used by 2× Kraken X60',
  nodes: ['id1','id2'],       // offending element ids
  edges: [],
  fix: { kind: 'autoAssignCanId' } | null   // optional quick-fix (Phase 4)
}
```

### Store
- `settings.drc = { disabledRules: [] }` — persisted via existing `persistSettings`.
- `toggleDrcRule(ruleId)` — add/remove from `disabledRules`.
- Phase 4: `autoAssignCanIds()`, `autoAssignIps()` quick-fixes.

### Canvas bridge
- `canvasBridge.focusElements(nodeIds)` → React Flow `fitView({ nodes })` so
  clicking a violation pans/zooms to it; paired with `setSelection`.

## Rule set (Phase 1)

| id | sev | logic |
|---|---|---|
| `duplicate-can-id` | error | Group nodes by `definitionId::canId` (same device family); flag groups >1. |
| `duplicate-ip` | error | Group nodes by `ipAddress` (network-wide unique); flag groups >1. |
| `missing-can-id` | info | Node whose def tracks `canId` but value is empty. |
| `unconnected-can` | warning | Node has ≥1 `CAN` port but no `CAN` edge. |
| `can-bus-fragmented` | warning | CAN-wired devices form >1 connected group (should be one bus). |
| `unpowered-device` | warning | Non-Power-category node has a `PWR` port but no `PWR` edge. |
| `channel-oversubscribed` | warning | A `PWR` port drives more than one wire. |
| `floating-component` | info | Node with zero connections. |

### Known heuristics / refinements (tracked for Phase 5)
- `unpowered-device` excludes the `Power` category to avoid flagging
  sources (Battery/Breaker/PDH/VRM…). A precise fix is an optional
  `required`/`role:'input'` flag on port specs in `componentLibrary`.
- `duplicate-can-id` uses `definitionId` as the CAN device-class proxy, so the
  same ID on different device classes (e.g. a motor vs. a Pigeon) isn't flagged.
- `channel-oversubscribed` flags any `PWR` port with >1 wire; intentional power
  splits can disable the rule.

## Phases

### Phase 1 — Engine + rules (no UI) ✅ DONE
- `src/utils/drc/rules.js`, `src/utils/drc/engine.js`, `src/utils/drc/engine.test.js`
- `runDrc({nodes, edges, customDefinitions}, disabledRules)` builds a shared
  `ctx` once, runs enabled rules, returns `{ violations, counts }`.
- **Acceptance:** unit tests per rule (fires / doesn't); disabling omits a rule. ✅ (8 tests)

### Phase 2 — DRC panel UI (read-only) ✅ DONE
- `src/store/useDrc.js` hook (memoized selectors), `src/components/canvas/DrcPanel.jsx`.
- Header "Checks" button + severity-colored count badge (diagram tab).
- Floating panel (bottom-left); violations sorted by severity; click a row →
  select + `canvasBridge.focusElements` to pan/zoom to it; empty state.
- Per-rule enable/disable toggles (gear view inside the panel),
  `settings.drc.disabledRules` persisted via `toggleDrcRule`.
- **Acceptance:** live list; click selects + centers; counts correct; toggles
  persist across reload. ✅

### Phase 3 — Canvas integration (visual flags) ✅ DONE
- `DrcContext` provides `{ nodes: Map<id,severity>, edges: Map<id,severity> }`,
  computed once in `DiagramCanvas` from `useDrc()`.
- `ComponentNode`: severity icon badge (top-left corner).
- `WireEdge`: severity-colored halo under flagged wires.
- Always-on (independent of panel open state); stable during node drags (DRC
  reads committed store state, not the live drag positions).

### Phase 4 — Quick-fixes ✅ DONE
- `autoAssignCanIds()` — per device class: keep first valid id, renumber
  duplicates, fill blanks (single undo step).
- `autoAssignIps()` — resolve duplicate IPs onto the next free host octet of
  the detected subnet (blanks left untouched).
- "Auto-number" / "Auto-assign" button on the relevant violations in DrcPanel.
- Unit tests for both fixes.
- _Deferred:_ per-violation dismiss/ignore (low priority).

### Phase 5 — Reach & polish ⬜
- `required`-port flag refinement; per-rule severity override; validation in
  Sheet view + exports; About-tab docs; "next issue" hotkey.

## Progress log
- **Phase 1 (engine + 8 rules):** done. `runDrc` + rule registry + `engine.test.js`
  (8 tests). Sanity-checked on `examples/example.json` (catches MitoCANDria off
  the CAN bus, unpowered Orange Pi, missing CAN IDs).
- **Phase 2 (panel + toggle):** done. Header "Checks" button with severity badge;
  bottom-left floating `DrcPanel` (issue list → click to select/focus; gear view
  with per-rule on/off toggles, persisted). `canvasBridge.focusElements` added.
  Full suite 27 tests green; build clean.
- **Phase 3 (canvas badges):** done. `DrcContext` + node corner badges + edge
  severity halos, computed once in `DiagramCanvas`.
- **Phase 4 (quick-fixes):** done. `autoAssignCanIds` / `autoAssignIps` store
  actions + "Auto-number"/"Auto-assign" buttons on violations; 2 unit tests.
  Full suite 29 tests green.
- **Next:** Phase 5 (precise `required`-port flag, per-rule severity override,
  validation in Sheet view + exports, About-tab docs, "next issue" hotkey).
