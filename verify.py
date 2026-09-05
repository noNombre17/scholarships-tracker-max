#!/usr/bin/env python3
"""verify.py - validate the convert.py data-import output.

Independently re-parses tracker.md (markdown side) and compares it against the
parsed records produced by convert.py, then runs structural assertions.

Stdlib only, zero external dependencies.
"""

import re
import sys

import convert

TRACKER = "tracker.md"

TIER_HEAD_RE = convert.TIER_HEAD_RE
SEPARATOR_RE = convert.SEPARATOR_RE

VALID_STATUS = {"todo", "submitted", "awarded", "conditional", "skipped"}
ALL_TIERS = set("ABCDEFGHI")

FILLKIT_KEYS = {"profile", "contact", "bios", "awards", "activities",
                "essays", "oneliners"}
EXPECTED_ESSAY_IDS = {
    "about", "leadership", "community", "challenge", "career",
    "why-ua", "heritage", "entrepreneurship",
}


def clean(text):
    out = (text or "").replace("**", "")
    return re.sub(r"\s+", " ", out).strip()


def split_cells(line):
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in s.split("|")]


def is_header(cells):
    return bool(cells) and clean(cells[0]).lower() == "scholarship"


def reparse_markdown(path=TRACKER):
    """Independent pass over tracker.md -> list of (tier, name, amount, deadline)."""
    with open(path, "r", encoding="utf-8") as fh:
        lines = fh.readlines()

    out = []
    tier = None
    for line in lines:
        mh = TIER_HEAD_RE.match(line)
        if mh:
            tier = mh.group(1)
            continue
        if tier is None:
            continue
        stripped = line.strip()
        if not (stripped.startswith("|") and stripped.endswith("|")):
            continue
        if SEPARATOR_RE.match(stripped):
            continue
        cells = split_cells(stripped)
        if is_header(cells):
            continue
        if len(cells) < 7 or not clean(cells[0]):
            continue
        out.append((tier, clean(cells[0]), clean(cells[1]), clean(cells[2])))
    return out


def run_checks(rows):
    problems = []

    # 1) Row count ~64
    count = len(rows)
    print("Row count: %d" % count)
    if not (50 <= count <= 70):
        problems.append("row count %d outside expected ~64 range" % count)

    # 2) All tiers A-I present
    present = {r["tier"] for r in rows}
    missing = ALL_TIERS - present
    if missing:
        problems.append("missing tiers: %s" % sorted(missing))

    # 3) Structural checks per row
    empty_url_rows = []
    for r in rows:
        # every row carries the 7 logical columns
        for key in ("id", "name", "tier", "amount", "url", "notes", "status"):
            if key not in r:
                problems.append("row %s missing key %s" % (r.get("id"), key))
        # no empty name
        if not r["name"]:
            problems.append("row %s has empty name" % r.get("id"))
        # status valid
        if r["status"] not in VALID_STATUS:
            problems.append("row %s invalid status %r" % (r["id"], r["status"]))
        # urls: non-empty must start with http
        if r["url"]:
            if not r["url"].startswith("http"):
                problems.append("row %s url not http: %r" % (r["id"], r["url"]))
        else:
            empty_url_rows.append(r["id"])

    # Only the known no-public-url entry (Rogers ISD) may have an empty url.
    if empty_url_rows:
        allowed = {"F05"}
        unexpected = [i for i in empty_url_rows if i not in allowed]
        if unexpected:
            problems.append(
                "rows with empty url (expected only Rogers ISD F05): %s"
                % unexpected
            )

    # 4) recurring only Tier A
    for r in rows:
        if r["recurring"] and r["tier"] != "A":
            problems.append(
                "row %s recurring=true but tier is %s (expected only Tier A)"
                % (r["id"], r["tier"])
            )

    return problems


def diff_report(rows):
    """Compare markdown (tracker.md) vs parsed (convert output)."""
    md = reparse_markdown()
    md_by_tier = {}
    for tier, name, amount, dline in md:
        md_by_tier.setdefault(tier, []).append((name, amount, dline))

    diffs = []
    for r in rows:
        md_list = md_by_tier.get(r["tier"], [])
        # sequence index within tier
        idx = sum(1 for x in rows if x["tier"] == r["tier"] and
                  x["id"] <= r["id"]) - 1
        if idx >= len(md_list):
            diffs.append((r["id"], "parsed row has no markdown counterpart"))
            continue
        m_name, m_amount, m_deadline = md_list[idx]
        for field, parsed, mark in (
            ("name", r["name"], m_name),
            ("amount", r["amount"], m_amount),
            ("deadline", r["deadline"]["raw"], m_deadline),
        ):
            if parsed != mark:
                diffs.append(
                    "%s | %-8s | markdown=%r  parsed=%r"
                    % (r["id"], field, mark, parsed)
                )

    return diffs


def run_fillkit_checks(fillkit):
    """Assertions for the FILLKIT object parsed from answers.md."""
    problems = []

    # 1) All required top-level keys present (and no extras expected).
    missing = FILLKIT_KEYS - set(fillkit.keys())
    if missing:
        problems.append("FILLKIT missing keys: %s" % sorted(missing))

    # 2) profile: list of [label, value] pairs; must cover contact fields
    profile = fillkit.get("profile", [])
    if not isinstance(profile, list) or len(profile) < 10:
        problems.append("FILLKIT profile should be a substantial list "
                        "(got %d)" % len(profile))
    for row in profile:
        if not (isinstance(row, list) and len(row) == 2
                and row[0] and row[1]):
            problems.append("FILLKIT profile row malformed: %r" % (row,))

    # 3) contact: 5 rows, each value must appear in some profile row
    contact = fillkit.get("contact", [])
    if not isinstance(contact, list) or len(contact) != 5:
        problems.append("FILLKIT contact should have 5 rows "
                        "(got %d)" % len(contact))
    prof_vals = {row[1] for row in profile}
    for row in contact:
        if not (isinstance(row, list) and len(row) == 2 and row[1]
                and row[1] in prof_vals):
            problems.append("FILLKIT contact row not backed by profile: %r"
                            % (row,))

    # 4) bios: 3 paragraphs, each with ~label and non-empty text
    bios = fillkit.get("bios", [])
    if len(bios) != 3:
        problems.append("FILLKIT bios should have 3 entries "
                        "(got %d)" % len(bios))
    for b in bios:
        if not (isinstance(b, dict) and b.get("label") and b.get("text")):
            problems.append("FILLKIT bio malformed: %r" % (b,))

    # 5) awards: 5 bullet strings
    awards = fillkit.get("awards", [])
    if not isinstance(awards, list) or len(awards) != 5:
        problems.append("FILLKIT awards should have 5 items "
                        "(got %d)" % len(awards))
    for a in awards:
        if not isinstance(a, str) or not a:
            problems.append("FILLKIT award not a non-empty string: %r" % (a,))

    # 6) activities: rows each carrying role/org/detail
    acts = fillkit.get("activities", [])
    if not isinstance(acts, list) or len(acts) < 5:
        problems.append("FILLKIT activities should have >=5 rows "
                        "(got %d)" % len(acts))
    for a in acts:
        if not (isinstance(a, dict) and "role" in a
                and "org" in a and "detail" in a):
            problems.append("FILLKIT activity missing role/org/detail: %r"
                            % (a,))

    # 7) essays: 8 entries covering the expected ids; text keeps \n\n breaks
    essays = fillkit.get("essays", [])
    if len(essays) != len(EXPECTED_ESSAY_IDS):
        problems.append("FILLKIT essays should have %d entries "
                        "(got %d)" % (len(EXPECTED_ESSAY_IDS), len(essays)))
    essay_ids = {e.get("id") for e in essays}
    if essay_ids != EXPECTED_ESSAY_IDS:
        problems.append("FILLKIT essay ids mismatch: %s" % sorted(essay_ids))
    for e in essays:
        if not (isinstance(e, dict) and e.get("id") and e.get("title")
                and isinstance(e.get("words"), int) and e.get("words") > 0
                and e.get("text")):
            problems.append("FILLKIT essay malformed: %r" % (e,))
            continue
        if "\n\n" not in e["text"]:
            problems.append("FILLKIT essay %r lost paragraph breaks"
                            % e["id"])

    # 8) oneliners: 8 items with label + text
    onel = fillkit.get("oneliners", [])
    if not isinstance(onel, list) or len(onel) != 8:
        problems.append("FILLKIT oneliners should have 8 items "
                        "(got %d)" % len(onel))
    for o in onel:
        if not (isinstance(o, dict) and o.get("label") and o.get("text")):
            problems.append("FILLKIT oneliner malformed: %r" % (o,))

    return problems


def main():
    rows = convert.parse_tracker()[0]
    fillkit = convert.parse_answers()

    print("verify.py\n=========")
    problems = run_checks(rows)
    problems += run_fillkit_checks(fillkit)

    print("\nDiff report (markdown-vs-parsed): name | amount | deadline")
    print("------------------------------------------------------------")
    diffs = diff_report(rows)
    if diffs:
        for d in diffs:
            print("  DIFF " + d)
    else:
        print("  no differences")

    # FILLKIT summary
    print("\nFILLKIT checks")
    print("-------------------------------------")
    print("  keys: %s" % ", ".join(sorted(fillkit.keys())))
    print("  profile rows: %d   contact: %d   bios: %d"
          % (len(fillkit.get("profile", [])),
             len(fillkit.get("contact", [])),
             len(fillkit.get("bios", []))))
    print("  awards: %d   activities: %d   oneliners: %d"
          % (len(fillkit.get("awards", [])),
             len(fillkit.get("activities", [])),
             len(fillkit.get("oneliners", []))))
    print("  essays: %d -> %s"
          % (len(fillkit.get("essays", [])),
             ", ".join(e["id"] for e in fillkit.get("essays", []))))
    print("-------------------------------------")

    print("\nResult: %s"
          % ("PASS" if not problems and not diffs else "FAIL"))

    if problems:
        print("\nProblems:")
        for p in problems:
            print("  - " + p)

    return 0 if not problems and not diffs else 1


if __name__ == "__main__":
    sys.exit(main())
