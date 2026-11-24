import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useAppStore } from '../store';
import { api, getFaceThumbnailUrl, getImagesForFace } from '../api';
import { withViewTransition } from '../lib/viewTransition';
import { PhotoGrid } from './Gallery';

export const PERSON_AVATAR_VT = 'person-avatar';
export const personNav = { returnId: null as number | null };

const pluralPhotos = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'photo' : 'photos'}`;

export const PersonView = () => {
  const { selectedPerson, setSelectedPerson } = useAppStore();
  const [paths, setPaths] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!selectedPerson) return;
    getImagesForFace(selectedPerson.id).then(setPaths).catch(console.error);
  }, [selectedPerson]);

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
      <header className="px-6 pt-5 pb-4 flex items-center gap-4 shrink-0">
        <button
          type="button"
          onClick={goBack}
          className="pressable p-2 rounded-lg text-text-dim hover:text-text hover:bg-surface-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Back to people"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="w-20 h-20 rounded-full overflow-hidden bg-surface-hi img-frame-outline shrink-0">
          <img
            src={getFaceThumbnailUrl(selectedPerson.id)}
            alt={selectedPerson.name}
            style={{ viewTransitionName: PERSON_AVATAR_VT }}
            className="w-full h-full object-cover block"
          />
        </div>
        <div className="min-w-0">
          {editing ? (
            <input
              autoFocus
              aria-label="Edit person name"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="text-2xl font-semibold tracking-[-0.02em] text-text bg-surface-hi border border-accent rounded-lg px-2 py-0.5 focus:outline-none"
            />
          ) : (
            <div className="flex items-center gap-2.5 min-w-0">
              <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em] text-text truncate">
                {selectedPerson.name}
              </h1>
              <button
                type="button"
                onClick={() => {
                  setDraft(selectedPerson.name);
                  setEditing(true);
                }}
                className="pressable p-1.5 rounded-lg text-text-mute hover:text-accent hover:bg-surface-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Edit name"
              >
                <Pencil size={15} />
              </button>
            </div>
          )}
          <p className="text-[13px] text-text-mute mt-1 tabular-nums">{pluralPhotos(paths.length)}</p>
        </div>
      </header>
      <div className="flex-1 px-6 pb-2 overflow-hidden">
        <PhotoGrid paths={paths} cols={4} />
      </div>
    </div>
  );
};
