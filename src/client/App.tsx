import { mount, mountCallback } from 'lithent';
import { state } from 'lithent/helper';
import type { AuthUser, MeResponse } from '@/shared/types';
import { apiFetch } from '@/client/api/client';
import {
  type AppRoute,
  getAuthErrorFromSearch,
  getAuthStatusFromSearch,
  navigateTo,
  normalizeRoute,
} from '@/client/lib/router';
import { LoginView } from '@/client/components/LoginView';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export const App = mount((renew) => {
  const authStatus = state<AuthStatus>('loading', renew);
  const currentUser = state<AuthUser | null>(null, renew);
  const route = state<AppRoute>(
    typeof window !== 'undefined' ? normalizeRoute(window.location.pathname) : '/',
    renew
  );
  const loginError = state<string | null>(
    typeof window !== 'undefined' ? getAuthErrorFromSearch(window.location.search) : null,
    renew
  );
  const loginStatus = state<string | null>(
    typeof window !== 'undefined' ? getAuthStatusFromSearch(window.location.search) : null,
    renew
  );
  const loggingOut = state<boolean>(false, renew);

  const syncLocation = () => {
    if (typeof window === 'undefined') return;
    const nextRoute = normalizeRoute(window.location.pathname);
    const nextError = getAuthErrorFromSearch(window.location.search);
    const nextStatus = getAuthStatusFromSearch(window.location.search);

    if (authStatus.value === 'authenticated') {
      if (nextRoute === '/login') {
        navigateTo('/', true);
        return;
      }
      if (nextRoute === '/admin' && currentUser.value?.role !== 'admin') {
        navigateTo('/', true);
        return;
      }
    }

    route.value = nextRoute;
    loginError.value = nextError;
    loginStatus.value = nextStatus;
  };

  const handleGoGallery = (e: Event) => {
    e.preventDefault();
    navigateTo('/');
  };

  const handleGoAdmin = (e: Event) => {
    e.preventDefault();
    if (currentUser.value?.role === 'admin') {
      navigateTo('/admin');
    }
  };

  const handleLogout = () => {
    if (loggingOut.value) return;
    loggingOut.value = true;
    void apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' })
      .catch(() => undefined)
      .finally(() => {
        loggingOut.value = false;
        currentUser.value = null;
        authStatus.value = 'unauthenticated';
        loginError.value = null;
        loginStatus.value = null;
        navigateTo('/login', true);
      });
  };

  mountCallback(() => {
    const controller = new AbortController();
    window.addEventListener('popstate', syncLocation);

    apiFetch<MeResponse>('/api/me', { signal: controller.signal })
      .then((res) => {
        if (res.authenticated) {
          currentUser.value = res.user;
          authStatus.value = 'authenticated';
          syncLocation();
        } else {
          currentUser.value = null;
          authStatus.value = 'unauthenticated';
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        currentUser.value = null;
        authStatus.value = 'unauthenticated';
      });

    return () => {
      controller.abort();
      window.removeEventListener('popstate', syncLocation);
    };
  });

  return () => {
    if (authStatus.value === 'loading') {
      return (
        <main class="min-h-screen flex items-center justify-center bg-neutral-950 p-6">
          <div data-testid="auth-loading" class="flex items-center gap-3 text-sm text-neutral-400">
            <span class="h-2.5 w-2.5 rounded-full bg-neutral-400 animate-pulse" />
            <span>세션을 확인하는 중...</span>
          </div>
        </main>
      );
    }

    if (authStatus.value === 'unauthenticated' || !currentUser.value) {
      return <LoginView errorCode={loginError.value} statusCode={loginStatus.value} />;
    }

    const user = currentUser.value;
    const isAdmin = user.role === 'admin';
    const activeRoute = route.value === '/admin' && isAdmin ? '/admin' : '/';

    return (
      <div class="min-h-screen bg-neutral-950 text-neutral-100">
        <header class="sticky top-0 z-20 border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur">
          <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
            <div class="flex items-center gap-6">
              <a
                href="/"
                onClick={handleGoGallery}
                class="text-lg font-semibold tracking-tight text-white"
              >
                r2album
              </a>
              <nav class="flex items-center gap-2 text-sm">
                <a
                  href="/"
                  onClick={handleGoGallery}
                  class={
                    activeRoute === '/'
                      ? 'rounded-lg bg-neutral-800 px-3 py-1.5 font-medium text-white'
                      : 'rounded-lg px-3 py-1.5 text-neutral-400 hover:text-white'
                  }
                >
                  갤러리
                </a>
                {isAdmin && (
                  <a
                    href="/admin"
                    onClick={handleGoAdmin}
                    data-testid="nav-admin-link"
                    class={
                      activeRoute === '/admin'
                        ? 'rounded-lg bg-neutral-800 px-3 py-1.5 font-medium text-white'
                        : 'rounded-lg px-3 py-1.5 text-neutral-400 hover:text-white'
                    }
                  >
                    관리자
                  </a>
                )}
              </nav>
            </div>

            <div class="flex items-center gap-3">
              <span
                data-testid="user-badge"
                class="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-300"
              >
                <span>{user.name}</span>
                <span class="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">
                  {user.role}
                </span>
              </span>
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut.value}
                data-testid="logout-button"
                class="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:border-neutral-700 hover:text-white disabled:opacity-50"
              >
                로그아웃
              </button>
            </div>
          </div>
        </header>

        <main class="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          {activeRoute === '/admin' ? (
            <section
              data-testid="admin-view"
              class="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8"
            >
              <h2 class="text-xl font-semibold text-white">관리자 페이지</h2>
              <p class="mt-2 text-sm text-neutral-400">
                이미지 업로드, 메타데이터 편집 및 허용 사용자 관리 기능이 Phase 4에서 연결됩니다.
              </p>
            </section>
          ) : (
            <section
              data-testid="gallery-view"
              class="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8"
            >
              <h2 class="text-xl font-semibold text-white">갤러리</h2>
              <p class="mt-2 text-sm text-neutral-400">
                가상 스크롤 썸네일 그리드 및 전체화면 액자 롤링 모드가 Phase 5~6에서 연결됩니다.
              </p>
            </section>
          )}
        </main>
      </div>
    );
  };
});
