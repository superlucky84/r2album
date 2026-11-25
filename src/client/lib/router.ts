export type AppRoute = '/' | '/admin' | '/login';

export function normalizeRoute(pathname: string): AppRoute {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return '/admin';
  if (pathname === '/login' || pathname.startsWith('/login/')) return '/login';
  return '/';
}

export function getAuthErrorFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get('error');
}

export function getAuthStatusFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get('status');
}

export function navigateTo(path: string, replace = false): void {
  if (typeof window === 'undefined') return;
  const current = window.location.pathname + window.location.search;
  if (current === path) return;
  if (replace) {
    window.history.replaceState(null, '', path);
  } else {
    window.history.pushState(null, '', path);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}
