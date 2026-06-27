import axios from 'axios';

let BASE_URL = 'http://127.0.0.1:8000';
export const api = axios.create({
  baseURL: `${BASE_URL}/api`,
});

export const initApi = async () => {
  // @ts-ignore
  if (window.electronAPI && window.electronAPI.getBackendPort) {
    // @ts-ignore
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

export const getSearch = async (query: string) => {
  const { data } = await api.get('/search', { params: { q: query } });
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

export const getImageUrl = (path: string) => `${BASE_URL}/media/image?path=${encodeURIComponent(path)}`;
export const getPreviewUrl = (path: string) => `${BASE_URL}/media/preview?path=${encodeURIComponent(path)}`;
export const getFaceThumbnailUrl = (faceId: number) => `${BASE_URL}/media/thumbnail/${faceId}`;
