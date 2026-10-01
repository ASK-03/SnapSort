import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { getFaceThumbnailUrl, api } from '../api';
import { Users, CheckCircle2, Merge } from 'lucide-react';
import { withViewTransition } from '../lib/viewTransition';
import { flushSync } from 'react-dom';
import { PERSON_AVATAR_VT, personNav } from './PersonView';

// Survives unmount so the grid is on screen the instant PersonView closes
// (the back transition needs the target card in the DOM synchronously).
let facesCache: {id: number, name: string, count?: number}[] = [];

const FaceCard = ({ face, isSelected, onSelect, onOpen, onNameSave }: {
  face: {id: number, name: string, count?: number},
  isSelected: boolean,
  onSelect: (id: number) => void,
  onOpen?: (face: {id: number, name: string}, avatar: HTMLElement) => void,
  onNameSave: (id: number, name: string) => Promise<void>
}) => {
  const [name, setName] = useState(face.name || '');

  useEffect(() => {
    setName(face.name || '');
  }, [face.name]);

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await onNameSave(face.id, name);
    }
  };

  return (
    <div
      className={`bg-surface rounded-lg overflow-hidden border transition-colors duration-150 flex flex-col relative group ${isSelected ? 'border-accent ring-1 ring-accent shadow-md' : 'border-border hover:border-accent/50'}`}
    >
      <div
        className={`aspect-square bg-surface-hi relative cursor-pointer ${onOpen ? 'w-4/5 mx-auto mt-3 rounded-full overflow-hidden' : 'w-full'}`}
        onClick={(e) => onOpen ? onOpen(face, e.currentTarget) : onSelect(face.id)}
      >
        <img
          src={getFaceThumbnailUrl(face.id)}
          alt={face.name || `Person ${face.id}`}
          loading="lazy"
          data-face-avatar
          style={face.id === personNav.returnId ? { viewTransitionName: PERSON_AVATAR_VT } as any : undefined}
          className="w-full h-full object-cover"
        />
        {isSelected && (
          <div className="absolute top-1.5 right-1.5 text-accent bg-bg rounded-full shadow-sm">
            <CheckCircle2 size={16} className="fill-current text-accent stroke-bg" />
          </div>
        )}
      </div>
      <div className="p-2">
        {isSelected && !onOpen ? (
          <input
            type="text"
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Name..."
            className="w-full bg-surface-hi border border-accent rounded px-1.5 py-0.5 text-xs text-text focus:outline-none placeholder:text-text-mute"
          />
        ) : (
          <h3
            className="text-text font-medium text-xs truncate cursor-pointer hover:text-accent transition-colors duration-150"
            onClick={(e) => onOpen ? onOpen(face, e.currentTarget) : onSelect(face.id)}
          >
            {face.name || 'Unknown'}
          </h3>
        )}
        <p className="text-[10px] text-text-mute mt-0.5 flex justify-between">
          <span>Person #{face.id}</span>
          {face.count !== undefined && <span>{face.count} photos</span>}
        </p>
      </div>
    </div>
  );
};

export const Faces = () => {
  const { viewMode, setSelectedPerson } = useAppStore();
  const [faces, setFaces] = useState(facesCache);
  const [selectedFaceIds, setSelectedFaceIds] = useState<number[]>([]);

  const fetchFaces = () => {
    api.get('/faces')
      .then(res => { facesCache = res.data.faces; setFaces(res.data.faces); })
      .catch(console.error);
  };

  useEffect(() => {
    if (viewMode === 'faces' || viewMode === 'people') {
      fetchFaces();
    }
  }, [viewMode]);

  const toggleSelect = (id: number) => {
    setSelectedFaceIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const openPerson = (face: {id: number, name: string}, el: HTMLElement) => {
    // Name the clicked avatar so the browser morphs it into PersonView's header.
    personNav.returnId = null;
    document.querySelectorAll<HTMLElement>('[data-face-avatar]').forEach(a => { a.style.viewTransitionName = ''; });
    const avatar = el.querySelector('img') ?? el;
    (avatar as HTMLElement).style.viewTransitionName = PERSON_AVATAR_VT;
    withViewTransition(() => flushSync(() => setSelectedPerson({ id: face.id, name: face.name })));
  };

  const handleNameSave = async (id: number, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    try {
      await api.put(`/faces/${id}`, { name: trimmed });
      setSelectedFaceIds(prev => prev.filter(x => x !== id));
      fetchFaces();
    } catch (e) {
      console.error("Naming failed", e);
    }
  };

  const handleMerge = async () => {
    if (selectedFaceIds.length < 2) return;

    // Find all selected face objects to check which has the most "information"
    const selected = faces.filter(f => selectedFaceIds.includes(f.id));

    // Sort logic:
    // 1. Faces with a name come first.
    // 2. If both have a name (or neither do), the one with more photos (count) comes first.
    selected.sort((a, b) => {
      const aHasName = a.name && a.name.trim() !== '' ? 1 : 0;
      const bHasName = b.name && b.name.trim() !== '' ? 1 : 0;

      if (aHasName !== bHasName) {
        return bHasName - aHasName; // 1 (named) before 0 (unnamed)
      }

      // If both named or both unnamed, sort by count (descending)
      const aCount = a.count || 0;
      const bCount = b.count || 0;
      return bCount - aCount;
    });

    const primary_id = selected[0].id;
    const other_ids = selectedFaceIds.filter(id => id !== primary_id);

    try {
      await api.post('/faces/merge', { primary_id, other_ids });
      setSelectedFaceIds([]);
      fetchFaces();
    } catch (e) {
      console.error("Merge failed", e);
    }
  };

  if (viewMode !== 'faces' && viewMode !== 'people') return null;

  const displayFaces = viewMode === 'people'
    ? faces.filter(f => f.name && f.name.trim() !== '')
    : faces;

  return (
    <div className="flex-1 flex flex-col bg-bg h-full overflow-hidden">
      <div className="px-8 py-4 flex items-center justify-between">
        <span className="text-sm text-text-mute">{displayFaces.length.toLocaleString()} {viewMode === 'people' ? 'named people' : 'people identified'}</span>

        {selectedFaceIds.length > 0 && (
          <div className="flex items-center gap-3">
            {viewMode === 'faces' && selectedFaceIds.length > 1 && (
              <button
                onClick={handleMerge}
                className="flex items-center gap-2 bg-surface-hi hover:brightness-110 text-text px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150"
              >
                <Merge size={16} />
                Merge {selectedFaceIds.length}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 px-8 pb-4 overflow-y-auto">
        {displayFaces.length === 0 ? (
          <div className="h-full flex items-center justify-center text-text-mute flex-col gap-4">
            <Users size={48} className="opacity-20" />
            <p>No {viewMode === 'people' ? 'named people' : 'faces'} found yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-4">
            {displayFaces.map((face) => (
              <FaceCard
                key={face.id}
                face={face}
                isSelected={selectedFaceIds.includes(face.id)}
                onSelect={toggleSelect}
                onOpen={viewMode === 'people' ? openPerson : undefined}
                onNameSave={handleNameSave}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
