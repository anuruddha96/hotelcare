import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Loader2, LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import { supabase } from "@/integrations/supabase/client";
import { bbT } from "@/lib/breakfast-translations";
import { breakfastAuthUrl, safeBreakfastReturnPath } from "@/lib/breakfastAuth";

interface BreakfastAuthControlProps {
  returnPath?: string;
  redirectToAuth?: (href: string) => void;
}

function currentBreakfastPath(): string {
  if (typeof window === "undefined") return "/bb";
  return safeBreakfastReturnPath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
}

export default function BreakfastAuthControl({ returnPath, redirectToAuth }: BreakfastAuthControlProps) {
  const { language } = useTranslation();
  const tt = (key: string) => bbT(language, key);
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession()
      .then(({ data }) => {
        if (!active) return;
        setUser(data.session?.user ?? null);
        setCheckingSession(false);
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setCheckingSession(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setCheckingSession(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const goToAuth = () => {
    const href = breakfastAuthUrl(returnPath ?? currentBreakfastPath());
    if (redirectToAuth) redirectToAuth(href);
    else window.location.assign(href);
  };

  const handleAuthAction = async () => {
    if (!user) {
      goToAuth();
      return;
    }

    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      goToAuth();
    } catch {
      setSigningOut(false);
      toast.error(tt("signOutFailed"));
    }
  };

  const label = user ? (signingOut ? tt("signingOut") : tt("staffSignOut")) : tt("staffSignIn");

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-9 shrink-0 gap-1.5 px-2.5 text-xs"
      disabled={checkingSession || signingOut}
      onClick={() => void handleAuthAction()}
      aria-label={label}
      title={user?.email ? `${tt("staffSignOut")} · ${user.email}` : tt("staffSignIn")}
    >
      {checkingSession || signingOut ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : user ? (
        <LogOut className="h-4 w-4" />
      ) : (
        <LogIn className="h-4 w-4" />
      )}
      <span>{label}</span>
    </Button>
  );
}
