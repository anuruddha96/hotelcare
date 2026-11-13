import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/contexts/TenantContext";
import { useOperationalHotel } from "@/hooks/useOperationalHotel";
import {
  makeDeviceToken, readLocalNetworkMonitor, saveLocalNetworkMonitor,
  sendNetworkHeartbeat,
} from "@/lib/networkMonitorClient";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Monitor, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";

type Monitor = {
  id: string;
  device_label: string;
  enabled: boolean;
  last_heartbeat_at: string | null;
  created_at: string;
};
type Incident = {
  id: string;
  monitor_id: string;
  started_at: string;
  detected_at: string;
  recovered_at: string | null;
  closed_reason: string | null;
};

const ADMIN_ROLES = new Set(["admin", "top_management", "top_management_manager"]);
const ONLINE_THRESHOLD_MS = 120_000;
const fmt = (value: string | null) => value
  ? new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest", dateStyle: "medium", timeStyle: "medium",
  }).format(new Date(value))
  : "Not yet recorded";

export default function InternetMonitoringPanel() {
  const { profile } = useAuth();
  const { hotels } = useTenant();
  const operational = useOperationalHotel();
  const [selectedHotelId, setSelectedHotelId] = useState("");
  const [name, setName] = useState("Reception PC");
  const [devices, setDevices] = useState<Monitor[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState(readLocalNetworkMonitor);

  const executive = !!profile?.is_super_admin || ADMIN_ROLES.has(profile?.role || "");
  const hotelOptions = useMemo(() => hotels
    .filter((hotel) => executive ||
      hotel.hotel_id === operational.hotelId ||
      hotel.hotel_name === profile?.assigned_hotel)
    .map((hotel) => ({ value: hotel.hotel_id, label: hotel.hotel_name })), [
    hotels, executive, operational.hotelId, profile?.assigned_hotel,
  ]);

  useEffect(() => {
    if (hotelOptions.length && !hotelOptions.some((item) => item.value === selectedHotelId)) {
      setSelectedHotelId(
        hotelOptions.find((item) => item.value === operational.hotelId)?.value ||
        hotelOptions[0].value,
      );
    }
  }, [hotelOptions, operational.hotelId, selectedHotelId]);

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const { data, error: functionError } = await supabase.functions.invoke("network-monitor", {
      body: { action, hotel_id: selectedHotelId, ...extra },
    });
    if (functionError || data?.error) {
      throw new Error(data?.error || functionError?.message || "Network monitoring request failed");
    }
    return data;
  }, [selectedHotelId]);

  const refresh = useCallback(async () => {
    if (!selectedHotelId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await call("list");
      setDevices(result.monitors || []);
      setIncidents(result.incidents || []);
      setLocal(readLocalNetworkMonitor());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load monitoring devices");
    } finally {
      setLoading(false);
    }
  }, [call, selectedHotelId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const enable = async () => {
    if (!selectedHotelId || !profile?.organization_slug) return;
    if (local && devices.some((device) => device.id === local.id && device.enabled)) {
      toast.error("This browser already monitors a computer. Disable it before enrolling again.");
      return;
    }
    setBusy(true);
    try {
      const token = makeDeviceToken();
      const result = await call("register", { device_label: name.trim(), token });
      saveLocalNetworkMonitor({
        id: result.id, token, label: name.trim(),
        organizationSlug: profile.organization_slug, hotelId: selectedHotelId,
      });
      const connected = await sendNetworkHeartbeat();
      if (!connected) toast.warning("Registered, but the first connectivity check has not succeeded yet.");
      else toast.success("Internet monitoring activated on this computer.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to register this computer");
    } finally {
      setBusy(false);
    }
  };

  const disable = async (device: Monitor) => {
    if (!window.confirm(`Disable internet monitoring for "${device.device_label}"? Outage emails from this PC will stop.`)) return;
    setBusy(true);
    try {
      await call("disable", { monitor_id: device.id });
      if (local?.id === device.id) saveLocalNetworkMonitor(null);
      toast.success("Monitoring disabled.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to disable monitoring");
    } finally {
      setBusy(false);
    }
  };

  const activeLocal = !!local && devices.some((device) => device.id === local.id && device.enabled);
  const localOtherHotel = !!local && activeLocal && local.hotelId !== selectedHotelId;
  const currentHotel = hotelOptions.find((hotel) => hotel.value === selectedHotelId)?.label;
  if (profile?.organization_slug !== "rdhotels") return null;

  return <div className="space-y-5">
    <div>
      <h2 className="text-2xl font-bold flex items-center gap-2"><Wifi className="h-6 w-6" /> Internet Monitoring</h2>
      <p className="text-sm text-muted-foreground mt-1">
        Register the reception PC once. HotelCare watches for missing cloud heartbeats and
        emails only the RD Hotels administrator when it detects a possible outage and when service returns.
      </p>
    </div>

    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Monitor className="h-5 w-5" /> This reception computer</CardTitle>
        <CardDescription>No router access, separate software or new hardware required.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="network-hotel">Hotel</Label>
          <select id="network-hotel" value={selectedHotelId}
            onChange={(e) => setSelectedHotelId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            disabled={hotelOptions.length <= 1 || busy}>
            {hotelOptions.length === 0 && <option value="">No assigned hotel available</option>}
            {hotelOptions.map((hotel) => <option key={hotel.value} value={hotel.value}>{hotel.label}</option>)}
          </select>
        </div>
        {activeLocal ? <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-600" />
            <strong>This browser has an active registration</strong></div>
          <p className="text-sm text-muted-foreground">
            {local?.label} · {localOtherHotel ? `Registered for another hotel (${local?.hotelId})` : currentHotel}
          </p>
          {localOtherHotel && <p className="text-sm text-amber-700">
            Disable the old device from its original hotel before registering this PC to a different property.
          </p>}
        </div> : <div className="space-y-2">
          <Label htmlFor="network-device-name">Computer name</Label>
          <Input id="network-device-name" value={name} maxLength={100}
            onChange={(e) => setName(e.target.value)} placeholder="Reception PC 1" />
          <Button disabled={busy || !selectedHotelId || !name.trim()}
            onClick={() => void enable()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
            Enable monitoring on this PC
          </Button>
        </div>}
        <div className="rounded-md bg-muted/60 p-3 text-sm space-y-1">
          <p><strong>Alert recipient:</strong> anu@rdhotels.hu</p>
          <p><strong>Heartbeat:</strong> Every 30 seconds, while the HotelCare browser is running</p>
          <p><strong>Possible outage:</strong> No server heartbeat for 120 seconds</p>
          <p><strong>Reception notifications:</strong> None</p>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div><CardTitle>Registered monitoring computers</CardTitle>
            <CardDescription>Current status for {currentHotel || "the selected hotel"}</CardDescription></div>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {!loading && !devices.length && <p className="text-sm text-muted-foreground">No computers registered at this hotel.</p>}
        {devices.map((device) => {
          const age = device.last_heartbeat_at ? Date.now() - new Date(device.last_heartbeat_at).getTime() : Infinity;
          const isOnline = device.enabled && age < ONLINE_THRESHOLD_MS;
          return <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                {isOnline ? <Wifi className="h-4 w-4 text-green-600" /> :
                  <WifiOff className="h-4 w-4 text-muted-foreground" />}
                <span className="font-medium">{device.device_label}</span>
                <Badge variant={!device.enabled ? "secondary" : isOnline ? "outline" : "destructive"}>
                  {!device.enabled ? "Disabled" : isOnline ? "Reporting" : "Possible outage / device unavailable"}
                </Badge>
                {local?.id === device.id && <Badge variant="secondary">This computer</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">Last heartbeat: {fmt(device.last_heartbeat_at)} (Budapest)</p>
            </div>
            {device.enabled && <Button variant="outline" size="sm" disabled={busy}
              onClick={() => void disable(device)}>Disable</Button>}
          </div>;
        })}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Outage history</CardTitle>
        <CardDescription>Possible connection interruptions and automatic recovery times</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!incidents.length && <p className="text-sm text-muted-foreground">No interruptions recorded.</p>}
        {incidents.map((incident) => {
          const device = devices.find((x) => x.id === incident.monitor_id);
          return <div key={incident.id} className="rounded-lg border p-3 space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {incident.recovered_at ? <CheckCircle2 className="h-4 w-4 text-green-600" /> :
                <AlertTriangle className="h-4 w-4 text-amber-600" />}
              <strong>{device?.device_label || "Reception PC"}</strong>
              <Badge variant={incident.recovered_at ? "secondary" : "destructive"}>
                {incident.closed_reason === "disabled" ? "Monitoring disabled" :
                  incident.recovered_at ? "Recovered" : "Possible outage"}
              </Badge>
            </div>
            <p className="text-muted-foreground">Detected: {fmt(incident.detected_at)} (Budapest)</p>
            {incident.recovered_at && <p className="text-muted-foreground">Ended: {fmt(incident.recovered_at)} (Budapest)</p>}
          </div>;
        })}
      </CardContent>
    </Card>

    <p className="text-xs text-muted-foreground">
      <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
      A closed tab, sleeping computer, or browser throttling may look like an internet outage.
      These emails say "possible outage" until a more reliable local monitoring agent is available.
    </p>
  </div>;
}
