// §10 Sheet view root — Components, Wires, Validation, and Bill of Materials.
import ComponentTable from './ComponentTable';
import WireTable from './WireTable';
import ValidationTable from './ValidationTable';
import BomView from './BomView';

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
        <section>
          <h2 className="mb-2 font-heading text-lg font-semibold text-silver">Validation</h2>
          <ValidationTable />
        </section>
        <section>
          <h2 className="mb-2 font-heading text-lg font-semibold text-silver">Bill of Materials</h2>
          <BomView />
        </section>
      </div>
    </div>
  );
}
