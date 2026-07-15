## Add Ukrainian (uk) language support

Add Ukrainian as a supported UI language across the app for all roles (housekeepers, managers, admins, etc.), matching how existing languages (en/hu/es/vi/mn/az/tl) are wired.

### 1. Language switcher & type system
- `src/components/dashboard/LanguageSwitcher.tsx`: add `{ code: 'uk', name: 'Українська', flag: '🇺🇦' }` to the `languages` array.
- `src/hooks/useTranslation.tsx`: extend the `Language` union type to include `'uk'` and register the Ukrainian dictionary.
- `src/components/training/v2/types.ts`: add `'uk'` to `LangCode` and make `uk?: string` available on `I18nText`.
- Any other place enumerating supported language codes (memory index note, `preferred_language` handling, etc.) — codebase-wide sweep to catch `'en' | 'hu' | 'es' | 'vi' | 'mn' | 'az' | 'tl'` unions.

### 2. Translation dictionaries
Add a `uk` entry to every translation map. Files to update:
- `src/hooks/useTranslation.tsx` (core `translations` object)
- `src/lib/expanded-translations.ts`
- `src/lib/highlighted-translations.ts`
- `src/lib/screen-translations.ts`
- `src/lib/breakfast-translations.ts`
- `src/lib/guest-minibar-translations.ts`
- `src/lib/linen-item-i18n.ts`
- `src/lib/location-translations.ts`
- `src/lib/maintenance-translations.ts`
- `src/lib/notification-translations.ts`
- `src/lib/pms-translations.ts`
- `src/lib/purchase-invoice-translations.ts`
- `src/lib/room-overview-translations.ts`
- `src/lib/training-translations.ts`
- `src/lib/translation-utils.ts` (fallback logic if it hardcodes language list)

Approach: for each key that currently has en/hu/es/vi/mn/az/tl variants, add a `uk` string. Translations will be produced natively (professional Ukrainian for hotel-operations vocabulary — housekeeping, checkout, maintenance, minibar, breakfast, reception, revenue, training). Where a key currently lacks some non-EN languages, `uk` will be added alongside the existing set and the runtime fallback to English remains.

### 3. Backend edge functions with language maps
- `supabase/functions/translate-note/index.ts`: add `uk: "Ukrainian"` to `languageNames`.
- Grep other edge functions for similar language dictionaries (e.g. notification/email/SMS senders) and add `uk` where present.

### 4. Training v2 curricula
Curriculum step titles/bodies use `I18nText`. Since `uk` is optional on `I18nText`, existing curricula keep working (fall back to English). To give Ukrainian housekeepers/managers a translated tour, add `uk` strings to:
- `src/components/training/v2/curricula/housekeeper.ts`
- `src/components/training/v2/curricula/manager*.ts` (all manager modules)
- `src/components/training/v2/curricula/admin-pms-overview.ts`
- `src/components/training/v2/curricula/autoAssignPromo.ts`
- Header/label constants in `TrainingHelpButtonV2.tsx` and any other `txt(...)` maps.

### 5. Persistence
No schema changes needed. `profiles.preferred_language` is a free-text column; storing `'uk'` works with existing `useLanguagePreference` hook. Verify no CHECK constraint restricts allowed codes (quick DB check during build).

### 6. Verification
- Build passes (tsgo).
- Switching to Українська in the header updates: dashboard, housekeeper room cards, manager Team View, PMS labels, maintenance tickets, breakfast, minibar, training tooltips.
- `preferred_language='uk'` persists across reload.
- Run `useTranslation.test.tsx` to confirm no regressions; extend it with a `uk` smoke assertion.

### Notes for the user
- Ukrainian strings will be written by the AI (not a professional translator). If you have a preferred glossary for specific hotel terms (e.g. "Checkout room", "Daily", "DND"), share it and it will be applied; otherwise standard hospitality Ukrainian is used.
- Emoji flag used: 🇺🇦.
