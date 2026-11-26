import { mount, mountCallback } from 'lithent';
import { state } from 'lithent/helper';
import type { AdminStatsResponse, AlbumSummary, TagSummary } from '@/shared/types';
import { fetchAdminStats, fetchFilters } from '@/client/api/admin';
import { AlbumManager } from './AlbumManager';
import { ImageManageTable } from './ImageManageTable';
import { StorageGauge } from './StorageGauge';
import { UploadDropzone } from './UploadDropzone';
import { UserAllowlistManager } from './UserAllowlistManager';

type AdminTab = 'upload' | 'images' | 'albums' | 'users';

export const AdminView = mount((renew) => {
  const activeTab = state<AdminTab>('upload', renew);
  const stats = state<AdminStatsResponse | null>(null, renew);
  const albums = state<AlbumSummary[]>([], renew);
  const tags = state<TagSummary[]>([], renew);
  const loadingSummary = state<boolean>(false, renew);
  const summaryError = state<string | null>(null, renew);
  const imagesRefreshTrigger = state<number>(0, renew);

  const loadSummary = async (signal?: AbortSignal) => {
    loadingSummary.value = true;
    summaryError.value = null;
    try {
      const [statsRes, filtersRes] = await Promise.all([
        fetchAdminStats(signal),
        fetchFilters(signal),
      ]);
      stats.value = statsRes;
      albums.value = filtersRes.albums;
      tags.value = filtersRes.tags;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      summaryError.value =
        err instanceof Error ? err.message : '관리자 통계를 불러오지 못했습니다.';
    } finally {
      loadingSummary.value = false;
    }
  };

  mountCallback(() => {
    const controller = new AbortController();
    void loadSummary(controller.signal);
    return () => controller.abort();
  });

  const handleDataChanged = () => {
    void loadSummary();
    imagesRefreshTrigger.value += 1;
  };

  return () => {
    const pendingUsers = stats.value?.pendingUsers ?? 0;

    return (
      <div data-testid="admin-view" class="space-y-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 class="text-2xl font-semibold tracking-tight text-white">관리자 대시보드</h1>
            <p class="mt-1 text-sm text-neutral-400">
              사진 WebP 최적화 업로드, 메타데이터·앨범 관리 및 가족 가입 승인을 관리합니다.
            </p>
          </div>
        </div>

        {summaryError.value && (
          <div
            role="alert"
            class="rounded-xl border border-rose-500/40 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
          >
            {summaryError.value}
          </div>
        )}

        <StorageGauge stats={stats.value} loading={loadingSummary.value} />

        <div
          role="tablist"
          aria-label="관리자 기능 탭"
          class="flex flex-wrap gap-2 border-b border-neutral-800 pb-3"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab.value === 'upload'}
            data-testid="admin-tab-upload"
            onClick={() => {
              activeTab.value = 'upload';
            }}
            class={
              activeTab.value === 'upload'
                ? 'rounded-xl bg-white px-4 py-2 text-sm font-medium text-neutral-900'
                : 'rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 hover:text-white'
            }
          >
            사진 업로드
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab.value === 'images'}
            data-testid="admin-tab-images"
            onClick={() => {
              activeTab.value = 'images';
            }}
            class={
              activeTab.value === 'images'
                ? 'rounded-xl bg-white px-4 py-2 text-sm font-medium text-neutral-900'
                : 'rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 hover:text-white'
            }
          >
            이미지 관리 ({stats.value?.totalImages ?? 0})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab.value === 'albums'}
            data-testid="admin-tab-albums"
            onClick={() => {
              activeTab.value = 'albums';
            }}
            class={
              activeTab.value === 'albums'
                ? 'rounded-xl bg-white px-4 py-2 text-sm font-medium text-neutral-900'
                : 'rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 hover:text-white'
            }
          >
            앨범 관리 ({albums.value.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab.value === 'users'}
            data-testid="admin-tab-users"
            onClick={() => {
              activeTab.value = 'users';
            }}
            class={
              activeTab.value === 'users'
                ? 'inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-neutral-900'
                : 'inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 hover:text-white'
            }
          >
            <span>사용자·승인 관리</span>
            {pendingUsers > 0 && (
              <span
                data-testid="admin-tab-pending-badge"
                class="rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-950"
              >
                {pendingUsers}
              </span>
            )}
          </button>
        </div>

        <div>
          {activeTab.value === 'upload' && (
            <UploadDropzone albums={albums.value} onBatchFinished={handleDataChanged} />
          )}
          {activeTab.value === 'images' && (
            <ImageManageTable
              albums={albums.value}
              tags={tags.value}
              refreshTrigger={imagesRefreshTrigger.value}
              onDataChanged={handleDataChanged}
            />
          )}
          {activeTab.value === 'albums' && (
            <AlbumManager albums={albums.value} onAlbumsChanged={handleDataChanged} />
          )}
          {activeTab.value === 'users' && (
            <UserAllowlistManager onUsersChanged={() => void loadSummary()} />
          )}
        </div>
      </div>
    );
  };
});
