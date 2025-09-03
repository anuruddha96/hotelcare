import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { HousekeepingManagerView } from './HousekeepingManagerView';
import { HousekeepingStaffView } from './HousekeepingStaffView';
import { HousekeepingStaffManagement } from './HousekeepingStaffManagement';
import { PMSUpload } from './PMSUpload';
import { EasyRoomAssignment } from './EasyRoomAssignment';
import { PerformanceLeaderboard } from './PerformanceLeaderboard';
import { ClipboardCheck, Users, Upload, Zap, Trophy, UserPlus } from 'lucide-react';

export function HousekeepingTab() {
  const { user } = useAuth();
  const [userRole, setUserRole] = useState<string>('');
  const [activeTab, setActiveTab] = useState('assignments');

  useEffect(() => {
    const fetchUserRole = async () => {
      if (user?.id) {
        const { data } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();
        setUserRole(data?.role || '');
      }
    };
    fetchUserRole();
  }, [user?.id]);

  // Full management access: admin, top_management, manager, housekeeping_manager, reception
  const hasManagerAccess = ['admin', 'top_management', 'manager', 'housekeeping_manager', 'reception'].includes(userRole);
  
  // Can view housekeeping section: all staff with manager access + housekeeping + maintenance (read-only)
  const canAccessHousekeeping = hasManagerAccess || ['housekeeping', 'maintenance'].includes(userRole);
  
  // Read-only access for minor staff
  const isReadOnlyAccess = ['housekeeping', 'maintenance'].includes(userRole) && !hasManagerAccess;

  if (!canAccessHousekeeping) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>Access restricted to housekeeping staff and managers</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className={`
          ${hasManagerAccess 
            ? 'flex flex-nowrap overflow-x-auto scrollbar-hide w-full justify-start gap-1 p-1' 
            : 'grid w-full grid-cols-1'
          }
          ${hasManagerAccess ? 'sm:grid sm:grid-cols-6 sm:justify-center' : ''}
        `}>
          <TabsTrigger 
            value="assignments" 
            className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
          >
            <ClipboardCheck className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden xs:inline">My Tasks</span>
            <span className="xs:hidden">Tasks</span>
          </TabsTrigger>
          {hasManagerAccess && (
            <>
              <TabsTrigger 
                value="quick-assign" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <Zap className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">Quick Assign</span>
                <span className="xs:hidden">Assign</span>
              </TabsTrigger>
              <TabsTrigger 
                value="pms-upload" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <Upload className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">PMS Upload</span>
                <span className="xs:hidden">Upload</span>
              </TabsTrigger>
              <TabsTrigger 
                value="performance" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <Trophy className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">Performance</span>
                <span className="xs:hidden">Stats</span>
              </TabsTrigger>
              <TabsTrigger 
                value="staff-management" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <UserPlus className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">Staff</span>
                <span className="xs:hidden">Staff</span>
              </TabsTrigger>
              <TabsTrigger 
                value="manage" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <Users className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">Team View</span>
                <span className="xs:hidden">Team</span>
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="assignments" className="space-y-6">
          <HousekeepingStaffView />
        </TabsContent>

        {hasManagerAccess && (
          <>
            <TabsContent value="quick-assign" className="space-y-6">
              <EasyRoomAssignment onAssignmentCreated={() => {
                // Refresh the team view if it's active
                if (activeTab === 'manage') {
                  // This will be handled by the HousekeepingManagerView component
                }
              }} />
            </TabsContent>

            <TabsContent value="pms-upload" className="space-y-6">
              <PMSUpload />
            </TabsContent>

            <TabsContent value="performance" className="space-y-6">
              <PerformanceLeaderboard />
            </TabsContent>

            <TabsContent value="staff-management" className="space-y-6">
              <HousekeepingStaffManagement />
            </TabsContent>

            <TabsContent value="manage" className="space-y-6">
              <HousekeepingManagerView />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}