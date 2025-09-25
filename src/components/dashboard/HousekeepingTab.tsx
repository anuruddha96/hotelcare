import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { HousekeepingManagerView } from './HousekeepingManagerView';
import { HousekeepingStaffView } from './HousekeepingStaffView';
import { HousekeepingStaffManagement } from './HousekeepingStaffManagement';
import { PMSUpload } from './PMSUpload';
import { EasyRoomAssignment } from './EasyRoomAssignment';
import { PerformanceLeaderboard } from './PerformanceLeaderboard';
import { SupervisorApprovalView } from './SupervisorApprovalView';
import { BreakRequestApprovalView } from './BreakRequestApprovalView';
import { CompanySettings } from './CompanySettings';
import { AttendanceManagement } from './AttendanceManagement';
import { DailyPhotosManagement } from './DailyPhotosManagement';
import { DirtyLinenManagement } from './DirtyLinenManagement';
import { DirtyLinenItemsManagement } from './DirtyLinenItemsManagement';
import { usePendingApprovals } from '@/hooks/usePendingApprovals';
import { ClipboardCheck, Users, Upload, Zap, Trophy, UserPlus, Shield, Shirt, Camera } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function HousekeepingTab() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [userRole, setUserRole] = useState<string>('');
  const [activeTab, setActiveTab] = useState('assignments');
  const pendingCount = usePendingApprovals();

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

  // Full management access: admin, top_management, manager, housekeeping_manager, marketing, control_finance, hr, front_office
  const hasManagerAccess = ['admin', 'top_management', 'manager', 'housekeeping_manager', 'marketing', 'control_finance', 'hr', 'front_office'].includes(userRole);
  
  // Set the default active tab based on manager access - prioritize approvals
  useEffect(() => {
    if (hasManagerAccess) {
      setActiveTab('supervisor'); // Default to pending approvals for managers
    } else {
      setActiveTab('assignments');
    }
  }, [hasManagerAccess]);
  
  // Can view housekeeping section: all managerial roles EXCEPT housekeeping, reception, and maintenance
  const canAccessHousekeeping = hasManagerAccess || ['housekeeping'].includes(userRole);
  
  // Read-only access for housekeeping staff only
  const isReadOnlyAccess = ['housekeeping'].includes(userRole) && !hasManagerAccess;

  if (!canAccessHousekeeping) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>{t('housekeeping.accessRestricted')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className={`
          ${hasManagerAccess 
            ? 'flex overflow-x-auto scrollbar-hide w-full justify-start gap-1 p-1' 
            : 'grid w-full grid-cols-1'
          }
        `}>
          {hasManagerAccess && (
            <>
              <TabsTrigger 
                value="staff-management" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <UserPlus className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">{t('housekeeping.staff')}</span>
                <span className="xs:hidden">{t('housekeeping.staff')}</span>
              </TabsTrigger>
              <TabsTrigger 
                value="supervisor" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit relative"
              >
                <Shield className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">{t('supervisor.pendingApprovals')}</span>
                <span className="xs:hidden">Approval</span>
                {pendingCount > 0 && (
                  <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs animate-pulse">
                    {pendingCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger 
                value="manage" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <Users className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">{t('housekeeping.teamView')}</span>
                <span className="xs:hidden">{t('housekeeping.teamView')}</span>
              </TabsTrigger>
              <TabsTrigger 
                value="performance" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <Trophy className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">{t('housekeeping.performance')}</span>
                <span className="xs:hidden">{t('housekeeping.performance')}</span>
              </TabsTrigger>
              <TabsTrigger 
                value="pms-upload" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <Upload className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">{t('housekeeping.pmsUpload')}</span>
                <span className="xs:hidden">{t('housekeeping.pmsUpload')}</span>
              </TabsTrigger>
              <TabsTrigger 
                value="quick-assign" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <Zap className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">{t('housekeeping.quickAssign')}</span>
                <span className="xs:hidden">{t('housekeeping.quickAssign')}</span>
              </TabsTrigger>
              <TabsTrigger 
                value="daily-photos" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <Camera className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Daily Photos</span>
                <span className="sm:hidden">Photos</span>
              </TabsTrigger>
              <TabsTrigger 
                value="attendance" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <Users className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">{t('hr.management')}</span>
                <span className="sm:hidden">{t('hr.management')}</span>
              </TabsTrigger>
            </>
          )}
          <TabsTrigger
            value="assignments" 
            className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
          >
            <ClipboardCheck className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden xs:inline">{t('housekeeping.myTasks')}</span>
            <span className="xs:hidden">{t('housekeeping.myTasks')}</span>
          </TabsTrigger>
        </TabsList>

        {hasManagerAccess && (
          <>
            <TabsContent value="staff-management" className="space-y-6">
              <HousekeepingStaffManagement />
            </TabsContent>

            <TabsContent value="manage" className="space-y-6">
              <HousekeepingManagerView />
            </TabsContent>

            <TabsContent value="performance" className="space-y-6">
              <PerformanceLeaderboard />
            </TabsContent>

            <TabsContent value="pms-upload" className="space-y-6">
              <PMSUpload />
            </TabsContent>

            <TabsContent value="quick-assign" className="space-y-6">
              <EasyRoomAssignment onAssignmentCreated={() => {
                // Refresh the team view if it's active
                if (activeTab === 'manage') {
                  // This will be handled by the HousekeepingManagerView component
                }
              }} />
            </TabsContent>

            <TabsContent value="supervisor" className="space-y-6">
              <div className="space-y-6">
                <SupervisorApprovalView />
                <BreakRequestApprovalView />
              </div>
            </TabsContent>

            <TabsContent value="daily-photos" className="space-y-6">
              <DailyPhotosManagement />
            </TabsContent>

            <TabsContent value="attendance" className="space-y-6">
              <AttendanceManagement />
            </TabsContent>

            <TabsContent value="dirty-linen" className="space-y-6">
              <div className="space-y-6">
                <DirtyLinenManagement />
                {userRole === 'admin' && <DirtyLinenItemsManagement />}
              </div>
            </TabsContent>
          </>
        )}

        <TabsContent value="assignments" className="space-y-6">
          <HousekeepingStaffView />
        </TabsContent>
      </Tabs>
    </div>
  );
}