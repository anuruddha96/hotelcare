import { useCallback, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAssistant } from "@/hooks/useAssistant";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { hasUnreadAssistantReply } from "@/lib/assistant/threadState";
import { getRememberedAssistantThread, rememberAssistantReturnPath } from "@/lib/assistant/activeThread";
import { canUseAssistant } from "@/lib/assistantAccess";
import hotelCareMark from "@/assets/hotelcare-logo-mark.png";
import MiraFloatingButton from "./MiraFloatingButton";

/** Touch screens of any size, and narrow windows, get the draggable round launcher. */
const FLOATING_LAUNCHER_QUERY = "(pointer: coarse), (max-width: 767px)";

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
  const manager = ["admin", "manager", "top_management", "top_management_manager"].includes(profile?.role ?? "");
  const positionKey = `hc-mira-launcher-position:${user?.id ?? "guest"}`;
  const floating = useMediaQuery(FLOATING_LAUNCHER_QUERY);

  const openMira = useCallback((question?: string) => {
    if (!user?.id || !org) return;
    rememberAssistantReturnPath(user.id, org, `${location.pathname}${location.search}`);
    const remembered = params.get("assistant") || getRememberedAssistantThread(user.id, org);
    const target = "/" + org + "/assistant" + (remembered ? "/" + remembered : "");
    navigate(target, question
      ? { state: { miraPrompt: { id: Date.now(), text: question } } }
      : undefined);
  }, [navigate, org, params, user?.id, location.pathname, location.search]);

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

  if (floating) {
    return <MiraFloatingButton key={positionKey} storageKey={positionKey} unread={unread} onOpen={() => openMira()} />;
  }

  // Desktop with a mouse: the labelled pill stays fixed in the bottom-right corner.
  return (
    <Button
      onClick={() => openMira()}
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-40 h-14 min-h-14 min-w-14 gap-2 rounded-full px-4 shadow-lg"
      aria-label={unread ? "Open Mira AI Operator, unread reply" : "Open Mira AI Operator"}
      title="Mira AI Operator"
    >
      <span className="relative pointer-events-none flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background shadow-sm">
        <img src={hotelCareMark} alt="" className="h-7 w-7" />
        {unread && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background bg-sky-500" />}
      </span>
      <span className="pointer-events-none text-left text-xs font-semibold leading-tight">
        {manager ? <>Mira Operator<br /><span className="font-normal">Try me</span></> : "Ask Mira"}
      </span>
    </Button>
  );
}
