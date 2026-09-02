import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  ExternalLink,
  Link2,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Header } from "@/components/layout/Header";
import { MainTabsBar } from "@/components/layout/MainTabsBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  GOOGLE_BUSINESS_REQUIRED_APIS,
  googleApiConsoleUrl,
  parseGoogleBusinessSetupError,
} from "@/lib/googleBusinessSetup";
import { toast } from "sonner";

const ALLOWED = ["admin", "top_management", "top_management_manager"];

type Connection = {
  id: string;
  google_account_display_name?: string | null;
  google_account_email?: string | null;
  status: string;
  last_sync_at?: string | null;
  last_error?: string | null;
  created_at?: string | null;
};

type Location = {
  id: string;
  hotel_id: string | null;
  google_location_title: string;
  google_account_name?: string | null;
  google_location_name?: string;
  reply_mode: string;
  min_auto_rating: number;
  last_sync_at?: string | null;
};

type Review = {
  id: string;
  reviewer_display_name?: string | null;
  star_rating: number;
  comment?: string | null;
  ai_draft?: string | null;
  reply_status: string;
  google_location_id?: string;
};

type Status = {
  google_configured: boolean;
  connections: Connection[];
  locations: Location[];
  reviews: Review[];
};

type E2EState = {
  status: "idle" | "running" | "blocked" | "partial" | "passed";
  message: string;
};

export default function Reputation() {
  const { profile, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [itemBusy, setItemBusy] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [e2e, setE2E] = useState<E2EState>({ status: "idle", message: "" });

  const invokeRaw = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!organizationSlug) throw new Error("Organization is missing");
    const { data: result, error } = await supabase.functions.invoke("google-reputation", {
      body: { action, organization_slug: organizationSlug, ...extra },
    });
    if (error) throw error;
    return result;
  };

  const invoke = async (action: string, extra: Record<string, unknown> = {}) => {
    const result = await invokeRaw(action, extra);
    if (result?.error) throw new Error(result.error);
    return result;
  };

  const load = async () => {
    if (!organizationSlug) return null;
    setBusy(true);
    try {
      const result = (await invoke("status")) as Status;
      setData(result);
      const latestError = result.connections.find((connection) => connection.last_error)?.last_error || null;
      setSetupError(latestError);
      return result;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load reputation data");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const syncLocations = async (silent = false) => {
    setBusy(true);
    try {
      const result = await invokeRaw("sync_locations");
      if (result?.ok === false || result?.error) {
        const message = String(result?.error || "Google Business API setup is incomplete");
        setSetupError(message);
        if (!silent) toast.warning("Google API setup is incomplete. Follow the setup steps shown on this page.");
        await load();
        return { ok: false, error: message, result };
      }

      setSetupError(null);
      if (!silent) toast.success(`${result?.locations?.length || 0} Google Business location(s) found`);
      await load();
      return { ok: true, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not discover Google locations";
      setSetupError(message);
      if (!silent) toast.error("Location discovery failed. See the Google setup panel for details.");
      await load();
      return { ok: false, error: message };
    } finally {
      setBusy(false);
    }
  };

  const runE2ECheck = async () => {
    setBusy(true);
    setE2E({ status: "running", message: "Testing HotelCare → Supabase → Google Business Profile…" });
    try {
      const status = (await invoke("status")) as Status;
      if (!status.connections.length) {
        setE2E({ status: "blocked", message: "Google is not connected yet. Connect the Google Business Profile account first." });
        return;
      }

      const discovery = await invokeRaw("sync_locations");
      if (discovery?.ok === false || discovery?.error) {
        const message = String(discovery?.error || "Google location discovery is blocked");
        setSetupError(message);
        setE2E({
          status: "blocked",
          message: "OAuth and HotelCare are healthy. Google Cloud API setup is the blocking step. Enable the required APIs below, wait a few minutes, then run this test again.",
        });
        await load();
        return;
      }

      const discoveredLocations = Array.isArray(discovery?.locations) ? discovery.locations : [];
      const mappedLocations = discoveredLocations.filter((location: Location) => Boolean(location.hotel_id));

      if (!mappedLocations.length) {
        setSetupError(null);
        setE2E({
          status: "partial",
          message: `${discoveredLocations.length} Google location(s) discovered successfully. Google API connectivity passed. Map the Ottofiori listings to a HotelCare property to continue the review-sync part of the E2E test.`,
        });
        await load();
        return;
      }

      const reviewSync = await invokeRaw("sync_reviews");
      if (reviewSync?.ok === false || reviewSync?.error) {
        const message = String(reviewSync?.error || "Google review synchronization is blocked");
        setSetupError(message);
        setE2E({
          status: "blocked",
          message: "Location discovery passed, but the Google review API step is blocked. Enable the Google My Business API below and run the test again.",
        });
        await load();
        return;
      }

      setSetupError(null);
      setE2E({
        status: "passed",
        message: `E2E passed: ${discoveredLocations.length} Google location(s) discovered and ${Number(reviewSync?.imported || 0)} review record(s) synchronized.`,
      });
      await load();
    } catch (error) {
      setE2E({
        status: "blocked",
        message: error instanceof Error ? error.message : "The E2E test could not complete.",
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (loading) return;
    if (!profile || (!profile.is_super_admin && !ALLOWED.includes(profile.role))) {
      navigate(organizationSlug ? `/${organizationSlug}` : "/");
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, profile?.role, organizationSlug]);

  useEffect(() => {
    if (searchParams.get("google_business") !== "connected") return;
    toast.success("Google Business Profile connected securely");
    const clean = new URL(window.location.href);
    clean.searchParams.delete("google_business");
    clean.searchParams.delete("reason");
    window.history.replaceState({}, "", clean.toString());
    void syncLocations(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    setBusy(true);
    try {
      const result = await invoke("start_oauth", { return_url: window.location.href.split("?")[0] });
      window.location.assign(result.authorization_url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start Google connection");
      setBusy(false);
    }
  };

  const mapToOttofiori = async (locationId: string) => {
    setItemBusy(locationId);
    try {
      await invoke("map_location", {
        location_id: locationId,
        hotel_id: "ottofiori",
        reply_mode: "draft_only",
        min_auto_rating: 4,
      });
      toast.success("Mapped to Hotel Ottofiori");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not map location");
    } finally {
      setItemBusy(null);
    }
  };

  const syncReviews = async () => {
    setBusy(true);
    try {
      const result = await invokeRaw("sync_reviews");
      if (result?.ok === false || result?.error) {
        const message = String(result?.error || "Google review synchronization is blocked");
        setSetupError(message);
        toast.warning("Google review API setup is incomplete. See the setup panel above.");
        await load();
        return;
      }
      setSetupError(null);
      toast.success(`${result?.imported || 0} review record(s) synchronized`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sync Google reviews");
    } finally {
      setBusy(false);
    }
  };

  const draft = async (reviewId: string) => {
    setItemBusy(reviewId);
    try {
      await invoke("draft_reply", { review_id: reviewId });
      toast.success("AI reply drafted");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not draft reply");
    } finally {
      setItemBusy(null);
    }
  };

  const publish = async (reviewId: string) => {
    setItemBusy(reviewId);
    try {
      await invoke("publish_reply", { review_id: reviewId });
      toast.success("Reply published to Google");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish reply");
    } finally {
      setItemBusy(null);
    }
  };

  const reviews = data?.reviews || [];
  const locations = data?.locations || [];
  const mapped = locations.filter((location) => location.hotel_id === "ottofiori");
  const avg = reviews.length ? reviews.reduce((sum, review) => sum + Number(review.star_rating || 0), 0) / reviews.length : 0;
  const locationNameById = useMemo(() => new Map(locations.map((location) => [location.id, location.google_location_title])), [locations]);
  const connectionError = setupError || data?.connections.find((connection) => connection.last_error)?.last_error || null;
  const googleSetup = useMemo(() => parseGoogleBusinessSetupError(connectionError), [connectionError]);

  const e2eTone =
    e2e.status === "passed"
      ? "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20"
      : e2e.status === "blocked"
        ? "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20"
        : "border-blue-200 bg-blue-50/50 dark:bg-blue-950/20";

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-3 sm:px-4 py-4 space-y-4">
        <MainTabsBar current="reputation" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Reputation</h1>
            <p className="text-sm text-muted-foreground">Google reviews, AI-assisted replies and property reputation signals.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={load} disabled={busy}>
              <RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant={data?.connections?.length ? "outline" : "default"} onClick={connect} disabled={busy || !data?.google_configured}>
              <Link2 className="h-4 w-4 mr-2" />
              {data?.connections?.length ? "Reconnect account" : "Connect Google Business"}
            </Button>
          </div>
        </div>

        {!data?.google_configured && (
          <Card className="border-amber-300">
            <CardContent className="pt-6 flex gap-3">
              <ShieldCheck className="h-5 w-5 text-amber-600 shrink-0" />
              <div>
                <p className="font-medium">Google credentials required</p>
                <p className="text-sm text-muted-foreground">Add the Google OAuth client ID, client secret and token-encryption key to Supabase Edge Function secrets.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {googleSetup.blocked && (
          <Card className="border-amber-300 bg-amber-50/40 dark:bg-amber-950/10">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                Google API setup incomplete
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline" className="gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> OAuth connected
                </Badge>
                <Badge variant="outline" className="gap-1 border-amber-300 text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" /> Google Cloud API blocked
                </Badge>
                {googleSetup.projectId && <Badge variant="secondary">Project {googleSetup.projectId}</Badge>}
              </div>

              <div>
                <p className="font-medium">HotelCare authentication is working.</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Google is refusing the next API call because required Business Profile services are disabled or unavailable in the OAuth client&apos;s Google Cloud project. Enabling them is required before HotelCare can discover locations, read reviews or publish replies.
                </p>
              </div>

              {googleSetup.projectId ? (
                <div className="grid lg:grid-cols-3 gap-3">
                  {GOOGLE_BUSINESS_REQUIRED_APIS.map((api) => (
                    <div key={api.key} className="rounded-lg border bg-background p-3 space-y-2">
                      <div className="font-medium text-sm">{api.label}</div>
                      <div className="text-xs text-muted-foreground min-h-8">{api.purpose}</div>
                      <Button variant="outline" size="sm" className="w-full" asChild>
                        <a href={googleApiConsoleUrl(api.service, googleSetup.projectId!)} target="_blank" rel="noreferrer">
                          Open / enable
                          <ExternalLink className="h-3.5 w-3.5 ml-2" />
                        </a>
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Open the Google Cloud project that owns the HotelCare OAuth client and enable the Account Management, Business Information and Google My Business APIs.</p>
              )}

              <div className="rounded-md bg-muted/60 p-3 text-sm">
                After enabling the APIs, allow Google a few minutes to propagate the change, then run the E2E connection test. Reconnecting OAuth is normally not required.
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={runE2ECheck} disabled={busy}>
                  <Activity className={`h-4 w-4 mr-2 ${e2e.status === "running" ? "animate-pulse" : ""}`} />
                  Run E2E connection test
                </Button>
                <Button variant="outline" onClick={() => syncLocations()} disabled={busy}>
                  <Download className="h-4 w-4 mr-2" />
                  Retry location discovery
                </Button>
              </div>

              {connectionError && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">Technical details</summary>
                  <div className="mt-2 rounded-md bg-background border p-3 whitespace-pre-wrap break-words">{connectionError}</div>
                </details>
              )}
            </CardContent>
          </Card>
        )}

        {e2e.status !== "idle" && (
          <Card className={e2eTone}>
            <CardContent className="pt-5 flex items-start gap-3">
              {e2e.status === "passed" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : e2e.status === "blocked" ? (
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              ) : (
                <Activity className={`h-5 w-5 shrink-0 mt-0.5 ${e2e.status === "running" ? "animate-pulse" : ""}`} />
              )}
              <div>
                <div className="font-medium">E2E connection test</div>
                <div className="text-sm mt-1">{e2e.message}</div>
              </div>
            </CardContent>
          </Card>
        )}

        {data?.connections?.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Google Business locations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => syncLocations()} disabled={busy || googleSetup.apiDisabled}>
                  <Download className="h-4 w-4 mr-2" />
                  Discover / refresh locations
                </Button>
                {!googleSetup.blocked && (
                  <Button variant="outline" onClick={runE2ECheck} disabled={busy}>
                    <Activity className="h-4 w-4 mr-2" />
                    Test connection
                  </Button>
                )}
                {mapped.length > 0 && (
                  <Button onClick={syncReviews} disabled={busy}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Sync reviews
                  </Button>
                )}
              </div>

              {locations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {googleSetup.blocked
                    ? "Google account connected. Complete the Google Cloud API setup above before discovering locations."
                    : "Connection saved. Discover the Google locations managed by this account."}
                </p>
              ) : (
                locations.map((location) => (
                  <div key={location.id} className="border rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{location.google_location_title}</div>
                      <div className="text-xs text-muted-foreground">
                        {location.hotel_id ? `Mapped to ${location.hotel_id}` : "Not mapped to a HotelCare property"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {location.hotel_id === "ottofiori" ? (
                        <Badge>Ottofiori</Badge>
                      ) : (
                        <Button size="sm" variant="outline" disabled={itemBusy === location.id} onClick={() => mapToOttofiori(location.id)}>
                          Map to Ottofiori
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid sm:grid-cols-3 gap-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Reviews loaded</CardTitle></CardHeader>
            <CardContent className="text-3xl font-bold">{reviews.length}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Average rating</CardTitle></CardHeader>
            <CardContent className="text-3xl font-bold flex items-center gap-2">{avg ? avg.toFixed(1) : "—"}<Star className="h-5 w-5" /></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Awaiting reply</CardTitle></CardHeader>
            <CardContent className="text-3xl font-bold">{reviews.filter((review) => review.reply_status === "unreplied" || review.reply_status === "draft").length}</CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MessageSquareText className="h-5 w-5" />Review inbox</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {reviews.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                {googleSetup.blocked
                  ? "Google is connected, but review synchronization is waiting for the required Google Cloud APIs to be enabled."
                  : "No Google reviews are synced yet. Discover the Google locations, map the Ottofiori listings, then sync reviews."}
              </div>
            ) : (
              reviews.map((review) => (
                <div key={review.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{review.reviewer_display_name || "Google guest"}</div>
                      {review.google_location_id && <div className="text-xs text-muted-foreground">{locationNameById.get(review.google_location_id) || "Google Business"}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{review.star_rating} ★</Badge>
                      <Badge>{review.reply_status}</Badge>
                    </div>
                  </div>
                  <p className="text-sm">{review.comment || "Rating only"}</p>
                  {review.ai_draft && <div className="bg-muted rounded-md p-3 text-sm"><span className="font-medium">AI draft: </span>{review.ai_draft}</div>}
                  <div className="flex flex-wrap gap-2">
                    {review.reply_status !== "published" && (
                      <Button size="sm" variant="outline" disabled={itemBusy === review.id} onClick={() => draft(review.id)}>
                        <Sparkles className="h-4 w-4 mr-2" />
                        {review.ai_draft ? "Regenerate draft" : "Draft reply"}
                      </Button>
                    )}
                    {review.ai_draft && review.reply_status !== "published" && (
                      <Button size="sm" disabled={itemBusy === review.id} onClick={() => publish(review.id)}>
                        <Send className="h-4 w-4 mr-2" />Approve & publish
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
