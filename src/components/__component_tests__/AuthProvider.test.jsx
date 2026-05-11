import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { useAuth } from '@/components/AuthProvider';
import { renderWithProviders } from '@/test-utils/renderWithProviders';
import { createAuthHandlers, server } from '@/test-utils/server';

function AuthProbe() {
  const { isAuthenticated, isLoading, isReadOnly, user } = useAuth();

  if (isLoading) {
    return <div>loading</div>;
  }

  return (
    <div>
      <div>{isAuthenticated ? 'authenticated' : 'anonymous'}</div>
      <div>{user?.email ?? 'no-email'}</div>
      <div>{user?.role ?? 'no-role'}</div>
      <div>{isReadOnly ? 'read-only' : 'full-access'}</div>
    </div>
  );
}

describe('AuthProvider', () => {
  it('hydrates the authenticated user when a stored token is still valid', async () => {
    localStorage.setItem('radioplan_jwt_token', 'stored-test-token');

    server.use(
      ...createAuthHandlers({
        user: {
          id: 'user-admin',
          email: 'admin@test.local',
          role: 'admin',
          must_change_password: false,
        },
      })
    );

    renderWithProviders(<AuthProbe />);

    expect(await screen.findByText('authenticated')).toBeInTheDocument();
    expect(screen.getByText('admin@test.local')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('full-access')).toBeInTheDocument();
  });
});
