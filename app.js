/* Scholarship Tracker — vanilla JS, zero dependencies.
   Loads after data.js (global `SCHOLARSHIPS`). All runtime state lives in
   localStorage; nothing leaves the browser. */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Constants
   * ------------------------------------------------------------------ */

  var MONTHS = ["January","February","March","April","May","June","July",
                "August","September","October","November","December"];
  var MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep",
                     "Oct","Nov","Dec"];

  var STATUS = {
    todo:        { emoji: "⬜", label: "To-do" },
    submitted:   { emoji: "⏳", label: "Submitted" },
    awarded:     { emoji: "✅", label: "Awarded" },
    conditional: { emoji: "⚠️", label: "Conditional" },
    skipped:     { emoji: "❌", label: "Skipped" }
  };
  var STATUS_ORDER = ["todo","submitted","awarded","conditional","skipped"];

  // Grounded in tracker.md section headers.
  var TIER_TITLES = {
    A: "Monthly no-essay sweepstakes",
    B: "Big annual no-essay / low-effort",
    C: "Quick essays",
    D: "Arkansas state — via SAMS",
    E: "University of Arkansas",
    F: "Local / NWA / Rogers",
    G: "Big essay awards (eligibility-gated)",
    H: "Heritage scholarships",
    I: "Military-family scholarships"
  };

  // Dashboard priorities — grounded in plan.md ("THIS WEEK" + priorities).
  var PRIORITIES = [
    { key: "FAFSA", tone: "now", title: "File FAFSA 2026-27",
      when: "Open now — do this today", url: "https://studentaid.gov",
      why: "Prerequisite for need-based aid, UA, state SAMS and HSF awards." },
    { key: "Coke", tone: "soon", title: "Coca-Cola Scholars · $20,000",
      when: "Sep 30, 2026 · 5pm ET", find: "Coca-Cola Scholars",
      why: "Phase 1 needs no essays, transcripts or recs — leadership + service fit." },
    { key: "UA1", tone: "later", title: "UA admission application",
      when: "Nov 1, 2026 (priority)", find: "UA freshman scholarship app",
      why: "Admission unlocks every UA freshman merit tier up to $12k/yr." },
    { key: "UA2", tone: "later", title: "UA scholarship application",
      when: "Nov 15, 2026 (priority)", find: "UA freshman scholarship app",
      why: "One app covers Chancellor's, Silas Hunt, Honors Academy, Razorback Bridge." },
    { key: "MIL", tone: "later", title: "Military-child lane — Fisher House + AUSA",
      when: "Fisher House ~Jan–Feb 2027 · AUSA Feb–May 2027", find: "Fisher House",
      why: "Dad's active duty (deployed Germany) opens Tier I: Fisher House $2,000 (essay + transcript) and AUSA $2k–$25k via one app + dad's premium membership." },
    { key: "BATCH", tone: "batch", title: "Monthly sweepstakes batch",
      when: "1st of each month · ~10 min", action: "batch",
      why: "Re-enter the 8 no-essay sweepstakes and stamp the month." }
  ];

  var PROFILE = [
    ["Class", "2027 (senior)"],
    ["College", "University of Arkansas, Fayetteville"],
    ["Major", "Computer Science / Cybersecurity / Engineering + Business"],
    ["GPA", "3.85 / 4.0"],
    ["ACT", "21 — retaking (UA superscores)"],
    ["Heritage", "Mexican-American + Korean-American"],
    ["Household", "Single-mom (parents divorced)"],
    ["First-generation", "No"],
    ["Parent employer", "Walmart / Sam's Club"],
    ["Military family", "Dad on active duty (deployed Germany)"],
    ["Citizenship", "US citizen"],
    ["Income", "> $100k"],
    ["Leadership", "LULAC Youth Council VP · Youth Area Council President"]
  ];
  var CONTACT = [
    ["Full name", "Max B. Hill De Santiago"],
    ["Email", "Max.Hill037@gmail.com"],
    ["Phone", "479-507-5373"],
    ["High school", "Rogers High School · Rogers, AR"],
    ["Languages", "English · intermediate Spanish"],
    ["Certifications", "Cybersecurity certification · First Aid"]
  ];

  var STORE_KEY = "scholarships.tracker.v1";

  /* ------------------------------------------------------------------ *
   * State (localStorage)
   * ------------------------------------------------------------------ */

  var state = loadState();

  function capLog(log) {
    if (!Array.isArray(log)) return [];
    return log.length > 500 ? log.slice(log.length - 500) : log;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.overrides) {
          parsed.log = capLog(parsed.log || []);
          return parsed;
        }
      }
    } catch (e) { /* ignore */ }
    return { version: 1, overrides: {}, log: [] };
  }
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { /* storage may be unavailable */ }
  }
  function baseById(id) {
    for (var i = 0; i < SCHOLARSHIPS.length; i++) if (SCHOLARSHIPS[i].id === id) return SCHOLARSHIPS[i];
    return null;
  }
  function override(id) { return (state.overrides && state.overrides[id]) || {}; }
  function effStatus(s) { var o = override(s.id); return o.status || s.status; }
  function effNotes(s)   { var o = override(s.id); return (o.notes === undefined) ? s.notes : o.notes; }
  function effEntered(s) { var o = override(s.id); return o.lastEntered || null; }

  function setStatus(id, status) {
    var s = baseById(id); if (!s) return;
    var o = shallow(override(id));
    if (status === s.status) delete o.status; else o.status = status;
    putOverride(id, o);
  }
  function setNotes(id, notes) {
    var s = baseById(id); if (!s) return;
    var o = shallow(override(id));
    if (notes === s.notes) delete o.notes; else o.notes = notes;
    putOverride(id, o);
  }
  function stampEntered(id, iso) {
    var o = shallow(override(id));
    o.lastEntered = iso;
    putOverride(id, o);
  }
  var LOG_FIELDS = ["status", "notes", "lastEntered"];
  function logField(id, o, field, base) {
    if (field === "status") return o.status !== undefined ? o.status : base.status;
    if (field === "notes") return o.notes !== undefined ? o.notes : base.notes;
    if (field === "lastEntered") return o.lastEntered || null;
    return null;
  }
  function logChange(id, field, from, to) {
    state.log.push({ ts: new Date().toISOString(), id: id, field: field, from: from, to: to });
    state.log = capLog(state.log);
  }
  function putOverride(id, o) {
    var prev = override(id);   // capture prior override BEFORE mutating
    var base = baseById(id);
    if (Object.keys(o).length) state.overrides[id] = o; else delete state.overrides[id];
    if (base) {
      for (var i = 0; i < LOG_FIELDS.length; i++) {
        var f = LOG_FIELDS[i];
        var from = logField(id, prev, f, base);
        var to = logField(id, o, f, base);
        if (from !== to) logChange(id, f, from, to);
      }
    }
    saveState();
  }
  function shallow(o) { var c = {}; for (var k in o) c[k] = o[k]; return c; }

  /* ------------------------------------------------------------------ *
   * Derived collections
   * ------------------------------------------------------------------ */

  var recurringList = SCHOLARSHIPS.filter(function (s) { return s.recurring; });

  // Exact one-time deadlines: single concrete date, not a recurring sweepstakes.
  var exactDated = SCHOLARSHIPS.filter(function (s) {
    return !s.recurring && parseExactDate(s.deadline.raw) !== null;
  });

  function countByStatus() {
    var c = { todo: 0, submitted: 0, awarded: 0, conditional: 0, skipped: 0 };
    SCHOLARSHIPS.forEach(function (s) { c[effStatus(s)]++; });
    return c;
  }

  /* ------------------------------------------------------------------ *
   * Date helpers
   * ------------------------------------------------------------------ */

  function todayAtMidnight() {
    var d = new Date(); d.setHours(0,0,0,0); return d;
  }
  function toISO(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }
  function daysUntil(d) { return Math.round((d - todayAtMidnight()) / 86400000); }
  function fmtShort(d) { return MONTH_SHORT[d.getMonth()] + " " + d.getDate(); }
  function fmtFull(d) { return MONTH_SHORT[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear(); }

  function parseExactDate(raw) {
    if (!raw) return null;
    // Reject multi-date ranges, "opens"/"monthly"/"final" phrasings.
    if (/[\/·–]|monthly|opens|final|drawings|ongoing|rolling|~|cycle|window|\bvia\b/i.test(raw)) return null;
    var m = raw.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
    if (!m) return null;
    var mi = -1;
    for (var i = 0; i < MONTH_SHORT.length; i++) {
      if (MONTH_SHORT[i].toLowerCase() === m[1].slice(0, 3).toLowerCase()) { mi = i; break; }
    }
    if (mi < 0) return null;
    return new Date(parseInt(m[3], 10), mi, parseInt(m[2], 10));
  }

  /* ------------------------------------------------------------------ *
   * Small utilities
   * ------------------------------------------------------------------ */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }
  function findByName(sub) {
    for (var i = 0; i < SCHOLARSHIPS.length; i++) {
      if (SCHOLARSHIPS[i].name.indexOf(sub) !== -1) return SCHOLARSHIPS[i];
    }
    return null;
  }
  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 2400);
  }

  /* ------------------------------------------------------------------ *
   * Router / rendering
   * ------------------------------------------------------------------ */

  var app = document.getElementById("app");
  var currentView = "dashboard";
  var animateReveal = true;
  var focusId = null;

  // tiers view filters (kept across re-renders)
  var tierFilter = { status: "all", sort: "status", q: "" };
  // calendar cursor (first-of-month)
  var calCursor = (function () { var d = todayAtMidnight(); return new Date(d.getFullYear(), d.getMonth(), 1); })();

  function showView(v) {
    currentView = v;
    animateReveal = true;
    setActiveNav();
    render();
    window.scrollTo(0, 0);
  }
  function rerender() {
    var y = window.scrollY;
    animateReveal = false;
    render();
    window.scrollTo(0, y);
  }
  function setActiveNav() {
    document.querySelectorAll(".nav-item").forEach(function (b) {
      b.classList.toggle("active", b.dataset.view === currentView);
    });
  }

  function render() {
    var html = "";
    if (currentView === "dashboard") html = renderDashboard();
    else if (currentView === "tiers") html = renderTiers();
    else if (currentView === "calendar") html = renderCalendar();
    else if (currentView === "batch") html = renderBatch();
    else if (currentView === "profile") html = renderProfile();
    else if (currentView === "fillkit") html = renderFillKit();
    app.innerHTML = html;

    if (animateReveal) {
      var els = app.querySelectorAll(".stagger");
      for (var i = 0; i < els.length; i++) {
        els[i].classList.add("reveal");
        els[i].style.animationDelay = (Math.min(i, 18) * 38) + "ms";
      }
    }
    if (focusId) {
      var el = app.querySelector('[data-rowid="' + focusId + '"]');
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.add("flash");
      }
      focusId = null;
    }
  }

  /* ------------------------------------------------------------------ *
   * Dashboard
   * ------------------------------------------------------------------ */

  function renderDashboard() {
    var counts = countByStatus();
    var t = todayAtMidnight();
    var upcoming = exactDated.map(function (s) {
      return { s: s, d: parseExactDate(s.deadline.raw) };
    }).filter(function (x) { return x.d >= t; })
      .sort(function (a, b) { return a.d - b.d; });

    var next7 = upcoming.filter(function (x) { return daysUntil(x.d) <= 7; });
    var next30 = upcoming.filter(function (x) { return daysUntil(x.d) <= 30; });

    var html = "";
    html += head("Dashboard", "One look at what's due, what's flagged, and what to file next.", t);

    html += '<div class="stat-row stagger">';
    STATUS_ORDER.forEach(function (st) {
      var meta = STATUS[st];
      html +=
        '<button class="card stat-card ' + chipClass(st) + '" data-act="nav" data-view="tiers" data-status="' + st + '">' +
        '<span class="em">' + meta.emoji + '</span>' +
        '<span class="n">' + (counts[st] || 0) + '</span>' +
        '<span class="l">' + meta.label + '</span>' +
        '</button>';
    });
    html += '</div>';

    html += '<div style="height:18px"></div>';
    html += '<div class="two-col">';

    // Priorities
    html += '<section class="card card-pad stagger"><h2 class="card-title">Priorities right now</h2>';
    html += '<p class="muted" style="font-size:12.5px;margin:0 0 6px">';
    html += 'FAFSA first, then the Sep 30 deadline cluster, then the UA apps.</p>';
    PRIORITIES.forEach(function (p) {
      var findS = p.find ? findByName(p.find) : null;
      html += '<div class="priority">';
      html += '<div class="pk ' + p.tone + '">' + p.key + '</div>';
      html += '<div style="flex:1;min-width:0">';
      html += '<div class="pt">' + esc(p.title) + '</div>';
      html += '<div class="pw">' + esc(p.when) + '</div>';
      html += '<div class="py">' + esc(p.why) + '</div>';
      html += '<div class="act">';
      if (p.url) {
        html += '<a class="btn small" href="' + esc(p.url) + '" target="_blank" rel="noopener">Open studentaid.gov ↗</a>';
      } else if (p.action === "batch") {
        html += '<button class="btn small" data-act="nav" data-view="batch">Run the batch →</button>';
      } else if (findS) {
        html += '<button class="btn small" data-act="focus" data-id="' + findS.id + '">View in Tiers →</button>';
      }
      html += '</div></div></div>';
    });
    html += '</section>';

    // Deadlines
    html += '<div>';
    html += '<section class="card card-pad stagger"><h2 class="card-title">Next 7 days</h2>';
    html += deadlineList(next7, t);
    html += '</section>';
    html += '<div style="height:16px"></div>';
    html += '<section class="card card-pad stagger"><h2 class="card-title">Next 30 days</h2>';
    html += deadlineList(next30, t);
    html += '</section>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  function deadlineList(list, t) {
    if (!list.length) return '<p class="empty">Nothing due in this window.</p>';
    var html = '<ul class="dl-list">';
    list.forEach(function (x) {
      var n = daysUntil(x.d);
      html += '<li>';
      html += '<span class="dl-date">' + fmtShort(x.d) + '</span>';
      html += '<span class="dl-name">' + esc(x.s.name) + '</span>';
      html += '<span class="dl-sub">' + esc(x.s.amount) + '</span>';
      html += '<span class="dl-sub" title="Tier">' + x.s.tier + '</span>';
      html += '<span class="dl-sub" style="color:' + (n <= 7 ? 'var(--rust)' : 'var(--ink-3)') + '">in ' + n + 'd</span>';
      html += '</li>';
    });
    html += '</ul>';
    return html;
  }

  function head(title, sub, today) {
    var chip = today ? '<div class="today-chip">' + fmtFull(today) + '</div>' : "";
    return '<div class="view-head">' +
      '<div><h1 class="view-title">' + esc(title) + '</h1>' +
      '<p class="view-sub">' + esc(sub) + '</p></div>' +
      chip + '</div>';
  }

  /* ------------------------------------------------------------------ *
   * Tiers
   * ------------------------------------------------------------------ */

  function renderTiers() {
    var html = "";
    html += head("Tiers A–I", "All 57 programs, grouped by priority. Click a status chip to flip it; the pencil edits notes.");

    // filter bar
    html += '<div class="filterbar stagger">';
    html += '<div class="pills">';
    var pillDefs = [{ v: "all", l: "All" }].concat(STATUS_ORDER.map(function (st) {
      return { v: st, l: STATUS[st].emoji + " " + STATUS[st].label };
    }));
    var counts = countByStatus();
    pillDefs.forEach(function (p) {
      var on = tierFilter.status === p.v;
      var n = p.v === "all" ? SCHOLARSHIPS.length : counts[p.v];
      html += '<button class="pill' + (on ? " on" : "") + '" data-act="filter-status" data-status="' + p.v + '">' +
        esc(p.l) + '<span class="cnt">' + n + '</span></button>';
    });
    html += '</div>';
    html += '<input class="search-input" type="search" placeholder="Search name or notes…" value="' + esc(tierFilter.q) + '" data-act="search-input">';
    html += '<select class="sort-select" data-act="sort-select">';
    html += '<option value="status"' + (tierFilter.sort === "status" ? " selected" : "") + '>Sort: Status + deadline</option>';
    html += '<option value="deadline"' + (tierFilter.sort === "deadline" ? " selected" : "") + '>Sort: Deadline (soonest)</option>';
    html += '<option value="tier"' + (tierFilter.sort === "tier" ? " selected" : "") + '>Sort: Tier A–I</option>';
    html += '</select>';
    html += '</div>';

    // gather + filter
    var q = tierFilter.q.trim().toLowerCase();
    var rows = SCHOLARSHIPS.filter(function (s) {
      if (tierFilter.status !== "all" && effStatus(s) !== tierFilter.status) return false;
      if (q) {
        var hay = (s.name + " " + s.notes + " " + s.amount).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    if (tierFilter.sort === "deadline") {
      rows.sort(function (a, b) {
        var da = parseExactDate(a.deadline.raw), db = parseExactDate(b.deadline.raw);
        if (da && db) return da - db;
        if (da) return -1; if (db) return 1;
        return a.name.localeCompare(b.name);
      });
    } else if (tierFilter.sort === "tier") {
      rows.sort(function (a, b) { return a.tier < b.tier ? -1 : a.tier > b.tier ? 1 : a.id.localeCompare(b.id); });
    } else {
      rows.sort(function (a, b) {
        var sa = STATUS_ORDER.indexOf(effStatus(a)), sb = STATUS_ORDER.indexOf(effStatus(b));
        if (sa !== sb) return sa - sb;
        var da = parseExactDate(a.deadline.raw), db = parseExactDate(b.deadline.raw);
        if (da && db) return da - db;
        if (da) return -1; if (db) return 1;
        return a.id.localeCompare(b.id);
      });
    }

    if (!rows.length) {
      html += '<p class="empty stagger">No scholarships match this filter.</p>';
      return html;
    }

    // group by tier
    var byTier = {};
    rows.forEach(function (s) { (byTier[s.tier] = byTier[s.tier] || []).push(s); });
    var tierOrder = Object.keys(byTier).sort();

    tierOrder.forEach(function (t) {
      var list = byTier[t];
      html += '<section class="tier-block stagger">';
      html += '<div class="tier-head">';
      html += '<div class="tier-badge">' + t + '</div>';
      html += '<div><h3 class="tier-title">Tier ' + t + ' — ' + esc(TIER_TITLES[t] || "") + '</h3>';
      html += '</div><div class="tier-count">' + list.length + ' item' + (list.length === 1 ? "" : "s") + '</div></div>';
      list.forEach(function (s) { html += tierRow(s); });
      html += '</section>';
    });

    return html;
  }

  function tierRow(s) {
    var st = effStatus(s);
    var meta = STATUS[st];
    var next = STATUS_ORDER[(STATUS_ORDER.indexOf(st) + 1) % STATUS_ORDER.length];
    var d = s.deadline.raw;
    var hasUrl = !!s.url;
    var rec = s.recurring;

    var html = '<div class="row" data-rowid="' + esc(s.id) + '">';
    html += '<div class="left">';
    html += '<button class="status-chip ' + chipClass(st) + '" data-act="cycle-status" data-id="' + esc(s.id) + '" title="Click to flip: ' + esc(meta.label) + ' → ' + esc(STATUS[next].label) + '">' +
      '<span class="em">' + meta.emoji + '</span>' + esc(meta.label) + '</button>';
    html += '</div>';
    html += '<div class="row-main">';
    html += '<div class="row-name">' + esc(s.name) +
      (s.kind === "benefit" ? '<span class="kind">benefit</span>' : "") + '</div>';
    html += '<div class="row-meta">';
    html += '<span class="amount">' + esc(s.amount) + '</span>';
    html += '<span class="dot">·</span><span class="dl">' + esc(d) + '</span>';
    if (rec) html += '<span class="rec">🔁 monthly</span>';
    html += '</div>';
    if (s.notes) html += '<div class="row-notes">' + esc(s.notes) + '</div>';
    html += '</div>';
    html += '<div class="row-actions">';
    if (hasUrl) html += '<a class="icon-btn" href="' + esc(s.url) + '" target="_blank" rel="noopener" title="Open application">↗</a>';
    html += '<button class="icon-btn" data-act="edit-notes" data-id="' + esc(s.id) + '" title="Edit notes">✎</button>';
    html += '</div></div>';
    return html;
  }

  function chipClass(st) {
    return "st-" + st;
  }

  /* ------------------------------------------------------------------ *
   * Calendar
   * ------------------------------------------------------------------ */

  function renderCalendar() {
    var first = new Date(calCursor.getFullYear(), calCursor.getMonth(), 1);
    var year = first.getFullYear(), month = first.getMonth();
    var startDow = first.getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var t = todayAtMidnight();
    var todayKey = t.getFullYear() + "-" + t.getMonth() + "-" + t.getDate();

    var html = "";
    html += head("Calendar", "Exact one-time deadlines only. The monthly sweepstakes batch is pinned on the 1st.");

    html += '<div class="card card-pad stagger">';
    html += '<div class="cal-nav">';
    html += '<button class="btn" data-act="cal-prev">← Prev</button>';
    html += '<h2 class="mn">' + MONTHS[month] + " " + year + '</h2>';
    html += '<button class="btn" data-act="cal-next">Next →</button>';
    html += '<button class="btn ghost small" data-act="cal-today">Today</button>';
    html += '</div>';

    html += '<div class="cal-grid">';
    var dows = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    dows.forEach(function (w) { html += '<div class="cal-dow">' + w + '</div>'; });

    var cells = [];
    for (var i = 0; i < startDow; i++) cells.push({ empty: true });
    for (var d = 1; d <= daysInMonth; d++) {
      var date = new Date(year, month, d);
      var items = exactDated.filter(function (s) { return sameDay(parseExactDate(s.deadline.raw), date); });
      cells.push({ date: date, items: items, batch: d === 1 });
    }
    while (cells.length % 7 !== 0) cells.push({ empty: true });

    cells.forEach(function (c) {
      if (c.empty) { html += '<div class="cal-cell dim"></div>'; return; }
      var key = c.date.getFullYear() + "-" + c.date.getMonth() + "-" + c.date.getDate();
      var cls = "cal-cell" + (key === todayKey ? " today" : "");
      html += '<div class="' + cls + '">';
      html += '<div class="dnum">' + c.date.getDate() + '</div>';
      if (c.batch) {
        html += '<div class="cal-chip batch" data-act="nav" data-view="batch" title="Monthly sweepstakes batch">📌 Monthly batch · ' + recurringList.length + '</div>';
      }
      c.items.forEach(function (s) {
        var st = effStatus(s);
        html += '<a class="cal-chip" href="' + (s.url ? esc(s.url) : "#") + '" target="_blank" rel="noopener" title="' + esc(s.name) + ' · ' + esc(s.amount) + '">' +
          (st === "todo" ? "" : STATUS[st].emoji + " ") + esc(s.name) + '</a>';
      });
      html += '</div>';
    });
    html += '</div>';

    var fuzzyCount = SCHOLARSHIPS.length - exactDated.length - recurringList.length;
    html += '<p class="cal-note">' + fuzzyCount + ' items have rolling, monthly, multi-part or fuzzy dates — see <button class="btn small" data-act="nav" data-view="tiers" style="margin-left:4px">Tiers A–I</button> for full deadlines.</p>';
    html += '</div>';
    return html;
  }

  function sameDay(a, b) {
    return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  /* ------------------------------------------------------------------ *
   * Monthly batch
   * ------------------------------------------------------------------ */

  function renderBatch() {
    var html = "";
    html += head("Monthly batch", "The 8 no-essay sweepstakes to re-enter every month. Tick each as you finish, then run the batch to reset and stamp the date.");

    var last = lastBatchDate();
    html += '<section class="card card-pad stagger" style="margin-bottom:16px">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">';
    html += '<div><h2 class="card-title">Run the batch</h2>';
    html += '<p class="muted" style="font-size:13px;margin:0">Last batch ran: <strong>' + (last ? fmtFull(parseISO(last)) : "never") + '</strong></p></div>';
    html += '<button class="btn primary" data-act="run-batch">Reset 🔁 + stamp date</button>';
    html += '</div></section>';

    html += '<section class="card card-pad stagger">';
    html += '<h2 class="card-title">Sweepstakes checklist</h2>';
    html += '<p class="muted" style="font-size:12.5px;margin:0 0 8px">';
    html += 'Checked = entered this month. Running the batch clears them for next month.</p>';

    var done = recurringList.filter(function (s) { return effStatus(s) !== "todo"; }).length;
    html += '<div style="margin-bottom:10px">';
    html += '<div style="height:6px;border-radius:99px;background:var(--surface-2);overflow:hidden">';
    html += '<div style="height:100%;width:' + Math.round(done / recurringList.length * 100) + '%;background:var(--green);transition:width .3s ease"></div>';
    html += '</div>';
    html += '<div class="faint" style="font-size:11.5px;margin-top:5px">' + done + ' of ' + recurringList.length + ' entered this month</div></div>';

    recurringList.forEach(function (s) {
      var entered = effStatus(s) !== "todo";
      var le = effEntered(s);
      html += '<div class="sweep-row' + (entered ? " done" : "") + '" data-act="check-sweep" data-id="' + esc(s.id) + '">';
      html += '<span class="cb">✓</span>';
      html += '<div class="sm">';
      html += '<div class="sn">' + esc(s.name) + '</div>';
      html += '<div class="ss">' + esc(s.amount) + ' · ' + esc(s.effort) + ' · ' + esc(s.deadline.raw) + '</div>';
      html += '</div>';
      html += '<div class="le">' + (le ? "last " + fmtShort(parseISO(le)) : "—") + '</div>';
      html += '<a class="icon-btn" href="' + (s.url ? esc(s.url) : "#") + '" target="_blank" rel="noopener" title="Open" data-act="nop">↗</a>';
      html += '</div>';
    });
    html += '</section>';
    return html;
  }

  function parseISO(iso) {
    var p = iso.split("-");
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }
  function lastBatchDate() {
    var latest = null;
    recurringList.forEach(function (s) {
      var le = effEntered(s);
      if (le && (!latest || le > latest)) latest = le;
    });
    return latest;
  }

  /* ------------------------------------------------------------------ *
   * Profile / eligibility
   * ------------------------------------------------------------------ */

  function renderProfile() {
    var html = "";
    html += head("Profile & eligibility", "Read-only snapshot from Max's fast facts, plus the ⚠️ / ❌ eligibility flags already in the tracker.");

    html += '<section class="card card-pad stagger" style="margin-bottom:16px">';
    html += '<h2 class="card-title">Profile</h2>';
    html += '<div class="fact-grid">';
    PROFILE.forEach(function (f) {
      html += '<div class="fact"><div class="fk">' + esc(f[0]) + '</div><div class="fv">' + esc(f[1]) + '</div>';
      if (f[0] === "Military family") {
        html += '<div class="mil-note">🪖 Elevated lane — Dad\'s active duty (deployed Germany) unlocks <strong>Tier I</strong>: Fisher House $2,000 · AUSA $2k–$25k. See Dashboard priorities.</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    html += '<p class="faint" style="font-size:12px;margin:12px 0 0">';
    html += esc(CONTACT.map(function (c) { return c[0] + ": " + c[1]; }).join(" · "));
    html += '</p></section>';

    // Eligibility flags — reuse ⚠️ / ❌ statuses (no rules engine).
    var flags = SCHOLARSHIPS.filter(function (s) {
      var st = effStatus(s);
      return st === "conditional" || st === "skipped";
    });
    var hideSkipped = tierFilter.hideSkipped; // persisted toggle
    if (hideSkipped) flags = flags.filter(function (s) { return effStatus(s) !== "skipped"; });

    html += '<section class="card card-pad stagger" style="margin-bottom:16px">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">';
    html += '<h2 class="card-title" style="margin:0">Eligibility flags</h2>';
    html += '<label style="font-size:13px;color:var(--ink-2);display:flex;align-items:center;gap:7px;cursor:pointer">' +
      '<input type="checkbox" data-act="toggle-hide-skipped" ' + (hideSkipped ? "checked" : "") + '> Hide skipped (❌)</label>';
    html += '</div>';
    if (!flags.length) {
      html += '<p class="empty" style="margin-top:10px">No ⚠️ or ❌ flags right now.</p>';
    } else {
      flags.forEach(function (s) {
        var st = effStatus(s);
        html += '<div class="flag-row">';
        html += '<div class="fl-em">' + STATUS[st].emoji + '</div>';
        html += '<div style="flex:1;min-width:0">';
        html += '<div class="row-name" style="font-size:14px">' + esc(s.name) + ' <span class="faint" style="font-weight:400">· Tier ' + s.tier + '</span></div>';
        if (s.notes) html += '<div class="fl-note">' + esc(s.notes) + '</div>';
        html += '</div>';
        html += '<a class="icon-btn" href="' + (s.url ? esc(s.url) : "#") + '" target="_blank" rel="noopener" title="Open">↗</a>';
        html += '</div>';
      });
    }
    html += '</section>';

    // Watchlist — notes already carrying a ⚠️ concern, regardless of status.
    var watch = SCHOLARSHIPS.filter(function (s) {
      return s.notes && s.notes.indexOf("⚠") !== -1 && effStatus(s) === "todo";
    });
    html += '<section class="card card-pad stagger">';
    html += '<h2 class="card-title">Watchlist — ⚠️ in notes</h2>';
    html += '<p class="muted" style="font-size:12.5px;margin:0 0 8px">';
    html += 'Still “to-do” but flagged in the research as a possible eligibility miss. Review before investing time.</p>';
    watch.forEach(function (s) {
      html += '<div class="flag-row">';
      html += '<div class="fl-em">⚠️</div>';
      html += '<div style="flex:1;min-width:0">';
      html += '<div class="row-name" style="font-size:14px">' + esc(s.name) + ' <span class="faint" style="font-weight:400">· Tier ' + s.tier + '</span></div>';
      html += '<div class="fl-note">' + esc(s.notes) + '</div>';
      html += '</div>';
      html += '</div>';
    });
    if (!watch.length) html += '<p class="empty" style="margin-top:8px">No ⚠️ notes pending.</p>';
    html += '</section>';

    return html;
  }

  /* ------------------------------------------------------------------ *
   * Fill Kit
   * ------------------------------------------------------------------ */

  function fillkitReady() {
    return typeof FILLKIT !== "undefined" && FILLKIT && typeof FILLKIT === "object";
  }
  function fkList(key) {
    return (fillkitReady() && Array.isArray(FILLKIT[key])) ? FILLKIT[key] : [];
  }
  function wordCount(text) {
    var m = String(text == null ? "" : text).trim().match(/\S+/g);
    return m ? m.length : 0;
  }

  function copyText(text, label) {
    var s = String(text == null ? "" : text);
    function done() { toast(label); }
    function legacy() {
      var ta = document.createElement("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, s.length);
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) done(); else toast("Copy blocked — select the text manually");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(done, legacy);
    } else {
      legacy();
    }
  }

  function copyFill(key) {
    if (!key) return;
    var parts = key.split(".");
    var section = parts[0];
    var idx = parts[1];

    if (idx === "all") {
      var list = fkList(section);
      if (!list.length) return;
      var all = "";
      var label = "Copied";
      if (section === "profile" || section === "contact") {
        all = list.map(function (r) { return r[0] + ": " + r[1]; }).join("\n");
        label = section === "profile" ? "Copied full profile" : "Copied full contact info";
      } else if (section === "awards") {
        all = list.join("\n");
        label = "Copied all awards";
      } else if (section === "oneliners") {
        all = list.map(function (o) { return o.label + ": " + o.text; }).join("\n");
        label = "Copied all one-liners";
      } else if (section === "essays") {
        all = list.map(function (e) { return e.title + "\n" + e.text; }).join("\n\n");
        label = "Copied all essays";
      }
      copyText(all, label);
      return;
    }

    var i = parseInt(idx, 10);
    if (section === "profile" || section === "contact") {
      var row = fkList(section)[i];
      if (!row) return;
      copyText(row[1], "Copied — " + row[0]);
    } else if (section === "bio") {
      var b = fkList("bios")[i];
      if (!b) return;
      copyText(b.text, "Copied bio — " + b.label);
    } else if (section === "essay") {
      var e = fkList("essays")[i];
      if (!e) return;
      copyText(e.text, "Copied essay — " + e.title);
    } else if (section === "award") {
      var a = fkList("awards")[i];
      if (!a) return;
      copyText(a, "Copied award");
    } else if (section === "oneliner") {
      var o = fkList("oneliners")[i];
      if (!o) return;
      copyText(o.text, "Copied — " + o.label);
    }
  }

  function fkPairBlock(title, key, list) {
    if (!list.length) return "";
    var html = '<div><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px">';
    html += '<h3 class="card-title-sm" style="margin:0">' + esc(title) + '</h3>';
    html += '<button class="copy-btn" data-act="copy" data-copy="' + key + '.all">Copy all</button>';
    html += '</div>';
    list.forEach(function (row, i) {
      html += '<div class="fk-item">';
      html += '<span class="fk-label">' + esc(row[0]) + '</span>';
      html += '<span class="fk-value">' + esc(row[1]) + '</span>';
      html += '<button class="copy-btn" data-act="copy" data-copy="' + key + '.' + i + '">Copy</button>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderFillKit() {
    var html = "";
    html += head("Fill Kit", "One-click copy for the fields Max fills over and over. Paste straight into applications.");

    if (!fillkitReady()) {
      html += '<section class="card card-pad stagger"><p class="empty" style="margin:0">No fill data available yet. The Fill Kit is generated in a separate step — check back once data.js includes it.</p></section>';
      return html;
    }

    var oneliners = fkList("oneliners");
    var profile = fkList("profile");
    var contact = fkList("contact");
    var bios = fkList("bios");
    var essays = fkList("essays");
    var awards = fkList("awards");
    var activities = fkList("activities");

    var hasAny = oneliners.length || profile.length || contact.length || bios.length || essays.length || awards.length || activities.length;
    if (!hasAny) {
      html += '<section class="card card-pad stagger"><p class="empty" style="margin:0">Fill data is present but empty. Nothing to copy yet.</p></section>';
      return html;
    }

    // One-liners — the highest-value quick answers, kept front and center.
    if (oneliners.length) {
      html += '<section class="card card-pad stagger" style="margin-bottom:16px;border-color:var(--gold)">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">';
      html += '<div><h2 class="card-title">One-liners</h2>';
      html += '<p class="muted" style="font-size:12.5px;margin:0">The quick answers Max uses most — copy straight into short-answer fields.</p></div>';
      html += '<button class="btn primary" data-act="copy" data-copy="oneliners.all">Copy all one-liners</button>';
      html += '</div>';
      html += '<div class="oneliner-grid">';
      oneliners.forEach(function (o, i) {
        html += '<div class="oneliner">';
        html += '<div class="ol-label">' + esc(o.label) + '</div>';
        html += '<div class="ol-text">' + esc(o.text) + '</div>';
        html += '<button class="copy-btn strong" data-act="copy" data-copy="oneliner.' + i + '">Copy</button>';
        html += '</div>';
      });
      html += '</div></section>';
    }

    // Profile + contact.
    if (profile.length || contact.length) {
      html += '<section class="card card-pad stagger" style="margin-bottom:16px">';
      html += '<h2 class="card-title">Copy profile</h2>';
      html += '<p class="muted" style="font-size:12.5px;margin:0 0 10px">Every field Max re-types in applications.</p>';
      html += '<div class="fk-grid">';
      html += fkPairBlock("Profile", "profile", profile);
      html += fkPairBlock("Contact", "contact", contact);
      html += '</div>';
      html += '</section>';
    }

    // Bios.
    if (bios.length) {
      html += '<section class="card card-pad stagger" style="margin-bottom:16px">';
      html += '<h2 class="card-title">Bios</h2>';
      html += '<p class="muted" style="font-size:12.5px;margin:0 0 8px">Three lengths — short, medium, long — ready to paste.</p>';
      bios.forEach(function (b, i) {
        html += '<div class="essay-card">';
        html += '<div class="essay-head">';
        html += '<div class="essay-title">' + esc(b.label) + '</div>';
        html += '<div class="essay-meta">' + String(b.text == null ? "" : b.text).length + ' chars · ' + wordCount(b.text) + ' words</div>';
        html += '</div>';
        html += '<div class="essay-text">' + esc(b.text) + '</div>';
        html += '<div style="text-align:right"><button class="copy-btn" data-act="copy" data-copy="bio.' + i + '">Copy bio</button></div>';
        html += '</div>';
      });
      html += '</section>';
    }

    // Essays.
    if (essays.length) {
      html += '<section class="card card-pad stagger" style="margin-bottom:16px">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px">';
      html += '<div><h2 class="card-title" style="margin:0">Essays</h2>';
      html += '<p class="muted" style="font-size:12.5px;margin:0">' + essays.length + ' essay' + (essays.length === 1 ? "" : "s") + ' · copy individually or all at once.</p></div>';
      html += '<button class="btn primary" data-act="copy" data-copy="essays.all">Copy all essays</button>';
      html += '</div>';
      essays.forEach(function (e, i) {
        html += '<div class="essay-card">';
        html += '<div class="essay-head">';
        html += '<div class="essay-title">' + esc(e.title) + '</div>';
        html += '<div class="essay-meta">target ~' + e.words + ' words · ' + wordCount(e.text) + ' words now</div>';
        html += '</div>';
        html += '<div class="essay-text">' + esc(e.text) + '</div>';
        html += '<div style="text-align:right"><button class="copy-btn" data-act="copy" data-copy="essay.' + i + '">Copy essay</button></div>';
        html += '</div>';
      });
      html += '</section>';
    }

    // Awards.
    if (awards.length) {
      html += '<section class="card card-pad stagger" style="margin-bottom:16px">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:6px">';
      html += '<h2 class="card-title" style="margin:0">Awards</h2>';
      html += '<button class="copy-btn" data-act="copy" data-copy="awards.all">Copy all</button>';
      html += '</div>';
      awards.forEach(function (a, i) {
        html += '<div class="fk-item">';
        html += '<span class="fk-value">' + esc(a) + '</span>';
        html += '<button class="copy-btn" data-act="copy" data-copy="award.' + i + '">Copy</button>';
        html += '</div>';
      });
      html += '</section>';
    }

    // Activities — read-only reference.
    if (activities.length) {
      html += '<section class="card card-pad stagger">';
      html += '<h2 class="card-title">Activities</h2>';
      html += '<p class="muted" style="font-size:12.5px;margin:0 0 8px">Role / organization / detail — for reference while filling activities lists.</p>';
      activities.forEach(function (a) {
        html += '<div class="essay-card" style="margin-bottom:8px">';
        html += '<div class="essay-title">' + esc(a.role) +
          (a.org ? ' <span class="faint" style="font-weight:400">· ' + esc(a.org) + '</span>' : '') + '</div>';
        if (a.detail) html += '<div class="muted" style="font-size:13px">' + esc(a.detail) + '</div>';
        html += '</div>';
      });
      html += '</section>';
    }

    return html;
  }

  /* ------------------------------------------------------------------ *
   * Actions
   * ------------------------------------------------------------------ */

  function cycleStatus(id) {
    var s = baseById(id); if (!s) return;
    var cur = effStatus(s);
    var next = STATUS_ORDER[(STATUS_ORDER.indexOf(cur) + 1) % STATUS_ORDER.length];
    setStatus(id, next);
    rerender();
    toast(next === "todo" ? "⬜ " + s.name + " → To-do" : STATUS[next].emoji + " " + s.name + " → " + STATUS[next].label);
  }

  function openNotes(id) {
    var s = baseById(id); if (!s) return;
    var cur = effNotes(s);
    var back = document.createElement("div");
    back.className = "modal-backdrop";
    back.innerHTML =
      '<div class="modal-card" role="dialog" aria-modal="true">' +
      '<div class="modal-title">Edit notes</div>' +
      '<div class="modal-name">' + esc(s.name) + '</div>' +
      '<textarea class="modal-area" id="notes-area" placeholder="Add a note…">' + esc(cur) + '</textarea>' +
      '<div class="modal-actions">' +
      '<button class="btn ghost" data-act="close-notes">Cancel</button>' +
      '<button class="btn primary" data-act="save-notes" data-id="' + esc(s.id) + '">Save notes</button>' +
      '</div></div>';
    document.body.appendChild(back);
    var area = back.querySelector("#notes-area");
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }

  function saveNotes(id) {
    var area = document.getElementById("notes-area");
    if (area) setNotes(id, area.value);
    closeModal();
    rerender();
    toast("Notes saved");
  }
  function closeModal() {
    var m = document.querySelector(".modal-backdrop");
    if (m) m.remove();
  }

  function checkSweep(id) {
    var s = baseById(id); if (!s) return;
    var entered = effStatus(s) !== "todo";
    setStatus(id, entered ? "todo" : "submitted");
    rerender();
  }

  function runBatch() {
    var iso = toISO(todayAtMidnight());
    recurringList.forEach(function (s) {
      var o = shallow(override(s.id));
      o.status = "todo";
      o.lastEntered = iso;
      putOverride(s.id, o);
    });
    rerender();
    toast("🔁 Batch reset — " + recurringList.length + " sweepstakes stamped " + fmtShort(todayAtMidnight()));
  }

  function exportJson() {
    var payload = {
      app: "scholarship-tracker",
      exportedAt: new Date().toISOString(),
      version: state.version || 1,
      overrides: state.overrides,
      log: state.log,
      snapshot: SCHOLARSHIPS.map(function (s) {
        return { id: s.id, name: s.name, status: effStatus(s), lastEntered: effEntered(s), notes: effNotes(s) };
      })
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "scholarship-tracker-backup.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 500);
    toast("Exported JSON backup");
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (data && data.overrides) {
          state.overrides = data.overrides;
          state.log = capLog(data.log || []);
          state.version = data.version || 1;
          saveState();
          rerender();
          toast("Import complete");
        } else {
          toast("Not a valid backup file");
        }
      } catch (e) { toast("Could not read that file"); }
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------ *
   * Event delegation
   * ------------------------------------------------------------------ */

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el) {
      if (e.target.closest(".modal-backdrop") && !e.target.closest(".modal-card")) closeModal();
      return;
    }
    var act = el.dataset.act;
    var id = el.dataset.id;
    var view = el.dataset.view;

    switch (act) {
      case "nav":
        if (el.dataset.status) { tierFilter.status = el.dataset.status; currentView = view; animateReveal = true; setActiveNav(); render(); window.scrollTo(0, 0); }
        else showView(view);
        break;
      case "focus": currentView = "tiers"; animateReveal = true; focusId = id; setActiveNav(); render(); window.scrollTo(0, 0); break;
      case "cycle-status": cycleStatus(id); break;
      case "edit-notes": openNotes(id); break;
      case "save-notes": saveNotes(id); break;
      case "close-notes": closeModal(); break;
      case "check-sweep": checkSweep(id); break;
      case "run-batch": runBatch(); break;
      case "filter-status": tierFilter.status = el.dataset.status; rerender(); break;
      case "cal-prev": calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1); rerender(); break;
      case "cal-next": calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1); rerender(); break;
      case "cal-today": calCursor = (function () { var d = todayAtMidnight(); return new Date(d.getFullYear(), d.getMonth(), 1); })(); rerender(); break;
      case "export": exportJson(); break;
      case "import": document.getElementById("import-file").click(); break;
      case "copy": copyFill(el.dataset.copy); break;
    }
  });

  document.addEventListener("input", function (e) {
    if (e.target && e.target.dataset.act === "search-input") {
      tierFilter.q = e.target.value; rerender();
    }
  });
  document.addEventListener("change", function (e) {
    if (e.target && e.target.dataset.act === "sort-select") {
      tierFilter.sort = e.target.value; rerender();
    } else if (e.target && e.target.dataset.act === "toggle-hide-skipped") {
      tierFilter.hideSkipped = e.target.checked; rerender();
    }
  });
  document.getElementById("import-file").addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = "";
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });

  /* ------------------------------------------------------------------ *
   * Init
   * ------------------------------------------------------------------ */

  setActiveNav();
  render();

  /* ------------------------------------------------------------------ *
   * PWA — service worker
   * ------------------------------------------------------------------ */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline cache optional */ });
    });
  }
})();
