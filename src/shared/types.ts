export type UserRole = 'admin' | 'viewer';
export type UserApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface AuthUser {
  email: string;
  name: string;
  role: UserRole;
}

export interface AllowedUserRecord {
  email: string;
  name: string;
  role: UserRole;
  status: UserApprovalStatus;
  note: string;
  createdAt: number;
  updatedAt: number;
  isBootstrapAdmin?: boolean;
}

export type MeResponse =
  | {
      authenticated: false;
    }
  | {
      authenticated: true;
      user: AuthUser;
    };

export type AuthErrorCode =
  | 'unauthorized'
  | 'rejected'
  | 'signup_closed'
  | 'invalid_state'
  | 'unverified_email'
  | 'oauth_denied'
  | 'oauth_failed';

export type AuthStatusCode = 'pending';

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

export interface FiltersResponse {
  albums: AlbumSummary[];
  tags: TagSummary[];
  totalImages: number;
}

export interface ImagesRangeResponse {
  total: number;
  offset: number;
  limit: number;
  items: ImageItem[];
}

export interface FrameIdsResponse {
  total: number;
  items: FrameItem[];
}

export interface AdminStatsResponse {
  totalImages: number;
  totalDisplayBytes: number;
  totalThumbBytes: number;
  totalBytes: number;
  freeTierBytes: number;
  storageCapBytes?: number;
  usageRatio: number;
  pendingUsers: number;
}

export interface AdminUsersResponse {
  pendingCount: number;
  users: AllowedUserRecord[];
}
