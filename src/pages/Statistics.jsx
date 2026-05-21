import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { db } from "@/api/client";
import { useAuth } from '@/components/AuthProvider';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, Loader2, BarChart3, Table as TableIcon, User, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import ChartCard from "@/components/statistics/ChartCard";
import WishFulfillmentReport from "@/components/statistics/WishFulfillmentReport";
import ComplianceReport from "@/components/statistics/ComplianceReport";
import WorkingTimeReport from "@/components/statistics/WorkingTimeReport";
import { useToast } from '@/components/ui/use-toast';
import { exportStatisticsCsv, exportStatisticsExcel, exportStatisticsPdf } from '@/components/statistics/exportUtils';

const COLORS = {
    // Default colors - used as fallback. Actual colors come from workplace data.
    "CT": "#10b981", // emerald-500
    "MRT": "#06b6d4", // cyan-500
    "Angiographie": "#ef4444", // red-500
    "Sonographie": "#8b5cf6", // violet-500
    "DL/konv. Rö": "#64748b", // slate-500
    "Mammographie": "#ec4899", // pink-500
};

// Colors assigned by service_type
const SERVICE_TYPE_COLORS = {
    1: "#3b82f6", // blue-500 - Bereitschaftsdienst
    2: "#6366f1", // indigo-500 - Rufbereitschaftsdienst
    3: "#f59e0b", // amber-500 - Schichtdienst
    4: "#64748b", // slate-500 - Andere
};

const MONTHS = [
    "Januar", "Februar", "März", "April", "Mai", "Juni", 
    "Juli", "August", "September", "Oktober", "November", "Dezember"
];

export default function StatisticsPage() {
    const { user } = useAuth();
    const { toast } = useToast();
    const isAdmin = user?.role === 'admin';
    const [year, setYear] = useState(new Date().getFullYear().toString());
    const [month, setMonth] = useState("all");
    const [activeTab, setActiveTab] = useState("overview");

    // 1. Fetch Data
    const { data: doctors = [], isLoading: isLoadingDocs } = useQuery({
        queryKey: ['doctors'],
        queryFn: () => db.Doctor.list(),
        enabled: isAdmin,
        select: (data) => data.sort((a, b) => (a.order || 0) - (b.order || 0)),
    });

    const { data: workplaces = [], isLoading: isLoadingWorkplaces } = useQuery({
        queryKey: ['workplaces'],
        queryFn: () => db.Workplace.list(null, 1000),
        enabled: isAdmin,
    });

    const { data: shifts = [], isLoading: isLoadingShifts } = useQuery({
        queryKey: ['shifts', year],
        enabled: isAdmin,
        queryFn: async () => {
            try {
                return await db.ShiftEntry.filter({
                    date: { "$gte": `${year}-01-01`, "$lte": `${year}-12-31` }
                }, null, 5000) || [];
            } catch {
                const all = await db.ShiftEntry.list(null, 5000);
                return all.filter(s => s.date.startsWith(year));
            }
        },
    });

    const { data: wishes = [], isLoading: isLoadingWishes } = useQuery({
        queryKey: ['wishes', year, month],
        enabled: isAdmin,
        queryFn: () => {
            if (month === 'all') {
                return db.WishRequest.filter({
                    target_month: { "$gte": `${year}-01`, "$lte": `${year}-12` }
                });
            }

            const targetMonth = `${year}-${String(parseInt(month, 10) + 1).padStart(2, '0')}`;
            return db.WishRequest.filter({ target_month: targetMonth });
        },
    });

    const isLoading = isLoadingDocs || isLoadingShifts || isLoadingWorkplaces || isLoadingWishes;

    // 3. Aggregation Logic
    const stats = useMemo(() => {
        if (isLoading) return { byDoctor: [], byMonth: [], totals: {}, rotationItems: [], serviceItems: [] };

        // Dynamic Rotation Items from Workplaces
        const rotationItems = workplaces
            .filter(w => w.category === "Rotationen")
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map(w => w.name);
            
        // Dynamic Service Items from Workplaces
        const serviceItems = workplaces
            .filter(w => w.category === "Dienste")
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map(w => w.name);

        // Fallback if empty
        if (rotationItems.length === 0 && workplaces.length === 0) {
            rotationItems.push("CT", "MRT", "Angiographie", "Sonographie", "DL/konv. Rö", "Mammographie");
        }
        if (serviceItems.length === 0 && workplaces.length === 0) {
            serviceItems.push("Dienst Vordergrund", "Dienst Hintergrund", "Spätdienst");
        }

        const doctorStats = {};
        const monthlyStats = Array.from({ length: 12 }, (_, i) => ({
            name: MONTHS[i],
            monthIndex: i,
            dienste: 0,
            rotationen: 0
        }));
        const totals = { dienste: 0, rotationen: 0 };

        // Initialize doctor stats
        doctors.forEach(doc => {
            if (doc.role === 'Nicht-Radiologe') return;
            doctorStats[doc.id] = {
                id: doc.id,
                name: doc.name,
                role: doc.role,
                totalDienste: 0,
                totalRotationen: 0,
                breakdown: {}
            };
            // Init breakdown keys
            [...serviceItems, ...rotationItems].forEach(item => {
                doctorStats[doc.id].breakdown[item] = 0;
            });
        });

        // Process shifts
        shifts.forEach(shift => {
            const date = new Date(shift.date);
            const shiftMonth = date.getMonth();

            if (month !== "all" && shiftMonth !== parseInt(month)) return;

            const isService = serviceItems.includes(shift.position);
            const isRotation = rotationItems.includes(shift.position); 

            if (month === "all" || shiftMonth === parseInt(month)) {
                if (isService) monthlyStats[shiftMonth].dienste++;
                else if (isRotation) monthlyStats[shiftMonth].rotationen++;
            }

            const docStat = doctorStats[shift.doctor_id];
            if (!docStat) return;

            if (isService) {
                docStat.breakdown[shift.position] = (docStat.breakdown[shift.position] || 0) + 1;
                docStat.totalDienste++;
                totals.dienste++;
            } else if (isRotation) {
                docStat.breakdown[shift.position] = (docStat.breakdown[shift.position] || 0) + 1;
                docStat.totalRotationen++;
                totals.rotationen++;
            }
        });

        const byDoctor = Object.values(doctorStats).sort((a, b) => b.totalDienste - a.totalDienste);

        return { byDoctor, byMonth: monthlyStats, totals, rotationItems, serviceItems };
    }, [doctors, shifts, workplaces, isLoading, month]);

    if (!isAdmin) {
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

    const selectedPeriodLabel = month === "all" ? "Ganzes Jahr" : MONTHS[parseInt(month)];
    const exportTitle = `Statistik ${year} - ${selectedPeriodLabel}`;

    const handleExport = (exporter) => {
        try {
            exporter({ stats, year, month, title: exportTitle });
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Export fehlgeschlagen',
                description: error instanceof Error ? error.message : 'Der Export konnte nicht erstellt werden.',
            });
        }
    };

    if (isLoading) {
        return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-indigo-600" /></div>;
    }

    return (
        <div className="container mx-auto max-w-7xl space-y-8" data-testid="statistics-page">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900">Statistik</h1>
                    <p className="text-slate-500 mt-1">Auswertung der Dienste und Arbeitsplatzzuweisungen für {year}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Select value={year} onValueChange={setYear}>
                        <SelectTrigger className="w-[100px]" data-testid="statistics-year-trigger">
                            <SelectValue placeholder="Jahr" />
                        </SelectTrigger>
                        <SelectContent>
                            {[2023, 2024, 2025, 2026].map(y => (
                                <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={month} onValueChange={setMonth}>
                        <SelectTrigger className="w-[140px]" data-testid="statistics-month-trigger">
                            <SelectValue placeholder="Monat" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Ganzes Jahr</SelectItem>
                            {MONTHS.map((m, i) => (
                                <SelectItem key={i} value={i.toString()}>{m}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button variant="outline" onClick={() => handleExport(exportStatisticsCsv)} data-testid="statistics-export-csv" title="CSV Export">
                        <Download className="h-4 w-4 mr-2" />
                        CSV
                    </Button>
                    <Button variant="outline" onClick={() => handleExport(exportStatisticsExcel)} data-testid="statistics-export-excel" title="Excel Export">
                        <Download className="h-4 w-4 mr-2" />
                        Excel
                    </Button>
                    <Button variant="outline" onClick={() => handleExport(exportStatisticsPdf)} data-testid="statistics-export-pdf" title="PDF Export">
                        <Download className="h-4 w-4 mr-2" />
                        PDF
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Gesamt Dienste</CardTitle>
                        <div className="h-4 w-4 text-blue-500 font-bold">Σ</div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totals.dienste}</div>
                        <p className="text-xs text-muted-foreground">Vordergrund, Hintergrund, Spätdienst</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Gesamt Zuweisungen</CardTitle>
                        <div className="h-4 w-4 text-emerald-500 font-bold">Σ</div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totals.rotationen}</div>
                        <p className="text-xs text-muted-foreground">CT, MRT, Angio, etc.</p>
                    </CardContent>
                </Card>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="overview" className="flex items-center gap-2" data-testid="statistics-tab-overview"><BarChart3 className="w-4 h-4" /> Übersicht & Charts</TabsTrigger>
                    <TabsTrigger value="workingtime" className="flex items-center gap-2" data-testid="statistics-tab-workingtime"><Clock className="w-4 h-4" /> Arbeitszeit</TabsTrigger>
                    <TabsTrigger value="compliance" className="flex items-center gap-2" data-testid="statistics-tab-compliance">Regel-Compliance</TabsTrigger>
                    <TabsTrigger value="wishes" className="flex items-center gap-2" data-testid="statistics-tab-wishes">Wunscherfüllung</TabsTrigger>
                    <TabsTrigger value="details" className="flex items-center gap-2" data-testid="statistics-tab-details"><TableIcon className="w-4 h-4" /> Detaillierte Tabelle</TabsTrigger>
                </TabsList>
                
                <TabsContent value="workingtime">
                    <WorkingTimeReport />
                </TabsContent>
                
                <TabsContent value="overview" className="space-y-4">
                    {month === "all" && (
                        <div data-testid="statistics-monthly-chart">
                        <ChartCard 
                            title="Jahresverlauf" 
                            description="Entwicklung der Dienste und Zuweisungen über die Monate"
                            defaultHeight="h-[300px]"
                        >
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stats.byMonth} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="name" tick={{fontSize: 12}} />
                                    <YAxis />
                                    <Tooltip 
                                        contentStyle={{backgroundColor: 'white', borderRadius: '8px', border: '1px solid #e2e8f0'}}
                                        cursor={{fill: 'transparent'}}
                                    />
                                    <Legend />
                                    <Bar dataKey="dienste" name="Dienste" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                    <Bar dataKey="rotationen" name="Arbeitsplätze" fill="#10b981" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartCard>
                        </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
                        <div data-testid="statistics-services-chart">
                        <ChartCard 
                            title="Dienste pro Person"
                            description={month === "all" ? `Anzahl der Dienste im Jahr ${year}` : `Anzahl der Dienste im ${MONTHS[parseInt(month)]} ${year}`}
                            defaultHeight="h-[400px]"
                            className="col-span-1"
                        >
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stats.byDoctor} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={true} />
                                    <XAxis type="number" />
                                    <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 11}} />
                                    <Tooltip 
                                        contentStyle={{backgroundColor: 'white', borderRadius: '8px', border: '1px solid #e2e8f0'}}
                                        cursor={{fill: 'transparent'}}
                                    />
                                    <Legend />
                                    {stats.serviceItems.map((item, index) => {
                                        const wp = workplaces.find(w => w.name === item);
                                        const color = (wp?.service_type && SERVICE_TYPE_COLORS[wp.service_type]) || COLORS[item] || `hsl(${index * 60}, 70%, 50%)`;
                                        return <Bar key={item} dataKey={`breakdown.${item}`} name={item} stackId="a" fill={color} />;
                                    })}
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartCard>
                        </div>
                        
                        <div data-testid="statistics-rotations-chart">
                        <ChartCard 
                            title="Arbeitsplätze pro Person"
                            description={`Verteilung der Rotationen im Jahr ${year}`}
                            defaultHeight="h-[400px]"
                            className="col-span-1"
                        >
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stats.byDoctor} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={true} />
                                    <XAxis type="number" />
                                    <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 11}} />
                                    <Tooltip 
                                         contentStyle={{backgroundColor: 'white', borderRadius: '8px', border: '1px solid #e2e8f0'}}
                                         cursor={{fill: 'transparent'}}
                                    />
                                    <Legend wrapperStyle={{fontSize: '10px'}} />
                                    {stats.rotationItems.map((item, index) => (
                                        <Bar key={item} dataKey={`breakdown.${item}`} name={item} stackId="a" fill={COLORS[item] || `hsl(${index * 40}, 70%, 50%)`} />
                                    ))}
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartCard>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="compliance">
                    <ComplianceReport doctors={doctors} shifts={shifts} />
                </TabsContent>

                <TabsContent value="wishes">
                    <WishFulfillmentReport doctors={doctors} wishes={wishes} shifts={shifts} />
                </TabsContent>

                <TabsContent value="details">
                    <Card data-testid="statistics-details-table">
                        <CardHeader>
                            <CardTitle>Detailauswertung</CardTitle>
                            <CardDescription>Alle Zahlen im Überblick</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="h-[600px] rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[180px]">Person</TableHead>
                                            <TableHead>Rolle</TableHead>
                                            <TableHead className="text-right font-bold border-l bg-blue-50">Σ Dienste</TableHead>
                                            {stats.serviceItems.map(item => (
                                                <TableHead key={item} className="text-right text-xs text-slate-500">{item.replace('Dienst ', '')}</TableHead>
                                            ))}
                                            <TableHead className="text-right font-bold border-l bg-emerald-50">Σ Plätze</TableHead>
                                            {stats.rotationItems.map(item => (
                                                <TableHead key={item} className="text-right text-xs text-slate-500">{item}</TableHead>
                                            ))}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {stats.byDoctor.map((doc) => (
                                            <TableRow key={doc.id}>
                                                <TableCell className="font-medium">{doc.name}</TableCell>
                                                <TableCell className="text-xs text-slate-500">{doc.role}</TableCell>
                                                
                                                <TableCell className="text-right font-bold border-l bg-blue-50/50">{doc.totalDienste}</TableCell>
                                                {stats.serviceItems.map(item => (
                                                    <TableCell key={item} className="text-right text-slate-600">
                                                        {doc.breakdown[item] || '-'}
                                                    </TableCell>
                                                ))}
                                                
                                                <TableCell className="text-right font-bold border-l bg-emerald-50/50">{doc.totalRotationen}</TableCell>
                                                {stats.rotationItems.map(item => (
                                                    <TableCell key={item} className="text-right text-slate-600">
                                                        {doc.breakdown[item] || '-'}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
