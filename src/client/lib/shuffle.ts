/**
 * Returns a new array shuffled using the Fisher-Yates (Knuth) algorithm.
 * Guarantees uniform permutation with no duplicates or omissions.
 */
export function fisherYatesShuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

export interface ShuffleQueue<T> {
  current: () => T | null;
  next: () => T | null;
  prev: () => T | null;
  size: () => number;
  reset: (nextItems: readonly T[]) => void;
}

const MAX_HISTORY_SIZE = 200;

/**
 * Non-repeating random playback queue:
 * - Visits every item exactly once per cycle before reshuffling.
 * - Prevents the first item of a new cycle from matching the last item of the previous cycle (when length >= 2).
 * - Maintains bounded playback history so manual "previous" works naturally.
 */
export function createShuffleQueue<T>(
  initialItems: readonly T[],
  rng: () => number = Math.random
): ShuffleQueue<T> {
  let source: T[] = initialItems.slice();
  let cycle: T[] = [];
  let cycleCursor = -1;
  let history: T[] = [];
  let historyPos = -1;

  const buildNextCycle = (avoidFirst: T | undefined): T[] => {
    if (source.length === 0) return [];
    if (source.length === 1) return [source[0]];

    const shuffled = fisherYatesShuffle(source, rng);
    if (avoidFirst !== undefined && shuffled[0] === avoidFirst) {
      const swapIndex = 1 + Math.floor(rng() * (shuffled.length - 1));
      const tmp = shuffled[0];
      shuffled[0] = shuffled[swapIndex];
      shuffled[swapIndex] = tmp;
    }
    return shuffled;
  };

  const pushHistory = (item: T) => {
    // Drop forward branch if user stepped back then moves forward anew
    if (historyPos < history.length - 1) {
      history = history.slice(0, historyPos + 1);
    }
    history.push(item);
    if (history.length > MAX_HISTORY_SIZE) {
      history = history.slice(history.length - MAX_HISTORY_SIZE);
    }
    historyPos = history.length - 1;
  };

  const init = (items: readonly T[]) => {
    source = items.slice();
    cycle = buildNextCycle(undefined);
    cycleCursor = cycle.length > 0 ? 0 : -1;
    history = cycle.length > 0 ? [cycle[0]] : [];
    historyPos = history.length > 0 ? 0 : -1;
  };

  init(initialItems);

  const current = (): T | null => {
    if (historyPos < 0 || historyPos >= history.length) return null;
    return history[historyPos];
  };

  const next = (): T | null => {
    if (source.length === 0) return null;

    if (historyPos < history.length - 1) {
      historyPos += 1;
      return history[historyPos];
    }

    if (source.length === 1) {
      return source[0];
    }

    cycleCursor += 1;
    if (cycleCursor >= cycle.length) {
      const lastShown = history[historyPos];
      cycle = buildNextCycle(lastShown);
      cycleCursor = 0;
    }

    const item = cycle[cycleCursor];
    pushHistory(item);
    return item;
  };

  const prev = (): T | null => {
    if (source.length === 0) return null;
    if (historyPos > 0) {
      historyPos -= 1;
      return history[historyPos];
    }
    return history[0] ?? null;
  };

  const size = () => source.length;

  return {
    current,
    next,
    prev,
    size,
    reset: init,
  };
}
