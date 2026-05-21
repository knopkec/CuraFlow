import { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ChartCard from "@/components/statistics/ChartCard";
import { buildWishFulfillmentStats } from '@/components/statistics/wishFulfillmentUtils';

export default function WishFulfillmentReport({ doctors, wishes, shifts }) {
    const stats = useMemo(() => buildWishFulfillmentStats({ doctors, wishes, shifts }), [doctors, wishes, shifts]);

    if (!stats || stats.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Wunscherfüllung</CardTitle>
                    <CardDescription>Keine Wünsche für diesen Zeitraum gefunden.</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <ChartCard 
                title="Wunscherfüllungsquote (%)" 
                description="Prozentsatz der erfüllten Dienstwünsche pro Arzt"
                defaultHeight="h-[350px]"
            >
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={true} />
                        <XAxis type="number" domain={[0, 100]} />
                        <YAxis dataKey="name" type="category" width={120} tick={{fontSize: 11}} />
                        <Tooltip 
                            formatter={(value) => `${value}%`}
                            contentStyle={{backgroundColor: 'white', borderRadius: '8px', border: '1px solid #e2e8f0'}}
                        />
                        <Bar dataKey="rate" name="Erfüllungsquote" fill="#10b981" radius={[0, 4, 4, 0]} barSize={20} />
                    </BarChart>
                </ResponsiveContainer>
            </ChartCard>

            <Card>
                <CardHeader>
                    <CardTitle>Details Wunscherfüllung</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Arzt</TableHead>
                                <TableHead className="text-right">Wünsche Gesamt</TableHead>
                                <TableHead className="text-right text-green-600">Erfüllt (Realität)</TableHead>
                                <TableHead className="text-right">Quote</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {stats.map((item) => (
                                <TableRow key={item.name}>
                                    <TableCell className="font-medium">{item.name}</TableCell>
                                    <TableCell className="text-right">{item.total}</TableCell>
                                    <TableCell className="text-right font-bold text-green-600">{item.fulfilled}</TableCell>
                                    <TableCell className="text-right">{item.rate}%</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
