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
import { SimplifiedDirtyLinenManagement } from './SimplifiedDirtyLinenManagement';
import { DirtyLinenItemsManagement } from './DirtyLinenItemsManagement';
import { MaintenancePhotosManagement } from './MaintenancePhotosManagement';
import { GeneralTasksManagement } from './GeneralTasksManagement';
import { LostAndFoundManagement } from './LostAndFoundManagement';
import { TabOrderManagement } from './TabOrderManagement';
import { usePendingApprovals } from '@/hooks/usePendingApprovals';
import { ClipboardCheck, Users, Upload, Zap, Trophy, UserPlus, Shield, Shirt, Camera, AlertTriangle, CheckCircle, Package, Settings } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface TabConfig {
  id: string;
  label: string;
  icon: React.ReactNode;
  colorClass?: string;
}

const TAB_CONFIGS: { [key: string]: TabConfig } = {
  'staff-management': { id: 'staff-management', label: 'Staff Management', icon: <UserPlus className="h-3 w-3 sm:h-4 sm:w-4" /> },
  'supervisor': { id: 'supervisor', label: 'Pending Approvals', icon: <Shield className="h-3 w-3 sm:h-4 sm:w-4" /> },
  'manage': { id: 'manage', label: 'Team View', icon: <Users className="h-3 w-3 sm:h-4 sm:w-4" /> },
  'performance': { id: 'performance', label: 'Performance', icon: <Trophy className="h-3 w-3 sm:h-4 sm:w-4" /> },
  'pms-upload': { id: 'pms-upload', label: 'PMS Upload', icon: <Upload className="h-3 w-3 sm:h-4 sm:w-4" /> },
  'completion-photos': { id: 'completion-photos', label: 'housekeeping.tabs.roomPhotos', icon: <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4 text-green-500" />, colorClass: 'text-green-500' },
  'dnd-photos': { id: 'dnd-photos', label: 'housekeeping.tabs.dndPhotos', icon: <AlertTriangle className="h-3 w-3 sm:h-4 sm:w-4 text-yellow-500" />, colorClass: 'text-yellow-500' },
  'maintenance-photos': { id: 'maintenance-photos', label: 'housekeeping.tabs.maintenance', icon: <AlertTriangle className="h-3 w-3 sm:h-4 sm:w-4 text-red-500" />, colorClass: 'text-red-500' },
  'lost-and-found': { id: 'lost-and-found', label: 'housekeeping.tabs.lostFound', icon: <Package className="h-3 w-3 sm:h-4 sm:w-4 text-blue-500" />, colorClass: 'text-blue-500' },
  'dirty-linen': { id: 'dirty-linen', label: 'housekeeping.tabs.dirtyLinen', icon: <Shirt className="h-3 w-3 sm:h-4 sm:w-4 text-purple-500" />, colorClass: 'text-purple-500' },
  'general-tasks': { id: 'general-tasks', label: 'housekeeping.tabs.generalTasks', icon: <ClipboardCheck className="h-3 w-3 sm:h-4 sm:w-4 text-teal-500" />, colorClass: 'text-teal-500' },
  'attendance': { id: 'attendance', label: 'HR Management', icon: <Users className="h-3 w-3 sm:h-4 sm:w-4" /> },
  'minibar': { id: 'minibar', label: 'Minibar Tracking', icon: <Trophy className="h-3 w-3 sm:h-4 sm:w-4" /> },
  'tab-order': { id: 'tab-order', label: 'Tab Settings', icon: <Settings className="h-3 w-3 sm:h-4 sm:w-4 text-orange-500" />, colorClass: 'text-orange-500' },
};

export function HousekeepingTab() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [userRole, setUserRole] = useState<string>('');
  const [activeTab, setActiveTab] = useState('assignments');
  const [orderedTabs, setOrderedTabs] = useState<string[]>([]);
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

  // Load tab order from localStorage
  useEffect(() => {
    const savedOrder = localStorage.getItem('housekeepingTabOrder');
    if (savedOrder) {
      try {
        const parsed = JSON.parse(savedOrder);
        setOrderedTabs(parsed.map((t: any) => t.id));
      } catch {
        setOrderedTabs([]);
      }
    }
  }, []);

  // Full management access: admin, top_management, manager, housekeeping_manager, marketing, control_finance, hr, front_office
  const hasManagerAccess = ['admin', 'top_management', 'manager', 'housekeeping_manager', 'marketing', 'control_finance', 'hr', 'front_office'].includes(userRole);
  const isAdmin = userRole === 'admin';
  
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

  // Get ordered tabs or use default order
  const getTabOrder = () => {
    const defaultOrder = [
      'staff-management', 'supervisor', 'manage', 'performance', 'pms-upload',
      'completion-photos', 'dnd-photos', 'maintenance-photos', 'lost-and-found',
      'dirty-linen', 'general-tasks', 'attendance', 'minibar'
    ];
    
    if (orderedTabs.length > 0) {
      return orderedTabs;
    }
    return defaultOrder;
  };

  const renderTabTrigger = (tabId: string) => {
    const config = TAB_CONFIGS[tabId];
    if (!config) return null;

    if (tabId === 'supervisor') {
      return (
        <TabsTrigger 
          key={tabId}
          value={tabId} 
          className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit relative"
        >
          {config.icon}
          <span className="hidden xs:inline">{t('supervisor.pendingApprovals')}</span>
          <span className="xs:hidden">Approval</span>
          {pendingCount > 0 && (
            <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs animate-pulse">
              {pendingCount}
            </Badge>
          )}
        </TabsTrigger>
      );
    }

    return (
      <TabsTrigger 
        key={tabId}
        value={tabId} 
        className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
      >
        {config.icon}
        <span className={`hidden sm:inline ${config.colorClass || ''}`}>{t(config.label)}</span>
        <span className={`sm:hidden ${config.colorClass || ''}`}>{t(config.label).split(' ')[0]}</span>
      </TabsTrigger>
    );
  };

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
              {getTabOrder().map(tabId => renderTabTrigger(tabId))}
              {isAdmin && (
                <TabsTrigger 
                  value="tab-order" 
                  className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
                >
                  <Settings className="h-3 w-3 sm:h-4 sm:w-4 text-orange-500" />
                  <span className="hidden sm:inline">Tab Settings</span>
                  <span className="sm:hidden">Settings</span>
                </TabsTrigger>
              )}
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
                <SimplifiedDirtyLinenManagement />
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
            
            {isAdmin && (
              <TabsContent value="tab-order" className="space-y-6">
                <TabOrderManagement />
              </TabsContent>
            )}
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