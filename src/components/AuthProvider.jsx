import React, { createContext, useContext, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { disableDbToken } from '@/components/dbTokenStorage';

// Configuration: Set to true to use custom JWT auth, false for Base44 auth
const USE_CUSTOM_AUTH = true; // Custom JWT auth enabled

const AuthContext = createContext({
    isAuthenticated: false,
    isReadOnly: true,
    user: null,
    isLoading: true,
    needsTenantSelection: false,
    allowedTenants: [],
    hasFullTenantAccess: false,
    completeTenantSelection: () => {},
    refreshUser: async () => {},
    updateMe: async () => {},
    logout: () => {},
    login: async () => {}
});

export const useAuth = () => useContext(AuthContext);

const TOKEN_KEY = 'radioplan_jwt_token';

// ============ CUSTOM JWT AUTH PROVIDER ============
const JWTAuthProviderInner = ({ children }) => {
    const queryClient = useQueryClient();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [token, setToken] = useState(null);
    const [mustChangePassword, setMustChangePassword] = useState(false);
    const [needsTenantSelection, setNeedsTenantSelection] = useState(false);
    const [allowedTenants, setAllowedTenants] = useState([]);
    const [hasFullTenantAccess, setHasFullTenantAccess] = useState(false);

    const getStoredToken = () => {
        try {
            return localStorage.getItem(TOKEN_KEY);
        } catch (e) {
            return null;
        }
    };

    const storeToken = (newToken) => {
        try {
            if (newToken) {
                localStorage.setItem(TOKEN_KEY, newToken);
            } else {
                localStorage.removeItem(TOKEN_KEY);
            }
        } catch (e) {
            console.error('Token storage error:', e);
        }
    };

    useEffect(() => {
        const checkAuth = async () => {
            const storedToken = getStoredToken();
            
            if (!storedToken) {
                setIsLoading(false);
                return;
            }

            try {
                api.setToken(storedToken);
                const userData = await api.me();
                setUser(userData);
                setToken(storedToken);
                setIsAuthenticated(true);
                // Check if password change is required
                setMustChangePassword(userData.must_change_password === true);
            } catch (error) {
                console.error('Auth check failed:', error);
                storeToken(null);
                setIsAuthenticated(false);
            } finally {
                setIsLoading(false);
            }
        };

        checkAuth();
    }, []);

    useEffect(() => {
        if (!isAuthenticated || !user) return undefined;

        let cancelled = false;

        const sendPresence = async () => {
            try {
                await api.updatePresence();
            } catch (error) {
                if (!cancelled) {
                    console.warn('[Auth] Presence update failed:', error.message);
                }
            }
        };

        sendPresence();
        const intervalId = window.setInterval(sendPresence, 60000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [isAuthenticated, user?.id]);

    const login = async (email, password) => {
        console.log('[Auth] Login started for:', email);
        
        // Zuerst alten DB-Token lokal sofort zurücksetzen (wichtig bei User-Wechsel)
        try {
            localStorage.setItem('db_token_enabled', 'false');
            localStorage.removeItem('active_token_id');
            localStorage.removeItem('db_credentials');

            // IndexedDB-Write nicht blockierend ausführen, damit Login nicht verzögert.
            disableDbToken().catch((e) => {
                console.error('[Auth] Failed to persist disabled DB token state:', e);
            });
            console.log('[Auth] Cleared old DB tokens');
        } catch (e) {
            console.error('[Auth] Failed to clear old DB token:', e);
        }
        
        const data = await api.login(email, password);
        console.log('[Auth] Login successful, user:', data.user?.email);
        
        storeToken(data.token);
        setToken(data.token);
        setUser(data.user);
        setIsAuthenticated(true);
        setMustChangePassword(data.must_change_password === true);
        
        // Prüfen, ob Tenant-Auswahl erforderlich ist
        try {
            api.setToken(data.token);
            console.log('[Auth] Fetching tenants...');
            const tenantsData = await api.getMyTenants();
            console.log('[Auth] Tenants response:', tenantsData);
            
            if (tenantsData.tenants && tenantsData.tenants.length > 0) {
                console.log('[Auth] Found', tenantsData.tenants.length, 'tenants, hasFullAccess:', tenantsData.hasFullAccess);
                setAllowedTenants(tenantsData.tenants);
                setHasFullTenantAccess(tenantsData.hasFullAccess);
                
                // Bei jedem Login: Tenant-Auswahl anzeigen
                console.log('[Auth] Setting needsTenantSelection = true');
                setNeedsTenantSelection(true);
            } else {
                console.log('[Auth] No tenants found for user');
            }
        } catch (err) {
            console.error('[Auth] Failed to load tenants:', err);
            // Bei Fehler einfach weitermachen ohne Tenant-Auswahl
        }
        
        return data;
    };

    const completeTenantSelection = () => {
        setNeedsTenantSelection(false);
    };

    const logout = async () => {
        storeToken(null);
        api.setToken(null);
        setToken(null);
        setUser(null);
        setIsAuthenticated(false);
        queryClient.clear();
        
        // DB-Token beim Logout lokal sofort zurücksetzen.
        // Persistenz nach IndexedDB erfolgt bewusst ohne await, damit Redirect nicht hängt.
        try {
            localStorage.setItem('db_token_enabled', 'false');
            localStorage.removeItem('active_token_id');
            localStorage.removeItem('db_credentials');

            disableDbToken().catch((e) => {
                console.error('Failed to persist disabled DB token on logout:', e);
            });
        } catch (e) {
            console.error('Failed to disable DB token on logout:', e);
        }
        
        window.location.href = '/AuthLogin';
    };

    const refreshUser = async () => {
        const currentToken = token || getStoredToken();
        if (!currentToken) return;

        try {
            api.setToken(currentToken);
            const userData = await api.me();
            setUser(userData);
        } catch (error) {
            console.error('Refresh user failed:', error);
        }
    };

    const updateMe = async (data) => {
        const currentToken = token || getStoredToken();
        if (!currentToken) throw new Error('Nicht eingeloggt');
        if (!data || Object.keys(data).length === 0) {
            console.warn('updateMe called with empty data');
            return user;
        }

        api.setToken(currentToken);
        const result = await api.updateMe({ data });
        setUser(result);
        return result;
    };

    const isReadOnly = !user || user.role !== 'admin';

    return (
        <AuthContext.Provider value={{
            isAuthenticated,
            isReadOnly,
            user,
            isLoading,
            token: token || getStoredToken(),
            mustChangePassword,
            setMustChangePassword,
            needsTenantSelection,
            allowedTenants,
            hasFullTenantAccess,
            completeTenantSelection,
            login,
            logout,
            refreshUser,
            updateMe
        }}>
            {children}
        </AuthContext.Provider>
    );
};

// ============ BASE44 AUTH PROVIDER (Original) ============
const Base44AuthProviderInner = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const refreshUser = async () => {
        if (isAuthenticated) {
            const userData = await base44.auth.me();
            setUser(userData);
        }
    };

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const isAuth = await base44.auth.isAuthenticated();
                setIsAuthenticated(isAuth);
                if (isAuth) {
                    const userData = await base44.auth.me();
                    setUser(userData);
                }
            } catch (error) {
                console.error("Auth check failed", error);
                setIsAuthenticated(false);
            } finally {
                setIsLoading(false);
            }
        };
        checkAuth();
    }, []);

    const isReadOnly = !user || user.role !== 'admin';

    const logout = () => {
        base44.auth.logout();
    };

    const login = () => {
        base44.auth.redirectToLogin();
    };

    const updateMe = async (data) => {
        await base44.auth.updateMe(data);
        await refreshUser();
    };

    return (
        <AuthContext.Provider value={{ 
            isAuthenticated, 
            isReadOnly, 
            user, 
            isLoading,
            refreshUser,
            updateMe,
            logout,
            login
        }}>
            {children}
        </AuthContext.Provider>
    );
};

// ============ MAIN EXPORT ============
export const AuthProvider = ({ children }) => {
    if (USE_CUSTOM_AUTH) {
        return <JWTAuthProviderInner>{children}</JWTAuthProviderInner>;
    }
    return <Base44AuthProviderInner>{children}</Base44AuthProviderInner>;
};

// Export config flag for other components
export const isUsingCustomAuth = () => USE_CUSTOM_AUTH;