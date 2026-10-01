import { create } from 'zustand';

type ViewMode = 'photos' | 'faces' | 'people' | 'settings' | 'about';

interface AppState {
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  images: string[];
  setImages: (images: string[]) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isScanning: boolean;
  setIsScanning: (scanning: boolean) => void;
  progress: { total: number; processed: number; pending: number };
  setProgress: (p: { total: number; processed: number; pending: number }) => void;
  
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  lightboxImage: string | null;
  setLightboxImage: (image: string | null) => void;
  
  stats: { photos: number; faces: number; people: number };
  setStats: (stats: { photos: number; faces: number; people: number }) => void;

  viewerPanel: 'none' | 'info' | 'edit';
  setViewerPanel: (panel: 'none' | 'info' | 'edit') => void;

  contextMenu: { x: number; y: number; imagePath: string } | null;
  setContextMenu: (menu: { x: number; y: number; imagePath: string } | null) => void;

  selectedPerson: { id: number; name: string } | null;
  setSelectedPerson: (person: { id: number; name: string } | null) => void;

  viewerZoom: number;
  setViewerZoom: (zoom: number) => void;

  viewerPan: { x: number; y: number };
  setViewerPan: (pan: { x: number; y: number }) => void;

  folderFilter: string | null;
  setFolderFilter: (folder: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'dark',
  setTheme: (theme) => set({ theme }),
  images: [],
  setImages: (images) => set({ images }),
  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  isScanning: false,
  setIsScanning: (isScanning) => set({ isScanning }),
  progress: { total: 0, processed: 0, pending: 0 },
  setProgress: (progress) => set({ progress }),
  
  viewMode: 'photos',
  lightboxImage: null,
  setLightboxImage: (lightboxImage) => set({ lightboxImage }),
  setViewMode: (viewMode) => set({ viewMode }),
  
  stats: { photos: 0, faces: 0, people: 0 },
  setStats: (stats) => set({ stats }),

  viewerPanel: 'none',
  setViewerPanel: (viewerPanel) => set({ viewerPanel }),

  contextMenu: null,
  setContextMenu: (contextMenu) => set({ contextMenu }),

  selectedPerson: null,
  setSelectedPerson: (selectedPerson) => set({ selectedPerson }),

  viewerZoom: 1,
  setViewerZoom: (viewerZoom) => set({ viewerZoom }),

  viewerPan: { x: 0, y: 0 },
  setViewerPan: (viewerPan) => set({ viewerPan }),

  folderFilter: null,
  setFolderFilter: (folderFilter) => set({ folderFilter }),
}));
