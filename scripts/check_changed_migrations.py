#!/usr/bin/env python3
"""Fail CI on PostgreSQL SQL/PLpgSQL syntax errors in changed migrations.

Compares the current branch against origin/main. Uses libpg_query through
pglast for SQL statements and the PostgreSQL PL/pgSQL parser for every
CREATE FUNCTION/PROCEDURE declared LANGUAGE plpgsql.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess
import sys

from pglast import ast, parse_plpgsql, parse_sql, split

LANGUAGE = re.compile(r"\bLANGUAGE\s+['\"]?plpgsql['\"]?\b", re.IGNORECASE)


def check_migration(source: str, path: str = "<memory>") -> tuple[int, int]:
    # Parse the entire migration first: bare '$' instead of '$$' must be fatal.
    statements = parse_sql(source)
    plpgsql_count = 0
    for statement in split(source):
        nodes = parse_sql(statement)
        if not any(isinstance(node.stmt, ast.CreateFunctionStmt) for node in nodes):
            continue
        if LANGUAGE.search(statement):
            # Unlike parse_sql, this validates the body *inside* the dollar
            # quotes (declarations, BEGIN/END, control flow and SQL syntax).
            parse_plpgsql(statement)
            plpgsql_count += 1
    print(f"PASS {path}: {len(statements)} SQL statements, "
          f"{plpgsql_count} PL/pgSQL functions")
    return len(statements), plpgsql_count


def changed_migrations(base: str) -> list[Path]:
    diff = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=ACMR",
         f"{base}...HEAD", "--", "supabase/migrations"],
        check=True, capture_output=True, text=True,
    )
    return [
        p for line in diff.stdout.splitlines()
        if (p := Path(line)).suffix == ".sql"
        and p.is_file() and p.parts[:2] == ("supabase", "migrations")
    ]


def main() -> int:
    cli = argparse.ArgumentParser()
    cli.add_argument("--base", default="origin/main")
    args = cli.parse_args()
    paths = changed_migrations(args.base)
    if not paths:
        print("No changed migrations. SQL parser job passed.")
        return 0
    failed = False
    for path in paths:
        try:
            check_migration(path.read_text(encoding="utf-8"), str(path))
        except Exception as exc:
            failed = True
            print(f"FAIL {path}: {type(exc).__name__}: {exc}",
                  file=sys.stderr)
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
