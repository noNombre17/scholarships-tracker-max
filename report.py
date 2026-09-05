#!/usr/bin/env python3
"""report.py - audit + status report for a scholarship-tracker backup.

Usage: python3 report.py <backup.json>

Loads the exported backup JSON and prints a summary: total rows, per-status and
per-tier counts (overrides applied on top of the base statuses parsed via
convert.parse_tracker), plus the audit log newest-first. Stdlib only.
"""

import json
import sys

import convert

STATUS_ORDER = ["todo", "submitted", "awarded", "conditional", "skipped"]


def eff_status(overrides, row):
    o = overrides.get(row["id"], {})
    return o.get("status") or row["status"]


def main(argv):
    if len(argv) != 2:
        print("Usage: python3 report.py <backup.json>")
        return 2

    with open(argv[1], "r", encoding="utf-8") as fh:
        backup = json.load(fh)

    rows = convert.parse_tracker()[0]
    overrides = backup.get("overrides") or {}

    print("Scholarship report")
    print("==================")
    print("Total rows: %d" % len(rows))

    by_status = {s: 0 for s in STATUS_ORDER}
    for r in rows:
        st = eff_status(overrides, r)
        by_status[st] = by_status.get(st, 0) + 1

    print("\nPer-status (overrides applied):")
    for s in STATUS_ORDER:
        print("  %-11s %d" % (s, by_status.get(s, 0)))

    tiers = sorted({r["tier"] for r in rows})
    print("\nPer-tier counts:")
    for t in tiers:
        print("  %s  %d" % (t, sum(1 for r in rows if r["tier"] == t)))

    log = backup.get("log")
    if not log:
        print("\nAudit log: no audit log in backup")
    else:
        entries = sorted(log, key=lambda e: e.get("ts", ""), reverse=True)
        print("\nAudit log (most recent first):")
        for e in entries:
            print("  %s | %s | %s | %s → %s" % (
                e.get("ts", ""), e.get("id", ""), e.get("field", ""),
                e.get("from", ""), e.get("to", "")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
