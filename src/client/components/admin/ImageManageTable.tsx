import { mount, mountCallback } from 'lithent';
import { state } from 'lithent/helper';
import { BULK_DELETE_MAX, CAPTION_MAX_LENGTH, CHUNK_SIZE } from '@/shared/constants';
import type { AlbumSummary, ImageItem, TagSummary } from '@/shared/types';
import {
  bulkDeleteAdminImages,
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
  const filterAlbumId = state<string>('', renew);
  const filterTag = state<string>('', renew);
  const searchQuery = state<string>('', renew);
  const loading = state<boolean>(false, renew);
  const errorMessage = state<string | null>(null, renew);
  const selectedIds = state<string[]>([], renew);

  const editDraft = state<EditDraft | null>(null, renew);
  const savingEdit = state<boolean>(false, renew);
  const deleteModal = state<DeleteModalState | null>(null, renew);
  const deleting = state<boolean>(false, renew);

  const loadImages = async (nextOffset = offset.value) => {
    const seq = ++requestSeq;
    loading.value = true;
    errorMessage.value = null;

    try {
      const res = await fetchImages({
        offset: nextOffset,
        limit: CHUNK_SIZE,
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
    void loadImages(0);
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
          ? Math.max(0, offset.value - CHUNK_SIZE)
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
    const hasNext = offset.value + CHUNK_SIZE < total.value;

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
              onClick={() => void loadImages(Math.max(0, offset.value - CHUNK_SIZE))}
              class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-neutral-200 hover:bg-neutral-800 disabled:opacity-40"
            >
              이전
            </button>
            <button
              type="button"
              disabled={!hasNext || loading.value}
              onClick={() => void loadImages(offset.value + CHUNK_SIZE)}
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
