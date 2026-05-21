import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { User, LogOut, Lock, Mail } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { api } from "@/api/client";
import { getBuildInfo } from '@/lib/buildInfo';

export default function AccountMenu() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const { commitSha, commitShortSha } = getBuildInfo();
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isChangingEmail, setIsChangingEmail] = useState(false);

  // Password form state
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  // Email form state
  const [emailForm, setEmailForm] = useState({
    newEmail: '',
    password: ''
  });

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast({
        title: "Fehler",
        description: "Die neuen Passwörter stimmen nicht überein",
        variant: "destructive"
      });
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      toast({
        title: "Fehler",
        description: "Das Passwort muss mindestens 8 Zeichen lang sein",
        variant: "destructive"
      });
      return;
    }

    setIsChangingPassword(true);
    try {
      await api.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
      
      toast({
        title: "Erfolg",
        description: "Passwort wurde erfolgreich geändert"
      });
      
      setIsPasswordDialogOpen(false);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error) {
      toast({
        title: "Fehler",
        description: error.message || "Passwort konnte nicht geändert werden",
        variant: "destructive"
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleEmailChange = async (e) => {
    e.preventDefault();
    
    if (!emailForm.newEmail || !emailForm.newEmail.includes('@')) {
      toast({
        title: "Fehler",
        description: "Bitte geben Sie eine gültige E-Mail-Adresse ein",
        variant: "destructive"
      });
      return;
    }

    setIsChangingEmail(true);
    try {
      await api.changeEmail(emailForm.newEmail, emailForm.password);
      
      toast({
        title: "Erfolg",
        description: "E-Mail-Adresse wurde erfolgreich geändert. Bitte melden Sie sich erneut an."
      });
      
      setIsEmailDialogOpen(false);
      setEmailForm({ newEmail: '', password: '' });
      
      // Logout after email change
      setTimeout(() => {
        logout();
      }, 2000);
    } catch (error) {
      toast({
        title: "Fehler",
        description: error.message || "E-Mail-Adresse konnte nicht geändert werden",
        variant: "destructive"
      });
    } finally {
      setIsChangingEmail(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            data-testid="account-menu-trigger"
            variant="ghost" 
            size="sm"
            className="flex items-center gap-2 hover:bg-slate-100"
          >
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">{user?.full_name || user?.email}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span className="font-medium">{user?.full_name || 'Mein Account'}</span>
              <span className="text-xs text-slate-500 font-normal">{user?.email}</span>
              {commitShortSha && (
                <span
                  className="mt-1 font-mono text-[11px] text-slate-400 font-normal"
                  title={commitSha || commitShortSha}
                >
                  Build {commitShortSha}
                </span>
              )}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsEmailDialogOpen(true)}>
            <Mail className="mr-2 h-4 w-4" />
            E-Mail ändern
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsPasswordDialogOpen(true)}>
            <Lock className="mr-2 h-4 w-4" />
            Passwort ändern
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="account-menu-logout"
            onClick={logout}
            className="text-red-600 focus:text-red-600"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Abmelden
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Password Change Dialog */}
      <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Passwort ändern</DialogTitle>
            <DialogDescription>
              Ändern Sie Ihr Passwort. Das neue Passwort muss mindestens 8 Zeichen lang sein.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <Label htmlFor="currentPassword">Aktuelles Passwort</Label>
              <Input
                id="currentPassword"
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                required
                disabled={isChangingPassword}
              />
            </div>
            <div>
              <Label htmlFor="newPassword">Neues Passwort</Label>
              <Input
                id="newPassword"
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                required
                minLength={8}
                disabled={isChangingPassword}
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Neues Passwort bestätigen</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                required
                minLength={8}
                disabled={isChangingPassword}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setIsPasswordDialogOpen(false)}
                disabled={isChangingPassword}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={isChangingPassword}>
                {isChangingPassword ? 'Wird geändert...' : 'Passwort ändern'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Email Change Dialog */}
      <Dialog open={isEmailDialogOpen} onOpenChange={setIsEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>E-Mail-Adresse ändern</DialogTitle>
            <DialogDescription>
              Ändern Sie Ihre E-Mail-Adresse. Sie werden nach der Änderung automatisch abgemeldet.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEmailChange} className="space-y-4">
            <div>
              <Label htmlFor="currentEmail">Aktuelle E-Mail</Label>
              <Input
                id="currentEmail"
                type="email"
                value={user?.email || ''}
                disabled
                className="bg-slate-50"
              />
            </div>
            <div>
              <Label htmlFor="newEmail">Neue E-Mail-Adresse</Label>
              <Input
                id="newEmail"
                type="email"
                value={emailForm.newEmail}
                onChange={(e) => setEmailForm({ ...emailForm, newEmail: e.target.value })}
                required
                disabled={isChangingEmail}
                placeholder="neue@email.de"
              />
            </div>
            <div>
              <Label htmlFor="emailPassword">Passwort bestätigen</Label>
              <Input
                id="emailPassword"
                type="password"
                value={emailForm.password}
                onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })}
                required
                disabled={isChangingEmail}
                placeholder="Ihr aktuelles Passwort"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setIsEmailDialogOpen(false)}
                disabled={isChangingEmail}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={isChangingEmail}>
                {isChangingEmail ? 'Wird geändert...' : 'E-Mail ändern'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
