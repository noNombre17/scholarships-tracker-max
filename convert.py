#!/usr/bin/env python3
"""convert.py - data-import lane.

Parses tracker.md pipe tables (Tiers A-I) into structured records and writes
them to data.js as `const SCHOLARSHIPS = [...]`. Also parses answers.md into a
`const FILLKIT = {...}` object (profile/contact/bios/awards/activities/essays/
oneliners) emitted into the same data.js.

Stdlib only, zero external dependencies.
"""

import json
import re
import sys

TRACKER = "tracker.md"
ANSWERS = "answers.md"
DATA_JS = "data.js"

# answers.md subsection number -> canonical essay id (see §5).
ESSAY_IDS = {
    1: "about",
    2: "leadership",
    3: "community",
    4: "challenge",
    5: "career",
    6: "why-ua",
    7: "heritage",
    8: "entrepreneurship",
}

# Status glyph -> canonical status value.
STATUS_MAP = {
    "✅": "awarded",
    "⏳": "submitted",
    "⚠️": "conditional",
    "❌": "skipped",
}

RECUR_GLYPH = "🔁"
TODO_GLYPH = "⬜"

TIER_HEAD_RE = re.compile(r"^\s*##\s+([A-I])\.\s*")
SEPARATOR_RE = re.compile(r"^\s*\|[\s:\-|]+\|\s*$")


def clean(text):
    """Remove markdown bold markers and collapse whitespace."""
    if text is None:
        return ""
    out = text.replace("**", "")
    # collapse runs of whitespace (incl. non-breaking width spaces) to one space
    out = re.sub(r"\s+", " ", out).strip()
    return out


def split_cells(line):
    """Split a pipe-table line into its cell strings (no outer pipes)."""
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in s.split("|")]


def is_header(cells):
    return bool(cells) and clean(cells[0]).lower() == "scholarship"


def to_url(raw):
    """Normalize a raw url cell into a full https:// url (primary only).

    Multiple urls are joined with '·' -- take the first. A non-resolvable
    token (e.g. "via school") yields an empty string.
    """
    raw = clean(raw or "")
    if not raw:
        return ""
    first = raw.split("·")[0].strip()
    token = (first.split()[0] if first.split() else "").strip()
    if not token:
        return ""
    if "." not in token:  # not a domain -> no public url
        return ""
    if not token.startswith("http"):
        token = "https://" + token
    return token


_CONCRETE_RE = re.compile(
    r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|"
    r"dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b"
)


def deadline_meta(raw):
    """Return (raw, recurring, fuzzy) for a deadline cell."""
    raw = clean(raw or "")
    low = raw.lower()
    recurring = any(k in low for k in ("monthly", "ongoing", "rolling"))
    concrete = bool(_CONCRETE_RE.search(low))
    fuzzy = ("~" in raw) or (not concrete)
    return raw, recurring, fuzzy


def status_of(raw):
    """Map a status cell -> (status_value, recurring_flag)."""
    raw = raw or ""
    status = "todo"
    for glyph, val in STATUS_MAP.items():
        if glyph in raw:
            status = val
            break
    recurring = RECUR_GLYPH in raw
    return status, recurring


def kind_of(name, tier):
    """Business/source kind. Tag Walmart Live Better U as a benefit."""
    low = clean(name or "").lower()
    if "live better" in low or ("walmart" in low and "benefit" in low):
        return "benefit"
    return ""


def parse_tracker(path=TRACKER):
    """Parse tracker.md into (rows, skip_counts)."""
    with open(path, "r", encoding="utf-8") as fh:
        lines = fh.readlines()

    rows = []
    skip = {}
    tier = None
    counter = {}

    for line in lines:
        mh = TIER_HEAD_RE.match(line)
        if mh:
            tier = mh.group(1)
            counter[tier] = 0
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

        if len(cells) < 7:
            skip[tier] = skip.get(tier, 0) + 1
            continue

        name = clean(cells[0])
        if not name:
            skip[tier] = skip.get(tier, 0) + 1
            continue

        counter[tier] += 1
        n = counter[tier]

        amount = clean(cells[1])
        d_raw, d_rec, d_fuzzy = deadline_meta(cells[2])
        effort = clean(cells[3])
        status, recurring = status_of(cells[4])
        notes = clean(cells[5])
        url = to_url(cells[6])
        kind = kind_of(name, tier)

        rows.append({
            "id": "%s%02d" % (tier, n),
            "name": name,
            "tier": tier,
            "amount": amount,
            "deadline": {
                "raw": d_raw,
                "recurring": d_rec,
                "fuzzy": d_fuzzy,
            },
            "effort": effort,
            "status": status,
            "recurring": recurring,
            "url": url,
            "notes": notes,
            "kind": kind,
        })

    return rows, skip


# ---------------------------------------------------------------------------
# answers.md -> FILLKIT parsing (stdlib only)
# ---------------------------------------------------------------------------

# Contact rows (subset of the §1 fast-facts table) that back the `contact`
# entry. Keyed by the normalized profile label.
CONTACT_LABELS = (
    "full name",
    "email",
    "phone",
    "high school",
    "city / state",
)


def blockquote_paragraphs(raw_lines):
    """Split markdown blockquote lines into paragraphs.

    raw_lines are full source lines beginning with '>'. Lines whose content
    after the '>' is empty mark a paragraph break; consecutive content lines
    are joined into a single paragraph separated by single spaces.
    Returns a list of paragraph strings.
    """
    paras = []
    cur = []
    for ln in raw_lines:
        body = ln.lstrip()
        if not body.startswith(">"):
            continue
        body = body[1:].strip()
        if body == "":
            if cur:
                paras.append(" ".join(cur))
                cur = []
            continue
        cur.append(re.sub(r"\s+", " ", body))
    if cur:
        paras.append(" ".join(cur))
    return paras


def _is_section_start(line, n):
    """True when line begins a top-level `## n.` section."""
    return line.strip().startswith("## %s." % n)


def parse_profile(lines):
    """§1 fast-facts table -> [[label, value], ...] (all rows)."""
    rows = []
    insec = False
    for ln in lines:
        s = ln.strip()
        if _is_section_start(ln, 1):
            insec = True
            continue
        if insec and s.startswith("## "):
            break
        if not insec or not (s.startswith("|") and s.endswith("|")):
            continue
        body = s[1:-1]
        cells = [c.strip() for c in body.split("|")]
        if len(cells) < 2:
            continue
        label = clean(cells[0])
        value = clean("|".join(cells[1:]))
        # skip header + table separator rows (e.g. `---`)
        if not label or label.lower() == "field":
            continue
        if re.fullmatch(r"[-:]+", label):
            continue
        rows.append([label, value])
    return rows


def parse_contact(profile):
    """Subset of profile rows for the contact block."""
    by_label = {label.lower(): value for label, value in profile}
    return [[label, by_label[label]] for label in CONTACT_LABELS
            if label in by_label]


def parse_bios(lines):
    """§2 bio paragraphs -> [{label, text}, ...] (~30/60/120 words)."""
    out = []
    insec = False
    cur = None
    for ln in lines:
        s = ln.strip()
        if _is_section_start(ln, 2):
            insec = True
            continue
        if insec and s.startswith("## "):
            break
        if not insec:
            continue
        ml = re.search(r"~(\d+)\s*words", s)
        if ml and "**" in s:
            if cur:
                out.append(cur)
            cur = {"label": "~%s words" % ml.group(1), "raw": []}
            continue
        if cur is not None and s.startswith(">"):
            cur["raw"].append(s)
    if cur:
        out.append(cur)
    return [
        {"label": b["label"], "text": "\n\n".join(blockquote_paragraphs(b["raw"]))}
        for b in out
    ]


def parse_awards(lines):
    """§4 bullet lines -> [award string, ...] (5 items)."""
    out = []
    insec = False
    for ln in lines:
        s = ln.strip()
        if _is_section_start(ln, 4):
            insec = True
            continue
        if insec and s.startswith("## "):
            break
        if not insec:
            continue
        if s.startswith("- "):
            out.append(clean(s[2:]))
    return out


def parse_activities(lines):
    """§3 table rows -> [{role, org, detail}, ...]."""
    out = []
    insec = False
    started = False
    for ln in lines:
        s = ln.strip()
        if _is_section_start(ln, 3):
            insec = True
            continue
        if insec and s.startswith("## "):
            break
        if not insec or not (s.startswith("|") and s.endswith("|")):
            continue
        body = s[1:-1]
        cells = [c.strip() for c in body.split("|")]
        if len(cells) < 4:
            continue
        first = clean(cells[0]).lower()
        if first == "activity":
            started = True
            continue
        if not started:
            continue
        # separator rows (e.g. `--- | ---`) have a dash-only first cell
        if re.fullmatch(r"-+", cells[0].strip()) or not clean(cells[0]):
            continue
        out.append({
            "role": clean(cells[1]),
            "org": clean(cells[2]),
            "detail": clean(cells[3]),
        })
    return out


def parse_essays(lines):
    """§5 essay drafts -> [{id, title, words, text}, ...]."""
    drafts = []
    cur = None
    for ln in lines:
        s = ln.strip()
        m = re.match(
            r"^###\s+5\.(\d+)\s+(.*?)\s*\(~?\s*(\d+)\s*words?\)", s
        )
        if m:
            if cur:
                drafts.append(cur)
            title = m.group(2).strip()
            # some headings wrap the title in double quotes
            if len(title) >= 2 and title.startswith('"') and title.endswith('"'):
                title = title[1:-1].strip()
            cur = {
                "num": int(m.group(1)),
                "title": title,
                "words": int(m.group(3)),
                "raw": [],
            }
            continue
        if cur is None:
            continue
        if s.startswith("## "):
            drafts.append(cur)
            cur = None
            continue
        if s.startswith(">"):
            cur["raw"].append(s)
    if cur:
        drafts.append(cur)

    essays = []
    for d in drafts:
        text = "\n\n".join(blockquote_paragraphs(d["raw"]))
        essays.append({
            "id": ESSAY_IDS.get(d["num"], ""),
            "title": d["title"],
            "words": d["words"],
            "text": text,
        })
    return essays


def parse_oneliners(lines):
    """§6 short-answer bullets -> [{label, text}, ...] (8 items)."""
    out = []
    insec = False
    for ln in lines:
        s = ln.strip()
        if _is_section_start(ln, 6):
            insec = True
            continue
        if insec and s.startswith("## "):
            break
        if not insec or not s.startswith("- "):
            continue
        # Format is `- **Label:** "text"` but some labels drop the trailing
        # colon (e.g. a question mark), so split on the bold span instead.
        m = re.match(r"-\s+\*\*(.*?)\*\*\s*(.*)$", s)
        if not m:
            continue
        label = m.group(1).strip()
        if label.endswith(":"):
            label = label[:-1].rstrip()
        text = m.group(2).lstrip(": ").strip()
        if text.startswith('"') and text.endswith('"'):
            text = text[1:-1]
        out.append({"label": label, "text": text.strip()})
    return out


def parse_answers(path=ANSWERS):
    """Parse answers.md into the FILLKIT object."""
    with open(path, "r", encoding="utf-8") as fh:
        lines = fh.readlines()

    profile = parse_profile(lines)
    return {
        "profile": profile,
        "contact": parse_contact(profile),
        "bios": parse_bios(lines),
        "awards": parse_awards(lines),
        "activities": parse_activities(lines),
        "essays": parse_essays(lines),
        "oneliners": parse_oneliners(lines),
    }


def dump_data_js(rows, fillkit, path=DATA_JS):
    body = ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in rows)
    fill_json = json.dumps(fillkit, ensure_ascii=False, indent=2)
    content = (
        "// Auto-generated by convert.py — do not edit by hand.\n"
        "// Sources: tracker.md (Tiers A-I) and answers.md (FILLKIT).\n"
        "const SCHOLARSHIPS = [\n" + body + "\n];\n\n"
        "const FILLKIT = " + fill_json + ";\n"
    )
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)


def main():
    rows, skip = parse_tracker()
    fillkit = parse_answers()
    dump_data_js(rows, fillkit)

    # Parse report
    tiers = "ABCDEFGHI"
    print("Parse report (tracker.md -> data.js)")
    print("-------------------------------------")
    total = 0
    for t in tiers:
        n = sum(1 for r in rows if r["tier"] == t)
        total += n
        sk = skip.get(t, 0)
        print("  Tier %s: parsed=%d  skipped=%d" % (t, n, sk))
    print("-------------------------------------")
    print("TOTAL rows parsed: %d" % total)

    # FILLKIT report (answers.md)
    print("\nFILLKIT report (answers.md -> data.js)")
    print("-------------------------------------")
    print("  keys: %s" % ", ".join(sorted(fillkit.keys())))
    for key, coll in fillkit.items():
        if isinstance(coll, list):
            print("  %-10s items: %d" % (key, len(coll)))
    essay_ids = [e["id"] for e in fillkit.get("essays", [])]
    print("  essays ids: %s" % ", ".join(essay_ids))
    print("-------------------------------------")

    return 0


if __name__ == "__main__":
    sys.exit(main())
