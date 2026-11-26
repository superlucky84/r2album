import { CHUNK_SIZE } from '@/shared/constants';

export interface VirtualGridConfig {
  total: number;
  containerWidth: number;
  viewportHeight: number;
  scrollTop: number;
  gap?: number;
  overscanRows?: number;
  chunkOverscan?: number;
  chunkSize?: number;
}

export interface VirtualGridLayout {
  columns: number;
  gap: number;
  itemWidth: number;
  itemHeight: number;
  rowHeight: number;
  totalRows: number;
  totalHeight: number;
  startRow: number;
  endRow: number;
  startIndex: number;
  endIndex: number;
  visibleIndices: number[];
  chunkIndices: number[];
}

export const DEFAULT_GRID_GAP = 12;
export const DEFAULT_OVERSCAN_ROWS = 2;
export const DEFAULT_CHUNK_OVERSCAN = 1;

/**
 * Determines responsive grid column count (2..6) from container width.
 */
export function getResponsiveColumns(containerWidth: number): number {
  const width = Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 1024;
  if (width < 560) return 2;
  if (width < 768) return 3;
  if (width < 1024) return 4;
  if (width < 1280) return 5;
  return 6;
}

/**
 * Pure virtual grid layout & chunk-range calculator (DC-7).
 */
export function computeVirtualGridLayout(config: VirtualGridConfig): VirtualGridLayout {
  const total = Math.max(0, Math.floor(config.total));
  const containerWidth = Math.max(240, config.containerWidth || 1024);
  const viewportHeight = Math.max(200, config.viewportHeight || 800);
  const gap = config.gap ?? DEFAULT_GRID_GAP;
  const overscanRows = Math.max(0, config.overscanRows ?? DEFAULT_OVERSCAN_ROWS);
  const chunkOverscan = Math.max(0, config.chunkOverscan ?? DEFAULT_CHUNK_OVERSCAN);
  const chunkSize = Math.max(1, config.chunkSize ?? CHUNK_SIZE);

  const columns = getResponsiveColumns(containerWidth);
  const itemWidth = Math.max(100, Math.floor((containerWidth - gap * (columns - 1)) / columns));
  // Fixed 4:3-to-square-friendly card height (square thumbnail + subtle metadata area)
  const itemHeight = itemWidth;
  const rowHeight = itemHeight + gap;

  if (total === 0) {
    return {
      columns,
      gap,
      itemWidth,
      itemHeight,
      rowHeight,
      totalRows: 0,
      totalHeight: 0,
      startRow: 0,
      endRow: -1,
      startIndex: 0,
      endIndex: -1,
      visibleIndices: [],
      chunkIndices: [],
    };
  }

  const totalRows = Math.ceil(total / columns);
  const totalHeight = Math.max(itemHeight, totalRows * rowHeight - gap);

  const clampedScrollTop = Math.max(0, Math.min(config.scrollTop || 0, totalHeight));
  const visibleStartRow = Math.floor(clampedScrollTop / rowHeight);
  const visibleEndRow = Math.floor((clampedScrollTop + viewportHeight) / rowHeight);

  const startRow = Math.max(0, Math.min(totalRows - 1, visibleStartRow - overscanRows));
  const endRow = Math.max(startRow, Math.min(totalRows - 1, visibleEndRow + overscanRows));

  const startIndex = startRow * columns;
  const endIndex = Math.min(total - 1, (endRow + 1) * columns - 1);

  const visibleIndices: number[] = [];
  for (let i = startIndex; i <= endIndex; i += 1) {
    visibleIndices.push(i);
  }

  const maxChunkIndex = Math.floor((total - 1) / chunkSize);
  const firstChunk = Math.max(0, Math.floor(startIndex / chunkSize) - chunkOverscan);
  const lastChunk = Math.min(maxChunkIndex, Math.floor(endIndex / chunkSize) + chunkOverscan);

  const chunkIndices: number[] = [];
  for (let c = firstChunk; c <= lastChunk; c += 1) {
    chunkIndices.push(c);
  }

  return {
    columns,
    gap,
    itemWidth,
    itemHeight,
    rowHeight,
    totalRows,
    totalHeight,
    startRow,
    endRow,
    startIndex,
    endIndex,
    visibleIndices,
    chunkIndices,
  };
}
