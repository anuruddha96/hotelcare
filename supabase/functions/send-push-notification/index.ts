import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = "BC-vMYcTM4vY9zBEE-9cXCH8TJ-LTXym4pfr7YbPe2VatkZa4fLbKom3NMjPgMb9vwDHaj4MfoU4eWia4xAhMoA";
const VAPID_SUBJECT = "mailto:info@hotelcare.app";

interface PushRequest {
  userIds?: string[];
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  eventType?: string;
  data?: Record<string, unknown>;
}

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Web Push is missing Supabase runtime credentials");
    return json({ error: "Push service is not configured" }, 503);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const [{ data: expectedSecret, error: dispatchSecretError }, { data: vapidPrivateKey, error: vapidError }] =
      await Promise.all([
        admin.rpc("get_hotelcare_push_secret", { _name: "hotelcare_push_dispatch_key" }),
        admin.rpc("get_hotelcare_push_secret", { _name: "hotelcare_vapid_private_key" }),
      ]);

    if (dispatchSecretError || vapidError || !expectedSecret || !vapidPrivateKey) {
      console.error("Web Push Vault configuration is unavailable", {
        dispatchSecretError: dispatchSecretError?.message,
        vapidError: vapidError?.message,
      });
      return json({ error: "Push service is not configured" }, 503);
    }

    const suppliedSecret = req.headers.get("x-hotelcare-push-secret");
    if (!suppliedSecret || suppliedSecret !== expectedSecret) {
      return json({ error: "Unauthorized" }, 401);
    }

    const input = (await req.json()) as PushRequest;
    const userIds = [...new Set((input.userIds || []).filter(Boolean))];
    const title = String(input.title || "").trim();
    const body = String(input.body || "").trim();

    if (userIds.length === 0) {
      return json({ ok: true, targetedUsers: 0, subscriptions: 0, delivered: 0, removed: 0 });
    }
    if (!title || !body) {
      return json({ error: "title and body are required" }, 400);
    }
    if (userIds.length > 250) {
      return json({ error: "Too many recipients" }, 400);
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, String(vapidPrivateKey));

    const { data: rows, error: subscriptionsError } = await admin
      .from("push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth")
      .in("user_id", userIds);

    if (subscriptionsError) {
      console.error("Could not load Web Push subscriptions", subscriptionsError);
      return json({ error: "Could not load push subscriptions" }, 500);
    }

    const subscriptions = (rows || []) as PushSubscriptionRow[];
    if (subscriptions.length === 0) {
      return json({ ok: true, targetedUsers: userIds.length, subscriptions: 0, delivered: 0, removed: 0 });
    }

    const payload = JSON.stringify({
      title,
      body,
      tag: input.tag || `hotelcare-${input.eventType || "notification"}`,
      data: {
        ...(input.data || {}),
        url: input.url || "/",
        eventType: input.eventType || "notification",
      },
    });

    let delivered = 0;
    let removed = 0;
    let failed = 0;

    const results = await Promise.allSettled(
      subscriptions.map(async (row) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: row.endpoint,
              keys: { p256dh: row.p256dh, auth: row.auth },
            },
            payload,
            { TTL: 3600, urgency: "high" },
          );
          delivered += 1;
        } catch (error) {
          const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
          if (statusCode === 404 || statusCode === 410) {
            const { error: deleteError } = await admin
              .from("push_subscriptions")
              .delete()
              .eq("id", row.id);
            if (!deleteError) removed += 1;
            else console.error("Could not remove expired push subscription", deleteError);
            return;
          }

          failed += 1;
          console.error("Web Push delivery failed", {
            subscriptionId: row.id,
            userId: row.user_id,
            statusCode,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );

    const rejected = results.filter((result) => result.status === "rejected").length;
    failed += rejected;

    return json({
      ok: failed === 0,
      targetedUsers: userIds.length,
      subscriptions: subscriptions.length,
      delivered,
      failed,
      removed,
    });
  } catch (error) {
    console.error("Unhandled Web Push error", error);
    return json({ error: "Web Push delivery failed" }, 500);
  }
});
