import axios from 'axios';

const api = axios.create({
  baseURL: 'http://127.0.0.1:8000/api',
});

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

export const getImageUrl = (path: string) => `http://127.0.0.1:8000/media/image?path=${encodeURIComponent(path)}`;
export const getFaceThumbnailUrl = (faceId: number) => `http://127.0.0.1:8000/media/thumbnail/${faceId}`;
