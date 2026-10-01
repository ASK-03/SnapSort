import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useAppStore } from '../store';
import { api, getFaceThumbnailUrl, getImagesForFace } from '../api';
import { withViewTransition } from '../lib/viewTransition';
import { PhotoGrid } from './Gallery';

// Header avatar carries this view-transition-name; the clicked People card
// gets the same one just before the transition (see Faces.tsx).
export const PERSON_AVATAR_VT = 'person-avatar';

// Set on back so Faces names the matching card avatar for the reverse morph.
export const personNav = { returnId: null as number | null };

export const PersonView = () => {
  const { selectedPerson, setSelectedPerson } = useAppStore();
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
    <div className="flex-1 flex flex-col bg-bg h-full overflow-hidden">
      <div className="px-8 pt-6 pb-2 flex items-center gap-5">
        <button
          onClick={goBack}
          className="p-2 rounded-lg text-text-dim hover:bg-surface-hi transition-colors duration-150"
          aria-label="Back to people"
        >
          <ArrowLeft size={18} />
        </button>
        <img
          src={getFaceThumbnailUrl(selectedPerson.id)}
          alt={selectedPerson.name}
          style={{ viewTransitionName: PERSON_AVATAR_VT } as any}
          className="w-24 h-24 rounded-full object-cover ring-2 ring-accent/40"
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
              className="text-3xl font-bold text-text bg-surface-hi border border-accent rounded-lg px-2 focus:outline-none"
            />
          ) : (
            <h2 className="text-3xl font-bold text-text flex items-center gap-3">
              {selectedPerson.name}
              <button
                onClick={() => { setDraft(selectedPerson.name); setEditing(true); }}
                className="p-1.5 rounded-lg text-text-mute hover:text-accent hover:bg-surface-hi transition-colors duration-150"
                aria-label="Edit name"
              >
                <Pencil size={16} />
              </button>
            </h2>
          )}
          <p className="text-sm text-text-mute mt-1">{paths.length.toLocaleString()} photos</p>
        </div>
      </div>
      <div className="flex-1 px-8 pb-4 overflow-hidden">
        <PhotoGrid paths={paths} cols={5} />
      </div>
    </div>
  );
};
