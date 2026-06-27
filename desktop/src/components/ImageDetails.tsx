import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { getImageUrl, getFaceThumbnailUrl, api } from '../api';
import { X, ChevronRight, UserCircle2 } from 'lucide-react';

export const ImageDetails = () => {
  const { selectedImage, showRightSidebar, setShowRightSidebar, setSearchQuery, setLightboxImage } = useAppStore();
  const [faces, setFaces] = useState<{id: number, name: string | null}[]>([]);
  const [loadingFaces, setLoadingFaces] = useState(false);
  const [selectedFaceId, setSelectedFaceId] = useState<number | null>(null);
  const [nameInput, setNameInput] = useState('');

  useEffect(() => {
    if (selectedImage) {
      setLoadingFaces(true);
      // Fetch faces for this image
      api.get(`/images/faces?image_path=${encodeURIComponent(selectedImage)}`)
        .then(res => {
          setFaces(res.data.faces || []);
          setSelectedFaceId(null);
          setNameInput('');
        })
        .catch(err => console.error(err))
        .finally(() => setLoadingFaces(false));
    }
  }, [selectedImage]);

  const handleNameFace = async () => {
    if (!selectedFaceId || !nameInput.trim()) return;
    try {
      await api.put(`/faces/${selectedFaceId}`, { name: nameInput.trim() });
      setFaces(faces.map(f => f.id === selectedFaceId ? { ...f, name: nameInput.trim() } : f));
      setNameInput('');
      setSelectedFaceId(null);
    } catch (e) {
      console.error("Failed to name face", e);
    }
  };

  if (!showRightSidebar || !selectedImage) return null;

  // Mock metadata extraction from path
  const filename = selectedImage.split(/[\\/]/).pop() || 'Unknown';
  // Mock size/date
  const dateStr = "May 18, 2024 - 6:45 PM";
  const resolution = "4032 × 3024";

  return (
    <aside className="w-80 bg-slate-50 dark:bg-[#14171d] border-l border-slate-200 dark:border-slate-800 flex flex-col h-full">
      {/* Top action bar */}
      <div className="p-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800/50">
        <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">Image Details</h3>
        <button onClick={() => setShowRightSidebar(false)} className="text-slate-400 hover:text-slate-800 dark:hover:text-white">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Large Image Preview */}
        <div className="p-4">
          <div 
            className="w-full flex justify-center bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden cursor-pointer hover:border-slate-400 dark:hover:border-slate-600 transition-colors shadow-sm dark:shadow-none"
            onDoubleClick={() => setLightboxImage(selectedImage)}
          >
            <img 
              src={getImageUrl(selectedImage)}
              className="max-w-full max-h-[400px] object-contain select-none"
              alt="Preview"
              style={{ imageOrientation: 'from-image' } as any}
            />
          </div>
        </div>

        {/* Metadata */}
        <div className="px-5 py-2">
          <h2 className="text-slate-900 dark:text-slate-200 font-medium mb-2">{filename}</h2>
          <div className="text-xs text-slate-500 space-y-1">
            <p>{dateStr}</p>
            <p>{resolution}</p>
          </div>
        </div>

        <div className="my-4 border-t border-slate-200 dark:border-slate-800/50 mx-5"></div>

        {/* Faces Section */}
        <div className="px-5 pb-8">
          <div className="flex items-center justify-between mb-4 cursor-pointer hover:text-slate-900 dark:hover:text-white text-slate-600 dark:text-slate-300 transition-colors">
            <div className="flex items-center gap-2 text-sm font-medium">
              <UserCircle2 size={16} />
              <span>Faces in this photo</span>
            </div>
            <ChevronRight size={16} className="text-slate-500" />
          </div>

          {loadingFaces ? (
            <div className="text-xs text-slate-500">Loading faces...</div>
          ) : faces.length > 0 ? (
            <div className="flex flex-wrap gap-3 mb-6">
              {faces.map(face => (
                <div key={face.id} className="flex flex-col items-center gap-1 w-12">
                  <div 
                    className={`w-12 h-12 rounded-full overflow-hidden border-2 cursor-pointer transition-colors ${selectedFaceId === face.id ? 'border-blue-500' : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500'}`}
                    onClick={() => {
                      setSelectedFaceId(face.id);
                      setNameInput(face.name || '');
                      setSearchQuery(`face:${face.id}`);
                    }}
                  >
                    <img src={getFaceThumbnailUrl(face.id)} className="w-full h-full object-cover" alt={`Face ${face.id}`} />
                  </div>
                  {face.name && <span className="text-[10px] text-slate-400 truncate w-full text-center" title={face.name}>{face.name}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-500 mb-6">No faces detected.</div>
          )}

          <div className="space-y-2">
            <p className="text-xs text-slate-400">Add a name to selected face</p>
            <div className="flex flex-col gap-2">
              <input 
                type="text" 
                placeholder="Enter name..." 
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                disabled={!selectedFaceId}
                className="w-full bg-white dark:bg-[#1a1d24] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-900 dark:text-slate-200 focus:outline-none focus:border-blue-500 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600 disabled:opacity-50"
              />
              <button 
                onClick={handleNameFace}
                disabled={!selectedFaceId || !nameInput.trim()}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
              >
                Add Name
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
