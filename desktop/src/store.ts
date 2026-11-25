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
  scanningFolder: string | null;
  setScanningFolder: (folder: string | null) => void;
  progress: { total: number; processed: number; pending: number };
  setProgress: (p: { total: number; processed: number; pending: number }) => void;

  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  lightboxImage: string | null;
  lightboxPaths: string[];
  setLightboxImage: (image: string | null, paths?: string[]) => void;
  lastLightboxTrigger: string | null;
  setLastLightboxTrigger: (path: string | null) => void;

  stats: { photos: number; faces: number; people: number };
  setStats: (stats: { photos: number; faces: number; people: number }) => void;

  viewerPanel: 'none' | 'info' | 'edit';
  setViewerPanel: (panel: 'none' | 'info' | 'edit') => void;

  contextMenu: { x: number; y: number; imagePath: string; paths: string[] } | null;
  setContextMenu: (menu: { x: number; y: number; imagePath: string; paths: string[] } | null) => void;

  selectedPerson: { id: number; name: string } | null;
  setSelectedPerson: (person: { id: number; name: string } | null) => void;

  viewerZoom: number;
  setViewerZoom: (zoom: number) => void;

  viewerPan: { x: number; y: number };
  setViewerPan: (pan: { x: number; y: number }) => void;

  folderFilter: string | null;
  setFolderFilter: (folder: string | null) => void;

  mcpViewerSession: { paths: string[]; query: string | null } | null;
  setMcpViewerSession: (session: { paths: string[]; query: string | null } | null) => void;

  imageVersions: Record<string, number>;
  bumpImageVersion: (path: string) => void;
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
  scanningFolder: null,
  setScanningFolder: (scanningFolder) => set({ scanningFolder }),
  progress: { total: 0, processed: 0, pending: 0 },
  setProgress: (progress) => set({ progress }),

  viewMode: 'photos',
  lightboxImage: null,
  lightboxPaths: [],
  setLightboxImage: (lightboxImage, paths) => set((state) => ({
    lightboxImage,
    lightboxPaths: lightboxImage ? (paths ?? state.lightboxPaths) : [],
  })),
  lastLightboxTrigger: null,
  setLastLightboxTrigger: (lastLightboxTrigger) => set({ lastLightboxTrigger }),
  setViewMode: (viewMode) => set({ viewMode, searchQuery: '' }),

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

  mcpViewerSession: null,
  setMcpViewerSession: (mcpViewerSession) => set({ mcpViewerSession }),

  imageVersions: {},
  bumpImageVersion: (path) => set((state) => ({
    imageVersions: {
      ...state.imageVersions,
      [path]: (state.imageVersions[path] ?? 0) + 1,
    },
  })),
}));
