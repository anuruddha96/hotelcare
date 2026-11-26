// The outbox contains room-level operational data only, never guest names.
export interface BreakfastPushRow {
  id: string;
  signal_id: string;
  organization_slug: string;
  hotel_id: string;
  user_id: string;
  assignment_id: string | null;
  room_number: string;
  preferred_language: string;
  kind: "arrival" | "correction";
  claim_token: string;
  tag: string;
  guests_seen: number | null;
  guests_expected: number | null;
  window_ends_at: string | null;
}

type Labels = { room: string; rooms: string; breakfast: string; breakfastMany: string; hint: string; partial: string; partialMany: string; update: string; correction: string };
const labels: Record<string, Labels> = {
  en: { room: "Room", rooms: "Rooms", breakfast: "guest at breakfast", breakfastMany: "guests at breakfast", hint: "Good moment for the daily clean. Please knock before entering.", partial: "{seen} of {expected} guests at breakfast. Someone may still be inside, please knock.", partialMany: "Someone may still be in a room. Please knock before entering.", update: "update", correction: "Breakfast record corrected. Please treat the room as occupied and knock before entering." },
  hu: { room: "Szoba", rooms: "Szobák", breakfast: "a vendég reggelizik", breakfastMany: "a vendégek reggeliznek", hint: "Most jó alkalom a takarításra. Belépés előtt kérjük, kopogjon.", partial: "{expected} vendégből {seen} reggelizik. Lehet, hogy valaki még a szobában van, kérjük, kopogjon.", partialMany: "Lehet, hogy még van valaki a szobában. Belépés előtt kérjük, kopogjon.", update: "frissítés", correction: "A reggeli bejegyzést javították. Kezelje a szobát foglaltként, és belépés előtt kopogjon." },
  es: { room: "Habitación", rooms: "Habitaciones", breakfast: "huésped en el desayuno", breakfastMany: "huéspedes desayunando", hint: "Buen momento para limpiar. Llame a la puerta antes de entrar.", partial: "{seen} de {expected} huéspedes están desayunando. Puede que alguien siga dentro; llame a la puerta.", partialMany: "Puede que alguien siga en una habitación. Llame a la puerta antes de entrar.", update: "actualización", correction: "Se corrigió el registro de desayuno. Trate la habitación como ocupada y llame a la puerta antes de entrar." },
  vi: { room: "Phòng", rooms: "Các phòng", breakfast: "khách đang ăn sáng", breakfastMany: "khách đang ăn sáng", hint: "Thời điểm phù hợp để dọn phòng. Vui lòng gõ cửa trước khi vào.", partial: "{seen}/{expected} khách đang ăn sáng. Có thể vẫn còn người trong phòng, vui lòng gõ cửa.", partialMany: "Có thể vẫn còn người trong phòng. Vui lòng gõ cửa trước khi vào.", update: "cập nhật", correction: "Đã sửa thông tin bữa sáng. Hãy xem phòng như đang có khách và gõ cửa trước khi vào." },
  mn: { room: "Өрөө", rooms: "Өрөөнүүд", breakfast: "зочин өглөөний цай ууж байна", breakfastMany: "зочид өглөөний цай ууж байна", hint: "Цэвэрлэхэд тохиромжтой үе. Орохын өмнө хаалга тогшино уу.", partial: "{expected} зочны {seen} нь өглөөний цай ууж байна. Өрөөнд хүн байж магадгүй, хаалга тогшино уу.", partialMany: "Өрөөнд хүн байж магадгүй. Орохын өмнө хаалга тогшино уу.", update: "шинэчлэлт", correction: "Өглөөний цайны бүртгэлийг заслаа. Өрөөг хүнтэй гэж үзэж, орохын өмнө хаалга тогшино уу." },
  az: { room: "Otaq", rooms: "Otaqlar", breakfast: "qonaq səhər yeməyindədir", breakfastMany: "qonaqlar səhər yeməyindədir", hint: "Təmizlik üçün münasib vaxtdır. Daxil olmadan əvvəl qapını döyün.", partial: "{expected} qonaqdan {seen} nəfəri səhər yeməyindədir. Otaqda kimsə ola bilər, qapını döyün.", partialMany: "Otaqda kimsə ola bilər. Daxil olmadan əvvəl qapını döyün.", update: "yenilənmə", correction: "Səhər yeməyi qeydi düzəldildi. Otağı dolu hesab edin və daxil olmadan əvvəl qapını döyün." },
  tl: { room: "Kuwarto", rooms: "Mga kuwarto", breakfast: "nag-aalmusal ang bisita", breakfastMany: "nag-aalmusal ang mga bisita", hint: "Magandang oras para maglinis. Kumatok muna bago pumasok.", partial: "{seen} sa {expected} bisita ang nag-aalmusal. Maaaring may tao pa sa kuwarto, kumatok muna.", partialMany: "Maaaring may tao pa sa kuwarto. Kumatok muna bago pumasok.", update: "update", correction: "Itinama ang tala ng almusal. Ituring na may tao sa kuwarto at kumatok muna bago pumasok." },
  uk: { room: "Номер", rooms: "Номери", breakfast: "гість на сніданку", breakfastMany: "гості на сніданку", hint: "Вдалий час для прибирання. Будь ласка, постукайте перед входом.", partial: "{seen} з {expected} гостей на сніданку. У номері ще може бути хтось, постукайте.", partialMany: "У номері ще може бути хтось. Будь ласка, постукайте перед входом.", update: "оновлення", correction: "Запис про сніданок виправлено. Вважайте номер зайнятим і постукайте перед входом." },
  ru: { room: "Номер", rooms: "Номера", breakfast: "гость на завтраке", breakfastMany: "гости на завтраке", hint: "Подходящий момент для уборки. Пожалуйста, постучите перед входом.", partial: "{seen} из {expected} гостей на завтраке. В номере ещё может кто-то быть, постучите.", partialMany: "В номере ещё может кто-то быть. Пожалуйста, постучите перед входом.", update: "обновление", correction: "Запись о завтраке исправлена. Считайте номер занятым и постучите перед входом." },
};

export function groupBreakfastPushRows(rows: BreakfastPushRow[]): BreakfastPushRow[][] {
  const groups = new Map<string, BreakfastPushRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.claim_token, row.organization_slug, row.hotel_id, row.user_id, row.tag, row.kind]);
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  return [...groups.values()];
}

export function buildBreakfastPush(rows: BreakfastPushRow[], now = Date.now()) {
  if (!rows.length) return null;
  const first = rows[0];
  if (rows.some(row => row.user_id !== first.user_id || row.organization_slug !== first.organization_slug || row.hotel_id !== first.hotel_id || row.tag !== first.tag || row.kind !== first.kind)) throw new Error("Mixed breakfast push recipients");
  const raw = first.preferred_language?.toLowerCase().split(/[-_]/)[0] || "en";
  const lang = raw === "fil" ? "tl" : (Object.hasOwn(labels, raw) ? raw : "en");
  const t = labels[lang];
  const rooms = [...new Set(rows.map(r => r.room_number))];
  const roomList = new Intl.ListFormat(lang === "tl" ? "fil" : lang, { style: "long", type: "conjunction" }).format(rooms);
  const correction = first.kind === "correction";
  const partial = rows.some(r => r.guests_expected != null && r.guests_seen != null && r.guests_seen < r.guests_expected);
  const title = (rooms.length > 1 ? t.rooms : t.room) + " " + roomList + ": " + (correction ? t.update : rooms.length > 1 ? t.breakfastMany : t.breakfast);
  const body = correction ? t.correction : partial
    ? rooms.length > 1 ? t.partialMany : t.partial.replace("{seen}", String(first.guests_seen)).replace("{expected}", String(first.guests_expected))
    : t.hint;
  const expiry = correction ? 600 : Math.floor((Math.min(...rows.map(r => Date.parse(r.window_ends_at ?? ""))) - now) / 1000);
  if (!Number.isFinite(expiry) || expiry <= 0) return null;
  return {
    userIds: [first.user_id], title, body, tag: first.tag,
    url: "/" + encodeURIComponent(first.organization_slug) + "?tab=housekeeping" + (first.assignment_id ? "&breakfastAssignment=" + encodeURIComponent(first.assignment_id) : ""),
    eventType: correction ? "housekeeping_breakfast_correction" : "housekeeping_breakfast",
    ttlSeconds: Math.min(3600, expiry), urgency: "normal" as const,
  };
}

// A secret-authenticated worker is the only caller. Revalidate each claim
// immediately before calling the existing push endpoint. A success means at
// least one subscription accepted the push, not merely HTTP 200 / queued.
export async function dispatchBreakfastPushes(admin: any, projectUrl: string, dispatchSecret: string, send: typeof fetch = fetch) {
  const { data: claimed, error } = await admin.rpc("claim_breakfast_pushes", { _limit: 10 });
  if (error) throw new Error("Breakfast outbox claim failed");
  const groups = groupBreakfastPushRows((claimed ?? []) as BreakfastPushRow[]);
  let accepted = 0;
  let failed = 0;
  // Preserve ordering within each tag; different recipient/tag groups may
  // progress concurrently. At most six HTTP sends are in flight.
  const lanes = new Map<string, BreakfastPushRow[][]>();
  for (const group of groups) {
    const key = JSON.stringify([group[0].user_id, group[0].tag]);
    const lane = lanes.get(key) ?? [];
    lane.push(group);
    lanes.set(key, lane);
  }
  const work = [...lanes.values()];
  let cursor = 0;
  const run = async () => {
    while (cursor < work.length) {
      const lane = work[cursor++];
      for (const group of lane) {
        const first = group[0];
        let delivered = false;
        let ids = group.map(row => row.id);
        try {
          const { data: fresh, error: validationError } = await admin.rpc("revalidate_breakfast_pushes", { _claim_token: first.claim_token, _ids: ids });
          if (validationError) throw new Error("Breakfast push eligibility unavailable");
          const rows = (fresh ?? []) as BreakfastPushRow[];
          ids = rows.map(row => row.id);
          const payload = buildBreakfastPush(rows);
          if (payload) {
            const response = await send(projectUrl.replace(/\/$/, "") + "/functions/v1/send-push-notification", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-hotelcare-push-secret": dispatchSecret },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(8000),
            });
            const result = await response.json().catch(() => null);
            delivered = response.ok && typeof result?.delivered === "number" && result.delivered > 0;
          }
        } catch {
          // A timeout may already have reached the push service. Never retry
          // an uncertain external delivery automatically.
          delivered = false;
        }
        if (ids.length) {
          const { error: finishError } = await admin.rpc("finish_breakfast_pushes", { _claim_token: first.claim_token, _ids: ids, _delivered: delivered });
          if (finishError) { failed += ids.length; continue; }
          if (delivered) accepted += ids.length;
          else failed += ids.length;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, work.length) }, run));
  return { accepted, failed };
}
