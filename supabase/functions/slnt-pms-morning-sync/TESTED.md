Live validation before scheduling on 2026-09-13:

- SLNT PMS 1: 9/9 mapped rooms updated; 3 checkout; 5 daily; 1 mapped room without a live reservation; 0 assignment corrections.
- SLNT PMS 2: 52/52 mapped rooms updated; 14 checkout; 35 daily; 1 not-arrived; 0 missing live reservation matches; 0 assignment corrections.

Both runs returned HTTP 200 using the server worker path and the Vault-backed worker secret. The cron remained disabled during validation.
