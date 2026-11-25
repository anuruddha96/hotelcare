import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Cloud, CloudRain, CloudSnow, CloudLightning, Sun, Moon } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useTenant } from "@/contexts/TenantContext";
import { workspaceLocation, workspaceWeatherKind, type WorkspaceLocation } from "@/lib/workspaceAppearance";

type Forecast = { temperature: number; symbol: string; expires: number };
const HOUR = 60 * 60 * 1000;

async function loadForecast(location: WorkspaceLocation, signal: AbortSignal): Promise<Forecast> {
  const coords = `lat=${location.latitude.toFixed(4)}&lon=${location.longitude.toFixed(4)}`;
  const key = `hc-weather-v1:${coords}`;
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null") as Forecast | null;
    if (stored && stored.expires > Date.now() && Number.isFinite(stored.temperature) && typeof stored.symbol === "string") return stored;
  } catch { /* Weather is optional, including when storage is unavailable. */ }
  const response = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?${coords}`, { signal });
  if (!response.ok) throw new Error("Weather unavailable");
  const data = await response.json();
  const point = data?.properties?.timeseries?.[0]?.data;
  const temperature = point?.instant?.details?.air_temperature;
  const symbol = point?.next_1_hours?.summary?.symbol_code ?? point?.next_6_hours?.summary?.symbol_code ?? "";
  if (typeof temperature !== "number" || !Number.isFinite(temperature) || typeof symbol !== "string") throw new Error("Weather unavailable");
  const providerExpiry = Date.parse(response.headers.get("Expires") || "");
  const forecast = { temperature, symbol, expires: Math.max(Date.now() + HOUR, Number.isFinite(providerExpiry) ? providerExpiry : 0) };
  try { localStorage.setItem(key, JSON.stringify(forecast)); } catch { /* Optional cache. */ }
  return forecast;
}

export function WorkspaceConditions({ organizationSlug, hotelId }: { organizationSlug: string | null | undefined; hotelId: string | null | undefined }) {
  const { language } = useTranslation();
  const { hotels, organization } = useTenant();
  const hotel = hotels.find((item) => item.hotel_id === hotelId || item.hotel_name === hotelId);
  const location = workspaceLocation(organizationSlug, hotel?.settings ?? organization?.settings);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 15_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const { data } = useQuery({
    queryKey: ["workspace-weather", location?.latitude, location?.longitude],
    queryFn: ({ signal }) => {
      if (!location) throw new Error("Weather location unavailable");
      return loadForecast(location, signal);
    },
    enabled: !!location,
    staleTime: HOUR,
    refetchInterval: HOUR,
    retry: false,
  });
  const labels = language === "hu"
    ? { date: "Dátum", time: "Idő", weather: "Időjárás-előrejelzés", unavailable: "Nem elérhető" }
    : language === "es"
      ? { date: "Fecha", time: "Hora", weather: "Pronóstico del tiempo", unavailable: "No disponible" }
      : { date: "Date", time: "Time", weather: "Weather forecast", unavailable: "Unavailable" };
  const timeZone = location?.timeZone;
  const date = new Intl.DateTimeFormat(language, { weekday: "long", month: "short", day: "numeric", timeZone }).format(now);
  const time = new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(now);
  const kind = workspaceWeatherKind(data?.symbol ?? "");
  const WeatherIcon = kind === "sun" ? (data?.symbol.endsWith("_night") ? Moon : Sun) : kind === "rain" ? CloudRain : kind === "snow" ? CloudSnow : kind === "storm" ? CloudLightning : Cloud;
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-3 rounded-xl border border-border bg-card px-3 py-1.5 text-card-foreground sm:gap-4" aria-label={`${labels.date}, ${labels.time}, ${labels.weather}`}>
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-col leading-tight">
          <time className="text-[11px] font-medium text-muted-foreground whitespace-nowrap" dateTime={now.toISOString()}>{date}</time>
          <time className="text-lg font-semibold tracking-tight tabular-nums" dateTime={now.toISOString()} title={timeZone || labels.time}>{time}</time>
        </div>
      </div>
      {location && <div className="flex items-center gap-2 border-l pl-3 sm:pl-4" title={`${labels.weather} · ${location.label}`}>
        <WeatherIcon className={`h-6 w-6 shrink-0 ${kind === "sun" ? "text-amber-600 dark:text-amber-300" : "text-primary"}`} aria-hidden="true" />
        <div className="flex flex-col leading-tight">
          <span className="text-base font-semibold tabular-nums whitespace-nowrap">{data ? `${Math.round(data.temperature)}°C` : "—"}</span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap">
            {location.label}
            <a href="https://www.met.no/en" target="_blank" rel="noreferrer" className="underline underline-offset-2" title={`MET Norway · CC BY 4.0 · ${data ? labels.weather : labels.unavailable}`}>MET</a>
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className="sr-only">CC BY 4.0</a>
          </span>
        </div>
      </div>}
    </div>
  );
}
