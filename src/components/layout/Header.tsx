import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { UserManagementDialog } from '@/components/dashboard/UserManagementDialog';
import { LanguageSwitcher } from '@/components/dashboard/LanguageSwitcher';
import { ReportsDialog } from '@/components/dashboard/ReportsDialog';
import { LogOut, Settings, User } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function Header() {
  const { profile, signOut } = useAuth();

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
      case 'housekeeping': return 'Housekeeping';
      case 'reception': return 'Reception';
      case 'maintenance': return 'Maintenance';
      case 'manager': return 'Manager';
      case 'admin': return 'Admin';
      case 'marketing': return 'Marketing';
      case 'control_finance': return 'Control & Finance';
      case 'hr': return 'HR';
      case 'front_office': return 'Front Office';
      case 'top_management': return 'Top Management';
      default: return role;
    }
  };

  return (
    <header className="bg-background border-b border-border sticky top-0 z-50">
      <div className="container mx-auto px-3 sm:px-4 py-3 flex items-center justify-between">
        <div className="min-w-0 flex-1 sm:flex-initial flex items-center">
          <img 
            src="/lovable-uploads/d6f6d925-1828-4b13-86b1-a9060e46bda7.png" 
            alt="RD Hotels Logo" 
            className="h-8 sm:h-10 w-auto object-contain"
          />
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
            <Badge 
              variant="secondary" 
              className={`${getRoleColor(profile.role)} text-white text-xs sm:text-sm hidden sm:inline-flex`}
            >
              {getRoleLabel(profile.role)}
            </Badge>
          )}
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                <Avatar className="h-10 w-10">
                  <AvatarFallback>
                    {profile?.full_name?.charAt(0)?.toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-48 sm:w-56" align="end">
              <div className="flex items-center justify-start gap-2 p-2">
                <div className="flex flex-col space-y-1 leading-none">
                  <p className="font-medium text-sm">{profile?.full_name}</p>
                  <p className="w-[160px] sm:w-[200px] truncate text-xs text-muted-foreground">
                    {profile?.email}
                  </p>
                  <p className="text-xs text-muted-foreground sm:hidden">
                    {profile && getRoleLabel(profile.role)}
                  </p>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()}>
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}