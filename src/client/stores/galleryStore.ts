import { CHUNK_SIZE } from '@/shared/constants';
import type {
  AlbumSummary,
  FiltersResponse,
  ImageItem,
  ImagesRangeResponse,
  TagSummary,
  YearGroupSummary,
} from '@/shared/types';
import { type FetchImagesParams, fetchFilters, fetchImages } from '@/client/api/admin';

export interface GalleryFilter {
  albumId: string | null;
  tag: string | null;
  year?: number | null;
}

export interface GallerySnapshot {
  filter: {
    albumId: string | null;
    tag: string | null;
    year: number | null;
  };
  albums: AlbumSummary[];
  tags: TagSummary[];
  availableYears: YearGroupSummary[];
  years: YearGroupSummary[];
  totalAllImages: number;
  total: number;
  initialLoaded: boolean;
  loadingFilters: boolean;
  loadingChunks: boolean;
  error: string | null;
  generation: number;
}

export interface GalleryStoreDeps {
  fetchFilters?: (signal?: AbortSignal) => Promise<FiltersResponse>;
  fetchImages?: (params: FetchImagesParams, signal?: AbortSignal) => Promise<ImagesRangeResponse>;
  chunkSize?: number;
}

export interface GalleryStore {
  getSnapshot: () => GallerySnapshot;
  getItem: (index: number) => ImageItem | undefined;
  isChunkLoaded: (chunkIndex: number) => boolean;
  isChunkInFlight: (chunkIndex: number) => boolean;
  subscribe: (listener: () => void) => () => void;
  loadFilters: () => Promise<void>;
  ensureChunks: (chunkIndices: number[]) => Promise<void>;
  ensureIndex: (index: number) => Promise<void>;
  setFilter: (next: Partial<GalleryFilter>) => Promise<void>;
  retry: () => Promise<void>;
  dispose: () => void;
}

export function createGalleryStore(deps: GalleryStoreDeps = {}): GalleryStore {
  const doFetchFilters = deps.fetchFilters ?? fetchFilters;
  const doFetchImages = deps.fetchImages ?? fetchImages;
  const chunkSize = deps.chunkSize ?? CHUNK_SIZE;

  let filter: { albumId: string | null; tag: string | null; year: number | null } = {
    albumId: null,
    tag: null,
    year: null,
  };
  let albums: AlbumSummary[] = [];
  let tags: TagSummary[] = [];
  let availableYears: YearGroupSummary[] = [];
  let years: YearGroupSummary[] = [];
  let totalAllImages = 0;
  let total = 0;
  let initialLoaded = false;
  let loadingFilters = false;
  let error: string | null = null;
  let generation = 0;
  let disposed = false;

  const chunks = new Map<number, ImageItem[]>();
  const inFlight = new Set<number>();
  const listeners = new Set<() => void>();
  let activeController: AbortController | null = null;

  const notify = () => {
    if (disposed) return;
    for (const listener of listeners) {
      listener();
    }
  };

  const getSnapshot = (): GallerySnapshot => ({
    filter: { ...filter },
    albums,
    tags,
    availableYears,
    years,
    totalAllImages,
    total,
    initialLoaded,
    loadingFilters,
    loadingChunks: inFlight.size > 0,
    error,
    generation,
  });

  const getItem = (index: number): ImageItem | undefined => {
    if (index < 0) return undefined;
    const chunkIndex = Math.floor(index / chunkSize);
    const localIndex = index % chunkSize;
    return chunks.get(chunkIndex)?.[localIndex];
  };

  const isChunkLoaded = (chunkIndex: number) => chunks.has(chunkIndex);
  const isChunkInFlight = (chunkIndex: number) => inFlight.has(chunkIndex);

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const loadFilters = async () => {
    loadingFilters = true;
    notify();
    try {
      const res = await doFetchFilters();
      if (disposed) return;
      albums = res.albums;
      tags = res.tags;
      if (Array.isArray(res.years)) {
        availableYears = res.years;
      }
      totalAllImages = res.totalImages;
    } catch (err: unknown) {
      if (disposed) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      error = err instanceof Error ? err.message : '필터 정보를 불러오지 못했습니다.';
    } finally {
      if (!disposed) {
        loadingFilters = false;
        notify();
      }
    }
  };

  const fetchSingleChunk = async (chunkIndex: number, reqGen: number, signal?: AbortSignal) => {
    if (chunkIndex < 0 || chunks.has(chunkIndex) || inFlight.has(chunkIndex)) {
      return;
    }

    inFlight.add(chunkIndex);
    notify();

    try {
      const tzOffset = -new Date().getTimezoneOffset();
      const res = await doFetchImages(
        {
          offset: chunkIndex * chunkSize,
          limit: chunkSize,
          albumId: filter.albumId ?? undefined,
          tag: filter.tag ?? undefined,
          year: filter.year ?? undefined,
          ...(chunkIndex === 0 || filter.year !== null ? { tzOffset } : {}),
        },
        signal
      );

      // Ignore stale responses after filter switch or unmount
      if (disposed || reqGen !== generation) {
        return;
      }

      chunks.set(chunkIndex, res.items);
      total = res.total;
      if (Array.isArray(res.years)) {
        years = res.years;
      }
      initialLoaded = true;
      error = null;
    } catch (err: unknown) {
      if (disposed || reqGen !== generation) {
        return;
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      error = err instanceof Error ? err.message : '이미지를 불러오지 못했습니다.';
    } finally {
      if (reqGen === generation) {
        inFlight.delete(chunkIndex);
        notify();
      }
    }
  };

  const ensureChunks = async (chunkIndices: number[]) => {
    const reqGen = generation;
    const controller = activeController ?? new AbortController();
    activeController = controller;

    const toFetch = Array.from(new Set(chunkIndices)).filter(
      (idx) => idx >= 0 && !chunks.has(idx) && !inFlight.has(idx)
    );
    if (toFetch.length === 0) return;

    await Promise.all(toFetch.map((idx) => fetchSingleChunk(idx, reqGen, controller.signal)));
  };

  const ensureIndex = async (index: number) => {
    if (index < 0) return;
    const chunkIndex = Math.floor(index / chunkSize);
    const targets = [chunkIndex];
    if (total > 0) {
      const maxChunk = Math.floor((total - 1) / chunkSize);
      if (chunkIndex + 1 <= maxChunk && index % chunkSize >= chunkSize - 3) {
        targets.push(chunkIndex + 1);
      }
    }
    await ensureChunks(targets);
  };

  const setFilter = async (next: Partial<GalleryFilter>) => {
    const nextAlbumId = 'albumId' in next ? (next.albumId ?? null) : filter.albumId;
    const nextTag = 'tag' in next ? (next.tag ?? null) : filter.tag;
    const nextYear = 'year' in next ? (next.year ?? null) : filter.year;

    if (
      nextAlbumId === filter.albumId &&
      nextTag === filter.tag &&
      nextYear === filter.year &&
      initialLoaded
    ) {
      return;
    }

    activeController?.abort();
    activeController = new AbortController();

    generation += 1;
    filter = { albumId: nextAlbumId, tag: nextTag, year: nextYear };
    chunks.clear();
    inFlight.clear();
    years = [];
    total = 0;
    initialLoaded = false;
    error = null;
    notify();

    await ensureChunks([0]);
  };

  const retry = async () => {
    error = null;
    notify();
    await ensureChunks([0]);
  };

  const dispose = () => {
    disposed = true;
    activeController?.abort();
    listeners.clear();
  };

  return {
    getSnapshot,
    getItem,
    isChunkLoaded,
    isChunkInFlight,
    subscribe,
    loadFilters,
    ensureChunks,
    ensureIndex,
    setFilter,
    retry,
    dispose,
  };
}
