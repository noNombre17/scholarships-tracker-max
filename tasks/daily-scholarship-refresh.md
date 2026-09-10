---
title: Daily scholarship refresh
description: >
  Managed by kimaki scheduled task. Do not move or delete this file
  without also updating the kimaki task (kimaki task list / kimaki task edit).
---

## Goal
Refresh Max's scholarship tracker with the latest info and today's date, every morning at 5am Chicago time.

## Steps
1. In `/home/luis/pc/work/scholarships`, check `git status` (working tree should be clean; if dirty, report and stop).
2. Re-verify time-sensitive deadlines against official pages (focus on items expiring within ~30 days: monthly no-essay batch, Coca-Cola, Niche, Bold.org, Ascent, US Bank, QuestBridge, UA Nov 1/Nov 15, FAFSA cycle). Flag anything CLOSED/CHANGED vs `tracker.md`.
3. Update `tracker.md` header (`**Updated:**` + verification date), `plan.md` (`**Prepared:**` + THIS WEEK dates + calendar), `answers.md` résumé date if content changed. Correct any wrong deadlines/URLs/statuses found in step 2.
4. Run `python3 convert.py`, then `python3 verify.py` (must PASS).
5. If `data.js` or `app.js` changed, rebuild `max-scholarships.html` bundle: `index.html` lines 1–335 + `<script>` + full `data.js` + `</script>` + `<script>` + full `app.js` + `</script>` + `</body></html>`. Verify embedded copies byte-match.
6. If the shell changed, bump `CACHE_NAME` in `sw.js` (v3 → v4, etc.).
7. Do NOT commit. Report: files changed (`git diff --stat`), key deadline changes, and next urgent deadlines. Mention the user via Discord user ID when action is required (e.g. a deadline within 7 days or a closed program).
