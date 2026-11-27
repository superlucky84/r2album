import { describe, expect, it } from 'vitest';
import { computeVirtualGridLayout, getResponsiveColumns } from '../lib/virtualGrid';

describe('virtualGrid pure calculation', () => {
  it('selects responsive columns between 2 and 6 based on container width', () => {
    expect(getResponsiveColumns(375)).toBe(2);
    expect(getResponsiveColumns(640)).toBe(3);
    expect(getResponsiveColumns(900)).toBe(4);
    expect(getResponsiveColumns(1100)).toBe(5);
    expect(getResponsiveColumns(1440)).toBe(6);
  });

  it('handles 0 items safely with empty ranges and zero height', () => {
    const layout = computeVirtualGridLayout({
      total: 0,
      containerWidth: 1024,
      viewportHeight: 800,
      scrollTop: 0,
    });

    expect(layout.totalRows).toBe(0);
    expect(layout.totalHeight).toBe(0);
    expect(layout.visibleIndices).toEqual([]);
    expect(layout.chunkIndices).toEqual([]);
  });

  it('handles 1 item and 50 items accurately', () => {
    const one = computeVirtualGridLayout({
      total: 1,
      containerWidth: 1024,
      viewportHeight: 800,
      scrollTop: 0,
    });
    expect(one.totalRows).toBe(1);
    expect(one.visibleIndices).toEqual([0]);
    expect(one.chunkIndices).toEqual([0]);

    const fifty = computeVirtualGridLayout({
      total: 50,
      containerWidth: 1024, // 5 cols
      viewportHeight: 800,
      scrollTop: 0,
    });
    expect(fifty.columns).toBe(5);
    expect(fifty.totalRows).toBe(10);
    expect(fifty.startIndex).toBe(0);
    expect(fifty.chunkIndices).toEqual([0, 1]);
  });

  it('computes bounded visible range and ±1 chunk overscan for 30,000 items scrolled mid-way', () => {
    const base = computeVirtualGridLayout({
      total: 30_000,
      containerWidth: 1280, // 6 cols
      viewportHeight: 900,
      scrollTop: 0,
    });
    expect(base.columns).toBe(6);
    expect(base.totalRows).toBe(5_000);
    expect(base.totalHeight).toBe(5_000 * base.rowHeight - base.gap);
    expect(base.visibleIndices.length).toBeLessThan(80);

    // Jump halfway down (around row 2500 -> index 15,000 -> chunk 375)
    const midScroll = 2500 * base.rowHeight;
    const mid = computeVirtualGridLayout({
      total: 30_000,
      containerWidth: 1280,
      viewportHeight: 900,
      scrollTop: midScroll,
    });

    expect(mid.startRow).toBe(2498); // overscanRows = 2
    expect(mid.visibleIndices.length).toBeLessThan(80);
    expect(mid.chunkIndices).toContain(374); // -1 chunk overscan
    expect(mid.chunkIndices).toContain(375); // visible chunk
    expect(mid.chunkIndices).toContain(376); // +1 chunk overscan
  });

  it('clamps negative or out-of-range scrollTop gracefully', () => {
    const neg = computeVirtualGridLayout({
      total: 100,
      containerWidth: 800,
      viewportHeight: 600,
      scrollTop: -500,
    });
    expect(neg.startRow).toBe(0);
    expect(neg.startIndex).toBe(0);

    const pastBottom = computeVirtualGridLayout({
      total: 100,
      containerWidth: 800,
      viewportHeight: 600,
      scrollTop: 999_999,
    });
    expect(pastBottom.endIndex).toBe(99);
    expect(pastBottom.chunkIndices[pastBottom.chunkIndices.length - 1]).toBe(2);
  });

  it('computes year-grouped sections, headers, non-overlapping row starts, and chunk ranges for 30,000 items', () => {
    const years = [
      { year: 2026, count: 3 }, // partial first row (3 items in 6 cols) -> 2025 starts on new section!
      { year: 2025, count: 15_000 },
      { year: 2024, count: 14_997 },
    ];

    const topLayout = computeVirtualGridLayout({
      total: 30_000,
      years,
      containerWidth: 1280, // 6 cols
      viewportHeight: 900,
      scrollTop: 0,
    });

    expect(topLayout.yearSections).toHaveLength(3);
    expect(topLayout.yearSections[0]).toMatchObject({
      year: 2026,
      startIndex: 0,
      endIndex: 2,
      rows: 1,
    });
    expect(topLayout.yearSections[1]).toMatchObject({
      year: 2025,
      startIndex: 3,
      endIndex: 15_002,
    });
    expect(topLayout.yearSections[2]).toMatchObject({
      year: 2024,
      startIndex: 15_003,
      endIndex: 29_999,
    });

    // Top viewport shows 2026 and 2025 headers, with bounded DOM cells
    expect(topLayout.visibleHeaders.map((h) => h.year)).toEqual([2026, 2025]);
    expect(topLayout.visibleCells.length).toBeLessThan(80);
    // 2025 first cell (index 3) starts at column 0 (left = 0) under 2025 header
    const first2025Cell = topLayout.visibleCells.find((c) => c.index === 3);
    expect(first2025Cell?.left).toBe(0);
    expect(first2025Cell?.top).toBe(topLayout.yearSections[1].gridTop);

    // Jumping directly to 2024 section headerTop computes only chunks near index 15,003 (chunk 375)
    const jump2024 = computeVirtualGridLayout({
      total: 30_000,
      years,
      containerWidth: 1280,
      viewportHeight: 900,
      scrollTop: topLayout.yearSections[2].headerTop,
    });
    expect(jump2024.visibleHeaders.map((h) => h.year)).toContain(2024);
    expect(jump2024.visibleCells.length).toBeLessThan(80);
    expect(jump2024.chunkIndices).toContain(375);
  });
});
