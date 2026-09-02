import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Building2,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  History,
  Languages,
  Link2,
  MessageSquareText,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldAlert,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  updated_at?: string | null;
};

type Hotel = {
  hotel_id: string;
  hotel_name: string;
  is_active?: boolean | null;
};

type Location = {
  id: string;
  hotel_id: string | null;
  google_location_title: string;
  google_account_name?: string | null;
  google_location_name?: string | null;
  reply_mode: "draft_only" | "auto_positive" | "auto_all";
  min_auto_rating: number;
  reply_tone: "warm_professional" | "friendly_concise" | "formal" | "luxury_hospitality";
  reply_language_mode: "match_guest" | "english" | "hungarian";
  auto_reply_enabled: boolean;
  auto_reply_delay_minutes: number;
  require_approval_below_rating: number;
  reply_signature?: string | null;
  brand_context?: string | null;
  is_active?: boolean;
  last_sync_at?: string | null;
};

type Review = {
  id: string;
  hotel_id?: string | null;
  google_location_id: string;
  reviewer_display_name?: string | null;
  reviewer_profile_photo_url?: string | null;
  star_rating: number;
  comment?: string | null;
  review_create_time?: string | null;
  review_update_time?: string | null;
  google_reply_comment?: string | null;
  google_reply_update_time?: string | null;
  ai_language?: string | null;
  ai_sentiment?: string | null;
  ai_categories?: string[];
  ai_summary?: string | null;
  ai_risk_level?: "low" | "medium" | "high" | null;
  ai_confidence?: number | null;
  ai_draft?: string | null;
  ai_draft_generated_at?: string | null;
  draft_edited_at?: string | null;
  reply_status: "unreplied" | "draft" | "approved" | "published" | "error";
  replied_at?: string | null;
  auto_reply_eligible?: boolean;
};

type ReplyEvent = {
  id: string;
  review_id: string;
  google_location_id?: string | null;
  hotel_id?: string | null;
  event_type: string;
  reply_text?: string | null;
  metadata?: Record<string, unknown> | null;
  actor_user_id?: string | null;
  created_at: string;
};

type Status = {
  google_configured: boolean;
  connections: Connection[];
  locations: Location[];
  reviews: Review[];
  hotels: Hotel[];
  events: ReplyEvent[];
};

type E2EState = {
  status: "idle" | "running" | "blocked" | "partial" | "passed";
  message: string;
};

type LocationEdit = Pick<
  Location,
  | "hotel_id"
  | "reply_mode"
  | "min_auto_rating"
  | "reply_tone"
  | "reply_language_mode"
  | "auto_reply_enabled"
  | "auto_reply_delay_minutes"
  | "require_approval_below_rating"
  | "reply_signature"
  | "brand_context"
>;

const fmtDate = (value?: string | null) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(d);
};

const stars = (rating: number) => (
  <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
    {Array.from({ length: 5 }).map((_, index) => (
      <Star
        key={index}
        className={`h-4 w-4 ${index < rating ? "fill-current text-amber-500" : "text-muted-foreground/30"}`}
      />
    ))}
  </span>
);

const riskBadge = (risk?: string | null) => {
  if (!risk) return null;
  if (risk === "high") return <Badge variant="destructive">High risk</Badge>;
  if (risk === "medium") return <Badge variant="outline" className="border-amber-300 text-amber-700">Review carefully</Badge>;
  return <Badge variant="outline" className="border-emerald-300 text-emerald-700">Low risk</Badge>;
};

const eventLabel: Record<string, string> = {
  draft_generated: "AI draft generated",
  draft_edited: "Draft edited",
  approved: "Reply approved",
  published: "Published to Google",
  auto_published: "Automatically published",
  publish_failed: "Publish failed",
  sync_detected_reply: "Google reply detected",
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
  const [draftText, setDraftText] = useState<Record<string, string>>({});
  const [locationEdits, setLocationEdits] = useState<Record<string, LocationEdit>>({});
  const [search, setSearch] = useState("");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");

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

  const hydrateLocalState = (result: Status) => {
    setDraftText((current) => {
      const next = { ...current };
      result.reviews.forEach((review) => {
        if (!(review.id in next) || next[review.id] === review.ai_draft) next[review.id] = review.ai_draft || "";
      });
      return next;
    });
    setLocationEdits((current) => {
      const next = { ...current };
      result.locations.forEach((location) => {
        next[location.id] = {
          hotel_id: location.hotel_id,
          reply_mode: location.reply_mode || "draft_only",
          min_auto_rating: Number(location.min_auto_rating || 4),
          reply_tone: location.reply_tone || "warm_professional",
          reply_language_mode: location.reply_language_mode || "match_guest",
          auto_reply_enabled: Boolean(location.auto_reply_enabled),
          auto_reply_delay_minutes: Number(location.auto_reply_delay_minutes ?? 15),
          require_approval_below_rating: Number(location.require_approval_below_rating || 4),
          reply_signature: location.reply_signature || "",
          brand_context: location.brand_context || "",
        };
      });
      return next;
    });
  };

  const load = async () => {
    if (!organizationSlug) return null;
    setBusy(true);
    try {
      const result = (await invoke("status")) as Status;
      setData(result);
      hydrateLocalState(result);
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
        if (!silent) toast.warning("Google setup is not ready yet. See the status panel for the exact reason.");
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
      if (!silent) toast.error("Location discovery failed. See the setup panel for details.");
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
        const state = parseGoogleBusinessSetupError(message);
        setE2E({
          status: "blocked",
          message: state.quotaPending
            ? "HotelCare and OAuth are healthy. The Google APIs are enabled, but Google has not approved usable Business Profile API quota for this Cloud project yet."
            : "HotelCare and OAuth are healthy. Google Cloud/API access is the remaining blocking step.",
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
          message: `${discoveredLocations.length} Google location(s) discovered. Connectivity passed. Map the listings to HotelCare properties to continue the review-sync test.`,
        });
        await load();
        return;
      }

      const reviewSync = await invokeRaw("sync_reviews");
      if (reviewSync?.ok === false || reviewSync?.error) {
        setSetupError(String(reviewSync?.error || "Google review synchronization is blocked"));
        setE2E({ status: "blocked", message: "Location discovery passed, but Google review synchronization is still blocked." });
        await load();
        return;
      }

      setSetupError(null);
      setE2E({
        status: "passed",
        message: `E2E passed: ${discoveredLocations.length} location(s) discovered and ${Number(reviewSync?.imported || 0)} review record(s) synchronized.`,
      });
      await load();
    } catch (error) {
      setE2E({ status: "blocked", message: error instanceof Error ? error.message : "The E2E test could not complete." });
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

  const syncReviews = async () => {
    setBusy(true);
    try {
      const result = await invokeRaw("sync_reviews");
      if (result?.ok === false || result?.error) {
        const message = String(result?.error || "Google review synchronization is blocked");
        setSetupError(message);
        toast.warning("Google review synchronization is not available yet. See the setup status above.");
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
      const result = await invoke("draft_reply", { review_id: reviewId });
      setDraftText((current) => ({ ...current, [reviewId]: result.draft || "" }));
      toast.success("AI reply drafted");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not draft reply");
    } finally {
      setItemBusy(null);
    }
  };

  const saveDraft = async (reviewId: string) => {
    setItemBusy(reviewId);
    try {
      await invoke("update_draft", { review_id: reviewId, reply: draftText[reviewId] || "" });
      toast.success("Draft saved");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save draft");
    } finally {
      setItemBusy(null);
    }
  };

  const publish = async (reviewId: string) => {
    setItemBusy(reviewId);
    try {
      await invoke("publish_reply", { review_id: reviewId, reply: draftText[reviewId] || "" });
      toast.success("Reply published to Google");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish reply");
    } finally {
      setItemBusy(null);
    }
  };

  const saveLocation = async (locationId: string) => {
    const edit = locationEdits[locationId];
    if (!edit) return;
    setItemBusy(locationId);
    try {
      await invoke("update_location_settings", { location_id: locationId, ...edit });
      toast.success("Reputation rules saved");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save location rules");
    } finally {
      setItemBusy(null);
    }
  };

  const reviews = data?.reviews || [];
  const locations = data?.locations || [];
  const hotels = data?.hotels || [];
  const events = data?.events || [];
  const mapped = locations.filter((location) => location.hotel_id);
  const avg = reviews.length ? reviews.reduce((sum, review) => sum + Number(review.star_rating || 0), 0) / reviews.length : 0;
  const published = reviews.filter((review) => review.reply_status === "published").length;
  const awaiting = reviews.filter((review) => review.reply_status !== "published").length;
  const urgent = reviews.filter((review) => review.reply_status !== "published" && review.star_rating <= 3).length;
  const autoReady = reviews.filter((review) => review.reply_status !== "published" && review.auto_reply_eligible).length;
  const responseRate = reviews.length ? Math.round((published / reviews.length) * 100) : 0;

  const locationNameById = useMemo(
    () => new Map(locations.map((location) => [location.id, location.google_location_title])),
    [locations],
  );
  const locationById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const reviewById = useMemo(() => new Map(reviews.map((review) => [review.id, review])), [reviews]);
  const connectionError = setupError || data?.connections.find((connection) => connection.last_error)?.last_error || null;
  const googleSetup = useMemo(() => parseGoogleBusinessSetupError(connectionError), [connectionError]);

  const topicCounts = useMemo(() => {
    const counts = new Map<string, number>();
    reviews.forEach((review) => (review.ai_categories || []).forEach((category) => counts.set(category, (counts.get(category) || 0) + 1)));
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [reviews]);

  const filteredReviews = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reviews.filter((review) => {
      if (ratingFilter !== "all" && Number(ratingFilter) !== review.star_rating) return false;
      if (statusFilter !== "all" && review.reply_status !== statusFilter) return false;
      if (locationFilter !== "all" && review.google_location_id !== locationFilter) return false;
      if (riskFilter !== "all" && String(review.ai_risk_level || "unknown") !== riskFilter) return false;
      if (!q) return true;
      return [review.reviewer_display_name, review.comment, review.ai_summary, locationNameById.get(review.google_location_id)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [reviews, search, ratingFilter, statusFilter, locationFilter, riskFilter, locationNameById]);

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

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">Reputation</h1>
              {data?.connections?.length ? <Badge variant="outline" className="border-emerald-300 text-emerald-700">Google connected</Badge> : null}
              {googleSetup.quotaPending ? <Badge variant="outline" className="border-amber-300 text-amber-700">Google approval pending</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground mt-1">Google reviews, AI-assisted responses, automation rules and reputation intelligence.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={load} disabled={busy}>
              <RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />Refresh
            </Button>
            {mapped.length > 0 && (
              <Button variant="outline" onClick={syncReviews} disabled={busy || googleSetup.blocked}>
                <Download className="h-4 w-4 mr-2" />Sync reviews
              </Button>
            )}
            <Button variant={data?.connections?.length ? "outline" : "default"} onClick={connect} disabled={busy || !data?.google_configured}>
              <Link2 className="h-4 w-4 mr-2" />{data?.connections?.length ? "Reconnect account" : "Connect Google Business"}
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
                {googleSetup.quotaPending ? "Google Business Profile API approval pending" : "Google API setup incomplete"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" />OAuth connected</Badge>
                <Badge variant="outline" className="gap-1 border-amber-300 text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {googleSetup.quotaPending ? "Awaiting Google allowlist approval" : "Google API blocked"}
                </Badge>
                {googleSetup.projectId && <Badge variant="secondary">Project {googleSetup.projectId}</Badge>}
              </div>

              {googleSetup.quotaPending ? (
                <div>
                  <p className="font-medium">HotelCare and Google OAuth are working correctly.</p>
                  <p className="text-sm text-muted-foreground mt-1">The APIs are enabled, but Google has not yet granted usable Business Profile API quota to this Cloud project. No reconnection or secret changes are required while the access case is under review.</p>
                </div>
              ) : (
                <div>
                  <p className="font-medium">HotelCare authentication is working.</p>
                  <p className="text-sm text-muted-foreground mt-1">Google is refusing the next API call because required Business Profile services are disabled or access has not been granted.</p>
                </div>
              )}

              {!googleSetup.quotaPending && googleSetup.projectId && (
                <div className="grid lg:grid-cols-3 gap-3">
                  {GOOGLE_BUSINESS_REQUIRED_APIS.map((api) => (
                    <div key={api.key} className="rounded-lg border bg-background p-3 space-y-2">
                      <div className="font-medium text-sm">{api.label}</div>
                      <div className="text-xs text-muted-foreground min-h-8">{api.purpose}</div>
                      <Button variant="outline" size="sm" className="w-full" asChild>
                        <a href={googleApiConsoleUrl(api.service, googleSetup.projectId!)} target="_blank" rel="noreferrer">
                          Open / enable<ExternalLink className="h-3.5 w-3.5 ml-2" />
                        </a>
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button onClick={runE2ECheck} disabled={busy}>
                  <Activity className={`h-4 w-4 mr-2 ${e2e.status === "running" ? "animate-pulse" : ""}`} />Run E2E connection test
                </Button>
                {!googleSetup.quotaPending && (
                  <Button variant="outline" onClick={() => syncLocations()} disabled={busy}>
                    <Download className="h-4 w-4 mr-2" />Retry location discovery
                  </Button>
                )}
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
              {e2e.status === "passed" ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" /> : <Activity className={`h-5 w-5 shrink-0 mt-0.5 ${e2e.status === "running" ? "animate-pulse" : ""}`} />}
              <div><div className="font-medium">E2E connection test</div><div className="text-sm mt-1">{e2e.message}</div></div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="overview" className="gap-2"><BarChart3 className="h-4 w-4" />Overview</TabsTrigger>
            <TabsTrigger value="inbox" className="gap-2"><MessageSquareText className="h-4 w-4" />Review inbox{awaiting > 0 ? <Badge variant="secondary" className="ml-1">{awaiting}</Badge> : null}</TabsTrigger>
            <TabsTrigger value="locations" className="gap-2"><Settings2 className="h-4 w-4" />Locations & rules</TabsTrigger>
            <TabsTrigger value="audit" className="gap-2"><History className="h-4 w-4" />Audit trail</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              <Card><CardContent className="pt-5"><div className="text-xs text-muted-foreground">Reviews loaded</div><div className="text-3xl font-bold mt-2">{reviews.length}</div></CardContent></Card>
              <Card><CardContent className="pt-5"><div className="text-xs text-muted-foreground">Average rating</div><div className="flex items-center gap-2 mt-2"><span className="text-3xl font-bold">{reviews.length ? avg.toFixed(1) : "—"}</span><Star className="h-5 w-5" /></div></CardContent></Card>
              <Card><CardContent className="pt-5"><div className="text-xs text-muted-foreground">Response rate</div><div className="text-3xl font-bold mt-2">{reviews.length ? `${responseRate}%` : "—"}</div></CardContent></Card>
              <Card><CardContent className="pt-5"><div className="text-xs text-muted-foreground">Awaiting reply</div><div className="text-3xl font-bold mt-2">{awaiting}</div></CardContent></Card>
              <Card className={urgent ? "border-amber-300" : ""}><CardContent className="pt-5"><div className="text-xs text-muted-foreground">1–3★ attention</div><div className="text-3xl font-bold mt-2">{urgent}</div></CardContent></Card>
              <Card><CardContent className="pt-5"><div className="text-xs text-muted-foreground">Auto-safe queue</div><div className="text-3xl font-bold mt-2">{autoReady}</div></CardContent></Card>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-lg flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Automation safety</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Google locations mapped</span><span className="font-medium">{mapped.length} / {locations.length}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Automatic publishing enabled</span><span className="font-medium">{locations.filter((location) => location.auto_reply_enabled).length} location(s)</span></div>
                  <div className="rounded-lg border bg-muted/30 p-3 flex gap-2"><ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" /><span>High-risk complaints are never considered safe for automatic publishing. Auto replies remain off by default until you explicitly enable them per location.</span></div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Sparkles className="h-5 w-5" />Recurring review topics</CardTitle></CardHeader>
                <CardContent>
                  {topicCounts.length ? (
                    <div className="flex flex-wrap gap-2">{topicCounts.map(([topic, count]) => <Badge key={topic} variant="secondary" className="capitalize">{topic} · {count}</Badge>)}</div>
                  ) : <p className="text-sm text-muted-foreground">Topics will appear after the first review sync.</p>}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Building2 className="h-5 w-5" />Connection status</CardTitle></CardHeader>
              <CardContent className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <div><div className="text-muted-foreground">Google account</div><div className="font-medium mt-1">{data?.connections?.[0]?.google_account_email || data?.connections?.[0]?.google_account_display_name || "Not connected"}</div></div>
                <div><div className="text-muted-foreground">Connected</div><div className="font-medium mt-1">{fmtDate(data?.connections?.[0]?.created_at)}</div></div>
                <div><div className="text-muted-foreground">Last Google sync</div><div className="font-medium mt-1">{fmtDate(data?.connections?.[0]?.last_sync_at)}</div></div>
                <div><div className="text-muted-foreground">Mapped properties</div><div className="font-medium mt-1">{mapped.length}</div></div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="inbox" className="space-y-4">
            <Card>
              <CardContent className="pt-5">
                <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-3">
                  <div className="relative xl:col-span-2"><Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search guest, review or topic…" className="pl-9" /></div>
                  <Select value={ratingFilter} onValueChange={setRatingFilter}><SelectTrigger><SelectValue placeholder="Rating" /></SelectTrigger><SelectContent><SelectItem value="all">All ratings</SelectItem>{[5,4,3,2,1].map((value) => <SelectItem key={value} value={String(value)}>{value} stars</SelectItem>)}</SelectContent></Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="unreplied">Awaiting reply</SelectItem><SelectItem value="draft">Draft ready</SelectItem><SelectItem value="published">Published</SelectItem></SelectContent></Select>
                  <Select value={riskFilter} onValueChange={setRiskFilter}><SelectTrigger><SelectValue placeholder="Risk" /></SelectTrigger><SelectContent><SelectItem value="all">All risk levels</SelectItem><SelectItem value="low">Low risk</SelectItem><SelectItem value="medium">Review carefully</SelectItem><SelectItem value="high">High risk</SelectItem></SelectContent></Select>
                </div>
                {locations.length > 1 && <div className="mt-3 max-w-md"><Select value={locationFilter} onValueChange={setLocationFilter}><SelectTrigger><SelectValue placeholder="Google location" /></SelectTrigger><SelectContent><SelectItem value="all">All Google locations</SelectItem>{locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.google_location_title}</SelectItem>)}</SelectContent></Select></div>}
              </CardContent>
            </Card>

            {filteredReviews.length === 0 ? (
              <Card><CardContent className="py-14 text-center text-muted-foreground">{reviews.length ? "No reviews match these filters." : googleSetup.blocked ? "Review sync will become available after Google approves Business Profile API access." : "No Google reviews are synced yet."}</CardContent></Card>
            ) : (
              <div className="space-y-3">
                {filteredReviews.map((review) => {
                  const location = locationById.get(review.google_location_id);
                  const approvalRequired = review.star_rating < Number(location?.require_approval_below_rating || 4) || review.ai_risk_level === "high";
                  const currentDraft = draftText[review.id] ?? review.ai_draft ?? "";
                  return (
                    <Card key={review.id} className={review.ai_risk_level === "high" ? "border-red-300" : approvalRequired ? "border-amber-200" : ""}>
                      <CardContent className="pt-5 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">{review.reviewer_display_name || "Google guest"}</div>
                            <div className="flex flex-wrap items-center gap-2 mt-1">{stars(review.star_rating)}<span className="text-xs text-muted-foreground">{fmtDate(review.review_update_time || review.review_create_time)}</span></div>
                            <div className="text-xs text-muted-foreground mt-1">{locationNameById.get(review.google_location_id) || "Google Business location"}</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {riskBadge(review.ai_risk_level)}
                            {review.reply_status === "published" ? <Badge className="bg-emerald-600">Published</Badge> : review.reply_status === "draft" ? <Badge variant="secondary">Draft ready</Badge> : <Badge variant="outline">Awaiting reply</Badge>}
                          </div>
                        </div>

                        <div className="rounded-lg bg-muted/40 p-3 text-sm whitespace-pre-wrap">{review.comment || <span className="text-muted-foreground">No written comment.</span>}</div>

                        {(review.ai_categories?.length || review.ai_summary) ? (
                          <div className="space-y-2">
                            {review.ai_summary && <div className="text-sm"><span className="font-medium">AI signal:</span> <span className="text-muted-foreground">{review.ai_summary}</span></div>}
                            <div className="flex flex-wrap gap-1.5">{(review.ai_categories || []).map((category) => <Badge key={category} variant="outline" className="capitalize">{category}</Badge>)}</div>
                          </div>
                        ) : null}

                        {approvalRequired && review.reply_status !== "published" && (
                          <div className="rounded-lg border border-amber-300 bg-amber-50/50 dark:bg-amber-950/10 p-3 flex gap-2 text-sm"><ShieldAlert className="h-4 w-4 mt-0.5 shrink-0 text-amber-700" /><span>This review requires manager judgment before publishing because of its rating or risk signal.</span></div>
                        )}

                        {review.reply_status === "published" ? (
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/10 p-3"><div className="text-xs font-medium text-emerald-700 mb-1">Published owner reply</div><div className="text-sm whitespace-pre-wrap">{review.google_reply_comment}</div></div>
                        ) : currentDraft ? (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 text-sm font-medium"><Bot className="h-4 w-4" />AI-assisted reply draft</div>
                            <Textarea value={currentDraft} onChange={(e) => setDraftText((current) => ({ ...current, [review.id]: e.target.value }))} rows={5} />
                            <div className="flex flex-wrap gap-2">
                              <Button variant="outline" onClick={() => saveDraft(review.id)} disabled={itemBusy === review.id}><Save className="h-4 w-4 mr-2" />Save draft</Button>
                              <Button variant="outline" onClick={() => draft(review.id)} disabled={itemBusy === review.id}><Sparkles className="h-4 w-4 mr-2" />Regenerate</Button>
                              <Button onClick={() => publish(review.id)} disabled={itemBusy === review.id || googleSetup.blocked}><Send className="h-4 w-4 mr-2" />{approvalRequired ? "Approve & publish" : "Publish to Google"}</Button>
                            </div>
                          </div>
                        ) : (
                          <Button onClick={() => draft(review.id)} disabled={itemBusy === review.id}><Sparkles className="h-4 w-4 mr-2" />Draft reply with AI</Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="locations" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Building2 className="h-5 w-5" />Google Business locations</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => syncLocations()} disabled={busy || googleSetup.quotaPending}><Download className="h-4 w-4 mr-2" />Discover / refresh locations</Button><Button variant="outline" onClick={runE2ECheck} disabled={busy}><Activity className="h-4 w-4 mr-2" />Test connection</Button></div>
                <p className="text-sm text-muted-foreground">Map each Google listing to the correct HotelCare property, then set its reply policy. A Google account can contain hotel, brunch, restaurant and bar listings independently.</p>
              </CardContent>
            </Card>

            {locations.length === 0 ? (
              <Card><CardContent className="py-14 text-center text-muted-foreground">{googleSetup.quotaPending ? "Google location discovery is waiting for API approval." : "No Google Business locations discovered yet."}</CardContent></Card>
            ) : locations.map((location) => {
              const edit = locationEdits[location.id];
              if (!edit) return null;
              return (
                <Card key={location.id}>
                  <CardHeader className="pb-3"><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><CardTitle className="text-lg">{location.google_location_title}</CardTitle><p className="text-xs text-muted-foreground mt-1">{location.hotel_id ? `Mapped to ${hotels.find((hotel) => hotel.hotel_id === location.hotel_id)?.hotel_name || location.hotel_id}` : "Not mapped"}</p></div><Badge variant={edit.auto_reply_enabled ? "default" : "outline"}>{edit.auto_reply_enabled ? "Auto reply enabled" : "Manual approval mode"}</Badge></div></CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
                      <div className="space-y-2"><Label>HotelCare property</Label><Select value={edit.hotel_id || "unmapped"} onValueChange={(value) => setLocationEdits((current) => ({ ...current, [location.id]: { ...edit, hotel_id: value === "unmapped" ? null : value } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unmapped">Not mapped</SelectItem>{hotels.filter((hotel) => hotel.is_active !== false).map((hotel) => <SelectItem key={hotel.hotel_id} value={hotel.hotel_id}>{hotel.hotel_name}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-2"><Label>Reply workflow</Label><Select value={edit.reply_mode} onValueChange={(value: Location["reply_mode"]) => setLocationEdits((current) => ({ ...current, [location.id]: { ...edit, reply_mode: value, auto_reply_enabled: value === "draft_only" ? false : edit.auto_reply_enabled } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft_only">Draft only — manager publishes</SelectItem><SelectItem value="auto_positive">Auto only positive reviews</SelectItem><SelectItem value="auto_all">Auto eligible reviews</SelectItem></SelectContent></Select></div>
                      <div className="space-y-2"><Label>AI tone</Label><Select value={edit.reply_tone} onValueChange={(value: Location["reply_tone"]) => setLocationEdits((current) => ({ ...current, [location.id]: { ...edit, reply_tone: value } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="warm_professional">Warm professional</SelectItem><SelectItem value="friendly_concise">Friendly & concise</SelectItem><SelectItem value="formal">Formal</SelectItem><SelectItem value="luxury_hospitality">Luxury hospitality</SelectItem></SelectContent></Select></div>
                      <div className="space-y-2"><Label>Reply language</Label><Select value={edit.reply_language_mode} onValueChange={(value: Location["reply_language_mode"]) => setLocationEdits((current) => ({ ...current, [location.id]: { ...edit, reply_language_mode: value } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="match_guest">Match guest language</SelectItem><SelectItem value="english">Always English</SelectItem><SelectItem value="hungarian">Always Hungarian</SelectItem></SelectContent></Select></div>
                    </div>

                    <div className="grid md:grid-cols-3 gap-4">
                      <div className="space-y-2"><Label>Minimum rating for auto reply</Label><Select value={String(edit.min_auto_rating)} onValueChange={(value) => setLocationEdits((current) => ({ ...current, [location.id]: { ...edit, min_auto_rating: Number(value) } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[5,4,3,2,1].map((value) => <SelectItem key={value} value={String(value)}>{value} stars and above</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-2"><Label>Manager approval below</Label><Select value={String(edit.require_approval_below_rating)} onValueChange={(value) => setLocationEdits((current) => ({ ...current, [location.id]: { ...edit, require_approval_below_rating: Number(value) } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[5,4,3,2,1].map((value) => <SelectItem key={value} value={String(value)}>Below {value} stars</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-2"><Label>Auto-reply delay (minutes)</Label><Input type="number" min={0} max={1440} value={edit.auto_reply_delay_minutes} onChange={(e) => setLocationEdits((current) => ({ ...current, [location.id]: { ...edit, auto_reply_delay_minutes: Number(e.target.value || 0) } }))} /></div>
                    </div>

                    <div className="grid lg:grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Reply signature</Label><Input value={edit.reply_signature || ""} onChange={(e) => setLocationEdits((current) => ({ ...current, [location.id]: { ...edit, reply_signature: e.target.value } }))} placeholder="e.g. The Hotel Ottofiori Team" /></div>
                      <div className="rounded-lg border p-3 flex items-center justify-between gap-4"><div><div className="font-medium text-sm">Automatic publishing</div><div className="text-xs text-muted-foreground mt-1">Only eligible low-risk reviews can ever be auto-published.</div></div><Switch checked={edit.auto_reply_enabled} disabled={edit.reply_mode === "draft_only"} onCheckedChange={(checked) => setLocationEdits((current) => ({ ...current, [location.id]: { ...edit, auto_reply_enabled: checked } }))} /></div>
                    </div>

                    <div className="space-y-2"><Label>Property context for AI</Label><Textarea rows={3} value={edit.brand_context || ""} onChange={(e) => setLocationEdits((current) => ({ ...current, [location.id]: { ...edit, brand_context: e.target.value } }))} placeholder="Optional factual context: breakfast hours, positioning, service style, contact instructions. The AI is told never to invent information." /></div>

                    <div className="rounded-lg bg-muted/40 p-3 text-sm flex gap-2"><ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" /><span>Recommended starting policy: 4–5★ may become eligible for automatic replies after testing; 1–3★ and any high-risk complaint remain manager-controlled.</span></div>
                    <Button onClick={() => saveLocation(location.id)} disabled={itemBusy === location.id}><Save className="h-4 w-4 mr-2" />Save location rules</Button>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="audit" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><History className="h-5 w-5" />Reply audit trail</CardTitle></CardHeader>
              <CardContent>
                {events.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">Draft, edit, approval and publish events will appear here.</div> : (
                  <div className="divide-y">
                    {events.map((event) => {
                      const review = reviewById.get(event.review_id);
                      return (
                        <div key={event.id} className="py-3 flex flex-col md:flex-row md:items-start justify-between gap-2">
                          <div>
                            <div className="font-medium text-sm">{eventLabel[event.event_type] || event.event_type}</div>
                            <div className="text-xs text-muted-foreground mt-1">{review?.reviewer_display_name || "Google guest"} · {locationNameById.get(event.google_location_id || review?.google_location_id || "") || "Google location"}</div>
                            {event.reply_text && <div className="text-sm text-muted-foreground mt-2 line-clamp-2">{event.reply_text}</div>}
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(event.created_at)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
