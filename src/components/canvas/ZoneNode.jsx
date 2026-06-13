// Annotation node — labeled zone box. Resizable (when selected); label is
// editable inline. Sits behind components so it frames a region of the diagram.
import { memo } from 'react';
import { NodeResizer } from '@xyflow/react';
import useDiagramStore from '../../store/diagramStore';

function ZoneNode({ id, data, selected }) {
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
  const color = data.color ?? '#3b82f6';

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={80}
        minHeight={60}
        color={color}
        onResize={(_, p) => updateNodeData(id, { width: Math.round(p.width), height: Math.round(p.height) })}
      />
      <div
        className="rounded-md border-2 border-dashed"
        style={{
          width: data.width ?? 240,
          height: data.height ?? 160,
          borderColor: color,
          background: `${color}14`,
        }}
      >
        <input
          value={data.text ?? ''}
          onChange={(e) => updateNodeData(id, { text: e.target.value })}
          placeholder="Zone"
          className="nodrag nopan m-1 w-[calc(100%-0.5rem)] bg-transparent px-1 text-xs font-semibold uppercase tracking-wide outline-none"
          style={{ color }}
        />
      </div>
    </>
  );
}

export default memo(ZoneNode);
