import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Search, Plus, Check, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

interface GuestSearchSelectProps {
  value: string;
  onChange: (guestId: string) => void;
}

export function GuestSearchSelect({ value, onChange }: GuestSearchSelectProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [guests, setGuests] = useState<any[]>([]);
  const [selectedGuest, setSelectedGuest] = useState<any>(null);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    if (search.length >= 2) {
      searchGuests();
    } else {
      setGuests([]);
    }
  }, [search]);

  useEffect(() => {
    if (value && !selectedGuest) {
      supabase.from('guests').select('*').eq('id', value).single().then(({ data }) => {
        if (data) setSelectedGuest(data);
      });
    }
  }, [value]);

  const searchGuests = async () => {
    const { data } = await supabase
      .from('guests')
      .select('*')
      .or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`)
      .limit(10);
    setGuests(data || []);
    setShowResults(true);
  };

  const selectGuest = (guest: any) => {
    setSelectedGuest(guest);
    onChange(guest.id);
    setShowResults(false);
    setSearch('');
  };

  return (
    <div className="space-y-2">
      <Label>{t('pms.guests.guestLabel')}</Label>
      {selectedGuest ? (
        <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-accent/20">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {selectedGuest.first_name} {selectedGuest.last_name}
            </span>
            {selectedGuest.email && (
              <span className="text-xs text-muted-foreground">{selectedGuest.email}</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSelectedGuest(null); onChange(''); }}
            className="text-xs"
          >
            {t('pms.guests.change')}
          </Button>
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
          />
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
