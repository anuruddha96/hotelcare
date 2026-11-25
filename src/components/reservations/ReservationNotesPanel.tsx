import { useMemo, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BedDouble, ChevronDown, ChevronRight, CigaretteOff, Cigarette, Coffee, CreditCard,
  FileText, MessageSquareQuote, ShieldCheck, StickyNote,
} from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { looksLikePrevioReservationNote, parsePrevioReservationNote } from "@/lib/previoReservationNote";

interface Props {
  specialRequests: string | null | undefined;
  internalNotes: string | null | undefined;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children == null || children === "") return null;
  return (
    <div className="grid grid-cols-[120px_1fr] sm:grid-cols-[160px_1fr] gap-3 py-1.5 border-b border-border/50 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{children}</dd>
    </div>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border/70 bg-muted/20 p-3">
      <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon} {title}
      </h4>
      {children}
    </section>
  );
}

const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

export function ReservationNotesPanel({ specialRequests, internalNotes }: Props) {
  const { t } = useTranslation();
  const [showRaw, setShowRaw] = useState(false);
  const raw = (specialRequests ?? "").trim();
  const internal = (internalNotes ?? "").trim();
  const note = useMemo(
    () => (looksLikePrevioReservationNote(raw) ? parsePrevioReservationNote(raw) : null),
    [raw],
  );

  if (!raw && !internal) return null;

  const k = (key: string) => t(`pms.notes.${key}` as any);
  const structured = note?.isStructured ? note : null;
  // Hotel-local date: a card "chargeable from" today must not wait for UTC midnight.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(new Date());
  const chargeFrom = structured?.payment.chargeableFrom ?? null;
  const chargeReady = !!chargeFrom && chargeFrom <= today;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="h-4 w-4" /> {t("pms.reservationDetail.notesRequests")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {structured && (
          <>
            {/* At-a-glance chips */}
            <div className="flex flex-wrap gap-2">
              {structured.booking.channel && <Badge className="bg-primary/10 text-primary hover:bg-primary/10">{structured.booking.channel}</Badge>}
              {structured.booking.meals && (
                <Badge variant="outline" className="gap-1"><Coffee className="h-3 w-3" />{structured.booking.meals}</Badge>
              )}
              {structured.guest.smoking && (
                <Badge variant="outline" className="gap-1">
                  {structured.guest.smoking === "Smoking" ? <Cigarette className="h-3 w-3" /> : <CigaretteOff className="h-3 w-3" />}
                  {structured.guest.smoking === "Smoking" ? k("smoking") : k("nonSmoking")}
                </Badge>
              )}
              {structured.payment.method && (
                <Badge variant="outline" className="gap-1"><CreditCard className="h-3 w-3" />{structured.payment.method}</Badge>
              )}
              {chargeFrom && (
                <Badge
                  variant="outline"
                  className={chargeReady
                    ? "border-green-600/40 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                    : "border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"}
                >
                  {chargeReady ? k("readyToCharge") : `${k("chargeableFrom")} ${fmtDate(chargeFrom)}`}
                </Badge>
              )}
            </div>

            {(structured.receptionNote || internal) && (
              <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-950/20">
                <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                  <StickyNote className="h-3.5 w-3.5" /> {t("pms.reservationDetail.internalNotes")}
                </h4>
                {structured.receptionNote && <p><span className="text-muted-foreground">{k("reception")}:</span> {structured.receptionNote}</p>}
                {internal && <p className="whitespace-pre-wrap">{internal}</p>}
              </div>
            )}

            <div className="grid gap-3 lg:grid-cols-3">
              <Section icon={<MessageSquareQuote className="h-3.5 w-3.5" />} title={k("guestRequests")}>
                {structured.guest.requests.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-4 py-1">
                    {structured.guest.requests.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                ) : (
                  <p className="py-1.5 text-muted-foreground">{k("noRequests")}</p>
                )}
              </Section>

              <Section icon={<BedDouble className="h-3.5 w-3.5" />} title={k("booking")}>
                <dl>
                  <Row label={k("room")}>{structured.booking.roomName}</Row>
                  <Row label={k("rate")}>{structured.booking.rateName}</Row>
                  <Row label={k("bookedOn")}>{structured.booking.createdAt}</Row>
                </dl>
              </Section>

              <Section icon={<CreditCard className="h-3.5 w-3.5" />} title={k("payment")}>
                <dl>
                  <Row label={k("totalPrice")}>{structured.booking.totalPrice}</Row>
                  {structured.booking.pricePerRoom !== structured.booking.totalPrice && (
                    <Row label={k("pricePerRoom")}>{structured.booking.pricePerRoom}</Row>
                  )}
                  <Row label={k("commission")}>{structured.booking.commission}</Row>
                  <Row label={k("collectedBy")}>
                    {structured.payment.collectedBy === "OTA"
                      ? `${structured.booking.channel ?? "OTA"}`
                      : structured.payment.collectedBy === "Property" ? k("property") : null}
                  </Row>
                  <Row label={k("chargeableFrom")}>{chargeFrom ? fmtDate(chargeFrom) : null}</Row>
                </dl>
              </Section>
            </div>

            {(structured.policies.cancellation || structured.policies.deposit || structured.policies.children || structured.policies.meals) && (
              <Section icon={<ShieldCheck className="h-3.5 w-3.5" />} title={k("policies")}>
                <dl>
                  <Row label={k("cancellation")}>{structured.policies.cancellation}</Row>
                  <Row label={k("deposit")}>{structured.policies.deposit}</Row>
                  <Row label={k("childrenBeds")}>{structured.policies.children}</Row>
                  <Row label={k("mealPrices")}>{structured.policies.meals}</Row>
                  {structured.policies.other.length > 0 && (
                    <Row label={k("other")}>{structured.policies.other.join(" ")}</Row>
                  )}
                </dl>
              </Section>
            )}

            {structured.extras.length > 0 && (
              <Section icon={<FileText className="h-3.5 w-3.5" />} title={k("otherDetails")}>
                <dl>
                  {structured.extras.map((extra, index) => (
                    <Row key={`${extra.label}-${index}`} label={extra.label}>{extra.value}</Row>
                  ))}
                </dl>
              </Section>
            )}
          </>
        )}

        {!structured && (
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <span className="text-muted-foreground font-medium">{t("pms.reservationDetail.specialRequests")}</span>
              <p className="mt-1 whitespace-pre-wrap break-words">{note ? note.plainText : raw || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground font-medium">{t("pms.reservationDetail.internalNotes")}</span>
              <p className="mt-1 whitespace-pre-wrap">{internal || "—"}</p>
            </div>
          </div>
        )}

        {structured && (
          <div>
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {showRaw ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {showRaw ? k("hideOriginal") : k("showOriginal")}
            </button>
            {showRaw && (
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                {structured.plainText}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ReservationNotesPanel;
