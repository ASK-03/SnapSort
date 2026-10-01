import { UserCircle2 } from 'lucide-react';
import { getFaceThumbnailUrl } from '../api';

interface Face { id: number; name: string | null }

export const InfoPanel = ({ imagePath, faces, open, onFaceClick }: { imagePath: string; faces: Face[]; open: boolean; onFaceClick: (f: Face) => void }) => {
  const filename = imagePath.split(/[\\/]/).pop() || 'Unknown';

  return (
    <div
      className="h-full bg-[#15161A] border-l border-white/10 overflow-hidden transition-[width] duration-320 ease-apple flex-shrink-0"
      style={{ width: open ? 320 : 0 }}
    >
      {/* No thumbnail here — the main Viewer already shows the photo
          full-size; a second small copy was just empty-feeling padding. */}
      <div className="w-[320px] h-full flex flex-col px-[18px] pt-[76px] pb-5 overflow-y-auto text-white">
        <span className="text-[13px] font-semibold mb-0.5 truncate">{filename}</span>
        <span className="text-[11.5px] text-white/45 mb-4">Local file</span>

        <span className="text-[10.5px] font-bold tracking-wide text-white/45 mb-2">DETAILS</span>
        <Row label="Format" value={(filename.split('.').pop() || '').toUpperCase() || '—'} />
        <Row label="Path" value={imagePath} truncate />

        <div className="h-px bg-white/10 my-3.5" />

        <div className="flex items-center gap-2 text-[10.5px] font-bold tracking-wide text-white/45 mb-2.5">
          <UserCircle2 size={12} />
          <span>PEOPLE ({faces.length})</span>
        </div>
        {faces.length === 0 ? (
          <span className="text-[12px] text-white/40">No faces detected.</span>
        ) : (
          faces.map((f) => (
            <button
              key={f.id}
              onClick={() => onFaceClick(f)}
              title={`Show all photos of ${f.name || 'this person'}`}
              className="w-full flex items-center gap-2.5 py-1.5 text-left hover:text-accent transition-colors duration-150"
            >
              <img src={getFaceThumbnailUrl(f.id)} className="w-7 h-7 rounded-full object-cover" alt="" />
              <span className="flex-1 text-[12.5px] font-semibold truncate">{f.name || 'Unknown'}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

const Row = ({ label, value, truncate }: { label: string; value: string; truncate?: boolean }) => (
  <div className="flex justify-between gap-3 text-[12.5px] py-1.5">
    <span className="text-white/45 flex-shrink-0">{label}</span>
    <span className={`text-white/85 text-right ${truncate ? 'truncate' : ''}`} title={truncate ? value : undefined}>{value}</span>
  </div>
);
