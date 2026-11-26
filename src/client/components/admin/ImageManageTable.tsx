import { mount, mountCallback } from 'lithent';
import { state } from 'lithent/helper';
import {
  ADMIN_PAGE_SIZE_OPTIONS,
  BULK_DELETE_MAX,
  CAPTION_MAX_LENGTH,
  CHUNK_SIZE,
} from '@/shared/constants';
import type { AlbumSummary, ImageItem, TagSummary } from '@/shared/types';
import {
  bulkDeleteAdminImages,
  bulkUpdateAdminImages,
  deleteAdminImage,
  fetchImages,
  updateAdminImage,
} from '@/client/api/admin';
import {
  formatDateTime,
  fromDateTimeLocalValue,
  parseTagsInput,
  toDateTimeLocalValue,
} from '@/client/lib/format';
import { ConfirmModal } from './ConfirmModal';

export interface ImageManageTableProps {
  albums: AlbumSummary[];
  tags: TagSummary[];
  refreshTrigger?: number;
  onDataChanged?: () => void;
}

interface EditDraft {
  id: string;
  caption: string;
  albumId: string;
  tagsText: string;
  takenAtLocal: string;
}

interface DeleteModalState {
  mode: 'single' | 'bulk';
  ids: string[];
  label: string;
}

export const ImageManageTable = mount<ImageManageTableProps>((renew, initialProps) => {
  let latestProps = initialProps;
  let lastTrigger = initialProps.refreshTrigger ?? 0;
  let requestSeq = 0;

  const items = state<ImageItem[]>([], renew);
  const total = state<number>(0, renew);
  const offset = state<number>(0, renew);
  const pageSize = state<number>(CHUNK_SIZE, renew);
  const filterAlbumId = state<string>('', renew);
  const filterTag = state<string>('', renew);
  const searchQuery = state<string>('', renew);
  const loading = state<boolean>(false, renew);
  const errorMessage = state<string | null>(null, renew);
  const successMessage = state<string | null>(null, renew);
  const selectedIds = state<string[]>([], renew);

  const bulkAlbumTarget = state<string>('', renew);
  const bulkTagsInput = state<string>('', renew);
  const bulkUpdating = state<boolean>(false, renew);

  const editDraft = state<EditDraft | null>(null, renew);
  const savingEdit = state<boolean>(false, renew);
  const deleteModal = state<DeleteModalState | null>(null, renew);
  const deleting = state<boolean>(false, renew);

  const loadImages = async (nextOffset = offset.value, nextLimit = pageSize.value) => {
    const seq = ++requestSeq;
    loading.value = true;
    errorMessage.value = null;

    try {
      const res = await fetchImages({
        offset: nextOffset,
        limit: nextLimit,
        albumId: filterAlbumId.value || undefined,
        tag: filterTag.value || undefined,
      });
      if (seq !== requestSeq) return;
      items.value = res.items;
      total.value = res.total;
      offset.value = res.offset;
      // Drop selections that are no longer visible on the current page
      const visibleSet = new Set(res.items.map((item) => item.id));
      selectedIds.value = selectedIds.value.filter((id) => visibleSet.has(id));
    } catch (err: unknown) {
      if (seq !== requestSeq) return;
      errorMessage.value =
        err instanceof Error ? err.message : '이미지 목록을 불러오지 못했습니다.';
    } finally {
      if (seq === requestSeq) {
        loading.value = false;
      }
    }
  };

  mountCallback(() => {
    void loadImages(0);
  });

  const handleFilterChange = (nextAlbum: string, nextTag: string) => {
    filterAlbumId.value = nextAlbum;
    filterTag.value = nextTag;
    selectedIds.value = [];
    editDraft.value = null;
    void loadImages(0, pageSize.value);
  };

  const handlePageSizeChange = (nextSize: number) => {
    if (!Number.isFinite(nextSize) || nextSize <= 0 || nextSize === pageSize.value) return;
    pageSize.value = nextSize;
    selectedIds.value = [];
    editDraft.value = null;
    void loadImages(0, nextSize);
  };

  const toggleSelect = (id: string) => {
    if (selectedIds.value.includes(id)) {
      selectedIds.value = selectedIds.value.filter((x) => x !== id);
    } else {
      selectedIds.value = [...selectedIds.value, id];
    }
  };

  const toggleSelectAll = (visibleItems: ImageItem[]) => {
    const visibleIds = visibleItems.map((i) => i.id);
    const allSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selectedIds.value.includes(id));
    selectedIds.value = allSelected ? [] : visibleIds.slice(0, BULK_DELETE_MAX);
  };

  const startEdit = (item: ImageItem) => {
    errorMessage.value = null;
    editDraft.value = {
      id: item.id,
      caption: item.caption,
      albumId: item.albumId ?? '',
      tagsText: item.tags.join(', '),
      takenAtLocal: toDateTimeLocalValue(item.takenAt),
    };
  };

  const cancelEdit = () => {
    editDraft.value = null;
  };

  const saveEdit = async () => {
    const draft = editDraft.value;
    if (!draft || savingEdit.value) return;

    const parsedTakenAt = fromDateTimeLocalValue(draft.takenAtLocal);
    if (draft.takenAtLocal.trim() && parsedTakenAt === null) {
      errorMessage.value = '촬영일 형식이 올바르지 않습니다.';
      return;
    }

    savingEdit.value = true;
    errorMessage.value = null;
    try {
      const updated = await updateAdminImage(draft.id, {
        caption: draft.caption,
        albumId: draft.albumId || null,
        tags: parseTagsInput(draft.tagsText),
        ...(parsedTakenAt !== null ? { takenAt: parsedTakenAt } : {}),
      });
      items.value = items.value.map((item) => (item.id === updated.id ? updated : item));
      editDraft.value = null;
      latestProps.onDataChanged?.();
    } catch (err: unknown) {
      errorMessage.value =
        err instanceof Error ? err.message : '이미지 메타데이터 수정에 실패했습니다.';
    } finally {
      savingEdit.value = false;
    }
  };

  const requestSingleDelete = (item: ImageItem) => {
    deleteModal.value = {
      mode: 'single',
      ids: [item.id],
      label: item.caption || item.id,
    };
  };

  const requestBulkDelete = () => {
    if (selectedIds.value.length === 0) return;
    deleteModal.value = {
      mode: 'bulk',
      ids: selectedIds.value.slice(0, BULK_DELETE_MAX),
      label: `${selectedIds.value.length}장의 이미지`,
    };
  };

  const handleBulkMoveAlbum = async () => {
    if (selectedIds.value.length === 0 || !bulkAlbumTarget.value || bulkUpdating.value) return;

    const targetAlbumId = bulkAlbumTarget.value === '__unassigned__' ? null : bulkAlbumTarget.value;
    const targetAlbumName =
      targetAlbumId === null
        ? '미분류'
        : (latestProps.albums.find((a) => a.id === targetAlbumId)?.name ?? '선택한 앨범');

    bulkUpdating.value = true;
    errorMessage.value = null;
    successMessage.value = null;
    try {
      const res = await bulkUpdateAdminImages({
        ids: selectedIds.value.slice(0, BULK_DELETE_MAX),
        albumId: targetAlbumId,
      });
      await loadImages(offset.value);
      latestProps.onDataChanged?.();
      successMessage.value = `${res.updatedCount}장의 이미지를 '${targetAlbumName}'(으)로 이동했습니다.`;
      bulkAlbumTarget.value = '';
    } catch (err: unknown) {
      errorMessage.value = err instanceof Error ? err.message : '일괄 앨범 이동에 실패했습니다.';
    } finally {
      bulkUpdating.value = false;
    }
  };

  const handleBulkTags = async (mode: 'add' | 'remove', explicitTags?: string[]) => {
    if (selectedIds.value.length === 0 || bulkUpdating.value) return;
    const targetTags = explicitTags ?? parseTagsInput(bulkTagsInput.value);
    if (targetTags.length === 0) {
      errorMessage.value =
        mode === 'add' ? '추가할 태그를 입력해 주세요.' : '제거할 태그를 입력해 주세요.';
      return;
    }

    bulkUpdating.value = true;
    errorMessage.value = null;
    successMessage.value = null;
    try {
      const res = await bulkUpdateAdminImages(
        mode === 'add'
          ? { ids: selectedIds.value.slice(0, BULK_DELETE_MAX), addTags: targetTags }
          : { ids: selectedIds.value.slice(0, BULK_DELETE_MAX), removeTags: targetTags }
      );
      await loadImages(offset.value);
      latestProps.onDataChanged?.();
      const label = targetTags.map((t) => `#${t}`).join(', ');
      successMessage.value =
        mode === 'add'
          ? `${res.updatedCount}장의 이미지에 태그(${label})를 추가했습니다.`
          : `${res.updatedCount}장의 이미지에서 태그(${label})를 제거했습니다.`;
      if (!explicitTags) {
        bulkTagsInput.value = '';
      }
    } catch (err: unknown) {
      errorMessage.value = err instanceof Error ? err.message : '일괄 태그 수정에 실패했습니다.';
    } finally {
      bulkUpdating.value = false;
    }
  };

  const confirmDelete = async () => {
    const target = deleteModal.value;
    if (!target || deleting.value) return;

    deleting.value = true;
    errorMessage.value = null;
    try {
      if (target.mode === 'single') {
        await deleteAdminImage(target.ids[0]);
      } else {
        await bulkDeleteAdminImages(target.ids);
      }

      const deletedSet = new Set(target.ids);
      selectedIds.value = selectedIds.value.filter((id) => !deletedSet.has(id));
      if (editDraft.value && deletedSet.has(editDraft.value.id)) {
        editDraft.value = null;
      }
      deleteModal.value = null;

      const nextOffset =
        items.value.length <= target.ids.length && offset.value > 0
          ? Math.max(0, offset.value - pageSize.value)
          : offset.value;
      await loadImages(nextOffset);
      latestProps.onDataChanged?.();
    } catch (err: unknown) {
      errorMessage.value = err instanceof Error ? err.message : '이미지 삭제에 실패했습니다.';
      deleteModal.value = null;
    } finally {
      deleting.value = false;
    }
  };

  return (props) => {
    latestProps = props;
    if ((props.refreshTrigger ?? 0) !== lastTrigger) {
      lastTrigger = props.refreshTrigger ?? 0;
      void loadImages(offset.value);
    }

    const q = searchQuery.value.trim().toLowerCase();
    const visibleItems = q
      ? items.value.filter(
          (item) =>
            item.caption.toLowerCase().includes(q) ||
            (item.albumName ?? '').toLowerCase().includes(q) ||
            item.tags.some((t) => t.toLowerCase().includes(q)) ||
            item.id.toLowerCase().includes(q)
        )
      : items.value;

    const allChecked =
      visibleItems.length > 0 && visibleItems.every((i) => selectedIds.value.includes(i.id));
    const hasPrev = offset.value > 0;
    const hasNext = offset.value + pageSize.value < total.value;

    const selectedSet = new Set(selectedIds.value);
    const selectedTagSet = new Set<string>();
    for (const item of items.value) {
      if (selectedSet.has(item.id)) {
        for (const tag of item.tags) {
          selectedTagSet.add(tag);
        }
      }
    }
    const selectedTagsList = Array.from(selectedTagSet).sort();
    const parsedBulkTags = parseTagsInput(bulkTagsInput.value);

    return (
      <section data-testid="image-manage-table" class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4">
          <div class="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="앨범 필터"
              data-testid="manage-album-filter"
              value={filterAlbumId.value}
              onChange={(e: Event) =>
                handleFilterChange((e.target as HTMLSelectElement).value, filterTag.value)
              }
              class="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white focus:border-neutral-500 focus:outline-none"
            >
              <option value="">전체 앨범</option>
              <option value="__unassigned__">미분류만 보기</option>
              {props.albums.map((album) => (
                <option key={album.id} value={album.id}>
                  {album.name} ({album.imageCount})
                </option>
              ))}
            </select>

            <select
              aria-label="태그 필터"
              data-testid="manage-tag-filter"
              value={filterTag.value}
              onChange={(e: Event) =>
                handleFilterChange(filterAlbumId.value, (e.target as HTMLSelectElement).value)
              }
              class="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white focus:border-neutral-500 focus:outline-none"
            >
              <option value="">전체 태그</option>
              {props.tags.map((tag) => (
                <option key={tag.id} value={tag.name}>
                  #{tag.name} ({tag.imageCount})
                </option>
              ))}
            </select>

            <input
              type="search"
              aria-label="이미지 검색"
              data-testid="manage-search-input"
              value={searchQuery.value}
              onInput={(e: Event) => {
                searchQuery.value = (e.target as HTMLInputElement).value;
              }}
              placeholder="캡션·태그·앨범 검색..."
              class="w-48 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none sm:w-60"
            />
          </div>

          <div class="flex items-center gap-2">
            <select
              aria-label="페이지당 표시 개수"
              data-testid="manage-page-size"
              value={String(pageSize.value)}
              disabled={loading.value}
              onChange={(e: Event) =>
                handlePageSizeChange(Number((e.target as HTMLSelectElement).value))
              }
              class="rounded-xl border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-xs text-white focus:border-neutral-500 focus:outline-none disabled:opacity-50"
            >
              {ADMIN_PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={String(size)}>
                  {size}장씩 보기
                </option>
              ))}
            </select>
            {selectedIds.value.length > 0 && (
              <button
                type="button"
                data-testid="bulk-delete-button"
                onClick={requestBulkDelete}
                class="rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-medium text-white transition hover:bg-rose-500"
              >
                선택 삭제 ({selectedIds.value.length})
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadImages(offset.value)}
              disabled={loading.value}
              class="rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
            >
              새로고침
            </button>
          </div>
        </div>

        {selectedIds.value.length > 0 && (
          <div
            data-testid="bulk-action-bar"
            class="space-y-3 rounded-2xl border border-sky-500/35 bg-sky-950/20 p-4"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-xs">
                <span class="rounded-full bg-sky-500/20 px-2.5 py-1 font-semibold text-sky-200">
                  {selectedIds.value.length}장 선택됨
                </span>
                <button
                  type="button"
                  data-testid="bulk-clear-selection"
                  onClick={() => {
                    selectedIds.value = [];
                    successMessage.value = null;
                  }}
                  class="text-neutral-400 underline hover:text-white"
                >
                  선택 해제
                </button>
              </div>
              <span class="text-[11px] text-neutral-400">
                한 번에 최대 {BULK_DELETE_MAX}장까지 일괄 작업할 수 있습니다.
              </span>
            </div>

            <div class="grid gap-3 lg:grid-cols-2">
              {/* Bulk Album Move */}
              <div class="flex flex-wrap items-center gap-2">
                <select
                  aria-label="일괄 이동할 앨범 선택"
                  data-testid="bulk-album-select"
                  value={bulkAlbumTarget.value}
                  disabled={bulkUpdating.value}
                  onChange={(e: Event) => {
                    bulkAlbumTarget.value = (e.target as HTMLSelectElement).value;
                  }}
                  class="min-w-[180px] flex-1 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
                >
                  <option value="">이동할 앨범 선택...</option>
                  <option value="__unassigned__">미분류로 이동</option>
                  {props.albums.map((album) => (
                    <option key={album.id} value={album.id}>
                      {album.name} ({album.imageCount})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  data-testid="bulk-move-album-button"
                  disabled={!bulkAlbumTarget.value || bulkUpdating.value}
                  onClick={() => void handleBulkMoveAlbum()}
                  class="rounded-xl bg-white px-3.5 py-2 text-xs font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {bulkUpdating.value ? '처리 중...' : '앨범 이동'}
                </button>
              </div>

              {/* Bulk Add / Remove Tags */}
              <div class="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  aria-label="일괄 추가 또는 제거할 태그"
                  data-testid="bulk-tags-input"
                  value={bulkTagsInput.value}
                  disabled={bulkUpdating.value}
                  onInput={(e: Event) => {
                    bulkTagsInput.value = (e.target as HTMLInputElement).value;
                  }}
                  placeholder="태그 입력 (쉼표 구분, 예: 바다, 가족)"
                  class="min-w-[180px] flex-1 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-sky-500 focus:outline-none"
                />
                <button
                  type="button"
                  data-testid="bulk-add-tags-button"
                  disabled={parsedBulkTags.length === 0 || bulkUpdating.value}
                  onClick={() => void handleBulkTags('add')}
                  class="rounded-xl border border-emerald-600/60 bg-emerald-950/60 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:bg-emerald-900/70 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  태그 추가
                </button>
                <button
                  type="button"
                  data-testid="bulk-remove-tags-button"
                  disabled={parsedBulkTags.length === 0 || bulkUpdating.value}
                  onClick={() => void handleBulkTags('remove')}
                  class="rounded-xl border border-amber-600/60 bg-amber-950/60 px-3 py-2 text-xs font-medium text-amber-200 transition hover:bg-amber-900/70 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  태그 제거
                </button>
              </div>
            </div>

            {selectedTagsList.length > 0 && (
              <div class="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                <span class="text-neutral-400">선택된 사진의 태그 (클릭하여 일괄 제거):</span>
                {selectedTagsList.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    disabled={bulkUpdating.value}
                    data-testid={`bulk-quick-remove-tag-${tag}`}
                    onClick={() => void handleBulkTags('remove', [tag])}
                    class="inline-flex items-center gap-1 rounded-full border border-sky-700/60 bg-sky-950/70 px-2.5 py-0.5 text-sky-200 transition hover:border-rose-500/60 hover:bg-rose-950/60 hover:text-rose-200 disabled:opacity-40"
                  >
                    <span>#{tag}</span>
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {successMessage.value && (
          <div
            role="status"
            data-testid="manage-success"
            class="rounded-xl border border-emerald-500/40 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-200"
          >
            {successMessage.value}
          </div>
        )}

        {errorMessage.value && (
          <div
            role="alert"
            data-testid="manage-error"
            class="rounded-xl border border-rose-500/40 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
          >
            {errorMessage.value}
          </div>
        )}

        <div class="overflow-x-auto rounded-2xl border border-neutral-800 bg-neutral-900/60">
          <table class="min-w-full divide-y divide-neutral-800 text-left text-sm">
            <thead class="bg-neutral-950/70 text-xs uppercase text-neutral-400">
              <tr>
                <th class="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="현재 페이지 전체 선택"
                    data-testid="manage-select-all"
                    checked={allChecked}
                    onChange={() => toggleSelectAll(visibleItems)}
                    class="h-4 w-4 rounded border-neutral-600 bg-neutral-900"
                  />
                </th>
                <th class="px-3 py-3">사진</th>
                <th class="px-3 py-3">캡션 / 메타데이터</th>
                <th class="px-3 py-3">촬영일</th>
                <th class="px-3 py-3 text-right">작업</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-neutral-800/80">
              {loading.value && items.value.length === 0 ? (
                <tr>
                  <td colSpan={5} class="px-4 py-10 text-center text-sm text-neutral-400">
                    이미지 목록을 불러오는 중...
                  </td>
                </tr>
              ) : visibleItems.length === 0 ? (
                <tr>
                  <td colSpan={5} class="px-4 py-10 text-center text-sm text-neutral-400">
                    표시할 이미지가 없습니다.
                  </td>
                </tr>
              ) : (
                visibleItems.map((item) => {
                  const isEditing = editDraft.value?.id === item.id;
                  const isChecked = selectedIds.value.includes(item.id);

                  return (
                    <tr
                      key={item.id}
                      data-testid={`image-row-${item.id}`}
                      class="align-top transition hover:bg-neutral-900/80"
                    >
                      <td class="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`${item.caption || item.id} 선택`}
                          data-testid={`select-image-${item.id}`}
                          checked={isChecked}
                          onChange={() => toggleSelect(item.id)}
                          class="mt-1 h-4 w-4 rounded border-neutral-600 bg-neutral-900"
                        />
                      </td>
                      <td class="px-3 py-3">
                        <img
                          src={item.thumbUrl}
                          alt={item.caption || '업로드된 사진'}
                          loading="lazy"
                          class="h-16 w-16 rounded-lg border border-neutral-800 bg-neutral-950 object-cover"
                        />
                        <div class="mt-1 text-[11px] text-neutral-500">
                          {item.width}×{item.height}
                        </div>
                      </td>

                      <td class="min-w-[260px] px-3 py-3">
                        {isEditing && editDraft.value ? (
                          <div class="space-y-2">
                            <input
                              type="text"
                              maxLength={CAPTION_MAX_LENGTH}
                              data-testid={`edit-caption-${item.id}`}
                              value={editDraft.value.caption}
                              onInput={(e: Event) => {
                                if (!editDraft.value) return;
                                editDraft.value = {
                                  ...editDraft.value,
                                  caption: (e.target as HTMLInputElement).value,
                                };
                              }}
                              placeholder="캡션 입력..."
                              class="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-xs text-white focus:border-neutral-500 focus:outline-none"
                            />
                            <div class="grid gap-2 sm:grid-cols-2">
                              <select
                                data-testid={`edit-album-${item.id}`}
                                value={editDraft.value.albumId}
                                onChange={(e: Event) => {
                                  if (!editDraft.value) return;
                                  editDraft.value = {
                                    ...editDraft.value,
                                    albumId: (e.target as HTMLSelectElement).value,
                                  };
                                }}
                                class="rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-xs text-white"
                              >
                                <option value="">미분류</option>
                                {props.albums.map((album) => (
                                  <option key={album.id} value={album.id}>
                                    {album.name}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="text"
                                data-testid={`edit-tags-${item.id}`}
                                value={editDraft.value.tagsText}
                                onInput={(e: Event) => {
                                  if (!editDraft.value) return;
                                  editDraft.value = {
                                    ...editDraft.value,
                                    tagsText: (e.target as HTMLInputElement).value,
                                  };
                                }}
                                placeholder="태그 (쉼표 구분)"
                                class="rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-xs text-white"
                              />
                            </div>
                          </div>
                        ) : (
                          <div>
                            <p class="font-medium text-white">
                              {item.caption || <span class="text-neutral-500">(캡션 없음)</span>}
                            </p>
                            <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                              <span class="rounded bg-neutral-800 px-2 py-0.5 text-neutral-300">
                                {item.albumName ?? '미분류'}
                              </span>
                              {item.tags.map((tag) => (
                                <span
                                  key={tag}
                                  class="rounded bg-sky-950/70 px-2 py-0.5 text-sky-300"
                                >
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </td>

                      <td class="whitespace-nowrap px-3 py-3 text-xs text-neutral-300">
                        {isEditing && editDraft.value ? (
                          <input
                            type="datetime-local"
                            data-testid={`edit-taken-at-${item.id}`}
                            value={editDraft.value.takenAtLocal}
                            onInput={(e: Event) => {
                              if (!editDraft.value) return;
                              editDraft.value = {
                                ...editDraft.value,
                                takenAtLocal: (e.target as HTMLInputElement).value,
                              };
                            }}
                            class="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-white"
                          />
                        ) : (
                          <div>
                            <div>{formatDateTime(item.takenAt)}</div>
                            <div class="mt-0.5 text-[11px] text-neutral-500">
                              {item.hasExifDate ? 'EXIF 촬영일' : '업로드 시각'}
                            </div>
                          </div>
                        )}
                      </td>

                      <td class="whitespace-nowrap px-3 py-3 text-right">
                        {isEditing ? (
                          <div class="flex justify-end gap-1.5">
                            <button
                              type="button"
                              disabled={savingEdit.value}
                              data-testid={`save-edit-${item.id}`}
                              onClick={() => void saveEdit()}
                              class="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-neutral-200 disabled:opacity-50"
                            >
                              {savingEdit.value ? '저장 중...' : '저장'}
                            </button>
                            <button
                              type="button"
                              disabled={savingEdit.value}
                              onClick={cancelEdit}
                              class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:text-white"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <div class="flex justify-end gap-1.5">
                            <button
                              type="button"
                              data-testid={`edit-image-${item.id}`}
                              onClick={() => startEdit(item)}
                              class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700"
                            >
                              편집
                            </button>
                            <button
                              type="button"
                              data-testid={`delete-image-${item.id}`}
                              onClick={() => requestSingleDelete(item)}
                              class="rounded-lg border border-rose-800/60 bg-rose-950/50 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-900/60"
                            >
                              삭제
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div class="flex items-center justify-between text-xs text-neutral-400">
          <span>
            전체 {total.value.toLocaleString()}건 중 {total.value === 0 ? 0 : offset.value + 1}–
            {Math.min(offset.value + items.value.length, total.value)}건 표시
          </span>
          <div class="flex items-center gap-2">
            <button
              type="button"
              disabled={!hasPrev || loading.value}
              onClick={() => void loadImages(Math.max(0, offset.value - pageSize.value))}
              class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-neutral-200 hover:bg-neutral-800 disabled:opacity-40"
            >
              이전
            </button>
            <button
              type="button"
              disabled={!hasNext || loading.value}
              onClick={() => void loadImages(offset.value + pageSize.value)}
              class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-neutral-200 hover:bg-neutral-800 disabled:opacity-40"
            >
              다음
            </button>
          </div>
        </div>

        <ConfirmModal
          open={deleteModal.value !== null}
          title={deleteModal.value?.mode === 'bulk' ? '선택 이미지 일괄 삭제' : '이미지 삭제'}
          message={
            deleteModal.value
              ? `${deleteModal.value.label}을(를) 영구 삭제합니다.\nR2 저장소 파일(표시용·썸네일)과 메타데이터가 함께 제거되며 복구할 수 없습니다.`
              : ''
          }
          confirmLabel="영구 삭제"
          busy={deleting.value}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            deleteModal.value = null;
          }}
        />
      </section>
    );
  };
});
