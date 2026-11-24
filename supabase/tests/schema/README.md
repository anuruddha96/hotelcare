# Production-schema acceptance gate (review item 12)

This draft gate is deliberately blocked until Claude/owner provides and reviews all three inputs. Existing migration syntax checks (including pglast) and lightweight CI remain necessary but are not equivalent to this gate.

- `ntak-production-baseline.sql`: sanitized schema-only snapshot of the actual deployed schema, with exact touched table columns, CHECK constraints, FKs, RLS policies, grants, functions and required role/extension dependencies. No production rows, credentials, private keys, certificates or live endpoint configuration. Include provenance and the deployed migration inventory. Review compatibility with the disposable PostgreSQL service; if Supabase-specific extensions are required, use a pinned compatible disposable image, not weakened schema substitutes.
- `ntak-production-migrations.txt`: one reviewed pending migration filename per line, in dependency order; omit already-applied migrations, comments start with #. The guest-write policy repair must be applied before or atomically with the authority-settings restriction. Include all review repairs once consolidated. Claude determines the order from actual deployment inventory.
- `ntak-production-regression.sql`: executable synthetic-fixture regression suite, adapted to the real schema without dropping or weakening constraints; assert room-status CHECK compatibility, guest policy denial/allowed legacy writes, VIZA required fields and recovery, historical corrections, finance and non-NTAK behavior. Demonstrate original failures on the baseline and passing assertions with the reviewed migrations; use disposable databases for both runs.

The workflow uses only localhost and ephemeral CI credentials. Never connect the workflow to the production database or NTAK/VIZA. No live submissions. Do not mark this gate passed until the actual reviewed snapshot and regressions execute successfully. Keep this PR draft until inputs are ready.

## Exact dump request for Claude

Provide a schema-only sanitized dump for these public tables, with real column types/defaults, NOT NULL, CHECK/unique/exclusion constraints, foreign keys, indexes, triggers, RLS and grants:

- PMS scope/lifecycle: profiles, rooms, room_types, reservations, guests, reservation_guests, reservation_room_assignments, reservation_events, room_state_periods, room_state_status_baselines.
- Reporting: ntak_settings, ntak_daily_closures, ntak_messages, ntak_message_evidence, ntak_guest_ids, ntak_event_queue, ntak_booking_queue, ntak_unit_profiles, ntak_room_type_units, viza_settings, viza_guest_events, viza_trigger_failures.
- Finance: service_catalog_items, guest_folios, reservation_folios, folio_lines, payments, pms_financial_events, pos_sales, pos_sale_lines, pos_sale_payments.

Include every actual FK target and relation referenced by the touched RPCs/policies/triggers (including organization/hotel membership and finance allocations where present), recursively until dependencies resolve; include enum/domain types, sequences, views, functions, auth.uid()/role/grant setup, and required extension definitions (including pgcrypto, btree_gist, pg_cron and Vault-compatible disposable setup). Include schema-only definitions for auth dependencies, never auth rows, Vault data, passwords, secrets, certificate/private key content or live service configuration. If a listed table has not yet been deployed, record it as absent and include its creating migration in the manifest; do not invent its definition. Use a disposable compatible Supabase/Postgres image if plain PostgreSQL cannot reproduce required extensions. Record snapshot timestamp and applied migration versions. No production data export.
