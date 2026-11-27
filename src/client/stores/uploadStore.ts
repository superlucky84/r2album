import { UPLOAD_CONCURRENCY } from '@/shared/constants';
import type { ImageItem } from '@/shared/types';
import { type UploadImagePayload, uploadAdminImage } from '@/client/api/admin';
import { type ExifResult, extractExifFromFile } from '@/client/lib/exif';
import { parseTagsInput } from '@/client/lib/format';
import {
  type ResizeOptions,
  type ResizedImageVariants,
  resizeImageToWebpVariants,
} from '@/client/lib/imageResize';

export type UploadTaskStatus = 'queued' | 'processing' | 'uploading' | 'done' | 'error';

export interface UploadTaskItem {
  id: string;
  file: File;
  filename: string;
  originalBytes: number;
  albumId: string | null;
  tags: string[];
  status: UploadTaskStatus;
  convertedBytes: number | null;
  displayBytes: number | null;
  thumbBytes: number | null;
  width: number | null;
  height: number | null;
  takenAt: number | null;
  hasExifDate: boolean;
  errorMessage: string | null;
}

export interface UploadStoreDeps {
  extractExif?: (file: Blob) => Promise<ExifResult>;
  resizeImage?: (file: Blob, options?: ResizeOptions) => Promise<ResizedImageVariants>;
  uploadImage?: (payload: UploadImagePayload) => Promise<ImageItem>;
}

export interface UploadStoreSnapshot {
  tasks: UploadTaskItem[];
  selectedAlbumId: string;
  defaultTagsInput: string;
  doneCount: number;
  errorCount: number;
  inProgressCount: number;
  totalCount: number;
  progressPercent: number;
  wakeLockActive: boolean;
}

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

export interface UploadStore {
  getSnapshot: () => UploadStoreSnapshot;
  subscribe: (listener: () => void) => () => void;
  onUploadComplete: (listener: (item: ImageItem) => void) => () => void;
  onBatchFinished: (listener: () => void) => () => void;
  setSelectedAlbumId: (albumId: string) => void;
  setDefaultTagsInput: (tagsInput: string) => void;
  enqueueFiles: (files: FileList | File[]) => void;
  retryTask: (taskId: string) => void;
  retryAllFailed: () => void;
  clearCompleted: () => void;
  reset: () => void;
}

export function createUploadStore(deps: UploadStoreDeps = {}): UploadStore {
  const doExtractExif = deps.extractExif ?? extractExifFromFile;
  const doResize = deps.resizeImage ?? resizeImageToWebpVariants;
  const doUpload = deps.uploadImage ?? uploadAdminImage;

  let nextTaskSeq = 1;
  let activeCount = 0;
  let batchHadUploads = false;
  let tasks: UploadTaskItem[] = [];
  let selectedAlbumId = '';
  let defaultTagsInput = '';

  let wakeLock: WakeLockSentinelLike | null = null;
  let wakeLockRequested = false;
  let guardsAttached = false;

  const listeners = new Set<() => void>();
  const completeListeners = new Set<(item: ImageItem) => void>();
  const batchFinishedListeners = new Set<() => void>();

  const countInProgress = () =>
    tasks.filter(
      (t) => t.status === 'queued' || t.status === 'processing' || t.status === 'uploading'
    ).length;

  const getSnapshot = (): UploadStoreSnapshot => {
    const doneCount = tasks.filter((t) => t.status === 'done').length;
    const errorCount = tasks.filter((t) => t.status === 'error').length;
    const inProgressCount = countInProgress();
    const totalCount = tasks.length;
    const progressPercent =
      totalCount > 0 ? Math.round(((doneCount + errorCount) / totalCount) * 100) : 0;

    return {
      tasks,
      selectedAlbumId,
      defaultTagsInput,
      doneCount,
      errorCount,
      inProgressCount,
      totalCount,
      progressPercent,
      wakeLockActive: wakeLock !== null,
    };
  };

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const requestWakeLock = async () => {
    if (wakeLock || wakeLockRequested || countInProgress() === 0) return;
    const wakeLockApi =
      typeof navigator !== 'undefined'
        ? (navigator.wakeLock as
            { request?: (type: 'screen') => Promise<WakeLockSentinelLike> } | undefined)
        : undefined;
    if (!wakeLockApi?.request) return;

    wakeLockRequested = true;
    try {
      const sentinel = await wakeLockApi.request('screen');
      if (countInProgress() === 0) {
        await sentinel.release().catch(() => undefined);
      } else {
        wakeLock = sentinel;
        notify();
      }
    } catch {
      // Safely ignore unsupported or denied Wake Lock
    } finally {
      wakeLockRequested = false;
    }
  };

  const releaseWakeLock = () => {
    const current = wakeLock;
    wakeLock = null;
    if (current) {
      void current.release().catch(() => undefined);
    }
  };

  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (countInProgress() > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  };

  const handleVisibilityChange = () => {
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      countInProgress() > 0 &&
      !wakeLock
    ) {
      void requestWakeLock();
    }
  };

  const syncBackgroundGuards = () => {
    const hasInProgress = countInProgress() > 0;
    if (hasInProgress && !guardsAttached) {
      guardsAttached = true;
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', handleBeforeUnload);
      }
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', handleVisibilityChange);
      }
      void requestWakeLock();
    } else if (!hasInProgress && guardsAttached) {
      guardsAttached = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      releaseWakeLock();
    }
  };

  const updateTask = (taskId: string, updater: (item: UploadTaskItem) => UploadTaskItem) => {
    tasks = tasks.map((item) => (item.id === taskId ? updater(item) : item));
    syncBackgroundGuards();
    notify();
  };

  const runTask = async (taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;

    try {
      updateTask(taskId, (item) => ({
        ...item,
        status: 'processing',
        errorMessage: null,
      }));

      // 1. Extract EXIF before Canvas WebP encoding (Canvas strips EXIF)
      const exif = await doExtractExif(task.file);
      const resized = await doResize(task.file, { orientation: exif.orientation });

      updateTask(taskId, (item) => ({
        ...item,
        status: 'uploading',
        displayBytes: resized.displayBytes,
        thumbBytes: resized.thumbBytes,
        convertedBytes: resized.displayBytes + resized.thumbBytes,
        width: resized.width,
        height: resized.height,
        takenAt: exif.takenAt,
        hasExifDate: exif.hasExifDate,
      }));

      // 2. Upload display + thumb WebP + metadata via Worker R2 binding
      const created = await doUpload({
        displayBlob: resized.displayBlob,
        thumbBlob: resized.thumbBlob,
        metadata: {
          originalFilename: task.filename,
          takenAt: exif.takenAt,
          hasExifDate: exif.hasExifDate,
          width: resized.width,
          height: resized.height,
          albumId: task.albumId,
          tags: task.tags,
          caption: '',
        },
      });

      batchHadUploads = true;
      updateTask(taskId, (item) => ({
        ...item,
        status: 'done',
        takenAt: created.takenAt,
        hasExifDate: created.hasExifDate,
      }));
      for (const cb of completeListeners) {
        cb(created);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : '이미지 변환 또는 업로드 중 오류가 발생했습니다.';
      updateTask(taskId, (item) => ({
        ...item,
        status: 'error',
        errorMessage: message,
      }));
    }
  };

  const pumpQueue = () => {
    while (activeCount < UPLOAD_CONCURRENCY) {
      const next = tasks.find((item) => item.status === 'queued');
      if (!next) break;

      activeCount += 1;
      updateTask(next.id, (item) => ({ ...item, status: 'processing', errorMessage: null }));

      void runTask(next.id).finally(() => {
        activeCount -= 1;
        pumpQueue();
        if (activeCount === 0 && !tasks.some((item) => item.status === 'queued')) {
          syncBackgroundGuards();
          if (batchHadUploads) {
            batchHadUploads = false;
            for (const cb of batchFinishedListeners) {
              cb();
            }
          }
          notify();
        }
      });
    }
  };

  const enqueueFiles = (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const albumId = selectedAlbumId || null;
    const tags = parseTagsInput(defaultTagsInput);

    const newTasks: UploadTaskItem[] = files.map((file) => ({
      id: `upload-${nextTaskSeq++}`,
      file,
      filename: file.name || 'photo',
      originalBytes: file.size,
      albumId,
      tags,
      status: 'queued',
      convertedBytes: null,
      displayBytes: null,
      thumbBytes: null,
      width: null,
      height: null,
      takenAt: null,
      hasExifDate: false,
      errorMessage: null,
    }));

    tasks = [...newTasks, ...tasks];
    syncBackgroundGuards();
    notify();
    pumpQueue();
  };

  const retryTask = (taskId: string) => {
    updateTask(taskId, (item) => ({
      ...item,
      status: 'queued',
      errorMessage: null,
    }));
    pumpQueue();
  };

  const retryAllFailed = () => {
    tasks = tasks.map((item) =>
      item.status === 'error' ? { ...item, status: 'queued', errorMessage: null } : item
    );
    syncBackgroundGuards();
    notify();
    pumpQueue();
  };

  const clearCompleted = () => {
    tasks = tasks.filter((item) => item.status !== 'done');
    notify();
  };

  const setSelectedAlbumId = (albumId: string) => {
    selectedAlbumId = albumId;
    notify();
  };

  const setDefaultTagsInput = (tagsInput: string) => {
    defaultTagsInput = tagsInput;
    notify();
  };

  const reset = () => {
    tasks = [];
    selectedAlbumId = '';
    defaultTagsInput = '';
    batchHadUploads = false;
    syncBackgroundGuards();
    notify();
  };

  return {
    getSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onUploadComplete: (listener) => {
      completeListeners.add(listener);
      return () => completeListeners.delete(listener);
    },
    onBatchFinished: (listener) => {
      batchFinishedListeners.add(listener);
      return () => batchFinishedListeners.delete(listener);
    },
    setSelectedAlbumId,
    setDefaultTagsInput,
    enqueueFiles,
    retryTask,
    retryAllFailed,
    clearCompleted,
    reset,
  };
}

export const globalUploadStore = createUploadStore();
