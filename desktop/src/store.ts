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
  
  selectedImage: string | null;
  setSelectedImage: (image: string | null) => void;
  
  showRightSidebar: boolean;
  setShowRightSidebar: (show: boolean) => void;


  stats: { photos: number; faces: number; people: number };
  setStats: (stats: { photos: number; faces: number; people: number }) => void;
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
  
  selectedImage: null,
  setSelectedImage: (selectedImage) => set({ selectedImage }),
  
  showRightSidebar: false,
  setShowRightSidebar: (showRightSidebar) => set({ showRightSidebar }),


  stats: { photos: 0, faces: 0, people: 0 },
  setStats: (stats) => set({ stats }),
}));
