import { useId, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { localizedMaintenanceTitle, suggestMaintenanceTitles } from '@/lib/maintenanceTitleSuggestions';

type Props = { value: string; onChange: (value: string) => void; language: string; required?: boolean };
/** A purely local suggestion UI: the user may always keep their original free-text title. */
export function MaintenanceTitleAutocomplete({ value, onChange, language, required }: Props) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const suggestions = useMemo(() => suggestMaintenanceTitles(value, language), [value, language]);
  const visible = focused && !dismissed && suggestions.length > 0;
  const select = (index: number) => {
    const item = suggestions[index];
    if (!item) return;
    onChange(localizedMaintenanceTitle(item, language));
    setDismissed(true);
    setActive(-1);
  };
  return <div className="relative">
    <Input
      required={required} value={value} autoComplete="off" className="h-11"
      placeholder={language === 'hu' ? 'pl. Függönykarnis meglazult' : 'e.g. Curtain rail loose'}
      role="combobox" aria-autocomplete="list" aria-expanded={visible}
      aria-controls={visible ? listId : undefined}
      aria-activedescendant={visible && active >= 0 ? `${listId}-option-${active}` : undefined}
      aria-label={language === 'hu' ? 'Hiba címe' : 'Issue title'}
      onFocus={() => { setFocused(true); setDismissed(false); }}
      onBlur={event => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node)) { setFocused(false); setActive(-1); } }}
      onChange={event => { onChange(event.target.value); setDismissed(false); setActive(-1); }}
      onKeyDown={event => {
        if (event.key === 'Escape' && visible) { event.preventDefault(); setDismissed(true); setActive(-1); }
        if (event.key === 'ArrowDown' && visible) { event.preventDefault(); setActive(previous => (previous + 1) % suggestions.length); }
        if (event.key === 'ArrowUp' && visible) { event.preventDefault(); setActive(previous => previous <= 0 ? suggestions.length - 1 : previous - 1); }
        if (event.key === 'Enter' && visible && active >= 0) { event.preventDefault(); select(active); }
      }}
    />
    {visible && <div id={listId} role="listbox" aria-label={language === 'hu' ? 'Javasolt hibacímek' : 'Suggested issue titles'} className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
      {suggestions.map((item, index) => <button key={item.id} id={`${listId}-option-${index}`} type="button" role="option" aria-selected={active === index}
        className={`block w-full px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent ${active === index ? 'bg-accent' : ''}`}
        onMouseDown={event => event.preventDefault()} onClick={() => select(index)} onMouseEnter={() => setActive(index)}>
        {localizedMaintenanceTitle(item, language)}
      </button>)}
      <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">{language === 'hu' ? 'A saját megfogalmazását is megtarthatja.' : 'You can also keep your own wording.'}</p>
    </div>}
  </div>;
}
