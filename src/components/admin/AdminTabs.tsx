import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrganizationManagement } from './OrganizationManagement';
import { HotelManagementView } from './HotelManagementView';
import { TranslationManagement } from './TranslationManagement';
import { Building2, Hotel, Languages } from 'lucide-react';

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
          <TabsTrigger value="translations" className="gap-2">
            <Languages className="w-4 h-4" />
            Translations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="organizations">
          <OrganizationManagement />
        </TabsContent>

        <TabsContent value="hotels">
          <HotelManagementView />
        </TabsContent>

        <TabsContent value="translations">
          <TranslationManagement />
        </TabsContent>
      </Tabs>
    </div>
  );
};
