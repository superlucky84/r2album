import { lmount } from 'lithent';
import { R2_STORAGE_HARD_CAP_BYTES } from '@/shared/constants';
import type { AdminStatsResponse } from '@/shared/types';
import { formatBytes, formatGigabytes } from '@/client/lib/format';

export interface StorageGaugeProps {
  stats: AdminStatsResponse | null;
  loading: boolean;
}

export const StorageGauge = lmount<StorageGaugeProps>(() => {
  return ({ stats, loading }) => {
    const percent = stats ? Math.min(100, Math.max(0, stats.usageRatio * 100)) : 0;
    const capBytes = stats?.storageCapBytes ?? R2_STORAGE_HARD_CAP_BYTES;
    const isAtCap = stats ? stats.totalBytes >= capBytes : false;
    const barColor =
      isAtCap || percent >= 90 ? 'bg-rose-500' : percent >= 75 ? 'bg-amber-500' : 'bg-emerald-500';

    return (
      <section
        data-testid="storage-gauge"
        class="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5"
      >
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="text-xs font-medium uppercase tracking-wider text-neutral-400">
              R2 스토리지 현황 (무료 티어 10 GB 기준)
            </p>
            <div class="mt-1 flex items-baseline gap-2">
              <span data-testid="storage-usage-text" class="text-2xl font-semibold text-white">
                {loading && !stats
                  ? '불러오는 중...'
                  : `${formatGigabytes(stats?.totalBytes ?? 0)} / ${formatGigabytes(stats?.freeTierBytes ?? 10 * 1024 * 1024 * 1024)}`}
              </span>
              {stats && <span class="text-xs text-neutral-400">({percent.toFixed(1)}% 사용)</span>}
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3 text-xs">
            <div class="rounded-xl border border-neutral-800 bg-neutral-950/70 px-3.5 py-2">
              <span class="text-neutral-400">총 사진</span>
              <span data-testid="stats-total-images" class="ml-2 font-semibold text-white">
                {(stats?.totalImages ?? 0).toLocaleString()}장
              </span>
            </div>
            <div class="rounded-xl border border-neutral-800 bg-neutral-950/70 px-3.5 py-2">
              <span class="text-neutral-400">표시용 / 썸네일</span>
              <span class="ml-2 font-medium text-neutral-200">
                {formatBytes(stats?.totalDisplayBytes ?? 0)} /{' '}
                {formatBytes(stats?.totalThumbBytes ?? 0)}
              </span>
            </div>
            <div class="rounded-xl border border-neutral-800 bg-neutral-950/70 px-3.5 py-2">
              <span class="text-neutral-400">승인 대기</span>
              <span
                data-testid="stats-pending-users"
                class={
                  (stats?.pendingUsers ?? 0) > 0
                    ? 'ml-2 font-semibold text-amber-400'
                    : 'ml-2 font-semibold text-neutral-200'
                }
              >
                {stats?.pendingUsers ?? 0}명
              </span>
            </div>
          </div>
        </div>

        <div class="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-neutral-800">
          <div
            data-testid="storage-gauge-bar"
            class={`h-full rounded-full transition-all duration-300 ${barColor}`}
            style={{ width: `${percent}%` }}
          />
        </div>

        <p class="mt-2 text-xs text-neutral-400">
          {isAtCap ? (
            <span class="font-medium text-rose-400">
              무료 티어 보호 한도(9.5 GB)에 도달하여 새 업로드가 차단되어 있습니다. 기존 사진을
              삭제해 공간을 확보해 주세요.
            </span>
          ) : (
            <span>
              과금 방지 보호: 저장 용량이 9.5 GB({formatGigabytes(capBytes)})에 도달하면 업로드가
              자동 차단됩니다.
            </span>
          )}
        </p>
      </section>
    );
  };
});
