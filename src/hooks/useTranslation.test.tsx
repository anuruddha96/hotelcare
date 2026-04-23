import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TranslationProvider, useTranslation } from "./useTranslation";

const supportedLanguages = ["en", "hu", "es", "vi", "mn"] as const;

const expectedLabels = {
  en: ["Bed Linen Change", "Full Room Cleaning", "Collect Extra Towels", "Title", "Description", "Priority", "Status", "Assigned To", "Created By"],
  hu: ["Ágyneműcsere", "Teljes szobatakarítás", "Extra törölközők összegyűjtése", "Cím", "Leírás", "Prioritás", "Állapot", "Hozzárendelve", "Létrehozta"],
  es: ["Cambio de ropa de cama", "Limpieza completa de habitación", "Recoger toallas extra", "Título", "Descripción", "Prioridad", "Estado", "Asignado a", "Creado por"],
  vi: ["Thay ga giường", "Dọn phòng đầy đủ", "Thu khăn tắm thêm", "Tiêu đề", "Mô tả", "Mức ưu tiên", "Trạng thái", "Giao cho", "Tạo bởi"],
  mn: ["Ор дэр солих", "Өрөө бүрэн цэвэрлэх", "Нэмэлт алчуур цуглуулах", "Гарчиг", "Тайлбар", "Тэргүүлэх зэрэг", "Төлөв", "Хариуцагч", "Үүсгэсэн"],
};

const translationKeys = [
  "roomCard.bedLinenChange",
  "roomCard.roomCleaning",
  "roomCard.collectExtraTowels",
  "tickets.title",
  "tickets.description",
  "tickets.priority",
  "tickets.status",
  "tickets.assignedTo",
  "tickets.createdBy",
];

function MobileTranslationProbe() {
  const { t } = useTranslation();

  return (
    <section aria-label="mobile i18n smoke">
      {translationKeys.map((key) => (
        <span key={key}>{t(key)}</span>
      ))}
    </section>
  );
}

function LanguageSetter({ lang }: { lang: string }) {
  const { setLanguage } = useTranslation();

  return <button onClick={() => setLanguage(lang as never)}>set language</button>;
}

afterEach(() => {
  localStorage.clear();
});

describe("i18n mobile smoke", () => {
  it.each(supportedLanguages)("renders room-card labels and ticket fields in %s", (lang) => {
    window.innerWidth = 390;
    localStorage.setItem("preferred_language", lang);

    render(
      <TranslationProvider>
        <MobileTranslationProbe />
      </TranslationProvider>
    );

    for (const label of expectedLabels[lang]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    for (const key of translationKeys) {
      expect(screen.queryByText(key)).not.toBeInTheDocument();
    }
  });

  it("keeps the selected language after Android standalone/PWA remount", () => {
    window.innerWidth = 390;
    window.matchMedia = (query: string) => ({
      matches: query.includes("display-mode: standalone"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });

    const firstRender = render(
      <TranslationProvider>
        <LanguageSetter lang="hu" />
      </TranslationProvider>
    );

    act(() => screen.getByRole("button", { name: "set language" }).click());
    expect(localStorage.getItem("preferred_language")).toBe("hu");
    expect(localStorage.getItem("preferred-language")).toBe("hu");

    firstRender.unmount();

    render(
      <TranslationProvider>
        <MobileTranslationProbe />
      </TranslationProvider>
    );

    expect(screen.getByText("Ágyneműcsere")).toBeInTheDocument();
    expect(screen.queryByText("Bed Linen Change")).not.toBeInTheDocument();
  });
});