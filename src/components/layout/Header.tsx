import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { UserManagementDialog } from '@/components/dashboard/UserManagementDialog';
import { LanguageSwitcher } from '@/components/dashboard/LanguageSwitcher';
import { ReportsDialog } from '@/components/dashboard/ReportsDialog';
import { ProfileDialog } from '@/components/dashboard/ProfileDialog';
import { SettingsDialog } from '@/components/dashboard/SettingsDialog';
import { LogOut, Settings, User } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function Header() {
  const { profile, user, signOut } = useAuth();
  const { t } = useTranslation();
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-500';
      case 'manager': return 'bg-blue-500';
      case 'maintenance': return 'bg-green-500';
      case 'reception': return 'bg-purple-500';
      case 'housekeeping': return 'bg-orange-500';
      case 'marketing': return 'bg-pink-500';
      case 'control_finance': return 'bg-indigo-500';
      case 'hr': return 'bg-yellow-500';
      case 'front_office': return 'bg-teal-500';
      case 'top_management': return 'bg-gray-900';
      default: return 'bg-gray-500';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'housekeeping': return t('roles.housekeeping');
      case 'housekeeping_manager': return t('roles.housekeepingManager');
      case 'reception': return t('roles.reception');
      case 'maintenance': return t('roles.maintenance');
      case 'manager': return t('roles.manager');
      case 'admin': return t('roles.admin');
      case 'marketing': return t('roles.marketing');
      case 'control_finance': return t('roles.controlFinance');
      case 'hr': return t('roles.hr');
      case 'front_office': return t('roles.frontOffice');
      case 'top_management': return t('roles.topManagement');
      default: return role;
    }
  };

  return (
    <header className="bg-card/95 supports-[backdrop-filter]:bg-card/80 backdrop-blur border-b border-border sticky top-0 z-50 shadow-lg">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center gap-4 p-2 rounded-2xl bg-gradient-to-r from-primary/10 to-primary/5 ring-2 ring-primary/20 shadow-md">
            <div className="relative">
              <img
                src="/lovable-uploads/d6f6d925-1828-4b13-86b1-a9060e46bda7.png"
                alt="RD Hotels Logo"
                className="h-10 sm:h-12 w-auto object-contain drop-shadow-sm"
              />
              <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 to-primary/10 rounded-full blur opacity-60"></div>
            </div>
            <div className="flex flex-col">
              <span className="text-lg sm:text-xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/80 bg-clip-text text-transparent">
                RD Hotels
              </span>
              <span className="text-xs text-muted-foreground font-medium">
                {profile?.assigned_hotel || 'Hotel Management System'}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-4">
          <LanguageSwitcher />
          
          {(profile?.role === 'admin' || profile?.role === 'manager') && (
            <>
              <ReportsDialog />
              <UserManagementDialog 
                open={false}
                onOpenChange={() => {}}
              />
            </>
          )}
          
          {profile && (
            <div className="flex flex-col items-end gap-1">
              <Badge 
                variant="secondary" 
                className="text-xs sm:text-sm hidden sm:inline-flex"
              >
                {getRoleLabel(profile.role)}
              </Badge>
              {profile.assigned_hotel && (
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {profile.assigned_hotel}
                </span>
              )}
            </div>
          )}
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={profile?.profile_picture_url || ''} />
                  <AvatarFallback>
                    {((profile?.nickname || profile?.full_name || user?.email || 'U').charAt(0) || 'U').toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-48 sm:w-56" align="end">
              <div className="flex items-center justify-start gap-2 p-2">
                <div className="flex flex-col space-y-1 leading-none">
                  <p className="font-medium text-sm">
                    {profile?.nickname || profile?.full_name}
                  </p>
                  <p className="w-[160px] sm:w-[200px] truncate text-xs text-muted-foreground">
                    {profile?.email}
                  </p>
                  <p className="text-xs text-muted-foreground sm:hidden">
                    {profile && getRoleLabel(profile.role)}
                  </p>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setProfileDialogOpen(true)}>
                <User className="mr-2 h-4 w-4" />
                {t('common.profile')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSettingsDialogOpen(true)}>
                <Settings className="mr-2 h-4 w-4" />
                {t('common.settings')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()}>
                <LogOut className="mr-2 h-4 w-4" />
                {t('common.logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      <ProfileDialog 
        open={profileDialogOpen} 
        onOpenChange={setProfileDialogOpen} 
      />
      <SettingsDialog 
        open={settingsDialogOpen} 
        onOpenChange={setSettingsDialogOpen} 
      />
    </header>
  );
}