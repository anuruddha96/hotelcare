import { useEffect, useMemo, useRef, useState } from "react";
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
  Zap,
  CheckCheck,
  ListFilter,
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
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
import { ReplyCustomizerDialog, type ReplyCustomizerOptions } from "@/components/reputation/ReplyCustomizerDialog";

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
  reply_brand_name?: string | null;
  business_category?: "hotel" | "brunch" | "restaurant" | "conference" | "museum" | "other";
  google_account_name?: string | null;
  google_location_name?: string | null;
  google_total_review_count?: number | null;
  google_average_rating?: number | null;
  google_review_stats_updated_at?: string | null;
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
  auto_reply_enabled_at?: string | null;
  auto_reply_consent_at?: string | null;
  auto_backfill_active?: boolean;
  auto_backfill_authorized_at?: string | null;
  auto_backfill_cutoff?: string | null;
  auto_backfill_upper_bound?: string | null;
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
  reply_origin?: "unknown" | "automatic" | "manager" | "bulk" | "google";
  auto_reply_kind?: "new_positive" | "historical_14d" | null;
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

type ReputationAlert = {
  id: string; google_location_id: string; review_id: string | null;
  star_rating: number; review_excerpt: string | null; detected_at: string; status: string;
};
type Status = {
  google_configured: boolean;
  connections: Connection[];
  locations: Location[];
  reviews: Review[];
  hotels: Hotel[];
  events: ReplyEvent[];
  alerts?: ReputationAlert[]; open_alert_count?: number;
  reply_library?: { curated_base_variants: number; curated_ai_cost: number };
  stats?: {
    total: number; published: number; automatic: number; manager: number; bulk: number;
    imported: number; recent14: number; recentUnreplied: number; previous14: number;
    awaiting: number; attention: number; average: number | null;
  };
  location_summary?: Record<string, {
    total: number; published: number; automatic: number; bulk: number;
    recent14: number; recentUnreplied: number; ratings: number; stars: number; attention: number;
  }>;
};

type E2EState = {
  status: "idle" | "running" | "blocked" | "partial" | "passed";
  message: string;
};

type LocationEdit = Pick<
  Location,
  | "hotel_id"
  | "reply_brand_name"
  | "business_category"
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

const originLabel: Record<string, string> = {
  automatic: "Replied by HotelCare AI · automatic",
  manager: "Published by manager",
  bulk: "HotelCare AI · manager approved",
  google: "Existing Google reply",
  unknown: "Publication source unknown",
};

const eventLabel: Record<string, string> = {
  draft_generated: "AI draft generated",
  draft_edited: "Draft edited",
  approved: "Reply approved",
  published: "Published to Google",
  auto_published: "Automatically published by HotelCare AI",
  historical_auto_published: "HotelCare AI · 14-day historical catch-up",
  bulk_published: "Manager-approved bulk reply",
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
  const [customizingReviewId, setCustomizingReviewId] = useState<string | null>(null);
  const [locationEdits, setLocationEdits] = useState<Record<string, LocationEdit>>({});
  const [search, setSearch] = useState("");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("overview");
  const [publishedReviews, setPublishedReviews] = useState<Review[]>([]);
  const [publishedPage, setPublishedPage] = useState(0);
  const [publishedTotal, setPublishedTotal] = useState(0);
  const [publishedSource, setPublishedSource] = useState("all");
  const [publishedBusy, setPublishedBusy] = useState(false);
  const [locationFilter, setLocationFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [venueCategory, setVenueCategory] = useState("all");
  const [configVenueFilter, setConfigVenueFilter] = useState("all");
  const [consentLocationId, setConsentLocationId] = useState<string | null>(null);
  const [autoConsentIds, setAutoConsentIds] = useState<string[]>([]);
  const [recentReviews, setRecentReviews] = useState<Review[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [recentPage, setRecentPage] = useState(0);
  const [recentVenue, setRecentVenue] = useState("all");
  const [recentBusy, setRecentBusy] = useState(false);
  const [selectedRecentIds, setSelectedRecentIds] = useState<string[]>([]);
  const [recentDrafts, setRecentDrafts] = useState<Record<string, string>>({});
  const [bulkPreviewOpen, setBulkPreviewOpen] = useState(false);
  const [bulkConsent, setBulkConsent] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState("");
  const [historyVenue, setHistoryVenue] = useState("all");
  const [googleAccounts, setGoogleAccounts] = useState<Array<{ name: string; account_name?: string; type?: string; role?: string }> | null>(null);
  const [googleAccountsBusy, setGoogleAccountsBusy] = useState(false);
  const venueSelectionScope = useRef<string>("");
  const [allAutoDialogOpen, setAllAutoDialogOpen] = useState(false);
  const [allAutoVenueIds, setAllAutoVenueIds] = useState<string[]>([]);
  const [allAutoConsent, setAllAutoConsent] = useState(false);
  const [allAutoBusy, setAllAutoBusy] = useState(false);
  const [alertBusy, setAlertBusy] = useState<string | null>(null);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillVenueIds, setBackfillVenueIds] = useState<string[]>([]);
  const [backfillConsent, setBackfillConsent] = useState(false);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [publishedKind, setPublishedKind] = useState("all");

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
          reply_brand_name: location.reply_brand_name || location.google_location_title,
          business_category: location.business_category || "other",
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

  const loadPublished = async (page = 0, source = publishedSource, venue = historyVenue, kind = publishedKind) => {
    setPublishedBusy(true);
    try {
      const result = await invoke("list_published", { page, source, location_id: venue, kind });
      setPublishedReviews(result.reviews || []);
      setPublishedPage(page);
      setPublishedTotal(Number(result.total || 0));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load published reviews");
    } finally {
      setPublishedBusy(false);
    }
  };

  const loadRecent = async (page = 0, venue = recentVenue) => {
    setRecentBusy(true);
    try {
      const result = await invoke("list_recent", { page, location_id: venue });
      setRecentReviews(result.reviews || []);
      setRecentTotal(Number(result.total || 0));
      setRecentPage(page);
      setSelectedRecentIds([]);
      setRecentDrafts(Object.fromEntries((result.reviews || []).map((review: Review) => [review.id, review.ai_draft || ""])));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load recent Google reviews");
    } finally {
      setRecentBusy(false);
    }
  };

  const loadAccounts = async () => {
    setGoogleAccountsBusy(true);
    try {
      const result = await invoke("list_google_accounts");
      setGoogleAccounts(result.accounts || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not fetch connected Google accounts");
    } finally {
      setGoogleAccountsBusy(false);
    }
  };

  const load = async () => {
    if (!organizationSlug) return null;
    setBusy(true);
    try {
      const result = (await invoke("status")) as Status;
      setData(result);
      hydrateLocalState(result);
      if (activeTab === "published") void loadPublished(publishedPage, publishedSource, historyVenue);
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
      if (!discoveredLocations.length) {
        setSetupError(null);
        setE2E({ status: "partial", message: "Google account connected but no active Business Profile listings were discovered." });
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
    if (!profile || (!profile.is_super_admin && !ALLOWED.includes(profile.role) && !(organizationSlug === "rdhotels" && profile.role === "manager" && profile.organization_slug === "rdhotels"))) {
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

  useEffect(() => {
    if (!data?.locations?.length) return;
    const activeHotel = String(profile?.assigned_hotel || profile?.hotel_id || "").trim();
    if (!activeHotel) return;
    const scope = String(profile?.organization_slug || "") + ":" + activeHotel;
    if (venueSelectionScope.current === scope) return;
    venueSelectionScope.current = scope;
    const activeConfig = (data.hotels || []).find((hotel) =>
      hotel.hotel_id === activeHotel || hotel.hotel_name.toLowerCase() === activeHotel.toLowerCase());
    const matching = data.locations.find((location) => activeConfig &&
      location.hotel_id === activeConfig.hotel_id) ||
      data.locations.find((location) => location.hotel_id === activeHotel);
    // A direct alert link has stronger intent than the default active hotel.
    if (searchParams.get("venue")) return;
    const venueId = matching?.id || "all";
    setLocationFilter(venueId);
    setRecentVenue(venueId);
    setHistoryVenue(venueId);
  }, [data?.locations, data?.hotels, profile?.assigned_hotel, profile?.hotel_id,
      profile?.organization_slug, searchParams]);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    const venue = searchParams.get("venue");
    if (requestedTab === "attention") {
      setActiveTab("inbox");
      setRatingFilter("attention");
      setStatusFilter("all");
    } else if (requestedTab === "auto") {
      setActiveTab("published");
      setPublishedSource("automatic");
    }
    if (venue) {
      setLocationFilter(venue);
      setRecentVenue(venue);
      setHistoryVenue(venue);
    }
  }, [searchParams]);

  const acknowledgeAlert = async (id: string) => {
    setAlertBusy(id);
    try {
      await invoke("acknowledge_low_rating_alert", { alert_id: id });
      toast.success("Low-rating alert acknowledged");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not acknowledge alert");
    } finally {
      setAlertBusy(null);
    }
  };

  const authorizeBackfill = async () => {
    if (!backfillConsent || !backfillVenueIds.length) return;
    setBackfillBusy(true);
    try {
      const result = await invoke("authorize_historical_backfill", {
        location_ids: backfillVenueIds, confirm: true,
      });
      toast.success(`Historical 14-day catch-up authorized for ${result.venues?.length || 0} venues. HotelCare AI will process up to five qualifying replies per scheduled run.`);
      setBackfillOpen(false); setBackfillConsent(false); setBackfillVenueIds([]);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not authorize catch-up");
    } finally { setBackfillBusy(false); }
  };

  const cancelBackfill = async (locationId: string) => {
    setItemBusy(locationId);
    try {
      await invoke("cancel_historical_backfill", { location_ids: [locationId] });
      toast.info("Historical auto catch-up stopped for this venue.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not stop catch-up");
    } finally { setItemBusy(null); }
  };

  const enableAutoForSelectedVenues = async () => {
    if (!allAutoConsent || !allAutoVenueIds.length) return;
    setAllAutoBusy(true);
    try {
      const result = await invoke("activate_auto_venues", {
        location_ids: allAutoVenueIds,
        confirm: true,
      });
      toast.success(`Automatic 4–5-star replies authorized for ${result.activated?.length || 0} Google businesses`);
      setAllAutoDialogOpen(false);
      setAllAutoVenueIds([]);
      setAllAutoConsent(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not activate selected venues");
    } finally {
      setAllAutoBusy(false);
    }
  };

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

  const generateCustomizedReplies = async (reviewId: string, options: ReplyCustomizerOptions, previousDraft: string): Promise<string[]> => {
    const result = await invoke("customize_reply", {
      review_id: reviewId, options, previous_draft: previousDraft,
    });
    if (!Array.isArray(result.alternatives) || result.alternatives.length !== 3)
      throw new Error("The AI did not return three reply alternatives.");
    return result.alternatives;
  };

  const useCustomizedReply = async (reviewId: string, reply: string) => {
    await invoke("update_draft", { review_id: reviewId, reply });
    setDraftText((current) => ({ ...current, [reviewId]: reply }));
    toast.success("Custom reply saved as a draft. It has not been published to Google.");
    await load();
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
      await invoke("update_location_settings", {
        location_id: locationId, ...edit,
        auto_consent_confirmed: autoConsentIds.includes(locationId),
      });
      setAutoConsentIds((ids) => ids.filter((id) => id !== locationId));
      toast.success("Reputation rules saved");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save location rules");
    } finally {
      setItemBusy(null);
    }
  };

  const recentEligible = (review: Review) => {
    const created = new Date(review.review_create_time || "").getTime();
    return review.reply_status !== "published" && !review.google_reply_comment &&
      Number(review.star_rating) >= 4 && review.ai_risk_level === "low" &&
      Number.isFinite(created) && created >= Date.now() - 14 * 86_400_000 && created <= Date.now();
  };

  const toggleRecent = (reviewId: string, checked: boolean) => {
    setSelectedRecentIds((prev) => {
      if (!checked) return prev.filter((id) => id !== reviewId);
      if (prev.includes(reviewId)) return prev;
      if (prev.length >= 25) { toast.warning("Choose up to 25 reviews per approval batch."); return prev; }
      return [...prev, reviewId];
    });
  };

  const prepareBulk = async () => {
    if (!selectedRecentIds.length) return;
    setBulkBusy(true);
    setBulkConsent(false);
    setBulkProgress(`Preparing ${selectedRecentIds.length} varied replies from the curated library…`);
    try {
      const result = await invoke("prepare_bulk_replies", { review_ids: selectedRecentIds });
      const prepared: Array<{ id: string; draft: string }> = result.prepared || [];
      const rejected = result.rejected || [];
      if (rejected.length) toast.warning(`${rejected.length} reviews need individual attention and were excluded.`);
      if (!prepared.length) throw new Error("No safe replies could be prepared for this selection.");
      setRecentDrafts((current) => ({
        ...current, ...Object.fromEntries(prepared.map((entry) => [entry.id, entry.draft])),
      }));
      setSelectedRecentIds(prepared.map((entry) => entry.id));
      setBulkPreviewOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare selected replies");
    } finally {
      setBulkBusy(false);
      setBulkProgress("");
    }
  };

  const publishBulk = async () => {
    if (!bulkConsent || !selectedRecentIds.length || selectedRecentIds.length > 25) return;
    setBulkBusy(true);
    try {
      const result = await invoke("bulk_publish_replies", {
        confirm: true, items: selectedRecentIds.map((id) => ({ id, reply: recentDrafts[id] || "" })),
      });
      const successes = Number(result.published || 0);
      const failures = (result.outcomes || []).filter((entry: { status: string }) => entry.status !== "published").length;
      toast[failures ? "warning" : "success"](`${successes} replies published to Google${failures ? `; ${failures} skipped or failed — check individual results` : ""}.`);
      setBulkPreviewOpen(false);
      setBulkConsent(false);
      await loadRecent(0, recentVenue);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Batch publishing failed");
    } finally {
      setBulkBusy(false);
    }
  };

  const reviews = data?.reviews || [];
  const locations = data?.locations || [];
  const hotels = data?.hotels || [];
  const events = data?.events || [];
  const mapped = locations.filter((location) => location.hotel_id);
  const avg = reviews.length ? reviews.reduce((sum, review) => sum + Number(review.star_rating || 0), 0) / reviews.length : 0;
  const published = data?.stats?.published ?? reviews.filter((review) => review.reply_status === "published").length;
  const awaiting = data?.stats?.awaiting ?? reviews.filter((review) => review.reply_status !== "published").length;
  const urgent = data?.stats?.attention ?? reviews.filter((review) => review.reply_status !== "published" && review.star_rating <= 3).length;
  const autoReady = reviews.filter((review) => review.reply_status !== "published" && review.auto_reply_eligible).length;
  const totalTracked = data?.stats?.total ?? reviews.length;
  const googleTotal = locations.reduce((acc, location) => acc +
    (location.google_total_review_count ?? (data?.location_summary?.[location.id]?.total ?? 0)), 0);
  const rated = locations.filter((location) => Number(location.google_total_review_count || 0) > 0 && location.google_average_rating != null);
  const ratedCount = rated.reduce((sum, location) => sum + Number(location.google_total_review_count || 0), 0);
  const googleAverage = ratedCount ? rated.reduce((sum, location) =>
    sum + Number(location.google_average_rating || 0) * Number(location.google_total_review_count || 0), 0) / ratedCount : null;
  const allAvg = googleAverage ?? data?.stats?.average ?? avg;
  const summary = data?.location_summary || {};
  const categoryCounts = locations.reduce((result, location) => {
    const key = location.business_category || "other";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {} as Record<string, number>);
  const venueCategories = ["all", "hotel", "brunch", "restaurant", "conference", "museum", "other"];
  const visibleVenues = locations.filter((location) => venueCategory === "all" || location.business_category === venueCategory);
  const canBulkRecent = recentReviews.filter((review) => recentEligible(review));
  const selectedRecentReviews = selectedRecentIds.map((id) => recentReviews.find((review) => review.id === id)).filter((review): review is Review => Boolean(review));
  const responseRate = totalTracked ? Math.round((published / totalTracked) * 100) : 0;

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
      if (ratingFilter === "positive" && review.star_rating < 4) return false;
      if (ratingFilter === "attention" && review.star_rating > 3) return false;
      if (!["all", "positive", "attention"].includes(ratingFilter) && Number(ratingFilter) !== review.star_rating) return false;
      if (statusFilter !== "all" && review.reply_status !== statusFilter) return false;
      if (originFilter !== "all" && review.reply_origin !== originFilter) return false;
      if (locationFilter !== "all" && review.google_location_id !== locationFilter) return false;
      if (riskFilter !== "all" && String(review.ai_risk_level || "unknown") !== riskFilter) return false;
      if (!q) return true;
      return [review.reviewer_display_name, review.comment, review.ai_summary, locationNameById.get(review.google_location_id)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [reviews, search, ratingFilter, statusFilter, originFilter, locationFilter, riskFilter, locationNameById]);

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
                  <p className="text-sm text-muted-foreground mt-1">
                    {googleSetup.apiDisabled
                      ? "A required Google Business Profile service is not enabled in this Cloud project. Open the matching API in Google Cloud, click Enable, then retry location discovery. Your existing OAuth connection does not need to be changed."
                      : "Google is refusing the next API call. Review the technical details below and confirm this project's API permissions and account access."}
                  </p>
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

        {Boolean(data?.connections?.length) && !googleSetup.blocked && locations.length === 0 && (
          <Card className="border-blue-200">
            <CardContent className="pt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="font-medium">Google is connected — discover your business listings</p>
                <p className="text-sm text-muted-foreground mt-1">The connection is ready for a location check, but no Google locations have been imported yet. Discover listings, then map each one to its HotelCare property under Locations &amp; rules.</p>
              </div>
              <Button variant="outline" onClick={() => syncLocations()} disabled={busy}>
                <Download className="h-4 w-4 mr-2" />Discover Google locations
              </Button>
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

        {(data?.open_alert_count || 0) > 0 && (
          <Card className="border-amber-300">
            <CardContent className="pt-5 space-y-3">
              <div className="flex flex-wrap justify-between items-center gap-3">
                <div className="flex gap-2 items-start">
                  <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                  <div><div className="font-semibold">{data?.open_alert_count} new 1–3-star Google review alert(s)</div>
                    <p className="text-sm text-muted-foreground">These require a manager response. Low-rated or sensitive reviews are never auto-published.</p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => { setActiveTab("inbox"); setRatingFilter("attention"); setStatusFilter("all"); }}>Review low ratings</Button>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {(data?.alerts || []).slice(0, 6).map((alert) => <div key={alert.id} className="rounded-md border p-3 space-y-2">
                  <div className="text-sm font-medium">{alert.star_rating}★ · {locations.find((venue) => venue.id === alert.google_location_id)?.reply_brand_name || "Google business"}</div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{alert.review_excerpt || "Rating only — no written comment."}</p>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => {
                      setLocationFilter(alert.google_location_id); setRatingFilter("attention"); setActiveTab("inbox");
                    }}>Open</Button>
                    <Button size="sm" variant="ghost" disabled={alertBusy === alert.id} onClick={() => void acknowledgeAlert(alert.id)}>Acknowledge</Button>
                  </div>
                </div>)}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={activeTab} onValueChange={(value) => {
          setActiveTab(value);
          if (value === "automation") void loadRecent(0, recentVenue);
          if (value === "published") { void loadPublished(0, publishedSource, historyVenue); }
         }} className="space-y-4">
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="overview" className="gap-2"><BarChart3 className="h-4 w-4" />Overview</TabsTrigger>
            <TabsTrigger value="inbox" className="gap-2"><MessageSquareText className="h-4 w-4" />Review inbox{awaiting > 0 ? <Badge variant="secondary" className="ml-1">{awaiting}</Badge> : null}</TabsTrigger>
            <TabsTrigger value="automation" className="gap-2"><Zap className="h-4 w-4" />Automation center <Badge variant="secondary">{data?.stats?.recentUnreplied ?? 0}</Badge></TabsTrigger>
            <TabsTrigger value="locations" className="gap-2"><Settings2 className="h-4 w-4" />Venues & rules</TabsTrigger>
            <TabsTrigger value="published" className="gap-2"><Send className="h-4 w-4" />Published replies <Badge variant="secondary">{published}</Badge></TabsTrigger>
            <TabsTrigger value="audit" className="gap-2"><History className="h-4 w-4" />Audit trail</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              <Card><CardContent className="pt-5"><div className="text-xs text-muted-foreground">Reviews on Google</div><div className="text-3xl font-bold mt-2">{googleTotal.toLocaleString()}</div><div className="text-xs text-muted-foreground mt-1">{totalTracked.toLocaleString()} imported for management</div></CardContent></Card>
              <Card><CardContent className="pt-5"><div className="text-xs text-muted-foreground">Overall average rating</div><div className="flex items-center gap-2 mt-2"><span className="text-3xl font-bold">{googleTotal ? allAvg.toFixed(1) : "—"}</span><Star className="h-5 w-5" /></div></CardContent></Card>
              <Card><CardContent className="pt-5"><div className="text-xs text-muted-foreground">Reply rate · imported reviews</div><div className="text-3xl font-bold mt-2">{totalTracked ? `${responseRate}%` : "—"}</div></CardContent></Card>
              <Card><CardContent className="pt-5"><div className="text-xs text-muted-foreground">Awaiting · imported reviews</div><div className="text-3xl font-bold mt-2">{awaiting}</div></CardContent></Card>
              <Card className={urgent ? "border-amber-300" : ""}><CardContent className="pt-5"><div className="text-xs text-muted-foreground">1–3★ · imported reviews</div><div className="text-3xl font-bold mt-2">{urgent}</div></CardContent></Card>
              <Card><CardContent className="pt-5"><div className="text-xs text-muted-foreground">Replied by HotelCare AI</div><div className="text-3xl font-bold mt-2">{data?.stats?.automatic ?? 0}</div></CardContent></Card>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-lg flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Automation safety</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Google listings managed</span><span className="font-medium">{locations.length}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Standalone listings (no hotel required)</span><span className="font-medium">{locations.length - mapped.length}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Automatic publishing enabled</span><span className="font-medium">{locations.filter((location) => location.auto_reply_enabled).length} location(s)</span></div>
                  <div className="rounded-lg border bg-muted/30 p-3 flex gap-2"><ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" /><span>High-risk and 1–3-star reviews are always manager-controlled. Automatic replies need specific venue authorization.</span></div>
                  <div className="rounded-lg border p-3 flex items-center justify-between gap-3">
                    <div><div className="font-medium">Curated HotelCare reply library</div>
                      <p className="text-xs text-muted-foreground">{data?.reply_library?.curated_base_variants ?? 132}+ rating- and topic-aware variations, with personalized reviewer names and natural closings. Standard positive drafts use no AI tokens.</p>
                    </div>
                    <Badge variant="secondary">{data?.reply_library?.curated_base_variants ?? 132}+ replies</Badge>
                  </div>
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
                <div><div className="text-muted-foreground">Managed Google listings</div><div className="font-medium mt-1">{locations.length}</div></div>
              </CardContent>
            </Card>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">New reviews · past 14 days</p><div className="text-2xl font-semibold mt-1">{data?.stats?.recent14 ?? 0}</div><p className="text-xs text-muted-foreground mt-1">Previous 14 days: {data?.stats?.previous14 ?? 0}</p></CardContent></Card>
              <Card className="cursor-pointer hover:border-primary/40" onClick={() => { setActiveTab("automation"); void loadRecent(0, "all"); }}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Last 14 days · need reply</p><div className="text-2xl font-semibold mt-1">{data?.stats?.recentUnreplied ?? 0}</div><p className="text-xs text-primary mt-1">Review and approve responses</p></CardContent></Card>
              <Card className="cursor-pointer hover:border-primary/40" onClick={() => { setActiveTab("published"); setPublishedSource("automatic"); void loadPublished(0, "automatic", historyVenue); }}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Auto-published replies</p><div className="text-2xl font-semibold mt-1">{data?.stats?.automatic ?? 0}</div><p className="text-xs text-primary mt-1">View automatic reply history</p></CardContent></Card>
              <Card className="cursor-pointer hover:border-primary/40" onClick={() => { setActiveTab("published"); setPublishedSource("bulk"); void loadPublished(0, "bulk", historyVenue); }}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Bulk-approved replies</p><div className="text-2xl font-semibold mt-1">{data?.stats?.bulk ?? 0}</div><p className="text-xs text-primary mt-1">View manager-approved batches</p></CardContent></Card>
            </div>
            <Card>
              <CardHeader><div className="flex flex-wrap items-center justify-between gap-3">
                <div><CardTitle className="text-lg">Connected Google Business accounts</CardTitle><p className="text-sm text-muted-foreground mt-1">Signed-in Google connections and the Business Profile accounts accessible through them.</p></div>
                <Button variant="outline" size="sm" onClick={loadAccounts} disabled={googleAccountsBusy}>{googleAccountsBusy ? "Loading…" : "Load Google accounts"}</Button>
              </div></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {(data?.connections || []).map((connection) => <div key={connection.id} className="flex flex-wrap justify-between gap-2 rounded-md border p-3">
                  <div><div className="font-medium">{connection.google_account_email || connection.google_account_display_name || "Connected Google account"}</div>
                    <div className="text-xs text-muted-foreground mt-1">Connection status: {connection.status} · Last sync: {fmtDate(connection.last_sync_at)}</div>
                  </div><Badge variant="outline">{locations.length} linked business listings</Badge>
                </div>)}
                {googleAccounts === null ? <p className="text-xs text-muted-foreground">Select “Load Google accounts” to see the Google-side account names and access roles.</p> :
                  googleAccounts.length === 0 ? <p className="text-xs text-muted-foreground">No Google Business account details returned.</p> :
                    googleAccounts.map((account) => <div key={account.name} className="flex flex-wrap justify-between gap-2 rounded-md border px-3 py-2">
                      <div><span className="font-medium">{account.account_name || account.name}</span>
                        <span className="block text-xs text-muted-foreground">{account.name} · {account.type || "Business account"} · {account.role || "Role not returned"}</span>
                      </div>
                      <Badge variant="outline">{locations.filter((location) => location.google_account_name === account.name).length} locations</Badge>
                    </div>)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-lg">Performance by Google business</CardTitle><p className="text-sm text-muted-foreground">Click a venue to review its recent feedback and prepare replies.</p></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {venueCategories.map((category) => <Button key={category} size="sm" variant={venueCategory === category ? "default" : "outline"} onClick={() => { setVenueCategory(category); setConfigVenueFilter("all"); }}>
                    {category === "all" ? "All venues" : category.charAt(0).toUpperCase() + category.slice(1)} ({category === "all" ? locations.length : categoryCounts[category] || 0})
                  </Button>)}
                </div>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {visibleVenues.map((location) => {
                    const s = summary[location.id];
                    return <button type="button" key={location.id} className="text-left rounded-lg border p-4 space-y-3 hover:border-primary/50 hover:bg-muted/20 transition-colors"
                      onClick={() => { setRecentVenue(location.id); setActiveTab("automation"); void loadRecent(0, location.id); }}>
                      <div className="flex flex-wrap justify-between items-start gap-2">
                        <div className="font-semibold">{location.reply_brand_name || location.google_location_title}</div>
                        <Badge variant="secondary" className="capitalize">{location.business_category || "other"}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate" title={location.google_location_title}>{location.google_location_title}</div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div><div className="text-muted-foreground">Google reviews</div><div className="font-semibold text-base">{(location.google_total_review_count ?? s?.total ?? 0).toLocaleString()}</div><div className="text-[10px] text-muted-foreground">{s?.total ?? 0} imported</div></div>
                        <div><div className="text-muted-foreground">Google rating</div><div className="font-semibold text-base">{location.google_average_rating != null ? Number(location.google_average_rating).toFixed(1) : s?.ratings ? (s.stars / s.ratings).toFixed(1) : "—"}</div></div>
                        <div><div className="text-muted-foreground">14d pending</div><div className="font-semibold text-base">{s?.recentUnreplied ?? 0}</div></div>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2 text-xs">
                        <span className={location.auto_reply_enabled ? "text-emerald-700" : "text-muted-foreground"}>Auto replies: {location.auto_reply_enabled ? "Enabled" : "Off"}</span>
                        <span className="text-primary">Open reviews →</span>
                      </div>
                    </button>;
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="inbox" className="space-y-4">
            <Card>
              <CardContent className="pt-5">
                <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-3">
                  <div className="relative xl:col-span-2"><Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search guest, review or topic…" className="pl-9" /></div>
                  <Select value={ratingFilter} onValueChange={setRatingFilter}><SelectTrigger><SelectValue placeholder="Rating" /></SelectTrigger><SelectContent><SelectItem value="all">All ratings</SelectItem><SelectItem value="positive">4–5 stars · positive</SelectItem><SelectItem value="attention">1–3 stars · attention</SelectItem>{[5,4,3,2,1].map((value) => <SelectItem key={value} value={String(value)}>{value} stars</SelectItem>)}</SelectContent></Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="unreplied">Awaiting reply</SelectItem><SelectItem value="draft">Draft ready</SelectItem><SelectItem value="published">Published</SelectItem></SelectContent></Select>
                  <Select value={riskFilter} onValueChange={setRiskFilter}><SelectTrigger><SelectValue placeholder="Risk" /></SelectTrigger><SelectContent><SelectItem value="all">All risk levels</SelectItem><SelectItem value="low">Low risk</SelectItem><SelectItem value="medium">Review carefully</SelectItem><SelectItem value="high">High risk</SelectItem></SelectContent></Select>
                  <Select value={originFilter} onValueChange={setOriginFilter}><SelectTrigger><SelectValue placeholder="Reply source" /></SelectTrigger><SelectContent><SelectItem value="all">All reply sources</SelectItem><SelectItem value="automatic">Auto-published</SelectItem><SelectItem value="manager">Manager published</SelectItem><SelectItem value="bulk">Manager-approved batch</SelectItem><SelectItem value="google">Existing Google replies</SelectItem></SelectContent></Select>
                </div>
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {([
                      { id: "all", label: "All ratings" },
                      { id: "positive", label: "4–5★ positive" },
                      { id: "attention", label: "1–3★ attention" },
                      { id: "5", label: "5★" }, { id: "4", label: "4★" },
                      { id: "3", label: "3★" }, { id: "2", label: "2★" }, { id: "1", label: "1★" },
                    ]).map((item) => <Button key={item.id} size="sm" variant={ratingFilter === item.id ? "default" : "outline"}
                      onClick={() => setRatingFilter(item.id)}>{item.label}</Button>)}
                  </div>
                  <Select value={locationFilter} onValueChange={setLocationFilter}>
                    <SelectTrigger className="max-w-md"><SelectValue placeholder="Google business" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All connected businesses</SelectItem>
                      {locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.reply_brand_name || location.google_location_title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-wrap gap-2">
                    {locations.map((location) => <Button key={location.id} size="sm"
                      variant={locationFilter === location.id ? "default" : "outline"} onClick={() => setLocationFilter(location.id)}>
                      {location.reply_brand_name || location.google_location_title}</Button>)}
                    {locationFilter !== "all" && <Button size="sm" variant="ghost" onClick={() => setLocationFilter("all")}>Clear venue filter</Button>}
                  </div>
                  <p className="text-xs text-muted-foreground">{filteredReviews.length} matching recent inbox entries (last 250 imported) · venue and rating filters</p>
                </div>
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
                            {review.reply_status === "published" ? <><Badge className="bg-emerald-600">Published</Badge><Badge variant="outline">{originLabel[review.reply_origin || "unknown"]}</Badge></> : review.reply_status === "draft" ? <Badge variant="secondary">Draft ready</Badge> : <Badge variant="outline">Awaiting reply</Badge>}
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
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/10 p-3"><div className="flex flex-wrap gap-2 justify-between text-xs font-medium text-emerald-700 mb-2"><span>{originLabel[review.reply_origin || "unknown"]}</span><span>{fmtDate(review.google_reply_update_time || review.replied_at)}</span></div><div className="text-sm whitespace-pre-wrap">{review.google_reply_comment}</div></div>
                        ) : currentDraft ? (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 text-sm font-medium"><Bot className="h-4 w-4" />AI-assisted reply draft</div>
                            <Textarea value={currentDraft} onChange={(e) => setDraftText((current) => ({ ...current, [review.id]: e.target.value }))} rows={5} />
                            <div className="flex flex-wrap gap-2">
                              <Button variant="outline" onClick={() => saveDraft(review.id)} disabled={itemBusy === review.id}><Save className="h-4 w-4 mr-2" />Save draft</Button>
                              <Button variant="outline" onClick={() => setCustomizingReviewId(review.id)} disabled={itemBusy === review.id}><Sparkles className="h-4 w-4 mr-2" />Customize reply</Button>
                              <Button variant="outline" onClick={() => draft(review.id)} disabled={itemBusy === review.id}>Quick regenerate</Button>
                              <Button onClick={() => publish(review.id)} disabled={itemBusy === review.id || googleSetup.blocked}><Send className="h-4 w-4 mr-2" />{approvalRequired ? "Approve & publish" : "Publish to Google"}</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <Button onClick={() => setCustomizingReviewId(review.id)} disabled={itemBusy === review.id}><Sparkles className="h-4 w-4 mr-2" />Customize & draft reply</Button>
                            <Button variant="outline" onClick={() => draft(review.id)} disabled={itemBusy === review.id}>Quick draft</Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="published" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Send className="h-5 w-5" />Published Google review replies</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">See when each reply appeared and whether it was published automatically by HotelCare, by a manager in HotelCare, or was already present on Google. This history includes older replies outside the recent review inbox.</p>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {([
                    { key: "automatic", label: "HotelCare AI · automatic", count: data?.stats?.automatic ?? 0 },
                    { key: "bulk", label: "HotelCare AI · manager-approved", count: data?.stats?.bulk ?? 0 },
                    { key: "manager", label: "Published manually", count: data?.stats?.manager ?? 0 },
                    { key: "google", label: "Imported from Google", count: data?.stats?.imported ?? 0 },
                  ]).map((item) => <button type="button" key={item.key}
                    className={`text-left rounded-lg border p-3 hover:border-primary/40 ${publishedSource === item.key ? "border-primary bg-primary/5" : ""}`}
                    onClick={() => { setPublishedSource(item.key); void loadPublished(0, item.key, historyVenue); }}>
                    <p className="text-xs text-muted-foreground">{item.label}</p><p className="text-2xl font-semibold mt-1">{item.count}</p>
                  </button>)}
                </div>
                <div className="max-w-sm">
                  <Select value={publishedSource} onValueChange={(source) => { setPublishedSource(source); void loadPublished(0, source, historyVenue); }}>
                    <SelectTrigger><SelectValue placeholder="Published by" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All published replies</SelectItem>
                      <SelectItem value="automatic">Auto-published by HotelCare</SelectItem>
                      <SelectItem value="manager">Published by manager</SelectItem>
                      <SelectItem value="bulk">Bulk-approved by manager</SelectItem>
                      <SelectItem value="google">Existing Google replies</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {publishedSource === "automatic" && (
                  <div className="max-w-sm">
                    <Select value={publishedKind} onValueChange={(kind) => { setPublishedKind(kind); void loadPublished(0, publishedSource, historyVenue, kind); }}>
                      <SelectTrigger><SelectValue placeholder="Automatic reply type" /></SelectTrigger>
                      <SelectContent><SelectItem value="all">All HotelCare AI replies</SelectItem>
                        <SelectItem value="new_positive">New-review automation</SelectItem>
                        <SelectItem value="historical_14d">14-day catch-up automation</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="max-w-sm">
                  <Select value={historyVenue} onValueChange={(venue) => { setHistoryVenue(venue); void loadPublished(0, publishedSource, venue); }}>
                    <SelectTrigger><SelectValue placeholder="Google business" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All Google businesses</SelectItem>
                      {locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.reply_brand_name || location.google_location_title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
            {publishedBusy ? <Card><CardContent className="py-10 text-center text-muted-foreground">Loading published history…</CardContent></Card> :
              publishedReviews.length === 0 ? <Card><CardContent className="py-10 text-center text-muted-foreground">No published replies for this filter.</CardContent></Card> : (
                <div className="space-y-3">
                  {publishedReviews.map((review) => {
                    const location = locationById.get(review.google_location_id);
                    return <Card key={review.id}>
                      <CardContent className="pt-5 space-y-3">
                        <div className="flex flex-col sm:flex-row justify-between gap-3">
                          <div><div className="font-semibold">{review.reviewer_display_name || "Google guest"}</div>
                            <div className="text-xs text-muted-foreground mt-1">{location?.reply_brand_name || location?.google_location_title || "Google Business listing"} · {fmtDate(review.review_update_time)}</div>
                            <div className="mt-2">{stars(review.star_rating)}</div>
                          </div>
                          <div className="flex flex-wrap items-start gap-2">
                            <Badge variant={review.reply_origin === "automatic" ? "default" : "outline"}>
                              {review.reply_origin === "automatic" && review.auto_reply_kind === "historical_14d"
                                ? "Replied by HotelCare AI · 14-day catch-up"
                                : originLabel[review.reply_origin || "unknown"]}
                            </Badge>
                            <Badge variant="secondary">{fmtDate(review.google_reply_update_time || review.replied_at)}</Badge>
                          </div>
                        </div>
                        <div className="text-sm rounded-md bg-muted/40 p-3 whitespace-pre-wrap">{review.comment || <span className="text-muted-foreground">Rating only — no written comment</span>}</div>
                        <div className="text-sm rounded-md border border-emerald-200 p-3 whitespace-pre-wrap">
                          <div className="text-xs font-semibold text-emerald-700 mb-2">Published reply</div>
                          {review.google_reply_comment || "Google reply text unavailable"}
                        </div>
                      </CardContent>
                    </Card>;
                  })}
                </div>
              )
            }
            <div className="flex flex-wrap justify-between items-center gap-3">
              <p className="text-sm text-muted-foreground">{publishedTotal} matching published replies · Page {publishedPage + 1} of {Math.max(1, Math.ceil(publishedTotal / 50))}</p>
              <div className="flex gap-2">
                <Button variant="outline" disabled={publishedBusy || publishedPage <= 0} onClick={() => void loadPublished(publishedPage - 1, publishedSource)}>Newer</Button>
                <Button variant="outline" disabled={publishedBusy || (publishedPage + 1) * 50 >= publishedTotal} onClick={() => void loadPublished(publishedPage + 1, publishedSource)}>Older</Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="automation" className="space-y-4">
            <Card>
              <CardHeader><div className="flex flex-wrap justify-between items-center gap-3">
                <CardTitle className="flex items-center gap-2 text-lg"><Zap className="h-5 w-5" />Recent review automation · last 14 days</CardTitle>
                <Button onClick={() => { setBackfillVenueIds(recentVenue === "all" ? [] : [recentVenue]); setBackfillConsent(false); setBackfillOpen(true); }}>
                  <Zap className="h-4 w-4 mr-2" />Authorize 14-day AI auto catch-up
                </Button>
              </div></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Select up to 25 recent 4–5★ low-risk reviews. HotelCare prepares diverse, venue-specific responses from its curated library at no AI token cost. Review and edit each draft, then expressly approve the batch. Nothing publishes when a review is merely selected. Older or sensitive reviews require individual approval in the inbox.</p>
                <div className="flex flex-col sm:flex-row gap-3 sm:items-end justify-between">
                  <div className="w-full sm:max-w-md space-y-2"><Label>Google business</Label>
                    <Select value={recentVenue} onValueChange={(value) => { setRecentVenue(value); void loadRecent(0, value); }}>
                      <SelectTrigger><SelectValue placeholder="All Google venues" /></SelectTrigger>
                      <SelectContent><SelectItem value="all">All connected venues</SelectItem>{locations.map((location) =>
                        <SelectItem key={location.id} value={location.id}>{location.reply_brand_name || location.google_location_title}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button variant="outline" disabled={recentBusy} onClick={() => void loadRecent(0, recentVenue)}><RefreshCw className="h-4 w-4 mr-2" />Refresh recent</Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{recentTotal} reviews in last 14 days</Badge>
                  <Badge variant="outline">{canBulkRecent.length} eligible on this page</Badge>
                  <Badge variant="outline">{selectedRecentIds.length} selected</Badge>
                  <Button size="sm" variant="outline" disabled={recentBusy || !canBulkRecent.length}
                    onClick={() => setSelectedRecentIds(canBulkRecent.slice(0, 25).map((review) => review.id))}>Select up to 25 eligible</Button>
                  <Button size="sm" variant="outline" disabled={recentBusy || !canBulkRecent.length} onClick={() => setSelectedRecentIds(canBulkRecent.filter((review) => review.star_rating === 5).slice(0, 25).map((review) => review.id))}>Select 5★ only</Button>
                  <Button size="sm" variant="outline" disabled={recentBusy || !canBulkRecent.length} onClick={() => setSelectedRecentIds(canBulkRecent.filter((review) => review.star_rating === 4).slice(0, 25).map((review) => review.id))}>Select 4★ only</Button>
                  <Button size="sm" variant="ghost" disabled={!selectedRecentIds.length} onClick={() => setSelectedRecentIds([])}>Deselect all</Button>
                  <Button size="sm" disabled={bulkBusy || !selectedRecentIds.length} onClick={() => void prepareBulk()}>
                    <Sparkles className="h-4 w-4 mr-2" />Prepare {selectedRecentIds.length || ""} replies
                  </Button>
                </div>
                {bulkBusy && bulkProgress && <p role="status" className="text-sm text-muted-foreground">{bulkProgress}</p>}
              </CardContent>
            </Card>
            {recentBusy ? <Card><CardContent className="py-10 text-center text-muted-foreground">Loading recent reviews…</CardContent></Card> :
              recentReviews.length === 0 ? <Card><CardContent className="py-10 text-center text-muted-foreground">No reviews in this 14-day window for the selected venue.</CardContent></Card> :
              <div className="space-y-3">{recentReviews.map((review) => {
                const venue = locationById.get(review.google_location_id);
                const eligible = recentEligible(review);
                return <Card key={review.id} className={selectedRecentIds.includes(review.id) ? "border-primary" : ""}>
                  <CardContent className="pt-5 flex gap-3">
                    <Checkbox checked={selectedRecentIds.includes(review.id)} disabled={!eligible}
                      onCheckedChange={(checked) => toggleRecent(review.id, checked === true)}
                      aria-label={`Select review from ${review.reviewer_display_name || "guest"}`} className="mt-1" />
                    <div className="space-y-3 min-w-0 flex-1">
                      <div className="flex flex-wrap justify-between gap-3">
                        <div><div className="font-semibold">{review.reviewer_display_name || "Google guest"}</div>
                          <div className="text-xs text-muted-foreground mt-1">{venue?.reply_brand_name || venue?.google_location_title || "Google business"} · {fmtDate(review.review_create_time)}</div>
                          <div className="mt-2">{stars(review.star_rating)}</div>
                        </div>
                        <div className="flex flex-wrap gap-2 items-start">
                          {riskBadge(review.ai_risk_level)}
                          <Badge variant={eligible ? "outline" : "secondary"}>{review.reply_status === "published" ? "Already replied" : eligible ? "Eligible for selection" : "Individual review needed"}</Badge>
                        </div>
                      </div>
                      <p className="text-sm rounded-md bg-muted/40 p-3 whitespace-pre-wrap">{review.comment || "Rating only — no written comment."}</p>
                      {recentDrafts[review.id] && <div className="text-xs rounded-md border p-3"><span className="font-semibold">Current draft: </span>{recentDrafts[review.id]}</div>}
                      {!eligible && review.reply_status !== "published" && <p className="text-xs text-amber-700">This review is not safe for bulk publishing. Reply individually in the Review inbox.</p>}
                    </div>
                  </CardContent>
                </Card>;
              })}</div>
            }
            <div className="flex justify-between items-center flex-wrap gap-2 text-sm">
              <span className="text-muted-foreground">{recentTotal} recent reviews · Page {recentPage + 1} of {Math.max(1, Math.ceil(recentTotal / 100))}</span>
              <div className="flex gap-2">
                <Button variant="outline" disabled={recentBusy || recentPage === 0} onClick={() => void loadRecent(recentPage - 1, recentVenue)}>Newer</Button>
                <Button variant="outline" disabled={recentBusy || (recentPage + 1) * 100 >= recentTotal} onClick={() => void loadRecent(recentPage + 1, recentVenue)}>Older</Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="locations" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Building2 className="h-5 w-5" />Google Business locations</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => syncLocations()} disabled={busy || googleSetup.quotaPending}><Download className="h-4 w-4 mr-2" />Discover / refresh locations</Button>
                  <Button variant="outline" onClick={runE2ECheck} disabled={busy}><Activity className="h-4 w-4 mr-2" />Test connection</Button>
                  <Button disabled={!locations.length} onClick={() => {
                    setAllAutoVenueIds(locations.filter((venue) => !venue.auto_reply_enabled).map((venue) => venue.id));
                    setAllAutoConsent(false); setAllAutoDialogOpen(true);
                  }}><Zap className="h-4 w-4 mr-2" />Enable 4–5★ auto replies for venues</Button>
                </div>
                <p className="text-sm text-muted-foreground">Manage every Google listing independently, including brunches, restaurants, museums and conferences. HotelCare property linkage is optional; standalone businesses do not require hotel accounts.</p>
              </CardContent>
            </Card>

            <Card><CardContent className="pt-4 space-y-3">
              <div className="text-sm font-medium">Find venue settings quickly</div>
              <div className="flex flex-wrap gap-2">
                {venueCategories.map((category) => <Button key={category} size="sm" variant={venueCategory === category ? "default" : "outline"} onClick={() => { setVenueCategory(category); setConfigVenueFilter("all"); }}>
                  {category === "all" ? "All venues" : category.charAt(0).toUpperCase() + category.slice(1)} ({category === "all" ? locations.length : categoryCounts[category] || 0})
                </Button>)}
              </div>
              <Select value={configVenueFilter} onValueChange={(value) => { setConfigVenueFilter(value); if (value !== "all") setVenueCategory("all"); }}>
                <SelectTrigger className="max-w-md"><SelectValue placeholder="Select a specific Google listing" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All locations</SelectItem>
                  {locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.reply_brand_name || location.google_location_title}</SelectItem>)}
                </SelectContent>
              </Select>
            </CardContent></Card>
            {locations.length === 0 ? (
              <Card><CardContent className="py-14 text-center text-muted-foreground">{googleSetup.quotaPending ? "Google location discovery is waiting for API approval." : "No Google Business locations discovered yet."}</CardContent></Card>
            ) : visibleVenues.filter((location) => configVenueFilter === "all" || location.id === configVenueFilter).map((location) => {
              const edit = locationEdits[location.id];
              if (!edit) return null;
              return (
                <Card key={location.id}>
                  <CardHeader className="pb-3"><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><CardTitle className="text-lg">{location.google_location_title}</CardTitle><p className="text-xs text-muted-foreground mt-1">{location.hotel_id ? `Linked to ${hotels.find((hotel) => hotel.hotel_id === location.hotel_id)?.hotel_name || location.hotel_id}` : "Managed independently — no hotel needed"}</p></div><div className="flex flex-wrap gap-2">
                      <Badge variant={edit.auto_reply_enabled ? "default" : "outline"}>{edit.auto_reply_enabled ? "Future auto replies enabled" : "Manual approval mode"}</Badge>
                      {location.auto_backfill_active && <Badge variant="secondary">14-day auto catch-up active</Badge>}
                    </div></div></CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Business name for replies</Label><Input value={edit.reply_brand_name || ""} onChange={(e) => setLocationEdits((current) => ({ ...current, [location.id]: { ...edit, reply_brand_name: e.target.value } }))} placeholder="e.g. Hotel Memories Budapest" /><p className="text-xs text-muted-foreground">AI uses this identity, not the full Google listing title.</p></div>
                      <div className="space-y-2"><Label>Venue category</Label><Select value={edit.business_category || "other"} onValueChange={(value: Location["business_category"]) => setLocationEdits((current) => ({ ...current, [location.id]: { ...edit, business_category: value } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["hotel","brunch","restaurant","conference","museum","other"].map((value) => <SelectItem key={value} value={value}>{value.charAt(0).toUpperCase()+value.slice(1)}</SelectItem>)}</SelectContent></Select></div>
                    </div>
                    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
                      <div className="space-y-2"><Label>HotelCare property (optional)</Label><Select value={edit.hotel_id || "unmapped"} onValueChange={(value) => setLocationEdits((current) => ({ ...current, [location.id]: { ...edit, hotel_id: value === "unmapped" ? null : value } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unmapped">Independent Google business</SelectItem>{hotels.filter((hotel) => hotel.is_active !== false).map((hotel) => <SelectItem key={hotel.hotel_id} value={hotel.hotel_id}>{hotel.hotel_name}</SelectItem>)}</SelectContent></Select></div>
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
                      <div className="rounded-lg border p-3 flex items-center justify-between gap-4"><div><div className="font-medium text-sm">Automatic publishing</div><div className="text-xs text-muted-foreground mt-1">Enable for this venue, including independent brunches. Requires explicit approval. Future 4–5★ low-risk reviews only.</div></div><Switch checked={edit.auto_reply_enabled} onCheckedChange={(checked) => {
                        if (checked && !location.auto_reply_enabled) { setConsentLocationId(location.id); return; }
                        setLocationEdits((current) => ({ ...current, [location.id]: { ...edit,
                          auto_reply_enabled: checked,
                          reply_mode: checked && edit.reply_mode === "draft_only" ? "auto_positive" : edit.reply_mode } }));
                      }} /></div>
                    </div>

                    <div className="space-y-2"><Label>Property context for AI</Label><Textarea rows={3} value={edit.brand_context || ""} onChange={(e) => setLocationEdits((current) => ({ ...current, [location.id]: { ...edit, brand_context: e.target.value } }))} placeholder="Optional factual context: breakfast hours, positioning, service style, contact instructions. The AI is told never to invent information." /></div>

                    <div className="rounded-lg bg-muted/40 p-3 text-sm flex gap-2"><ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" /><span>Recommended starting policy: 4–5★ may become eligible for automatic replies after testing; 1–3★ and any high-risk complaint remain manager-controlled.</span></div>
                    {edit.auto_reply_enabled && !location.auto_reply_enabled && (
                      <p className="text-xs text-amber-700">Automation is not live until you save these rules. It will apply to new reviews only.</p>
                    )}
                    {location.auto_backfill_active && (
                      <div className="flex flex-wrap justify-between gap-2 items-center rounded-md border p-3 text-sm">
                        <span>Historical 14-day catch-up authorized {fmtDate(location.auto_backfill_authorized_at)}. Only suitable 4–5★ reviews received before authorization are considered.</span>
                        <Button size="sm" variant="outline" disabled={itemBusy === location.id} onClick={() => void cancelBackfill(location.id)}>Stop catch-up</Button>
                      </div>
                    )}
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
        <Dialog open={backfillOpen} onOpenChange={(open) => { if (!backfillBusy) { setBackfillOpen(open); if (!open) setBackfillConsent(false); } }}>
          <DialogContent className="max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>Authorize 14-day HotelCare AI catch-up</DialogTitle>
              <DialogDescription>
                This is a separate, one-time authorization for replies to reviews from the previous 14 days.
                HotelCare will publish only low-risk 4–5★ replies on the businesses you select.
                Maximum 5 historical replies per scheduled run; the authorization expires after 48 hours.
                It does not enable ongoing automation for future reviews.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => {
                setBackfillVenueIds(locations.map((v) => v.id)); setBackfillConsent(false);
              }}>Select all {locations.length}</Button>
              <Button variant="outline" size="sm" onClick={() => {
                setBackfillVenueIds([]); setBackfillConsent(false);
              }}>Deselect all</Button>
              <Badge variant="secondary">{backfillVenueIds.length} businesses</Badge>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto space-y-2">
              {locations.map((venue) => <label key={venue.id} className="flex gap-3 p-3 rounded-lg border cursor-pointer">
                <Checkbox checked={backfillVenueIds.includes(venue.id)} onCheckedChange={(value) => {
                  setBackfillVenueIds((current) => value ?
                    Array.from(new Set([...current, venue.id])) : current.filter((id) => id !== venue.id));
                  setBackfillConsent(false);
                }} />
                <div className="flex-1">
                  <div className="font-medium text-sm">{venue.reply_brand_name || venue.google_location_title}</div>
                  <p className="text-xs text-muted-foreground">{summary[venue.id]?.recentUnreplied || 0} unreplied reviews received in the last 14 days · only low-risk 4–5★ will qualify</p>
                  {venue.auto_backfill_active && <Badge variant="secondary" className="mt-1">Catch-up already authorized</Badge>}
                </div>
              </label>)}
              <label className="flex items-start gap-3 p-3 rounded-lg border border-amber-300 cursor-pointer">
                <Checkbox checked={backfillConsent} onCheckedChange={(value) => setBackfillConsent(value === true)} className="mt-1" />
                <span className="text-sm">I explicitly authorize public HotelCare AI replies for eligible unanswered reviews dated within the previous 14 days on these {backfillVenueIds.length} named businesses. I understand HotelCare will publish without an individual preview, at a controlled rate, and that I can stop the catch-up from Venues & rules.</span>
              </label>
            </div>
            <DialogFooter className="shrink-0 gap-2">
              <Button variant="outline" disabled={backfillBusy} onClick={() => setBackfillOpen(false)}>Cancel</Button>
              <Button disabled={!backfillConsent || !backfillVenueIds.length || backfillBusy} onClick={() => void authorizeBackfill()}>
                <Zap className="h-4 w-4 mr-2" />{backfillBusy ? "Authorizing…" : `Authorize ${backfillVenueIds.length} businesses`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={allAutoDialogOpen} onOpenChange={(open) => { if (!allAutoBusy) { setAllAutoDialogOpen(open); if (!open) setAllAutoConsent(false); } }}>
          <DialogContent className="max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
            <DialogHeader><DialogTitle>Activate HotelCare AI auto replies</DialogTitle>
              <DialogDescription>Choose the specific Google Business Profiles you authorize. These rules apply only to NEW low-risk 4–5-star reviews, after the venue's delay. Historical reviews need separate batch approval in Automation center.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => { setAllAutoVenueIds(locations.filter((l) => !l.auto_reply_enabled).map((l) => l.id)); setAllAutoConsent(false); }}>Select venues not yet enabled</Button>
              <Button variant="outline" size="sm" onClick={() => { setAllAutoVenueIds(locations.map((l) => l.id)); setAllAutoConsent(false); }}>Select all {locations.length}</Button>
              <Button variant="ghost" size="sm" onClick={() => { setAllAutoVenueIds([]); setAllAutoConsent(false); }}>Deselect all</Button>
              <Badge variant="secondary">{allAutoVenueIds.length} selected</Badge>
            </div>
            <div className="overflow-y-auto min-h-0 flex-1 space-y-2">
              {locations.map((venue) => <label key={venue.id} className="flex gap-3 rounded-lg border p-3 cursor-pointer">
                <Checkbox checked={allAutoVenueIds.includes(venue.id)} onCheckedChange={(checked) => {
                  setAllAutoVenueIds((prev) => checked ? Array.from(new Set([...prev, venue.id])) : prev.filter((id) => id !== venue.id));
                  setAllAutoConsent(false);
                }} />
                <div><div className="font-medium text-sm">{venue.reply_brand_name || venue.google_location_title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{venue.business_category || "Other"} · {venue.auto_reply_enabled ? "Already enabled" : "Currently manual"} · 4–5★ low-risk only</div>
                </div>
              </label>)}
              <label className="flex items-start gap-2 rounded-lg border border-primary/30 p-3 text-sm cursor-pointer">
                <Checkbox checked={allAutoConsent} onCheckedChange={(checked) => setAllAutoConsent(checked === true)} />
                <span>I expressly authorize HotelCare to automatically publish suitable, varied replies to new 4–5-star reviews on these {allAutoVenueIds.length} specifically selected businesses. I understand replies will be public and I can disable automation per business.</span>
              </label>
            </div>
            <DialogFooter className="shrink-0 gap-2">
              <Button variant="outline" disabled={allAutoBusy} onClick={() => setAllAutoDialogOpen(false)}>Cancel</Button>
              <Button disabled={!allAutoConsent || !allAutoVenueIds.length || allAutoBusy} onClick={() => void enableAutoForSelectedVenues()}>
                <Zap className="h-4 w-4 mr-2" />{allAutoBusy ? "Activating…" : `Authorize ${allAutoVenueIds.length} venues`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={Boolean(consentLocationId)} onOpenChange={(open) => { if (!open) setConsentLocationId(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Authorize automatic Google replies for this business?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block font-medium text-foreground">
                  {locations.find((location) => location.id === consentLocationId)?.reply_brand_name || "Selected Google business"}
                </span>
                <span className="block">When you save these settings, HotelCare may automatically publish replies to NEW 4–5★ low-risk reviews for this specific listing, after the configured delay. Negative and high-risk reviews remain manager-controlled.</span>
                <span className="block">Reviews from the previous 14 days are not published automatically by this switch; use Automation center to select and approve those separately. You can disable future automatic publishing at any time.</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep manual approval</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                if (!consentLocationId) return;
                const id = consentLocationId;
                setLocationEdits((current) => {
                  const edit = current[id];
                  return edit ? { ...current, [id]: { ...edit, auto_reply_enabled: true,
                    reply_mode: edit.reply_mode === "draft_only" ? "auto_positive" : edit.reply_mode,
                    min_auto_rating: Math.max(4, edit.min_auto_rating),
                    require_approval_below_rating: Math.max(4, edit.require_approval_below_rating) } } : current;
                });
                setAutoConsentIds((ids) => Array.from(new Set([...ids, id])));
                setConsentLocationId(null);
                toast.info("Authorization noted. Click Save location rules to enable automation.");
              }}>Authorize for this business</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <ReplyCustomizerDialog
          open={Boolean(customizingReviewId)}
          onOpenChange={(open) => { if (!open) setCustomizingReviewId(null); }}
          review={customizingReviewId ? (reviewById.get(customizingReviewId) || null) : null}
          venueName={customizingReviewId
            ? (locationById.get(reviewById.get(customizingReviewId)?.google_location_id || "")?.reply_brand_name ||
               locationById.get(reviewById.get(customizingReviewId)?.google_location_id || "")?.google_location_title || "Google business")
            : "Google business"}
          currentDraft={customizingReviewId ? (draftText[customizingReviewId] || "") : ""}
          onGenerate={generateCustomizedReplies}
          onSave={useCustomizedReply}
        />

        <Dialog open={bulkPreviewOpen} onOpenChange={(open) => { if (!bulkBusy) { setBulkPreviewOpen(open); if (!open) setBulkConsent(false); } }}>
          <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>Review and approve {selectedRecentReviews.length} Google replies</DialogTitle>
              <DialogDescription>Check each reply, business identity and star rating. Editing here changes only this batch. Replies are sent to Google only after your explicit confirmation.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 overflow-y-auto min-h-0 flex-1 pr-2">
              {selectedRecentReviews.map((review) => {
                const venue = locationById.get(review.google_location_id);
                return <div key={review.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex flex-wrap justify-between gap-2">
                    <div className="font-semibold text-sm">{venue?.reply_brand_name || venue?.google_location_title || "Google business"} · {review.reviewer_display_name || "Google guest"}</div>
                    <div>{stars(review.star_rating)}</div>
                  </div>
                  <p className="text-xs text-muted-foreground">Received {fmtDate(review.review_create_time)}</p>
                  <div className="text-sm rounded-md bg-muted/40 p-2 whitespace-pre-wrap">{review.comment || "Rating only — no written comment"}</div>
                  <Label htmlFor={`bulk-draft-${review.id}`}>Reply to publish</Label>
                  <Textarea id={`bulk-draft-${review.id}`} rows={3} maxLength={1500}
                    value={recentDrafts[review.id] || ""}
                    onChange={(event) => { setRecentDrafts((current) => ({ ...current, [review.id]: event.target.value })); setBulkConsent(false); }} />
                </div>;
              })}
              <label className="flex gap-3 items-start rounded-lg border bg-muted/30 p-3 text-sm cursor-pointer">
                <Checkbox checked={bulkConsent} onCheckedChange={(value) => setBulkConsent(value === true)} className="mt-0.5" />
                <span>I have reviewed each reply and explicitly authorize publishing these {selectedRecentReviews.length} replies to their respective Google Business Profiles. I understand these are public replies.</span>
              </label>
            </div>
            <DialogFooter className="mt-3 shrink-0">
              <Button variant="outline" disabled={bulkBusy} onClick={() => { setBulkPreviewOpen(false); setBulkConsent(false); }}>Cancel</Button>
              <Button disabled={!bulkConsent || bulkBusy || selectedRecentReviews.length === 0 || selectedRecentReviews.some((review) => !(recentDrafts[review.id] || "").trim())} onClick={() => void publishBulk()}>
                <Send className="h-4 w-4 mr-2" />{bulkBusy ? "Publishing…" : `Publish ${selectedRecentReviews.length} reviewed replies`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
