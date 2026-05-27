import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
    MousePointerClick, 
    Copy, 
    Trash2, 
    CalendarDays, 
    Users, 
    Keyboard,
    Move,
    AlertTriangle,
    HelpCircle,
    Grab,
    Calendar,
    BarChart3,
    Heart,
    GraduationCap,
    LayoutDashboard,
    Settings,
    Clock,
    Briefcase,
    Mail,
    Undo2,
    Eye,
    EyeOff,
    Printer,
    Download,
    CheckCircle2,
    XCircle,
    Bell,
    Shield,
    Database,
    Palette,
    Percent
} from 'lucide-react';
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';

// Farben für Rollen basierend auf Priority
const ROLE_COLORS = [
    'bg-red-100 text-red-700',      // 0 - Chefarzt
    'bg-orange-100 text-orange-700', // 1 - Oberarzt
    'bg-blue-100 text-blue-700',     // 2 - Facharzt
    'bg-green-100 text-green-700',   // 3 - Assistenzarzt
    'bg-slate-100 text-slate-700',   // 4+ - andere
];

function getRoleColor(priority) {
    return ROLE_COLORS[Math.min(priority ?? 4, ROLE_COLORS.length - 1)];
}

export default function HelpPage() {
    const { teamRoles } = useTeamRoles();
    
    return (
        <div className="container mx-auto max-w-5xl space-y-8 pb-10">
            <div>
                <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                    <HelpCircle className="w-8 h-8 text-indigo-600" />
                    Hilfe & Dokumentation
                </h1>
                <p className="text-slate-500 mt-2 text-lg">Vollständige Anleitung zu allen Modulen und Funktionen von RadioPlan.</p>
            </div>

            <Tabs defaultValue="schedule" className="space-y-6">
                <ScrollArea className="w-full">
                    <TabsList className="w-full justify-start h-auto p-1 bg-slate-100 flex-wrap">
                        <TabsTrigger value="schedule" className="px-4 py-2 text-sm"><CalendarDays className="w-4 h-4 mr-1" />Wochenplan</TabsTrigger>
                        <TabsTrigger value="services" className="px-4 py-2 text-sm"><Briefcase className="w-4 h-4 mr-1" />Dienstbesetzung</TabsTrigger>
                        <TabsTrigger value="vacation" className="px-4 py-2 text-sm"><Calendar className="w-4 h-4 mr-1" />Abwesenheiten</TabsTrigger>
                        <TabsTrigger value="wishes" className="px-4 py-2 text-sm"><Heart className="w-4 h-4 mr-1" />Wunschkiste</TabsTrigger>
                        <TabsTrigger value="staff" className="px-4 py-2 text-sm"><Users className="w-4 h-4 mr-1" />Team</TabsTrigger>
                        <TabsTrigger value="statistics" className="px-4 py-2 text-sm"><BarChart3 className="w-4 h-4 mr-1" />Statistik</TabsTrigger>
                        <TabsTrigger value="training" className="px-4 py-2 text-sm"><GraduationCap className="w-4 h-4 mr-1" />Rotationsplaner</TabsTrigger>
                        <TabsTrigger value="dashboard" className="px-4 py-2 text-sm"><LayoutDashboard className="w-4 h-4 mr-1" />Dashboard</TabsTrigger>
                        <TabsTrigger value="admin" className="px-4 py-2 text-sm"><Settings className="w-4 h-4 mr-1" />Admin</TabsTrigger>
                    </TabsList>
                </ScrollArea>

                {/* ==================== WOCHENPLAN ==================== */}
                <TabsContent value="schedule" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <CalendarDays className="w-6 h-6 text-indigo-600" />
                                Wochenplan - Übersicht
                            </CardTitle>
                            <CardDescription>
                                Die zentrale Planungsoberfläche für alle Personalzuweisungen, Dienste und Abwesenheiten.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="p-4 bg-slate-50 rounded-lg border">
                                    <h4 className="font-semibold mb-2">Ansichtsmodi</h4>
                                    <p className="text-sm text-slate-600">
                                        Wechseln Sie zwischen <strong>Wochenansicht</strong> (7 Tage) und <strong>Tagesansicht</strong> (Detailansicht eines Tages) über die Schaltflächen oben rechts.
                                    </p>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-lg border">
                                    <h4 className="font-semibold mb-2">Sektionen</h4>
                                    <p className="text-sm text-slate-600">
                                        Der Plan ist in Sektionen unterteilt: <strong>Anwesenheiten</strong>, <strong>Abwesenheiten</strong>, <strong>Dienste</strong>, <strong>Rotationen</strong>, <strong>Demonstrationen</strong> und <strong>Sonstiges</strong>. Jede Sektion kann ein-/ausgeklappt werden.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Grab className="w-6 h-6 text-indigo-600" />
                                Drag & Drop Funktionen
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid gap-6 md:grid-cols-2">
                                <div className="p-5 bg-slate-50 rounded-xl border border-slate-200">
                                    <h3 className="font-bold text-slate-900 mb-2 flex items-center gap-2">
                                        <Move className="w-4 h-4" />
                                        Zuweisen & Verschieben
                                    </h3>
                                    <p className="text-sm text-slate-600 leading-relaxed">
                                        Ziehen Sie einen Mitarbeiter aus der <strong>Seitenleiste</strong> in eine Zelle, um ihn zuzuweisen. Bestehende Einträge können per Drag & Drop <strong>verschoben</strong> werden.
                                    </p>
                                </div>
                                <div className="p-5 bg-indigo-50 rounded-xl border border-indigo-100">
                                    <h3 className="font-bold text-indigo-900 mb-2 flex items-center gap-2">
                                        <Copy className="w-4 h-4" />
                                        Kopieren (STRG + Ziehen)
                                    </h3>
                                    <p className="text-sm text-indigo-800 leading-relaxed">
                                        Halten Sie die <strong>STRG-Taste</strong> (oder ⌘ auf Mac) gedrückt, während Sie einen Eintrag ziehen. Der Eintrag wird <strong>kopiert</strong> statt verschoben.
                                    </p>
                                </div>
                            </div>
                            <div className="p-4 border rounded-lg bg-green-50 border-green-100 text-sm text-green-900 flex items-start gap-2">
                                <Undo2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
                                <div>
                                    <strong>Rückgängig (STRG+Z):</strong> Die letzte Aktion kann mit STRG+Z rückgängig gemacht werden.
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Trash2 className="w-6 h-6 text-red-500" />
                                Löschen von Einträgen
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-4 md:grid-cols-3">
                                <div className="space-y-2 p-4 border rounded-lg">
                                    <span className="font-semibold block">Papierkorb</span>
                                    <p className="text-sm text-slate-600">
                                        Ziehen Sie einen Eintrag in den <strong>roten Papierkorb-Bereich</strong>, der beim Ziehen erscheint.
                                    </p>
                                </div>
                                <div className="space-y-2 p-4 border rounded-lg">
                                    <span className="font-semibold block">Zurück zur Seitenleiste</span>
                                    <p className="text-sm text-slate-600">
                                        Ziehen Sie einen Eintrag <strong>zurück in die Personenliste</strong> in der Seitenleiste.
                                    </p>
                                </div>
                                <div className="space-y-2 p-4 border rounded-lg">
                                    <span className="font-semibold block">Zeile/Tag leeren</span>
                                    <p className="text-sm text-slate-600">
                                        Klicken Sie auf das <Trash2 className="w-3 h-3 inline text-red-500" />-Symbol bei Zeilen- oder Spaltenköpfen.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Clock className="w-6 h-6 text-purple-600" />
                                Zeitfenster (Timeslots)
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-slate-600">
                                Arbeitsplätze können in <strong>Zeitfenster</strong> aufgeteilt werden (z.B. Früh- und Spätschicht). Bei aktivierten Timeslots:
                            </p>
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
                                    <h4 className="font-semibold text-purple-900 mb-2 flex items-center gap-2">
                                        <Clock className="w-4 h-4" />
                                        Auswahl beim Einteilen
                                    </h4>
                                    <p className="text-sm text-purple-800">
                                        Arbeitsplätze mit mehreren Zeitfenstern bleiben kompakt. Beim Drag-and-drop in die Zelle erscheint eine Auswahl für das gewünschte Zeitfenster. Bei nur einem Timeslot erfolgt die Zuweisung weiterhin direkt.
                                    </p>
                                </div>
                                <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
                                    <h4 className="font-semibold text-purple-900 mb-2 flex items-center gap-2">
                                        <Users className="w-4 h-4" />
                                        Teamwechsel
                                    </h4>
                                    <p className="text-sm text-purple-800">
                                        Jedes Zeitfenster kann mit unterschiedlichen Mitarbeitern besetzt werden. Die Zeiten werden in der Arbeitszeit-Statistik korrekt berechnet.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <AlertTriangle className="w-6 h-6 text-amber-500" />
                                Automatische Funktionen & Warnungen
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-4">
                                <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                                    <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                                        <Badge variant="secondary" className="bg-blue-100 text-blue-700">Auto-Frei</Badge>
                                        Automatischer Freizeitausgleich
                                    </h3>
                                    <p className="text-sm text-blue-800">
                                        Bestimmte Dienste lösen automatisch einen <strong>Freizeitausgleich am Folgetag</strong> aus, aber nur wenn dieser Tag weder Samstag, Sonntag noch ein Feiertag ist. Wird der Dienst gelöscht, verschwindet auch das "Frei".
                                    </p>
                                </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="border p-4 rounded-lg bg-amber-50/50 border-amber-100">
                                    <span className="font-medium text-sm block mb-2 text-amber-800 flex items-center gap-1">
                                        <AlertTriangle className="w-4 h-4" />
                                        Gelbes Warndreieck
                                    </span>
                                    <p className="text-xs text-slate-600">
                                        Erscheint neben dem Datum, wenn Personal verfügbar ist, aber nicht eingeteilt wurde. Klicken zum Anzeigen, wer noch frei ist.
                                    </p>
                                </div>
                                <div className="border p-4 rounded-lg bg-red-50/50 border-red-100">
                                    <span className="font-medium text-sm block mb-2 text-red-800 flex items-center gap-1">
                                        <XCircle className="w-4 h-4" />
                                        Konflikterkennung
                                    </span>
                                    <p className="text-xs text-slate-600">
                                        Das System verhindert ungültige Zuweisungen (z.B. Person ist bereits krank oder im Urlaub). Bei Doppelbelegungen wird der alte Eintrag ersetzt.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Eye className="w-6 h-6 text-slate-600" />
                                Ansicht anpassen
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2 p-4 border rounded-lg">
                                    <span className="font-semibold block flex items-center gap-2"><EyeOff className="w-4 h-4" /> Zeilen ein-/ausblenden</span>
                                    <p className="text-sm text-slate-600">
                                        Über das Dropdown-Menü <strong>"Zeilen verwalten"</strong> können Sie einzelne Zeilen aus- und wieder einblenden.
                                    </p>
                                </div>
                                <div className="space-y-2 p-4 border rounded-lg">
                                    <span className="font-semibold block flex items-center gap-2"><Palette className="w-4 h-4" /> Farbschema</span>
                                    <p className="text-sm text-slate-600">
                                        Im <strong>Farbeinstellungs-Dialog</strong> können Sie Farben für Rollen und einzelne Zeilen anpassen.
                                    </p>
                                </div>
                                <div className="space-y-2 p-4 border rounded-lg">
                                    <span className="font-semibold block">Schriftgröße</span>
                                    <p className="text-sm text-slate-600">
                                        Passen Sie die Schriftgröße über den Schieberegler an. Die Einstellung wird gespeichert.
                                    </p>
                                </div>
                                <div className="space-y-2 p-4 border rounded-lg">
                                    <span className="font-semibold block flex items-center gap-2"><Printer className="w-4 h-4" /> Drucken</span>
                                    <p className="text-sm text-slate-600">
                                        Nutzen Sie die <strong>Druckansicht</strong> für eine optimierte Darstellung zum Ausdrucken.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ==================== DIENSTBESETZUNG ==================== */}
                <TabsContent value="services" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Briefcase className="w-6 h-6 text-indigo-600" />
                                Dienstbesetzung - Übersicht
                            </CardTitle>
                            <CardDescription>
                                Schnelle Besetzung aller Dienste in einer kompakten Monatsübersicht.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-slate-600">
                                Diese Ansicht zeigt alle Dienste (Vordergrund, Hintergrund, Spätdienst etc.) für einen Monat in einer übersichtlichen Tabelle. Sie eignet sich besonders für die schnelle Planung aller Dienste.
                            </p>
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="p-4 bg-slate-50 rounded-lg border">
                                    <h4 className="font-semibold mb-2">Schnellauswahl</h4>
                                    <p className="text-sm text-slate-600">
                                        Klicken Sie auf eine Zelle und wählen Sie die gewünschte Person aus dem <strong>Dropdown-Menü</strong>. Die Zuweisung erfolgt sofort.
                                    </p>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-lg border">
                                    <h4 className="font-semibold mb-2">Wunsch-Integration</h4>
                                    <p className="text-sm text-slate-600">
                                        Personen mit einem <strong>Dienstwunsch</strong> für diesen Tag werden hervorgehoben. Bei Zuweisung wird der Wunsch automatisch genehmigt.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Mail className="w-6 h-6 text-blue-600" />
                                E-Mail-Versand
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-slate-600">
                                Über den Button <strong>"E-Mails senden"</strong> können Sie alle Mitarbeiter über ihre Dienste im aktuellen Monat informieren. Jede Person erhält eine individuelle E-Mail mit ihren zugewiesenen Diensten.
                            </p>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ==================== ABWESENHEITEN ==================== */}
                <TabsContent value="vacation" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Calendar className="w-6 h-6 text-indigo-600" />
                                Abwesenheitsplaner - Übersicht
                            </CardTitle>
                            <CardDescription>
                                Jahresübersicht für Urlaub, Krankheit und andere Abwesenheitsarten.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="p-4 bg-slate-50 rounded-lg border">
                                    <h4 className="font-semibold mb-2">Einzelansicht</h4>
                                    <p className="text-sm text-slate-600">
                                        Detaillierte 12-Monats-Ansicht für eine einzelne Person. Zeigt alle Abwesenheiten, Feiertage und Schulferien.
                                    </p>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-lg border">
                                    <h4 className="font-semibold mb-2">Teamübersicht</h4>
                                    <p className="text-sm text-slate-600">
                                        Kompakte Darstellung aller Mitarbeiter. Farbcodierte Abwesenheiten auf einen Blick.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <MousePointerClick className="w-6 h-6 text-blue-600" />
                                Zeiträume auswählen
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="p-5 bg-blue-50 border-blue-100 rounded-xl border">
                                <div className="text-sm text-blue-800 space-y-2">
                                    <ol className="list-decimal list-inside space-y-1 ml-2">
                                        <li>Wählen Sie oben den gewünschten Status (z.B. "Urlaub").</li>
                                        <li>Klicken Sie auf den <strong>ersten Tag</strong> des Zeitraums.</li>
                                        <li>Klicken Sie auf den <strong>letzten Tag</strong> (oder halten Sie STRG).</li>
                                        <li>Der gesamte Zeitraum wird markiert.</li>
                                    </ol>
                                </div>
                            </div>
                            
                            <div className="grid md:grid-cols-2 gap-4">
                                <div className="border p-4 rounded-lg">
                                    <h4 className="font-semibold mb-2">Einzelne Tage</h4>
                                    <p className="text-sm text-slate-600">
                                        Ein Klick auf einen Tag setzt den Status sofort. Erneuter Klick entfernt ihn.
                                    </p>
                                </div>
                                <div className="border p-4 rounded-lg">
                                    <h4 className="font-semibold mb-2 flex items-center gap-2"><Trash2 className="w-4 h-4 text-red-500" /> Löschen</h4>
                                    <p className="text-sm text-slate-600">
                                        Wählen Sie den grauen <strong>"Löschen"</strong>-Status, um Einträge zu entfernen.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <CalendarDays className="w-6 h-6 text-green-600" />
                                Feiertage & Schulferien
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-slate-600">
                                RadioPlan lädt automatisch Feiertage und Schulferien von der <strong>OpenHolidays API</strong> für Ihr Bundesland.
                            </p>
                            <div className="grid md:grid-cols-2 gap-4">
                                <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                                    <h4 className="font-semibold text-green-900 mb-2">Schulferien</h4>
                                    <p className="text-sm text-green-800">
                                        Werden grün hinterlegt angezeigt. Rein informativ, keine Auswirkung auf Planung.
                                    </p>
                                </div>
                                <div className="p-4 bg-red-50 rounded-lg border border-red-100">
                                    <h4 className="font-semibold text-red-900 mb-2">Feiertage</h4>
                                    <p className="text-sm text-red-800">
                                        Werden wie Sonntage behandelt. Automatische Freistellungen entstehen nur, wenn der direkte Folgetag kein Feiertag ist.
                                    </p>
                                </div>
                            </div>
                            <div className="p-3 bg-indigo-50 text-indigo-900 text-sm rounded-lg border border-indigo-100">
                                <strong>Tipp:</strong> In den Einstellungen können Sie zusätzliche freie Tage definieren oder Feiertage ausblenden.
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ==================== WUNSCHKISTE ==================== */}
                <TabsContent value="wishes" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Heart className="w-6 h-6 text-pink-600" />
                                Wunschkiste - Übersicht
                            </CardTitle>
                            <CardDescription>
                                System für Dienstwünsche und "Kein Dienst"-Anfragen.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                                    <h4 className="font-semibold text-green-900 mb-2 flex items-center gap-2">
                                        <CheckCircle2 className="w-4 h-4" />
                                        Dienstwunsch
                                    </h4>
                                    <p className="text-sm text-green-800">
                                        "Ich möchte an diesem Tag Dienst haben." Wird bei der Dienstplanung bevorzugt berücksichtigt.
                                    </p>
                                </div>
                                <div className="p-4 bg-red-50 rounded-lg border border-red-100">
                                    <h4 className="font-semibold text-red-900 mb-2 flex items-center gap-2">
                                        <XCircle className="w-4 h-4" />
                                        Kein Dienst
                                    </h4>
                                    <p className="text-sm text-red-800">
                                        "Ich möchte an diesem Tag keinen Dienst haben." Bei Genehmigung werden Sie nicht eingeteilt.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-xl">Wünsche eintragen</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <ol className="list-decimal list-inside space-y-2 text-sm text-slate-600 ml-2">
                                <li>Wählen Sie den <strong>Dienst-Tab</strong> (z.B. Vordergrund, Hintergrund).</li>
                                <li>Wählen Sie den <strong>Wunschtyp</strong> (Dienstwunsch oder Kein Dienst).</li>
                                <li>Klicken Sie auf den gewünschten <strong>Tag im Kalender</strong>.</li>
                                <li>Optional: Geben Sie eine <strong>Begründung</strong> und <strong>Priorität</strong> an.</li>
                            </ol>
                            <div className="p-4 bg-amber-50 rounded-lg border border-amber-100 text-sm text-amber-900">
                                <strong>Status:</strong> Wünsche sind zunächst "Ausstehend". Ein Admin muss sie genehmigen oder ablehnen. Genehmigte Wünsche können zur Stornierung eingereicht werden.
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ==================== TEAM ==================== */}
                <TabsContent value="staff" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Users className="w-6 h-6 text-indigo-600" />
                                Team-Verwaltung
                            </CardTitle>
                            <CardDescription>
                                Verwaltung aller Mitarbeiter und des Stellenplans.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="p-4 bg-slate-50 rounded-lg border">
                                    <h4 className="font-semibold mb-2">Mitarbeiter anlegen</h4>
                                    <p className="text-sm text-slate-600">
                                        Klicken Sie auf <strong>"+ Hinzufügen"</strong>, um ein neues Teammitglied anzulegen. Erforderlich: Name, Kürzel, Rolle und E-Mail.
                                    </p>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-lg border">
                                    <h4 className="font-semibold mb-2">Reihenfolge ändern</h4>
                                    <p className="text-sm text-slate-600">
                                        Die Reihenfolge kann per <strong>Drag & Drop</strong> geändert werden. Sie wird im gesamten System übernommen.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-xl">Stellenplan</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-slate-600">
                                Der Stellenplan zeigt das <strong>FTE (Vollzeitäquivalent)</strong> pro Mitarbeiter und Monat. Hier können Sie dokumentieren:
                            </p>
                            <div className="grid gap-4 md:grid-cols-4">
                                <div className="p-3 border rounded-lg">
                                    <Badge variant="outline" className="mb-2">FTE</Badge>
                                    <p className="text-xs text-slate-600">Arbeitsumfang (0-100%)</p>
                                </div>
                                <div className="p-3 border rounded-lg">
                                    <Badge variant="secondary" className="mb-2 bg-orange-100 text-orange-700">EZ</Badge>
                                    <p className="text-xs text-slate-600">Elternzeit</p>
                                </div>
                                <div className="p-3 border rounded-lg">
                                    <Badge variant="secondary" className="mb-2 bg-pink-100 text-pink-700">MS</Badge>
                                    <p className="text-xs text-slate-600">Mutterschutz</p>
                                </div>
                                <div className="p-3 border rounded-lg">
                                    <Badge variant="secondary" className="mb-2 bg-red-100 text-red-700">KO</Badge>
                                    <p className="text-xs text-slate-600">Krank ohne Entgelt</p>
                                </div>
                            </div>
                            <div className="p-3 bg-blue-50 text-blue-900 text-sm rounded-lg border border-blue-100">
                                <strong>Automatik:</strong> Bei EZ, MS, KO oder 0,00 wird der Mitarbeiter im Abwesenheitsplaner automatisch als "Nicht verfügbar" markiert.
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-xl">Rollen & Berechtigungen</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                {teamRoles.map((role, index) => (
                                    <div key={role.id || role.name} className="flex items-center gap-3">
                                        <Badge className={`w-28 ${getRoleColor(role.priority ?? index)}`}>
                                            {role.name}
                                        </Badge>
                                        <div className="flex-1">
                                            <span className="text-sm text-slate-600">
                                                {role.description || (
                                                    <>
                                                        {role.can_do_background_duty && role.can_do_foreground_duty && 'Kann alle Dienste übernehmen'}
                                                        {role.can_do_background_duty && !role.can_do_foreground_duty && 'Kann Hintergrunddienste übernehmen'}
                                                        {!role.can_do_background_duty && role.can_do_foreground_duty && 'Kann Vordergrunddienste übernehmen'}
                                                        {!role.can_do_background_duty && !role.can_do_foreground_duty && role.excluded_from_statistics && 'Wird in Statistiken nicht gezählt'}
                                                        {!role.can_do_background_duty && !role.can_do_foreground_duty && !role.excluded_from_statistics && 'Keine Dienstberechtigung'}
                                                    </>
                                                )}
                                            </span>
                                            <div className="flex gap-1 mt-1">
                                                {role.is_specialist && (
                                                    <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-600">Facharzt</Badge>
                                                )}
                                                {role.can_do_foreground_duty && (
                                                    <Badge variant="secondary" className="text-xs bg-green-50 text-green-600">VG</Badge>
                                                )}
                                                {role.can_do_background_duty && (
                                                    <Badge variant="secondary" className="text-xs bg-orange-50 text-orange-600">HG</Badge>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="p-3 bg-indigo-50 text-indigo-900 text-sm rounded-lg border border-indigo-100 mt-4">
                                <strong>Hinweis:</strong> Rollen können im Admin-Bereich unter "Team-Funktionen" angepasst werden.
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ==================== STATISTIK ==================== */}
                <TabsContent value="statistics" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <BarChart3 className="w-6 h-6 text-indigo-600" />
                                Statistik & Berichte
                            </CardTitle>
                            <CardDescription>
                                Auswertung von Diensten, Zuweisungen und Arbeitszeiten.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-slate-600">
                                Die Statistik-Seite bietet verschiedene Auswertungen für beliebige Zeiträume (Jahr, Monat).
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-xl">Verfügbare Berichte</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="p-4 border rounded-lg">
                                    <h4 className="font-semibold mb-2">Übersicht & Charts</h4>
                                    <p className="text-sm text-slate-600">
                                        Balkendiagramme für Dienste pro Person, Jahresverlauf nach Monaten, farbcodiert nach Diensttyp.
                                    </p>
                                </div>
                                <div className="p-4 border rounded-lg">
                                    <h4 className="font-semibold mb-2">Arbeitszeit-Report</h4>
                                    <p className="text-sm text-slate-600">
                                        Kumulierte Arbeitszeit pro Mitarbeiter. Nur verfügbar bei aktivierten Timeslots. Berücksichtigt Arbeitszeit-Prozentsätze.
                                    </p>
                                </div>
                                <div className="p-4 border rounded-lg">
                                    <h4 className="font-semibold mb-2">Regel-Compliance</h4>
                                    <p className="text-sm text-slate-600">
                                        Auswertung der Einhaltung von Dienstregeln (aufeinanderfolgende Tage, Limits etc.).
                                    </p>
                                </div>
                                <div className="p-4 border rounded-lg">
                                    <h4 className="font-semibold mb-2">Wunscherfüllung</h4>
                                    <p className="text-sm text-slate-600">
                                        Statistik zu genehmigten vs. abgelehnten Dienstwünschen pro Person.
                                    </p>
                                </div>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-lg border mt-4 flex items-center gap-2">
                                <Download className="w-5 h-5 text-slate-500" />
                                <span className="text-sm text-slate-600">Alle Berichte können als <strong>CSV-Datei</strong> exportiert werden.</span>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Percent className="w-6 h-6 text-purple-600" />
                                Arbeitszeit-Prozentsatz
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-slate-600">
                                Für Dienste kann ein <strong>Arbeitszeit-Anteil</strong> konfiguriert werden (z.B. Rufbereitschaft = 70%). Dies beeinflusst die Berechnung der Arbeitszeit-Statistik.
                            </p>
                            <div className="p-4 bg-purple-50 rounded-lg border border-purple-100 text-sm text-purple-900">
                                <strong>Konfiguration:</strong> Öffnen Sie die Arbeitsplatz-Einstellungen → Wählen Sie einen Dienst → Setzen Sie den "Arbeitszeit-Anteil" auf den gewünschten Prozentsatz.
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ==================== ROTATIONSPLANER ==================== */}
                <TabsContent value="training" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <GraduationCap className="w-6 h-6 text-indigo-600" />
                                Rotationsplaner
                            </CardTitle>
                            <CardDescription>
                                Planung und Dokumentation von Rotationen durch verschiedene Arbeitsplätze.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-slate-600">
                                Der Rotationsplaner dient zur langfristigen Planung von Rotationen für Teammitglieder durch verschiedene Modalitäten (CT, MRT, Angio etc.). Es gibt zwei Ansichten: <strong>Einzelansicht</strong> (ein Mitarbeiter) und <strong>Jahresübersicht</strong> (alle auf einen Blick).
                            </p>
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="p-4 bg-slate-50 rounded-lg border">
                                    <h4 className="font-semibold mb-2">Einzelansicht</h4>
                                    <p className="text-sm text-slate-600">
                                        Wählen Sie einen <strong>Mitarbeiter</strong> und eine <strong>Modalität</strong>. Klicken Sie auf den <strong>Starttag</strong>, dann auf den <strong>Endtag</strong>. Der Zeitraum wird farblich markiert.
                                    </p>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-lg border">
                                    <h4 className="font-semibold mb-2">Jahresübersicht</h4>
                                    <p className="text-sm text-slate-600">
                                        Zeigt alle Mitarbeiter und deren Rotationen im gesamten Jahr. Per <strong>Drag</strong> können Bereiche selektiert oder gelöscht werden.
                                    </p>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-lg border">
                                    <h4 className="font-semibold mb-2">Rotationen löschen</h4>
                                    <p className="text-sm text-slate-600">
                                        Wählen Sie den <strong>Lösch-Modus</strong> und markieren Sie den zu löschenden Bereich. Bestehende Rotationen werden passend zugeschnitten.
                                    </p>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-lg border">
                                    <h4 className="font-semibold mb-2">Transfer in den Wochenplan</h4>
                                    <p className="text-sm text-slate-600">
                                        Über den <strong>Transfer-Button</strong> können geplante Rotationen als Einträge in den Wochenplan übertragen werden. Wählen Sie Zeitraum (Tag/Woche/ab Datum), optional mit Überschreiben bestehender Einträge.
                                    </p>
                                </div>
                            </div>
                            <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-sm text-blue-900">
                                <strong>Integration:</strong> Die geplanten Rotationen werden im Wochenplan mit einem farbigen Marker angezeigt, sodass Sie bei der täglichen Planung sehen, wer aktuell in welcher Rotation ist. Beim Transfer wird automatisch geprüft, ob ein Mitarbeiter abwesend ist oder Konflikte bestehen.
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ==================== DASHBOARD ==================== */}
                <TabsContent value="dashboard" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <LayoutDashboard className="w-6 h-6 text-indigo-600" />
                                Mein Dashboard
                            </CardTitle>
                            <CardDescription>
                                Persönliche Übersicht mit anstehenden Diensten und Benachrichtigungen.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="p-4 bg-slate-50 rounded-lg border">
                                    <h4 className="font-semibold mb-2">Meine Dienste</h4>
                                    <p className="text-sm text-slate-600">
                                        Übersicht aller anstehenden Vordergrund- und Hintergrunddienste.
                                    </p>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-lg border">
                                    <h4 className="font-semibold mb-2">Meine Abwesenheiten</h4>
                                    <p className="text-sm text-slate-600">
                                        Geplanter Urlaub, Freistellungen und andere Abwesenheiten.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Bell className="w-6 h-6 text-amber-500" />
                                Benachrichtigungen
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-slate-600">
                                Das Dashboard zeigt <strong>unbestätigte Benachrichtigungen</strong> über neue Dienstzuweisungen oder Änderungen.
                            </p>
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="p-4 border rounded-lg">
                                    <h4 className="font-semibold mb-2 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Bestätigen</h4>
                                    <p className="text-sm text-slate-600">
                                        Klicken Sie auf "Bestätigen", um Kenntnis einer Zuweisung zu dokumentieren.
                                    </p>
                                </div>
                                <div className="p-4 border rounded-lg">
                                    <h4 className="font-semibold mb-2 flex items-center gap-2"><Mail className="w-4 h-4 text-blue-500" /> E-Mail-Alerts</h4>
                                    <p className="text-sm text-slate-600">
                                        Aktivieren Sie E-Mail-Benachrichtigungen, um sofort über neue Dienste informiert zu werden.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ==================== ADMIN ==================== */}
                <TabsContent value="admin" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Shield className="w-6 h-6 text-red-600" />
                                Adminbereich
                            </CardTitle>
                            <CardDescription>
                                Systemverwaltung - nur für Administratoren zugänglich.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="p-4 bg-red-50 rounded-lg border border-red-100 text-sm text-red-900">
                                <strong>Hinweis:</strong> Diese Funktionen sind nur für Benutzer mit Admin-Rechten sichtbar.
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-xl">Verwaltungsfunktionen</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="p-4 border rounded-lg">
                                    <h4 className="font-semibold mb-2 flex items-center gap-2"><Users className="w-4 h-4" /> Benutzer & Rollen</h4>
                                    <p className="text-sm text-slate-600">
                                        Benutzerkonten anlegen, Rollen zuweisen, Passwörter zurücksetzen, Benutzer-Mitarbeiter-Zuordnung.
                                    </p>
                                </div>
                                <div className="p-4 border rounded-lg">
                                    <h4 className="font-semibold mb-2 flex items-center gap-2"><Settings className="w-4 h-4" /> Arbeitsplätze</h4>
                                    <p className="text-sm text-slate-600">
                                        Dienste, Rotationen und Arbeitsplätze konfigurieren. Timeslots, Limits und automatische Regeln einstellen.
                                    </p>
                                </div>
                                <div className="p-4 border rounded-lg">
                                    <h4 className="font-semibold mb-2 flex items-center gap-2"><Database className="w-4 h-4" /> Datenbank</h4>
                                    <p className="text-sm text-slate-600">
                                        Backup/Restore, Datenexport, Migrationen ausführen, System-Logs einsehen.
                                    </p>
                                </div>
                                <div className="p-4 border rounded-lg">
                                    <h4 className="font-semibold mb-2 flex items-center gap-2"><Palette className="w-4 h-4" /> Erscheinungsbild</h4>
                                    <p className="text-sm text-slate-600">
                                        Farbschemata anpassen, App-weite Einstellungen, Kategorien verwalten.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-xl">Datenbank-Migrationen</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-slate-600">
                                Nach Updates können neue <strong>Datenbank-Migrationen</strong> verfügbar sein. Diese erweitern das System um neue Funktionen.
                            </p>
                            <div className="p-4 bg-amber-50 rounded-lg border border-amber-100 text-sm text-amber-900">
                                <strong>Wichtig:</strong> Wenn im Admin-Bereich "Ausstehende Migrationen" angezeigt werden, führen Sie diese aus, um alle neuen Funktionen nutzen zu können.
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Tastenkürzel-Übersicht */}
            <Card className="mt-8">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-xl">
                        <Keyboard className="w-6 h-6 text-slate-600" />
                        Tastenkürzel
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                            <kbd className="px-2 py-1 bg-white border rounded text-sm font-mono">STRG + Z</kbd>
                            <span className="text-sm text-slate-600">Rückgängig</span>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                            <kbd className="px-2 py-1 bg-white border rounded text-sm font-mono">STRG + Drag</kbd>
                            <span className="text-sm text-slate-600">Kopieren statt Verschieben</span>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                            <kbd className="px-2 py-1 bg-white border rounded text-sm font-mono">STRG + Klick</kbd>
                            <span className="text-sm text-slate-600">Bereich auswählen</span>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
