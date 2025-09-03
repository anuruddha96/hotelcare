import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { HousekeepingManagerView } from './HousekeepingManagerView';
import { HousekeepingStaffView } from './HousekeepingStaffView';
import { HousekeepingStaffManagement } from './HousekeepingStaffManagement';
import { PMSUpload } from './PMSUpload';
import { SimpleRoomAssignment } from './SimpleRoomAssignment';
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
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className={`grid w-full ${hasManagerAccess ? 'grid-cols-6' : 'grid-cols-1'}`}>
          <TabsTrigger value="assignments" className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            My Tasks
          </TabsTrigger>
          {hasManagerAccess && (
            <>
              <TabsTrigger value="quick-assign" className="flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Quick Assign
              </TabsTrigger>
              <TabsTrigger value="pms-upload" className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                PMS Upload
              </TabsTrigger>
              <TabsTrigger value="performance" className="flex items-center gap-2">
                <Trophy className="h-4 w-4" />
                Performance
              </TabsTrigger>
              <TabsTrigger value="staff-management" className="flex items-center gap-2">
                <UserPlus className="h-4 w-4" />
                Staff
              </TabsTrigger>
              <TabsTrigger value="manage" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Team View
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
              <SimpleRoomAssignment onAssignmentCreated={() => {
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