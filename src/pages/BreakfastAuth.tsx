import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Coffee, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { bbT } from "@/lib/breakfast-translations";

export default function BreakfastAuth() {
  const { language } = useTranslation();
  const tt = (k: string) => bbT(language, k);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);

  // If already signed in as breakfast_staff, jump straight to /bb
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user || cancelled) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (profile?.role === "breakfast_staff") {
        window.location.replace("/bb");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setBusy(true);

    // Allow username-style logins (email derived) — same convention as main app uses email directly
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error || !data.user) {
      setBusy(false);
      toast.error(error?.message || "Invalid credentials");
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (profile?.role !== "breakfast_staff") {
      await supabase.auth.signOut();
      setBusy(false);
      toast.error("This sign-in is only for breakfast staff. Please use the main app.");
      return;
    }

    window.location.replace("/bb");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#359FDB]/10 to-[#6B6B6B]/5 p-4">
      <Card className="w-full max-w-sm shadow-2xl border-0">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-xl">
            <Coffee className="h-6 w-6" /> {tt("title")}
          </CardTitle>
          <p className="text-sm text-muted-foreground pt-1">Breakfast Staff Sign-In</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label htmlFor="bb-email">Email</Label>
              <Input
                id="bb-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div>
              <Label htmlFor="bb-pwd">Password</Label>
              <div className="relative">
                <Input
                  id="bb-pwd"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowPwd((s) => !s)}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => window.location.replace("/bb")}
            >
              Continue without sign-in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
