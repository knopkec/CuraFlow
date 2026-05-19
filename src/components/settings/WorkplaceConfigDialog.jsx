import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { db, base44 } from "@/api/client";
import { 
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings, Plus, Trash2, GripVertical, Loader2, X, FolderPlus, Clock } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import TimeslotEditor from '@/components/admin/TimeslotEditor';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSectionConfig } from '@/components/settings/SectionConfigDialog';
import { getWorkplaceCategoriesFromSettings, categoryAllowsMultiple as getCategoryAllowsMultiple } from '@/utils/workplaceCategoryUtils';

// Service type constants
const SERVICE_TYPES = [
    { value: 1, label: 'Bereitschaftsdienst', short: 'BD', description: 'Vordergrunddienst – Anwesenheitsdienst', color: 'bg-red-100 text-red-700' },
    { value: 2, label: 'Rufbereitschaftsdienst', short: 'RB', description: 'Hintergrunddienst – Rufbereitschaft', color: 'bg-orange-100 text-orange-700' },
    { value: 3, label: 'Schichtdienst', short: 'SD', description: 'Regulärer Schichtdienst', color: 'bg-blue-100 text-blue-700' },
    { value: 4, label: 'Andere Kategorie', short: 'AK', description: 'Sonstige Dienstform', color: 'bg-slate-100 text-slate-700' },
];

export { SERVICE_TYPES };
import WorkplaceQualificationEditor from '@/components/settings/WorkplaceQualificationEditor';

// Default categories that always exist
const DEFAULT_CATEGORIES = ["Rotationen", "Demonstrationen & Konsile", "Dienste"];

export default function WorkplaceConfigDialog({ defaultTab = "Rotationen" }) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState(defaultTab);
    const queryClient = useQueryClient();
    const [localItems, setLocalItems] = useState([]);
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [isRenaming, setIsRenaming] = useState(false);
    const [showAddCategory, setShowAddCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState("");
    const [newCategoryAllowsMultiple, setNewCategoryAllowsMultiple] = useState(true);
    const { getSectionName } = useSectionConfig();

    const { data: workplaces = [], isLoading } = useQuery({
        queryKey: ['workplaces'],
        queryFn: () => db.Workplace.list(null, 1000),
    });

    const { data: settings = [] } = useQuery({
        queryKey: ['systemSettings'],
        queryFn: () => db.SystemSetting.list(),
    });

    const customCategories = useMemo(() => getWorkplaceCategoriesFromSettings(settings), [settings]);

    // Category names for tab display and lookup
    const customCategoryNames = useMemo(() => customCategories.map(c => c.name), [customCategories]);

    // All available categories (defaults + custom)
    const allCategories = useMemo(() => {
        return [...DEFAULT_CATEGORIES, ...customCategoryNames];
    }, [customCategoryNames]);

    const updateSettingMutation = useMutation({
        mutationFn: async ({ key, value }) => {
            const existing = settings.find(s => s.key === key);
            if (existing) {
                return db.SystemSetting.update(existing.id, { value });
            } else {
                return db.SystemSetting.create({ key, value });
            }
        },
        onSuccess: () => queryClient.invalidateQueries(['systemSettings'])
    });

    useEffect(() => {
        if (workplaces.length > 0) {
            const filtered = workplaces
                .filter(w => w.category === activeTab)
                .sort((a, b) => (a.order || 0) - (b.order || 0));
            setLocalItems(filtered);
        }
    }, [workplaces, activeTab]);

    const createMutation = useMutation({
        mutationFn: (data) => db.Workplace.create(data),
        onSuccess: () => queryClient.invalidateQueries(['workplaces'])
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => db.Workplace.update(id, data),
        onSuccess: () => queryClient.invalidateQueries(['workplaces'])
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => db.Workplace.delete(id),
        onSuccess: () => queryClient.invalidateQueries(['workplaces'])
    });

    const renamePositionMutation = useMutation({
        mutationFn: async ({ oldName, newName }) => {
            // Call backend function
            return base44.functions.invoke('renamePosition', { oldName, newName });
        }
    });

    const handleDragEnd = (result) => {
        if (!result.destination) return;
        
        const items = Array.from(localItems);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);
        
        setLocalItems(items);

        // Persist order
        items.forEach((item, index) => {
            if (item.order !== index + 1) {
                updateMutation.mutate({ id: item.id, data: { order: index + 1 } });
            }
        });
    };

    const handleAddNew = () => {
        const newItem = {
            name: "Neue Position",
            category: activeTab,
            order: localItems.length + 1,
            active_days: [1, 2, 3, 4, 5], // Mo-Fr default
            time: "",
            allows_multiple: categoryAllowsMultiple(activeTab)
        };
        createMutation.mutate(newItem);
    };

    const handleAddCategory = async () => {
        const trimmedName = newCategoryName.trim();
        if (!trimmedName) {
            toast.error("Bitte geben Sie einen Namen ein");
            return;
        }
        if (allCategories.includes(trimmedName)) {
            toast.error("Diese Kategorie existiert bereits");
            return;
        }
        
        const newCategories = [...customCategories, { name: trimmedName, allows_multiple: newCategoryAllowsMultiple }];
        await updateSettingMutation.mutateAsync({ 
            key: 'workplace_categories', 
            value: JSON.stringify(newCategories) 
        });
        
        setNewCategoryName("");
        setNewCategoryAllowsMultiple(true);
        setShowAddCategory(false);
        setActiveTab(trimmedName);
        toast.success(`Kategorie "${trimmedName}" wurde erstellt`);
    };

    const handleDeleteCategory = async (categoryName) => {
        // Check if category has items
        const itemsInCategory = workplaces.filter(w => w.category === categoryName);
        
        if (itemsInCategory.length > 0) {
            if (!confirm(`Die Kategorie "${categoryName}" enthält ${itemsInCategory.length} Einträge. Diese werden ebenfalls gelöscht. Fortfahren?`)) {
                return;
            }
            // Delete all items in category
            for (const item of itemsInCategory) {
                await deleteMutation.mutateAsync(item.id);
            }
        }
        
        const newCategories = customCategories.filter(c => c.name !== categoryName);
        await updateSettingMutation.mutateAsync({ 
            key: 'workplace_categories', 
            value: JSON.stringify(newCategories) 
        });
        
        setActiveTab("Rotationen");
        toast.success(`Kategorie "${categoryName}" wurde gelöscht`);
    };

    const handleSaveEdit = async () => {
        if (!editingId) return;
        
        const originalItem = workplaces.find(w => w.id === editingId);
        const nameChanged = originalItem.name !== editForm.name;

        setIsRenaming(true);
        try {
            if (nameChanged) {
                await renamePositionMutation.mutateAsync({ 
                    oldName: originalItem.name, 
                    newName: editForm.name 
                });
            }

            await updateMutation.mutateAsync({ id: editingId, data: editForm });
            setEditingId(null);
            setEditForm({});
        } catch (error) {
            console.error("Error saving:", error);
            alert("Fehler beim Speichern: " + error.message);
        } finally {
            setIsRenaming(false);
        }
    };

    const handleDelete = (item) => {
        if (confirm(`Möchten Sie "${item.name}" wirklich löschen? Bestehende Dienste mit diesem Namen bleiben erhalten, werden aber nicht mehr im Plan angezeigt.`)) {
            deleteMutation.mutate(item.id);
        }
    };

    const toggleDay = (dayIndex) => {
        const currentDays = editForm.active_days || [];
        const newDays = currentDays.includes(dayIndex)
            ? currentDays.filter(d => d !== dayIndex)
            : [...currentDays, dayIndex];
        setEditForm({ ...editForm, active_days: newDays });
    };

    const startEdit = (item) => {
        setEditingId(item.id);
        setEditForm({ ...item });
    };

    // Check if current tab is a custom category
    const isCustomCategory = customCategoryNames.includes(activeTab);

    // Helper: Erlaubt diese Kategorie Mehrfachbesetzung?
    const categoryAllowsMultiple = (categoryName) => {
        return getCategoryAllowsMultiple(categoryName, customCategories);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="icon" title={`${getSectionName('Rotationen')} & ${getSectionName('Demonstrationen & Konsile')} konfigurieren`}>
                    <Settings className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Konfiguration: Arbeitsplätze & Dienste</DialogTitle>
                </DialogHeader>
                
                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
                    <div className="flex items-center gap-2">
                        <ScrollArea className="flex-1">
                            <TabsList className="inline-flex h-10 items-center justify-start rounded-md bg-muted p-1 text-muted-foreground w-auto">
                                {/* Default categories */}
                                <TabsTrigger value="Rotationen" className="text-xs">{getSectionName('Rotationen')}</TabsTrigger>
                                <TabsTrigger value="Demonstrationen & Konsile" className="text-xs">{getSectionName('Demonstrationen & Konsile')}</TabsTrigger>
                                <TabsTrigger value="Dienste" className="text-xs">{getSectionName('Dienste')}</TabsTrigger>
                                
                                {/* Custom categories */}
                                {customCategoryNames.map(cat => (
                                    <TabsTrigger key={cat} value={cat} className="text-xs group relative">
                                        {cat}
                                    </TabsTrigger>
                                ))}
                                
                                <TabsTrigger value="Einstellungen" className="text-xs">⚙ Limits</TabsTrigger>
                            </TabsList>
                        </ScrollArea>
                        
                        {/* Add category button */}
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 shrink-0"
                            onClick={() => setShowAddCategory(true)}
                            title="Neue Kategorie hinzufügen"
                        >
                            <FolderPlus className="w-4 h-4" />
                        </Button>
                    </div>

                    {/* Add category input */}
                    {showAddCategory && (
                        <div className="space-y-2 py-2 px-3 bg-slate-50 rounded-md mt-2">
                            <div className="flex items-center gap-2">
                                <Input
                                    placeholder="Name der neuen Kategorie (z.B. OP Säle)"
                                    value={newCategoryName}
                                    onChange={(e) => setNewCategoryName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                                    className="flex-1"
                                    autoFocus
                                />
                                <Button size="sm" onClick={handleAddCategory}>
                                    <Plus className="w-4 h-4 mr-1" /> Erstellen
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => { setShowAddCategory(false); setNewCategoryName(""); setNewCategoryAllowsMultiple(true); }}>
                                    <X className="w-4 h-4" />
                                </Button>
                            </div>
                            <div className="flex items-center gap-2 pl-1">
                                <Switch
                                    checked={newCategoryAllowsMultiple}
                                    onCheckedChange={setNewCategoryAllowsMultiple}
                                />
                                <Label className="text-sm text-slate-600">Mehrfachbesetzung erlauben</Label>
                                <span className="text-xs text-slate-400">
                                    {newCategoryAllowsMultiple 
                                        ? '(Mehrere Mitarbeiter pro Tag/Position)' 
                                        : '(Nur ein Mitarbeiter pro Tag/Position)'
                                    }
                                </span>
                            </div>
                        </div>
                    )}

                    {activeTab !== 'Einstellungen' ? (
                        <>
                        <div className="flex justify-between items-center py-2">
                             {/* Delete category button (only for custom categories) */}
                             {isCustomCategory && (
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                    onClick={() => handleDeleteCategory(activeTab)}
                                >
                                    <Trash2 className="w-4 h-4 mr-1" /> Kategorie löschen
                                </Button>
                             )}
                             {!isCustomCategory && <div />}
                             
                             <Button onClick={handleAddNew} size="sm" className="gap-2">
                                <Plus className="w-4 h-4" /> Neu anlegen
                             </Button>
                        </div>

                        <TabsContent value={activeTab} className="flex-1 overflow-hidden flex flex-col mt-0 min-h-0">
                            <ScrollArea className="h-full pr-4">
                                <DragDropContext onDragEnd={handleDragEnd}>
                                    <Droppable droppableId="workplaces">
                                        {(provided) => (
                                            <div
                                                {...provided.droppableProps}
                                                ref={provided.innerRef}
                                                className="space-y-2"
                                            >
                                                {localItems.map((item, index) => (
                                                    <Draggable key={item.id} draggableId={item.id} index={index}>
                                                        {(provided) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                className={cn(
                                                                    "border rounded-lg bg-white p-3 shadow-sm group",
                                                                    editingId === item.id ? "ring-2 ring-indigo-500" : "hover:border-indigo-200"
                                                                )}
                                                            >
                                                                {editingId === item.id ? (
                                                                    <div className="space-y-4">
                                                                        <div className="grid grid-cols-2 gap-4">
                                                                            <div className="space-y-2">
                                                                                <Label>Bezeichnung</Label>
                                                                                <Input 
                                                                                    value={editForm.name} 
                                                                                    onChange={e => setEditForm({...editForm, name: e.target.value})}
                                                                                />
                                                                            </div>
                                                                            {activeTab === "Demonstrationen & Konsile" && (
                                                                                <div className="space-y-2">
                                                                                    <Label>Uhrzeit (Optional)</Label>
                                                                                    <Input 
                                                                                        value={editForm.time || ''} 
                                                                                        onChange={e => setEditForm({...editForm, time: e.target.value})}
                                                                                        placeholder="z.B. 14:30"
                                                                                    />
                                                                                </div>
                                                                            )}
                                                                        </div>

                                                                        {activeTab === "Dienste" && (
                                                                            <>
                                                                            <div className="p-3 border rounded bg-indigo-50 space-y-2">
                                                                                <div className="space-y-0.5">
                                                                                    <Label className="text-base">Diensttyp</Label>
                                                                                    <div className="text-xs text-slate-500">
                                                                                        Bestimmt die Limit-Prüfung und Autofill-Verteilung.
                                                                                    </div>
                                                                                </div>
                                                                                <Select
                                                                                    value={String(editForm.service_type || '')}
                                                                                    onValueChange={(val) => setEditForm({...editForm, service_type: parseInt(val)})}
                                                                                >
                                                                                    <SelectTrigger className="bg-white">
                                                                                        <SelectValue placeholder="Diensttyp wählen..." />
                                                                                    </SelectTrigger>
                                                                                    <SelectContent>
                                                                                        {SERVICE_TYPES.map(t => (
                                                                                            <SelectItem key={t.value} value={String(t.value)}>
                                                                                                <span className="font-medium">{t.label}</span>
                                                                                                <span className="text-xs text-slate-500 ml-2">({t.description})</span>
                                                                                            </SelectItem>
                                                                                        ))}
                                                                                    </SelectContent>
                                                                                </Select>
                                                                            </div>
                                                                            <div className="flex items-center justify-between p-3 border rounded bg-slate-50">
                                                                                <div className="space-y-0.5">
                                                                                    <Label className="text-base">Autom. Freistellen</Label>
                                                                                    <div className="text-xs text-slate-500">
                                                                                        Mitarbeiter erhält am folgenden Werktag automatisch "Frei".
                                                                                    </div>
                                                                                </div>
                                                                                <Switch
                                                                                    checked={editForm.auto_off || false}
                                                                                    onCheckedChange={(checked) => setEditForm({...editForm, auto_off: checked})}
                                                                                />
                                                                            </div>
                                                                            <div className="flex items-center justify-between p-3 border rounded bg-slate-50">
                                                                                <div className="space-y-0.5">
                                                                                    <Label className="text-base">Rotation erlaubt</Label>
                                                                                    <div className="text-xs text-slate-500">
                                                                                        Kann parallel zu einer Tagesrotation (z.B. CT) zugewiesen werden.
                                                                                    </div>
                                                                                </div>
                                                                                <Switch
                                                                                    checked={editForm.allows_rotation_concurrently || false}
                                                                                    onCheckedChange={(checked) => setEditForm({...editForm, allows_rotation_concurrently: checked})}
                                                                                />
                                                                            </div>
                                                                            <div className="flex items-center justify-between p-3 border rounded bg-slate-50">
                                                                                <div className="space-y-0.5">
                                                                                    <Label className="text-base">Gleichzeitige Abwesenheit erlauben</Label>
                                                                                    <div className="text-xs text-slate-500">
                                                                                        Dieser Dienst darf trotz bestehender Abwesenheit am selben Tag zugewiesen werden.
                                                                                    </div>
                                                                                </div>
                                                                                <Switch
                                                                                    checked={editForm.allows_absence_overlap || false}
                                                                                    onCheckedChange={(checked) => setEditForm({...editForm, allows_absence_overlap: checked})}
                                                                                />
                                                                            </div>
                                                                            <div className="p-3 border rounded bg-slate-50 space-y-2">
                                                                                <div className="space-y-0.5">
                                                                                    <Label className="text-base">Aufeinanderfolgende Tage</Label>
                                                                                    <div className="text-xs text-slate-500">
                                                                                        Darf dem gleichen Arzt an aufeinanderfolgenden Tagen zugewiesen werden?
                                                                                    </div>
                                                                                </div>
                                                                                <ToggleGroup
                                                                                    type="single"
                                                                                    value={editForm.consecutive_days_mode || (editForm.allows_consecutive_days === false ? 'forbidden' : 'allowed')}
                                                                                    onValueChange={(val) => { if (val) setEditForm({...editForm, consecutive_days_mode: val, allows_consecutive_days: val !== 'forbidden'}); }}
                                                                                    className="justify-start"
                                                                                >
                                                                                    <ToggleGroupItem value="forbidden" className="text-xs px-3 data-[state=on]:bg-red-100 data-[state=on]:text-red-700">
                                                                                        Verboten
                                                                                    </ToggleGroupItem>
                                                                                    <ToggleGroupItem value="allowed" className="text-xs px-3 data-[state=on]:bg-green-100 data-[state=on]:text-green-700">
                                                                                        Erlaubt
                                                                                    </ToggleGroupItem>
                                                                                    <ToggleGroupItem value="preferred" className="text-xs px-3 data-[state=on]:bg-blue-100 data-[state=on]:text-blue-700">
                                                                                        Bevorzugt
                                                                                    </ToggleGroupItem>
                                                                                </ToggleGroup>
                                                                                <div className="text-xs text-slate-400 mt-1">
                                                                                    {(editForm.consecutive_days_mode || (editForm.allows_consecutive_days === false ? 'forbidden' : 'allowed')) === 'forbidden' && 'Gleicher Arzt darf nicht an aufeinanderfolgenden Tagen eingeteilt werden.'}
                                                                                    {(editForm.consecutive_days_mode || (editForm.allows_consecutive_days === false ? 'forbidden' : 'allowed')) === 'allowed' && 'Aufeinanderfolgende Tage sind möglich, werden aber weder angestrebt noch vermieden.'}
                                                                                    {(editForm.consecutive_days_mode || (editForm.allows_consecutive_days === false ? 'forbidden' : 'allowed')) === 'preferred' && 'Aufeinanderfolgende Tage werden aktiv bevorzugt (z.B. ganzes Wochenende am Stück).'}
                                                                                </div>
                                                                                </div>

                                                                                <div className="p-3 border rounded bg-slate-50 space-y-2">
                                                                                    <div className="space-y-0.5">
                                                                                        <Label className="text-base">Arbeitszeit-Anteil</Label>
                                                                                        <div className="text-xs text-slate-500">
                                                                                            Prozentsatz der Arbeitszeit für Statistik (z.B. Rufbereitschaft = 70%)
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="flex items-center gap-2">
                                                                                        <Input
                                                                                            type="number"
                                                                                            min="0"
                                                                                            max="100"
                                                                                            step="5"
                                                                                            value={editForm.work_time_percentage ?? 100}
                                                                                            onChange={(e) => setEditForm({...editForm, work_time_percentage: parseFloat(e.target.value) || 100})}
                                                                                            className="w-20"
                                                                                        />
                                                                                        <span className="text-sm text-slate-500">%</span>
                                                                                    </div>
                                                                                </div>

                                                                                <div className="space-y-2">
                                                                                    <Label>Aktive Tage</Label>
                                                                                    <div className="text-xs text-slate-500 mb-1">
                                                                                        An welchen Wochentagen kann dieser Dienst besetzt werden?
                                                                                    </div>
                                                                                    <div className="flex gap-1">
                                                                                        {['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'].map((day, i) => (
                                                                                            <button
                                                                                                key={i}
                                                                                                type="button"
                                                                                                onClick={() => toggleDay(i)}
                                                                                                className={cn(
                                                                                                    "w-8 h-8 rounded-full text-xs font-medium transition-colors",
                                                                                                    (editForm.active_days || []).includes(i)
                                                                                                        ? "bg-indigo-600 text-white"
                                                                                                        : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                                                                                )}
                                                                                            >
                                                                                                {day[0]}
                                                                                            </button>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                                </>
                                                                                )}

                                                                        {activeTab === "Demonstrationen & Konsile" && (
                                                                            <div className="space-y-4">
                                                                                <div className="space-y-2">
                                                                                    <Label>Aktive Tage</Label>
                                                                                    <div className="flex gap-1">
                                                                                        {['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'].map((day, i) => (
                                                                                            <button
                                                                                                key={i}
                                                                                                type="button"
                                                                                                onClick={() => toggleDay(i)}
                                                                                                className={cn(
                                                                                                    "w-8 h-8 rounded-full text-xs font-medium transition-colors",
                                                                                                    (editForm.active_days || []).includes(i)
                                                                                                        ? "bg-indigo-600 text-white"
                                                                                                        : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                                                                                )}
                                                                                            >
                                                                                                {day[0]}
                                                                                            </button>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                                <div className="flex items-center justify-between p-3 border rounded bg-slate-50">
                                                                                    <div className="space-y-0.5">
                                                                                        <Label className="text-base">Im Dienstplan anzeigen</Label>
                                                                                        <div className="text-xs text-slate-500">
                                                                                            Erscheint zusätzlich im Reiter "Dienstbesetzung"
                                                                                        </div>
                                                                                    </div>
                                                                                    <Switch
                                                                                        checked={editForm.show_in_service_plan || false}
                                                                                        onCheckedChange={(checked) => setEditForm({...editForm, show_in_service_plan: checked})}
                                                                                    />
                                                                                </div>
                                                                                <div className="flex items-center justify-between p-3 border rounded bg-amber-50">
                                                                                    <div className="space-y-0.5">
                                                                                        <Label className="text-base">Verfügbarkeit beeinflussen</Label>
                                                                                        <div className="text-xs text-slate-500">
                                                                                            Wenn deaktiviert: Mitarbeiter bleibt "Verfügbar" trotz Einteilung.
                                                                                            Nur Abwesenheits-Konflikte werden geprüft.
                                                                                        </div>
                                                                                    </div>
                                                                                    <Switch
                                                                                        checked={editForm.affects_availability !== false} // Default true
                                                                                        onCheckedChange={(checked) => setEditForm({...editForm, affects_availability: checked})}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        )}

                                                                        {/* Custom category options - basic settings */}
                                                                        {isCustomCategory && (
                                                                            <div className="space-y-4">
                                                                                <div className="space-y-2">
                                                                                    <Label>Aktive Tage</Label>
                                                                                    <div className="flex gap-1">
                                                                                        {['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'].map((day, i) => (
                                                                                            <button
                                                                                                key={i}
                                                                                                type="button"
                                                                                                onClick={() => toggleDay(i)}
                                                                                                className={cn(
                                                                                                    "w-8 h-8 rounded-full text-xs font-medium transition-colors",
                                                                                                    (editForm.active_days || []).includes(i)
                                                                                                        ? "bg-indigo-600 text-white"
                                                                                                        : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                                                                                )}
                                                                                            >
                                                                                                {day[0]}
                                                                                            </button>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                                <div className="flex items-center justify-between p-3 border rounded bg-slate-50">
                                                                                    <div className="space-y-0.5">
                                                                                        <Label className="text-base">Im Dienstplan anzeigen</Label>
                                                                                        <div className="text-xs text-slate-500">
                                                                                            Erscheint zusätzlich im Reiter "Dienstbesetzung"
                                                                                        </div>
                                                                                    </div>
                                                                                    <Switch
                                                                                        checked={editForm.show_in_service_plan || false}
                                                                                        onCheckedChange={(checked) => setEditForm({...editForm, show_in_service_plan: checked})}
                                                                                    />
                                                                                </div>
                                                                                <div className="flex items-center justify-between p-3 border rounded bg-amber-50">
                                                                                    <div className="space-y-0.5">
                                                                                        <Label className="text-base">Verfügbarkeit beeinflussen</Label>
                                                                                        <div className="text-xs text-slate-500">
                                                                                            Wenn deaktiviert: Mitarbeiter bleibt "Verfügbar" trotz Einteilung.
                                                                                            Nur Abwesenheits-Konflikte werden geprüft.
                                                                                        </div>
                                                                                    </div>
                                                                                    <Switch
                                                                                        checked={editForm.affects_availability !== false} // Default true
                                                                                        onCheckedChange={(checked) => setEditForm({...editForm, affects_availability: checked})}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        )}

                                                                        {/* Aktive Tage für Rotationen */}
                                                                        {activeTab === "Rotationen" && (
                                                                            <div className="space-y-2">
                                                                                <Label>Aktive Tage</Label>
                                                                                <div className="text-xs text-slate-500 mb-1">
                                                                                    An welchen Wochentagen kann diese Rotation besetzt werden?
                                                                                </div>
                                                                                <div className="flex gap-1">
                                                                                    {['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'].map((day, i) => (
                                                                                        <button
                                                                                            key={i}
                                                                                            type="button"
                                                                                            onClick={() => toggleDay(i)}
                                                                                            className={cn(
                                                                                                "w-8 h-8 rounded-full text-xs font-medium transition-colors",
                                                                                                (editForm.active_days || []).includes(i)
                                                                                                    ? "bg-indigo-600 text-white"
                                                                                                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                                                                            )}
                                                                                        >
                                                                                            {day[0]}
                                                                                        </button>
                                                                                    ))}
                                                                                </div>
                                                                            </div>
                                                                        )}

                                                                        {/* Zeitfenster-Sektion - für ALLE Kategorien verfügbar */}
                                                                        <div className="pt-4 border-t space-y-4">
                                                                            <div className="flex items-center justify-between p-3 border rounded bg-slate-50">
                                                                                <div className="space-y-0.5">
                                                                                    <Label className="text-base">Mehrfachbesetzung</Label>
                                                                                    <div className="text-xs text-slate-500">
                                                                                        Mehrere Mitarbeiter können gleichzeitig pro Tag eingeteilt werden (z.B. für Ausbildung).
                                                                                    </div>
                                                                                </div>
                                                                                <Switch
                                                                                    checked={editForm.allows_multiple ?? categoryAllowsMultiple(activeTab)}
                                                                                    onCheckedChange={(checked) => setEditForm({...editForm, allows_multiple: checked})}
                                                                                />
                                                                            </div>

                                                                            {/* Besetzungszahlen für Auto-Fill */}
                                                                            {(editForm.allows_multiple ?? categoryAllowsMultiple(activeTab)) && (
                                                                                <div className="grid grid-cols-2 gap-3 p-3 border rounded bg-amber-50">
                                                                                    <div className="space-y-1">
                                                                                        <Label className="text-sm">Min. Besetzung</Label>
                                                                                        <div className="text-xs text-slate-500">0 = kann leer bleiben</div>
                                                                                        <Input
                                                                                            type="number"
                                                                                            min="0"
                                                                                            max="20"
                                                                                            value={editForm.min_staff ?? 1}
                                                                                            onChange={(e) => setEditForm({...editForm, min_staff: parseInt(e.target.value) || 0})}
                                                                                            className="h-8 w-20"
                                                                                        />
                                                                                    </div>
                                                                                    <div className="space-y-1">
                                                                                        <Label className="text-sm">Opt. Besetzung</Label>
                                                                                        <div className="text-xs text-slate-500">Zielanzahl für Auto-Fill</div>
                                                                                        <Input
                                                                                            type="number"
                                                                                            min="0"
                                                                                            max="20"
                                                                                            value={editForm.optimal_staff ?? 1}
                                                                                            onChange={(e) => setEditForm({...editForm, optimal_staff: parseInt(e.target.value) || 1})}
                                                                                            className="h-8 w-20"
                                                                                        />
                                                                                    </div>
                                                                                </div>
                                                                            )}

                                                                            <div className="flex items-center justify-between p-3 border rounded bg-indigo-50">
                                                                                <div className="space-y-0.5">
                                                                                    <Label className="text-base flex items-center gap-2">
                                                                                        <Clock className="w-4 h-4" />
                                                                                        Zeitfenster aktivieren
                                                                                    </Label>
                                                                                    <div className="text-xs text-slate-500">
                                                                                        Ermöglicht die Besetzung mit wechselnden Teams über den Tag (z.B. Früh-/Spätdienst)
                                                                                    </div>
                                                                                </div>
                                                                                <Switch
                                                                                    checked={editForm.timeslots_enabled || false}
                                                                                    onCheckedChange={(checked) => setEditForm({...editForm, timeslots_enabled: checked})}
                                                                                />
                                                                            </div>
                                                                            
                                                                            {editForm.timeslots_enabled && editForm.id && (
                                                                                <TimeslotEditor 
                                                                                    workplaceId={editForm.id}
                                                                                    defaultTolerance={editForm.default_overlap_tolerance_minutes || 15}
                                                                                />
                                                                            )}
                                                                            
                                                                            {editForm.timeslots_enabled && !editForm.id && (
                                                                                <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
                                                                                    Speichern Sie zuerst, um Zeitfenster hinzuzufügen.
                                                                                </div>
                                                                            )}
                                                                        </div>

                                                                        {/* Qualifikationsanforderungen für diesen Arbeitsplatz/Dienst */}
                                                                        <div className="pt-4 border-t">
                                                                            <WorkplaceQualificationEditor workplaceId={editForm.id} />
                                                                        </div>

                                                                        <div className="flex justify-end gap-2 pt-2">
                                                                            <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>Abbrechen</Button>
                                                                            <Button size="sm" onClick={handleSaveEdit} disabled={isRenaming}>
                                                                                {isRenaming && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
                                                                                Speichern
                                                                            </Button>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-3">
                                                                        <div {...provided.dragHandleProps} className="cursor-grab text-slate-400 hover:text-slate-600">
                                                                            <GripVertical className="w-5 h-5" />
                                                                        </div>
                                                                        <div className="flex-1 min-w-0">
                                                                            <div className="font-medium text-slate-900 flex items-center gap-2 flex-wrap">
                                                                                {item.name}
                                                                                {item.time && <Badge variant="outline" className="text-[10px] font-normal">{item.time} Uhr</Badge>}
                                                                                {item.service_type && (() => { const st = SERVICE_TYPES.find(t => t.value === item.service_type); return st ? <Badge variant="secondary" className={`text-[10px] font-normal ${st.color}`}>{st.label}</Badge> : null; })()}
                                                                                {item.auto_off && <Badge variant="secondary" className="text-[10px] font-normal bg-blue-100 text-blue-700">Auto-Frei</Badge>}
                                                                                {item.allows_rotation_concurrently && <Badge variant="secondary" className="text-[10px] font-normal bg-green-100 text-green-700">Rotation OK</Badge>}
                                                                                {item.allows_absence_overlap && <Badge variant="secondary" className="text-[10px] font-normal bg-violet-100 text-violet-700">Abwesenheit OK</Badge>}
                                                                                {item.allows_multiple && <Badge variant="secondary" className="text-[10px] font-normal bg-teal-100 text-teal-700">Mehrfachbesetzung</Badge>}
                                                                                {item.allows_multiple && (item.min_staff > 0 || item.optimal_staff > 1) && (
                                                                                    <Badge variant="secondary" className="text-[10px] font-normal bg-amber-100 text-amber-700">
                                                                                        {item.min_staff ?? 1}–{item.optimal_staff ?? 1}
                                                                                    </Badge>
                                                                                )}
                                                                                {item.show_in_service_plan && <Badge variant="secondary" className="text-[10px] font-normal bg-purple-100 text-purple-700">Dienstplan</Badge>}
                                                                                {item.affects_availability === false && <Badge variant="secondary" className="text-[10px] font-normal bg-amber-100 text-amber-700">Nicht verfügbarkeitsrelevant</Badge>}
                                                                            </div>
                                                                            {item.active_days && item.active_days.length > 0 && !(item.active_days.length === 5 && [1,2,3,4,5].every(d => item.active_days.includes(d))) && (
                                                                                <div className="flex gap-1 mt-1">
                                                                                    {['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'].map((day, i) => (
                                                                                        <div 
                                                                                            key={i} 
                                                                                            className={cn(
                                                                                                "w-4 h-4 rounded-full text-[8px] flex items-center justify-center",
                                                                                                item.active_days.includes(i) 
                                                                                                    ? "bg-slate-200 text-slate-700 font-bold" 
                                                                                                    : "text-slate-300"
                                                                                            )}
                                                                                        >
                                                                                            {day[0]}
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(item)}>
                                                                                <Settings className="w-4 h-4" />
                                                                            </Button>
                                                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => handleDelete(item)}>
                                                                                <Trash2 className="w-4 h-4" />
                                                                            </Button>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                ))}
                                                {provided.placeholder}
                                            </div>
                                        )}
                                    </Droppable>
                                </DragDropContext>
                            </ScrollArea>
                        </TabsContent>
                        </>
                    ) : (
                        <TabsContent value="Einstellungen" className="flex-1 overflow-hidden flex flex-col mt-0 min-h-0 pt-4">
                        <ScrollArea className="h-full pr-4">
                            <div className="space-y-4 p-1">
                                <div className="border p-3 rounded-lg bg-slate-50 space-y-3">
                                    <div className="space-y-0.5">
                                        <Label>Grenzwerte für Dienste (Warnung pro Person/Monat)</Label>
                                        <p className="text-xs text-slate-500">Maximale Anzahl an Diensten bevor eine Warnung erscheint. Gilt anhand des Diensttyps der jeweiligen Arbeitsplätze.</p>
                                    </div>
                                    <div className="grid grid-cols-1 gap-4">
                                        <div className="space-y-2">
                                            <Label className="text-sm">Max. Bereitschaftsdienste (Vordergrund)</Label>
                                            <p className="text-xs text-slate-400">Gilt für alle Dienste mit Typ "Bereitschaftsdienst"</p>
                                            <Input 
                                                type="number" 
                                                min="0"
                                                defaultValue={settings.find(s => s.key === 'limit_fore_services')?.value || '4'}
                                                onBlur={(e) => updateSettingMutation.mutate({ key: 'limit_fore_services', value: e.target.value })}
                                                className="bg-white"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-sm">Max. Wochenenddienste (Bereitschaftsdienst)</Label>
                                            <Input 
                                                type="number" 
                                                min="0"
                                                defaultValue={settings.find(s => s.key === 'limit_weekend_services')?.value || '1'}
                                                onBlur={(e) => updateSettingMutation.mutate({ key: 'limit_weekend_services', value: e.target.value })}
                                                className="bg-white"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-sm">Max. Rufbereitschaftsdienste (Hintergrund)</Label>
                                            <p className="text-xs text-slate-400">Gilt für alle Dienste mit Typ "Rufbereitschaftsdienst"</p>
                                            <Input 
                                                type="number" 
                                                min="0"
                                                defaultValue={settings.find(s => s.key === 'limit_back_services')?.value || '12'}
                                                onBlur={(e) => updateSettingMutation.mutate({ key: 'limit_back_services', value: e.target.value })}
                                                className="bg-white"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </ScrollArea>
                    </TabsContent>
                    )}
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}