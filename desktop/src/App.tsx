import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { getImages, getProgress, getSearch, getStats, initApi, getImagesForFace } from './api';

import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Gallery } from './components/Gallery';
import { Faces } from './components/Faces';
import { ImageDetails } from './components/ImageDetails';
import { Lightbox } from './components/Lightbox';
import { Settings } from './components/Settings';
import { About } from './components/About';

function App() {
  const { isScanning, setIsScanning, setProgress, setImages, searchQuery, setStats, viewMode, setViewMode, theme } = useAppStore();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    initApi().then(() => {
      setIsReady(true);
    });
  }, []);

  useEffect(() => {
    if (!isReady) return;

    let interval: ReturnType<typeof setInterval>;
    if (isScanning) {
      interval = setInterval(async () => {
        try {
          const prog = await getProgress();
          setProgress({ total: prog.total_images, processed: prog.processed_images, pending: prog.pending_tasks });
          loadImages(); // Update gallery continuously while scanning
          if (!prog.is_scanning) {
            setIsScanning(false);
          }
        } catch (e) {
          console.error(e);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isScanning, isReady]);

  useEffect(() => {
    if (!isReady) return;
    // Initial load
    loadImages();
  }, [isReady]);

  useEffect(() => {
    const handleSearch = async () => {
      if (!searchQuery.trim()) {
        loadImages();
        return;
      }
      try {
        if (searchQuery.startsWith('face:')) {
          const faceId = parseInt(searchQuery.split(':')[1]);
          if (!isNaN(faceId)) {
            const results = await getImagesForFace(faceId);
            setImages(results);
          }
        } else {
          const results = await getSearch(searchQuery);
          setImages(results.map((r: any) => r.path));
        }
        setViewMode('photos');
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
      const stats = await getStats();
      setStats(stats);

      if (!useAppStore.getState().searchQuery.trim()) {
        const data = await getImages(0, 1000);
        setImages(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (!isReady) {
    return (
      <div className={theme === 'dark' ? 'dark' : ''}>
        <div className="h-screen w-screen bg-slate-50 dark:bg-[#0f1115] flex items-center justify-center">
          <div className="text-blue-500 animate-pulse">Starting backend...</div>
        </div>
      </div>
    );
  }

  return (
    <div className={theme === 'dark' ? 'dark' : ''}>
      <div className="flex h-screen bg-slate-50 dark:bg-[#0f1115] text-slate-900 dark:text-slate-100 overflow-hidden font-sans selection:bg-blue-500/30">
        <Sidebar />
        
        <main className="flex-1 flex flex-col min-w-0">
          <TopBar />
          
          <div className="flex-1 flex overflow-hidden">
            {viewMode === 'photos' && <Gallery />}
            {(viewMode === 'faces' || viewMode === 'people') && <Faces />}
            {viewMode === 'settings' && <Settings />}
            {viewMode === 'about' && <About />}
            
            <ImageDetails />
          </div>
        </main>
        
        <Lightbox />
      </div>
    </div>
  );
}

export default App;
