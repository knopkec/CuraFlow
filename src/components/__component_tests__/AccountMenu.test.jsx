import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import AccountMenu from '@/components/auth/AccountMenu';

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      full_name: 'Demo Admin',
      email: 'demo-admin@curaflow.local',
    },
    logout: vi.fn(),
  }),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }) => <button type="button" {...props}>{children}</button>,
  DropdownMenuLabel: ({ children }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }) => <button type="button" {...props}>{children}</button>,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }) => <>{children}</>,
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogDescription: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props) => <input {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }) => <label {...props}>{children}</label>,
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('@/api/client', () => ({
  api: {
    changePassword: vi.fn(),
    changeEmail: vi.fn(),
  },
}));

describe('AccountMenu', () => {
  afterEach(() => {
    delete globalThis.__CURAFLOW_BUILD_INFO__;
  });

  it('shows the live build short hash in the account menu when build info is available', () => {
    globalThis.__CURAFLOW_BUILD_INFO__ = {
      commitSha: 'abc1234def5678',
      commitShortSha: 'abc1234',
    };

    render(<AccountMenu />);

    expect(screen.getByText('Build abc1234')).toBeInTheDocument();
  });

  it('omits the build row when no build info is available', () => {
    render(<AccountMenu />);

    expect(screen.queryByText(/Build /)).not.toBeInTheDocument();
  });
});
