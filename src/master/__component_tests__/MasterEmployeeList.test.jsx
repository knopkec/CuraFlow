import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MasterEmployeeList from '@/master/pages/MasterEmployeeList';
import { renderWithProviders } from '@/test-utils/renderWithProviders';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  api: {
    request: mocks.apiRequest,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
    warning: mocks.toastWarning,
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

describe('MasterEmployeeList', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.navigate.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.toastInfo.mockReset();
    mocks.toastWarning.mockReset();
    vi.restoreAllMocks();
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  const setupDefaultMocks = () => {
    mocks.apiRequest.mockImplementation(async (url, options) => {
      if (url === '/api/admin/db-tokens') {
        return [{ id: 'tenant-1', name: 'Notaufnahme' }];
      }
      if (url === '/api/master/employees') {
        return {
          employees: [
            {
              id: 'employee-1',
              first_name: 'Max',
              last_name: 'Mustermann',
              is_active: true,
              assignments: [
                { tenant_id: 'tenant-1', tenant_doctor_id: 'doctor-1', tenant_name: 'Notaufnahme', fte_share: 1 },
              ],
            },
            {
              id: 'employee-2',
              first_name: 'Anna',
              last_name: 'Schmidt',
              is_active: true,
              assignments: [
                { tenant_id: 'tenant-1', tenant_doctor_id: 'doctor-2', tenant_name: 'Notaufnahme', fte_share: 1 },
              ],
            },
          ],
        };
      }
      if (url === '/api/master/staff') {
        return { staff: [] };
      }
      if (url === '/api/master/payscale-tariffs') {
        return {
          tariffs: [
            {
              id: 'tariff-1',
              name: 'TVöD Ärzte',
              short_name: 'TV-Ärzte',
              default_weekly_hours: 42,
              default_vacation_days: 31,
            },
            {
              id: 'tariff-2',
              name: 'TVöD Pflege',
              short_name: 'TV-P',
              default_weekly_hours: 38.5,
              default_vacation_days: 30,
            },
          ],
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
  };

  it('opens the tariff dialog when clicking the Tarifvertrag button', async () => {
    const user = userEvent.setup();
    setupDefaultMocks();

    renderWithProviders(<MasterEmployeeList />, { withAuthProvider: false, withToaster: false, route: '/mitarbeiter' });

    const tariffButton = await screen.findByRole('button', { name: /tarifvertrag anwenden/i });
    await waitFor(() => expect(tariffButton).toBeEnabled());

    await user.click(tariffButton);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Tarifvertrag auf alle angezeigten Mitarbeiter anwenden')).toBeInTheDocument();

    // Open the select dropdown (options render in a portal, not inside dialog)
    const selectTrigger = within(dialog).getByRole('combobox');
    await user.click(selectTrigger);

    expect(screen.getByRole('option', { name: /TVöD Ärzte/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /TVöD Pflege/ })).toBeInTheDocument();
  });

  it('shows tariff details and affected employee count when a tariff is selected', async () => {
    const user = userEvent.setup();
    setupDefaultMocks();

    renderWithProviders(<MasterEmployeeList />, { withAuthProvider: false, withToaster: false, route: '/mitarbeiter' });

    const tariffButton = await screen.findByRole('button', { name: /tarifvertrag anwenden/i });
    await user.click(tariffButton);

    const dialog = await screen.findByRole('dialog');
    const selectTrigger = within(dialog).getByRole('combobox');
    await user.click(selectTrigger);

    const option = await screen.findByRole('option', { name: /TVöD Ärzte/ });
    await user.click(option);

    await waitFor(() => {
      expect(within(dialog).getByText('TVöD Ärzte')).toBeInTheDocument();
      expect(within(dialog).getByText('42h')).toBeInTheDocument();
      expect(within(dialog).getByText('31 Tage')).toBeInTheDocument();
      expect(within(dialog).getByText('2 aktive Mitarbeiter')).toBeInTheDocument();
    });
  });

  it('applies the selected tariff to all active employees', async () => {
    const user = userEvent.setup();
    window.confirm = vi.fn(() => true);
    setupDefaultMocks();

    renderWithProviders(<MasterEmployeeList />, { withAuthProvider: false, withToaster: false, route: '/mitarbeiter' });

    const tariffButton = await screen.findByRole('button', { name: /tarifvertrag anwenden/i });
    await user.click(tariffButton);

    const dialog = await screen.findByRole('dialog');
    const selectTrigger = within(dialog).getByRole('combobox');
    await user.click(selectTrigger);

    const option = await screen.findByRole('option', { name: /TVöD Ärzte/ });
    await user.click(option);

    // Override mock for the bulk-apply call
    mocks.apiRequest.mockImplementation(async (url, options) => {
      if (url === '/api/admin/db-tokens') return [{ id: 'tenant-1', name: 'Notaufnahme' }];
      if (url === '/api/master/employees') {
        return {
          employees: [
            { id: 'employee-1', first_name: 'Max', last_name: 'Mustermann', is_active: true, assignments: [{ tenant_id: 'tenant-1', tenant_doctor_id: 'doctor-1', tenant_name: 'Notaufnahme', fte_share: 1 }] },
            { id: 'employee-2', first_name: 'Anna', last_name: 'Schmidt', is_active: true, assignments: [{ tenant_id: 'tenant-1', tenant_doctor_id: 'doctor-2', tenant_name: 'Notaufnahme', fte_share: 1 }] },
          ],
        };
      }
      if (url === '/api/master/staff') return { staff: [] };
      if (url === '/api/master/payscale-tariffs') {
        return { tariffs: [{ id: 'tariff-1', name: 'TVöD Ärzte', short_name: 'TV-Ärzte', default_weekly_hours: 42, default_vacation_days: 31 }] };
      }
      if (url === '/api/master/employees/bulk-apply-tariff') {
        const body = JSON.parse(options.body);
        expect(body.tariff_id).toBe('tariff-1');
        expect(body.employee_ids).toEqual(['employee-1', 'employee-2']);
        return { tariff: { id: 'tariff-1', name: 'TVöD Ärzte' }, updated: 2, syncedTenants: 1 };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const applyButton = within(dialog).getByRole('button', { name: /anwenden/i });
    await user.click(applyButton);

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Tarifvertrag "TVöD Ärzte" auf 2 Mitarbeiter angewandt, 1 Mandanten sync.'
      );
    });
  });

  it('disables the apply button when no tariff is selected', async () => {
    const user = userEvent.setup();
    setupDefaultMocks();

    renderWithProviders(<MasterEmployeeList />, { withAuthProvider: false, withToaster: false, route: '/mitarbeiter' });

    const tariffButton = await screen.findByRole('button', { name: /tarifvertrag anwenden/i });
    await user.click(tariffButton);

    const dialog = await screen.findByRole('dialog');
    const applyButton = within(dialog).getByRole('button', { name: /anwenden/i });
    expect(applyButton).toBeDisabled();
  });

  it('closes the tariff dialog when clicking Abbrechen', async () => {
    const user = userEvent.setup();
    setupDefaultMocks();

    renderWithProviders(<MasterEmployeeList />, { withAuthProvider: false, withToaster: false, route: '/mitarbeiter' });

    const tariffButton = await screen.findByRole('button', { name: /tarifvertrag anwenden/i });
    await user.click(tariffButton);

    const dialog = await screen.findByRole('dialog');
    const cancelButton = within(dialog).getByRole('button', { name: /abbrechen/i });
    await user.click(cancelButton);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});