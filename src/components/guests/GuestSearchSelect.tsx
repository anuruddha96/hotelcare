import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Search, Check, User, UserPlus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';

interface GuestSearchSelectProps {
  value: string;
  onChange: (guestId: string) => void;
  /** Hotel keys (slug + display name) to scope the guest search. */
  hotelKeys?: string[];
  /** Needed for quick-create so the new guest lands in the right property. */
  hotelId?: string | null;
  orgSlug?: string | null;
  allowCreate?: boolean;
}

export function GuestSearchSelect({ value, onChange, hotelKeys, hotelId, orgSlug, allowCreate = true }: GuestSearchSelectProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [guests, setGuests] = useState<any[]>([]);
  const [selectedGuest, setSelectedGuest] = useState<any>(null);
  const [showResults, setShowResults] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newGuest, setNewGuest] = useState({ first_name: '', last_name: '', email: '', phone: '' });

  useEffect(() => {
    if (search.length >= 2) {
      searchGuests();
    } else {
      setGuests([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (value && !selectedGuest) {
      supabase.from('guests').select('*').eq('id', value).maybeSingle().then(({ data }) => {
        if (data) setSelectedGuest(data);
      });
    }
    if (!value) setSelectedGuest(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const searchGuests = async () => {
    const term = search.replace(/[%,()]/g, ' ').trim();
    if (!term) return;
    let query = supabase
      .from('guests')
      .select('*')
      .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`)
      .limit(10);
    if (hotelKeys && hotelKeys.length > 0) {
      query = query.in('hotel_id', hotelKeys);
    }
    const { data } = await query;
    setGuests(data || []);
    setShowResults(true);
  };

  const selectGuest = (guest: any) => {
    setSelectedGuest(guest);
    onChange(guest.id);
    setShowResults(false);
    setSearch('');
  };

  const createGuest = async () => {
    if (!newGuest.first_name.trim() || !newGuest.last_name.trim()) {
      toast.error(t('pms.guestQuick.nameRequired'));
      return;
    }
    setCreating(true);
    const { data, error } = await supabase
      .from('guests')
      .insert({
        first_name: newGuest.first_name.trim(),
        last_name: newGuest.last_name.trim(),
        email: newGuest.email.trim() || null,
        phone: newGuest.phone.trim() || null,
        hotel_id: hotelId ?? null,
        organization_slug: orgSlug ?? null,
      })
      .select()
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error(error?.message ?? t('pms.guestQuick.createFailed'));
      return;
    }
    setCreateOpen(false);
    setNewGuest({ first_name: '', last_name: '', email: '', phone: '' });
    selectGuest(data);
  };

  return (
    <div className="space-y-2">
      <Label>{t('pms.guests.guestLabel')}</Label>
      {selectedGuest ? (
        <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-accent/20">
          <div className="flex items-center gap-2 min-w-0">
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">
              {selectedGuest.first_name} {selectedGuest.last_name}
            </span>
            {selectedGuest.email && (
              <span className="text-xs text-muted-foreground truncate">{selectedGuest.email}</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSelectedGuest(null); onChange(''); }}
            className="text-xs shrink-0"
          >
            {t('pms.guests.change')}
          </Button>
        </div>
      ) : createOpen ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder={t('pms.guestQuick.firstName')} value={newGuest.first_name} onChange={(e) => setNewGuest({ ...newGuest, first_name: e.target.value })} />
            <Input placeholder={t('pms.guestQuick.lastName')} value={newGuest.last_name} onChange={(e) => setNewGuest({ ...newGuest, last_name: e.target.value })} />
            <Input placeholder={t('pms.guests.email')} type="email" value={newGuest.email} onChange={(e) => setNewGuest({ ...newGuest, email: e.target.value })} />
            <Input placeholder={t('pms.guests.phone')} value={newGuest.phone} onChange={(e) => setNewGuest({ ...newGuest, phone: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button size="sm" onClick={createGuest} disabled={creating} className="gap-1">
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
              {t('pms.guestQuick.createUse')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('pms.guests.searchGuestPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => search.length >= 2 && setShowResults(true)}
            className="pl-8"
            data-training="res-guest-search"
          />
          {allowCreate && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="mt-1 text-xs text-primary underline-offset-2 hover:underline flex items-center gap-1"
            >
              <UserPlus className="h-3 w-3" /> {t('pms.guestQuick.newGuest')}
            </button>
          )}
          {showResults && guests.length > 0 && (
            <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
              {guests.map((g) => (
                <button
                  key={g.id}
                  onClick={() => selectGuest(g)}
                  className={cn(
                    'w-full text-left px-3 py-2 hover:bg-accent/50 transition-colors flex items-center justify-between',
                    value === g.id && 'bg-accent'
                  )}
                >
                  <div>
                    <span className="text-sm font-medium">{g.first_name} {g.last_name}</span>
                    {g.email && <span className="text-xs text-muted-foreground ml-2">{g.email}</span>}
                  </div>
                  {value === g.id && <Check className="h-4 w-4 text-primary" />}
                </button>
              ))}
            </div>
          )}
          {showResults && search.length >= 2 && guests.length === 0 && (
            <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-md shadow-lg p-3 text-center text-sm text-muted-foreground">
              {t('pms.guests.noGuestsFoundCreate')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
