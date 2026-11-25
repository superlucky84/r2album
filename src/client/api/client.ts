import type { ApiErrorBody } from '@/shared/types';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(input, {
    credentials: 'same-origin',
    ...init,
  });

  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as Partial<ApiErrorBody>;
      if (data?.error?.code) code = data.error.code;
      if (data?.error?.message) message = data.error.message;
    } catch {
      // ignore non-JSON error body
    }
    throw new ApiClientError(res.status, code, message);
  }

  return (await res.json()) as T;
}
