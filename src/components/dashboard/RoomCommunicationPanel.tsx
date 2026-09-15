import { useCallback, useEffect, useState } from 'react';
import { BedDouble, Loader2, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface RoomCommunicationPanelProps {
  assignmentId: string;
  roomId: string;
  roomNumber: string;
  dateLabel?: string;
  readOnly?: boolean;
  hideWhenEmpty?: boolean;
}

const BED_SETUP_OPTIONS = [
  { value: 'Single Bed', label: 'Single bed', icon: '🛏️' },
  { value: 'Twin Beds Together', label: 'Beds together', icon: '🛌' },
  { value: 'Twin Beds Separated', label: 'Beds separated', icon: '↔️' },
  { value: 'Sofa Bed', label: 'Sofa bed', icon: '🛋️' },
  { value: 'Extra Bed', label: 'Extra bed', icon: '➕' },
] as const;

function isEquivalentBedSetup(current: string | null, option: string): boolean {
  if (!current) return false;
  const normalized = current.trim().toLowerCase();

  if (option === 'Twin Beds Together') {
    return ['twin beds together', 'twin beds', 'beds together'].includes(normalized);
  }

  if (option === 'Twin Beds Separated') {
    return ['twin beds separated', 'beds separated', 'separate beds'].includes(normalized);
  }

  return normalized === option.toLowerCase();
}

/**
 * Quick housekeeping setup controls shown directly in the room-chip card.
 *
 * The previous legacy room-message thread was removed because it duplicated
 * manager / housekeeper notes. This slot now carries one-click operational
 * instructions that already have a dedicated persisted field on rooms.
 */
export function RoomCommunicationPanel({
  roomId,
  roomNumber,
  readOnly = false,
}: RoomCommunicationPanelProps) {
  const [bedConfiguration, setBedConfiguration] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingValue, setSavingValue] = useState<string | null>(null);

  const loadBedConfiguration = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('bed_configuration')
        .eq('id', roomId)
        .maybeSingle();

      if (error) throw error;
      setBedConfiguration(data?.bed_configuration || null);
    } catch (error) {
      console.error('Failed to load bed setup instruction:', error);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void loadBedConfiguration();
  }, [loadBedConfiguration]);

  const saveBedConfiguration = async (nextValue: string | null) => {
    if (readOnly || savingValue !== null) return;

    const savingKey = nextValue ?? '__clear__';
    setSavingValue(savingKey);
    try {
      const { data, error } = await supabase
        .from('rooms')
        .update({ bed_configuration: nextValue })
        .eq('id', roomId)
        .select('id, bed_configuration')
        .maybeSingle();

      if (error) throw error;
      if (!data?.id) {
        throw new Error('Bed setup instruction was not applied. Please refresh and verify your hotel access.');
      }

      setBedConfiguration(data.bed_configuration || null);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));

      if (nextValue) {
        const option = BED_SETUP_OPTIONS.find((item) => item.value === nextValue);
        toast.success(`Room ${roomNumber}: ${option?.label || nextValue} instruction sent to housekeeping`);
      } else {
        toast.success(`Room ${roomNumber}: bed setup instruction cleared`);
      }
    } catch (error: any) {
      console.error('Failed to save bed setup instruction:', error);
      toast.error(error?.message || 'Failed to save bed setup instruction');
    } finally {
      setSavingValue(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <BedDouble className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          <span className="text-[11px] font-semibold text-foreground">Housekeeper bed setup</span>
        </div>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Tap once to send a clear bed instruction to the assigned housekeeper.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {BED_SETUP_OPTIONS.map((option) => {
          const active = isEquivalentBedSetup(bedConfiguration, option.value);
          const saving = savingValue === option.value;

          return (
            <button
              key={option.value}
              type="button"
              disabled={readOnly || savingValue !== null || loading}
              onClick={(event) => {
                event.stopPropagation();
                void saveBedConfiguration(option.value);
              }}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? 'border-blue-500 bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-100'
                  : 'border-border bg-background text-foreground hover:bg-muted'
              }`}
              aria-pressed={active}
            >
              <span aria-hidden="true">{option.icon}</span>
              <span>{option.label}</span>
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            </button>
          );
        })}

        {bedConfiguration && (
          <button
            type="button"
            disabled={readOnly || savingValue !== null || loading}
            onClick={(event) => {
              event.stopPropagation();
              void saveBedConfiguration(null);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingValue === '__clear__' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            Clear
          </button>
        )}
      </div>

      {bedConfiguration && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
          Current instruction: <span className="font-semibold">{bedConfiguration}</span>
        </div>
      )}

      {readOnly && (
        <p className="text-[10px] italic text-muted-foreground">Past dates are read-only.</p>
      )}
    </div>
  );
}