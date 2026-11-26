import { mount } from 'lithent';
import { state } from 'lithent/helper';
import { ALBUM_NAME_MAX_LENGTH } from '@/shared/constants';
import type { AlbumSummary } from '@/shared/types';
import { createAdminAlbum, deleteAdminAlbum, updateAdminAlbum } from '@/client/api/admin';
import { ConfirmModal } from './ConfirmModal';

export interface AlbumManagerProps {
  albums: AlbumSummary[];
  onAlbumsChanged: () => void;
}

interface AlbumEditDraft {
  id: string;
  name: string;
  description: string;
}

export const AlbumManager = mount<AlbumManagerProps>((renew, initialProps) => {
  let latestProps = initialProps;

  const newName = state<string>('', renew);
  const newDescription = state<string>('', renew);
  const creating = state<boolean>(false, renew);
  const errorMessage = state<string | null>(null, renew);
  const editDraft = state<AlbumEditDraft | null>(null, renew);
  const savingEdit = state<boolean>(false, renew);
  const deleteTarget = state<AlbumSummary | null>(null, renew);
  const deleting = state<boolean>(false, renew);

  const handleCreate = async (e: Event) => {
    e.preventDefault();
    const trimmed = newName.value.trim();
    if (!trimmed) {
      errorMessage.value = '앨범 이름을 입력해 주세요.';
      return;
    }

    creating.value = true;
    errorMessage.value = null;
    try {
      await createAdminAlbum({
        name: trimmed,
        description: newDescription.value.trim(),
      });
      newName.value = '';
      newDescription.value = '';
      latestProps.onAlbumsChanged();
    } catch (err: unknown) {
      errorMessage.value = err instanceof Error ? err.message : '앨범 생성에 실패했습니다.';
    } finally {
      creating.value = false;
    }
  };

  const handleSaveEdit = async () => {
    const draft = editDraft.value;
    if (!draft || savingEdit.value) return;

    const trimmed = draft.name.trim();
    if (!trimmed) {
      errorMessage.value = '앨범 이름을 입력해 주세요.';
      return;
    }

    savingEdit.value = true;
    errorMessage.value = null;
    try {
      await updateAdminAlbum(draft.id, {
        name: trimmed,
        description: draft.description.trim(),
      });
      editDraft.value = null;
      latestProps.onAlbumsChanged();
    } catch (err: unknown) {
      errorMessage.value = err instanceof Error ? err.message : '앨범 수정에 실패했습니다.';
    } finally {
      savingEdit.value = false;
    }
  };

  const handleConfirmDelete = async () => {
    const target = deleteTarget.value;
    if (!target || deleting.value) return;

    deleting.value = true;
    errorMessage.value = null;
    try {
      await deleteAdminAlbum(target.id);
      deleteTarget.value = null;
      if (editDraft.value?.id === target.id) {
        editDraft.value = null;
      }
      latestProps.onAlbumsChanged();
    } catch (err: unknown) {
      errorMessage.value = err instanceof Error ? err.message : '앨범 삭제에 실패했습니다.';
      deleteTarget.value = null;
    } finally {
      deleting.value = false;
    }
  };

  return (props) => {
    latestProps = props;

    return (
      <section data-testid="album-manager" class="space-y-5">
        <form
          onSubmit={(e: Event) => void handleCreate(e)}
          class="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5"
        >
          <h3 class="text-sm font-semibold text-white">새 앨범 만들기</h3>
          <div class="mt-3 grid gap-3 sm:grid-cols-[1fr_1.5fr_auto]">
            <input
              type="text"
              maxLength={ALBUM_NAME_MAX_LENGTH}
              data-testid="album-name-input"
              value={newName.value}
              onInput={(e: Event) => {
                newName.value = (e.target as HTMLInputElement).value;
              }}
              placeholder="앨범 이름 (예: 제주 여행)"
              class="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
            />
            <input
              type="text"
              maxLength={300}
              data-testid="album-desc-input"
              value={newDescription.value}
              onInput={(e: Event) => {
                newDescription.value = (e.target as HTMLInputElement).value;
              }}
              placeholder="설명 (선택)"
              class="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={creating.value}
              data-testid="album-create-submit"
              class="rounded-xl bg-white px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-50"
            >
              {creating.value ? '생성 중...' : '앨범 추가'}
            </button>
          </div>
        </form>

        {errorMessage.value && (
          <div
            role="alert"
            data-testid="album-error"
            class="rounded-xl border border-rose-500/40 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
          >
            {errorMessage.value}
          </div>
        )}

        <div class="rounded-2xl border border-neutral-800 bg-neutral-900/60">
          {props.albums.length === 0 ? (
            <p class="p-8 text-center text-sm text-neutral-400">
              아직 생성된 앨범이 없습니다. 위에서 첫 앨범을 추가해 보세요.
            </p>
          ) : (
            <ul class="divide-y divide-neutral-800/80">
              {props.albums.map((album) => {
                const isEditing = editDraft.value?.id === album.id;

                return (
                  <li
                    key={album.id}
                    data-testid={`album-item-${album.id}`}
                    class="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                  >
                    {isEditing && editDraft.value ? (
                      <div class="flex flex-1 flex-wrap items-center gap-2">
                        <input
                          type="text"
                          maxLength={ALBUM_NAME_MAX_LENGTH}
                          data-testid={`album-edit-name-${album.id}`}
                          value={editDraft.value.name}
                          onInput={(e: Event) => {
                            if (!editDraft.value) return;
                            editDraft.value = {
                              ...editDraft.value,
                              name: (e.target as HTMLInputElement).value,
                            };
                          }}
                          class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-white"
                        />
                        <input
                          type="text"
                          maxLength={300}
                          data-testid={`album-edit-desc-${album.id}`}
                          value={editDraft.value.description}
                          onInput={(e: Event) => {
                            if (!editDraft.value) return;
                            editDraft.value = {
                              ...editDraft.value,
                              description: (e.target as HTMLInputElement).value,
                            };
                          }}
                          placeholder="설명"
                          class="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-white"
                        />
                        <button
                          type="button"
                          disabled={savingEdit.value}
                          data-testid={`album-save-${album.id}`}
                          onClick={() => void handleSaveEdit()}
                          class="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-neutral-200 disabled:opacity-50"
                        >
                          저장
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            editDraft.value = null;
                          }}
                          class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <div class="flex items-center gap-2">
                            <span class="font-medium text-white">{album.name}</span>
                            <span class="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
                              {album.imageCount}장
                            </span>
                          </div>
                          {album.description && (
                            <p class="mt-0.5 text-xs text-neutral-400">{album.description}</p>
                          )}
                        </div>
                        <div class="flex items-center gap-1.5">
                          <button
                            type="button"
                            data-testid={`album-edit-${album.id}`}
                            onClick={() => {
                              editDraft.value = {
                                id: album.id,
                                name: album.name,
                                description: album.description,
                              };
                            }}
                            class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700"
                          >
                            편집
                          </button>
                          <button
                            type="button"
                            data-testid={`album-delete-${album.id}`}
                            onClick={() => {
                              deleteTarget.value = album;
                            }}
                            class="rounded-lg border border-rose-800/60 bg-rose-950/50 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-900/60"
                          >
                            삭제
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <ConfirmModal
          open={deleteTarget.value !== null}
          title="앨범 삭제"
          message={
            deleteTarget.value
              ? `"${deleteTarget.value.name}" 앨범을 삭제하시겠습니까?\n소속된 사진(${deleteTarget.value.imageCount}장)은 삭제되지 않고 '미분류' 상태로 유지됩니다.`
              : ''
          }
          confirmLabel="앨범 삭제"
          busy={deleting.value}
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => {
            deleteTarget.value = null;
          }}
        />
      </section>
    );
  };
});
