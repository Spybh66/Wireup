// Annotation node — free text note. Double-click to edit; drag to move.
import { memo, useState } from 'react';
import useDiagramStore from '../../store/diagramStore';

function NoteNode({ id, data, selected }) {
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
  const [editing, setEditing] = useState(false);

  return (
    <div
      onDoubleClick={() => setEditing(true)}
      className={`min-w-[60px] max-w-[280px] rounded px-2 py-1 font-body text-sm ${
        selected ? 'ring-1 ring-silver/50' : ''
      }`}
      style={{ color: data.color ?? '#d4d4d8' }}
    >
      {editing ? (
        <textarea
          autoFocus
          defaultValue={data.text}
          onBlur={(e) => {
            updateNodeData(id, { text: e.target.value });
            setEditing(false);
          }}
          rows={Math.max(1, (data.text ?? '').split('\n').length)}
          className="nodrag nopan w-48 resize-none rounded border border-edge bg-surface-1 px-1 py-0.5 text-silver outline-none"
        />
      ) : (
        <span className="whitespace-pre-wrap break-words">{data.text || 'Note'}</span>
      )}
    </div>
  );
}

export default memo(NoteNode);
