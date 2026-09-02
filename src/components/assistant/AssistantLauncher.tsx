import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Flag, MessageCircleQuestion, Pencil, Plus, ShieldQuestion, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useAssistant } from "@/hooks/useAssistant";
import AssistantChat from "./AssistantChat";
import AssistantAccessRequests, { canApproveAssistantAccess } from "./AssistantAccessRequests";
import ReportProblemDialog from "./ReportProblemDialog";
import { canUseAssistant } from "@/lib/assistantAccess";
import { isAssistantDebugEnabled, setAssistantDebug } from "@/lib/assistant/debugMode";
import {
  forgetActiveAssistantThread,
  getRememberedAssistantThread,
  rememberActiveAssistantThread,
} from "@/lib/assistant/activeThread";
import { cn } from "@/lib/utils";
import hotelCareMark from "@/assets/hotelcare-logo-mark.png";

/** Floating assistant available on every authenticated page. */
export default function AssistantLauncher() {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("chat");
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);
  const [debugOn, setDebugOn] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const threadId = params.get("assistant");
  const { threads, loadingThreads, createThread, renameThread, deleteThread, loadThreads } =
    useAssistant(threadId);

  const userId = user?.id ?? null;
  const organizationSlug = profile?.organization_slug ?? null;

  // Keep the user's selected conversation active for 24 hours, even when normal
  // app navigation drops the assistant query parameter. Restoring it in the
  // background also lets messages preload before the panel is opened.
  useEffect(() => {
    if (!userId || !organizationSlug) return;
    if (threadId) {
      rememberActiveAssistantThread(userId, organizationSlug, threadId);
      return;
    }
    const remembered = getRememberedAssistantThread(userId, organizationSlug);
    if (!remembered) return;
    const next = new URLSearchParams(params);
    next.set("assistant", remembered);
    setParams(next, { replace: true });
  }, [organizationSlug, params, setParams, threadId, userId]);

  useEffect(() => {
    setDebugOn(isAssistantDebugEnabled(profile?.role));
  }, [profile?.role, open]);

  useLayoutEffect(() => {
    if (!open || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const keyboardOpen = window.innerHeight - vv.height > 120;
      setViewport(
        keyboardOpen ? { height: Math.round(vv.height), top: Math.round(vv.offsetTop) } : null,
      );
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const setThread = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params);
      if (id) {
        next.set("assistant", id);
        rememberActiveAssistantThread(userId, organizationSlug, id);
      } else {
        next.delete("assistant");
        forgetActiveAssistantThread(userId, organizationSlug);
      }
      setParams(next, { replace: true });
    },
    [organizationSlug, params, setParams, userId],
  );

  const newThread = useCallback(async () => {
    const id = await createThread();
    if (id) {
      setThread(id);
      setTab("chat");
    }
    return id;
  }, [createThread, setThread]);

  const markThreadActive = useCallback(() => {
    if (threadId) rememberActiveAssistantThread(userId, organizationSlug, threadId);
    void loadThreads();
  }, [loadThreads, organizationSlug, threadId, userId]);

  const openAssistant = useCallback(() => {
    if (threadId) rememberActiveAssistantThread(userId, organizationSlug, threadId);
    setTab("chat");
    setOpen(true);
  }, [organizationSlug, threadId, userId]);

  if (!user || !profile?.organization_slug) return null;
  if (!canUseAssistant(profile)) return null;
  if (location.pathname.startsWith("/bb") || location.pathname.startsWith("/auth")) return null;

  const isApprover = canApproveAssistantAccess(profile.role);

  return (
    <>
      <Button
        onPointerDown={(event) => {
          if (event.button === 0) setOpen(true);
        }}
        onClick={openAssistant}
        className={cn(
          "fixed z-40 rounded-full shadow-lg gap-2 h-14 min-h-14 min-w-14 px-0 sm:px-4",
          "bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4",
          "touch-manipulation select-none cursor-pointer active:scale-[0.98] duration-75",
        )}
        aria-label="Open the Hotel Care Assistant"
      >
        <span className="pointer-events-none flex h-10 w-10 items-center justify-center rounded-full bg-background shadow-sm">
          <img src={hotelCareMark} alt="" className="pointer-events-none h-7 w-7" />
        </span>
        <span className="pointer-events-none hidden sm:inline">Ask</span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          style={
            viewport
              ? {
                  top: `${viewport.top}px`,
                  bottom: "auto",
                  height: `${viewport.height}px`,
                  maxHeight: `${viewport.height}px`,
                  paddingTop: "0.75rem",
                  paddingBottom: 0,
                }
              : undefined
          }
          className="w-full sm:max-w-[480px] p-3 flex flex-col gap-2 h-[100dvh] max-h-[100dvh] overflow-hidden
                     pt-[max(0.75rem,env(safe-area-inset-top))] pb-0
                     duration-150 data-[state=open]:duration-150"
        >
          <SheetTitle className="sr-only">Hotel Care Assistant</SheetTitle>
          <SheetDescription className="sr-only">Role-aware assistant for Hotel Care</SheetDescription>
          <div className="flex items-center gap-2 pr-10 pt-1">
            <div className="flex items-center gap-2">
              <img src={hotelCareMark} alt="Hotel Care" className="h-8 w-8 rounded-lg" />
              <div className="leading-tight">
                <p className="text-sm font-semibold">Hotel Care Assistant</p>
                <p className="text-[11px] text-muted-foreground">Ask anything about your work</p>
              </div>
            </div>
            <button
              type="button"
              className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
              onClick={() => setReportOpen(true)}
            >
              <Flag className="h-3.5 w-3.5" /> Report
            </button>
            {profile.role === "admin" && (
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent"
                onClick={() => {
                  const next = !isAssistantDebugEnabled(profile.role);
                  setAssistantDebug(next);
                  setDebugOn(next);
                }}
              >
                {debugOn ? "Debug on" : "Debug off"}
              </button>
            )}
          </div>

          <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col">
            <TabsList className="w-full">
              <TabsTrigger value="chat" className="flex-1">Chat</TabsTrigger>
              <TabsTrigger value="threads" className="flex-1">History</TabsTrigger>
              {isApprover && <TabsTrigger value="requests" className="flex-1">Requests</TabsTrigger>}
            </TabsList>

            <TabsContent value="chat" className="flex-1 min-h-0 mt-2">
              <AssistantChat
                threadId={threadId}
                onNeedThread={newThread}
                onThreadUpdated={markThreadActive}
                onNavigate={() => setOpen(false)}
              />
            </TabsContent>

            <TabsContent value="threads" className="flex-1 min-h-0 mt-2 overflow-y-auto">
              <div className="space-y-2">
                <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={newThread}>
                  <Plus className="h-3.5 w-3.5" /> New chat
                </Button>
                {loadingThreads && threads.length === 0 && (
                  <div className="space-y-2">
                    {[0, 1, 2, 3].map((row) => (
                      <div key={row} className="rounded-lg border px-2.5 py-2">
                        <Skeleton className="h-3.5 w-2/3" />
                        <Skeleton className="mt-2 h-3 w-full" />
                      </div>
                    ))}
                  </div>
                )}
                {threads.map((t) => (
                  <div
                    key={t.id}
                    className={cn(
                      "flex items-start gap-2 rounded-lg border px-2.5 py-2",
                      t.id === threadId && "border-primary bg-primary/5",
                    )}
                  >
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        setThread(t.id);
                        setTab("chat");
                      }}
                    >
                      <span className="block truncate text-sm font-medium">{t.title}</span>
                      {t.preview && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{t.preview}</span>
                      )}
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {new Date(t.updated_at).toLocaleString()}
                      </span>
                    </button>
                    <button
                      className="mt-0.5 text-muted-foreground hover:text-foreground"
                      aria-label="Rename chat"
                      onClick={() => {
                        const next = window.prompt("Rename this conversation", t.title);
                        if (next) void renameThread(t.id, next);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="mt-0.5 text-muted-foreground hover:text-destructive"
                      aria-label="Delete chat"
                      onClick={async () => {
                        await deleteThread(t.id);
                        if (t.id === threadId) setThread(null);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {!loadingThreads && threads.length === 0 && (
                  <p className="text-sm text-muted-foreground px-1">No conversations yet.</p>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full gap-1.5"
                  onClick={() => {
                    setOpen(false);
                    navigate(`/${profile.organization_slug}/assistant${threadId ? `/${threadId}` : ""}`);
                  }}
                >
                  <MessageCircleQuestion className="h-3.5 w-3.5" /> Open full page
                </Button>
              </div>
            </TabsContent>

            {isApprover && (
              <TabsContent value="requests" className="flex-1 min-h-0 mt-2 overflow-y-auto">
                <div className="flex items-center gap-1.5 px-1 pb-1 text-xs text-muted-foreground">
                  <ShieldQuestion className="h-3.5 w-3.5" /> Temporary access requests from your team
                </div>
                <AssistantAccessRequests />
                <Button size="sm" variant="ghost" className="w-full mt-2" onClick={loadThreads}>
                  Refresh
                </Button>
              </TabsContent>
            )}
          </Tabs>
        </SheetContent>
      </Sheet>

      <ReportProblemDialog open={reportOpen} onOpenChange={setReportOpen} threadId={threadId} />
    </>
  );
}
