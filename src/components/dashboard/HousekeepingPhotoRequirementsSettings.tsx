import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Save, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { requiredDailyPhotoCategories } from '@/lib/gozsduNoMinibar';
import {
  HOUSEKEEPING_PHOTO_CATALOG,
  getHousekeepingPhotoLabel,
  type HousekeepingPhotoCategory,
} from '@/lib/housekeepingPhotoRequirements';

const TOP_MANAGER_ROLES = new Set(['admin', 'top_management', 'top_management_manager']);

interface Props {
  hotelConfigurationId: string;
  organizationSlug: string;
  hotelId: string;
  hotelName: string;
}

export function HousekeepingPhotoRequirementsSettings({
  hotelConfigurationId,
  organizationSlug,
  hotelId,
  hotelName,
}: Props) {
  const { profile } = useAuth();
  const { language } = useTranslation();
  const canManage = !!profile && (profile.is_super_admin === true || TOP_MANAGER_ROLES.has(profile.role));
  const fallback = useMemo(
    () => requiredDailyPhotoCategories(hotelId, hotelName, organizationSlug) as HousekeepingPhotoCategory[],
    [hotelId, hotelName, organizationSlug],
  );
  const [selected, setSelected] = useState<HousekeepingPhotoCategory[]>(fallback);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canManage || !hotelConfigurationId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data, error } = await (supabase as any).rpc(
        'get_hotel_housekeeping_photo_requirements',
        { p_hotel_configuration_id: hotelConfigurationId },
      );
      if (cancelled) return;
      if (error) {
        console.warn('[HousekeepingPhotoRequirementsSettings] load failed', error);
        setSelected(fallback);
      } else if (data?.length) {
        setSelected(data.map((row: any) => row.category as HousekeepingPhotoCategory));
      } else {
        setSelected(fallback);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [canManage, hotelConfigurationId, fallback]);

  if (!canManage) return null;

  const toggle = (category: HousekeepingPhotoCategory, enabled: boolean) => {
    setSelected(previous => {
      if (enabled) return previous.includes(category) ? previous : [...previous, category];
      if (previous.length <= 1) {
        toast.error('At least one room photo must remain required.');
        return previous;
      }
      return previous.filter(item => item !== category);
    });
  };

  const move = (category: HousekeepingPhotoCategory, direction: -1 | 1) => {
    setSelected(previous => {
      const index = previous.indexOf(category);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const save = async () => {
    if (saving || !selected.length) return;
    setSaving(true);
    const { error } = await (supabase as any).rpc('set_housekeeping_photo_requirements', {
      p_hotel_configuration_id: hotelConfigurationId,
      p_categories: selected,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message || 'Could not save room photo requirements.');
      return;
    }
    toast.success('Room photo requirements saved.');
  };

  const selectedSet = new Set(selected);

  return (
    <div className="rounded-xl border bg-muted/10 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" /> Required room photos
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Top-management setting. Choose the photo sections housekeepers must record before completing a daily room.
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => void save()} disabled={saving || loading || !selected.length}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading photo requirements…
        </div>
      ) : (
        <div className="space-y-2">
          {HOUSEKEEPING_PHOTO_CATALOG.map(item => {
            const enabled = selectedSet.has(item.key);
            const orderIndex = selected.indexOf(item.key);
            return (
              <div key={item.key} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2">
                <span className="text-xl w-7 text-center" aria-hidden="true">{item.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{getHousekeepingPhotoLabel(item.key, language)}</div>
                  <div className="text-[10px] text-muted-foreground">{enabled ? 'Required · step ' + (orderIndex + 1) : 'Not required'}</div>
                </div>
                {enabled && (
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={'Move ' + getHousekeepingPhotoLabel(item.key, language) + ' up'} disabled={orderIndex <= 0} onClick={() => move(item.key, -1)}>
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={'Move ' + getHousekeepingPhotoLabel(item.key, language) + ' down'} disabled={orderIndex < 0 || orderIndex === selected.length - 1} onClick={() => move(item.key, 1)}>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                <Switch checked={enabled} onCheckedChange={value => toggle(item.key, value)} aria-label={'Require ' + getHousekeepingPhotoLabel(item.key, language) + ' photo'} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
