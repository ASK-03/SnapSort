import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from './store';
import { getImages, getProgress, getStats, initApi } from './api';

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
  const { isScanning, setIsScanning, setProgress, setImages, searchQuery, setStats, viewMode, theme, selectedPerson } = useAppStore();
  const query = searchQuery.trim();
  const [isReady, setIsReady] = useState(false);

  const loadImages = useCallback(async () => {
    try {
      const stats = await getStats();
      setStats(stats);

      const data = await getImages(0, 1000);
      const current = useAppStore.getState().images;
      if (data.length !== current.length || data.some((path: string, index: number) => path !== current[index])) {
        setImages(data);
      }
    } catch (e) {
      console.error(e);
    }
  }, [setImages, setStats]);

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
  }, [isScanning, isReady, loadImages, setIsScanning, setProgress]);

  useEffect(() => {
    if (!isReady) return;
    // Initial load
    loadImages();
  }, [isReady, loadImages]);

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
      <div className="flex h-screen flex-col bg-bg text-text overflow-hidden font-sans selection:bg-accent/30">
        <TopBar />
        <div className="flex flex-1 min-h-0">
          <Sidebar />
          <main className="relative flex min-w-0 flex-1 overflow-hidden">
            <div className={`flex flex-1 min-w-0 ${query ? 'invisible' : ''}`} inert={Boolean(query)}>
              {viewMode === 'photos' && <Gallery />}
              {viewMode === 'people' && selectedPerson && <PersonView />}
              {(viewMode === 'faces' || (viewMode === 'people' && !selectedPerson)) && <Faces />}
              {viewMode === 'settings' && <Settings />}
              {viewMode === 'about' && <About />}
            </div>
            {query && <div className="absolute inset-0 flex"><Gallery query={query} /></div>}
          </main>
        </div>
        
        <Lightbox />
        <ContextMenu />
      </div>
    </div>
  );
}

export default App;
