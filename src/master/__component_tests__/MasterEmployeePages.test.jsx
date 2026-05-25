import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MasterEmployeeCreate from '@/master/pages/MasterEmployeeCreate';
import MasterCentralEmployeeDetail from '@/master/pages/MasterCentralEmployeeDetail';
import { renderWithProviders } from '@/test-utils/renderWithProviders';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  api: {
    request: mocks.apiRequest,
  },
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mocks.toast,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useParams: () => ({ employeeId: 'employee-1' }),
  };
});

describe('Master employee pages', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.navigate.mockReset();
    mocks.toast.mockReset();
  });

  it('renders the create page and allows opening the work time model select', async () => {
    const user = userEvent.setup();

    mocks.apiRequest.mockImplementation(async (url) => {
      if (url === '/api/master/work-time-models') {
        return {
          models: [
            { id: 'model-1', name: 'Vollzeit', hours_per_week: 38.5 },
          ],
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    renderWithProviders(<MasterEmployeeCreate />, { withAuthProvider: false, withToaster: false });

    expect(screen.getByText('Neuer Mitarbeiter')).toBeInTheDocument();

    await user.click(screen.getAllByRole('combobox')[1]);

    expect(await screen.findAllByText('Kein Modell')).not.toHaveLength(0);
    expect(screen.getByRole('option', { name: 'Vollzeit (38.5h/W)' })).toBeInTheDocument();
  });

  it('shows a delete action for inactive central employees', async () => {
    mocks.apiRequest.mockImplementation(async (url) => {
      if (url === '/api/master/employees/employee-1') {
        return {
          id: 'employee-1',
          first_name: 'Max',
          last_name: 'Mustermann',
          former_name: '',
          payroll_id: '4711',
          date_of_birth: '',
          email: 'max@example.com',
          phone: '',
          address: '',
          contract_type: '',
          contract_start: '',
          contract_end: '',
          probation_end: '',
          target_hours_per_week: 38.5,
          vacation_days_annual: 30,
          work_time_model_id: '',
          is_active: false,
          exit_date: '',
          exit_reason: '',
          notes: '',
          assignments: [],
          timeAccounts: [],
        };
      }

      if (url === '/api/master/work-time-models') {
        return { models: [] };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    renderWithProviders(<MasterCentralEmployeeDetail />, { withAuthProvider: false, withToaster: false });

    expect(await screen.findByText('Max Mustermann')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /löschen/i })).toBeEnabled();
  });
});
