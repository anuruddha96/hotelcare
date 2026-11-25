"""Keep legacy repository lint debt visible while requiring clean changed files.

Both inputs are real full-repository ESLint JSON runs with unchanged rules.
An error in any changed file, an added error elsewhere, or a fatal parser error
fails the check. Existing errors on untouched files are explicitly reported.
"""
import collections
import json
import pathlib
import subprocess
import sys


def load_report(path, root):
    reports = json.loads(pathlib.Path(path).read_text())
    if not isinstance(reports, list) or not reports:
        raise ValueError("Missing or empty ESLint report")
    errors = collections.Counter()
    warnings = collections.Counter()
    details = []
    for report in reports:
        relative = pathlib.Path(report["filePath"]).relative_to(root).as_posix()
        for issue in report["messages"]:
            severity = issue["severity"]
            if issue.get("fatal"):
                raise ValueError(f"Fatal ESLint error in {relative}: {issue['message']}")
            key = (relative, issue.get("ruleId") or "", issue["message"])
            if severity == 2:
                errors[key] += 1
                details.append((key, issue.get("line", 0)))
            elif severity == 1:
                warnings[key] += 1
    return errors, warnings, details


def main():
    base_root, base_report, head_report, base_sha = sys.argv[1:]
    root = pathlib.Path.cwd()
    changed = set(
        subprocess.check_output(
            ["git", "diff", "--name-only", "-z", "--diff-filter=ACMRT", base_sha, "HEAD"]
        ).decode().split("\0")
    )
    before, before_warnings, _ = load_report(base_report, pathlib.Path(base_root))
    after, after_warnings, details = load_report(head_report, root)
    new = after - before
    changed_errors = [(key, line) for key, line in details if key[0] in changed]
    print(f"Full ESLint baseline: {sum(before.values())} errors, {sum(before_warnings.values())} warnings")
    print(f"Full ESLint current:  {sum(after.values())} errors, {sum(after_warnings.values())} warnings")
    print(f"Errors on changed files: {len(changed_errors)}; new errors repository-wide: {sum(new.values())}")
    for (file, rule, message), line in changed_errors:
        print(f"::error file={file},line={line}::{rule}: {message}")
    for (file, rule, message), count in new.items():
        print(f"::error file={file}::{count} new {rule}: {message}")
    if changed_errors or new:
        return 1
    if after:
        print("::warning::Full repository ESLint still reports legacy errors in unchanged files; see attached JSON reports.")
    print("Changed files have zero lint errors; no new repository-wide lint errors.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
