import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { getImageUrl, getFaceThumbnailUrl } from '../api';
import axios from 'axios';
import { Star, Info, MoreHorizontal, ChevronRight, UserCircle2 } from 'lucide-react';

export const ImageDetails = () => {
  const { selectedImage, showRightSidebar, setShowRightSidebar } = useAppStore();
  const [faces, setFaces] = useState<number[]>([]);
  const [loadingFaces, setLoadingFaces] = useState(false);

  useEffect(() => {
    if (selectedImage) {
      setLoadingFaces(true);
      // Fetch faces for this image
      axios.get(`http://127.0.0.1:8000/api/images/faces?image_path=${encodeURIComponent(selectedImage)}`)
        .then(res => setFaces(res.data.face_ids))
        .catch(err => console.error(err))
        .finally(() => setLoadingFaces(false));
    }
  }, [selectedImage]);

  if (!showRightSidebar || !selectedImage) return null;

  // Mock metadata extraction from path
  const filename = selectedImage.split(/[\\/]/).pop() || 'Unknown';
  // Mock size/date
  const dateStr = "May 18, 2024 - 6:45 PM";
  const resolution = "4032 × 3024";

  return (
    <aside className="w-80 bg-[#14171d] border-l border-slate-800 flex flex-col h-full">
      {/* Top action bar (mockup has a close button at top or we can just rely on clicking elsewhere, but I'll add a header for now) */}
      <div className="p-4 flex items-center justify-between border-b border-slate-800/50">
        <h3 className="text-sm font-medium text-slate-200">Image Details</h3>
        <button onClick={() => setShowRightSidebar(false)} className="text-slate-400 hover:text-white">
          <MoreHorizontal size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Large Image Preview */}
        <div className="p-4">
          <div className="w-full aspect-[4/3] rounded-xl overflow-hidden bg-slate-900 border border-slate-800">
            <img 
              src={getImageUrl(selectedImage)}
              className="w-full h-full object-contain"
              alt="Preview"
            />
          </div>
        </div>

        {/* Metadata */}
        <div className="px-5 py-2">
          <h2 className="text-slate-200 font-medium mb-2">{filename}</h2>
          <div className="text-xs text-slate-500 space-y-1">
            <p>{dateStr}</p>
            <p>{resolution}</p>
          </div>

          <div className="flex items-center gap-4 mt-4 text-slate-400">
            <button className="hover:text-white transition-colors p-2 hover:bg-slate-800 rounded-lg"><Star size={18} /></button>
            <button className="hover:text-white transition-colors p-2 hover:bg-slate-800 rounded-lg"><Info size={18} /></button>
            <button className="hover:text-white transition-colors p-2 hover:bg-slate-800 rounded-lg ml-auto"><MoreHorizontal size={18} /></button>
          </div>
        </div>

        <div className="my-4 border-t border-slate-800/50 mx-5"></div>

        {/* Faces Section */}
        <div className="px-5">
          <div className="flex items-center justify-between mb-4 cursor-pointer hover:text-white text-slate-300 transition-colors">
            <div className="flex items-center gap-2 text-sm font-medium">
              <UserCircle2 size={16} />
              <span>Faces in this photo</span>
            </div>
            <ChevronRight size={16} className="text-slate-500" />
          </div>

          {loadingFaces ? (
            <div className="text-xs text-slate-500">Loading faces...</div>
          ) : faces.length > 0 ? (
            <div className="flex flex-wrap gap-2 mb-6">
              {faces.map(fid => (
                <div key={fid} className="w-12 h-12 rounded-full overflow-hidden border-2 border-slate-700 hover:border-blue-500 cursor-pointer">
                  <img src={getFaceThumbnailUrl(fid)} className="w-full h-full object-cover" alt={`Face ${fid}`} />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-500 mb-6">No faces detected.</div>
          )}

          <div className="space-y-2">
            <p className="text-xs text-slate-400">Add a name to faces</p>
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="Enter name..." 
                className="flex-1 bg-[#1a1d24] border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 transition-colors placeholder:text-slate-600"
              />
              <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors">
                Add Name
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
