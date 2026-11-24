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
import { StartupSplash } from './components/StartupSplash';

function App() {
  const {
    isScanning,
    setIsScanning,
    setScanningFolder,
    setProgress,
    setImages,
    searchQuery,
    setStats,
    viewMode,
    theme,
    selectedPerson,
  } = useAppStore();
  const query = searchQuery.trim();
  const [isReady, setIsReady] = useState(false);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

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
          loadImages();
          if (!prog.is_scanning) {
            setIsScanning(false);
            setScanningFolder(null);
          }
        } catch (e) {
          console.error(e);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isScanning, isReady, loadImages, setIsScanning, setScanningFolder, setProgress]);

  useEffect(() => {
    if (!isReady) return;
    // Initial load + attach to any headless scan already in progress
    loadImages();
    getProgress()
      .then((prog) => {
        if (prog.is_scanning) {
          setIsScanning(true);
          setProgress({ total: prog.total_images, processed: prog.processed_images, pending: prog.pending_tasks });
        }
      })
      .catch(console.error);
  }, [isReady, loadImages, setIsScanning, setProgress]);

  return (
    <div className="flex h-dvh flex-col bg-bg text-text overflow-hidden font-sans selection:bg-accent/30">
      <TopBar />
      {isReady ? (
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
      ) : (
        <div className="flex-1 bg-bg" />
      )}

      {isReady && (
        <>
          <Lightbox />
          <ContextMenu />
        </>
      )}

      {!splashDone && (
        <StartupSplash backendReady={isReady} onFinished={() => setSplashDone(true)} />
      )}
    </div>
  );
}

export default App;
