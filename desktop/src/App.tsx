import { useEffect } from 'react';
import { useAppStore } from './store';
import { getImages, getProgress, getSearch } from './api';

import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Gallery } from './components/Gallery';
import { ImageDetails } from './components/ImageDetails';

function App() {
  const { isScanning, setIsScanning, setProgress, setImages, searchQuery, setStats } = useAppStore();

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isScanning) {
      interval = setInterval(async () => {
        try {
          const prog = await getProgress();
          setProgress({ total: prog.total_images, processed: prog.processed_images, pending: prog.pending_tasks });
          if (!prog.is_scanning) {
            setIsScanning(false);
            loadImages();
          }
        } catch (e) {
          console.error(e);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isScanning]);

  useEffect(() => {
    // Initial load
    loadImages();
  }, []);

  useEffect(() => {
    const handleSearch = async () => {
      if (!searchQuery.trim()) {
        loadImages();
        return;
      }
      try {
        const results = await getSearch(searchQuery);
        setImages(results.map((r: any) => r.path));
      } catch (e) {
        console.error(e);
      }
    };
    
    // Add debounce here in a real app, for now just call on change
    const timeout = setTimeout(handleSearch, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const loadImages = async () => {
    try {
      const data = await getImages(0, 1000); 
      setImages(data);
      // Hacky stats update
      setStats({ photos: data.length, faces: 128, people: 42 }); // In a real app we'd fetch this from the backend
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex h-screen bg-[#0f1115] text-slate-100 overflow-hidden font-sans selection:bg-blue-500/30">
      <Sidebar />
      
      <main className="flex-1 flex flex-col min-w-0">
        <TopBar />
        
        <div className="flex-1 flex overflow-hidden">
          <Gallery />
          <ImageDetails />
        </div>
      </main>
    </div>
  );
}

export default App;
