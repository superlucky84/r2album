import { lmount } from 'lithent';

interface LoginViewProps {
  errorCode: string | null;
  statusCode?: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: '접근 권한이 없는 Google 계정입니다. 관리자에게 이메일 허용 등록을 요청해 주세요.',
  rejected: '가입 신청이 거절된 계정입니다. 자세한 내용은 관리자에게 문의해 주세요.',
  signup_closed: '현재 가입 승인 대기 인원이 가득 차서 새 신청을 받을 수 없습니다.',
  invalid_state: '로그인 인증 상태가 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.',
  unverified_email: '이메일 인증이 완료되지 않은 Google 계정입니다.',
  oauth_denied: 'Google 로그인이 취소되었습니다.',
  oauth_failed: 'Google 로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
};

const STATUS_MESSAGES: Record<string, string> = {
  pending:
    '가입 신청이 접수되어 관리자 승인 대기 중입니다. 관리자가 승인한 뒤 다시 Google 로그인을 눌러주세요.',
};

export const LoginView = lmount<LoginViewProps>(() => {
  return ({ errorCode, statusCode = null }) => {
    const noticeMessage = statusCode ? (STATUS_MESSAGES[statusCode] ?? null) : null;
    const errorMessage = errorCode
      ? (ERROR_MESSAGES[errorCode] ?? '로그인에 실패했습니다. 다시 시도해 주세요.')
      : null;

    return (
      <main class="min-h-screen flex items-center justify-center bg-neutral-950 p-6">
        <section class="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/90 p-8 shadow-2xl">
          <div class="text-center">
            <h1 class="text-2xl font-semibold tracking-tight text-white">r2album</h1>
            <p class="mt-2 text-sm text-neutral-400">
              허가된 가족·지인만 이용할 수 있는 프라이빗 클라우드 앨범입니다.
            </p>
          </div>

          {noticeMessage && (
            <div
              role="status"
              data-testid="login-notice"
              class="mt-6 rounded-xl border border-amber-500/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-200"
            >
              {noticeMessage}
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              data-testid="login-error"
              class="mt-6 rounded-xl border border-rose-500/40 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
            >
              {errorMessage}
            </div>
          )}

          <div class="mt-7">
            <a
              href="/auth/google"
              data-testid="google-login-button"
              class="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200"
            >
              <span>Google 계정으로 로그인 / 가입 신청</span>
            </a>
          </div>

          <p class="mt-5 text-center text-xs text-neutral-500">
            처음 로그인하는 계정은 자동으로 가입 신청되며, 관리자 승인 후 이용할 수 있습니다.
          </p>
        </section>
      </main>
    );
  };
});
