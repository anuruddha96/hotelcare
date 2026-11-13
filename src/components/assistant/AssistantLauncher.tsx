import { useCallback, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAssistant } from "@/hooks/useAssistant";
import { hasUnreadAssistantReply } from "@/lib/assistant/threadState";
import { getRememberedAssistantThread } from "@/lib/assistant/activeThread";
import { canUseAssistant } from "@/lib/assistantAccess";
import hotelCareMark from "@/assets/hotelcare-logo-mark.png";

/**
 * Mira is a first-class workspace, never a cramped secondary drawer.
 * Keep contextual Ask AI events while navigating to the actual chat route.
 */
export default function AssistantLauncher() {
  const { user, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { threads, loadThreads } = useAssistant(null);
  const org = profile?.organization_slug;
  const unread = threads.some(hasUnreadAssistantReply);

  const openMira = useCallback((question?: string) => {
    if (!user?.id || !org) return;
    const remembered = params.get("assistant") || getRememberedAssistantThread(user.id, org);
    const target = "/" + org + "/assistant" + (remembered ? "/" + remembered : "");
    navigate(target, question
      ? { state: { miraPrompt: { id: Date.now(), text: question } } }
      : undefined);
  }, [navigate, org, params, user?.id]);

  useEffect(() => {
    const handler = (event: Event) => {
      const question = (event as CustomEvent<{ prompt?: string }>).detail?.prompt?.trim();
      if (question) openMira(question);
    };
    window.addEventListener("hotelcare:ask-ai", handler);
    return () => window.removeEventListener("hotelcare:ask-ai", handler);
  }, [openMira]);

  useEffect(() => {
    if (!user?.id || !org) return;
    const refresh = () => { if (document.visibilityState === "visible") void loadThreads(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [user?.id, org, loadThreads]);

  if (!user || !org || !canUseAssistant(profile)) return null;
  if (location.pathname.startsWith("/bb") || location.pathname.startsWith("/auth")) return null;
  if (/\/assistant(\/|$)/.test(location.pathname)) return null;

  return (
    <Button
      onClick={() => openMira()}
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-40 h-14 min-h-14 min-w-14 touch-manipulation rounded-full px-0 shadow-lg sm:px-4"
      aria-label={unread ? "Open Mira by HotelCare, unread reply" : "Open Mira by HotelCare"}
    >
      <span className="relative pointer-events-none flex h-10 w-10 items-center justify-center rounded-full bg-background shadow-sm">
        <img src={hotelCareMark} alt="" className="h-7 w-7" />
        {unread && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background bg-sky-500" />}
      </span>
      <span className="pointer-events-none hidden sm:inline">Ask Mira</span>
    </Button>
  );
}
