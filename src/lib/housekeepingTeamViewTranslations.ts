import {
  getHousekeepingAutomationLanguage,
  type HousekeepingAutomationLanguage,
} from '@/lib/housekeepingAutomationTranslations';

const translations = {
  en: {
    todayTitle: 'Today’s assignments · prepared yesterday',
    viewAssignments: 'View assignments',
    dismissToday: 'Dismiss today’s assignment summary',
    dismissTomorrow: 'Dismiss tomorrow’s housekeeping summary',
    releaseSummary: 'Housekeeping release summary',
  },
  hu: {
    todayTitle: 'Mai beosztások · tegnap előkészítve',
    viewAssignments: 'Beosztások megtekintése',
    dismissToday: 'A mai beosztási összefoglaló bezárása',
    dismissTomorrow: 'A holnapi takarítási összefoglaló bezárása',
    releaseSummary: 'Takarítási kiadási összefoglaló',
  },
  es: {
    todayTitle: 'Asignaciones de hoy · preparadas ayer',
    viewAssignments: 'Ver asignaciones',
    dismissToday: 'Cerrar el resumen de asignaciones de hoy',
    dismissTomorrow: 'Cerrar el resumen de limpieza de mañana',
    releaseSummary: 'Resumen de publicación de limpieza',
  },
  vi: {
    todayTitle: 'Phân công hôm nay · đã chuẩn bị hôm qua',
    viewAssignments: 'Xem phân công',
    dismissToday: 'Đóng tóm tắt phân công hôm nay',
    dismissTomorrow: 'Đóng tóm tắt buồng phòng ngày mai',
    releaseSummary: 'Tóm tắt phát hành phân công buồng phòng',
  },
  mn: {
    todayTitle: 'Өнөөдрийн хуваарь · өчигдөр бэлтгэсэн',
    viewAssignments: 'Хуваарийг харах',
    dismissToday: 'Өнөөдрийн хуваарийн тоймыг хаах',
    dismissTomorrow: 'Маргаашийн цэвэрлэгээний тоймыг хаах',
    releaseSummary: 'Өрөө цэвэрлэгээний олголтын тойм',
  },
  ru: {
    todayTitle: 'Задания на сегодня · подготовлены вчера',
    viewAssignments: 'Посмотреть задания',
    dismissToday: 'Закрыть сводку заданий на сегодня',
    dismissTomorrow: 'Закрыть сводку уборки на завтра',
    releaseSummary: 'Сводка выдачи заданий housekeeping',
  },
  uk: {
    todayTitle: 'Завдання на сьогодні · підготовлені вчора',
    viewAssignments: 'Переглянути завдання',
    dismissToday: 'Закрити підсумок завдань на сьогодні',
    dismissTomorrow: 'Закрити підсумок прибирання на завтра',
    releaseSummary: 'Підсумок видачі завдань housekeeping',
  },
} satisfies Record<HousekeepingAutomationLanguage, Record<string, string>>;

export type HousekeepingTeamViewTextKey = keyof typeof translations.en;

export function housekeepingTeamViewText(
  key: HousekeepingTeamViewTextKey,
  language: HousekeepingAutomationLanguage = getHousekeepingAutomationLanguage(),
): string {
  return translations[language]?.[key] ?? translations.en[key];
}
