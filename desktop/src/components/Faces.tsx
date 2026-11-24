import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Users, Check, Merge, Pencil } from 'lucide-react';
import { useAppStore } from '../store';
import { getFaceThumbnailUrl, api, scanFolder } from '../api';
import { withViewTransition } from '../lib/viewTransition';
import { PERSON_AVATAR_VT, personNav } from './PersonView';

interface FaceItem {
  id: number;
  name: string;
  count?: number;
}

// Survives unmount so the grid is on screen the instant PersonView closes.
let facesCache: FaceItem[] = [];

const pluralPhotos = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'photo' : 'photos'}`;

const PersonCard = ({
  face,
  onOpen,
}: {
  face: FaceItem;
  onOpen: (face: FaceItem, el: HTMLElement) => void;
}) => {
  const countText = face.count !== undefined ? pluralPhotos(face.count) : '';
  return (
    <button
      type="button"
      onClick={(e) => onOpen(face, e.currentTarget)}
      aria-label={countText ? `Open ${face.name}, ${countText}` : `Open ${face.name}`}
      className="tile-pressable group bg-surface border border-border hover:border-text-mute rounded-xl p-3 flex flex-col items-center gap-2.5 text-center min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div
        data-face-avatar
        style={face.id === personNav.returnId ? { viewTransitionName: PERSON_AVATAR_VT } : undefined}
        className="w-full aspect-square rounded-full overflow-hidden bg-surface-hi img-frame-outline"
      >
        <img
          src={getFaceThumbnailUrl(face.id)}
          alt={face.name}
          loading="lazy"
          className="hover-zoom-img w-full h-full rounded-full object-cover block"
        />
      </div>
      <div className="w-full min-w-0 flex flex-col gap-0.5">
        <span className="text-sm font-medium leading-snug text-text break-words">
          {face.name}
        </span>
        {countText && (
          <span className="text-xs leading-tight text-text-mute tabular-nums">
            {countText}
          </span>
        )}
      </div>
    </button>
  );
};

const FaceClusterCard = ({
  face,
  isSelected,
  onSelect,
  onNameSave,
}: {
  face: FaceItem;
  isSelected: boolean;
  onSelect: (id: number) => void;
  onNameSave: (id: number, name: string) => Promise<void>;
}) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(face.name || '');

  useEffect(() => {
    setName(face.name || '');
  }, [face.name]);

  const commit = async () => {
    setEditing(false);
    const trimmed = name.trim();
    if (!trimmed || trimmed === face.name) return;
    await onNameSave(face.id, trimmed);
  };

  return (
    <div
      className={`bg-surface rounded-lg overflow-hidden border flex flex-col transition-colors duration-150 ${
        isSelected ? 'border-accent ring-2 ring-inset ring-accent' : 'border-border hover:border-text-mute'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(face.id)}
        aria-label={`Select ${face.name || `cluster ${face.id}`}`}
        aria-pressed={isSelected}
        className="tile-pressable img-frame-outline relative aspect-square w-full bg-surface-hi overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <img
          src={getFaceThumbnailUrl(face.id)}
          alt={face.name || `Detected face ${face.id}`}
          loading="lazy"
          className="w-full h-full object-cover block"
        />
        {isSelected && (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-accent text-on-accent grid place-items-center"
          >
            <Check size={12} strokeWidth={3} />
          </span>
        )}
      </button>

      <div className="p-2 flex flex-col gap-1 min-w-0">
        {editing ? (
          <div className="flex flex-col gap-1.5 min-w-0">
            <input
              type="text"
              autoFocus
              value={name}
              aria-label="Person name"
              placeholder="Enter name"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void commit();
                }
                if (e.key === 'Escape') {
                  setName(face.name || '');
                  setEditing(false);
                }
              }}
              className="w-full bg-bg border border-accent rounded-md px-2 py-1 text-xs text-text focus:outline-none placeholder:text-text-mute"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Save name"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void commit()}
                className="pressable flex-1 py-1 rounded-md bg-accent text-on-accent text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Save
              </button>
              <button
                type="button"
                aria-label="Cancel rename"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setName(face.name || '');
                  setEditing(false);
                }}
                className="pressable flex-1 py-1 rounded-md bg-surface-hi border border-border text-text-dim hover:text-text text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : face.name ? (
          <div className="flex items-center justify-between gap-1 min-w-0">
            <span className="text-[13px] font-medium text-text truncate">{face.name}</span>
            <button
              type="button"
              aria-label={`Rename ${face.name}`}
              title="Rename person"
              onClick={() => {
                setName(face.name || '');
                setEditing(true);
              }}
              className="pressable w-6 h-6 rounded-md text-text-mute hover:text-accent hover:bg-surface-hi grid place-items-center shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Pencil size={12} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setName('');
              setEditing(true);
            }}
            className="pressable w-full flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-hi border border-dashed border-border text-text-dim hover:border-accent hover:text-accent text-xs font-medium text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Pencil size={12} aria-hidden="true" className="shrink-0" />
            <span className="truncate">Add name</span>
          </button>
        )}
        {!editing && (
          <span className="text-xs text-text-mute tabular-nums px-0.5">
            {face.count !== undefined ? pluralPhotos(face.count) : `Cluster #${face.id}`}
          </span>
        )}
      </div>
    </div>
  );
};

export const Faces = () => {
  const { viewMode, setViewMode, setSelectedPerson, setIsScanning, setScanningFolder } = useAppStore();
  const [faces, setFaces] = useState<FaceItem[]>(facesCache);
  const [selectedFaceIds, setSelectedFaceIds] = useState<number[]>([]);

  const fetchFaces = () => {
    api.get('/faces')
      .then((res) => {
        facesCache = res.data.faces;
        setFaces(res.data.faces);
      })
      .catch(console.error);
  };

  useEffect(() => {
    if (viewMode === 'faces' || viewMode === 'people') {
      fetchFaces();
    }
  }, [viewMode]);

  const toggleSelect = (id: number) => {
    setSelectedFaceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const openPerson = (face: FaceItem, el: HTMLElement) => {
    personNav.returnId = null;
    document.querySelectorAll<HTMLElement>('[data-face-avatar]').forEach((a) => {
      a.style.viewTransitionName = '';
    });
    const avatar = el.querySelector<HTMLElement>('[data-face-avatar]') ?? el;
    avatar.style.viewTransitionName = PERSON_AVATAR_VT;
    withViewTransition(() => flushSync(() => setSelectedPerson({ id: face.id, name: face.name })));
  };

  const handleNameSave = async (id: number, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await api.put(`/faces/${id}`, { name: trimmed });
      setSelectedFaceIds((prev) => prev.filter((x) => x !== id));
      fetchFaces();
    } catch (e) {
      console.error('Naming failed', e);
    }
  };

  const handleMerge = async () => {
    if (selectedFaceIds.length < 2) return;
    const selected = faces.filter((f) => selectedFaceIds.includes(f.id));
    selected.sort((a, b) => {
      const aHasName = a.name && a.name.trim() !== '' ? 1 : 0;
      const bHasName = b.name && b.name.trim() !== '' ? 1 : 0;
      if (aHasName !== bHasName) return bHasName - aHasName;
      return (b.count || 0) - (a.count || 0);
    });

    const primary_id = selected[0].id;
    const other_ids = selectedFaceIds.filter((id) => id !== primary_id);

    try {
      await api.post('/faces/merge', { primary_id, other_ids });
      setSelectedFaceIds([]);
      fetchFaces();
    } catch (e) {
      console.error('Merge failed', e);
    }
  };

  const handleAddFolder = async () => {
    const folderPath = await window.electronAPI?.openDirectory();
    if (folderPath) {
      const parts = folderPath.split(/[\\/]/);
      setScanningFolder(parts[parts.length - 1] || folderPath);
      setIsScanning(true);
      await scanFolder(folderPath);
    }
  };

  if (viewMode !== 'faces' && viewMode !== 'people') return null;

  const isPeople = viewMode === 'people';
  const displayFaces = isPeople
    ? faces.filter((f) => f.name && f.name.trim() !== '')
    : faces;

  const countLabel = isPeople
    ? `${displayFaces.length.toLocaleString()} ${displayFaces.length === 1 ? 'person' : 'people'}`
    : `${displayFaces.length.toLocaleString()} ${displayFaces.length === 1 ? 'cluster' : 'clusters'}`;

  return (
    <div className="flex-1 flex flex-col bg-bg h-full overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-4 px-6 pt-5 pb-3.5 min-h-[76px]">
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="text-3xl leading-tight font-semibold tracking-[-0.025em] text-text">
            {isPeople ? 'People' : 'Faces'}
          </h1>
          <span className="text-sm text-text-mute tabular-nums">· {countLabel}</span>
        </div>

        {!isPeople && selectedFaceIds.length > 1 && (
          <button
            type="button"
            onClick={() => void handleMerge()}
            className="pressable inline-flex items-center gap-2 h-9 bg-surface border border-border hover:bg-surface-hi text-text px-3.5 rounded-lg text-sm font-medium shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Merge size={15} aria-hidden="true" />
            <span className="tabular-nums">Merge {selectedFaceIds.length}</span>
          </button>
        )}
      </header>

      <div className="flex-1 px-6 pb-6 overflow-y-auto">
        {displayFaces.length === 0 ? (
          <div className="reveal-soft h-full flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-12 h-12 rounded-xl bg-surface border border-border grid place-items-center text-text-dim">
              <Users size={20} strokeWidth={1.75} aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-text">
              {isPeople ? 'No named people yet' : 'No faces detected yet'}
            </h2>
            <p className="text-[13px] text-text-dim max-w-[36ch]">
              {isPeople
                ? 'Name face clusters in Faces so people appear here.'
                : 'Add a folder with photos to detect and group faces on your device.'}
            </p>
            <button
              type="button"
              onClick={() => (isPeople ? setViewMode('faces') : void handleAddFolder())}
              className="pressable rounded-lg border border-border bg-surface text-text hover:bg-surface-hi px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {isPeople ? 'Go to Faces' : 'Add folder'}
            </button>
          </div>
        ) : isPeople ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(144px,1fr))] gap-4">
            {displayFaces.map((face) => (
              <PersonCard key={face.id} face={face} onOpen={openPerson} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(136px,1fr))] gap-3">
            {displayFaces.map((face) => (
              <FaceClusterCard
                key={face.id}
                face={face}
                isSelected={selectedFaceIds.includes(face.id)}
                onSelect={toggleSelect}
                onNameSave={handleNameSave}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
