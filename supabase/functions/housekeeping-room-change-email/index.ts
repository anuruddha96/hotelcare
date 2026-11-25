import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { loadEmailSettings, sendEmail } from "../_shared/emailSender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hotelcare-worker-secret",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
function equalSecret(a: string, b: string) { if (!a || !b || a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
function esc(value: unknown): string { return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!); }
function cleanLine(value: unknown, max = 180): string { return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max); }
type RoomType = "checkout" | "daily";
type Payload = { organizationSlug: string; hotelId: string; hotelName: string; roomId?: string | null; roomNumber: string; businessDate: string; previousType: RoomType; newType: RoomType; changedByUserId?: string | null; changedByName?: string | null; note?: string | null; pmsDepartureStillVisible?: boolean; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const url = Deno.env.get("SUPABASE_URL"); const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "HotelCare mail service is not configured" }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  let payload: Payload; try { payload = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const organizationSlug = cleanLine(payload.organizationSlug, 80); const hotelId = cleanLine(payload.hotelId, 100); const hotelName = cleanLine(payload.hotelName, 120); const roomNumber = cleanLine(payload.roomNumber, 40); const businessDate = cleanLine(payload.businessDate, 10); const previousType = payload.previousType; const newType = payload.newType; const changedByUserId = cleanLine(payload.changedByUserId, 80) || null; const changedByName = cleanLine(payload.changedByName, 120) || "HotelCare manager"; const note = cleanLine(payload.note, 500) || null;
  if (!organizationSlug || !hotelId || !hotelName || !roomNumber || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return json({ error: "Missing or invalid hotel/room/date fields" }, 400);
  if (!["checkout", "daily"].includes(previousType) || !["checkout", "daily"].includes(newType) || previousType === newType) return json({ error: "Invalid room type change" }, 400);

  let authorizedUserId: string | null = null;
  const suppliedSecret = req.headers.get("x-hotelcare-worker-secret") || "";
  if (suppliedSecret) {
    const { data: expected } = await admin.rpc("housekeeping_room_change_email_worker_secret");
    if (!equalSecret(suppliedSecret, String(expected || ""))) return json({ error: "Unauthorized" }, 401);
    authorizedUserId = changedByUserId;
  } else {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Unauthorized" }, 401);
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user?.id) return json({ error: "Unauthorized" }, 401);
    const { data: profile } = await admin.from("profiles").select("id, role, organization_slug, deleted_at").eq("id", authData.user.id).maybeSingle();
    const allowedRoles = new Set(["manager", "housekeeping_manager", "admin", "top_management", "top_management_manager"]);
    if (!profile || profile.deleted_at || profile.organization_slug !== organizationSlug || !allowedRoles.has(profile.role)) return json({ error: "Forbidden" }, 403);
    authorizedUserId = authData.user.id;
  }

  const { data: contact, error: contactError } = await admin.from("hotel_operational_contacts").select("reception_email, room_type_change_email_enabled").eq("organization_slug", organizationSlug).eq("hotel_id", hotelId).maybeSingle();
  if (contactError) return json({ error: "Could not load hotel operational contact" }, 500);
  if (!contact?.room_type_change_email_enabled) return json({ ok: false, skipped: true, reason: "Room-type change emails are disabled for this hotel" }, 200);
  const recipient = cleanLine(contact?.reception_email, 220);
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return json({ error: "Reception email is not configured for this hotel" }, 409);

  const extension = previousType === "checkout" && newType === "daily"; const checkoutChange = previousType === "daily" && newType === "checkout";
  const eventLabel = extension ? "Possible guest stay extension" : checkoutChange ? "Room changed to checkout" : "Housekeeping room type changed";
  const subject = `Hotel Care · ${hotelName} · Room ${roomNumber} · ${extension ? "extension confirmation needed" : "checkout status changed"}`;
  const warning = payload.pmsDepartureStillVisible ? "HotelCare still detected a PMS departure signal for today when this change was made. Please verify the stay dates in Previo so a later synchronization does not recreate the wrong housekeeping status." : "Please verify that Previo and HotelCare show the same stay/departure status for this room.";
  const actionText = extension ? "Please confirm the guest extension in Previo and coordinate with the manager / housekeeping team. If the extension is already correctly registered, no further PMS change is needed; simply ensure both systems remain aligned." : "Please confirm the checkout/departure in Previo and coordinate with the manager / housekeeping team. If it is already correct in the PMS, no further PMS change is needed.";

  const emailHtml = `<div style="margin:0;background:#f3f6fb;padding:28px 12px;font-family:Inter,Arial,sans-serif;color:#172033"><div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5eaf2;border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,.08)"><div style="background:linear-gradient(135deg,#102a43,#184e77);padding:28px 30px;color:#fff"><div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.78">HotelCare.app · Operational coordination</div><div style="font-size:27px;font-weight:800;margin-top:8px">${esc(eventLabel)}</div><div style="font-size:15px;margin-top:7px;opacity:.9">${esc(hotelName)} · Room ${esc(roomNumber)} · ${esc(businessDate)}</div></div><div style="padding:28px 30px"><div style="display:inline-block;background:${extension ? "#fff3cd" : "#e8f1ff"};color:${extension ? "#8a4b08" : "#174ea6"};border:1px solid ${extension ? "#f5d58a" : "#b9d4ff"};border-radius:999px;padding:8px 13px;font-size:13px;font-weight:800">${esc(previousType.toUpperCase())} → ${esc(newType.toUpperCase())}</div><h2 style="font-size:20px;margin:22px 0 8px;color:#102a43">Reception confirmation requested</h2><p style="font-size:15px;line-height:1.65;margin:0 0 18px">${esc(actionText)}</p><div style="border:1px solid #e7edf5;background:#f8fafc;border-radius:12px;padding:16px 18px;margin:18px 0"><table style="width:100%;border-collapse:collapse;font-size:14px"><tr><td style="padding:5px 0;color:#64748b">Hotel</td><td style="padding:5px 0;text-align:right;font-weight:700">${esc(hotelName)}</td></tr><tr><td style="padding:5px 0;color:#64748b">Room</td><td style="padding:5px 0;text-align:right;font-weight:700">${esc(roomNumber)}</td></tr><tr><td style="padding:5px 0;color:#64748b">Business date</td><td style="padding:5px 0;text-align:right;font-weight:700">${esc(businessDate)}</td></tr><tr><td style="padding:5px 0;color:#64748b">Changed by</td><td style="padding:5px 0;text-align:right;font-weight:700">${esc(changedByName)}</td></tr>${note ? `<tr><td style="padding:5px 0;color:#64748b;vertical-align:top">Manager note</td><td style="padding:5px 0;text-align:right;font-weight:700">${esc(note)}</td></tr>` : ""}</table></div><div style="background:#fff7ed;border-left:4px solid #f97316;border-radius:8px;padding:13px 15px;font-size:13px;line-height:1.55;color:#7c2d12">${esc(warning)}</div><p style="font-size:12px;line-height:1.55;color:#64748b;margin:24px 0 0">This is an automated HotelCare operational message. Previo remains the source of truth for the guest's reservation and stay dates; HotelCare uses the confirmed PMS state to coordinate housekeeping.</p></div><div style="padding:16px 30px;background:#f8fafc;border-top:1px solid #e5eaf2;font-size:11px;color:#7b8794;text-align:center">Powered by HotelCare.app · Housekeeping & PMS coordination</div></div></div>`;
  const text = ["HotelCare.app operational coordination", `${hotelName} — Room ${roomNumber} — ${businessDate}`, `${previousType.toUpperCase()} -> ${newType.toUpperCase()}`, actionText, warning, `Changed by: ${changedByName}`, ...(note ? [`Manager note: ${note}`] : [])].join("\n\n");

  const baseSettings = await loadEmailSettings(admin as any, organizationSlug);
  const brandedSettings = { ...baseSettings, organization_slug: organizationSlug, from_name: "HotelCare.app", from_email: "notifications@updates.hotelcare.app", reply_to: "info@hotelcare.app" };
  const { data: logRow, error: logError } = await admin.from("housekeeping_room_change_email_log").insert({ organization_slug: organizationSlug, hotel_id: hotelId, room_id: payload.roomId || null, room_number: roomNumber, business_date: businessDate, previous_type: previousType, new_type: newType, changed_by: changedByUserId || authorizedUserId, changed_by_name: changedByName, note, recipient, status: "pending" }).select("id").single();
  if (logError) console.error("Unable to create room change email audit row", logError.message);
  const result = await sendEmail({ admin: admin as any, organizationSlug, to: [recipient], subject, html: emailHtml, text, kind: "transactional", settings: brandedSettings });
  if (logRow?.id) await admin.from("housekeeping_room_change_email_log").update({ status: result.ok ? "sent" : result.skipped ? "skipped" : "failed", provider_message_id: result.id || null, last_error: result.error || null, sent_at: result.ok ? new Date().toISOString() : null }).eq("id", logRow.id);
  if (!result.ok) return json({ ok: false, error: result.error || "Email delivery failed", skipped: !!result.skipped }, result.skipped ? 200 : 502);

  const notifyUserId = changedByUserId || authorizedUserId;
  if (notifyUserId) {
    try { await admin.rpc("hotelcare_dispatch_push", { _user_ids: [notifyUserId], _title: "Reception notified", _body: `${hotelName} room ${roomNumber}: ${previousType} → ${newType}. Reception email sent successfully.`, _url: "/?tab=housekeeping", _tag: `room-type-email-${hotelId}-${roomNumber}-${businessDate}`, _event_type: "housekeeping_room_type_email_sent", _data: { hotelId, roomNumber, businessDate, previousType, newType, recipient } }); } catch (pushError) { console.warn("Room change email sent, but confirmation push could not be queued", pushError); }
  }
  return json({ ok: true, id: result.id || null, from: result.from || null, recipient, auditId: logRow?.id || null });
});
