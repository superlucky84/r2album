import { mount, mountCallback } from 'lithent';
import { state } from 'lithent/helper';
import type { AllowedUserRecord, UserRole } from '@/shared/types';
import {
  createAdminUser,
  deleteAdminUser,
  fetchAdminUsers,
  updateAdminUser,
} from '@/client/api/admin';
import { formatDateTime } from '@/client/lib/format';
import { ConfirmModal } from './ConfirmModal';

export interface UserAllowlistManagerProps {
  onUsersChanged?: () => void;
}

export const UserAllowlistManager = mount<UserAllowlistManagerProps>((renew, initialProps) => {
  let latestProps = initialProps;

  const users = state<AllowedUserRecord[]>([], renew);
  const loading = state<boolean>(false, renew);
  const errorMessage = state<string | null>(null, renew);
  const busyEmail = state<string | null>(null, renew);

  const newEmail = state<string>('', renew);
  const newName = state<string>('', renew);
  const newRole = state<UserRole>('viewer', renew);
  const newNote = state<string>('', renew);
  const submitting = state<boolean>(false, renew);

  const deleteTarget = state<AllowedUserRecord | null>(null, renew);
  const deleting = state<boolean>(false, renew);

  const loadUsers = async () => {
    loading.value = true;
    errorMessage.value = null;
    try {
      const res = await fetchAdminUsers();
      users.value = res.users;
    } catch (err: unknown) {
      errorMessage.value =
        err instanceof Error ? err.message : '사용자 목록을 불러오지 못했습니다.';
    } finally {
      loading.value = false;
    }
  };

  mountCallback(() => {
    void loadUsers();
  });

  const handleCreateUser = async (e: Event) => {
    e.preventDefault();
    const email = newEmail.value.trim().toLowerCase();
    if (!email) {
      errorMessage.value = '이메일 주소를 입력해 주세요.';
      return;
    }

    submitting.value = true;
    errorMessage.value = null;
    try {
      await createAdminUser({
        email,
        name: newName.value.trim(),
        role: newRole.value,
        note: newNote.value.trim(),
      });
      newEmail.value = '';
      newName.value = '';
      newRole.value = 'viewer';
      newNote.value = '';
      await loadUsers();
      latestProps.onUsersChanged?.();
    } catch (err: unknown) {
      errorMessage.value = err instanceof Error ? err.message : '사용자 등록에 실패했습니다.';
    } finally {
      submitting.value = false;
    }
  };

  const handleUpdateUser = async (
    email: string,
    patch: { role?: UserRole; status?: 'approved' | 'rejected' }
  ) => {
    busyEmail.value = email;
    errorMessage.value = null;
    try {
      const updated = await updateAdminUser(email, patch);
      users.value = users.value.map((u) => (u.email === email ? updated : u));
      latestProps.onUsersChanged?.();
    } catch (err: unknown) {
      errorMessage.value = err instanceof Error ? err.message : '사용자 상태 변경에 실패했습니다.';
    } finally {
      busyEmail.value = null;
    }
  };

  const handleConfirmDelete = async () => {
    const target = deleteTarget.value;
    if (!target || deleting.value) return;

    deleting.value = true;
    errorMessage.value = null;
    try {
      await deleteAdminUser(target.email);
      users.value = users.value.filter((u) => u.email !== target.email);
      deleteTarget.value = null;
      latestProps.onUsersChanged?.();
    } catch (err: unknown) {
      errorMessage.value = err instanceof Error ? err.message : '사용자 삭제에 실패했습니다.';
      deleteTarget.value = null;
    } finally {
      deleting.value = false;
    }
  };

  return (props) => {
    latestProps = props;
    const pendingUsers = users.value.filter((u) => u.status === 'pending');
    const managedUsers = users.value.filter((u) => u.status !== 'pending');

    return (
      <section data-testid="user-allowlist-manager" class="space-y-6">
        {errorMessage.value && (
          <div
            role="alert"
            data-testid="users-error"
            class="rounded-xl border border-rose-500/40 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
          >
            {errorMessage.value}
          </div>
        )}

        {/* Pending Approval Queue (DC-11) */}
        <div
          data-testid="pending-users-section"
          class="rounded-2xl border border-amber-500/30 bg-amber-950/15 p-5"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-semibold text-white">가입 승인 대기 목록</h3>
              <span
                data-testid="pending-users-count"
                class="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300"
              >
                {pendingUsers.length}명
              </span>
            </div>
            <button
              type="button"
              onClick={() => void loadUsers()}
              disabled={loading.value}
              class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs text-neutral-300 hover:text-white"
            >
              새로고침
            </button>
          </div>

          {pendingUsers.length === 0 ? (
            <p class="mt-3 text-xs text-neutral-400">현재 승인 대기 중인 계정이 없습니다.</p>
          ) : (
            <ul class="mt-4 divide-y divide-amber-500/20">
              {pendingUsers.map((user) => {
                const isBusy = busyEmail.value === user.email;
                return (
                  <li
                    key={user.email}
                    data-testid={`pending-user-${user.email}`}
                    class="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <div class="text-sm font-medium text-white">
                        {user.name || '(이름 없음)'}{' '}
                        <span class="font-normal text-neutral-300">{user.email}</span>
                      </div>
                      <div class="mt-0.5 text-xs text-neutral-400">
                        신청 시각: {formatDateTime(user.createdAt)}
                      </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        data-testid={`approve-viewer-${user.email}`}
                        onClick={() =>
                          void handleUpdateUser(user.email, {
                            status: 'approved',
                            role: 'viewer',
                          })
                        }
                        class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        Viewer로 승인
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        data-testid={`approve-admin-${user.email}`}
                        onClick={() =>
                          void handleUpdateUser(user.email, {
                            status: 'approved',
                            role: 'admin',
                          })
                        }
                        class="rounded-lg border border-sky-500/40 bg-sky-950/60 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-900/60 disabled:opacity-50"
                      >
                        Admin으로 승인
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        data-testid={`reject-user-${user.email}`}
                        onClick={() => void handleUpdateUser(user.email, { status: 'rejected' })}
                        class="rounded-lg border border-rose-800/60 bg-rose-950/50 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-900/60 disabled:opacity-50"
                      >
                        거절
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Direct Pre-register Form */}
        <form
          onSubmit={(e: Event) => void handleCreateUser(e)}
          class="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5"
        >
          <h3 class="text-sm font-semibold text-white">허용 사용자 직접 등록</h3>
          <p class="mt-1 text-xs text-neutral-400">
            미리 등록한 Google 이메일은 가입 신청 절차 없이 즉시 로그인할 수 있습니다.
          </p>
          <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_auto_1fr_auto]">
            <input
              type="email"
              required
              data-testid="add-user-email"
              value={newEmail.value}
              onInput={(e: Event) => {
                newEmail.value = (e.target as HTMLInputElement).value;
              }}
              placeholder="family@gmail.com"
              class="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
            />
            <input
              type="text"
              data-testid="add-user-name"
              value={newName.value}
              onInput={(e: Event) => {
                newName.value = (e.target as HTMLInputElement).value;
              }}
              placeholder="이름 (선택)"
              class="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
            />
            <select
              aria-label="권한 선택"
              data-testid="add-user-role"
              value={newRole.value}
              onChange={(e: Event) => {
                newRole.value = (e.target as HTMLSelectElement).value as UserRole;
              }}
              class="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white"
            >
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
            <input
              type="text"
              data-testid="add-user-note"
              value={newNote.value}
              onInput={(e: Event) => {
                newNote.value = (e.target as HTMLInputElement).value;
              }}
              placeholder="메모 (선택)"
              class="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={submitting.value}
              data-testid="add-user-submit"
              class="rounded-xl bg-white px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-50"
            >
              {submitting.value ? '등록 중...' : '등록'}
            </button>
          </div>
        </form>

        {/* Approved & Rejected Users List */}
        <div class="overflow-x-auto rounded-2xl border border-neutral-800 bg-neutral-900/60">
          <table class="min-w-full divide-y divide-neutral-800 text-left text-sm">
            <thead class="bg-neutral-950/70 text-xs uppercase text-neutral-400">
              <tr>
                <th class="px-4 py-3">사용자</th>
                <th class="px-4 py-3">상태</th>
                <th class="px-4 py-3">권한</th>
                <th class="px-4 py-3">메모</th>
                <th class="px-4 py-3 text-right">작업</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-neutral-800/80">
              {loading.value && managedUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} class="px-4 py-8 text-center text-sm text-neutral-400">
                    사용자 목록을 불러오는 중...
                  </td>
                </tr>
              ) : managedUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} class="px-4 py-8 text-center text-sm text-neutral-400">
                    등록된 사용자가 없습니다.
                  </td>
                </tr>
              ) : (
                managedUsers.map((user) => {
                  const isBusy = busyEmail.value === user.email;
                  const isBootstrap = user.isBootstrapAdmin === true;

                  return (
                    <tr key={user.email} data-testid={`user-row-${user.email}`}>
                      <td class="px-4 py-3">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="font-medium text-white">{user.email}</span>
                          {isBootstrap && (
                            <span class="rounded bg-indigo-950 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300 border border-indigo-700/50">
                              Bootstrap Admin
                            </span>
                          )}
                        </div>
                        {user.name && <div class="text-xs text-neutral-400">{user.name}</div>}
                      </td>
                      <td class="px-4 py-3">
                        <span
                          class={
                            user.status === 'approved'
                              ? 'inline-flex rounded-full border border-emerald-700/50 bg-emerald-950 px-2 py-0.5 text-xs text-emerald-300'
                              : 'inline-flex rounded-full border border-rose-700/50 bg-rose-950 px-2 py-0.5 text-xs text-rose-300'
                          }
                        >
                          {user.status === 'approved' ? '승인됨' : '거절됨'}
                        </span>
                      </td>
                      <td class="px-4 py-3">
                        <select
                          aria-label={`${user.email} 권한`}
                          data-testid={`user-role-${user.email}`}
                          value={user.role}
                          disabled={isBootstrap || isBusy}
                          onChange={(e: Event) =>
                            void handleUpdateUser(user.email, {
                              role: (e.target as HTMLSelectElement).value as UserRole,
                            })
                          }
                          class="rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-xs text-white disabled:opacity-50"
                        >
                          <option value="viewer">viewer</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td class="px-4 py-3 text-xs text-neutral-400">{user.note || '-'}</td>
                      <td class="whitespace-nowrap px-4 py-3 text-right">
                        <div class="flex justify-end gap-1.5">
                          {user.status === 'rejected' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              data-testid={`reapprove-user-${user.email}`}
                              onClick={() =>
                                void handleUpdateUser(user.email, { status: 'approved' })
                              }
                              class="rounded-lg border border-emerald-700/60 bg-emerald-950/60 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-900/60 disabled:opacity-50"
                            >
                              승인으로 변경
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isBootstrap || isBusy}
                            data-testid={`delete-user-${user.email}`}
                            onClick={() => {
                              deleteTarget.value = user;
                            }}
                            class="rounded-lg border border-rose-800/60 bg-rose-950/50 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-900/60 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <ConfirmModal
          open={deleteTarget.value !== null}
          title="사용자 삭제"
          message={
            deleteTarget.value
              ? `${deleteTarget.value.email} 계정을 허용 목록에서 삭제하시겠습니까?\n삭제 즉시 해당 사용자의 세션 접근이 차단됩니다.`
              : ''
          }
          confirmLabel="사용자 삭제"
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
