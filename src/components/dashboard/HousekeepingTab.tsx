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
import { MinibarTrackingView } from './MinibarTrackingView';
import { SupervisorApprovalView } from './SupervisorApprovalView';
import { BreakRequestApprovalView } from './BreakRequestApprovalView';
import { CompanySettings } from './CompanySettings';
import { AttendanceManagement } from './AttendanceManagement';
import { DailyPhotosManagement } from './DailyPhotosManagement';
import { DNDPhotosManagement } from './DNDPhotosManagement';
import { CompletionPhotosManagement } from './CompletionPhotosManagement';
import { DirtyLinenManagement } from './DirtyLinenManagement';
import { DirtyLinenItemsManagement } from './DirtyLinenItemsManagement';
import { MaintenancePhotosManagement } from './MaintenancePhotosManagement';
import { GeneralTasksManagement } from './GeneralTasksManagement';
import { LostAndFoundManagement } from './LostAndFoundManagement';
import { usePendingApprovals } from '@/hooks/usePendingApprovals';
import { ClipboardCheck, Users, Upload, Zap, Trophy, UserPlus, Shield, Shirt, Camera, AlertTriangle, CheckCircle, Package } from 'lucide-react';
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
  
  // Set the default active tab based on manager access and PMS upload status
  useEffect(() => {
    const checkPMSUploadStatus = async () => {
      if (hasManagerAccess) {
        // Check if PMS upload has been done today
        const today = new Date().toISOString().split('T')[0];
        const { data } = await supabase
          .from('pms_upload_summary')
          .select('id')
          .gte('upload_date', `${today}T00:00:00`)
          .lte('upload_date', `${today}T23:59:59`)
          .limit(1);

        // If no upload today, default to PMS upload tab
        if (!data || data.length === 0) {
          setActiveTab('pms-upload');
        } else {
          // Otherwise, default to pending approvals
          setActiveTab('supervisor');
        }
      } else {
        setActiveTab('assignments');
      }
    };
    
    checkPMSUploadStatus();
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
            ? 'inline-flex overflow-x-auto overflow-y-hidden w-full justify-start gap-1 p-1 h-auto flex-nowrap scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent' 
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
                value="completion-photos" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Room Completion Photos</span>
                <span className="sm:hidden">Room Photos</span>
              </TabsTrigger>
              <TabsTrigger 
                value="dnd-photos" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <AlertTriangle className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">DND Photos</span>
                <span className="sm:hidden">DND</span>
              </TabsTrigger>
              <TabsTrigger 
                value="dirty-linen" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <Shirt className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Dirty Linen</span>
                <span className="sm:hidden">Linen</span>
              </TabsTrigger>
              <TabsTrigger 
                value="maintenance-photos" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <AlertTriangle className="h-3 w-3 sm:h-4 sm:w-4 text-destructive" />
                <span className="hidden sm:inline">Maintenance Issues</span>
                <span className="sm:hidden">Maintenance</span>
              </TabsTrigger>
              <TabsTrigger 
                value="general-tasks" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <ClipboardCheck className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">General Tasks</span>
                <span className="sm:hidden">Tasks</span>
              </TabsTrigger>
              <TabsTrigger 
                value="lost-and-found" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <Package className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Lost & Found</span>
                <span className="sm:hidden">L&F</span>
              </TabsTrigger>
              <TabsTrigger 
                value="attendance" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <Users className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">{t('hr.management')}</span>
                <span className="sm:hidden">{t('hr.management')}</span>
              </TabsTrigger>
              <TabsTrigger 
                value="minibar" 
                className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
              >
                <Trophy className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">{t('minibar.tracking')}</span>
                <span className="sm:hidden">Minibar</span>
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

            <TabsContent value="supervisor" className="space-y-6">
              <div className="space-y-6">
                <SupervisorApprovalView />
                <BreakRequestApprovalView />
              </div>
            </TabsContent>

            <TabsContent value="completion-photos" className="space-y-6">
              <CompletionPhotosManagement />
            </TabsContent>

            <TabsContent value="dnd-photos" className="space-y-6">
              <DNDPhotosManagement />
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

            <TabsContent value="maintenance-photos" className="space-y-6">
              <MaintenancePhotosManagement />
            </TabsContent>

            <TabsContent value="general-tasks" className="space-y-6">
              <GeneralTasksManagement />
            </TabsContent>

            <TabsContent value="lost-and-found" className="space-y-6">
              <LostAndFoundManagement />
            </TabsContent>
          </>
        )}

        <TabsContent value="assignments" className="space-y-6">
          <HousekeepingStaffView />
        </TabsContent>

        {hasManagerAccess && (
          <TabsContent value="minibar" className="space-y-6">
            <MinibarTrackingView />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}