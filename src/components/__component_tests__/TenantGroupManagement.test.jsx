import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TenantGroupManagement from '@/components/admin/TenantGroupManagement';
import { renderWithProviders } from '@/test-utils/renderWithProviders';

const mocks = vi.hoisted(() => ({
  listGroups: vi.fn(),
  request: vi.fn(),
  listGroupMembers: vi.fn(),
  listSharedWorkplaces: vi.fn(),
  createSharedWorkplace: vi.fn(),
  updateSharedWorkplace: vi.fn(),
  deleteSharedWorkplace: vi.fn(),
  addGroupMember: vi.fn(),
  removeGroupMember: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  api: {
    listGroups: mocks.listGroups,
    request: mocks.request,
    listGroupMembers: mocks.listGroupMembers,
    listSharedWorkplaces: mocks.listSharedWorkplaces,
    createSharedWorkplace: mocks.createSharedWorkplace,
    updateSharedWorkplace: mocks.updateSharedWorkplace,
    deleteSharedWorkplace: mocks.deleteSharedWorkplace,
    addGroupMember: mocks.addGroupMember,
    removeGroupMember: mocks.removeGroupMember,
    createGroup: mocks.createGroup,
    updateGroup: mocks.updateGroup,
    deleteGroup: mocks.deleteGroup,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

describe('TenantGroupManagement', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());

    mocks.listGroups.mockResolvedValue({
      groups: [
        {
          id: 1,
          name: 'Innere Klinik Verbund',
          description: 'Nord + Süd',
          is_active: 1,
        },
      ],
    });
    mocks.request.mockResolvedValue([
      { id: 'tenant-a', name: 'Innere Nord', host: 'db-a', db_name: 'inner_nord' },
      { id: 'tenant-b', name: 'Innere Süd', host: 'db-b', db_name: 'inner_sued' },
    ]);
    mocks.listGroupMembers.mockResolvedValue({
      members: [
        { tenant_id: 'tenant-a', name: 'Innere Nord', host: 'db-a', db_name: 'inner_nord' },
      ],
    });
    mocks.listSharedWorkplaces.mockResolvedValue({ workplaces: [] });
    mocks.createSharedWorkplace.mockResolvedValue({ id: 'wp-1' });
    mocks.addGroupMember.mockResolvedValue({ success: true });
    mocks.createGroup.mockResolvedValue({ group: { id: 2 } });
    mocks.updateGroup.mockResolvedValue({});
    mocks.deleteGroup.mockResolvedValue({});
    mocks.updateSharedWorkplace.mockResolvedValue({ success: true });
    mocks.deleteSharedWorkplace.mockResolvedValue({});
    mocks.removeGroupMember.mockResolvedValue({});
  });

  it('loads the selected group and creates a shared workplace from the UI', async () => {
    const user = userEvent.setup();

    renderWithProviders(<TenantGroupManagement />, { withAuthProvider: false, withToaster: false });

    expect(await screen.findByText('Innere Klinik Verbund')).toBeInTheDocument();
    expect(await screen.findByText('Innere Nord')).toBeInTheDocument();

    await user.click(screen.getByTestId('admin-group-workplace-create-button'));
    await user.type(screen.getByTestId('admin-group-workplace-name-input'), 'Interner Hintergrunddienst');
  expect(screen.queryByLabelText('Kategorie')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Mindestbesetzung')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('admin-group-workplace-service-type'));
    await user.click(await screen.findByRole('option', { name: /Rufbereitschaftsdienst/i }));
    await user.click(screen.getByTestId('admin-group-workplace-auto-off'));
    await user.click(screen.getByTestId('admin-group-workplace-day-6'));
    await user.clear(screen.getByLabelText(/Pause \/ Toleranz/));
    await user.type(screen.getByLabelText(/Pause \/ Toleranz/), '20');
    await user.clear(screen.getByLabelText(/Arbeitszeit-Anteil/));
    await user.type(screen.getByLabelText(/Arbeitszeit-Anteil/), '70');
    await user.click(screen.getByTestId('admin-group-workplace-save-button'));

    await waitFor(() => {
      expect(mocks.createSharedWorkplace).toHaveBeenCalledWith(1, {
        name: 'Interner Hintergrunddienst',
        category: 'Dienste',
        start_time: null,
        end_time: null,
        active_days: [1, 2, 3, 4, 5, 6],
        service_type: 2,
        auto_off: true,
        allows_rotation_concurrently: false,
        allows_absence_overlap: false,
        consecutive_days_mode: 'allowed',
        allows_multiple: false,
        default_overlap_tolerance_minutes: 20,
        work_time_percentage: 70,
        affects_availability: true,
        timeslots_enabled: false,
        is_active: true,
      });
    });
  });
});
