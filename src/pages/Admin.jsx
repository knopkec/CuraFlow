import React from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UserManagement from '@/components/admin/UserManagement';
import DatabaseManagement from '@/components/admin/DatabaseManagement';
import SystemLogs from '@/components/admin/SystemLogs';
import AdminSettings from '@/components/admin/AdminSettings';
import { ShieldCheck } from 'lucide-react';

export default function AdminPage() {
    const { user, isAuthenticated } = useAuth();
    const [activeTab, setActiveTab] = React.useState('users');

    if (!isAuthenticated) return <div>Bitte anmelden.</div>;
    if (user?.role !== 'admin') return <div className="p-8 text-center text-red-600">Zugriff verweigert. Nur für Administratoren.</div>;

    return (
        <div className="container mx-auto max-w-6xl py-8" data-testid="admin-page">
            <div className="mb-8 flex items-center gap-3">
                <div className="p-3 bg-indigo-600 rounded-lg shadow-lg">
                    <ShieldCheck className="w-8 h-8 text-white" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">Adminbereich</h1>
                    <p className="text-slate-500">Systemverwaltung und Wartung</p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                <TabsList className="grid w-full grid-cols-4 lg:w-[800px]">
                    <TabsTrigger value="users">Benutzer & Rollen</TabsTrigger>
                    <TabsTrigger value="settings">Einstellungen</TabsTrigger>
                    <TabsTrigger value="database">Datenbank</TabsTrigger>
                    <TabsTrigger value="logs">Logs</TabsTrigger>
                </TabsList>

                <TabsContent value="users">
                    {activeTab === 'users' && <UserManagement />}
                </TabsContent>

                <TabsContent value="settings">
                    {activeTab === 'settings' && <AdminSettings />}
                </TabsContent>

                <TabsContent value="database">
                    {activeTab === 'database' && <DatabaseManagement />}
                </TabsContent>

                <TabsContent value="logs">
                    {activeTab === 'logs' && <SystemLogs />}
                </TabsContent>
            </Tabs>
        </div>
    );
}
