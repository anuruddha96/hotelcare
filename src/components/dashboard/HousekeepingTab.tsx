import React, { useState, useEffect, useRef } from 'react';
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

  // undefined = not yet resolved for hybrid users (avoids landing on wrong tab
  // before the count returns). false/true once known.
  const [hasActiveAssignmentsToday, setHasActiveAssignmentsToday] = useState<boolean | undefined>(
    isHybridHousekeeper ? undefined : false
  );

  // Whether the current user is signed in (attendance) for today. undefined
  // while loading. Used to route housekeepers/hybrids to the attendance tab
  // before they can start any room work.
  const canClean = isHybridHousekeeper || userRole === 'housekeeping';
  // Managers (and hybrids) also need to sign in for the day before they get
  // routed onto operational tabs. Executive read-only viewers are exempt.
  const requiresAttendance = canClean || (hasManagerAccess && !isExecutiveReadOnly);
  const [isSignedInToday, setIsSignedInToday] = useState<boolean | undefined>(
    requiresAttendance ? undefined : true
  );

  // Detect whether the hybrid user has any active room assignments today so we
  // can land them on My Tasks instead of Team View. Re-runs on realtime changes
  // to room_assignments for this user.
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
    const refresh = async () => {
      const { count } = await (supabase as any)
        .from('room_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('staff_id', user.id)
        .eq('assignment_date', todayKey)
        .in('status', ['assigned', 'in_progress']);
      if (!cancelled) setHasActiveAssignmentsToday((count || 0) > 0);
    };
    refresh();
    const channel = (supabase as any)
      .channel(`hybrid-assignments-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'room_assignments',
        filter: `staff_id=eq.${user.id}`,
      }, () => { refresh(); })
      .subscribe();
    return () => {
      cancelled = true;
      (supabase as any).removeChannel(channel);
    };
  }, [isHybridHousekeeper, user?.id]);

  // Track today's attendance for cleaners so we can land them on the
  // attendance tab until they sign in, then jump to My Tasks.
  useEffect(() => {
    if (!canClean || !user?.id) {
      setIsSignedInToday(canClean ? undefined : true);
      return;
    }
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const todayKey = `${y}-${m}-${d}`;
    let cancelled = false;
    const refresh = async () => {
      const { data } = await (supabase as any)
        .from('staff_attendance')
        .select('status')
        .eq('user_id', user.id)
        .eq('work_date', todayKey)
        .in('status', ['checked_in', 'on_break'])
        .limit(1);
      if (!cancelled) setIsSignedInToday(!!(data && data.length));
    };
    refresh();
    const channel = (supabase as any)
      .channel(`attendance-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'staff_attendance',
        filter: `user_id=eq.${user.id}`,
      }, () => { refresh(); })
      .subscribe();
    return () => {
      cancelled = true;
      (supabase as any).removeChannel(channel);
    };
  }, [canClean, user?.id]);

  // Track whether we've applied the initial default tab. After that the user
  // is free to navigate; we don't want async signals (pendingCount, realtime)
  // to keep yanking them back.
  const initialTabAppliedRef = useRef(false);
  // Separate one-shot: after we land the user on 'attendance' because they
  // aren't signed in yet, jump them to 'assignments' the moment they sign in.
  const postSigninJumpFiredRef = useRef(false);

  // Set the default active tab.
  //   Cleaners (housekeeping / hybrid) not signed in → Attendance.
  //   Pure managers → pending approvals (if any) else Team View.
  //   Hybrid supervisor+housekeeper priority (once signed in):
  //     1) active room assignments today → My Tasks
  //     2) pending approvals → Pending Approvals
  //     3) otherwise → Team View
  useEffect(() => {
    if (initialTabAppliedRef.current) return;
    // Wait until the user's role is resolved. Otherwise the effect fires on
    // first render with userRole='' and falls into the housekeeper fallback,
    // permanently latching managers onto "My Tasks".
    if (!userRole) return;

    const applyDefaultTab = (nextTab: string) => {
      initialTabAppliedRef.current = true;
      setActiveTab(nextTab);
      onActiveSubTabChange?.(nextTab);
      if (nextTab === 'manage') onActiveInnerTabChange?.('team');
    };

    if (isExecutiveReadOnly) { applyDefaultTab('manage'); return; }

    // Cleaners must sign in first. Wait for the attendance query to resolve.
    if (canClean) {
      if (isSignedInToday === undefined) return;
      if (!isSignedInToday) { applyDefaultTab('attendance'); return; }
    }

    if (hasManagerAccess) {
      if (isHybridHousekeeper) {
        // Wait for the assignments query to resolve before deciding.
        if (hasActiveAssignmentsToday === undefined) return;
        if (hasActiveAssignmentsToday) { applyDefaultTab('assignments'); return; }
        applyDefaultTab(pendingCount > 0 ? 'supervisor' : 'manage');
        return;
      }
      applyDefaultTab(pendingCount > 0 ? 'supervisor' : 'manage');
    } else if (userRole === 'reception') {
      applyDefaultTab('manage');
    } else {
      applyDefaultTab('assignments');
    }
  }, [hasManagerAccess, isExecutiveReadOnly, isHybridHousekeeper, hasActiveAssignmentsToday, canClean, isSignedInToday, userRole, pendingCount, onActiveSubTabChange, onActiveInnerTabChange]);

  // Post-signin jump: if the user was landed on 'attendance' because they
  // weren't signed in yet, jump them to My Tasks the moment their attendance
  // flips to checked_in. Fires at most once so we don't fight manual navigation.
  useEffect(() => {
    if (postSigninJumpFiredRef.current) return;
    if (!canClean) return;
    if (activeTab !== 'attendance') return;
    if (isSignedInToday === true) {
      postSigninJumpFiredRef.current = true;
      setActiveTab('assignments');
      onActiveSubTabChange?.('assignments');
    }
  }, [canClean, isSignedInToday, activeTab, onActiveSubTabChange]);




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
              {!isHybridHousekeeper && (
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
              )}
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