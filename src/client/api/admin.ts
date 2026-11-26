import type {
  AdminStatsResponse,
  AdminUsersResponse,
  AlbumSummary,
  AllowedUserRecord,
  FiltersResponse,
  FrameIdsResponse,
  ImageItem,
  ImagesRangeResponse,
  UserApprovalStatus,
  UserRole,
} from '@/shared/types';
import { apiFetch } from './client';

export interface UploadImageMetadata {
  originalFilename: string;
  takenAt: number | null;
  hasExifDate: boolean;
  width: number;
  height: number;
  albumId?: string | null;
  tags?: string[];
  caption?: string;
}

export interface UploadImagePayload {
  displayBlob: Blob;
  thumbBlob: Blob;
  metadata: UploadImageMetadata;
}

export interface UpdateImagePayload {
  caption?: string;
  albumId?: string | null;
  tags?: string[];
  takenAt?: number;
}

export interface FetchImagesParams {
  offset?: number;
  limit?: number;
  albumId?: string;
  tag?: string;
}

export function fetchAdminStats(signal?: AbortSignal): Promise<AdminStatsResponse> {
  return apiFetch<AdminStatsResponse>('/api/admin/stats', { signal });
}

export function fetchFilters(signal?: AbortSignal): Promise<FiltersResponse> {
  return apiFetch<FiltersResponse>('/api/filters', { signal });
}

export function fetchImages(
  params: FetchImagesParams = {},
  signal?: AbortSignal
): Promise<ImagesRangeResponse> {
  const query = new URLSearchParams();
  if (typeof params.offset === 'number') query.set('offset', String(params.offset));
  if (typeof params.limit === 'number') query.set('limit', String(params.limit));
  if (params.albumId) query.set('albumId', params.albumId);
  if (params.tag) query.set('tag', params.tag);

  const qs = query.toString();
  return apiFetch<ImagesRangeResponse>(qs ? `/api/images?${qs}` : '/api/images', { signal });
}

export function fetchFrameIds(
  params: { albumId?: string; tag?: string } = {},
  signal?: AbortSignal
): Promise<FrameIdsResponse> {
  const query = new URLSearchParams();
  if (params.albumId) query.set('albumId', params.albumId);
  if (params.tag) query.set('tag', params.tag);

  const qs = query.toString();
  return apiFetch<FrameIdsResponse>(qs ? `/api/images/ids?${qs}` : '/api/images/ids', { signal });
}

export function uploadAdminImage(payload: UploadImagePayload): Promise<ImageItem> {
  const formData = new FormData();
  formData.append('display', payload.displayBlob, 'display.webp');
  formData.append('thumb', payload.thumbBlob, 'thumb.webp');
  formData.append('metadata', JSON.stringify(payload.metadata));

  return apiFetch<ImageItem>('/api/admin/images', {
    method: 'POST',
    body: formData,
  });
}

export function updateAdminImage(id: string, patch: UpdateImagePayload): Promise<ImageItem> {
  return apiFetch<ImageItem>(`/api/admin/images/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function deleteAdminImage(id: string): Promise<{ ok: true; deletedId: string }> {
  return apiFetch<{ ok: true; deletedId: string }>(`/api/admin/images/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export interface BulkUpdateImagesPayload {
  ids: string[];
  albumId?: string | null;
  addTags?: string[];
  removeTags?: string[];
}

export function bulkDeleteAdminImages(ids: string[]): Promise<{ ok: true; deletedIds: string[] }> {
  return apiFetch<{ ok: true; deletedIds: string[] }>('/api/admin/images/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

export function bulkUpdateAdminImages(
  payload: BulkUpdateImagesPayload
): Promise<{ ok: true; updatedIds: string[]; updatedCount: number }> {
  return apiFetch<{ ok: true; updatedIds: string[]; updatedCount: number }>(
    '/api/admin/images/bulk-update',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
}

export function createAdminAlbum(body: {
  name: string;
  description?: string;
}): Promise<AlbumSummary> {
  return apiFetch<AlbumSummary>('/api/admin/albums', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function updateAdminAlbum(
  id: string,
  body: { name?: string; description?: string }
): Promise<AlbumSummary> {
  return apiFetch<AlbumSummary>(`/api/admin/albums/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function deleteAdminAlbum(id: string): Promise<{ ok: true; deletedId: string }> {
  return apiFetch<{ ok: true; deletedId: string }>(`/api/admin/albums/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function fetchAdminUsers(signal?: AbortSignal): Promise<AdminUsersResponse> {
  return apiFetch<AdminUsersResponse>('/api/admin/users', { signal });
}

export function createAdminUser(body: {
  email: string;
  name?: string;
  role: UserRole;
  note?: string;
}): Promise<AllowedUserRecord> {
  return apiFetch<AllowedUserRecord>('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function updateAdminUser(
  email: string,
  body: { role?: UserRole; status?: UserApprovalStatus; note?: string }
): Promise<AllowedUserRecord> {
  return apiFetch<AllowedUserRecord>(`/api/admin/users/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function deleteAdminUser(email: string): Promise<{ ok: true; deletedEmail: string }> {
  return apiFetch<{ ok: true; deletedEmail: string }>(
    `/api/admin/users/${encodeURIComponent(email)}`,
    {
      method: 'DELETE',
    }
  );
}
