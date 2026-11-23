"""Regression tests for the migration parser (including the exact Phase-3 bug)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check_changed_migrations import check_migration


class MigrationParserTests(unittest.TestCase):
    def test_valid_plpgsql(self):
        sql = """-- comment
CREATE OR REPLACE FUNCTION public.test_dollar() RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  RETURN true;
END;
$$;
"""
        self.assertEqual(check_migration(sql)[1], 1)

    def test_single_dollar_delimiter_must_fail(self):
        sql = """CREATE FUNCTION public.bad() RETURNS boolean
LANGUAGE plpgsql AS $
BEGIN
  RETURN true;
END;
$;
"""
        with self.assertRaises(Exception):
            check_migration(sql)

    def test_invalid_body_in_valid_quotes_must_fail(self):
        sql = """CREATE FUNCTION public.bad() RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  IF THEN
    RETURN true;
  END IF;
END;
$$;
"""
        with self.assertRaises(Exception):
            check_migration(sql)

    def test_plain_ddl(self):
        self.assertEqual(check_migration("CREATE TABLE public.test (id int);"), (1, 0))


if __name__ == "__main__":
    unittest.main()
