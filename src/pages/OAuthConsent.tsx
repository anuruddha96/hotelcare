import { FormEvent, useEffect, useMemo, useState } from "react";
import { Building2, ExternalLink, LockKeyhole, ShieldCheck } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import hotelcareLogoAuth from "@/assets/hotelcare-logo-auth.png";

type AuthorizationDetails = {
  authorization_id?: string;
  client_id?: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  redirect_uri?: string;
  scope?: string;
  redirect_url?: string;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

async function oauthRequest(
  authorizationId: string,
  options?: { action?: "approve" | "deny" },
): Promise<AuthorizationDetails> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error("Your HotelCare session is not available. Please sign in again.");
  }

  const consentSuffix = options?.action ? "/consent" : "";
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/oauth/authorizations/${encodeURIComponent(authorizationId)}${consentSuffix}`,
    {
      method: options?.action ? "POST" : "GET",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${sessionData.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: options?.action ? JSON.stringify({ action: options.action }) : undefined,
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || "OAuth request failed";
    throw new Error(String(message));
  }

  return payload as AuthorizationDetails;
}

function scopeDescription(scope: string) {
  switch (scope) {
    case "email":
      return "Use your HotelCare email address to identify your account.";
    case "profile":
      return "Use your HotelCare profile identity. Hotel, organization and module access remain controlled by HotelCare.";
    case "openid":
      return "Verify your HotelCare identity.";
    default:
      return `Request the ${scope} permission from your HotelCare account.`;
  }
}

export default function OAuthConsent() {
  const [searchParams] = useSearchParams();
  const authorizationId = searchParams.get("authorization_id") || "";
  const { user, profile, signIn, loading: authLoading } = useAuth();
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<"approve" | "deny" | "signin" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scopes = useMemo(
    () => (details?.scope || "email profile").split(/\s+/).map((value) => value.trim()).filter(Boolean),
    [details?.scope],
  );

  useEffect(() => {
    if (authLoading || !user || !authorizationId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    oauthRequest(authorizationId)
      .then((result) => {
        if (cancelled) return;
        if (result.redirect_url && !result.authorization_id) {
          window.location.assign(result.redirect_url);
          return;
        }
        setDetails(result);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Could not load this connection request.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, authorizationId, user]);

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const emailOrUsername = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    if (!emailOrUsername || !password) return;

    setSubmitting("signin");
    const { error: signInError } = await signIn(emailOrUsername, password);
    setSubmitting(null);
    if (signInError) toast.error(signInError.message || "Could not sign in to HotelCare");
  };

  const decide = async (action: "approve" | "deny") => {
    if (!authorizationId) return;
    setSubmitting(action);
    setError(null);
    try {
      const result = await oauthRequest(authorizationId, { action });
      if (!result.redirect_url) throw new Error("The authorization server did not return a redirect URL.");
      window.location.assign(result.redirect_url);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Could not complete the connection request.";
      setError(message);
      toast.error(message);
      setSubmitting(null);
    }
  };

  if (!authorizationId) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Invalid connection request</CardTitle>
            <CardDescription>This HotelCare connection link is missing its authorization ID.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (authLoading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader className="space-y-4 text-center">
            <img src={hotelcareLogoAuth} alt="HotelCare" className="mx-auto h-12 w-auto object-contain" />
            <div>
              <CardTitle className="text-2xl">Sign in to connect HotelCare</CardTitle>
              <CardDescription className="mt-2">
                Use your own HotelCare account. The connected app will inherit only the access already assigned to you.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="oauth-email">Email or username</Label>
                <Input id="oauth-email" name="email" autoComplete="username" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="oauth-password">Password</Label>
                <Input id="oauth-password" name="password" type="password" autoComplete="current-password" required />
              </div>
              <Button type="submit" className="w-full" disabled={submitting === "signin"}>
                {submitting === "signin" ? "Signing in…" : "Continue securely"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-muted/30 flex items-center justify-center p-4 py-10">
      <Card className="w-full max-w-2xl shadow-xl overflow-hidden">
        <div className="h-1.5 bg-primary" />
        <CardHeader className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <img src={hotelcareLogoAuth} alt="HotelCare" className="h-11 w-auto object-contain" />
            <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
              <LockKeyhole className="h-3.5 w-3.5" /> Secure OAuth connection
            </div>
          </div>

          <div>
            <CardTitle className="text-2xl md:text-3xl">
              {details?.client_name || "An application"} wants to connect to HotelCare
            </CardTitle>
            <CardDescription className="mt-2 text-sm md:text-base">
              You are authorizing this connection as <span className="font-medium text-foreground">{profile?.full_name || user.email}</span>
              {profile?.organization_slug ? <> in <span className="font-medium text-foreground">{profile.organization_slug}</span></> : null}.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
          ) : (
            <>
              <section className="rounded-xl border bg-background p-4 md:p-5">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
                  <div>
                    <h2 className="font-semibold">HotelCare stays in control of permissions</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Connecting does not grant extra hotel or module access. Every request is checked against your HotelCare organization, role and property permissions.
                    </p>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Requested access</h2>
                <div className="space-y-2">
                  {scopes.map((scope) => (
                    <div key={scope} className="flex items-start gap-3 rounded-lg border bg-background p-3">
                      <div className="mt-0.5 rounded-md bg-primary/10 p-1.5"><ShieldCheck className="h-4 w-4 text-primary" /></div>
                      <div>
                        <div className="font-medium capitalize">{scope}</div>
                        <div className="text-sm text-muted-foreground">{scopeDescription(scope)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {details?.redirect_uri ? (
                <section className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <ExternalLink className="h-3.5 w-3.5" /> Return destination
                  </div>
                  <div className="mt-1 break-all">{details.redirect_uri}</div>
                </section>
              ) : null}

              <div className="flex items-center gap-2 rounded-lg border bg-background p-3 text-sm text-muted-foreground">
                <Building2 className="h-4 w-4 shrink-0" />
                Access remains limited to the HotelCare organization and properties available to this account.
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => void decide("deny")} disabled={!!submitting}>
                  {submitting === "deny" ? "Cancelling…" : "Cancel"}
                </Button>
                <Button onClick={() => void decide("approve")} disabled={!!submitting}>
                  {submitting === "approve" ? "Connecting…" : "Allow and connect"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
