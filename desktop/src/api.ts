import axios from 'axios';

let BASE_URL = 'http://127.0.0.1:8000';
export const api = axios.create({
  baseURL: `${BASE_URL}/api`,
});

export const initApi = async () => {
  if (window.electronAPI) {
    if (window.electronAPI.getBackendConfig) {
      const { port, token } = await window.electronAPI.getBackendConfig();
      BASE_URL = `http://127.0.0.1:${port}`;
      api.defaults.baseURL = `${BASE_URL}/api`;
      if (token) {
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      }
    } else {
      const port = await window.electronAPI.getBackendPort();
      BASE_URL = `http://127.0.0.1:${port}`;
      api.defaults.baseURL = `${BASE_URL}/api`;
    }
  }
};

export const scanFolder = async (folderPath: string) => {
  const { data } = await api.post('/scan', { folder_path: folderPath });
  return data;
};

export const getProgress = async () => {
  const { data } = await api.get('/progress');
  return data;
};

export const getImages = async (offset = 0, limit = 50) => {
  const { data } = await api.get('/images', { params: { offset, limit } });
  return data.images;
};

export const getSearch = async (query: string, signal: AbortSignal) => {
  const { data } = await api.get<{ path: string; score: number }[]>('/search', { params: { q: query }, signal });
  return data;
};

export const getStats = async () => {
  const { data } = await api.get('/stats');
  return data;
};

export const getImagesForFace = async (faceId: number) => {
  const { data } = await api.get(`/faces/${faceId}/images`);
  return data.images || [];
};

export type FilterPreset = 'original' | 'vivid' | 'warm' | 'cool' | 'mono' | 'noir';

export interface SaveEditPayload {
  source_path: string;
  mode: 'copy' | 'replace';
  crop?: { x: number; y: number; w: number; h: number } | null;
  rotate_deg: number;
  flip_h: boolean;
  flip_v: boolean;
  straighten_deg: number;
  filter_preset: FilterPreset;
  adjustments: {
    light: number;
    contrast: number;
    saturation: number;
    warmth: number;
  };
}

export const saveEditedImage = async (payload: SaveEditPayload) => {
  const { data } = await api.post<{ status: string; saved_path: string; mode: 'copy' | 'replace' }>(
    '/images/save-copy',
    payload,
  );
  return data;
};

export interface ImageMetadata {
  filename: string;
  path: string;
  format: string;
  width: number;
  height: number;
  megapixels: number;
  file_size_bytes: number;
  modified_at: string;
  date_taken: string | null;
  camera: string | null;
  lens: string | null;
  focal_length: string | null;
  aperture: string | null;
  shutter_speed: string | null;
  iso: number | null;
  latitude: number | null;
  longitude: number | null;
  location_label: string | null;
}

export const getImageMetadata = async (path: string) => {
  const { data } = await api.get<ImageMetadata>('/images/metadata', { params: { path } });
  return data;
};

export const getImageUrl = (path: string) => `${BASE_URL}/media/image?path=${encodeURIComponent(path)}`;
export const getPreviewUrl = (path: string) => `${BASE_URL}/media/preview?path=${encodeURIComponent(path)}`;
export const getFaceThumbnailUrl = (faceId: number) => `${BASE_URL}/media/thumbnail/${faceId}`;
