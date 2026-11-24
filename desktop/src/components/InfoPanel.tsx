import { UserCircle2 } from 'lucide-react';
import { getFaceThumbnailUrl } from '../api';

interface Face {
  id: number;
  name: string | null;
}

export const InfoPanel = ({
  imagePath,
  faces,
  open,
  onFaceClick,
}: {
  imagePath: string;
  faces: Face[];
  open: boolean;
  onFaceClick: (f: Face) => void;
}) => {
  const filename = imagePath.split(/[\\/]/).pop() || 'Unknown';
  const ext = filename.includes('.') ? filename.split('.').pop()?.toUpperCase() || 'Unknown' : 'Unknown';

  return (
    <aside
      aria-label="Photo details"
      aria-hidden={!open}
      inert={!open}
      className={`absolute inset-y-0 right-0 z-10 w-80 bg-viewer-panel border-l border-border overflow-y-auto overscroll-contain transition-[transform,opacity] ease-drawer motion-reduce:transition-none ${
        open ? 'translate-x-0 opacity-100 duration-240' : 'translate-x-full opacity-0 pointer-events-none duration-150'
      }`}
    >
      <div className="flex flex-col p-5 text-text">
        <span className="text-sm font-semibold mb-0.5 break-all">{filename}</span>
        <span className="text-xs text-text-mute mb-4">Local file</span>

        <span className="text-xs font-medium text-text-mute mb-2">Details</span>
        <Row label="Format" value={ext} />
        <Row label="Path" value={imagePath} />

        <div className="h-px bg-border my-3.5" />

        <div className="flex items-center gap-2 text-xs font-medium text-text-mute mb-2.5">
          <UserCircle2 size={14} aria-hidden="true" />
          <span className="tabular-nums">People ({faces.length})</span>
        </div>

        {faces.length === 0 ? (
          <span className="text-[13px] text-text-mute">No faces detected.</span>
        ) : (
          <div className="space-y-1">
            {faces.map((f, idx) => (
              <button
                key={`${f.id}-${idx}`}
                type="button"
                onClick={() => onFaceClick(f)}
                title={`Show all photos of ${f.name || 'this person'}`}
                className="pressable w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-surface-hi hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <img src={getFaceThumbnailUrl(f.id)} className="w-7 h-7 rounded-full object-cover bg-surface-hi" alt="" />
                <span className="flex-1 text-[13px] font-medium truncate">{f.name || 'Unknown'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-3 text-[13px] py-1.5">
    <span className="text-text-mute flex-shrink-0">{label}</span>
    <span className="text-text text-right break-all min-w-0" title={value}>
      {value}
    </span>
  </div>
);
