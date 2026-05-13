import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useAuth } from '@/components/AuthProvider';
import EnvironmentMigrationNotice from '@/components/EnvironmentMigrationNotice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Eye, EyeOff, AlertCircle } from 'lucide-react';
import TenantSelectionDialog from '@/components/auth/TenantSelectionDialog';

export default function AuthLoginPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { 
        isAuthenticated, 
        isLoading, 
        login, 
        user,
        needsTenantSelection, 
        allowedTenants, 
        hasFullTenantAccess,
        completeTenantSelection 
    } = useAuth();
    
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loginComplete, setLoginComplete] = useState(false);
    const redirectTarget = useMemo(() => {
        const params = new URLSearchParams(location.search);
        const target = params.get('redirect');
        const authLoginPath = createPageUrl('AuthLogin').toLowerCase();
        if (!target || !target.startsWith('/')) {
            return createPageUrl('MyDashboard');
        }
        if (target.toLowerCase().startsWith(authLoginPath)) {
            return createPageUrl('MyDashboard');
        }
        return target;
    }, [location.search]);

    // Redirect if already authenticated (and no tenant selection needed)
    useEffect(() => {
        console.log('[AuthLogin] useEffect check:', { isLoading, isAuthenticated, needsTenantSelection, loginComplete });
        // Nur redirecten wenn:
        // 1. Login-Prozess abgeschlossen (loginComplete) 
        // 2. Authentifiziert
        // 3. Keine Tenant-Auswahl nötig
        if (loginComplete && isAuthenticated && !needsTenantSelection) {
            console.log('[AuthLogin] Redirecting to target', redirectTarget);
            navigate(redirectTarget, { replace: true });
        }
    }, [isAuthenticated, isLoading, needsTenantSelection, loginComplete, navigate, redirectTarget]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);
        setLoginComplete(false);

        try {
            console.log('[AuthLogin] Starting login...');
            await login(email, password);
            console.log('[AuthLogin] Login finished, setting loginComplete=true');
            // Warte kurz damit React die States aktualisieren kann
            setTimeout(() => setLoginComplete(true), 100);
        } catch (err) {
            setError(err.message || 'Anmeldung fehlgeschlagen');
            setLoginComplete(false);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4">
            <Card className="w-full max-w-md shadow-xl">
                <CardHeader className="text-center space-y-4">
                    <div className="flex justify-center">
                        <img 
                            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6968fa78df93ab8a974bdc68/41f77f60e_Gemini_Generated_Image_184c7e184c7e184c.png" 
                            alt="CuraFlow" 
                            className="w-16 h-16 object-contain" 
                        />
                    </div>
                    <EnvironmentMigrationNotice />
                    <div>
                        <CardTitle className="text-2xl font-bold">CuraFlow</CardTitle>
                        <CardDescription className="text-slate-500">
                            Melden Sie sich mit Ihrem Konto an
                        </CardDescription>
                    </div>
                </CardHeader>

                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4" data-testid="auth-login-form">
                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                <span className="text-sm">{error}</span>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="email">E-Mail</Label>
                            <Input
                                data-testid="auth-login-email"
                                id="email"
                                type="email"
                                placeholder="name@beispiel.de"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoComplete="email"
                                autoFocus
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="password">Passwort</Label>
                            <div className="relative">
                                <Input
                                    data-testid="auth-login-password"
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    autoComplete="current-password"
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                >
                                    {showPassword ? (
                                        <EyeOff className="w-4 h-4" />
                                    ) : (
                                        <Eye className="w-4 h-4" />
                                    )}
                                </button>
                            </div>
                        </div>

                        <Button
                            data-testid="auth-login-submit"
                            type="submit"
                            className="w-full bg-indigo-600 hover:bg-indigo-700"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Anmelden...
                                </>
                            ) : (
                                'Anmelden'
                            )}
                        </Button>
                    </form>
                </CardContent>
            </Card>

            {/* Mandanten-Auswahl Dialog */}
            <TenantSelectionDialog
                open={needsTenantSelection}
                onComplete={completeTenantSelection}
                tenants={allowedTenants}
                hasFullAccess={hasFullTenantAccess}
                isAdmin={user?.role === 'admin'}
            />
        </div>
    );
}
