import { CHUNK_SIZE } from '@/shared/constants';
import type { YearGroupSummary } from '@/shared/types';

export interface VirtualGridConfig {
  total: number;
  containerWidth: number;
  viewportHeight: number;
  scrollTop: number;
  years?: YearGroupSummary[];
  gap?: number;
  overscanRows?: number;
  chunkOverscan?: number;
  chunkSize?: number;
  yearHeaderHeight?: number;
  yearSectionGap?: number;
}

export interface VirtualGridCell {
  index: number;
  left: number;
  top: number;
}

export interface VirtualYearHeader {
  year: number;
  count: number;
  top: number;
  height: number;
}

export interface VirtualYearSection {
  year: number;
  count: number;
  startIndex: number;
  endIndex: number;
  headerTop: number;
  gridTop: number;
  bottom: number;
  rows: number;
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
  visibleCells: VirtualGridCell[];
  visibleHeaders: VirtualYearHeader[];
  yearSections: VirtualYearSection[];
  chunkIndices: number[];
}

export const DEFAULT_GRID_GAP = 12;
export const DEFAULT_OVERSCAN_ROWS = 2;
export const DEFAULT_CHUNK_OVERSCAN = 1;
export const DEFAULT_YEAR_HEADER_HEIGHT = 48;
export const DEFAULT_YEAR_SECTION_GAP = 28;

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

function buildChunkIndices(
  total: number,
  startIndex: number,
  endIndex: number,
  chunkSize: number,
  chunkOverscan: number
): number[] {
  if (total <= 0 || endIndex < startIndex) return [];
  const maxChunkIndex = Math.floor((total - 1) / chunkSize);
  const firstChunk = Math.max(0, Math.floor(startIndex / chunkSize) - chunkOverscan);
  const lastChunk = Math.min(maxChunkIndex, Math.floor(endIndex / chunkSize) + chunkOverscan);

  const chunkIndices: number[] = [];
  for (let c = firstChunk; c <= lastChunk; c += 1) {
    chunkIndices.push(c);
  }
  return chunkIndices;
}

/**
 * Pure virtual grid layout & chunk-range calculator (DC-7).
 * Supports both flat layout and year-grouped sectioned layout while preserving exact CHUNK_SIZE lazy fetch.
 */
export function computeVirtualGridLayout(config: VirtualGridConfig): VirtualGridLayout {
  const total = Math.max(0, Math.floor(config.total));
  const containerWidth = Math.max(240, config.containerWidth || 1024);
  const viewportHeight = Math.max(200, config.viewportHeight || 800);
  const gap = config.gap ?? DEFAULT_GRID_GAP;
  const overscanRows = Math.max(0, config.overscanRows ?? DEFAULT_OVERSCAN_ROWS);
  const chunkOverscan = Math.max(0, config.chunkOverscan ?? DEFAULT_CHUNK_OVERSCAN);
  const chunkSize = Math.max(1, config.chunkSize ?? CHUNK_SIZE);
  const yearHeaderHeight = config.yearHeaderHeight ?? DEFAULT_YEAR_HEADER_HEIGHT;
  const yearSectionGap = config.yearSectionGap ?? DEFAULT_YEAR_SECTION_GAP;

  const columns = getResponsiveColumns(containerWidth);
  const itemWidth = Math.max(100, Math.floor((containerWidth - gap * (columns - 1)) / columns));
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
      visibleCells: [],
      visibleHeaders: [],
      yearSections: [],
      chunkIndices: [],
    };
  }

  // Year-grouped sectioned virtual layout when exact year counts match total
  const validYears = (config.years ?? []).filter((y) => y.count > 0);
  const yearsTotal = validYears.reduce((sum, y) => sum + y.count, 0);

  if (validYears.length > 0 && yearsTotal === total) {
    const yearSections: VirtualYearSection[] = [];
    let cursorY = 0;
    let cursorIndex = 0;
    let totalRows = 0;

    for (const group of validYears) {
      const rows = Math.ceil(group.count / columns);
      const gridTop = cursorY + yearHeaderHeight;
      const gridHeight = Math.max(itemHeight, rows * rowHeight - gap);
      const bottom = gridTop + gridHeight;

      yearSections.push({
        year: group.year,
        count: group.count,
        startIndex: cursorIndex,
        endIndex: cursorIndex + group.count - 1,
        headerTop: cursorY,
        gridTop,
        bottom,
        rows,
      });

      totalRows += rows;
      cursorIndex += group.count;
      cursorY = bottom + yearSectionGap;
    }

    const totalHeight = yearSections.length > 0 ? yearSections[yearSections.length - 1].bottom : 0;
    const clampedScrollTop = Math.max(0, Math.min(config.scrollTop || 0, totalHeight));
    const overscanPx = overscanRows * rowHeight;
    const viewTop = Math.max(0, clampedScrollTop - overscanPx);
    const viewBottom = clampedScrollTop + viewportHeight + overscanPx;

    const visibleHeaders: VirtualYearHeader[] = [];
    const visibleCells: VirtualGridCell[] = [];
    const visibleIndices: number[] = [];

    for (const section of yearSections) {
      if (section.bottom < viewTop || section.headerTop > viewBottom) {
        continue;
      }

      visibleHeaders.push({
        year: section.year,
        count: section.count,
        top: section.headerTop,
        height: yearHeaderHeight,
      });

      if (section.bottom >= viewTop && section.gridTop <= viewBottom) {
        const localStartRow = Math.max(0, Math.floor((viewTop - section.gridTop) / rowHeight));
        const localEndRow = Math.min(
          section.rows - 1,
          Math.floor((viewBottom - section.gridTop) / rowHeight)
        );

        for (let r = localStartRow; r <= localEndRow; r += 1) {
          const top = section.gridTop + r * rowHeight;
          for (let c = 0; c < columns; c += 1) {
            const localIdx = r * columns + c;
            if (localIdx >= section.count) break;
            const globalIndex = section.startIndex + localIdx;
            visibleIndices.push(globalIndex);
            visibleCells.push({
              index: globalIndex,
              left: c * (itemWidth + gap),
              top,
            });
          }
        }
      }
    }

    const startIndex = visibleIndices.length > 0 ? visibleIndices[0] : 0;
    const endIndex = visibleIndices.length > 0 ? visibleIndices[visibleIndices.length - 1] : -1;
    const chunkIndices = buildChunkIndices(total, startIndex, endIndex, chunkSize, chunkOverscan);

    return {
      columns,
      gap,
      itemWidth,
      itemHeight,
      rowHeight,
      totalRows,
      totalHeight,
      startRow: Math.floor(startIndex / columns),
      endRow: endIndex >= 0 ? Math.floor(endIndex / columns) : -1,
      startIndex,
      endIndex,
      visibleIndices,
      visibleCells,
      visibleHeaders,
      yearSections,
      chunkIndices,
    };
  }

  // Flat virtual grid fallback
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
  const visibleCells: VirtualGridCell[] = [];
  for (let i = startIndex; i <= endIndex; i += 1) {
    const row = Math.floor(i / columns);
    const col = i % columns;
    visibleIndices.push(i);
    visibleCells.push({
      index: i,
      left: col * (itemWidth + gap),
      top: row * rowHeight,
    });
  }

  const chunkIndices = buildChunkIndices(total, startIndex, endIndex, chunkSize, chunkOverscan);

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
    visibleCells,
    visibleHeaders: [],
    yearSections: [],
    chunkIndices,
  };
}
