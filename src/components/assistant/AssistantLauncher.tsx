import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { GripVertical } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAssistant } from "@/hooks/useAssistant";
import { hasUnreadAssistantReply } from "@/lib/assistant/threadState";
import { getRememberedAssistantThread, rememberAssistantReturnPath } from "@/lib/assistant/activeThread";
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
  const manager = ["admin", "manager", "top_management", "top_management_manager"].includes(profile?.role ?? "");
  const positionKey = `hc-mira-launcher-position:${user?.id ?? "guest"}`;
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [mobile, setMobile] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const clamp = useCallback((x: number, y: number) => ({
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - 108)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 76)),
  }), []);

  useEffect(() => {
    const refresh = () => {
      const isMobile = window.matchMedia("(pointer: coarse) and (max-width: 900px)").matches;
      setMobile(isMobile);
      if (!isMobile) return;
      let saved: { x: number; y: number } | null = null;
      try {
        const raw = localStorage.getItem(positionKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) saved = parsed;
        }
      } catch { /* Storage is optional. */ }
      setPosition((previous) => clamp((previous ?? saved)?.x ?? window.innerWidth - 108, (previous ?? saved)?.y ?? Math.round(window.innerHeight * 0.6)));
    };
    refresh();
    window.addEventListener("resize", refresh);
    return () => window.removeEventListener("resize", refresh);
  }, [positionKey, clamp]);

  const dragStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!mobile || !position) return;
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = dragRef.current;
    if (!state || !mobile) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (Math.hypot(dx, dy) >= 6) state.moved = true;
    if (state.moved) setPosition(clamp(state.originX + dx, state.originY + dy));
  };
  const dragFinish = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = dragRef.current;
    if (!state) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    suppressClickRef.current = state.moved;
    if (state.moved) {
      const next = clamp(state.originX + event.clientX - state.startX, state.originY + event.clientY - state.startY);
      setPosition(next);
      try { localStorage.setItem(positionKey, JSON.stringify(next)); } catch { /* Storage is optional. */ }
    }
  };

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

  return (
    <Button
      onClick={() => {
        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
        openMira();
      }}
      onPointerDown={dragStart}
      onPointerMove={dragMove}
      onPointerUp={dragFinish}
      onPointerCancel={(event) => {
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      style={mobile && position ? { left: position.x, top: position.y, right: "auto", bottom: "auto", touchAction: "none" } : undefined}
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-40 h-14 min-h-14 min-w-14 touch-none select-none gap-2 rounded-full px-2 shadow-lg sm:px-4"
      aria-label={unread ? "Open Mira AI Operator, unread reply. Drag to move on mobile." : "Open Mira AI Operator. Drag to move on mobile."}
      title="Mira AI Operator — tap to chat or drag to reposition"
    >
      <span className="relative pointer-events-none flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background shadow-sm">
        <img src={hotelCareMark} alt="" className="h-7 w-7" />
        {unread && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background bg-sky-500" />}
      </span>
      <span className="pointer-events-none hidden text-left text-xs font-semibold leading-tight sm:inline">
        {manager ? <>Mira Operator<br /><span className="font-normal">Try me</span></> : "Ask Mira"}
      </span>
      <span className="pointer-events-none inline-flex items-center gap-0.5 text-[11px] font-semibold sm:hidden">
        {manager ? "Try Mira" : "Mira"}
        <GripVertical className="h-3 w-3 opacity-60" />
      </span>
    </Button>
  );
}
