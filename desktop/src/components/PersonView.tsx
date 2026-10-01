import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { VirtuosoGrid } from 'react-virtuoso';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useAppStore } from '../store';
import { api, getFaceThumbnailUrl, getImagesForFace, getPreviewUrl } from '../api';

// Header avatar carries this view-transition-name; the matching People card
// gets the same one just before the transition (see Faces.tsx).
export const PERSON_AVATAR_VT = 'person-avatar';

// Set on back so Faces names the matching card avatar for the reverse morph.
export const personNav = { returnId: null as number | null };

export const withViewTransition = (fn: () => void) => {
  // @ts-ignore — experimental API, present in Chromium/Electron
  if (document.startViewTransition) document.startViewTransition(fn);
  else fn();
};

export const PersonView = () => {
  const { selectedPerson, setSelectedPerson, selectedImage, setSelectedImage, setShowRightSidebar, setLightboxImage } = useAppStore();
  const [paths, setPaths] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!selectedPerson) return;
    getImagesForFace(selectedPerson.id).then(setPaths).catch(console.error);
  }, [selectedPerson?.id]);

  if (!selectedPerson) return null;

  const goBack = () => {
    personNav.returnId = selectedPerson.id;
    withViewTransition(() => flushSync(() => setSelectedPerson(null)));
  };

  const save = async () => {
    const name = draft.trim();
    setEditing(false);
    if (!name || name === selectedPerson.name) return;
    try {
      await api.put(`/faces/${selectedPerson.id}`, { name });
      setSelectedPerson({ id: selectedPerson.id, name });
    } catch (e) {
      console.error('Rename failed', e);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 dark:bg-[#0f1115] h-full overflow-hidden">
      <div className="px-8 pt-6 pb-2 flex items-center gap-5">
        <button
          onClick={goBack}
          className="p-2 rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          aria-label="Back to people"
        >
          <ArrowLeft size={18} />
        </button>
        <img
          src={getFaceThumbnailUrl(selectedPerson.id)}
          alt={selectedPerson.name}
          style={{ viewTransitionName: PERSON_AVATAR_VT } as any}
          className="w-24 h-24 rounded-full object-cover ring-2 ring-blue-500/40"
        />
        <div>
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="text-3xl font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 border border-blue-500 rounded-lg px-2 focus:outline-none"
            />
          ) : (
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              {selectedPerson.name}
              <button
                onClick={() => { setDraft(selectedPerson.name); setEditing(true); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                aria-label="Edit name"
              >
                <Pencil size={16} />
              </button>
            </h2>
          )}
          <p className="text-sm text-slate-500 mt-1">{paths.length.toLocaleString()} photos</p>
        </div>
      </div>
      <div className="flex-1 px-8 pb-4 overflow-hidden">
        <VirtuosoGrid
          style={{ height: '100%' }}
          totalCount={paths.length}
          listClassName="grid gap-4 pt-4 grid-cols-5"
          itemContent={(index) => {
            const path = paths[index];
            const isSelected = selectedImage === path;
            return (
              <div
                className={`rounded-2xl overflow-hidden cursor-pointer border-2 border-transparent hover:border-slate-400 dark:hover:border-slate-600 transition-all bg-slate-200 dark:bg-black/20 aspect-square ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-[#0f1115]' : ''}`}
                onClick={() => { setSelectedImage(path); setShowRightSidebar(true); }}
                onDoubleClick={() => setLightboxImage(path)}
              >
                <img
                  src={getPreviewUrl(path)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                  style={{ imageOrientation: 'from-image' } as any}
                />
              </div>
            );
          }}
        />
      </div>
    </div>
  );
};
