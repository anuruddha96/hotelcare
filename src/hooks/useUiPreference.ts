// Per-user interface preferences that follow the person between devices.
//
// The value lives in `profiles.ui_preferences` (a small JSON object), so the
// Rate & pickup calendar opens at the size the user last chose whether they
// sign in from the office desktop or a phone. Reads happen once per session;
// writes are debounced so dragging a zoom control does not hammer the database.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Prefs = Record<string, unknown>;

let cache: Prefs | null = null;
let inflight: Promise<Prefs> | null = null;

async function loadPrefs(): Promise<Prefs> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return {};
      const { data } = await supabase
        .from("profiles")
        .select("ui_preferences")
        .eq("id", uid)
        .maybeSingle();
      cache = ((data as { ui_preferences?: Prefs } | null)?.ui_preferences ?? {}) as Prefs;
      return cache;
    } catch {
      return {};
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * One key of the user's saved interface preferences.
 *
 * Returns the fallback until the profile has been read, so the UI can render
 * immediately and settle into the saved value a moment later.
 */
export function useUiPreference<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    void loadPrefs().then((prefs) => {
      if (!alive) return;
      const saved = prefs[key];
      if (saved !== undefined && saved !== null) setValue(saved as T);
      setReady(true);
    });
    return () => { alive = false; };
  }, [key]);

  const save = useCallback((next: T) => {
    setValue(next);
    cache = { ...(cache ?? {}), [key]: next };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void (async () => {
        try {
          const { data: auth } = await supabase.auth.getUser();
          const uid = auth.user?.id;
          if (!uid) return;
          await supabase
            .from("profiles")
            .update({ ui_preferences: (cache ?? {}) as never })
            .eq("id", uid);
        } catch { /* the local value still applies for this session */ }
      })();
    }, 600);
  }, [key]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { value, setValue: save, ready };
}
