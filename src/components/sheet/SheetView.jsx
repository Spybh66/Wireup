// §10 Sheet view root — Components table + Wires table (lazy-loaded).
import ComponentTable from './ComponentTable';
import WireTable from './WireTable';

export default function SheetView() {
  return (
    <div className="h-full overflow-y-auto bg-surface-0 p-6">
      <div className="mx-auto max-w-6xl space-y-8">
        <section>
          <h2 className="mb-2 font-heading text-lg font-semibold text-silver">Components</h2>
          <ComponentTable />
        </section>
        <section>
          <h2 className="mb-2 font-heading text-lg font-semibold text-silver">Wires</h2>
          <WireTable />
        </section>
      </div>
    </div>
  );
}
