import { api } from '@/api/client';

export async function syncTenantDoctorCentralLink({
  doctorId,
  tenantId,
  previousCentralEmployeeId,
  nextCentralEmployeeId,
  apiClient = api,
}) {
  if (!doctorId || !tenantId) {
    return;
  }

  const previousId = previousCentralEmployeeId || null;
  const nextId = nextCentralEmployeeId || null;

  if (previousId === nextId) {
    return;
  }

  if (nextId) {
    await apiClient.request(`/api/master/employees/${nextId}/link-tenant`, {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: tenantId,
        doctor_id: doctorId,
      }),
    });
    return;
  }

  if (previousId) {
    await apiClient.request('/api/master/employees/unlink-tenant', {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: tenantId,
        doctor_id: doctorId,
      }),
    });
  }
}