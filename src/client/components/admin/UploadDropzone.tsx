import { mount } from 'lithent';
import { state } from 'lithent/helper';
import { UPLOAD_CONCURRENCY } from '@/shared/constants';
import type { AlbumSummary, ImageItem } from '@/shared/types';
import { type UploadImagePayload, uploadAdminImage } from '@/client/api/admin';
import { type ExifResult, extractExifFromFile } from '@/client/lib/exif';
import {
  computeSavingsPercent,
  formatBytes,
  formatDateTime,
  parseTagsInput,
} from '@/client/lib/format';
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

export interface UploadDropzoneProps {
  albums: AlbumSummary[];
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
  let nextTaskSeq = 1;
  let activeCount = 0;
  let batchHadUploads = false;

  const tasks = state<UploadTaskItem[]>([], renew);
  const selectedAlbumId = state<string>('', renew);
  const defaultTagsInput = state<string>('', renew);
  const isDragOver = state<boolean>(false, renew);

  const updateTask = (taskId: string, updater: (item: UploadTaskItem) => UploadTaskItem) => {
    tasks.value = tasks.value.map((item) => (item.id === taskId ? updater(item) : item));
  };

  const runTask = async (taskId: string) => {
    const task = tasks.value.find((item) => item.id === taskId);
    if (!task) return;

    const doExtractExif = latestProps.extractExif ?? extractExifFromFile;
    const doResize = latestProps.resizeImage ?? resizeImageToWebpVariants;
    const doUpload = latestProps.uploadImage ?? uploadAdminImage;

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
      latestProps.onUploadComplete?.(created);
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
      const next = tasks.value.find((item) => item.status === 'queued');
      if (!next) break;

      activeCount += 1;
      // Synchronously mark as processing before spawning next loop iteration so concurrency stays strictly bounded
      updateTask(next.id, (item) => ({ ...item, status: 'processing', errorMessage: null }));

      void runTask(next.id).finally(() => {
        activeCount -= 1;
        pumpQueue();
        if (activeCount === 0 && !tasks.value.some((item) => item.status === 'queued')) {
          if (batchHadUploads) {
            batchHadUploads = false;
            latestProps.onBatchFinished?.();
          }
        }
      });
    }
  };

  const enqueueFiles = (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const albumId = selectedAlbumId.value || null;
    const tags = parseTagsInput(defaultTagsInput.value);

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

    tasks.value = [...newTasks, ...tasks.value];
    pumpQueue();
  };

  const handleFileInputChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      enqueueFiles(input.files);
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
      enqueueFiles(e.dataTransfer.files);
    }
  };

  const handleRetryTask = (taskId: string) => {
    updateTask(taskId, (item) => ({
      ...item,
      status: 'queued',
      errorMessage: null,
    }));
    pumpQueue();
  };

  const handleRetryAllFailed = () => {
    tasks.value = tasks.value.map((item) =>
      item.status === 'error' ? { ...item, status: 'queued', errorMessage: null } : item
    );
    pumpQueue();
  };

  const handleClearCompleted = () => {
    tasks.value = tasks.value.filter((item) => item.status !== 'done');
  };

  return (props) => {
    latestProps = props;
    const allTasks = tasks.value;
    const doneCount = allTasks.filter((t) => t.status === 'done').length;
    const errorCount = allTasks.filter((t) => t.status === 'error').length;
    const inProgressCount = allTasks.filter(
      (t) => t.status === 'queued' || t.status === 'processing' || t.status === 'uploading'
    ).length;
    const progressPercent =
      allTasks.length > 0 ? Math.round(((doneCount + errorCount) / allTasks.length) * 100) : 0;

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
              value={selectedAlbumId.value}
              onChange={(e: Event) => {
                selectedAlbumId.value = (e.target as HTMLSelectElement).value;
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
              value={defaultTagsInput.value}
              onInput={(e: Event) => {
                defaultTagsInput.value = (e.target as HTMLInputElement).value;
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
                    onClick={handleRetryAllFailed}
                    class="rounded-lg border border-amber-500/40 bg-amber-950/50 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-900/60"
                  >
                    실패 항목 전체 재시도
                  </button>
                )}
                {doneCount > 0 && (
                  <button
                    type="button"
                    data-testid="upload-clear-done"
                    onClick={handleClearCompleted}
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
                        onClick={() => handleRetryTask(task.id)}
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
