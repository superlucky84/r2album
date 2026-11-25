// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from 'lithent/test';
import { screen } from '@testing-library/dom';
import { App } from '../App';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App smoke test', () => {
  it('renders r2album heading and transitions to API Connected on healthy response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, service: 'r2album', timestamp: 123456 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(<App />);
    expect(screen.getByRole('heading', { name: 'r2album' })).toBeTruthy();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('health-status').textContent).toContain('API Connected');
  });
});
