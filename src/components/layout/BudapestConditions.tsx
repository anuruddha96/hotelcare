import { useEffect, useState } from 'react';
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Clock3, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Weather = { temperature: number; symbol: string };
type WeatherCache = { value: Weather; expiresAt: number };
type ForecastResponse = {
  properties?: {
    timeseries?: Array<{
      data?: {
        instant?: { details?: { air_temperature?: number } };
        next_1_hours?: { summary?: { symbol_code?: string } };
        next_6_hours?: { summary?: { symbol_code?: string } };
      };
    }>;
  };
};

const BUDAPEST_TIME_ZONE = 'Europe/Budapest';
// Fixed hotel-city coordinates: no staff location or device geolocation.
const WEATHER_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=47.4979&lon=19.0402';
const CACHE_KEY = 'hc:budapest:forecast:v1';
// Outside the Nordics MET Norway refreshes forecasts every six hours.
// Its FAQ asks clients to wait at least half that interval before refetching.
const MIN_CACHE_MS = 3 * 60 * 60_000;

function condition(symbol: string): { label: string; Icon: LucideIcon } {
  const code = symbol.toLowerCase();
  if (code.startsWith('clearsky') || code.startsWith('fair')) return { label: 'Clear', Icon: Sun };
  if (code.startsWith('partlycloudy')) return { label: 'Partly cloudy', Icon: CloudSun };
  if (code.startsWith('cloudy')) return { label: 'Cloudy', Icon: Cloud };
  if (code.includes('fog')) return { label: 'Foggy', Icon: CloudFog };
  if (code.includes('thunder')) return { label: 'Thunderstorms', Icon: CloudLightning };
  if (code.includes('snow') || code.includes('sleet')) return { label: 'Snowy', Icon: CloudSnow };
  if (code.includes('drizzle')) return { label: 'Drizzle', Icon: CloudDrizzle };
  if (code.includes('rain')) return { label: 'Rainy', Icon: CloudRain };
  return { label: 'Cloudy', Icon: Cloud };
}

function readCache(): WeatherCache | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') as WeatherCache | null;
    return parsed && typeof parsed.expiresAt === 'number' &&
      typeof parsed.value?.temperature === 'number' &&
      typeof parsed.value?.symbol === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** Current Budapest clock and optional forecast; never blocks hotel operations. */
export function BudapestConditions() {
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<Weather | null>(() => readCache()?.value ?? null);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const load = async () => {
      const cached = readCache();
      if (cached && cached.expiresAt > Date.now()) {
        if (alive) setWeather(cached.value);
        return;
      }
      // Plain browser GET uses the Origin header to identify HotelCare to
      // api.met.no; custom User-Agent headers cause unsupported CORS preflights.
      try {
        const response = await fetch(WEATHER_URL, { signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json() as ForecastResponse;
        const first = result.properties?.timeseries?.[0]?.data;
        const temperature = first?.instant?.details?.air_temperature;
        const symbol = first?.next_1_hours?.summary?.symbol_code ||
          first?.next_6_hours?.summary?.symbol_code;
        if (typeof temperature !== 'number' || !symbol) return;
        const value = { temperature, symbol };
        if (alive) setWeather(value);
        // Respect the service's Expires header AND the 3-hour minimum interval
        // for global forecasts. Cache across page reloads in the same browser.
        const responseExpiry = Date.parse(response.headers.get('Expires') || '');
        const expiresAt = Math.max(Date.now() + MIN_CACHE_MS, Number.isFinite(responseExpiry) ? responseExpiry : 0);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ value, expiresAt })); } catch { /* storage unavailable */ }
      } catch {
        // Forecast is optional: if the provider is down, keep the last value.
      }
    };
    void load();
    // Check the cache occasionally; only fetch after the permitted expiry.
    const refresh = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 60 * 60_000);
    return () => { alive = false; controller.abort(); window.clearInterval(refresh); };
  }, []);

  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUDAPEST_TIME_ZONE, day: '2-digit', month: 'short',
  }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUDAPEST_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);
  const { label, Icon } = weather ? condition(weather.symbol) : { label: '', Icon: Clock3 };

  return (
    <div className="hidden shrink-0 items-center gap-2 rounded-xl border border-sky-100/90 bg-gradient-to-br from-sky-50 to-white px-2.5 py-1.5 shadow-sm md:flex dark:border-sky-900 dark:from-slate-900 dark:to-slate-950" title={weather ? `Budapest · ${label} · forecast from MET Norway` : 'Budapest local time'}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-300"><Icon className="h-4 w-4" /></span>
      <div className="flex flex-col whitespace-nowrap leading-tight">
        <span className="text-xs font-semibold tabular-nums text-slate-800 dark:text-slate-100">{date} · {time} <span className="font-normal text-muted-foreground">CET/CEST</span></span>
        <span className="text-[11px] font-medium text-sky-700 dark:text-sky-300">Budapest{weather ? ` · ${Math.round(weather.temperature)}°C · ${label}` : ''}</span>
        {weather && <a href="https://www.met.no/en" target="_blank" rel="noopener noreferrer" className="text-[9px] text-muted-foreground hover:underline" title="MET Norway forecast data · CC BY 4.0 · Conditions summarized and rounded" aria-label="Forecast data by MET Norway, CC BY 4.0">Forecast: MET Norway · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="underline" title="Forecast data license">CC BY 4.0</a></a>}
      </div>
    </div>
  );
}
