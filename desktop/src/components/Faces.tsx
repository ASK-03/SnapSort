import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { getFaceThumbnailUrl, api } from '../api';
import { Users, CheckCircle2, Merge } from 'lucide-react';

const FaceCard = ({ face, isSelected, onSelect, onNameSave }: {
  face: {id: number, name: string, count?: number},
  isSelected: boolean,
  onSelect: (id: number) => void,
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
      className={`bg-white dark:bg-[#1a1d24] rounded-lg overflow-hidden border transition-colors flex flex-col relative group ${isSelected ? 'border-blue-500 ring-1 ring-blue-500 shadow-md' : 'border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 shadow-sm dark:shadow-none'}`}
    >
      <div className="aspect-square bg-slate-200 dark:bg-slate-900 w-full relative cursor-pointer" onClick={() => onSelect(face.id)}>
        <img 
          src={getFaceThumbnailUrl(face.id)}
          alt={face.name || `Person ${face.id}`}
          loading="lazy"
          className="w-full h-full object-cover"
        />
        {isSelected && (
          <div className="absolute top-1.5 right-1.5 text-blue-500 bg-white rounded-full shadow-sm">
            <CheckCircle2 size={16} className="fill-current text-blue-500 stroke-white" />
          </div>
        )}
      </div>
      <div className="p-2">
        {isSelected ? (
          <input 
            type="text"
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Name..."
            className="w-full bg-slate-100 dark:bg-slate-800 border border-blue-500 rounded px-1.5 py-0.5 text-xs text-slate-900 dark:text-slate-200 focus:outline-none placeholder:text-slate-400"
          />
        ) : (
          <h3 
            className="text-slate-900 dark:text-slate-200 font-medium text-xs truncate cursor-pointer hover:text-blue-500" 
            onClick={() => onSelect(face.id)}
          >
            {face.name || 'Unknown'}
          </h3>
        )}
        <p className="text-[10px] text-slate-500 mt-0.5 flex justify-between">
          <span>Person #{face.id}</span>
          {face.count !== undefined && <span>{face.count} photos</span>}
        </p>
      </div>
    </div>
  );
};

export const Faces = () => {
  const { viewMode } = useAppStore();
  const [faces, setFaces] = useState<{id: number, name: string, count?: number}[]>([]);
  const [selectedFaceIds, setSelectedFaceIds] = useState<number[]>([]);

  const fetchFaces = () => {
    api.get('/faces')
      .then(res => setFaces(res.data.faces))
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
    <div className="flex-1 flex flex-col bg-slate-50 dark:bg-[#0f1115] h-full overflow-hidden">
      <div className="px-8 py-4 flex items-center justify-between">
        <span className="text-sm text-slate-400">{displayFaces.length.toLocaleString()} {viewMode === 'people' ? 'named people' : 'people identified'}</span>
        
        {selectedFaceIds.length > 0 && (
          <div className="flex items-center gap-3">
            {viewMode === 'faces' && selectedFaceIds.length > 1 && (
              <button 
                onClick={handleMerge}
                className="flex items-center gap-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
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
          <div className="h-full flex items-center justify-center text-slate-500 flex-col gap-4">
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
                onNameSave={handleNameSave}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
