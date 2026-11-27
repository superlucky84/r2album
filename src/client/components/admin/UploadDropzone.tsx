import { mount, mountCallback } from 'lithent';
import { state } from 'lithent/helper';
import { UPLOAD_CONCURRENCY } from '@/shared/constants';
import type { AlbumSummary, ImageItem } from '@/shared/types';
import type { UploadImagePayload } from '@/client/api/admin';
import type { ExifResult } from '@/client/lib/exif';
import { computeSavingsPercent, formatBytes, formatDateTime } from '@/client/lib/format';
import type { ResizeOptions, ResizedImageVariants } from '@/client/lib/imageResize';
import {
  type UploadStore,
  type UploadTaskItem,
  type UploadTaskStatus,
  createUploadStore,
  globalUploadStore,
} from '@/client/stores/uploadStore';

export type { UploadTaskItem, UploadTaskStatus };

export interface UploadDropzoneProps {
  albums: AlbumSummary[];
  store?: UploadStore;
  onUploadComplete?: (item: ImageItem) => void;
  onBatchFinished?: () => void;
  extractExif?: (file: Blob) => Promise<ExifResult>;
  resizeImage?: (file: Blob, options?: ResizeOptions) => Promise<ResizedImageVariants>;
  uploadImage?: (payload: UploadImagePayload) => Promise<ImageItem>;
}

const STATUS_LABELS: Record<UploadTaskStatus, string> = {
  queued: '대기 중',
  processing: 'WebP 변환 중',
  uploading: '업로드 중',
  done: '완료',
  error: '실패',
};

const STATUS_BADGE_CLASSES: Record<UploadTaskStatus, string> = {
  queued: 'bg-neutral-800 text-neutral-300',
  processing: 'bg-sky-950 text-sky-300 border border-sky-700/50',
  uploading: 'bg-indigo-950 text-indigo-300 border border-indigo-700/50',
  done: 'bg-emerald-950 text-emerald-300 border border-emerald-700/50',
  error: 'bg-rose-950 text-rose-300 border border-rose-700/50',
};

export const UploadDropzone = mount<UploadDropzoneProps>((renew, initialProps) => {
  let latestProps = initialProps;
  const hasCustomDeps = Boolean(
    initialProps.extractExif || initialProps.resizeImage || initialProps.uploadImage
  );
  const store: UploadStore =
    initialProps.store ??
    (hasCustomDeps
      ? createUploadStore({
          extractExif: initialProps.extractExif,
          resizeImage: initialProps.resizeImage,
          uploadImage: initialProps.uploadImage,
        })
      : globalUploadStore);

  const isDragOver = state<boolean>(false, renew);

  mountCallback(() => {
    const unsubState = store.subscribe(() => {
      renew();
    });
    const unsubComplete = store.onUploadComplete((item) => {
      latestProps.onUploadComplete?.(item);
    });
    const unsubBatch = store.onBatchFinished(() => {
      latestProps.onBatchFinished?.();
    });

    return () => {
      unsubState();
      unsubComplete();
      unsubBatch();
    };
  });

  const handleFileInputChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      store.enqueueFiles(input.files);
      input.value = '';
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (!isDragOver.value) {
      isDragOver.value = true;
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    isDragOver.value = false;
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    isDragOver.value = false;
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      store.enqueueFiles(e.dataTransfer.files);
    }
  };

  return (props) => {
    latestProps = props;
    const snap = store.getSnapshot();
    const {
      tasks: allTasks,
      selectedAlbumId,
      defaultTagsInput,
      doneCount,
      errorCount,
      inProgressCount,
      progressPercent,
      wakeLockActive,
    } = snap;

    return (
      <section data-testid="upload-dropzone-section" class="space-y-5">
        <div class="grid gap-4 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5 sm:grid-cols-2">
          <div>
            <label for="upload-default-album" class="block text-xs font-medium text-neutral-300">
              업로드 기본 앨범 (선택)
            </label>
            <select
              id="upload-default-album"
              data-testid="upload-album-select"
              value={selectedAlbumId}
              onChange={(e: Event) => {
                store.setSelectedAlbumId((e.target as HTMLSelectElement).value);
              }}
              class="mt-1.5 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white focus:border-neutral-500 focus:outline-none"
            >
              <option value="">미분류</option>
              {props.albums.map((album) => (
                <option key={album.id} value={album.id}>
                  {album.name} ({album.imageCount})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label for="upload-default-tags" class="block text-xs font-medium text-neutral-300">
              업로드 기본 태그 (쉼표로 구분)
            </label>
            <input
              id="upload-default-tags"
              data-testid="upload-tags-input"
              type="text"
              value={defaultTagsInput}
              onInput={(e: Event) => {
                store.setDefaultTagsInput((e.target as HTMLInputElement).value);
              }}
              placeholder="예: 가족, 제주여행, 2026"
              class="mt-1.5 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
            />
          </div>
        </div>

        <div
          data-testid="upload-dropzone"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          class={
            isDragOver.value
              ? 'rounded-2xl border-2 border-dashed border-sky-400 bg-sky-950/30 p-10 text-center transition'
              : 'rounded-2xl border-2 border-dashed border-neutral-700 bg-neutral-900/40 p-10 text-center transition hover:border-neutral-500'
          }
        >
          <p class="text-base font-medium text-white">
            사진을 여기에 드래그 앤 드롭하거나 파일을 선택하세요
          </p>
          <p class="mt-1.5 text-xs text-neutral-400">
            브라우저에서 EXIF 촬영일을 추출한 뒤 표시용 WebP(최대 2048px)와 썸네일 WebP(480px)로
            변환해 동시 {UPLOAD_CONCURRENCY}건씩 업로드합니다.
          </p>
          <div class="mt-5">
            <label class="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200">
              <span>사진 파일 선택</span>
              <input
                type="file"
                accept="image/*"
                multiple
                data-testid="upload-file-input"
                onChange={handleFileInputChange}
                class="hidden"
              />
            </label>
          </div>
        </div>

        {inProgressCount > 0 && (
          <div
            data-testid="upload-background-notice"
            class="flex flex-wrap items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-950/25 px-4 py-2.5 text-xs text-sky-200"
          >
            <span class="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
            <span>
              다른 탭이나 갤러리로 이동해도 백그라운드에서 업로드가 계속됩니다. (새로고침·탭 닫기
              주의{wakeLockActive ? ' · 화면 꺼짐 방지 켜짐' : ''})
            </span>
          </div>
        )}

        {allTasks.length > 0 && (
          <div class="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="text-sm text-neutral-200">
                <span class="font-semibold text-white">업로드 큐</span>
                <span class="ml-2 text-xs text-neutral-400">
                  완료 {doneCount} / 실패 {errorCount} / 진행·대기 {inProgressCount} (총{' '}
                  {allTasks.length}건)
                </span>
              </div>
              <div class="flex items-center gap-2">
                {errorCount > 0 && (
                  <button
                    type="button"
                    data-testid="upload-retry-all"
                    onClick={() => store.retryAllFailed()}
                    class="rounded-lg border border-amber-500/40 bg-amber-950/50 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-900/60"
                  >
                    실패 항목 전체 재시도
                  </button>
                )}
                {doneCount > 0 && (
                  <button
                    type="button"
                    data-testid="upload-clear-done"
                    onClick={() => store.clearCompleted()}
                    class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:text-white"
                  >
                    완료 항목 지우기
                  </button>
                )}
              </div>
            </div>

            <div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-800">
              <div
                data-testid="upload-overall-progress"
                class="h-full rounded-full bg-sky-500 transition-all duration-200"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <ul data-testid="upload-queue-list" class="mt-4 divide-y divide-neutral-800/80">
              {allTasks.map((task) => {
                const savings =
                  task.convertedBytes !== null
                    ? computeSavingsPercent(task.originalBytes, task.convertedBytes)
                    : null;

                return (
                  <li
                    key={task.id}
                    data-testid="upload-queue-item"
                    class="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="truncate font-medium text-white">{task.filename}</span>
                        <span
                          class={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE_CLASSES[task.status]}`}
                        >
                          {STATUS_LABELS[task.status]}
                        </span>
                        {task.hasExifDate && task.takenAt && (
                          <span class="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-300">
                            EXIF {formatDateTime(task.takenAt)}
                          </span>
                        )}
                      </div>

                      <div class="mt-1 flex flex-wrap items-center gap-3 text-xs text-neutral-400">
                        <span>원본 {formatBytes(task.originalBytes)}</span>
                        {task.convertedBytes !== null && (
                          <span data-testid="upload-savings" class="text-emerald-300">
                            → WebP {formatBytes(task.convertedBytes)} (
                            {savings !== null && savings >= 0
                              ? `${savings}% 절감`
                              : `${Math.abs(savings ?? 0)}% 증가`}
                            )
                          </span>
                        )}
                        {task.width && task.height && (
                          <span>
                            {task.width}×{task.height}
                          </span>
                        )}
                      </div>

                      {task.errorMessage && (
                        <p data-testid="upload-item-error" class="mt-1 text-xs text-rose-400">
                          {task.errorMessage}
                        </p>
                      )}
                    </div>

                    {task.status === 'error' && (
                      <button
                        type="button"
                        data-testid={`upload-retry-${task.id}`}
                        onClick={() => store.retryTask(task.id)}
                        class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
                      >
                        재시도
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    );
  };
});
