# 195a2daa-26b4-42e0-8ee1-c0c157972991 — Guidelines

## Components

The design system exports these components — import them from `@ws-ilhrr5tzpy4crvboqzzj/195a2daa-26b4-42e0-8ee1-c0c157972991` and compose them before building anything from scratch:

`AiProviderStatus`, `AnalystPanel`, `AssistantAccessRequests`, `AssistantChat`, `AssistantLauncher`, `BillingSettingsPanel`, `BulkPriceEditor`, `CompetitorRatePanel`, `DayChangesSheet`, `DemandPricingPanel`, `DemandRateOutlookChart`, `EmailSettingsPanel`, `EventsPanel`, `MarketSignalsPanel`, `MonthPerformanceHeader`, `MorningDigestPanel`, `OccupancyPickupChart`, `PMSConfigurationManagement`, `PercentAdjustmentTab`, `PhotoAdjuster`, `PickupAutomationRules`, `PickupHorizonChart`, `PickupMovementBoard`, `PickupRangeSummary`, `PmsSyncStatus`, `PrevioRatePlanMapping`, `PricingDriverChips`, `QuickRateAdjustDialog`, `RateActivityPanel`, `RateCellHistory`, `RateStrategyGrid`, `RecommendationOutcomesPanel`, `RestaurantReservations`, `RevenueEngineControls`, `RevenueIntelligencePanel`, `RevenuePulsePanel`, `RevenueSyncHistory`, `RevenueToolsBar`, `RoomsSetupTab`, `SegmentPerformancePanel`, `StrategyCalendar`, `StrategyRecommendationsPanel`, `TodaysBookingsPanel`, `TodaysSalesAdrGoal`, `YearOverYearPanel`

Per-component details (import stanzas, props, variants, examples) live in `.lovable/rules/libraries/{slug}/components.md` — on disk, not auto-loaded. Read that file or the component source when the name alone isn't enough.

## Theme Files

The design system's theme is delivered through the following files. The author's original source files carry the full wiring the design system needs — variable declarations, framework-specific directives, provider objects, etc. — and are the canonical import target.

- `@ws-ilhrr5tzpy4crvboqzzj/195a2daa-26b4-42e0-8ee1-c0c157972991/index.css` (source — preferred import)
- `@ws-ilhrr5tzpy4crvboqzzj/195a2daa-26b4-42e0-8ee1-c0c157972991/dist/tokens.css` (auto-generated flat list of CSS custom properties — a raw-values fallback only; does NOT carry framework-specific wiring that the source files above provide)

