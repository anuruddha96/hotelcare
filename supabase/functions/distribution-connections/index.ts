import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const ChannelSchema = z.enum([
  "booking",
  "expedia",
  "agoda",
  "trip",
  "airbnb",
  "hoteltonight",
  "szallas",
]);

const ProviderSchema = z.enum([
  "channex",
  "previo",
  "booking",
  "expedia",
  "agoda",
  "trip",
  "airbnb",
  "hoteltonight",
  "szallas",
]);

const BaseSchema = z.object({
  hotelId: z.string().min(1).max(255),
});

const ListSchema = BaseSchema.extend({
  action: z.literal("list"),
});

const CreateDraftSchema = BaseSchema.extend({
  action: z.literal("create_draft"),
  organizationSlug: z.string().min(1).max(255).nullable().optional(),
  provider: ProviderSchema,
  channel: ChannelSchema,
  externalPropertyId: z.string().trim().min(1).max(255),
});

const RemoveDraftSchema = BaseSchema.extend({
  action: z.literal("remove_draft"),
  connectionId: z.string().uuid(),
});

const BodySchema = z.discriminatedUnion("action", [
  ListSchema,
  CreateDraftSchema,
  RemoveDraftSchema,
]);

const MANAGEMENT_ROLES = new Set([
  "admin",
  "manager",
  "top_management",
  "top_management_manager",
]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Distribution service is not configured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Authentication required" }, 401);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: userResult, error: userError } = await admin.auth.getUser(
      authHeader.slice(7),
    );
    const user = userResult.user;
    if (userError || !user) return json({ error: "Invalid session" }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return json({ error: parsed.error.flatten().fieldErrors }, 400);
    }

    const { hotelId } = parsed.data;
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role,organization_slug")
      .eq("id", user.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (profileError || !profile || !MANAGEMENT_ROLES.has(String(profile.role))) {
      return json({ error: "You cannot manage distribution connections" }, 403);
    }

    const { data: canAccess, error: accessError } = await admin.rpc(
      "user_can_access_hotel",
      { _uid: user.id, _hotel_id: hotelId },
    );
    if (accessError || !canAccess) {
      return json({ error: "You cannot access this hotel" }, 403);
    }

    if (parsed.data.action === "list") {
      const { data, error } = await admin
        .from("distribution_connections")
        .select(
          "id,hotel_id,organization_slug,provider,channel,external_property_id,status,capabilities,metadata,last_health_check_at,last_health_error,created_at,updated_at",
        )
        .eq("hotel_id", hotelId)
        .order("channel", { ascending: true });

      if (error) throw error;
      return json({ ok: true, connections: data ?? [] });
    }

    if (parsed.data.action === "create_draft") {
      // This endpoint deliberately does not accept API keys or passwords.
      // Provider credentials must be installed separately in server-side
      // secrets and referenced only after the actual adapter is configured.
      const row = {
        hotel_id: hotelId,
        organization_slug:
          parsed.data.organizationSlug ?? profile.organization_slug ?? null,
        provider: parsed.data.provider,
        channel: parsed.data.channel,
        external_property_id: parsed.data.externalPropertyId,
        status: "draft",
        capabilities: [],
        secret_ref: null,
        metadata: {
          prepared_by: user.id,
          prepared_at: new Date().toISOString(),
        },
      };

      const { data, error } = await admin
        .from("distribution_connections")
        .insert(row)
        .select(
          "id,hotel_id,organization_slug,provider,channel,external_property_id,status,capabilities,created_at,updated_at",
        )
        .single();

      if (error) {
        if (error.code === "23505") {
          return json(
            { error: "This provider/channel/property connection already exists" },
            409,
          );
        }
        throw error;
      }

      await admin.from("distribution_audit_log").insert({
        hotel_id: hotelId,
        connection_id: data.id,
        actor_id: user.id,
        event: "connection_draft_created",
        details: {
          provider: parsed.data.provider,
          channel: parsed.data.channel,
          external_property_id: parsed.data.externalPropertyId,
        },
      });

      return json({ ok: true, connection: data }, 201);
    }

    const { data: connection, error: connectionError } = await admin
      .from("distribution_connections")
      .select("id,status,channel,provider")
      .eq("id", parsed.data.connectionId)
      .eq("hotel_id", hotelId)
      .maybeSingle();

    if (connectionError) throw connectionError;
    if (!connection) return json({ error: "Connection not found" }, 404);
    if (!new Set(["draft", "disabled", "error"]).has(connection.status)) {
      return json(
        { error: "Active/connecting distribution links cannot be removed here" },
        409,
      );
    }

    const { error: deleteError } = await admin
      .from("distribution_connections")
      .delete()
      .eq("id", connection.id)
      .eq("hotel_id", hotelId);
    if (deleteError) throw deleteError;

    await admin.from("distribution_audit_log").insert({
      hotel_id: hotelId,
      actor_id: user.id,
      event: "connection_draft_removed",
      details: {
        connection_id: connection.id,
        provider: connection.provider,
        channel: connection.channel,
      },
    });

    return json({ ok: true });
  } catch (error) {
    console.error("distribution-connections failed", error);
    return json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500,
    );
  }
});
