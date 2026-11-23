#!/usr/bin/env python3
"""Generate a *test-only* finance-core DDL fixture from the applied migration.

The production September migration is immutable. CI starts from empty tables,
so omit its legacy-data backfill INSERT statements; those were designed for
real production data and PostgreSQL can infer untyped DISTINCT NULL as text
without the full legacy schema. All tables, functions, grants and RLS clauses
are preserved verbatim for the isolated real-PostgreSQL acceptance test.
"""
from pathlib import Path
from pglast import ast, parse_sql, split

source = Path("supabase/migrations/20260924152000_pms_financial_core_phase1.sql").read_text(encoding="utf-8")
kept = 0
skipped = 0
for statement in split(source):
    stmts = parse_sql(statement)
    if stmts and isinstance(stmts[0].stmt, ast.InsertStmt):
        skipped += 1
        continue
    print(statement.rstrip().rstrip(";") + ";\n")
    kept += 1
if skipped != 4:
    raise SystemExit(f"Refusing to generate fixture: expected 4 legacy INSERT backfills; got {skipped}")
print(f"-- Test-only finance core fixture: {kept} original DDL statements, {skipped} data backfills excluded.")
