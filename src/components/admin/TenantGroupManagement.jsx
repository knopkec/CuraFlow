import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import SharedTimeslotEditor from '@/components/admin/SharedTimeslotEditor';
import { SERVICE_TYPES } from '@/components/settings/serviceTypes';
import { Building2, Clock, Globe2, Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react';

const DEFAULT_GROUP_FORM = {
    name: '',
    description: '',
    is_active: true,
};

const DEFAULT_WORKPLACE_FORM = {
    name: '',
    active_days: [1, 2, 3, 4, 5],
    service_type: '1',
    auto_off: false,
    allows_rotation_concurrently: false,
    allows_absence_overlap: false,
    consecutive_days_mode: 'allowed',
    allows_multiple: false,
    min_staff: '1',
    optimal_staff: '1',
    default_overlap_tolerance_minutes: '15',
    work_time_percentage: '100',
    affects_availability: true,
    timeslots_enabled: false,
    is_active: true,
};

function normalizeGroup(group) {
    return {
        ...group,
        id: Number(group.id),
        is_active: Boolean(group.is_active),
    };
}

function normalizeWorkplace(workplace) {
    return {
        ...workplace,
        allows_multiple: workplace.allows_multiple == null ? null : Boolean(workplace.allows_multiple),
        auto_off: Boolean(workplace.auto_off),
        allows_rotation_concurrently: Boolean(workplace.allows_rotation_concurrently),
        affects_availability: Boolean(workplace.affects_availability),
        allows_absence_overlap: Boolean(workplace.allows_absence_overlap),
        timeslots_enabled: Boolean(workplace.timeslots_enabled),
        is_active: Boolean(workplace.is_active),
        active_days: Array.isArray(workplace.active_days) ? workplace.active_days : [1, 2, 3, 4, 5],
    };
}

function serviceTypeLabel(value) {
    return SERVICE_TYPES.find((entry) => entry.value === Number(value))?.label || 'Kein Typ';
}

function toggleDay(days, dayIndex) {
    return days.includes(dayIndex)
        ? days.filter((entry) => entry !== dayIndex)
        : [...days, dayIndex].sort((left, right) => left - right);
}

export default function TenantGroupManagement() {
    const queryClient = useQueryClient();
    const [selectedGroupId, setSelectedGroupId] = useState(null);
    const [showGroupDialog, setShowGroupDialog] = useState(false);
    const [editingGroup, setEditingGroup] = useState(null);
    const [groupForm, setGroupForm] = useState(DEFAULT_GROUP_FORM);
    const [showWorkplaceDialog, setShowWorkplaceDialog] = useState(false);
    const [editingWorkplace, setEditingWorkplace] = useState(null);
    const [workplaceForm, setWorkplaceForm] = useState(DEFAULT_WORKPLACE_FORM);
    const [tenantToAdd, setTenantToAdd] = useState('');

    const { data: groupsResponse, isLoading: groupsLoading } = useQuery({
        queryKey: ['admin', 'tenant-groups'],
        queryFn: () => api.listGroups(),
        staleTime: 30_000,
    });

    const groups = useMemo(
        () => (Array.isArray(groupsResponse?.groups) ? groupsResponse.groups.map(normalizeGroup) : []),
        [groupsResponse]
    );

    useEffect(() => {
        if (groups.length === 0) {
            setSelectedGroupId(null);
            return;
        }
        const exists = groups.some((group) => group.id === selectedGroupId);
        if (!exists) {
            setSelectedGroupId(groups[0].id);
        }
    }, [groups, selectedGroupId]);

    const selectedGroup = useMemo(
        () => groups.find((group) => group.id === selectedGroupId) || null,
        [groups, selectedGroupId]
    );

    const { data: tenants = [] } = useQuery({
        queryKey: ['serverDbTokens'],
        queryFn: () => api.request('/api/admin/db-tokens'),
        staleTime: 30_000,
    });

    const { data: membersResponse, isLoading: membersLoading } = useQuery({
        queryKey: ['admin', 'tenant-group-members', selectedGroupId],
        queryFn: () => api.listGroupMembers(selectedGroupId),
        enabled: !!selectedGroupId,
        staleTime: 10_000,
    });

    const { data: workplacesResponse, isLoading: workplacesLoading } = useQuery({
        queryKey: ['admin', 'tenant-group-workplaces', selectedGroupId],
        queryFn: () => api.listSharedWorkplaces(selectedGroupId),
        enabled: !!selectedGroupId,
        staleTime: 10_000,
    });

    const members = Array.isArray(membersResponse?.members) ? membersResponse.members : [];
    const workplaces = useMemo(
        () => (Array.isArray(workplacesResponse?.workplaces) ? workplacesResponse.workplaces.map(normalizeWorkplace) : []),
        [workplacesResponse]
    );

    const availableTenants = useMemo(() => {
        const memberIds = new Set(members.map((member) => String(member.tenant_id)));
        return tenants.filter((tenant) => !memberIds.has(String(tenant.id)));
    }, [members, tenants]);

    const invalidateGroups = () => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'tenant-groups'] });
        queryClient.invalidateQueries({ queryKey: ['users'] });
    };

    const invalidateSelectedGroup = () => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'tenant-group-members', selectedGroupId] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'tenant-group-workplaces', selectedGroupId] });
        queryClient.invalidateQueries({ queryKey: ['pool', 'visible-shifts'] });
        queryClient.invalidateQueries({ queryKey: ['users'] });
    };

    const createGroupMutation = useMutation({
        mutationFn: (payload) => api.createGroup(payload),
        onSuccess: (response) => {
            invalidateGroups();
            const groupId = Number(response?.group?.id);
            if (Number.isInteger(groupId)) {
                setSelectedGroupId(groupId);
            }
            setShowGroupDialog(false);
            setEditingGroup(null);
            setGroupForm(DEFAULT_GROUP_FORM);
            toast.success('Verbund erstellt');
        },
        onError: (error) => toast.error(error.message || 'Verbund konnte nicht erstellt werden'),
    });

    const updateGroupMutation = useMutation({
        mutationFn: ({ groupId, payload }) => api.updateGroup(groupId, payload),
        onSuccess: () => {
            invalidateGroups();
            setShowGroupDialog(false);
            setEditingGroup(null);
            setGroupForm(DEFAULT_GROUP_FORM);
            toast.success('Verbund aktualisiert');
        },
        onError: (error) => toast.error(error.message || 'Verbund konnte nicht aktualisiert werden'),
    });

    const deleteGroupMutation = useMutation({
        mutationFn: (groupId) => api.deleteGroup(groupId),
        onSuccess: () => {
            invalidateGroups();
            setSelectedGroupId(null);
            toast.success('Verbund gelöscht');
        },
        onError: (error) => toast.error(error.message || 'Verbund konnte nicht gelöscht werden'),
    });

    const addMemberMutation = useMutation({
        mutationFn: ({ groupId, tenantId }) => api.addGroupMember(groupId, tenantId),
        onSuccess: () => {
            invalidateSelectedGroup();
            setTenantToAdd('');
            toast.success('Mandant hinzugefügt');
        },
        onError: (error) => toast.error(error.message || 'Mandant konnte nicht hinzugefügt werden'),
    });

    const removeMemberMutation = useMutation({
        mutationFn: ({ groupId, tenantId }) => api.removeGroupMember(groupId, tenantId),
        onSuccess: () => {
            invalidateSelectedGroup();
            toast.success('Mandant entfernt');
        },
        onError: (error) => toast.error(error.message || 'Mandant konnte nicht entfernt werden'),
    });

    const createWorkplaceMutation = useMutation({
        mutationFn: ({ groupId, payload }) => api.createSharedWorkplace(groupId, payload),
        onSuccess: () => {
            invalidateSelectedGroup();
            setShowWorkplaceDialog(false);
            setEditingWorkplace(null);
            setWorkplaceForm(DEFAULT_WORKPLACE_FORM);
            toast.success('Gemeinsamer Dienst erstellt');
        },
        onError: (error) => toast.error(error.message || 'Dienst konnte nicht erstellt werden'),
    });

    const updateWorkplaceMutation = useMutation({
        mutationFn: ({ groupId, workplaceId, payload }) => api.updateSharedWorkplace(groupId, workplaceId, payload),
        onSuccess: () => {
            invalidateSelectedGroup();
            setShowWorkplaceDialog(false);
            setEditingWorkplace(null);
            setWorkplaceForm(DEFAULT_WORKPLACE_FORM);
            toast.success('Gemeinsamer Dienst aktualisiert');
        },
        onError: (error) => toast.error(error.message || 'Dienst konnte nicht aktualisiert werden'),
    });

    const deleteWorkplaceMutation = useMutation({
        mutationFn: ({ groupId, workplaceId }) => api.deleteSharedWorkplace(groupId, workplaceId),
        onSuccess: () => {
            invalidateSelectedGroup();
            toast.success('Gemeinsamer Dienst gelöscht');
        },
        onError: (error) => toast.error(error.message || 'Dienst konnte nicht gelöscht werden'),
    });

    const handleOpenCreateGroup = () => {
        setEditingGroup(null);
        setGroupForm(DEFAULT_GROUP_FORM);
        setShowGroupDialog(true);
    };

    const handleOpenEditGroup = (group) => {
        setEditingGroup(group);
        setGroupForm({
            name: group.name || '',
            description: group.description || '',
            is_active: Boolean(group.is_active),
        });
        setShowGroupDialog(true);
    };

    const handleSaveGroup = () => {
        if (!groupForm.name.trim()) {
            toast.error('Name ist erforderlich');
            return;
        }
        const payload = {
            name: groupForm.name.trim(),
            description: groupForm.description.trim() || null,
            is_active: Boolean(groupForm.is_active),
        };
        if (editingGroup) {
            updateGroupMutation.mutate({ groupId: editingGroup.id, payload });
            return;
        }
        createGroupMutation.mutate(payload);
    };

    const handleDeleteGroup = (group) => {
        if (!window.confirm(`Verbund "${group.name}" wirklich löschen?`)) {
            return;
        }
        deleteGroupMutation.mutate(group.id);
    };

    const handleAddTenant = () => {
        if (!selectedGroupId || !tenantToAdd) {
            toast.error('Bitte zuerst einen Mandanten wählen');
            return;
        }
        addMemberMutation.mutate({ groupId: selectedGroupId, tenantId: tenantToAdd });
    };

    const handleOpenCreateWorkplace = () => {
        setEditingWorkplace(null);
        setWorkplaceForm(DEFAULT_WORKPLACE_FORM);
        setShowWorkplaceDialog(true);
    };

    const handleOpenEditWorkplace = (workplace) => {
        setEditingWorkplace(workplace);
        setWorkplaceForm({
            name: workplace.name || '',
            active_days: Array.isArray(workplace.active_days) ? workplace.active_days : [1, 2, 3, 4, 5],
            service_type: workplace.service_type ? String(workplace.service_type) : '1',
            auto_off: Boolean(workplace.auto_off),
            allows_rotation_concurrently: Boolean(workplace.allows_rotation_concurrently),
            allows_absence_overlap: Boolean(workplace.allows_absence_overlap),
            consecutive_days_mode: workplace.consecutive_days_mode || 'allowed',
            allows_multiple: workplace.allows_multiple ?? false,
            min_staff: String(workplace.min_staff ?? 1),
            optimal_staff: String(workplace.optimal_staff ?? 1),
            default_overlap_tolerance_minutes: String(workplace.default_overlap_tolerance_minutes ?? 15),
            work_time_percentage: String(workplace.work_time_percentage ?? 100),
            affects_availability: Boolean(workplace.affects_availability),
            timeslots_enabled: Boolean(workplace.timeslots_enabled),
            is_active: Boolean(workplace.is_active),
        });
        setShowWorkplaceDialog(true);
    };

    const buildWorkplacePayload = () => {
        const payload = {
            name: workplaceForm.name.trim(),
            category: 'Dienste',
            start_time: null,
            end_time: null,
            active_days: Array.isArray(workplaceForm.active_days) ? workplaceForm.active_days : [1, 2, 3, 4, 5],
            service_type: Number.parseInt(workplaceForm.service_type, 10) || null,
            auto_off: Boolean(workplaceForm.auto_off),
            allows_rotation_concurrently: Boolean(workplaceForm.allows_rotation_concurrently),
            allows_absence_overlap: Boolean(workplaceForm.allows_absence_overlap),
            consecutive_days_mode: workplaceForm.consecutive_days_mode || 'allowed',
            allows_multiple: Boolean(workplaceForm.allows_multiple),
            default_overlap_tolerance_minutes: Math.max(0, Number.parseInt(workplaceForm.default_overlap_tolerance_minutes, 10) || 0),
            work_time_percentage: Math.min(100, Math.max(0, Number.parseFloat(workplaceForm.work_time_percentage) || 100)),
            affects_availability: Boolean(workplaceForm.affects_availability),
            timeslots_enabled: Boolean(workplaceForm.timeslots_enabled),
            is_active: Boolean(workplaceForm.is_active),
        };
        if (payload.allows_multiple) {
            const minStaff = Math.max(0, Number.parseInt(workplaceForm.min_staff, 10) || 0);
            const optimalStaff = Math.max(minStaff, Number.parseInt(workplaceForm.optimal_staff, 10) || Math.max(minStaff, 1));
            payload.min_staff = minStaff;
            payload.optimal_staff = optimalStaff;
        }
        return payload;
    };

    const handleSaveWorkplace = () => {
        if (!selectedGroupId) {
            toast.error('Bitte zuerst einen Verbund wählen');
            return;
        }
        if (!workplaceForm.name.trim()) {
            toast.error('Name ist erforderlich');
            return;
        }
        const payload = buildWorkplacePayload();
        if (editingWorkplace) {
            updateWorkplaceMutation.mutate({
                groupId: selectedGroupId,
                workplaceId: editingWorkplace.id,
                payload,
            });
            return;
        }
        createWorkplaceMutation.mutate({ groupId: selectedGroupId, payload });
    };

    const handleDeleteWorkplace = (workplace) => {
        if (!selectedGroupId) return;
        if (!window.confirm(`Gemeinsamen Dienst "${workplace.name}" wirklich löschen?`)) {
            return;
        }
        deleteWorkplaceMutation.mutate({ groupId: selectedGroupId, workplaceId: workplace.id });
    };

    return (
        <div className="space-y-6" data-testid="admin-tenant-group-management">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold text-slate-900">Cross-Mandanten-Verbund</h2>
                    <p className="text-sm text-slate-500">Verbünde, Mandanten-Mitglieder und gemeinsame Dienste zentral verwalten.</p>
                </div>
                <Button onClick={handleOpenCreateGroup} className="bg-indigo-600 hover:bg-indigo-700" data-testid="admin-group-create-button">
                    <Plus className="mr-2 h-4 w-4" />
                    Verbund anlegen
                </Button>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.1fr_1.9fr]">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Globe2 className="h-5 w-5 text-indigo-600" />
                            Verbünde
                        </CardTitle>
                        <CardDescription>Wähle einen Verbund aus oder lege einen neuen an.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {groupsLoading ? (
                            <div className="flex items-center justify-center py-8 text-sm text-slate-500">
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lade Verbünde …
                            </div>
                        ) : groups.length === 0 ? (
                            <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">
                                Noch kein Verbund vorhanden.
                            </div>
                        ) : (
                            groups.map((group) => {
                                const isSelected = group.id === selectedGroupId;
                                return (
                                    <div
                                        key={group.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setSelectedGroupId(group.id)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setSelectedGroupId(group.id);
                                            }
                                        }}
                                        className={`w-full rounded-lg border p-4 text-left transition ${
                                            isSelected ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                        }`}
                                        data-testid={`admin-group-card-${group.id}`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="font-medium text-slate-900">{group.name}</div>
                                                <div className="mt-1 text-sm text-slate-500">{group.description || 'Keine Beschreibung'}</div>
                                            </div>
                                            <Badge variant="outline" className={group.is_active ? 'border-green-200 bg-green-50 text-green-700' : 'border-slate-300 bg-slate-100 text-slate-600'}>
                                                {group.is_active ? 'Aktiv' : 'Inaktiv'}
                                            </Badge>
                                        </div>
                                        <div className="mt-3 flex items-center gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    handleOpenEditGroup(group);
                                                }}
                                            >
                                                <Pencil className="mr-1 h-3.5 w-3.5" /> Bearbeiten
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    handleDeleteGroup(group);
                                                }}
                                            >
                                                <Trash2 className="mr-1 h-3.5 w-3.5" /> Löschen
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </CardContent>
                </Card>

                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Users className="h-5 w-5 text-indigo-600" />
                                Mandanten im Verbund
                            </CardTitle>
                            <CardDescription>
                                {selectedGroup ? `Mitglieder von ${selectedGroup.name}` : 'Bitte zuerst einen Verbund wählen.'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {selectedGroup ? (
                                <>
                                    <div className="flex flex-col gap-3 md:flex-row">
                                        <Select value={tenantToAdd} onValueChange={setTenantToAdd}>
                                            <SelectTrigger className="md:max-w-sm" data-testid="admin-group-add-tenant-select">
                                                <SelectValue placeholder="Mandant wählen" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {availableTenants.length === 0 ? (
                                                    <SelectItem value="__none__" disabled>Keine weiteren Mandanten verfügbar</SelectItem>
                                                ) : (
                                                    availableTenants.map((tenant) => (
                                                        <SelectItem key={tenant.id} value={String(tenant.id)}>
                                                            {tenant.name || tenant.id}
                                                        </SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                        <Button onClick={handleAddTenant} disabled={!tenantToAdd || addMemberMutation.isPending} data-testid="admin-group-add-tenant-submit">
                                            {addMemberMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                                            Mandant hinzufügen
                                        </Button>
                                    </div>

                                    {membersLoading ? (
                                        <div className="flex items-center justify-center py-6 text-sm text-slate-500">
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lade Mitglieder …
                                        </div>
                                    ) : members.length === 0 ? (
                                        <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">Noch keine Mandanten zugeordnet.</div>
                                    ) : (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Mandant</TableHead>
                                                    <TableHead>Datenbank</TableHead>
                                                    <TableHead className="text-right">Aktion</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {members.map((member) => (
                                                    <TableRow key={member.tenant_id} data-testid={`admin-group-member-${member.tenant_id}`}>
                                                        <TableCell className="font-medium">{member.name || member.tenant_id}</TableCell>
                                                        <TableCell className="text-slate-500">{member.host}/{member.db_name}</TableCell>
                                                        <TableCell className="text-right">
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                                                onClick={() => removeMemberMutation.mutate({ groupId: selectedGroupId, tenantId: member.tenant_id })}
                                                            >
                                                                <Trash2 className="mr-1 h-3.5 w-3.5" /> Entfernen
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </>
                            ) : (
                                <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">Bitte links einen Verbund auswählen.</div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <CardTitle className="flex items-center gap-2">
                                        <Building2 className="h-5 w-5 text-indigo-600" />
                                        Gemeinsame Dienste
                                    </CardTitle>
                                    <CardDescription>
                                        {selectedGroup ? `Pool-Dienste für ${selectedGroup.name}` : 'Bitte zuerst einen Verbund wählen.'}
                                    </CardDescription>
                                </div>
                                <Button onClick={handleOpenCreateWorkplace} disabled={!selectedGroup} data-testid="admin-group-workplace-create-button">
                                    <Plus className="mr-2 h-4 w-4" /> Dienst anlegen
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {!selectedGroup ? (
                                <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">Bitte links einen Verbund auswählen.</div>
                            ) : workplacesLoading ? (
                                <div className="flex items-center justify-center py-6 text-sm text-slate-500">
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lade Dienste …
                                </div>
                            ) : workplaces.length === 0 ? (
                                <div className="rounded-lg border border-dashed p-4 text-sm text-slate-500">Noch kein gemeinsamer Dienst angelegt.</div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Name</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="text-right">Aktionen</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {workplaces.map((workplace) => (
                                            <TableRow key={workplace.id} data-testid={`admin-group-workplace-${workplace.id}`}>
                                                <TableCell>
                                                    <div className="font-medium">{workplace.name}</div>
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        <Badge variant="secondary" className="text-[10px] font-normal">{serviceTypeLabel(workplace.service_type)}</Badge>
                                                        {workplace.auto_off ? <Badge variant="secondary" className="bg-blue-100 text-[10px] font-normal text-blue-700">Auto-Frei</Badge> : null}
                                                        {workplace.allows_rotation_concurrently ? <Badge variant="secondary" className="bg-green-100 text-[10px] font-normal text-green-700">Rotation OK</Badge> : null}
                                                        {workplace.allows_absence_overlap ? <Badge variant="secondary" className="bg-violet-100 text-[10px] font-normal text-violet-700">Abwesenheit OK</Badge> : null}
                                                        {workplace.timeslots_enabled ? <Badge variant="secondary" className="bg-indigo-100 text-[10px] font-normal text-indigo-700">Zeitfenster</Badge> : null}
                                                        {workplace.allows_multiple ? <Badge variant="secondary" className="bg-teal-100 text-[10px] font-normal text-teal-700">Mehrfachbesetzung</Badge> : null}
                                                        {workplace.allows_multiple && (workplace.min_staff > 0 || workplace.optimal_staff > 1) ? (
                                                            <Badge variant="secondary" className="bg-amber-100 text-[10px] font-normal text-amber-700">
                                                                {workplace.min_staff ?? 1}–{workplace.optimal_staff ?? 1}
                                                            </Badge>
                                                        ) : null}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1">
                                                        <Badge variant="outline" className={workplace.is_active ? 'border-green-200 bg-green-50 text-green-700' : 'border-slate-300 bg-slate-100 text-slate-600'}>
                                                            {workplace.is_active ? 'Aktiv' : 'Inaktiv'}
                                                        </Badge>
                                                        <span className="text-xs text-slate-500">
                                                            {workplace.affects_availability ? 'Blockiert Verfügbarkeit' : 'Nicht verfügbarkeitsrelevant'}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <Button variant="outline" size="sm" onClick={() => handleOpenEditWorkplace(workplace)}>
                                                            <Pencil className="mr-1 h-3.5 w-3.5" /> Bearbeiten
                                                        </Button>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                                            onClick={() => handleDeleteWorkplace(workplace)}
                                                        >
                                                            <Trash2 className="mr-1 h-3.5 w-3.5" /> Löschen
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            <Dialog open={showGroupDialog} onOpenChange={setShowGroupDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingGroup ? 'Verbund bearbeiten' : 'Verbund anlegen'}</DialogTitle>
                        <DialogDescription>Ein Verbund verbindet mehrere Mandanten für gemeinsame Pool-Dienste.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="group-name">Name</Label>
                            <Input
                                id="group-name"
                                value={groupForm.name}
                                onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
                                data-testid="admin-group-name-input"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="group-description">Beschreibung</Label>
                            <Textarea
                                id="group-description"
                                value={groupForm.description}
                                onChange={(event) => setGroupForm((current) => ({ ...current, description: event.target.value }))}
                                rows={3}
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border p-3">
                            <div>
                                <div className="font-medium text-slate-900">Aktiv</div>
                                <div className="text-sm text-slate-500">Nur aktive Verbünde erscheinen in der Auswahl.</div>
                            </div>
                            <Switch checked={groupForm.is_active} onCheckedChange={(checked) => setGroupForm((current) => ({ ...current, is_active: checked }))} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowGroupDialog(false)}>Abbrechen</Button>
                        <Button onClick={handleSaveGroup} disabled={createGroupMutation.isPending || updateGroupMutation.isPending} data-testid="admin-group-save-button">
                            {(createGroupMutation.isPending || updateGroupMutation.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Speichern
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showWorkplaceDialog} onOpenChange={setShowWorkplaceDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingWorkplace ? 'Gemeinsamen Dienst bearbeiten' : 'Gemeinsamen Dienst anlegen'}</DialogTitle>
                        <DialogDescription>Dieser Dienst erscheint später im Cross-Department-Pool des Dienstplans.</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[75vh] space-y-4 overflow-y-auto py-2 pr-1">
                        <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="workplace-name">Name</Label>
                            <Input
                                id="workplace-name"
                                value={workplaceForm.name}
                                onChange={(event) => setWorkplaceForm((current) => ({ ...current, name: event.target.value }))}
                                data-testid="admin-group-workplace-name-input"
                            />
                        </div>
                        <div className="rounded-lg border bg-indigo-50 p-3 space-y-2">
                            <div className="space-y-0.5">
                                <Label className="text-base">Diensttyp</Label>
                                <div className="text-xs text-slate-500">Bestimmt die Limit-Prüfung und Autofill-Verteilung.</div>
                            </div>
                            <Select value={workplaceForm.service_type} onValueChange={(value) => setWorkplaceForm((current) => ({ ...current, service_type: value }))}>
                                <SelectTrigger className="bg-white" data-testid="admin-group-workplace-service-type">
                                    <SelectValue placeholder="Diensttyp wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                    {SERVICE_TYPES.map((serviceType) => (
                                        <SelectItem key={serviceType.value} value={String(serviceType.value)}>
                                            <span className="font-medium">{serviceType.label}</span>
                                            <span className="ml-2 text-xs text-slate-500">({serviceType.description})</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex items-center justify-between rounded-lg border bg-slate-50 p-3">
                            <div>
                                <div className="font-medium text-slate-900">Autom. Freistellen</div>
                                <div className="text-sm text-slate-500">Mitarbeiter erhält am folgenden Werktag automatisch „Frei“.</div>
                            </div>
                            <Switch checked={workplaceForm.auto_off} onCheckedChange={(checked) => setWorkplaceForm((current) => ({ ...current, auto_off: checked }))} data-testid="admin-group-workplace-auto-off" />
                        </div>

                        <div className="flex items-center justify-between rounded-lg border bg-slate-50 p-3">
                            <div>
                                <div className="font-medium text-slate-900">Rotation erlaubt</div>
                                <div className="text-sm text-slate-500">Kann parallel zu einer Tagesrotation zugewiesen werden.</div>
                            </div>
                            <Switch checked={workplaceForm.allows_rotation_concurrently} onCheckedChange={(checked) => setWorkplaceForm((current) => ({ ...current, allows_rotation_concurrently: checked }))} data-testid="admin-group-workplace-rotation" />
                        </div>

                        <div className="flex items-center justify-between rounded-lg border bg-slate-50 p-3">
                            <div>
                                <div className="font-medium text-slate-900">Gleichzeitige Abwesenheit erlauben</div>
                                <div className="text-sm text-slate-500">Dieser Dienst darf trotz Abwesenheit am selben Tag zugewiesen werden.</div>
                            </div>
                            <Switch checked={workplaceForm.allows_absence_overlap} onCheckedChange={(checked) => setWorkplaceForm((current) => ({ ...current, allows_absence_overlap: checked }))} data-testid="admin-group-workplace-absence-overlap" />
                        </div>

                        <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
                            <div className="space-y-0.5">
                                <Label className="text-base">Aufeinanderfolgende Tage</Label>
                                <div className="text-xs text-slate-500">Darf dem gleichen Arzt an aufeinanderfolgenden Tagen zugewiesen werden?</div>
                            </div>
                            <ToggleGroup
                                type="single"
                                value={workplaceForm.consecutive_days_mode}
                                onValueChange={(value) => {
                                    if (value) {
                                        setWorkplaceForm((current) => ({ ...current, consecutive_days_mode: value }));
                                    }
                                }}
                                className="justify-start"
                            >
                                <ToggleGroupItem value="forbidden" className="px-3 text-xs data-[state=on]:bg-red-100 data-[state=on]:text-red-700">Verboten</ToggleGroupItem>
                                <ToggleGroupItem value="allowed" className="px-3 text-xs data-[state=on]:bg-green-100 data-[state=on]:text-green-700">Erlaubt</ToggleGroupItem>
                                <ToggleGroupItem value="preferred" className="px-3 text-xs data-[state=on]:bg-blue-100 data-[state=on]:text-blue-700">Bevorzugt</ToggleGroupItem>
                            </ToggleGroup>
                            <div className="mt-1 text-xs text-slate-400">
                                {workplaceForm.consecutive_days_mode === 'forbidden' && 'Gleicher Arzt darf nicht an aufeinanderfolgenden Tagen eingeteilt werden.'}
                                {workplaceForm.consecutive_days_mode === 'allowed' && 'Aufeinanderfolgende Tage sind möglich, werden aber weder angestrebt noch vermieden.'}
                                {workplaceForm.consecutive_days_mode === 'preferred' && 'Aufeinanderfolgende Tage werden aktiv bevorzugt, z. B. ein ganzes Wochenende am Stück.'}
                            </div>
                        </div>

                        <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
                            <div className="space-y-0.5">
                                <Label htmlFor="workplace-work-time" className="text-base">Arbeitszeit-Anteil</Label>
                                <div className="text-xs text-slate-500">Prozentsatz der Arbeitszeit für Statistik, z. B. Rufbereitschaft = 70%.</div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Input
                                    id="workplace-work-time"
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="5"
                                    value={workplaceForm.work_time_percentage}
                                    onChange={(event) => setWorkplaceForm((current) => ({ ...current, work_time_percentage: event.target.value }))}
                                    className="w-20"
                                />
                                <span className="text-sm text-slate-500">%</span>
                            </div>
                        </div>

                        <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
                            <div className="space-y-0.5">
                                <Label className="text-base">Aktive Tage</Label>
                                <div className="text-xs text-slate-500">An welchen Wochentagen kann dieser Dienst besetzt werden?</div>
                            </div>
                            <div className="flex gap-1">
                                {['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'].map((day, index) => (
                                    <button
                                        key={day}
                                        type="button"
                                        onClick={() => setWorkplaceForm((current) => ({ ...current, active_days: toggleDay(current.active_days || [], index) }))}
                                        data-testid={`admin-group-workplace-day-${index}`}
                                        className={`h-8 w-8 rounded-full text-xs font-medium transition-colors ${(workplaceForm.active_days || []).includes(index) ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                    >
                                        {day[0]}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center justify-between rounded-lg border bg-slate-50 p-3">
                            <div>
                                <div className="font-medium text-slate-900">Mehrfachbesetzung</div>
                                <div className="text-sm text-slate-500">Mehrere Mitarbeiter können gleichzeitig pro Tag eingeteilt werden, z. B. für Ausbildung.</div>
                            </div>
                            <Switch checked={workplaceForm.allows_multiple} onCheckedChange={(checked) => setWorkplaceForm((current) => ({ ...current, allows_multiple: checked }))} data-testid="admin-group-workplace-allows-multiple" />
                        </div>

                        {workplaceForm.allows_multiple ? (
                            <div className="grid gap-3 rounded-lg border bg-amber-50 p-3 md:grid-cols-2">
                                <div className="space-y-1">
                                    <Label htmlFor="workplace-min" className="text-sm">Min. Besetzung</Label>
                                    <div className="text-xs text-slate-500">0 = kann leer bleiben</div>
                                    <Input
                                        id="workplace-min"
                                        type="number"
                                        min="0"
                                        max="20"
                                        value={workplaceForm.min_staff}
                                        onChange={(event) => setWorkplaceForm((current) => ({ ...current, min_staff: event.target.value }))}
                                        className="h-8 w-20"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="workplace-optimal" className="text-sm">Opt. Besetzung</Label>
                                    <div className="text-xs text-slate-500">Zielanzahl für Auto-Fill</div>
                                    <Input
                                        id="workplace-optimal"
                                        type="number"
                                        min="0"
                                        max="20"
                                        value={workplaceForm.optimal_staff}
                                        onChange={(event) => setWorkplaceForm((current) => ({ ...current, optimal_staff: event.target.value }))}
                                        className="h-8 w-20"
                                    />
                                </div>
                            </div>
                        ) : null}

                        <div className="grid gap-4 md:grid-cols-1">
                            <div className="space-y-2">
                                <Label htmlFor="workplace-tolerance">Pause / Toleranz (Min.)</Label>
                                <Input
                                    id="workplace-tolerance"
                                    type="number"
                                    min="0"
                                    max="60"
                                    value={workplaceForm.default_overlap_tolerance_minutes}
                                    onChange={(event) => setWorkplaceForm((current) => ({ ...current, default_overlap_tolerance_minutes: event.target.value }))}
                                    className="w-24"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between rounded-lg border bg-indigo-50 p-3">
                            <div>
                                <div className="flex items-center gap-2 font-medium text-slate-900"><Clock className="h-4 w-4" /> Zeitfenster aktivieren</div>
                                <div className="text-sm text-slate-500">Ermöglicht die Besetzung mit wechselnden Teams über den Tag, z. B. Früh-/Spätdienst.</div>
                            </div>
                            <Switch checked={workplaceForm.timeslots_enabled} onCheckedChange={(checked) => setWorkplaceForm((current) => ({ ...current, timeslots_enabled: checked }))} data-testid="admin-group-workplace-timeslots-enabled" />
                        </div>

                        {workplaceForm.timeslots_enabled ? (
                            editingWorkplace ? (
                                <div className="rounded-lg border p-3">
                                    <SharedTimeslotEditor
                                        groupId={selectedGroupId}
                                        workplaceId={editingWorkplace.id}
                                        defaultTolerance={Number.parseInt(workplaceForm.default_overlap_tolerance_minutes, 10) || 15}
                                    />
                                </div>
                            ) : (
                                <div className="rounded bg-amber-50 p-2 text-xs text-amber-700">Speichern Sie zuerst, um Zeitfenster hinzuzufügen.</div>
                            )
                        ) : null}

                        <div className="flex items-center justify-between rounded-lg border p-3 md:col-span-2">
                            <div>
                                <div className="font-medium text-slate-900">Verfügbarkeit blockieren</div>
                                <div className="text-sm text-slate-500">Der Dienst beeinflusst Folge- und Ruhezeiten im Mandantenplan.</div>
                            </div>
                            <Switch
                                checked={workplaceForm.affects_availability}
                                onCheckedChange={(checked) => setWorkplaceForm((current) => ({ ...current, affects_availability: checked }))}
                                data-testid="admin-group-workplace-affects-availability"
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border p-3 md:col-span-2">
                            <div>
                                <div className="font-medium text-slate-900">Aktiv</div>
                                <div className="text-sm text-slate-500">Inaktive Dienste bleiben historisch erhalten, erscheinen aber nicht neu.</div>
                            </div>
                            <Switch
                                checked={workplaceForm.is_active}
                                onCheckedChange={(checked) => setWorkplaceForm((current) => ({ ...current, is_active: checked }))}
                                data-testid="admin-group-workplace-is-active"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowWorkplaceDialog(false)}>Abbrechen</Button>
                        <Button onClick={handleSaveWorkplace} disabled={createWorkplaceMutation.isPending || updateWorkplaceMutation.isPending} data-testid="admin-group-workplace-save-button">
                            {(createWorkplaceMutation.isPending || updateWorkplaceMutation.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Speichern
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
