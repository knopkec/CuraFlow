import React from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UserManagement from '@/components/admin/UserManagement';
import DatabaseManagement from '@/components/admin/DatabaseManagement';
import SystemLogs from '@/components/admin/SystemLogs';
import AdminSettings from '@/components/admin/AdminSettings';
import TenantGroupManagement from '@/components/admin/TenantGroupManagement';
import { ShieldCheck } from 'lucide-react';

export default function AdminPage() {
    const { user, isAuthenticated } = useAuth();
    const [activeTab, setActiveTab] = React.useState('users');

    if (!isAuthenticated) return <div>Bitte anmelden.</div>;
    if (user?.role !== 'admin') {
        return (
            <div className="p-8 text-center text-red-600" data-testid="admin-access-denied">
                Zugriff verweigert. Nur für Administratoren.
            </div>
        );
    }

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
                <TabsList className="grid w-full grid-cols-5 lg:w-[1000px]">
                    <TabsTrigger value="users" data-testid="admin-tab-users">Benutzer & Rollen</TabsTrigger>
                    <TabsTrigger value="groups" data-testid="admin-tab-groups">Verbünde</TabsTrigger>
                    <TabsTrigger value="settings" data-testid="admin-tab-settings">Einstellungen</TabsTrigger>
                    <TabsTrigger value="database" data-testid="admin-tab-database">Datenbank</TabsTrigger>
                    <TabsTrigger value="logs" data-testid="admin-tab-logs">Logs</TabsTrigger>
                </TabsList>

                <TabsContent value="users">
                    {activeTab === 'users' && <UserManagement />}
                </TabsContent>

                <TabsContent value="groups">
                    {activeTab === 'groups' && <TenantGroupManagement />}
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
