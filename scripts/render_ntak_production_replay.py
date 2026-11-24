#!/usr/bin/env python3
"""Reconstruct deployed executable DDL on Claude's table-only snapshot.

No production connection, no changes to source migrations or snapshot. Duplicate
table creations are skipped only for the explicitly listed already-present
tables. Missing CHECKs are taken from the source AST, never hand rewritten.
"""
from pathlib import Path
from pglast import ast, parse_sql, split
from pglast.stream import RawStream

root = Path("supabase/migrations")
schema = Path("supabase/tests/schema")
baseline = (schema / "ntak-production-baseline.sql").read_text()
existing = {s.stmt.relation.relname for s in parse_sql(baseline) if isinstance(s.stmt, ast.CreateStmt)}
duplicates = {
 "20261123220000_ntak_phase4_room_state_periods.sql": {"room_state_periods", "room_state_status_baselines"},
 "20261123230000_ntak_phase5_walk_in_sales.sql": {"pos_sales", "pos_sale_lines", "pos_sale_payments"},
}
restored = set()
skipped_backfill = 0
for line in (schema / "ntak-production-deployed-migrations.txt").read_text().splitlines():
    name = line.strip()
    if not name or name.startswith("#"):
        continue
    assert name.endswith(".sql") and "/" not in name, name
    print(f"\\echo Replaying deployed {name}")
    for sql in split((root / name).read_text()):
        statement = parse_sql(sql)[0].stmt
        if isinstance(statement, ast.CreateStmt) and statement.relation.relname in duplicates.get(name, set()):
            table = statement.relation.relname
            assert table in existing, table
            print(f"-- {table} already exists with Claude's production constraints")
            if table == "pos_sale_lines":
                check = next(c for c in statement.tableElts if isinstance(c, ast.Constraint) and c.conname == "pos_sale_line_other_category")
                print("ALTER TABLE public.pos_sale_lines ADD " + RawStream()(check) + ";")
                restored.add(check.conname)
            continue
        if name.startswith("20260924152000_") and isinstance(statement, ast.InsertStmt):
            # Original data backfills have nothing to migrate in an empty snapshot.
            skipped_backfill += 1
            continue
        if name.startswith("20261123235000_") and isinstance(statement, ast.AlterTableStmt) and "ADD CONSTRAINT ntak_messages_resend_of_unique" in sql:
            assert "ADD CONSTRAINT ntak_messages_resend_of_unique UNIQUE (resend_of)" in baseline
            continue
        print(sql.rstrip().rstrip(";") + ";")
        if name.startswith("20261123223000_") and isinstance(statement, ast.AlterTableStmt):
            for cmd in statement.cmds:
                if isinstance(cmd.def_, ast.ColumnDef) and cmd.def_.colname == "booker_country":
                    check = next(c for c in cmd.def_.constraints if c.contype.name == "CONSTR_CHECK")
                    print("ALTER TABLE public.reservations ADD CONSTRAINT reservations_booker_country_check " + RawStream()(check) + ";")
                    restored.add("reservations_booker_country_check")
assert restored == {"pos_sale_line_other_category", "reservations_booker_country_check"}, restored
assert skipped_backfill == 4, skipped_backfill
# Restore hooks whose original installation predates the supplied inventory;
# use the actual deployed replayed trigger bodies, not test doubles.
print("""
CREATE TRIGGER acceptance_ntak_reservation_change AFTER INSERT OR UPDATE ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.ntak_on_reservation_change();
CREATE TRIGGER acceptance_viza_reservation_status AFTER UPDATE OF status ON public.reservations
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.viza_on_reservation_status();
""")
