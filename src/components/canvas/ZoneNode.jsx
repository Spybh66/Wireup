// Annotation node — labeled zone box. Resizable (when selected); label is
// editable inline. Sits behind components so it frames a region of the diagram.
import { memo, useRef } from 'react';
import { NodeResizer } from '@xyflow/react';
import useDiagramStore from '../../store/diagramStore';

function ZoneNode({ id, data, selected }) {
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
  const setAnnotationBox = useDiagramStore((s) => s.setAnnotationBox);
  const color = data.color ?? '#3b82f6';
  // Same pattern as node drags: pause history while resizing live, then put
  // the pre-resize nodes back and commit the final box as ONE undo step.
  const baseline = useRef(null);
  const onResizeStart = () => {
    baseline.current = useDiagramStore.getState().nodes;
    useDiagramStore.temporal.getState().pause();
  };
  const onResizeEnd = () => {
    const next = useDiagramStore.getState().nodes;
    if (baseline.current) useDiagramStore.setState({ nodes: baseline.current });
    useDiagramStore.temporal.getState().resume();
    useDiagramStore.setState({ nodes: next, dirty: true });
    baseline.current = null;
  };

  return (
    <>
      <NodeResizer
        isVisible={selected && !data.locked}
        minWidth={80}
        minHeight={60}
        color={color}
        onResizeStart={onResizeStart}
        onResize={(_, p) => setAnnotationBox(id, p)}
        onResizeEnd={onResizeEnd}
      />
      <div
        className="relative h-full w-full rounded-md border-2 border-dashed"
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
          className="nodrag nopan m-1 w-[calc(100%-2rem)] bg-transparent px-1 text-xs font-semibold uppercase tracking-wide outline-none"
          style={{ color }}
        />
        {selected && (
          <input
            type="color"
            value={color}
            onChange={(e) => updateNodeData(id, { color: e.target.value })}
            title="Zone color"
            aria-label="Zone color"
            className="nodrag nopan absolute right-1 top-1 h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
          />
        )}
      </div>
    </>
  );
}

export default memo(ZoneNode);
