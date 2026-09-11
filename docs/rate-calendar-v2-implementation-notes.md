# Implementation boundaries

This branch intentionally leaves pricing and PMS behaviour untouched. The following files are not modified by this first V2 pass: `RateStrategyGrid.tsx`, revenue analytics, rate publishing, Previo sync, Supabase queries, automation rules and occupancy calculations.

The responsive behaviour is implemented as a progressive enhancement on top of the existing grid, using its stable `data-training="revenue-grid"` marker. This makes the rollout easy to review and revert while preserving all existing revenue functionality.
