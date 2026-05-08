import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { api, db, base44 } from "@/api/client";
import { useAuth } from '@/components/AuthProvider';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Pencil, Trash2, User, GripVertical, Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import DoctorForm from "@/components/staff/DoctorForm";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StaffingPlanTable from "@/components/staff/StaffingPlanTable";
import { trackDbChange } from '@/components/utils/dbTracker';
import TeamRoleSettings, { useTeamRoles } from '@/components/settings/TeamRoleSettings';
import QualificationManagement from '@/components/settings/QualificationManagement';
import { DoctorQualificationBadges } from '@/components/staff/DoctorQualificationEditor';
import { useQualifications, useAllDoctorQualifications } from '@/hooks/useQualifications';
import QualificationOverview from '@/components/staff/QualificationOverview';
import { toast } from 'sonner';

export default function StaffPage() {
  const { isReadOnly, user } = useAuth();

  if (!user || user.role !== 'admin') {
      return (
          <div className="flex items-center justify-center h-[50vh] text-slate-500">
              <div className="text-center">
                  <User className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <h2 className="text-lg font-semibold">Zugriff verweigert</h2>
                  <p>Diese Seite ist nur für Administratoren sichtbar.</p>
              </div>
          </div>
      );
  }
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingDoctor, setEditingDoctor] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedQualificationIds, setSelectedQualificationIds] = useState([]);
  const queryClient = useQueryClient();

  // Dynamische Rollenprioritäten aus DB laden
  const { rolePriority } = useTeamRoles();

  // Dynamische Qualifikationen laden
  const { qualifications = [], qualificationMap, isLoading: isQualificationsLoading } = useQualifications();
  const { byDoctor: doctorQualsByDoctor, isLoading: isDoctorQualificationsLoading } = useAllDoctorQualifications();

  const { data: doctors = [], isLoading } = useQuery({
    queryKey: ["doctors"],
    queryFn: () => db.Doctor.list(),
    select: (data) => data.sort((a, b) => {
      const roleDiff = (rolePriority[a.role] ?? 99) - (rolePriority[b.role] ?? 99);
      if (roleDiff !== 0) return roleDiff;
      return (a.order || 0) - (b.order || 0);
    }),
  });

  const { data: colorSettings = [] } = useQuery({
      queryKey: ['colorSettings'],
      queryFn: () => db.ColorSetting.list(),
  });

  const activeQualifications = useMemo(
    () => qualifications.filter((qualification) => qualification.is_active !== false),
    [qualifications]
  );

  const isQualificationDataLoading = isQualificationsLoading || isDoctorQualificationsLoading;

  const filteredDoctors = useMemo(() => {
    if (selectedQualificationIds.length === 0) {
      return doctors;
    }

    return doctors.filter((doctor) => {
      const doctorQualIds = (doctorQualsByDoctor[doctor.id] || []).map((qualification) => qualification.qualification_id);
      return selectedQualificationIds.some((qualificationId) => doctorQualIds.includes(qualificationId));
    });
  }, [doctors, doctorQualsByDoctor, selectedQualificationIds]);

  const getRoleColor = (role) => {
      const setting = colorSettings.find(s => s.name === role && s.category === 'role');
      if (setting) return { backgroundColor: setting.bg_color, color: setting.text_color };
      
      // Defaults matching ScheduleBoard
      const defaults = {
          "Chefarzt": { bg: "#fee2e2", text: "#991b1b" },
          "Oberarzt": { bg: "#dbeafe", text: "#1e40af" },
          "Facharzt": { bg: "#dcfce7", text: "#166534" },
          "Assistenzarzt": { bg: "#fef9c3", text: "#854d0e" },
          "Nicht-Radiologe": { bg: "#e5e7eb", text: "#1f2937" }
      };
      
      if (defaults[role]) return { backgroundColor: defaults[role].bg, color: defaults[role].text };
      return { backgroundColor: "#f3f4f6", color: "#1f2937" };
  };

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const { _qualificationIds, ...doctorData } = data;
      const result = await db.Doctor.create({...doctorData, order: doctors.length});
      // Direkt nach dem Anlegen die Qualifikationen zuweisen, falls vorhanden
      if (_qualificationIds && _qualificationIds.length > 0 && result?.id) {
        try {
          await Promise.all(_qualificationIds.map(qId => db.DoctorQualification.create({
            doctor_id: result.id,
            qualification_id: qId,
          })));
        } catch (error) {
          toast.error("Einige Qualifikationen konnten nicht zugewiesen werden. Bitte manuell ergänzen.");
        }
      }
      return result;
    },
    onSuccess: () => {
      trackDbChange();
      queryClient.invalidateQueries(["doctors"]);
      queryClient.invalidateQueries(["doctorQualifications"]);
      queryClient.invalidateQueries(["allDoctorQualifications"]);
      setIsFormOpen(false);
    },
    onError: (error) => {
      toast.error(error?.message || "Teammitglied konnte nicht gespeichert werden.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => db.Doctor.update(id, data),
    onSuccess: () => {
      trackDbChange();
      queryClient.invalidateQueries(["doctors"]);
      setIsFormOpen(false);
      setEditingDoctor(null);
    },
    onError: (error) => {
      toast.error(error?.message || "Änderungen konnten nicht gespeichert werden.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => db.Doctor.delete(id),
    onSuccess: () => {
      trackDbChange();
      queryClient.invalidateQueries(["doctors"]);
    },
  });

  const handleSave = (data) => {
    if (editingDoctor) {
      // Bei Bearbeitung keine Qualifikationen über das Formular senden
      // (werden weiterhin über den Editor selbst gesteuert)
      const { _qualificationIds, ...cleanData } = data;
      updateMutation.mutate({ id: editingDoctor.id, data: cleanData });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (doctor) => {
    setEditingDoctor(doctor);
    setIsFormOpen(true);
  };

  const handleAddNew = () => {
    setEditingDoctor(null);
    setIsFormOpen(true);
  };

  const handleFormOpenChange = (open) => {
    setIsFormOpen(open);
    if (!open) {
      setEditingDoctor(null);
    }
  };

  const handleQualificationToggle = (qualificationId) => {
    setSelectedQualificationIds((current) => (
      current.includes(qualificationId)
        ? current.filter((id) => id !== qualificationId)
        : [...current, qualificationId]
    ));
  };

  const handleDragEnd = (result) => {
    if (selectedQualificationIds.length > 0) return;
    if (!result.destination) return;
    
    const items = Array.from(doctors);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    items.forEach((doc, index) => {
        if (doc.order !== index) {
            updateMutation.mutate({ id: doc.id, data: { order: index } });
        }
    });
  };

  return (
    <div className="container mx-auto flex h-[calc(100dvh-5rem)] max-w-6xl flex-col overflow-hidden sm:h-[calc(100dvh-6rem)] lg:h-[calc(100dvh-8rem)]">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Team</h1>
          <p className="text-slate-500 mt-2">Verwaltung der Mitarbeiter und Funktionen</p>
        </div>
        <div className="flex gap-2">
          {!isReadOnly && <QualificationManagement />}
          {!isReadOnly && <TeamRoleSettings />}
          {!isReadOnly && (
          <Button onClick={handleAddNew} className="bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4 mr-2" />
            Teammitglied hinzufügen
          </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="list" className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden">
          <TabsList className="w-fit">
              <TabsTrigger value="list">Mitarbeiterliste</TabsTrigger>
              <TabsTrigger value="qualifications">Qualifikationen</TabsTrigger>
              <TabsTrigger value="staffing">Stellenplan</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="mt-0 min-h-0 flex-1 overflow-hidden">
              <div className="h-full overflow-y-auto pr-1">
                <div className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-slate-900">Qualifikationsfilter</div>
                    <p className="text-sm text-slate-500">
                      Zeigt nur Teammitglieder mit mindestens einer der ausgewählten Qualifikationen.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:min-w-80 sm:max-w-md sm:items-end">
                    <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={filterOpen}
                          className="w-full justify-between sm:w-80"
                          disabled={isQualificationDataLoading || activeQualifications.length === 0}
                        >
                          <span className="truncate text-left">
                            {isQualificationDataLoading
                              ? "Qualifikationen laden..."
                              : selectedQualificationIds.length > 0
                              ? `${selectedQualificationIds.length} Qualifikation${selectedQualificationIds.length === 1 ? '' : 'en'} gewählt`
                              : "Qualifikationen auswählen"}
                          </span>
                          {isQualificationDataLoading ? (
                            <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin text-slate-400" />
                          ) : (
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[320px] p-0" align="end">
                        <Command>
                          <CommandInput placeholder="Qualifikation suchen..." aria-label="Qualifikation suchen" />
                          <CommandList>
                            <CommandEmpty>Keine Qualifikation gefunden.</CommandEmpty>
                            {activeQualifications.map((qualification) => {
                              const isSelected = selectedQualificationIds.includes(qualification.id);
                              return (
                                <CommandItem
                                  key={qualification.id}
                                  value={`${qualification.name} ${qualification.short_label || ''}`}
                                  onSelect={() => handleQualificationToggle(qualification.id)}
                                >
                                  <div className={`flex h-4 w-4 items-center justify-center rounded-sm border ${isSelected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 text-transparent'}`}>
                                    <Check className="h-3 w-3" />
                                  </div>
                                  <Badge
                                    style={{
                                      backgroundColor: qualification.color_bg || '#e0e7ff',
                                      color: qualification.color_text || '#3730a3'
                                    }}
                                    className="border-0 text-[10px]"
                                  >
                                    {qualification.short_label || qualification.name.substring(0, 3).toUpperCase()}
                                  </Badge>
                                  <span className="truncate">{qualification.name}</span>
                                </CommandItem>
                              );
                            })}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>

                    {selectedQualificationIds.length > 0 && (
                      <div className="flex w-full flex-wrap items-center gap-2 sm:justify-end">
                        {selectedQualificationIds.map((qualificationId) => {
                          const qualification = qualificationMap[qualificationId];
                          if (!qualification) return null;

                          return (
                            <button
                              key={qualificationId}
                              type="button"
                              onClick={() => handleQualificationToggle(qualificationId)}
                              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-100"
                            >
                              <span>{qualification.short_label || qualification.name}</span>
                              <X className="h-3 w-3" />
                            </button>
                          );
                        })}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-slate-500"
                          onClick={() => setSelectedQualificationIds([])}
                        >
                          Filter zurücksetzen
                        </Button>
                        <span className="w-full text-[11px] text-slate-400 sm:text-right">
                          Sortierung kann nach dem Zurücksetzen des Filters per Drag-and-drop geändert werden.
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {isLoading ? (
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                      {Array(6).fill(0).map((_, i) => (
                          <Card key={i} className="h-32">
                            <CardContent className="flex gap-4 p-6">
                              <Skeleton className="h-12 w-12 rounded-full" />
                              <div className="space-y-2">
                                <Skeleton className="h-4 w-32" />
                                <Skeleton className="h-4 w-20" />
                              </div>
                            </CardContent>
                          </Card>
                      ))}
                  </div>
                ) : (
                  <DragDropContext onDragEnd={handleDragEnd}>
                      <Droppable droppableId="doctors-list" direction="vertical">
                          {(provided) => (
                              <div
                                  {...provided.droppableProps}
                                  ref={provided.innerRef}
                                  className="grid grid-cols-1 gap-4"
                              >
                                  {filteredDoctors.length === 0 && (
                                    <Card>
                                      <CardContent className="py-10 text-center text-sm text-slate-500">
                                        Keine Teammitglieder mit den ausgewählten Qualifikationen gefunden.
                                      </CardContent>
                                    </Card>
                                  )}
                                  {filteredDoctors.map((doctor, index) => (
                                      <Draggable key={doctor.id} draggableId={doctor.id} index={index} isDragDisabled={isReadOnly || selectedQualificationIds.length > 0}>
                                          {(provided, snapshot) => (
                                              <div
                                                  ref={provided.innerRef}
                                                  {...provided.draggableProps}
                                                  className={`transition-shadow ${snapshot.isDragging ? "z-50" : ""}`}
                                              >
                                                  <Card className={`hover:shadow-md ${snapshot.isDragging ? "shadow-lg ring-2 ring-indigo-500" : ""}`}>
                                                      <CardContent className="flex items-center justify-between p-4">
                                                          <div className="flex flex-1 items-center gap-4">
                                                              {!isReadOnly && (
                                                              <div {...provided.dragHandleProps} className="cursor-grab text-slate-400 hover:text-slate-600 active:cursor-grabbing">
                                                                  <GripVertical className="h-5 w-5" />
                                                              </div>
                                                              )}
                                                              <div
                                                                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold shadow-sm"
                                                                  style={getRoleColor(doctor.role)}
                                                              >
                                                                  {doctor.initials || <User className="h-5 w-5 opacity-50" />}
                                                              </div>
                                                              <div className="flex-1">
                                                                  <h3 className="font-semibold text-slate-900">{doctor.name}</h3>
                                                                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                                                      <Badge variant="secondary" className="text-xs font-normal">
                                                                          {doctor.role}
                                                                      </Badge>
                                                                      <DoctorQualificationBadges
                                                                          doctorId={doctor.id}
                                                                          qualificationMap={qualificationMap}
                                                                          allDoctorQualifications={doctorQualsByDoctor}
                                                                      />
                                                                  </div>
                                                              </div>
                                                          </div>
                                                          <div className="flex space-x-1">
                                                              {!isReadOnly && (
                                                              <>
                                                              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-indigo-600" onClick={() => handleEdit(doctor)}>
                                                                  <Pencil className="h-4 w-4" />
                                                              </Button>
                                                              <AlertDialog>
                                                                  <AlertDialogTrigger asChild>
                                                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600">
                                                                          <Trash2 className="h-4 w-4" />
                                                                      </Button>
                                                                  </AlertDialogTrigger>
                                                                  <AlertDialogContent>
                                                                      <AlertDialogHeader>
                                                                          <AlertDialogTitle>Sind Sie sicher?</AlertDialogTitle>
                                                                          <AlertDialogDescription>
                                                                              Diese Aktion kann nicht rückgängig gemacht werden.
                                                                          </AlertDialogDescription>
                                                                      </AlertDialogHeader>
                                                                      <AlertDialogFooter>
                                                                          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                                                                          <AlertDialogAction onClick={() => deleteMutation.mutate(doctor.id)} className="bg-red-600 hover:bg-red-700">
                                                                              Löschen
                                                                          </AlertDialogAction>
                                                                      </AlertDialogFooter>
                                                                  </AlertDialogContent>
                                                              </AlertDialog>
                                                              </>
                                                              )}
                                                          </div>
                                                      </CardContent>
                                                  </Card>
                                              </div>
                                          )}
                                      </Draggable>
                                  ))}
                                  {provided.placeholder}
                              </div>
                          )}
                      </Droppable>
                  </DragDropContext>
                )}
              </div>
          </TabsContent>

          <TabsContent value="qualifications" className="mt-0 min-h-0 flex-1 overflow-hidden">
              <QualificationOverview doctors={doctors} isReadOnly={isReadOnly} />
          </TabsContent>

          <TabsContent value="staffing" className="mt-0 min-h-0 flex-1 overflow-hidden">
              <div className="h-full overflow-y-auto pr-1">
                <StaffingPlanTable doctors={doctors} isReadOnly={isReadOnly} />
              </div>
          </TabsContent>

      </Tabs>

      {isFormOpen && (
        <DoctorForm
          key={editingDoctor?.id || 'new-doctor'}
          open={isFormOpen}
          onOpenChange={handleFormOpenChange}
          doctor={editingDoctor}
          onSubmit={handleSave}
        />
      )}
    </div>
  );
}
