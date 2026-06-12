// §12 About tab — usage instructions, keyboard shortcuts, and tech stack.
import {
  MousePointer2,
  Move,
  Cable,
  Keyboard,
  Layers,
  Table2,
  Download,
} from 'lucide-react';

function Section({ icon: Icon, title, children }) {
  return (
    <section className="rounded-lg border border-edge bg-surface-1 p-4">
      <h3 className="mb-3 flex items-center gap-2 font-heading text-base font-semibold text-silver">
        <Icon size={18} className="text-neutral-300" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Step({ children }) {
  return <li className="text-sm leading-relaxed text-neutral-300">{children}</li>;
}

function Key({ children }) {
  return (
    <kbd className="rounded border border-edge bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-silver">
      {children}
    </kbd>
  );
}

const KEYBINDS = [
  { keys: ['Ctrl', 'Z'], action: 'Undo' },
  { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo' },
  { keys: ['Ctrl', 'Y'], action: 'Redo (alternate)' },
  { keys: ['Ctrl', 'C'], action: 'Copy selected components' },
  { keys: ['Ctrl', 'V'], action: 'Paste (offset from original)' },
  { keys: ['Delete'], action: 'Delete selection (wires + unlocked components)' },
  { keys: ['Backspace'], action: 'Delete selection' },
  { keys: ['Esc'], action: 'Close panel / clear selection' },
  { keys: ['Double-click'], action: 'Open a component’s config modal' },
  { keys: ['Left-drag'], action: 'Rubber-band select on empty canvas' },
  { keys: ['Right / Middle-drag'], action: 'Pan the canvas' },
  { keys: ['Scroll'], action: 'Zoom in / out' },
];

const STACK = [
  ['React 18', 'UI framework'],
  ['Vite', 'Build tool & dev server'],
  ['React Flow (@xyflow/react)', 'Node / edge canvas'],
  ['Zustand + zundo', 'State store with undo / redo history'],
  ['Tailwind CSS', 'Styling'],
  ['lucide-react', 'Interface icons'],
  ['html-to-image', 'PNG / JPEG / SVG canvas export'],
  ['jsPDF + jspdf-autotable', 'PDF export'],
  ['SheetJS (xlsx)', 'Excel / CSV export'],
  ['Custom octilinear router', 'KiCAD-style 45° auto-routing engine'],
];

export default function AboutView() {
  return (
    <div className="h-full overflow-y-auto bg-surface-0 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-silver">Wireup</h1>
          <p className="mt-1 text-sm text-neutral-400">
            A wiring-diagram tool for FRC robots — lay out components, auto-route wires, and export a
            build-ready wiring sheet.
          </p>
        </div>

        <Section icon={MousePointer2} title="Getting started">
          <ol className="ml-4 list-decimal space-y-1.5">
            <Step>
              Drag a component from the <strong>library</strong> on the left onto the canvas.
            </Step>
            <Step>
              Drag from one component’s <strong>port dot</strong> to another to create a wire. The
              wire inherits its type (power, CAN, Ethernet…) from the source port.
            </Step>
            <Step>
              Wires auto-route around components in clean 45° runs. Move a component and its wires
              re-route automatically.
            </Step>
            <Step>
              <strong>Double-click</strong> a component to rename it, set CAN ID / IP, edit ports, or
              lock it in place. Select a wire to edit its label, gauge, fittings, length, and color.
            </Step>
            <Step>
              Use the <strong>Sheet</strong> tab for a spreadsheet of every component and wire, then{' '}
              <strong>Export</strong> to PNG/PDF or CSV/Excel.
            </Step>
          </ol>
        </Section>

        <div className="grid gap-6 md:grid-cols-2">
          <Section icon={Cable} title="Wire routing">
            <ul className="ml-4 list-disc space-y-1.5">
              <Step>Wires run horizontally, vertically, and at 45°, avoiding components.</Step>
              <Step>Parallel wires spread into neatly spaced bundles instead of overlapping.</Step>
              <Step>Crossing wires hop over one another with a jump symbol.</Step>
              <Step>Adding a wire re-optimizes the nearby cluster, not the whole diagram.</Step>
            </ul>
          </Section>

          <Section icon={Layers} title="Layers & organization">
            <ul className="ml-4 list-disc space-y-1.5">
              <Step>Each wire type lives on a layer (Power, CAN Bus, Ethernet, USB, Data).</Step>
              <Step>Toggle layer visibility from the panel in the bottom-right of the canvas.</Step>
              <Step>Customize wire labels with the template editor in the Sheet tab.</Step>
            </ul>
          </Section>
        </div>

        <Section icon={Keyboard} title="Keyboard shortcuts">
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {KEYBINDS.map((k) => (
              <div key={k.action} className="flex items-center justify-between gap-3">
                <span className="text-sm text-neutral-300">{k.action}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {k.keys.map((key) => (
                    <Key key={key}>{key}</Key>
                  ))}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            On macOS, use <Key>⌘</Key> in place of <Key>Ctrl</Key>.
          </p>
        </Section>

        <div className="grid gap-6 md:grid-cols-2">
          <Section icon={Table2} title="Sheet view">
            <ul className="ml-4 list-disc space-y-1.5">
              <Step>Inline-edit CAN IDs, IP addresses, notes, wire lengths, and fittings.</Step>
              <Step>Sort and filter to find any component or wire quickly.</Step>
            </ul>
          </Section>

          <Section icon={Download} title="Saving & export">
            <ul className="ml-4 list-disc space-y-1.5">
              <Step>Work autosaves to your browser; reopen to restore it.</Step>
              <Step>Save / open <code className="text-neutral-200">.wireup.json</code> project files.</Step>
              <Step>Export the canvas (PNG/JPEG/SVG/PDF) or the sheet (CSV/Excel/PDF).</Step>
            </ul>
          </Section>
        </div>

        <Section icon={Move} title="Tech stack">
          <ul className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {STACK.map(([name, desc]) => (
              <li key={name} className="text-sm text-neutral-300">
                <span className="font-heading text-silver">{name}</span>
                <span className="text-neutral-500"> — {desc}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
