import React, { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { CalendarDays, Users, Activity, LogOut, GraduationCap, LogIn, Eye, Lock, BarChart3, HelpCircle, LayoutDashboard, Flower2, MessageSquare } from 'lucide-react';
import { api, db, base44 } from "@/api/client";
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import AccountMenu from '@/components/auth/AccountMenu';
import ForcePasswordChangeDialog from '@/components/auth/ForcePasswordChangeDialog';

import { Menu, ChevronLeft } from 'lucide-react';
import { generateThemeCss } from '@/components/themeConfig';
import ThemeSelector from '@/components/ThemeSelector';
import { Palette } from 'lucide-react';
import { useSectionConfig } from '@/components/settings/SectionConfigDialog';
import CoWorkWidget from '@/components/CoWorkWidget';
import TicketDialog from '@/components/TicketDialog';

function LayoutContent({ children }) {
  const { isAuthenticated, isReadOnly, isLoading, mustChangePassword, setMustChangePassword } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  const [isSidebarHovered, setIsSidebarHovered] = React.useState(false);
  const [isThemeOpen, setIsThemeOpen] = React.useState(false);
  const [isTicketDialogOpen, setIsTicketDialogOpen] = React.useState(false);
  const [ticketDialogType, setTicketDialogType] = React.useState('bug');
  const [ticketDialogError, setTicketDialogError] = React.useState(null);
  const { getSectionName } = useSectionConfig();
  const servicesCaption = getSectionName('Dienste');
  const rotationsCaption = getSectionName('Rotationen');
  const servicesNavLabel = servicesCaption === 'Dienste' ? 'Dienstbesetzung' : servicesCaption;
  const rotationsNavLabel = rotationsCaption === 'Rotationen' ? 'Rotationsplaner' : rotationsCaption;
  


  const { user } = useAuth(); // Get user from auth context

  useEffect(() => {
    // Import and use hybrid storage for PWA compatibility
    import('@/components/dbTokenStorage').then(({ initDbToken }) => {
        initDbToken();
    });
  }, []);

  // Global function to open ticket dialog (used by ErrorBoundary)
  useEffect(() => {
    window.__openTicketDialog = (type, error) => {
      setTicketDialogType(type || 'bug');
      setTicketDialogError(error || null);
      setIsTicketDialogOpen(true);
    };
    return () => {
      delete window.__openTicketDialog;
    };
  }, []);

  // Inject Theme CSS
  useEffect(() => {
    if (user && user.theme) {
        const css = generateThemeCss(user.theme);
        const styleId = 'theme-override-style';
        let styleEl = document.getElementById(styleId);
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = styleId;
            document.head.appendChild(styleEl);
        }
        styleEl.innerHTML = css;
    }
  }, [user?.theme]);

  const { data: hasDashboardAlert } = useQuery({
    queryKey: ['dashboardAlert', isAuthenticated, isReadOnly], // re-check when auth changes
    queryFn: async () => {
      if (!isAuthenticated) return false;
      const user = await base44.auth.me();
      if (!user) return false;
      
      // If Admin: Check for pending wishes
      if (!isReadOnly) {
         const pending = await db.WishRequest.filter({ status: 'pending' });
         return pending.length > 0;
      } 
      // If User: Check for unviewed updates (user_viewed = false)
      else {
         if (!user.doctor_id) return false;
         // Only care about updates where user_viewed is explicitly false (set by admin on update)
         const unviewed = await db.WishRequest.filter({ doctor_id: user.doctor_id, user_viewed: false });
         return unviewed.length > 0;
      }
    },
    enabled: isAuthenticated,
    refetchInterval: 30000, // Check every 30s
  });

  useEffect(() => {
    let timeout;
    if (isSidebarOpen && !isSidebarHovered) {
      timeout = setTimeout(() => {
        setIsSidebarOpen(false);
      }, 3000);
    }
    return () => clearTimeout(timeout);
  }, [isSidebarOpen, isSidebarHovered, location.pathname]);

  const authLoginPath = createPageUrl('AuthLogin');
  const isAuthPage = location.pathname.toLowerCase() === authLoginPath.toLowerCase();
  const isEmbeddedSchedule = React.useMemo(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('embeddedSchedule') !== '1') return false;
    const schedulePath = createPageUrl('Schedule');
    return location.pathname === schedulePath || location.pathname === '/';
  }, [location.pathname, location.search]);

  useEffect(() => {
    // If not authenticated and not on login page, redirect to login
    if (!isLoading && !isAuthenticated && !isAuthPage) {
        const redirectTarget = `${location.pathname}${location.search}${location.hash}`;
        const loginUrl = `${authLoginPath}?redirect=${encodeURIComponent(redirectTarget)}`;
        navigate(loginUrl, { replace: true });
    }
  }, [authLoginPath, isAuthenticated, isLoading, isAuthPage, location.hash, location.pathname, location.search, navigate]);

  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
  };

  const handleLogin = () => {
    base44.auth.redirectToLogin();
  };

  if (isEmbeddedSchedule) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans text-slate-900 notranslate" translate="no">
        <main className="p-0">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 notranslate" translate="no" data-testid="app-shell">
      {/* Sidebar Navigation */}
      {/* Overlay for mobile */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside 
        data-testid="app-sidebar"
        className={`fixed left-0 top-0 z-40 h-screen w-64 border-r border-slate-200 bg-white shadow-sm transition-transform duration-300 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        onMouseEnter={() => setIsSidebarHovered(true)}
        onMouseLeave={() => setIsSidebarHovered(false)}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-100 px-4">
          <Link to={createPageUrl('Home')} className="flex items-center hover:opacity-80 transition-opacity">
            <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6968fa78df93ab8a974bdc68/41f77f60e_Gemini_Generated_Image_184c7e184c7e184c.png" alt="CuraFlow" className="mr-2 h-8 w-8 object-contain" />
            <span className="text-lg font-bold tracking-tight text-slate-900">CuraFlow</span>
          </Link>
          <button onClick={() => setIsSidebarOpen(false)} className="text-slate-400 hover:text-slate-600">
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>
        
        <div className="px-3 py-4">
          {isAuthenticated ? (
          <nav className="space-y-1">
            <Link
              to={createPageUrl('MyDashboard')}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 group transition-colors"
            >
              <div className="flex items-center">
                  <LayoutDashboard className="h-5 w-5 mr-3 text-slate-500 group-hover:text-indigo-600" />
                  <span className="font-medium">Mein Dashboard</span>
              </div>
              {hasDashboardAlert && (
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse shadow-sm"></span>
              )}
            </Link>

            <Link
              to={createPageUrl('Schedule')}
              className="flex items-center rounded-lg px-3 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 group transition-colors"
            >
              <CalendarDays className="h-5 w-5 mr-3 text-slate-500 group-hover:text-indigo-600" />
              <span className="font-medium">Wochenplan</span>
            </Link>

            <Link
              to={createPageUrl('ServiceStaffing')}
              className="flex items-center rounded-lg px-3 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 group transition-colors"
            >
              <Activity className="h-5 w-5 mr-3 text-slate-500 group-hover:text-indigo-600" />
              <span className="font-medium">{servicesNavLabel}</span>
            </Link>

            {!isReadOnly && (
            <Link
              to={createPageUrl('Staff')}
              data-testid="nav-link-staff"
              className="flex items-center rounded-lg px-3 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 group transition-colors"
            >
              <Users className="h-5 w-5 mr-3 text-slate-500 group-hover:text-indigo-600" />
              <span className="font-medium">Team</span>
            </Link>
            )}

            <Link
              to={createPageUrl('Vacation')}
              className="flex items-center rounded-lg px-3 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 group transition-colors"
            >
              <CalendarDays className="h-5 w-5 mr-3 text-slate-500 group-hover:text-indigo-600" />
              <span className="font-medium">{getSectionName('Abwesenheiten')}</span>
            </Link>

            <Link
              to={createPageUrl('WishList')}
              className="flex items-center rounded-lg px-3 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 group transition-colors"
            >
              <Flower2 className="h-5 w-5 mr-3 text-slate-500 group-hover:text-indigo-600" />
              <span className="font-medium">Wunschkiste</span>
            </Link>

            <Link
              to={createPageUrl('Training')}
              className="flex items-center rounded-lg px-3 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 group transition-colors"
            >
              <GraduationCap className="h-5 w-5 mr-3 text-slate-500 group-hover:text-indigo-600" />
              <span className="font-medium">{rotationsNavLabel}</span>
            </Link>

            {!isReadOnly && (
            <Link
              to={createPageUrl('Statistics')}
              className="flex items-center rounded-lg px-3 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 group transition-colors"
            >
              <BarChart3 className="h-5 w-5 mr-3 text-slate-500 group-hover:text-indigo-600" />
              <span className="font-medium">Statistik</span>
            </Link>
            )}

            <Link
              to={createPageUrl('Help')}
              className="flex items-center rounded-lg px-3 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 group transition-colors"
            >
              <HelpCircle className="h-5 w-5 mr-3 text-slate-500 group-hover:text-indigo-600" />
              <span className="font-medium">Hilfe</span>
            </Link>

            <div className="my-2 border-t border-slate-100 mx-3" />

            <button
              onClick={() => { setTicketDialogType(undefined); setTicketDialogError(null); setIsTicketDialogOpen(true); }}
              className="flex w-full items-center rounded-lg px-3 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 group transition-colors text-left"
            >
              <MessageSquare className="h-5 w-5 mr-3 text-slate-500 group-hover:text-indigo-600" />
              <span className="font-medium">Feedback & Verbesserungen</span>
            </button>

            <button
              onClick={() => setIsThemeOpen(true)}
              className="flex w-full items-center rounded-lg px-3 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 group transition-colors text-left"
            >
              <Palette className="h-5 w-5 mr-3 text-slate-500 group-hover:text-indigo-600" />
              <span className="font-medium">Design wählen</span>
            </button>

            {!isReadOnly && (
              <>
                <div className="my-2 border-t border-slate-100 mx-3" />
                <Link
                  data-testid="nav-link-admin"
                  to={createPageUrl('Admin')}
                  className="flex items-center rounded-lg px-3 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 group transition-colors"
                >
                  <Lock className="h-5 w-5 mr-3 text-slate-500 group-hover:text-indigo-600" />
                  <span className="font-medium">Adminbereich</span>
                </Link>
              </>
            )}
            </nav>
          ) : (
            <div className="px-3 py-4 text-sm text-slate-500 text-center">
                <Lock className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p>Bitte melden Sie sich an, um Zugriff zu erhalten.</p>
            </div>
          )}
        </div>

        <div className="absolute bottom-0 w-full border-t border-slate-100 p-4">
          {isAuthenticated ? (
            <button 
              onClick={handleLogout}
              className="flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            >
              <LogOut className="mr-3 h-4 w-4" />
              Abmelden
            </button>
          ) : (
            <button 
              onClick={handleLogin}
              className="flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
            >
              <LogIn className="mr-3 h-4 w-4" />
              Anmelden
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className={`transition-all duration-300 ${isSidebarOpen ? 'lg:ml-64' : 'ml-0'}`}>
        <header className="h-16 border-b border-slate-200 bg-white flex items-center px-4 sticky top-0 z-30">
          {!isSidebarOpen && (
            <button 
              data-testid="sidebar-open-button"
              onClick={() => setIsSidebarOpen(true)}
              className="mr-4 p-2 rounded-md text-slate-500 hover:bg-slate-100"
            >
              <Menu className="h-6 w-6" />
            </button>
          )}
          <div className="flex-1 flex justify-center items-center gap-4">
            {isReadOnly && (
                <div className="bg-amber-100 text-amber-800 px-4 py-1 rounded-full text-xs font-medium flex items-center gap-2">
                    <Eye className="w-3 h-3" />
                    Schreibgeschützter Modus
                </div>
            )}
          </div>
          
          {isAuthenticated && (
            <AccountMenu />
          )}
        </header>
        <main className="p-2 sm:p-4 lg:p-8">
          {children}
        </main>
      </div>
      
      {/* Force Password Change Dialog */}
      {mustChangePassword && (
        <ForcePasswordChangeDialog 
          isOpen={mustChangePassword} 
          onPasswordChanged={() => setMustChangePassword(false)}
        />
      )}
      <ThemeSelector open={isThemeOpen} onOpenChange={setIsThemeOpen} />
      <CoWorkWidget />
      <TicketDialog
        open={isTicketDialogOpen}
        onOpenChange={setIsTicketDialogOpen}
        initialType={ticketDialogType}
        initialError={ticketDialogError}
      />
    </div>
  );
}

export default function Layout({ children }) {
  return <LayoutContent>{children}</LayoutContent>;
}
