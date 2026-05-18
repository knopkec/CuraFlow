import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpResponse } from 'msw';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DoctorForm from '@/components/staff/DoctorForm';
import { renderWithProviders } from '@/test-utils/renderWithProviders';
import { createDbHandlers, createRouteHandler, server } from '@/test-utils/server';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }) => <>{children}</>,
  DialogContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <div>{children}</div>,
  DialogFooter: ({ children }) => <div>{children}</div>,
}));

vi.mock('@/components/staff/DoctorQualificationEditor', () => ({
  default: ({ selectedQualIds = [], onToggle }) => (
    <button
      type="button"
      data-testid="doctor-qualification-toggle-qualification-radiation"
      onClick={() => onToggle?.('qualification-radiation')}
    >
      {selectedQualIds.includes('qualification-radiation') ? 'SS selected' : 'SS'}
    </button>
  ),
}));

function renderDoctorForm({ doctors = [], qualifications = [], onSubmit = vi.fn() } = {}) {
  server.use(
    ...createDbHandlers({
      entities: {
        Doctor: doctors,
        Qualification: qualifications,
        DoctorQualification: [],
        TeamRole: [],
      },
    }),
    createRouteHandler('get', '*/api/master/employees', () =>
      HttpResponse.json({
        employees: [],
      })
    )
  );

  return {
    onSubmit,
    ...renderWithProviders(
      <DoctorForm open onOpenChange={() => {}} doctor={null} onSubmit={onSubmit} />,
      { withAuthProvider: false }
    ),
  };
}

describe('DoctorForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits normalized doctor data together with selected qualifications', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    renderDoctorForm({
      onSubmit,
      qualifications: [
        {
          id: 'qualification-radiation',
          name: 'Strahlenschutz',
          short_label: 'SS',
          category: 'Pflicht',
          is_active: true,
          color_bg: '#e0e7ff',
          color_text: '#3730a3',
        },
      ],
    });

    await user.type(await screen.findByTestId('staff-form-name'), 'Neue Person');
    await user.type(screen.getByTestId('staff-form-initials'), 'NP ');
    await user.type(screen.getByTestId('staff-form-email'), 'np@test.local');
    await user.type(screen.getByTestId('staff-form-google-email'), 'np@test.local');
    await user.clear(screen.getByTestId('staff-form-target-hours'));
    await user.type(screen.getByTestId('staff-form-target-hours'), '32.5');
    await user.click(screen.getByTestId('doctor-qualification-toggle-qualification-radiation'));
    fireEvent.submit(screen.getByTestId('staff-form-submit').closest('form'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Neue Person',
          initials: 'NP',
          email: 'np@test.local',
          google_email: 'np@test.local',
          fte: 1,
          target_weekly_hours: 32.5,
          central_employee_id: null,
          _qualificationIds: ['qualification-radiation'],
        })
      );
    });
  });

  it('prevents saving when the initials are already used by another doctor', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    renderDoctorForm({
      onSubmit,
      doctors: [
        {
          id: 'doctor-existing',
          name: 'Anna Adler',
          initials: 'AA',
        },
      ],
      qualifications: [
        {
          id: 'qualification-radiation',
          name: 'Strahlenschutz',
          short_label: 'SS',
          category: 'Pflicht',
          is_active: true,
          color_bg: '#e0e7ff',
          color_text: '#3730a3',
        },
      ],
    });

    await user.type(await screen.findByTestId('staff-form-name'), 'Andere Person');
    await user.type(screen.getByTestId('staff-form-initials'), 'aa');
    fireEvent.submit(screen.getByTestId('staff-form-submit').closest('form'));

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Das Kürzel "aa" wird bereits von Anna Adler verwendet.')
      );
    });
  });
});
