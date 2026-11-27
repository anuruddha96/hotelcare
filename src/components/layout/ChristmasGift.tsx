import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "@/hooks/useTranslation";
import { christmasGiftEligibility, christmasGiftStorageKey, getChristmasGiftCopy } from "@/lib/christmasGift";
import "./christmasGift.css";

const dismissedInMemory = new Set<string>();
function alreadyDismissed(key: string) {
  try { return dismissedInMemory.has(key) || localStorage.getItem(key) === "1"; }
  catch { return dismissedInMemory.has(key); }
}

function SantaScene({ opened }: { opened: boolean }) {
  return (
    <svg viewBox="0 0 360 245" className="hc-gift-scene" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hc-santa-sky" x2="0" y2="1"><stop stopColor="#0d2942"/><stop offset="1" stopColor="#22565e"/></linearGradient>
        <radialGradient id="hc-gift-glow"><stop stopColor="#fff4b1" stopOpacity=".9"/><stop offset="1" stopColor="#fff4b1" stopOpacity="0"/></radialGradient>
      </defs>
      <rect width="360" height="245" rx="26" fill="url(#hc-santa-sky)"/>
      <circle cx="286" cy="50" r="24" fill="#fff3c9" opacity=".92"/>
      <path d="M0 205Q65 174 130 200T250 195T360 190V245H0Z" fill="#e2f0f3"/>
      {[34, 309].map((x,i) => <g key={x} transform={`translate(${x} ${i ? 95 : 87})`}><path d="M0 0L-30 65H-15L-37 100H-18L-43 135H43L18 100H37L15 65H30Z" fill="#185449"/><path d="M0 0L-20 44Q0 33 20 44Z M-18 80Q0 66 18 80L28 98Q0 87-28 98Z" fill="#e2f0f3"/></g>)}
      {Array.from({ length: 20 }, (_,i) => <circle key={i} className="hc-gift-flake" cx={(i*73+13)%350} cy={(i*31+8)%200} r={1+i%3*.5} fill="#fff" style={{animationDelay:`-${i*.47}s`}}/>)}
      <ellipse cx="176" cy="218" rx="88" ry="12" fill="#b4d2da"/>
      <g className="hc-santa-bob">
        <path d="M118 165Q97 168 96 143Q96 124 117 123" fill="none" stroke="#b92334" strokeWidth="26" strokeLinecap="round"/>
        <circle cx="112" cy="128" r="12" fill="#fff4df"/>
        <rect x="134" y="188" width="31" height="29" rx="11" fill="#273242"/><rect x="181" y="188" width="31" height="29" rx="11" fill="#273242"/>
        <path d="M115 168Q115 116 171 116Q224 116 224 171L216 198Q169 211 122 198Z" fill="#d33542"/>
        <path d="M121 190Q171 200 219 190" fill="none" stroke="#fff5df" strokeWidth="10" strokeLinecap="round"/>
        <path d="M119 170Q171 181 222 170" fill="none" stroke="#293442" strokeWidth="13"/>
        <rect x="160" y="165" width="23" height="20" rx="4" fill="#f3cb66"/><rect x="166" y="170" width="11" height="10" rx="2" fill="#293442"/>
        <circle cx="170" cy="100" r="43" fill="#ffdab8"/>
        <circle cx="127" cy="101" r="9" fill="#ffdab8"/><circle cx="212" cy="101" r="9" fill="#ffdab8"/>
        <path d="M129 107Q132 149 170 153Q209 149 211 107Q196 118 186 108Q170 125 153 108Q143 118 129 107Z" fill="#fff7e8"/>
        <circle cx="154" cy="97" r="3.7" fill="#253244"/><circle cx="186" cy="97" r="3.7" fill="#253244"/>
        <circle cx="145" cy="107" r="6" fill="#ee9293" opacity=".8"/><circle cx="195" cy="107" r="6" fill="#ee9293" opacity=".8"/>
        <ellipse cx="170" cy="106" rx="7" ry="5" fill="#e9a98e"/>
        <path d="M160 124Q170 133 180 124" stroke="#a73e45" strokeWidth="3" strokeLinecap="round" fill="none"/>
        <path d="M127 77Q129 20 183 30Q211 34 230 65L204 58L206 82Z" fill="#d33542"/>
        <circle cx="230" cy="65" r="12" fill="#fff7e8"/>
        <rect x="122" y="73" width="93" height="17" rx="9" fill="#fff7e8"/>
        <path d="M211 137Q238 141 249 156" stroke="#c72d3d" strokeWidth="25" strokeLinecap="round" fill="none"/>
        <circle cx="250" cy="157" r="12" fill="#fff7e8"/>
      </g>
      <g transform="translate(224 132)">
        <circle cx="34" cy="32" r="68" fill="url(#hc-gift-glow)" className={opened ? "hc-gift-burst" : "hc-gift-glow"}/>
        <g className={opened ? "hc-gift-box-open" : "hc-gift-box"}>
          <rect x="4" y="24" width="60" height="52" rx="5" fill="#e7b94f"/>
          <rect x="28" y="24" width="13" height="52" fill="#b92b43"/>
          <g className={opened ? "hc-gift-lid-open" : ""}>
            <rect x="0" y="15" width="68" height="16" rx="4" fill="#ffdc7f"/>
            <rect x="28" y="15" width="13" height="16" fill="#d33542"/>
            <path d="M34 16C8 16 11-7 26 2Q33 5 34 16C60 16 57-7 42 2Q35 5 34 16Z" fill="none" stroke="#d33542" strokeWidth="6"/>
          </g>
        </g>
        {opened && <g className="hc-gift-note-pop"><rect x="14" y="-25" width="43" height="29" rx="4" fill="#fff8e4"/><path d="M19-20L35-9L52-20" stroke="#d33542" strokeWidth="2" fill="none"/><path d="M35-6c-8-5-7-10-3-10l3 2 3-2c4 0 5 5-3 10" fill="#d33542"/></g>}
      </g>
      {opened && Array.from({length: 12}, (_,i) => <path key={i} className="hc-gift-star" style={{animationDelay:`${i*.05}s`}} transform={`translate(${55+i*23} ${30+(i*29)%80})`} d="M0-6L2-2L6 0L2 2L0 6L-2 2L-6 0L-2-2Z" fill={i%2 ? "#f5ce75" : "#fff8e4"}/>)}
    </svg>
  );
}

export function ChristmasGift({ userId, nickname, preferredLanguage }: { userId: string; nickname?: string | null; preferredLanguage?: string | null }) {
  const { language } = useTranslation();
  const copy = getChristmasGiftCopy(preferredLanguage || language);
  const [day, setDay] = useState(() => christmasGiftEligibility(nickname));
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  const [openedKey, setOpenedKey] = useState<string | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setDay(christmasGiftEligibility(nickname));
    sync();
    const timer = window.setInterval(sync, 30_000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", sync); document.removeEventListener("visibilitychange", sync); };
  }, [nickname]);
  const key = day && day === christmasGiftEligibility(nickname) ? christmasGiftStorageKey(userId, day) : null;
  const rehearsal = nickname?.trim().toLowerCase() === "anu_000" && day !== "2026-12-25";
  useEffect(() => {
    if (!key || (!rehearsal && alreadyDismissed(key))) return;
    const timer = window.setTimeout(() => {
      if (rehearsal || !alreadyDismissed(key)) setVisibleKey(key);
    }, 1400);
    const onStorage = (event: StorageEvent) => { if (!rehearsal && event.key === key && event.newValue === "1") setDismissedKey(key); };
    window.addEventListener("storage", onStorage);
    return () => { window.clearTimeout(timer); window.removeEventListener("storage", onStorage); };
  }, [key, rehearsal]);
  const dismiss = () => {
    if (!key) return;
    if (!rehearsal) {
      dismissedInMemory.add(key);
      try { localStorage.setItem(key, "1"); } catch { /* private browsing */ }
    }
    setDismissedKey(key);
  };
  if (!key || key !== visibleKey || key === dismissedKey || (!rehearsal && alreadyDismissed(key))) return null;
  const opened = openedKey === key;
  return (
    <Dialog.Root open onOpenChange={next => { if (!next) dismiss(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="hc-gift-overlay"/>
        <Dialog.Content className="hc-gift-dialog">
          <div className="hc-gift-brand">HOTELCARE · 2026</div>
          <SantaScene opened={opened}/>
          <Dialog.Title className="hc-gift-title">{opened ? copy.greeting : copy.title}</Dialog.Title>
          <Dialog.Description className={opened ? "hc-gift-message" : "hc-gift-intro"}>{opened ? copy.note : copy.intro}</Dialog.Description>
          {opened && <p className="hc-gift-signature">{copy.from}</p>}
          <button type="button" className="hc-gift-primary" onClick={() => opened ? dismiss() : setOpenedKey(key)}>{opened ? copy.close : copy.open}</button>
          {!opened && <Dialog.Close asChild><button type="button" className="hc-gift-skip">{copy.skip}</button></Dialog.Close>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
