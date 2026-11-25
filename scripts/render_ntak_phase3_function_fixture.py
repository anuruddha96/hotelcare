#!/usr/bin/env python3
"""Render only the Phase-3 NTAK queue helper needed for real PG acceptance.

All code is loaded from the *existing*, reviewed migration without editing it.
The new activation migration replaces pms_guest_transition/pms_queue_guest_viza;
the original NTAK event queuer is kept unchanged.
"""
from pathlib import Path
import re
from pglast import split

source = Path("supabase/migrations/20261123193100_ntak_phase3_guest_lifecycle.sql").read_text(encoding="utf8")
name = "pms_enqueue_guest_ntak"
functions = [
    statement for statement in split(source)
    if re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\." + name + r"\s*\(", statement, re.I)
]
if len(functions) != 1:
    raise SystemExit(f"Expected one {name}, found {len(functions)}")
print(functions[0].rstrip().rstrip(";") + ";")
