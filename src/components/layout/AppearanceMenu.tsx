import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { useAppearanceNewTag } from "@/lib/appearanceNewTag";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const NEW_LABELS: Record<string, string> = {
  en: "New", hu: "Új", es: "Nuevo", vi: "Mới", mn: "Шинэ",
  az: "Yeni", tl: "Bago", uk: "Нове", ru: "Новое",
};

export function AppearanceMenu() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { language } = useTranslation();
  const showNew = useAppearanceNewTag();
  const newLabel = NEW_LABELS[language] ?? NEW_LABELS.en;
  const labels = language === "hu" ? { title: "Megjelenés", light: "Világos", dark: "Sötét", system: "Rendszer" }
    : language === "es" ? { title: "Apariencia", light: "Claro", dark: "Oscuro", system: "Sistema" }
    : { title: "Appearance", light: "Light", dark: "Dark", system: "System" };
  const Icon = resolvedTheme === "dark" ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={`h-11 shrink-0 sm:h-9 ${showNew ? "w-auto min-w-11 gap-1 px-2 sm:min-w-9" : "w-11 sm:w-9"}`}
          aria-label={showNew ? `${labels.title} · ${newLabel}` : labels.title}
          title={labels.title}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          {showNew && (
            <span aria-hidden="true" className="rounded-sm bg-sky-100 px-1 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-sky-800 dark:bg-sky-900 dark:text-sky-200">
              {newLabel}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{labels.title}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "light"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light"><Sun className="mr-2 h-4 w-4" />{labels.light}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon className="mr-2 h-4 w-4" />{labels.dark}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><Monitor className="mr-2 h-4 w-4" />{labels.system}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
