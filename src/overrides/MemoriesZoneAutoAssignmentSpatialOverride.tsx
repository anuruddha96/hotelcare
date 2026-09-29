import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { MemoriesZoneAutoAssignment as BaseMemoriesZoneAutoAssignment } from '../components/dashboard/MemoriesZoneAutoAssignment';
import { supabase } from '@/integrations/supabase/client';
import {
  setMemoriesSpatialConfig,
  type MemoriesRoomLink,
  type MemoriesSectionLink,
} from '@/lib/memoriesSpatialAssignment';

type Props = React.ComponentProps<typeof BaseMemoriesZoneAutoAssignment>;

export function MemoriesZoneAutoAssignment(props: Props) {
  const [ready, setReady] = useState(!props.open);

  useEffect(() => {
    let cancelled = false;
    if (!props.open) {
      setReady(true);
      return () => { cancelled = true; };
    }

    setReady(false);
    void (async () => {
      try {
        const { data: sections, error: sectionError } = await (supabase as any)
          .from('hotel_housekeeping_sections')
          .select('id,name')
          .eq('hotel_name', 'Hotel Memories Budapest')
          .eq('is_active', true);
        if (sectionError) throw sectionError;
        const sectionNameById = new Map((sections || []).map((row: any) => [row.id, row.name]));

        const [{ data: sectionRows, error: linkError }, { data: relationRows, error: relationError }, { data: roomRows, error: roomError }] = await Promise.all([
          (supabase as any)
            .from('hotel_housekeeping_section_links')
            .select('source_section_id,target_section_id,relation_type,priority,is_directional,low_load_threshold_minutes')
            .eq('hotel_name', 'Hotel Memories Budapest'),
          (supabase as any)
            .from('hotel_housekeeping_room_relationships')
            .select('room_id,related_room_id,relation_type,priority')
            .eq('hotel_name', 'Hotel Memories Budapest'),
          supabase
            .from('rooms')
            .select('id,room_number')
            .eq('hotel', 'Hotel Memories Budapest'),
        ]);
        if (linkError) throw linkError;
        if (relationError) throw relationError;
        if (roomError) throw roomError;

        const roomNumberById = new Map((roomRows || []).map((row: any) => [row.id, row.room_number]));
        const sectionLinks: MemoriesSectionLink[] = (sectionRows || []).flatMap((row: any) => {
          const source = sectionNameById.get(row.source_section_id);
          const target = sectionNameById.get(row.target_section_id);
          return source && target ? [{
            sourceSectionName: String(source),
            targetSectionName: String(target),
            relationType: row.relation_type,
            priority: row.priority,
            directional: row.is_directional,
            lowLoadThresholdMinutes: row.low_load_threshold_minutes,
          }] : [];
        });
        const roomLinks: MemoriesRoomLink[] = (relationRows || []).flatMap((row: any) => {
          const room = roomNumberById.get(row.room_id);
          const related = roomNumberById.get(row.related_room_id);
          return room && related ? [{
            roomNumber: String(room),
            relatedRoomNumber: String(related),
            relationType: row.relation_type,
            priority: row.priority,
          }] : [];
        });
        setMemoriesSpatialConfig({ sectionLinks, roomLinks });
      } catch (error) {
        // Defaults contain the three manager-confirmed section relationships, so
        // Auto Assign still behaves safely if the optional metadata read fails.
        console.error('[MemoriesSpatialMap] could not preload spatial metadata', error);
        setMemoriesSpatialConfig(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => { cancelled = true; };
  }, [props.open, props.selectedDate]);

  if (props.open && !ready) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
        <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm shadow-lg">
          <Loader2 className="h-4 w-4 animate-spin" /> Preparing physical room map…
        </div>
      </div>
    );
  }

  return <BaseMemoriesZoneAutoAssignment {...props} />;
}
