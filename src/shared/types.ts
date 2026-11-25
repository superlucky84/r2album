export type UserRole = 'admin' | 'viewer';

export interface AuthUser {
  email: string;
  name: string;
  role: UserRole;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface HealthResponse {
  ok: true;
  service: string;
  timestamp: number;
}

export interface AlbumSummary {
  id: string;
  name: string;
  description: string;
  imageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface TagSummary {
  id: number;
  name: string;
  imageCount: number;
}

export interface ImageItem {
  id: string;
  albumId: string | null;
  albumName: string | null;
  caption: string;
  tags: string[];
  takenAt: number;
  hasExifDate: boolean;
  uploadedAt: number;
  width: number;
  height: number;
  thumbUrl: string;
  displayUrl: string;
}

export interface FrameItem {
  id: string;
  caption: string;
  takenAt: number;
  width: number;
  height: number;
  displayUrl: string;
}
