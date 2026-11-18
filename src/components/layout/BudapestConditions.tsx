import { useEffect, useState } from 'react';
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Clock3, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Weather = { temperature: number; code: number; day: boolean };
const BUDAPEST_TIME_ZONE = 'Europe/Budapest';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=47.4979&longitude=19.0402&current=temperature_2m,weather_code,is_day&timezone=Europe%2FBudapest';

function condition(code: number, day: boolean): { label: string; Icon: LucideIcon } {
  if (code === 0) return { label: 'Clear', Icon: Sun };
  if (code <= 3) return { label: 'Partly cloudy', Icon: day ? CloudSun : Cloud };
  if (code <= 48) return { label: 'Foggy', Icon: CloudFog };
  if (code <= 57) return { label: 'Drizzle', Icon: CloudDrizzle };
  if (code <= 67 || (code >= 80 && code <= 82)) return { label: 'Rainy', Icon: CloudRain };
  if (code <= 77 || (code >= 85 && code <= 86)) return { label: 'Snowy', Icon: CloudSnow };
  if (code >= 95) return { label: 'Thunderstorms', Icon: CloudLightning };
  return { label: 'Cloudy', Icon: Cloud };
}

/** Small non-blocking live Budapest weather and local-clock readout beside the brand. */
export function BudapestConditions() {
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(WEATHER_URL, { signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json() as { current?: { temperature_2m?: number; weather_code?: number; is_day?: number } };
        const current = result.current;
        if (alive && typeof current?.temperature_2m === 'number' && typeof current.weather_code === 'number') {
          setWeather({ temperature: current.temperature_2m, code: current.weather_code, day: current.is_day === 1 });
        }
      } catch {
        // Weather is optional; no errors or delays in the operational header.
      }
    };
    void load();
    const refresh = window.setInterval(() => void load(), 30 * 60_000);
    return () => { alive = false; controller.abort(); window.clearInterval(refresh); };
  }, []);

  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUDAPEST_TIME_ZONE, day: '2-digit', month: 'short',
  }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUDAPEST_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);
  const { label, Icon } = weather ? condition(weather.code, weather.day) : { label: '', Icon: Clock3 };

  return (
    <div className="hidden shrink-0 items-center gap-2 rounded-xl border border-sky-100/90 bg-gradient-to-br from-sky-50 to-white px-2.5 py-1.5 shadow-sm md:flex dark:border-sky-900 dark:from-slate-900 dark:to-slate-950" title={weather ? `Budapest · ${label} · updated approximately every 30 minutes` : 'Budapest local time'}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-300"><Icon className="h-4 w-4" /></span>
      <div className="flex flex-col whitespace-nowrap leading-tight">
        <span className="text-xs font-semibold tabular-nums text-slate-800 dark:text-slate-100">{date} · {time} <span className="font-normal text-muted-foreground">CET/CEST</span></span>
        <span className="text-[11px] font-medium text-sky-700 dark:text-sky-300">Budapest{weather ? ` · ${Math.round(weather.temperature)}°C · ${label}` : ''}</span>
      </div>
    </div>
  );
}
