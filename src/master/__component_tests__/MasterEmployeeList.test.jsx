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
    vi.restoreAllMocks();
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  it('triggers linked absence migration from the master employee list', async () => {
    const user = userEvent.setup();
    window.confirm = vi.fn(() => true);

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
          ],
        };
      }
      if (url === '/api/master/staff') {
        return { staff: [] };
      }
      if (url === '/api/master/employees/migrate-linked-absences') {
        const body = JSON.parse(options.body);
        // The real migration fires first, then the component re-runs a dry-run
        // to refresh the remaining-work list. Distinguish the two by dry_run.
        if (body.dry_run) {
          return {
            totalAssignments: 1,
            migratedAssignments: 1,
            importedAbsences: 0,
            removedLocalAbsences: 0,
            failedAssignments: 0,
            results: [],
            dryRun: true,
          };
        }
        expect(body).toEqual({ tenant_id: null, purge_empty_dates: false, resolve_conflicts: false });
        return {
          totalAssignments: 1,
          migratedAssignments: 1,
          importedAbsences: 3,
          removedLocalAbsences: 5,
          purgedEmptyAbsences: 0,
          resolvedConflicts: 0,
          unresolvedConflicts: 0,
          failedAssignments: 0,
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    renderWithProviders(<MasterEmployeeList />, { withAuthProvider: false, withToaster: false, route: '/mitarbeiter' });

    const button = await screen.findByRole('button', { name: /verknüpfungen migrieren/i });
    await waitFor(() => expect(button).toBeEnabled());

    await user.click(button);

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/master/employees/migrate-linked-absences', {
        method: 'POST',
        body: JSON.stringify({ tenant_id: null, purge_empty_dates: false, resolve_conflicts: false }),
      });
    });

    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'Verknüpfungen geprüft: 1/1, 3 neu zentral, 5 lokal bereinigt'
    );
  });

  it('opens a dry-run report for linked absence migration', async () => {
    const user = userEvent.setup();

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
          ],
        };
      }
      if (url === '/api/master/staff') {
        return { staff: [] };
      }
      if (url === '/api/master/employees/migrate-linked-absences') {
        expect(options).toEqual({
          method: 'POST',
          body: JSON.stringify({ tenant_id: null, dry_run: true }),
        });
        return {
          dryRun: true,
          totalAssignments: 1,
          migratedAssignments: 1,
          importedAbsences: 2,
          existingCentralAbsences: 1,
          assignmentsNeedingAction: 1,
          failedAssignments: 0,
          results: [
            {
              tenant_id: 'tenant-1',
              tenant_name: 'Notaufnahme',
              employee_name: 'Max Mustermann',
              status: 'success',
              localAbsences: 3,
              imported: 2,
              existingCentral: 1,
              needsAction: true,
            },
          ],
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    renderWithProviders(<MasterEmployeeList />, { withAuthProvider: false, withToaster: false, route: '/mitarbeiter' });

    const button = await screen.findByRole('button', { name: /dry-run/i });
    await waitFor(() => expect(button).toBeEnabled());

    await user.click(button);

    expect(await screen.findByText('Dry-Run: Abwesenheitsmigration')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Notaufnahme')).toBeInTheDocument();
    expect(within(dialog).getByText('Max Mustermann')).toBeInTheDocument();
    expect(within(dialog).getByText('Würden importiert')).toBeInTheDocument();
    expect(within(dialog).getAllByText('2').length).toBeGreaterThan(0);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'Dry-Run fertig: 1 von 1 noch nicht migriert'
    );
  });

  it('exports the dry-run report as csv', async () => {
    const user = userEvent.setup();
    const createObjectUrlMock = vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:report');
    const revokeObjectUrlMock = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});

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
          ],
        };
      }
      if (url === '/api/master/staff') {
        return { staff: [] };
      }
      if (url === '/api/master/employees/migrate-linked-absences') {
        expect(options).toEqual({
          method: 'POST',
          body: JSON.stringify({ tenant_id: null, dry_run: true }),
        });
        return {
          dryRun: true,
          totalAssignments: 1,
          migratedAssignments: 1,
          importedAbsences: 2,
          existingCentralAbsences: 1,
          failedAssignments: 0,
          results: [
            {
              tenant_id: 'tenant-1',
              tenant_name: 'Notaufnahme',
              employee_name: 'Max Mustermann',
              employee_id: 'employee-1',
              tenant_doctor_id: 'doctor-1',
              status: 'success',
              localAbsences: 3,
              imported: 2,
              existingCentral: 1,
            },
          ],
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    renderWithProviders(<MasterEmployeeList />, { withAuthProvider: false, withToaster: false, route: '/mitarbeiter' });

    const dryRunButton = await screen.findByRole('button', { name: /dry-run/i });
    await waitFor(() => expect(dryRunButton).toBeEnabled());
    await user.click(dryRunButton);

    const dialog = await screen.findByRole('dialog');
    const exportButton = within(dialog).getByRole('button', { name: /report exportieren/i });
    await user.click(exportButton);

    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:report');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Dry-Run-Report exportiert');
  });
});