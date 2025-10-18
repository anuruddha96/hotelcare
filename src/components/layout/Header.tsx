import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useParams } from 'react-router-dom';
import { useBranding } from '@/contexts/BrandingContext';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { UserManagementDialog } from '@/components/dashboard/UserManagementDialog';
import { LanguageSwitcher } from '@/components/dashboard/LanguageSwitcher';
import { ReportsDialog } from '@/components/dashboard/ReportsDialog';
import { ProfileDialog } from '@/components/dashboard/ProfileDialog';
import { SettingsDialog } from '@/components/dashboard/SettingsDialog';
import { HotelSwitcher } from '@/components/layout/HotelSwitcher';
import { DirtyLinenCartBadge } from '@/components/dashboard/DirtyLinenCartBadge';
import { LogOut, Settings, User, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function Header() {
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { t } = useTranslation();
  const { branding } = useBranding();
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
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-3 sm:px-4 py-1.5 sm:py-2">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <div className="relative" style={{ aspectRatio: '3/1' }}>
              <img 
                src={branding.logoUrl} 
                alt={branding.appName}
                className="h-10 sm:h-12 w-auto cursor-pointer hover:opacity-80 transition-opacity object-contain"
                onClick={() => navigate(`/${organizationSlug || 'rdhotels'}`)}
              />
            </div>
          </div>
          
          {/* Right side actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Hotel Switcher - only for multi-hotel users */}
            {(profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'top_management') && (
              <div className="hidden sm:block">
                <HotelSwitcher />
              </div>
            )}
            
            <div className="hidden md:block">
              <LanguageSwitcher />
            </div>
            
            <div className="hidden md:block">
              <DirtyLinenCartBadge />
            </div>
            
            {(profile?.role === 'admin' || profile?.role === 'manager') && (
              <div className="hidden lg:flex items-center gap-2">
                <ReportsDialog />
                <UserManagementDialog 
                  open={false}
                  onOpenChange={() => {}}
                />
              </div>
            )}
            
            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2 px-2 sm:px-3 h-9">
                  <Avatar className="h-7 w-7 sm:h-8 sm:w-8">
                    <AvatarImage src={profile?.profile_picture_url || ''} />
                    <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                      {profile?.full_name?.charAt(0) || profile?.email?.charAt(0) || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <ChevronDown className="h-3 w-3 opacity-50 hidden sm:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end">
                <div className="flex items-center justify-start gap-2 p-2">
                  <div className="flex flex-col space-y-1 leading-none">
                    <p className="font-medium text-sm">
                      {profile?.nickname || profile?.full_name}
                    </p>
                    <p className="w-[200px] truncate text-xs text-muted-foreground">
                      {profile?.email}
                    </p>
                    {profile && (
                      <Badge variant="secondary" className={`${getRoleColor(profile.role)} text-white mt-1`}>
                        {getRoleLabel(profile.role)}
                      </Badge>
                    )}
                    {profile?.assigned_hotel && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {profile.assigned_hotel}
                      </p>
                    )}
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
