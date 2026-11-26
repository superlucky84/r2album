import { lmount } from 'lithent';

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal = lmount<ConfirmModalProps>(() => {
  return ({
    open,
    title,
    message,
    confirmLabel = '삭제',
    cancelLabel = '취소',
    busy = false,
    onConfirm,
    onCancel,
  }) => {
    if (!open) return null;

    return (
      <div
        role="dialog"
        aria-modal="true"
        data-testid="confirm-modal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      >
        <div class="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
          <h3 class="text-lg font-semibold text-white">{title}</h3>
          <p class="mt-2 whitespace-pre-line text-sm text-neutral-300">{message}</p>
          <div class="mt-6 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              data-testid="confirm-modal-cancel"
              class="rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700 disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              data-testid="confirm-modal-confirm"
              class="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-500 disabled:opacity-50"
            >
              {busy ? '처리 중...' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    );
  };
});
