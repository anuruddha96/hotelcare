import unittest
from scripts.audit_migration_history import blob_hash, compare


def local(version, body):
    return {"version": version, "filename": version + "_migration.sql", "hash": blob_hash(body)}


def remote(version, body):
    return {"version": version, "hashes": [blob_hash(body)] if body is not None else None}


class MigrationAuditTests(unittest.TestCase):
    def test_exact_content_different_timestamp(self):
        report = compare([local("2", b"select 1;")], [remote("1", b"select 1;")])
        self.assertEqual(report["summary"]["one_to_one_content_matches"], 1)
        self.assertEqual(report["summary"]["unresolved_remote"], 0)

    def test_duplicate_content_is_not_one_to_one(self):
        report = compare([local("3", b"select 1;")],
                         [remote("1", b"select 1;"), remote("2", b"select 1;")])
        self.assertEqual(report["summary"]["one_to_one_content_matches"], 0)
        self.assertEqual(report["summary"]["unresolved_remote"], 2)

    def test_same_timestamp_does_not_prove_content(self):
        report = compare([local("1", b"select 2;")], [remote("1", b"select 1;")])
        self.assertEqual(report["same_version_content_unverified"], ["1"])

    def test_missing_body_and_unmatched_sql_are_unresolved(self):
        report = compare([local("2", b"select 2;")], [remote("1", None)])
        self.assertEqual(report["summary"]["unresolved_local"], 1)
        self.assertEqual(report["summary"]["unresolved_remote"], 1)

    def test_empty_ledger_rejected(self):
        with self.assertRaises(ValueError):
            compare([local("1", b"select 1;")], [])


if __name__ == "__main__":
    unittest.main()
