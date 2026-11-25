// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'lithent/test';
import { screen } from '@testing-library/dom';
import { LoginView } from '../components/LoginView';

afterEach(() => {
  cleanup();
});

describe('LoginView component', () => {
  it('renders Google login link without notice or error banner by default', () => {
    render(<LoginView errorCode={null} statusCode={null} />);

    const link = screen.getByTestId('google-login-button') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/auth/google');
    expect(screen.queryByTestId('login-error')).toBeNull();
    expect(screen.queryByTestId('login-notice')).toBeNull();
  });

  it('displays pending approval notice when statusCode is pending', () => {
    render(<LoginView errorCode={null} statusCode="pending" />);

    const notice = screen.getByTestId('login-notice');
    expect(notice.textContent).toContain('관리자 승인 대기 중');
  });

  it('displays rejection alert when errorCode is rejected', () => {
    render(<LoginView errorCode="rejected" statusCode={null} />);

    const alert = screen.getByTestId('login-error');
    expect(alert.textContent).toContain('가입 신청이 거절된 계정');
  });
});
