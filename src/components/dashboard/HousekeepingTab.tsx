import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { HousekeepingManagerView } from './HousekeepingManagerView';
import { HousekeepingStaffView } from './HousekeepingStaffView';
import { ClipboardCheck, Users } from 'lucide-react';

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

  const isManager = userRole === 'manager' || userRole === 'admin';
  const isHousekeeping = userRole === 'housekeeping' || isManager;

  if (!isHousekeeping) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>Access restricted to housekeeping staff and managers</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="assignments" className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            My Assignments
          </TabsTrigger>
          {isManager && (
            <TabsTrigger value="manage" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Manage Team
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="assignments" className="space-y-6">
          <HousekeepingStaffView />
        </TabsContent>

        {isManager && (
          <TabsContent value="manage" className="space-y-6">
            <HousekeepingManagerView />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}