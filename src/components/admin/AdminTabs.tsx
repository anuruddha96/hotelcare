import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrganizationManagement } from './OrganizationManagement';
import { HotelManagementView } from './HotelManagementView';
import { TranslationManagement } from './TranslationManagement';
import { PhotoCleanupManager } from '@/components/dashboard/PhotoCleanupManager';
import PMSConfigurationManagement from './PMSConfigurationManagement';
import { Building2, Hotel, Languages, HardDrive, Cable } from 'lucide-react';

export const AdminTabs = () => {
  return (
    <div className="p-6">
      <Tabs defaultValue="organizations" className="space-y-6">
        <TabsList>
          <TabsTrigger value="organizations" className="gap-2">
            <Building2 className="w-4 h-4" />
            Organizations
          </TabsTrigger>
          <TabsTrigger value="hotels" className="gap-2">
            <Hotel className="w-4 h-4" />
            Hotels
          </TabsTrigger>
          <TabsTrigger value="pms" className="gap-2">
            <Cable className="w-4 h-4" />
            PMS Config
          </TabsTrigger>
          <TabsTrigger value="translations" className="gap-2">
            <Languages className="w-4 h-4" />
            Translations
          </TabsTrigger>
          <TabsTrigger value="system" className="gap-2">
            <HardDrive className="w-4 h-4" />
            System
          </TabsTrigger>
        </TabsList>

        <TabsContent value="organizations">
          <OrganizationManagement />
        </TabsContent>

        <TabsContent value="hotels">
          <HotelManagementView />
        </TabsContent>

        <TabsContent value="pms">
          <PMSConfigurationManagement />
        </TabsContent>

        <TabsContent value="translations">
          <TranslationManagement />
        </TabsContent>

        <TabsContent value="system">
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold">System Management</h2>
              <p className="text-muted-foreground mt-1">
                Manage system resources and storage
              </p>
            </div>
            <PhotoCleanupManager />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
