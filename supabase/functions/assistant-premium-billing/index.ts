import Stripe from "npm:stripe@18";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PACKAGES = {
  premium_5: { id: "premium_5", credits: 5, amountCents: 500, label: "5 more deep-analysis questions" },
  premium_10: { id: "premium_10", credits: 10, amountCents: 1000, label: "10 more deep-analysis questions" },
} as const;

type PackageId = keyof typeof PACKAGES;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

async function caller(req: Request) {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  const db = admin();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await db
    .from("profiles")
    .select("id,organization_slug,role")
    .eq("id", data.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  return profile ? { user: data.user, profile, db } : null;
}

function packageList() {
  return Object.values(PACKAGES).map((p) => ({
    id: p.id,
    credits: p.credits,
    amount_eur: p.amountCents / 100,
    label: p.label,
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const who = await caller(req);
    if (!who) return json({ error: "Authentication required" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "status");
    const { user, profile, db } = who;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Budapest",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    if (action === "status") {
      const [{ count }, { data: wallet }] = await Promise.all([
        db
          .from("assistant_premium_usage")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("usage_day", today)
          .eq("source", "included")
          .in("status", ["reserved", "completed"]),
        db.from("assistant_premium_wallets").select("credits").eq("user_id", user.id).maybeSingle(),
      ]);
      const used = count ?? 0;
      return json({
        included_daily: 5,
        included_used: used,
        included_remaining: Math.max(0, 5 - used),
        paid_balance: Number(wallet?.credits ?? 0),
        packages: packageList(),
      });
    }

    if (action === "checkout") {
      const packageId = String(body.package_id ?? "") as PackageId;
      const pack = PACKAGES[packageId];
      if (!pack) return json({ error: "Invalid credit package" }, 400);

      const secret = Deno.env.get("STRIPE_SECRET_KEY");
      if (!secret) return json({ error: "Payments are not configured" }, 503);
      const stripe = new Stripe(secret, { apiVersion: "2025-03-31.basil" });

      const { data: subscription } = await db
        .from("module_subscriptions")
        .select("stripe_customer_id")
        .eq("organization_slug", profile.organization_slug)
        .not("stripe_customer_id", "is", null)
        .limit(1)
        .maybeSingle();
      const existingCustomer = subscription?.stripe_customer_id ? String(subscription.stripe_customer_id) : null;

      let returnUrl = String(body.return_url ?? req.headers.get("origin") ?? "").trim();
      if (!/^https?:\/\//i.test(returnUrl)) returnUrl = req.headers.get("origin") ?? "";
      if (!returnUrl) return json({ error: "A return URL is required" }, 400);
      const separator = returnUrl.includes("?") ? "&" : "?";
      const metadata = {
        kind: "assistant_premium_topup",
        user_id: user.id,
        organization_slug: String(profile.organization_slug ?? ""),
        package_id: pack.id,
        credits: String(pack.credits),
      };

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: existingCustomer ?? undefined,
        customer_creation: existingCustomer ? undefined : "always",
        customer_update: existingCustomer ? { name: "auto", address: "auto" } : undefined,
        billing_address_collection: "required",
        tax_id_collection: { enabled: true },
        invoice_creation: { enabled: true, invoice_data: { metadata } },
        custom_fields: [
          {
            key: "company_name",
            label: { type: "custom", custom: "Company / invoice name" },
            type: "text",
            optional: false,
          },
        ],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: pack.amountCents,
              tax_behavior: "inclusive",
              product_data: {
                name: `HotelCare AI — ${pack.credits} deep-analysis questions`,
                description: "Prepaid HotelCare Assistant deep-analysis credits. Credits remain available until used.",
              },
            },
          },
        ],
        client_reference_id: user.id,
        metadata,
        payment_intent_data: { metadata },
        success_url: `${returnUrl}${separator}assistantCredits=success`,
        cancel_url: `${returnUrl}${separator}assistantCredits=cancelled`,
      });

      return json({ url: session.url, package: { id: pack.id, credits: pack.credits, amount_eur: pack.amountCents / 100 } });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("assistant-premium-billing error", error);
    return json({ error: error instanceof Error ? error.message : "Payment request failed" }, 500);
  }
});
