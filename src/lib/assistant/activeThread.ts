const ACTIVE_THREAD_TTL_MS = 24 * 60 * 60 * 1000;

type StoredActiveThread = {
  id: string;
  touchedAt: number;
};

function storageKey(userId: string, organizationSlug: string) {
  return `hotelcare:assistant:active-thread:${userId}:${organizationSlug}`;
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function rememberActiveAssistantThread(
  userId: string | null | undefined,
  organizationSlug: string | null | undefined,
  threadId: string | null | undefined,
) {
  if (!canUseStorage() || !userId || !organizationSlug || !threadId) return;
  const value: StoredActiveThread = { id: threadId, touchedAt: Date.now() };
  window.localStorage.setItem(storageKey(userId, organizationSlug), JSON.stringify(value));
}

export function forgetActiveAssistantThread(
  userId: string | null | undefined,
  organizationSlug: string | null | undefined,
) {
  if (!canUseStorage() || !userId || !organizationSlug) return;
  window.localStorage.removeItem(storageKey(userId, organizationSlug));
}

export function getRememberedAssistantThread(
  userId: string | null | undefined,
  organizationSlug: string | null | undefined,
): string | null {
  if (!canUseStorage() || !userId || !organizationSlug) return null;
  const key = storageKey(userId, organizationSlug);
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredActiveThread>;
    const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
    const touchedAt = Number(parsed.touchedAt);
    if (!id || !Number.isFinite(touchedAt) || Date.now() - touchedAt > ACTIVE_THREAD_TTL_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    return id;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}
