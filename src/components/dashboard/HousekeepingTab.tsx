import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { HousekeepingManagerView } from './HousekeepingManagerView';
import { HousekeepingStaffView } from './HousekeepingStaffView';
import { HousekeepingStaffManagement } from './HousekeepingStaffManagement';
import { PMSUpload } from './PMSUpload';
import { PmsSyncControls } from '@/components/pms/PmsSyncControls';
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

import { LostAndFoundManagement } from './LostAndFoundManagement';
import { TabOrderManagement } from './TabOrderManagement';
import { usePendingApprovals } from '@/hooks/usePendingApprovals';
import { ClipboardCheck, Users, Upload, Zap, Trophy, UserPlus, Shield, Shirt, Camera, AlertTriangle, CheckCircle, Package, Settings } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { UI_HINTS } from '@/lib/ui-hints';

interface TabConfig {
  id: string;
  label: string;
  icon: React.ReactNode;
  colorClass?: string;
  hintKey?: string;
}

const TAB_CONFIGS: { [key: string]: TabConfig } = {
  'staff-management': { id: 'staff-management', label: 'housekeeping.tabs.staffManagement', icon: <UserPlus className="h-3 w-3 sm:h-4 sm:w-4" />, hintKey: 'hk.staffManagement' },
  'supervisor': { id: 'supervisor', label: 'housekeeping.tabs.pendingApprovals', icon: <Shield className="h-3 w-3 sm:h-4 sm:w-4" />, hintKey: 'hk.pendingApprovals' },
  'manage': { id: 'manage', label: 'housekeeping.tabs.teamView', icon: <Users className="h-3 w-3 sm:h-4 sm:w-4" />, hintKey: 'hk.teamView' },
  'performance': { id: 'performance', label: 'housekeeping.tabs.performance', icon: <Trophy className="h-3 w-3 sm:h-4 sm:w-4" />, hintKey: 'hk.performance' },
  'pms-upload': { id: 'pms-upload', label: 'housekeeping.tabs.pmsUpload', icon: <Upload className="h-3 w-3 sm:h-4 sm:w-4" />, hintKey: 'hk.pmsUpload' },
  'completion-photos': { id: 'completion-photos', label: 'housekeeping.tabs.roomPhotos', icon: <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4" />, colorClass: 'text-green-500', hintKey: 'hk.roomPhotos' },
  'dnd-photos': { id: 'dnd-photos', label: 'housekeeping.tabs.dndPhotos', icon: <AlertTriangle className="h-3 w-3 sm:h-4 sm:w-4" />, colorClass: 'text-yellow-500', hintKey: 'hk.dndPhotos' },
  'maintenance-photos': { id: 'maintenance-photos', label: 'housekeeping.tabs.maintenance', icon: <AlertTriangle className="h-3 w-3 sm:h-4 sm:w-4" />, colorClass: 'text-red-500', hintKey: 'hk.maintenance' },
  'lost-and-found': { id: 'lost-and-found', label: 'housekeeping.tabs.lostFound', icon: <Package className="h-3 w-3 sm:h-4 sm:w-4" />, colorClass: 'text-blue-500', hintKey: 'hk.lostFound' },
  'dirty-linen': { id: 'dirty-linen', label: 'housekeeping.tabs.dirtyLinen', icon: <Shirt className="h-3 w-3 sm:h-4 sm:w-4" />, colorClass: 'text-purple-500', hintKey: 'hk.dirtyLinen' },
  
  'attendance': { id: 'attendance', label: 'housekeeping.tabs.hrManagement', icon: <Users className="h-3 w-3 sm:h-4 sm:w-4" />, hintKey: 'hk.hrManagement' },
  'minibar': { id: 'minibar', label: 'housekeeping.tabs.minibarTracking', icon: <Trophy className="h-3 w-3 sm:h-4 sm:w-4" />, hintKey: 'hk.minibar' },
  'tab-order': { id: 'tab-order', label: 'housekeeping.tabs.tabSettings', icon: <Settings className="h-3 w-3 sm:h-4 sm:w-4 text-orange-500" />, colorClass: 'text-orange-500', hintKey: 'hk.tabSettings' },
};

interface HousekeepingTabProps {
  onActiveSubTabChange?: (tab: string) => void;
  onActiveInnerTabChange?: (tab: string) => void;
}

export function HousekeepingTab({ onActiveSubTabChange, onActiveInnerTabChange }: HousekeepingTabProps = {}) {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const [userRole, setUserRole] = useState<string>('');
  const [assignedHotel, setAssignedHotel] = useState<string>('');
  const [hidePmsUploadTab, setHidePmsUploadTab] = useState(false);
  const initialRole = profile?.role || '';
  const initialManagerAccess = ['admin', 'top_management', 'top_management_manager', 'manager', 'housekeeping_manager', 'marketing', 'control_finance', 'hr', 'front_office'].includes(initialRole);
  const [activeTab, setActiveTab] = useState(initialManagerAccess || initialRole === 'reception' ? 'manage' : 'assignments');
  const [orderedTabs, setOrderedTabs] = useState<string[]>([]);
  const { totalCount: pendingCount } = usePendingApprovals();

  useEffect(() => {
    const fetchUserRole = async () => {
      if (profile?.role) {
        setUserRole(profile.role);
        setAssignedHotel(profile.assigned_hotel || '');
        return;
      }
      if (user?.id) {
        const { data } = await supabase
          .from('profiles')
          .select('role, assigned_hotel')
          .eq('id', user.id)
          .single();
        setUserRole(data?.role || '');
        setAssignedHotel(data?.assigned_hotel || '');
      }
    };
    fetchUserRole();
  }, [user?.id, profile?.role, profile?.assigned_hotel]);

  useEffect(() => {
    const loadPmsUploadVisibility = async () => {
      if (!assignedHotel) {
        setHidePmsUploadTab(false);
        return;
      }
      // Direct SELECT on pms_configurations is admin-only, so managers
      // would always see the tab. Use the SECURITY DEFINER RPC that
      // returns just the boolean and honours slug/display-name variants.
      const { data, error } = await (supabase as any).rpc('get_pms_upload_hidden', {
        hotel_key: assignedHotel,
      });
      if (error) {
        console.warn('[HousekeepingTab] get_pms_upload_hidden failed:', error);
        setHidePmsUploadTab(false);
        return;
      }
      setHidePmsUploadTab(data === true);
    };
    void loadPmsUploadVisibility();
  }, [assignedHotel]);

  // Load tab order from database
  useEffect(() => {
    const loadTabOrder = async () => {
      if (!user?.id) return;

      try {
        // Get user's organization
        const { data: profileData } = await supabase
          .from('profiles')
          .select('organization_slug')
          .eq('id', user.id)
          .single();

        if (!profileData?.organization_slug) return;

        // Load organization's tab order setting
        const { data, error } = await supabase
          .from('organization_settings')
          .select('setting_value')
          .eq('organization_slug', profileData.organization_slug)
          .eq('setting_key', 'housekeeping_tab_order')
          .maybeSingle();

        if (error) throw error;

        if (data?.setting_value) {
          const tabConfigs = data.setting_value as any[];
          setOrderedTabs(tabConfigs.map((t: any) => t.id));
        }
      } catch (error) {
        console.error('Error loading tab order:', error);
      }
    };

    loadTabOrder();
  }, [user?.id]);

  // Full management access: admin, top_management, top_management_manager, manager, housekeeping_manager, marketing, control_finance, hr, front_office
  const hasManagerAccess = ['admin', 'top_management', 'top_management_manager', 'manager', 'housekeeping_manager', 'marketing', 'control_finance', 'hr', 'front_office'].includes(userRole);
  const isAdmin = userRole === 'admin';
  // Executive read-only viewers (Top Management): see informational tabs, skip operational ones
  const isExecutiveReadOnly = ['top_management', 'top_management_manager'].includes(userRole);
  // Hybrid: a manager who is also flagged as a housekeeper (can be assigned rooms).
  const isHybridHousekeeper = hasManagerAccess && !!(profile as any)?.acts_as_housekeeper;

  const [hasActiveAssignmentsToday, setHasActiveAssignmentsToday] = useState(false);

  // Detect whether the hybrid user has any active room assignments today so we
  // can land them on My Tasks instead of Team View.
  useEffect(() => {
    if (!isHybridHousekeeper || !user?.id) {
      setHasActiveAssignmentsToday(false);
      return;
    }
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const todayKey = `${y}-${m}-${d}`;
    let cancelled = false;
    (async () => {
      const { count } = await (supabase as any)
        .from('room_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('staff_id', user.id)
        .eq('assignment_date', todayKey)
        .in('status', ['assigned', 'in_progress']);
      if (!cancelled) setHasActiveAssignmentsToday((count || 0) > 0);
    })();
    return () => { cancelled = true; };
  }, [isHybridHousekeeper, user?.id]);

  // Set the default active tab. Managers should land directly on Team View
  // (or pending approvals when action is needed), not an empty/staff task view.
  useEffect(() => {
    const applyDefaultTab = (nextTab: string) => {
      setActiveTab(nextTab);
      onActiveSubTabChange?.(nextTab);
      if (nextTab === 'manage') onActiveInnerTabChange?.('team');
    };

    const checkDefaultTab = async () => {
      // Top Management (read-only) always lands on Team View
      if (isExecutiveReadOnly) {
        applyDefaultTab('manage');
        return;
      }
      if (hasManagerAccess) {
        // Hybrid supervisor+housekeeper: if they have rooms to clean today,
        // send them straight to My Tasks.
        if (isHybridHousekeeper && hasActiveAssignmentsToday) {
          applyDefaultTab('assignments');
          return;
        }
        applyDefaultTab(pendingCount > 0 ? 'supervisor' : 'manage');
      } else if (userRole === 'reception') {
        applyDefaultTab('manage');
      } else {
        applyDefaultTab('assignments');
      }
    };

    checkDefaultTab();
  }, [hasManagerAccess, isExecutiveReadOnly, isHybridHousekeeper, hasActiveAssignmentsToday, userRole, pendingCount, hidePmsUploadTab, onActiveSubTabChange, onActiveInnerTabChange]);

  // Can view housekeeping section: all managerial roles EXCEPT housekeeping, reception, and maintenance
  const canAccessHousekeeping = hasManagerAccess || ['housekeeping', 'reception'].includes(userRole);

  // Read-only access for housekeeping staff only
  const isReadOnlyAccess = ['housekeeping'].includes(userRole) && !hasManagerAccess;
  const isReceptionReadOnly = userRole === 'reception';

  // Get ordered tabs or use default order
  const getTabOrder = () => {
    const defaultOrder = [
      'staff-management', 'supervisor', 'manage', 'performance', 'pms-upload',
      'completion-photos', 'dnd-photos', 'maintenance-photos', 'lost-and-found',
      'dirty-linen', 'attendance', 'minibar'
    ];

    let order = orderedTabs.length > 0 ? orderedTabs : defaultOrder;
    if (hidePmsUploadTab) order = order.filter((id) => id !== 'pms-upload');
    // Hide operational/admin tabs for read-only executives
    if (isExecutiveReadOnly) {
      order = order.filter((id) => !['pms-upload', 'staff-management', 'supervisor'].includes(id));
    }
    // For hybrid supervisor+housekeeper users, insert the "My Tasks" tab
    // immediately after "Team View" (manage) so the two sit side-by-side.
    if (isHybridHousekeeper) {
      const idx = order.indexOf('manage');
      const withoutAssignments = order.filter((id) => id !== 'assignments');
      if (idx >= 0) {
        withoutAssignments.splice(idx + 1, 0, 'assignments');
      } else {
        withoutAssignments.unshift('assignments');
      }
      order = withoutAssignments;
    }
    return order;
  };

  const renderTabTrigger = (tabId: string) => {
    if (tabId === 'assignments') {
      return (
        <TabsTrigger
          key="assignments"
          value="assignments"
          className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
          data-training="my-tasks-tab"
        >
          <HelpTooltip hint={UI_HINTS["hk.myTasks"]}>
            <span className="flex items-center gap-1 sm:gap-2">
              <ClipboardCheck className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden xs:inline">{t('housekeeping.myTasks')}</span>
              <span className="xs:hidden">{t('housekeeping.myTasks')}</span>
            </span>
          </HelpTooltip>
        </TabsTrigger>
      );
    }
    const config = TAB_CONFIGS[tabId];
    if (!config) return null;

    if (tabId === 'supervisor') {
      return (
        <TabsTrigger 
          key={tabId}
          value={tabId} 
          className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit relative"
        >
          <HelpTooltip hint={UI_HINTS[config.hintKey || '']}>
            <span className="flex items-center gap-1 sm:gap-2">
              {config.icon}
              <span className="hidden xs:inline">{t('supervisor.pendingApprovals')}</span>
              <span className="xs:hidden">Approval</span>
              {pendingCount > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs animate-pulse">
                  {pendingCount}
                </Badge>
              )}
            </span>
          </HelpTooltip>
        </TabsTrigger>
      );
    }

    const tabIcon = React.cloneElement(config.icon as React.ReactElement, {
      className: `h-3 w-3 sm:h-4 sm:w-4 ${config.colorClass || ''}`
    });

    return (
      <TabsTrigger 
        key={tabId}
        value={tabId} 
        className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
      >
        <HelpTooltip hint={UI_HINTS[config.hintKey || '']}>
          <span className="flex items-center gap-1 sm:gap-2">
            {tabIcon}
            <span className="hidden sm:inline">{t(config.label)}</span>
            <span className="sm:hidden">{t(config.label).split(' ')[0]}</span>
          </span>
        </HelpTooltip>
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
      <Tabs value={activeTab} onValueChange={(val) => { setActiveTab(val); onActiveSubTabChange?.(val); }} className="w-full">
        <TabsList className={`
          ${hasManagerAccess || isReceptionReadOnly
            ? 'inline-flex overflow-x-auto overflow-y-hidden w-full justify-start gap-1 p-1 h-auto flex-nowrap scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent' 
            : 'grid w-full grid-cols-1'
          }
        `}>
          {isReceptionReadOnly ? (
            <TabsTrigger 
              value="manage" 
              className="flex items-center gap-1 sm:gap-2 whitespace-nowrap px-3 sm:px-4 text-xs sm:text-sm min-w-fit"
            >
              <Users className="h-3 w-3 sm:h-4 sm:w-4" />
              <span>{t('housekeeping.tabs.teamView')}</span>
            </TabsTrigger>
          ) : (
            <>
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
                data-training="my-tasks-tab"
              >
                <HelpTooltip hint={UI_HINTS["hk.myTasks"]}>
                  <span className="flex items-center gap-1 sm:gap-2">
                    <ClipboardCheck className="h-3 w-3 sm:h-4 sm:w-4" />
                    <span className="hidden xs:inline">{t('housekeeping.myTasks')}</span>
                    <span className="xs:hidden">{t('housekeeping.myTasks')}</span>
                  </span>
                </HelpTooltip>
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {hasManagerAccess && (
          <>
            <TabsContent value="staff-management" className="space-y-6">
              <HousekeepingStaffManagement />
            </TabsContent>

            <TabsContent value="manage" className="space-y-6">
              <HousekeepingManagerView onActiveInnerTabChange={onActiveInnerTabChange} />
            </TabsContent>

            <TabsContent value="performance" className="space-y-6">
              <PerformanceLeaderboard />
            </TabsContent>

            {!hidePmsUploadTab && (
              <TabsContent value="pms-upload" className="space-y-6">
                {isAdmin && (
                  <div className="text-[11px] text-muted-foreground rounded-md border border-dashed border-border/60 bg-muted/30 px-3 py-1.5">
                    Admin tip: hide this tab from managers in <strong>Admin → PMS Config → Hide legacy PMS Upload tab</strong>.
                  </div>
                )}
                <PmsSyncControls hotelId={assignedHotel} uploadAnchorId="pms-xlsx-upload" />
                <div id="pms-xlsx-upload">
                  <PMSUpload onNavigateToTeamView={() => setActiveTab('manage')} />
                </div>
              </TabsContent>
            )}

            <TabsContent value="supervisor" className="space-y-6">
              <div className="space-y-6">
                <SupervisorApprovalView />
                <BreakRequestApprovalView />
              </div>
            </TabsContent>

            <TabsContent value="completion-photos" className="space-y-6">
              <CompletionPhotosManagement />
            </TabsContent>

            <TabsContent value="dnd-photos" className="space-y-6" data-training="dnd-photos-tab">
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

        {isReceptionReadOnly && (
          <TabsContent value="manage" className="space-y-6">
            <HousekeepingManagerView />
          </TabsContent>
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