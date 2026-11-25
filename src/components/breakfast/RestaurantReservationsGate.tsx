import { useEffect, useState } from "react";
import { Loader2, LockKeyhole, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { breakfastAuthUrl } from "@/lib/breakfastAuth";
import RestaurantReservations from "./RestaurantReservations";

type Props = {
  hotelId: string;
  date: string;
  language: string;
  onDateChange?: (date: string) => void;
};

/**
 * Only the reservations tab needs a signed-in staff session. Breakfast room
 * lookup and recipes retain their existing shared-device/public behaviour.
 */
export default function RestaurantReservationsGate(props: Props) {
  const [authState, setAuthState] = useState<"checking" | "signed-in" | "signed-out">("checking");

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (active) setAuthState(!error && data.user ? "signed-in" : "signed-out");
      } catch {
        if (active) setAuthState("signed-out");
      }
    };
    void check();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "SIGNED_OUT" || !session) {
        setAuthState("signed-out");
      } else {
        // A local session is not sufficient: verify its user with Supabase Auth.
        void check();
      }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  if (authState === "checking") {
    return <div role="status" className="flex justify-center p-8 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" /><span className="sr-only">Checking staff access</span>
    </div>;
  }

  if (authState === "signed-out") {
    const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return (
      <div className="rounded-lg border bg-muted/30 p-5 space-y-3 text-center">
        <LockKeyhole className="mx-auto h-6 w-6 text-muted-foreground" />
        <div className="font-semibold">Staff sign-in required</div>
        <p className="text-sm text-muted-foreground">
          Guest names, phone numbers and reservation changes are available only to verified staff.
          On a shared restaurant tablet, sign in using your breakfast-staff account and sign out at the end of your shift.
        </p>
        <Button type="button" onClick={() => window.location.assign(breakfastAuthUrl(returnPath))}>
          <LogIn className="mr-2 h-4 w-4" /> Sign in to reservations
        </Button>
      </div>
    );
  }

  return <RestaurantReservations {...props} />;
}
