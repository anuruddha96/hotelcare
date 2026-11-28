#!/usr/bin/env python3
"""Read-only comparison of Git migrations with the remote migration ledger.

Uses PostgreSQL connection settings from the environment (PGSERVICE or PGHOST,
PGUSER, PGDATABASE, etc.). Never prints SQL bodies, credentials or repair SQL.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

QUERY = """
BEGIN READ ONLY;
WITH raw AS (
  SELECT version, name, CASE WHEN cardinality(statements) = 1
    THEN statements[1] END AS body
  FROM supabase_migrations.schema_migrations
), variants AS (
  SELECT version, name, unnest(ARRAY[body, body || chr(10), rtrim(body, chr(10))]) AS body
  FROM raw
), hashes AS (
  SELECT version, name, array_agg(DISTINCT encode(extensions.digest(
    convert_to('blob ' || octet_length(convert_to(body, 'UTF8'))::text, 'UTF8')
      || decode('00', 'hex') || convert_to(body, 'UTF8'), 'sha1'), 'hex'))
    FILTER (WHERE body IS NOT NULL) AS hashes
  FROM variants GROUP BY version, name
)
SELECT COALESCE(json_agg(hashes ORDER BY version), '[]'::json) FROM hashes;
COMMIT;
"""

FILENAME = re.compile(r"^(\d{14})_.+\.sql$")


def blob_hash(body: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(body)).encode("ascii") + b"\0" + body).hexdigest()


def read_local(directory: Path) -> list[dict]:
    entries = []
    versions = set()
    for path in sorted(directory.glob("*.sql")):
        match = FILENAME.fullmatch(path.name)
        if not match:
            raise ValueError(f"Unexpected migration filename: {path.name}")
        version = match[1]
        if version in versions:
            raise ValueError(f"Duplicate local migration version: {version}")
        versions.add(version)
        entries.append({"version": version, "filename": path.name, "hash": blob_hash(path.read_bytes())})
    if not entries:
        raise ValueError("No migration files found")
    return entries


def compare(local: list[dict], remote: list[dict]) -> dict:
    by_local = {x["version"]: x for x in local}
    by_remote = {x["version"]: x for x in remote}
    if not remote or len(by_remote) != len(remote) or len(by_local) != len(local):
        raise ValueError("Empty remote ledger or duplicate versions; refusing classification")
    common = sorted(by_local.keys() & by_remote.keys())
    remote_only = sorted(by_remote.keys() - by_local.keys())
    local_only = sorted(by_local.keys() - by_remote.keys())
    candidates = {}
    reverse = {}
    for version in remote_only:
        hashes = set(by_remote[version].get("hashes") or [])
        candidates[version] = [v for v in local_only if by_local[v]["hash"] in hashes]
        for v in candidates[version]:
            reverse.setdefault(v, []).append(version)
    verified = [
        {"remote_version": r, "local_version": vs[0], "filename": by_local[vs[0]]["filename"]}
        for r, vs in candidates.items() if len(vs) == 1 and len(reverse[vs[0]]) == 1
    ]
    paired_remote = {x["remote_version"] for x in verified}
    paired_local = {x["local_version"] for x in verified}
    common_unverified = [
        v for v in common if by_local[v]["hash"] not in (by_remote[v].get("hashes") or [])
    ]
    return {
        "summary": {
            "remote_count": len(remote),
            "local_count": len(local),
            "same_version": len(common),
            "same_version_content_unverified": len(common_unverified),
            "remote_only": len(remote_only),
            "local_only": len(local_only),
            "one_to_one_content_matches": len(verified),
            "unresolved_remote": len(set(remote_only) - paired_remote),
            "unresolved_local": len(set(local_only) - paired_local),
        },
        "one_to_one_content_matches": verified,
        "same_version_content_unverified": common_unverified,
        "unresolved_remote": [{"version": v, "candidate_local_versions": candidates[v]}
                              for v in remote_only if v not in paired_remote],
        "unresolved_local": [by_local[v]["filename"] for v in local_only if v not in paired_local],
    }


def main() -> int:
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--migrations", type=Path, default=Path("supabase/migrations"))
    cli.add_argument("--report", type=Path, help="Optional private JSON report path")
    args = cli.parse_args()
    result = subprocess.run(
        ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", QUERY],
        check=True, capture_output=True, text=True,
    )
    report = compare(read_local(args.migrations), json.loads(result.stdout))
    print(json.dumps(report["summary"], indent=2))
    if args.report:
        # Never silently overwrite a previously captured audit.
        with args.report.open("x", encoding="utf-8") as file:
            json.dump(report, file, indent=2)
            file.write("\n")
    summary = report["summary"]
    return int(bool(summary["remote_only"] or summary["local_only"]
                    or summary["same_version_content_unverified"]))


if __name__ == "__main__":
    raise SystemExit(main())
