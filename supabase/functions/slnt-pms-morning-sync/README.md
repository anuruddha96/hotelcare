# SLNT morning PMS sync

Server-only daily PMS refresh for the `slnt` organization / `slnt-group` hotel.

- validates the existing Vault-backed housekeeping worker secret
- reads only active, unpaused SLNT Previo `pms_accounts`
- uses only `applied` `pms_unit_mappings`
- fetches authoritative Previo reservation data before mutating room state
- preserves same-day manual checkout/daily overrides and in-progress work
- aligns untouched room assignments with PMS checkout/daily truth
- writes `pms_sync_history` and updates the PMS account sync health fields
- scheduled accounts run sequentially from 07:00 Europe/Budapest in five-minute slots
- intentionally isolated from the RD Hotels 06:00 morning warm-up

The cron spans both possible UTC hours for 07:00 Budapest; the Edge Function performs the DST-safe local-time gate.
