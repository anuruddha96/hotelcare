import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const MANAGEMENT_ROLES = new Set([
  "admin",
  "manager",
  "top_management",
  "top_management_manager",
]);

const BaseSchema = z.object({ hotelId: z.string().min(1).max(255) });
const HealthSchema = BaseSchema.extend({ action: z.literal("health") });
const ListPropertiesSchema = BaseSchema.extend({ action: z.literal("list_properties") });
const CreatePropertySchema = BaseSchema.extend({
  action: z.literal("create_property"),
  property: z.object({
    title: z.string().trim().min(1).max(255),
    email: z.string().trim().email(),
    phone: z.string().trim().min(3).max(64),
    currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
    country: z.string().trim().length(2).transform((value) => value.toUpperCase()),
    state: z.string().trim().max(255).optional().nullable(),
    city: z.string().trim().min(1).max(255),
    address: z.string().trim().min(1).max(500),
    zipCode: z.string().trim().min(1).max(32),
    timezone: z.string().trim().min(1).max(100),
  }),
});
const ListRoomTypesSchema = BaseSchema.extend({
  action: z.literal("list_room_types"),
  propertyId: z.string().uuid(),
});
const CreateRoomTypeSchema = BaseSchema.extend({
  action: z.literal("create_room_type"),
  propertyId: z.string().uuid(),
  roomType: z.object({
    title: z.string().trim().min(1).max(255),
    countOfRooms: z.number().int().min(1).max(10000),
    occAdults: z.number().int().min(1).max(100),
    occChildren: z.number().int().min(0).max(100).default(0),
    occInfants: z.number().int().min(0).max(100).default(0),
    defaultOccupancy: z.number().int().min(1).max(100),
  }),
});
const ListRatePlansSchema = BaseSchema.extend({
  action: z.literal("list_rate_plans"),
  propertyId: z.string().uuid(),
});
const CreateRatePlanSchema = BaseSchema.extend({
  action: z.literal("create_rate_plan"),
  propertyId: z.string().uuid(),
  roomTypeId: z.string().uuid(),
  ratePlan: z.object({
    title: z.string().trim().min(1).max(255),
    currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
    sellMode: z.enum(["per_room", "per_person"]).default("per_room"),
    rateMode: z.enum(["manual", "derived"]).default("manual"),
  }),
});

const BodySchema = z.discriminatedUnion("action", [
  HealthSchema,
  ListPropertiesSchema,
  CreatePropertySchema,
  ListRoomTypesSchema,
  CreateRoomTypeSchema,
  ListRatePlansSchema,
  CreateRatePlanSchema,
]);

type ChannexResult = {
  ok: boolean;
  status: number;
  data: unknown;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const getApiKey = () =>
  Deno.env.get("CHANNEX_API_KEY") ?? Deno.env.get("Channex_API_Key") ?? "";

const getBaseUrl = () =>
  (Deno.env.get("CHANNEX_BASE_URL") ?? "https://staging.channex.io").replace(/\/$/, "");

const requestChannex = async (
  path: string,
  init: RequestInit = {},
): Promise<ChannexResult> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Channex API key is not configured in Supabase secrets");

  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "user-api-key": apiKey,
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 1000) };
    }
  }

  return { ok: response.ok, status: response.status, data };
};

const channexError = (result: ChannexResult) => {
  if (result.ok) return null;
  const body = result.data as Record<string, unknown> | null;
  const message =
    body && typeof body === "object"
      ? String(body.error ?? body.message ?? `Channex returned HTTP ${result.status}`)
      : `Channex returned HTTP ${result.status}`;
  return message.slice(0, 1000);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) return json({ error: "Service is not configured" }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: userResult, error: userError } = await admin.auth.getUser(authHeader.slice(7));
    const user = userResult.user;
    if (userError || !user) return json({ error: "Invalid session" }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (profileError || !profile || !MANAGEMENT_ROLES.has(String(profile.role))) {
      return json({ error: "You cannot manage distribution connectivity" }, 403);
    }

    const { data: canAccess, error: accessError } = await admin.rpc("user_can_access_hotel", {
      _uid: user.id,
      _hotel_id: parsed.data.hotelId,
    });
    if (accessError || !canAccess) return json({ error: "You cannot access this hotel" }, 403);

    let result: ChannexResult;
    let auditEvent = "channex_read";
    let auditDetails: Record<string, unknown> = { action: parsed.data.action };

    switch (parsed.data.action) {
      case "health":
        result = await requestChannex("/api/v1/properties?pagination[page]=1&pagination[limit]=1");
        break;
      case "list_properties":
        result = await requestChannex("/api/v1/properties?pagination[page]=1&pagination[limit]=100");
        break;
      case "create_property": {
        auditEvent = "channex_property_create_requested";
        const p = parsed.data.property;
        result = await requestChannex("/api/v1/properties", {
          method: "POST",
          body: JSON.stringify({
            property: {
              title: p.title,
              email: p.email,
              phone: p.phone,
              currency: p.currency,
              country: p.country,
              state: p.state ?? undefined,
              city: p.city,
              address: p.address,
              zip_code: p.zipCode,
              timezone: p.timezone,
              property_type: "hotel",
            },
          }),
        });
        break;
      }
      case "list_room_types":
        result = await requestChannex(`/api/v1/room_types?filter[property_id]=${encodeURIComponent(parsed.data.propertyId)}&pagination[page]=1&pagination[limit]=100`);
        break;
      case "create_room_type": {
        auditEvent = "channex_room_type_create_requested";
        auditDetails.property_id = parsed.data.propertyId;
        const room = parsed.data.roomType;
        result = await requestChannex("/api/v1/room_types", {
          method: "POST",
          body: JSON.stringify({
            room_type: {
              property_id: parsed.data.propertyId,
              title: room.title,
              count_of_rooms: room.countOfRooms,
              occ_adults: room.occAdults,
              occ_children: room.occChildren,
              occ_infants: room.occInfants,
              default_occupancy: room.defaultOccupancy,
              room_kind: "room",
            },
          }),
        });
        break;
      }
      case "list_rate_plans":
        result = await requestChannex(`/api/v1/rate_plans?filter[property_id]=${encodeURIComponent(parsed.data.propertyId)}&pagination[page]=1&pagination[limit]=100`);
        break;
      case "create_rate_plan": {
        auditEvent = "channex_rate_plan_create_requested";
        auditDetails.property_id = parsed.data.propertyId;
        auditDetails.room_type_id = parsed.data.roomTypeId;
        const rate = parsed.data.ratePlan;
        result = await requestChannex("/api/v1/rate_plans", {
          method: "POST",
          body: JSON.stringify({
            rate_plan: {
              property_id: parsed.data.propertyId,
              room_type_id: parsed.data.roomTypeId,
              title: rate.title,
              currency: rate.currency,
              sell_mode: rate.sellMode,
              rate_mode: rate.rateMode,
            },
          }),
        });
        break;
      }
    }

    const error = channexError(result);
    await admin.from("distribution_audit_log").insert({
      hotel_id: parsed.data.hotelId,
      actor_id: user.id,
      event: error ? `${auditEvent}_failed` : auditEvent,
      details: { ...auditDetails, http_status: result.status, error },
    });

    if (error) return json({ ok: false, error, providerStatus: result.status }, result.status >= 500 ? 502 : 400);
    return json({ ok: true, environment: getBaseUrl().includes("staging") ? "staging" : "configured", data: result.data });
  } catch (error) {
    console.error("distribution-channex failed", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
