import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { getImages, getProgress, getSearch, getStats, initApi } from './api';

import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Gallery } from './components/Gallery';
import { Faces } from './components/Faces';
import { PersonView } from './components/PersonView';
import { Lightbox } from './components/Lightbox';
import { ContextMenu } from './components/ContextMenu';
import { Settings } from './components/Settings';
import { About } from './components/About';

function App() {
  const { isScanning, setIsScanning, setProgress, setImages, searchQuery, setStats, viewMode, setViewMode, theme, selectedPerson } = useAppStore();
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
        const results = await getSearch(searchQuery);
        setImages(results.map((r: any) => r.path));
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

      const state = useAppStore.getState();
      if (!state.searchQuery.trim()) {
        const data = await getImages(0, 1000);
        const current = useAppStore.getState().images;
        // Skip the update (and the resulting full-grid re-render) when nothing
        // actually changed — loadImages() is polled every second while scanning.
        const unchanged = current.length === data.length && current[current.length - 1] === data[data.length - 1];
        if (!unchanged) {
          setImages(data);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (!isReady) {
    return (
      <div className={theme === 'dark' ? 'dark' : ''}>
        <div className="h-screen w-screen bg-bg flex items-center justify-center">
          <div className="text-accent animate-pulse">Starting backend...</div>
        </div>
      </div>
    );
  }

  return (
    <div className={theme === 'dark' ? 'dark' : ''}>
      <div className="flex h-screen bg-bg text-text overflow-hidden font-sans selection:bg-accent/30">
        <Sidebar />
        
        <main className="flex-1 flex flex-col min-w-0">
          <TopBar />
          
          <div className="flex-1 flex overflow-hidden">
            {viewMode === 'photos' && <Gallery />}
            {viewMode === 'people' && selectedPerson && <PersonView />}
            {(viewMode === 'faces' || (viewMode === 'people' && !selectedPerson)) && <Faces />}
            {viewMode === 'settings' && <Settings />}
            {viewMode === 'about' && <About />}
          </div>
        </main>
        
        <Lightbox />
        <ContextMenu />
      </div>
    </div>
  );
}

export default App;
