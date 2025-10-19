import { useState } from 'react';
import { SeparatedRoomAssignment } from './SeparatedRoomAssignment';
import { EasyRoomAssignment } from './EasyRoomAssignment';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Split, Zap } from 'lucide-react';

interface RoomAssignmentDialogProps {
  onAssignmentCreated: () => void;
  selectedDate: string;
}

export function RoomAssignmentDialog({ onAssignmentCreated, selectedDate }: RoomAssignmentDialogProps) {
  return (
    <Tabs defaultValue="separated" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="separated" className="flex items-center gap-2">
          <Split className="h-4 w-4" />
          Checkout / Daily Rooms
        </TabsTrigger>
        <TabsTrigger value="quick" className="flex items-center gap-2">
          <Zap className="h-4 w-4" />
          Quick Assign
        </TabsTrigger>
      </TabsList>
      <TabsContent value="separated" className="mt-4">
        <SeparatedRoomAssignment onAssignmentCreated={onAssignmentCreated} />
      </TabsContent>
      <TabsContent value="quick" className="mt-4">
        <EasyRoomAssignment onAssignmentCreated={onAssignmentCreated} />
      </TabsContent>
    </Tabs>
  );
}
