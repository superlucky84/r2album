import { describe, expect, it } from 'vitest';
import { createShuffleQueue, fisherYatesShuffle } from '../lib/shuffle';

function makeSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('shuffle queue (Fisher-Yates)', () => {
  it('handles 0 items and 1 item safely', () => {
    const empty = createShuffleQueue<string>([]);
    expect(empty.current()).toBeNull();
    expect(empty.next()).toBeNull();
    expect(empty.prev()).toBeNull();

    const single = createShuffleQueue<string>(['only']);
    expect(single.current()).toBe('only');
    expect(single.next()).toBe('only');
    expect(single.prev()).toBe('only');
  });

  it('prevents back-to-back boundary repetition with 2 items across multiple cycles', () => {
    // Even with a deterministic rng that always returns 0, boundary guard must avoid consecutive repeat
    const queue = createShuffleQueue(['A', 'B'], () => 0);
    const seq: string[] = [queue.current()!];
    for (let i = 0; i < 20; i += 1) {
      seq.push(queue.next()!);
    }
    for (let i = 1; i < seq.length; i += 1) {
      expect(seq[i]).not.toBe(seq[i - 1]);
    }
  });

  it('visits all 100 items without duplicates or omissions per cycle and avoids boundary repeats', () => {
    const items = Array.from({ length: 100 }, (_, i) => `item-${i}`);
    const shuffled = fisherYatesShuffle(items, makeSeededRng(42));
    expect(shuffled).toHaveLength(100);
    expect(new Set(shuffled).size).toBe(100);

    const queue = createShuffleQueue(items, makeSeededRng(12345));

    // Check 3 consecutive full cycles (300 items)
    let prevLast: string | null = null;
    for (let cycleIdx = 0; cycleIdx < 3; cycleIdx += 1) {
      const seen = new Set<string>();
      const cycleItems: string[] = [];
      for (let i = 0; i < 100; i += 1) {
        const val = cycleIdx === 0 && i === 0 ? queue.current()! : queue.next()!;
        seen.add(val);
        cycleItems.push(val);
      }
      expect(seen.size).toBe(100);
      if (prevLast !== null) {
        expect(cycleItems[0]).not.toBe(prevLast);
      }
      prevLast = cycleItems[cycleItems.length - 1];
    }
  });

  it('supports stepping backwards and forwards through playback history', () => {
    const queue = createShuffleQueue(['1', '2', '3', '4'], makeSeededRng(7));
    const first = queue.current()!;
    const second = queue.next()!;
    const third = queue.next()!;

    expect(queue.prev()).toBe(second);
    expect(queue.prev()).toBe(first);
    expect(queue.next()).toBe(second);
    expect(queue.next()).toBe(third);
  });
});
