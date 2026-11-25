import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Check, Search, X } from 'lucide-react';
import { searchMaintenanceRooms, type MaintenanceRoomOption } from '@/lib/maintenanceRoomOptions';

type Props = {
  options: readonly MaintenanceRoomOption[];
  value: string | null;
  onChange: (roomId: string | null) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  optional?: boolean;
  language?: string;
};

/** Selection persists an actual room UUID, never a search string. The popover is
 * contained within the form instead of expanding the entire dialog viewport. */
export function MaintenanceRoomPicker({ options, value, onChange, disabled, loading, error, onRetry, optional, language }: Props) {
  const isHungarian = language === 'hu';
  const listId = useId();
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find(room => room.id === value);
  const results = useMemo(() => searchMaintenanceRooms(options, query), [options, query]);
  const busy = !!loading || !!error || !!disabled;

  useEffect(() => {
    if (!value) return;
    if (selected) setQuery(selected.label);
  }, [value, selected?.label]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const choose = (room: MaintenanceRoomOption) => {
    onChange(room.id);
    setQuery(room.label);
    setOpen(false);
    setActive(0);
  };
  const clear = () => {
    onChange(null);
    setQuery('');
    setActive(0);
    setOpen(true);
  };

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      <div className="relative flex items-center">
        <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
        <Input
          id={inputId}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && !busy}
          aria-controls={listId}
          aria-activedescendant={open && results[active] ? `${listId}-${results[active].id}` : undefined}
          value={query}
          disabled={busy}
          placeholder={loading ? (isHungarian ? 'Szobák betöltése…' : 'Loading rooms…') : (isHungarian ? 'Szobakód keresése…' : 'Search room code or building…')}
          className="h-11 pl-10 pr-11 text-base"
          onFocus={() => setOpen(true)}
          onChange={event => {
            setQuery(event.target.value);
            if (value) onChange(null);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
            if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(index => Math.min(index + 1, results.length - 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(index => Math.max(index - 1, 0)); }
            if (event.key === 'Enter' && open && results[active]) { event.preventDefault(); choose(results[active]); }
          }}
        />
        {(value || query) && !busy && <Button type="button" variant="ghost" size="icon" onClick={clear} aria-label={isHungarian ? 'Szoba törlése' : 'Clear room'} className="absolute right-1 h-9 w-9"><X className="h-4 w-4" /></Button>}
      </div>
      {loading && <p role="status" className="mt-1 text-xs text-muted-foreground">{isHungarian ? 'Szobák betöltése…' : 'Loading rooms…'}</p>}
      {error && <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-destructive">
        {isHungarian ? 'A szobák betöltése sikertelen.' : 'Room lookup failed.'}
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>{isHungarian ? 'Újra' : 'Retry'}</Button>
      </div>}
      {!loading && !error && !options.length && <p role="status" className="mt-1 text-xs text-muted-foreground">{isHungarian ? 'Nincs választható szoba.' : 'No eligible rooms found.'}</p>}
      {!loading && !error && open && !disabled && options.length > 0 && <div
        id={listId}
        role="listbox"
        aria-label={isHungarian ? 'Választható szobák' : 'Available rooms'}
        className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-lg max-h-52 overflow-y-auto overscroll-contain"
      >
        {optional && <button type="button" role="option" aria-selected={!value} className="block w-full px-3 py-2 text-left text-sm hover:bg-accent" onClick={clear}>{isHungarian ? 'Közös terület (nincs szoba)' : 'Common area (no room)'}</button>}
        {results.map((room, index) => <button
          key={room.id} id={`${listId}-${room.id}`} type="button" role="option"
          aria-selected={room.id === value}
          className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent ${index === active ? 'bg-accent' : ''}`}
          onMouseEnter={() => setActive(index)}
          onClick={() => choose(room)}
        >
          <span className="min-w-0"><span className="font-medium break-all">{room.label}</span>{room.building && <span className="block text-xs text-muted-foreground">{room.building}</span>}</span>
          {value === room.id && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
        </button>)}
        {!results.length && <p role="status" className="p-3 text-sm text-muted-foreground">{isHungarian ? 'Nincs találat.' : 'No matching rooms.'}</p>}
      </div>}
      {selected && !open && <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">{isHungarian ? 'Kiválasztva:' : 'Selected:'} {selected.label}{selected.building ? ` · ${selected.building}` : ''}</p>}
    </div>
  );
}
