#!/usr/bin/env bash
# Two people press "Book" for the same jacuzzi slot at the same moment.
# Session A books and keeps its transaction open for 1.5 s; session B starts
# 0.3 s later. B must wait for A and then be refused with SLOT_TAKEN: never
# two bookings at the same time. Runs after insuite_wellness_integration.sql.
# Usage: insuite_wellness_concurrency.sh   (uses the usual PG* environment)
set -euo pipefail

slot="((((now() AT TIME ZONE 'Europe/Budapest')::date + 2) + time '15:00') AT TIME ZONE 'Europe/Budapest')"
resource="(SELECT id FROM public.insuite_wellness_resources WHERE hotel_id = 'channex-test-property' AND kind = 'jacuzzi')"
out=$(mktemp -d)

psql -X -q -v ON_ERROR_STOP=1 -c "BEGIN;
  SELECT public.insuite_wellness_book($resource, $slot, 2, 'reception', NULL, NULL, 'Guest A');
  SELECT pg_sleep(1.5);
  COMMIT;" > "$out/a.log" 2>&1 &
pid_a=$!
sleep 0.3
if psql -X -q -v ON_ERROR_STOP=1 -c "SELECT public.insuite_wellness_book($resource, $slot, 2, 'reception', NULL, NULL, 'Guest B');" > "$out/b.log" 2>&1; then
  echo "FAIL: the second booking for the same slot succeeded"; cat "$out/b.log"; exit 1
fi
wait "$pid_a" || { echo "FAIL: the first booking failed"; cat "$out/a.log"; exit 1; }
grep -q 'SLOT_TAKEN' "$out/b.log" || { echo "FAIL: expected SLOT_TAKEN"; cat "$out/b.log"; exit 1; }
count=$(psql -X -At -c "SELECT count(*) FROM public.insuite_wellness_bookings WHERE resource_id = $resource AND starts_at = $slot AND status = 'booked'")
[ "$count" = "1" ] || { echo "FAIL: $count bookings for one slot"; exit 1; }
echo 'insuite wellness concurrency: second simultaneous booking refused, one booking stored'
