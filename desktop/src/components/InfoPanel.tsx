import { X, UserCircle2 } from 'lucide-react';
import { getImageUrl, getFaceThumbnailUrl } from '../api';
import { useAppStore } from '../store';

interface Face { id: number; name: string | null }

export const InfoPanel = ({ imagePath, faces, open }: { imagePath: string; faces: Face[]; open: boolean }) => {
  const setViewerPanel = useAppStore((s) => s.setViewerPanel);
  const filename = imagePath.split(/[\\/]/).pop() || 'Unknown';

  return (
    <div
      className="h-full bg-[#15161A] border-l border-white/10 overflow-hidden transition-[width] duration-250 ease-apple flex-shrink-0"
      style={{ width: open ? 320 : 0 }}
    >
      <div className="w-[320px] h-full flex flex-col px-[18px] py-5 overflow-y-auto text-white">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold">Info</span>
          <button
            onClick={() => setViewerPanel('none')}
            className="w-[26px] h-[26px] rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors duration-250 ease-apple"
          >
            <X size={12} />
          </button>
        </div>

        <div
          className="w-full h-[150px] rounded-[10px] bg-cover bg-center mb-3.5"
          style={{ backgroundImage: `url(${getImageUrl(imagePath)})` }}
        />
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
            <div key={f.id} className="flex items-center gap-2.5 py-1.5">
              <img src={getFaceThumbnailUrl(f.id)} className="w-7 h-7 rounded-full object-cover" alt={f.name || 'face'} />
              <span className="flex-1 text-[12.5px] font-semibold truncate">{f.name || 'Unknown'}</span>
            </div>
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
