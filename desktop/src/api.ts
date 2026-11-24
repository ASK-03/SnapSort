import axios from 'axios';

let BASE_URL = 'http://127.0.0.1:8000';
export const api = axios.create({
  baseURL: `${BASE_URL}/api`,
});

export const initApi = async () => {
  if (window.electronAPI) {
    const port = await window.electronAPI.getBackendPort();
    BASE_URL = `http://127.0.0.1:${port}`;
    api.defaults.baseURL = `${BASE_URL}/api`;
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

export const getImageUrl = (path: string) => `${BASE_URL}/media/image?path=${encodeURIComponent(path)}`;
export const getPreviewUrl = (path: string) => `${BASE_URL}/media/preview?path=${encodeURIComponent(path)}`;
export const getFaceThumbnailUrl = (faceId: number) => `${BASE_URL}/media/thumbnail/${faceId}`;
