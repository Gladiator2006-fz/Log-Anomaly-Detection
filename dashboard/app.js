(function () {
  const DEMO = {
    org: "Nexora Technologies",
    product: "Nexora Observability",
    name: "Aarav Mehta",
    role: "Software Developer — Platform Engineering",
    email: "aarav.mehta@nexora.example",
    password: "nexora-enterprise",
    altPasswords: ["nexora-demo", "nexora-enterprise"],
    workspace: "Production Infrastructure",
    environment: "Demo / HDFS-2k"
  };
  const SESSION_KEY = "nexoraDemoSession";
  const EVAL_KEY = "hdfsEvalMetrics";
  const ACTIVITY_KEY = "nexoraDemoActivity";
  const NOTIFY_KEY = "nexoraDemoNotices";
  const RUNS_KEY = "nexoraDemoDetectionRuns";
  const VIEWS = ["overview", "logs", "alerts", "investigate", "evaluation", "activity"];

  let distChart, scoreChart, labelChart;
  let overviewRows = [];
  let explorerRows = [];
  let lastStats = null;
  let lastFullMetrics = null;
  let lastFullLoadedAt = null;
  let fullMetricsTask = null;
  let fullMetricsCtrl = null;
  let explorerLoading = false;
  let retrainInFlight = false;
  let stageTimer = null;
  let labelFilter = "ALL";
  let selectedLineId = null;
  let bannerTimer = null;

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));

  function readJson(key, fallback) {
    try {
      const raw = key === EVAL_KEY ? sessionStorage.getItem(key) : localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function writeLocal(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (err) { return null; }
  }

  function nowStamp() {
    return new Date().toLocaleString();
  }

  function asSentence(text) {
    const value = String(text || "").trim();
    if (!value) return "";
    return /[.!?]$/.test(value) ? value : value + ".";
  }

  function addActivity(type, title, detail) {
    const items = readJson(ACTIVITY_KEY, []);
    items.unshift({
      id: Date.now(),
      type,
      title,
      detail,
      at: new Date().toISOString(),
      demo: true
    });
    writeLocal(ACTIVITY_KEY, items.slice(0, 80));
    renderActivity();
  }

  function addNotice(text) {
    const items = readJson(NOTIFY_KEY, []);
    items.unshift({ text, at: nowStamp(), unread: true, demo: true });
    writeLocal(NOTIFY_KEY, items.slice(0, 12));
    renderNotices();
  }

  function showBanner(type, text) {
    const el = $("banner");
    clearTimeout(bannerTimer);
    el.className = "banner show " + type;
    el.textContent = text;
    if (type === "ok" || type === "info") {
      bannerTimer = setTimeout(() => { el.classList.remove("show"); }, type === "ok" ? 4500 : 6000);
    }
  }

  function setBusy(busy) {
    ["refreshBtn", "retrainBtn", "logsRefreshBtn", "evalRetrainBtn", "alertRetrainBtn"].forEach((id) => {
      if ($(id)) $(id).disabled = busy;
    });
    document.querySelectorAll(".demo-scope .kpi-value-block").forEach((el) => { el.hidden = busy; });
    document.querySelectorAll(".demo-scope .kpi-skeleton-block").forEach((el) => { el.hidden = !busy; });
  }

  function setHealth(ok, label) {
    document.querySelectorAll("[data-live]").forEach((el) => {
      el.classList.toggle("down", !ok);
      el.querySelectorAll("[data-live-text]").forEach((text) => {
        text.textContent = ok ? "LIVE" : (label || "Offline");
      });
    });
  }

  function renderEvalInto(emptyId, filledId, metrics) {
    const empty = $(emptyId);
    const filled = $(filledId);
    if (!metrics || metrics.evaluation !== "held_out_test_blocks") {
      empty.hidden = false;
      filled.hidden = true;
      filled.innerHTML = "";
      return;
    }
    empty.hidden = true;
    filled.hidden = false;
    const p = Number(metrics.precision);
    const r = Number(metrics.recall);
    const f1 = Number(metrics.f1);
    const fpr = Number(metrics.false_positive_rate);
    const tp = metrics.tp, tn = metrics.tn, fp = metrics.fp, fn = metrics.fn;
    const settings = [
      metrics.train_on ? "train_on=" + metrics.train_on : "",
      metrics.n_estimators ? "n_estimators=" + metrics.n_estimators : "",
      metrics.max_samples ? "max_samples=" + metrics.max_samples : "",
      metrics.decision_threshold != null ? "threshold=" + Number(metrics.decision_threshold).toFixed(6) : ""
    ].filter(Boolean).join(" · ");
    filled.innerHTML = `
      <div class="eval-metrics">
        <div class="eval-box"><div class="kpi-label">Precision</div><div class="v">${p.toFixed(4)}</div><div class="hint">${tp} of ${tp + fp} predicted positives were correct</div></div>
        <div class="eval-box"><div class="kpi-label">Recall</div><div class="v">${r.toFixed(4)}</div><div class="hint">${tp} of ${tp + fn} actual test anomalies found</div></div>
        <div class="eval-box featured"><div class="kpi-label">F1-score</div><div class="v">${f1.toFixed(4)}</div><div class="hint">Held-out test blocks only</div></div>
        <div class="eval-box"><div class="kpi-label">False-positive rate</div><div class="v">${fpr.toFixed(4)}</div><div class="hint">${fp} false ${fp === 1 ? "positive" : "positives"} among ${fp + tn} normal blocks</div></div>
      </div>
      <div class="eval-box eval-follow">
        <div class="stat-row">
          <div><div class="hint">Test blocks</div><strong>${esc(metrics.test_blocks)}</strong></div>
          <div><div class="hint">Actual anomalies</div><strong>${esc(metrics.test_actual_anomalies)}</strong></div>
          <div><div class="hint">Detected anomalies</div><strong>${esc(metrics.test_detected_anomalies)}</strong></div>
        </div>
        <div class="confusion">
          <div class="c-ok"><div class="hint">True pos.</div><strong>${esc(tp)}</strong></div>
          <div class="c-ok"><div class="hint">True neg.</div><strong>${esc(tn)}</strong></div>
          <div class="c-bad"><div class="hint">False pos.</div><strong>${esc(fp)}</strong></div>
          <div class="c-bad"><div class="hint">False neg.</div><strong>${esc(fn)}</strong></div>
        </div>
      </div>
      ${settings ? `<p class="hint eval-follow">${esc(settings)}</p>` : ""}
    `;
  }

  function renderEval(metrics) {
    renderEvalInto("evalEmpty", "evalFilled", metrics);
    renderEvalInto("evalPageEmpty", "evalPageFilled", metrics);
  }

  function asFinite(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function fmtCount(value) {
    const n = asFinite(value);
    return n == null ? "n/a" : Math.round(n).toLocaleString();
  }

  function fmtPct(value) {
    const n = asFinite(value);
    return n == null ? "n/a" : (n * 100).toFixed(2) + "%";
  }

  function fmtScore(value) {
    const n = asFinite(value);
    return n == null ? "n/a" : n.toFixed(4);
  }

  function isFullReady(data) {
    return !!(
      data &&
      data.available === true &&
      data.evaluation === "held_out_test_blocks" &&
      data.improved_held_out_blocks &&
      typeof data.improved_held_out_blocks === "object"
    );
  }

  function setHidden(id, hidden) {
    const el = $(id);
    if (el) el.hidden = hidden;
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function confusionHtml(block) {
    const row = block && typeof block === "object" ? block : {};
    return `
      <div class="c-ok"><div class="hint">True pos.</div><strong>${fmtCount(row.tp)}</strong></div>
      <div class="c-ok"><div class="hint">True neg.</div><strong>${fmtCount(row.tn)}</strong></div>
      <div class="c-bad"><div class="hint">False pos.</div><strong>${fmtCount(row.fp)}</strong></div>
      <div class="c-bad"><div class="hint">False neg.</div><strong>${fmtCount(row.fn)}</strong></div>
    `;
  }

  function researchStatusLabel(kind, loadedAt) {
    if (kind === "loading") return "Loading…";
    if (kind === "ready" && loadedAt) return "Loaded " + loadedAt.toLocaleString();
    if (kind === "ready") return "Loaded";
    if (kind === "error") return "Unavailable";
    return "Unavailable";
  }

  function renderFullMetricsState(kind, reason, data) {
    const loading = kind === "loading";
    const ready = kind === "ready" && isFullReady(data);
    setHidden("researchLoading", !loading);
    setHidden("researchUnavailable", loading || ready);
    setHidden("researchFilled", !ready);
    setHidden("fullEvalLoading", !loading);
    setHidden("fullEvalEmpty", loading || ready);
    setHidden("fullEvalFilled", !ready);
    setText("researchStatus", researchStatusLabel(kind, lastFullLoadedAt));
    setText("fullEvalStatus", researchStatusLabel(kind, lastFullLoadedAt));
    if (!ready) {
      const message = reason || "The full-corpus metrics endpoint did not return a usable result. The HDFS-2k demo is unaffected.";
      setText("researchUnavailableReason", message);
      setText("fullEvalEmptyReason", message);
      return;
    }
    renderResearchOverview(data);
    renderResearchEvaluation(data);
  }

  function renderResearchOverview(data) {
    const ingest = data.ingest || {};
    const split = data.split || {};
    const improved = data.improved_held_out_blocks || {};
    setText("rsRows", fmtCount(ingest.rows_read));
    setText("rsBlocks", fmtCount(ingest.unique_blocks));
    setText("rsAnoms", fmtCount(ingest.anomalous_blocks));
    setText("rsTestBlocks", fmtCount(split.n_test_blocks));
    setText("rsTestAnoms", fmtCount(split.n_test_anomalies));
    setText("rsPrecision", fmtPct(improved.precision));
    setText("rsRecall", fmtPct(improved.recall));
    setText("rsF1", fmtPct(improved.f1));
    setText("rsFpr", fmtPct(improved.false_positive_rate));
    setText("rsPrauc", fmtScore(improved.pr_auc));
    const tp = asFinite(improved.tp);
    const fp = asFinite(improved.fp);
    const fn = asFinite(improved.fn);
    const tn = asFinite(improved.tn);
    setText("rsPrecisionHint", tp != null && fp != null
      ? fmtCount(tp) + " of " + fmtCount(tp + fp) + " predicted positives were correct"
      : "Predicted positives that were correct");
    setText("rsRecallHint", tp != null && fn != null
      ? fmtCount(tp) + " of " + fmtCount(tp + fn) + " actual test anomalies found"
      : "Actual test anomalies found");
    setText("rsFprHint", fp != null && tn != null
      ? fmtCount(fp) + " false positives among " + fmtCount(fp + tn) + " normal test blocks"
      : "False alarms among normal test blocks");
    const scopeBits = [
      data.evaluation === "held_out_test_blocks" ? "Scope: held-out test blocks" : "",
      data.scope ? "Run: " + data.scope : "",
      ingest.truncated ? "Ingest was truncated" : "",
      lastFullLoadedAt ? "Loaded from /api/hdfs-full-metrics at " + lastFullLoadedAt.toLocaleString() : "",
      "Comparison with baseline is on Model Evaluation."
    ].filter(Boolean);
    setText("researchMetricScope", "Isolation Forest, improved settings, unseen test blocks only.");
    setText("researchScopeNote", scopeBits.join(" · "));
  }

  function interpretComparison(improved, baseline) {
    const notes = [];
    const f1I = asFinite(improved.f1);
    const f1B = asFinite(baseline && baseline.f1);
    const prI = asFinite(improved.pr_auc);
    const prB = asFinite(baseline && baseline.pr_auc);
    if (f1I != null && f1B != null) {
      const delta = f1I - f1B;
      if (Math.abs(delta) < 0.005) {
        notes.push("Held-out F1 is effectively tied (absolute delta under 0.005). That is not a proven overall improvement.");
      } else if (delta > 0) {
        notes.push("Measured held-out F1 is higher than the baseline. That is not by itself a claim of overall superiority.");
      } else {
        notes.push("Measured held-out F1 is lower than the baseline.");
      }
    }
    if (prI != null && prB != null) {
      if (prB - prI >= 0.05) {
        notes.push("Baseline PR-AUC is substantially higher, so the baseline ranks test anomalies better.");
      } else if (prI - prB >= 0.05) {
        notes.push("Improved PR-AUC is substantially higher than the baseline.");
      } else {
        notes.push("PR-AUC is close between the two configurations.");
      }
    }
    notes.push("The improved configuration reuses Isolation Forest settings selected on HDFS-2k. A full-corpus hyperparameter grid search has not been conducted.");
    notes.push("Only held-out test metrics are shown here. Validation was used to pick the threshold and is not mixed into these scores.");
    return notes;
  }

  function renderResearchEvaluation(data) {
    const improved = data.improved_held_out_blocks || {};
    const baseline = data.baseline_held_out_blocks && typeof data.baseline_held_out_blocks === "object"
      ? data.baseline_held_out_blocks
      : {};
    const split = data.split || {};
    const settings = data.settings || {};
    const ingest = data.ingest || {};
    const rows = [
      ["Precision", fmtPct(improved.precision), fmtPct(baseline.precision)],
      ["Recall", fmtPct(improved.recall), fmtPct(baseline.recall)],
      ["F1-score", fmtPct(improved.f1), fmtPct(baseline.f1)],
      ["False-positive rate", fmtPct(improved.false_positive_rate), fmtPct(baseline.false_positive_rate)],
      ["PR-AUC", fmtScore(improved.pr_auc), fmtScore(baseline.pr_auc)]
    ];
    const body = $("compareRows");
    if (body) {
      body.innerHTML = rows.map((row) => (
        `<tr><th scope="row">${esc(row[0])}</th><td>${esc(row[1])}</td><td>${esc(row[2])}</td></tr>`
      )).join("");
    }
    setText("compareCaption", [
      "Held-out test blocks only",
      split.n_test_blocks != null ? fmtCount(split.n_test_blocks) + " blocks" : "",
      split.n_test_anomalies != null ? fmtCount(split.n_test_anomalies) + " anomalies" : "",
      data.scope ? "run=" + data.scope : ""
    ].filter(Boolean).join(" · "));
    const improvedBox = $("improvedConfusion");
    const baselineBox = $("baselineConfusion");
    if (improvedBox) improvedBox.innerHTML = confusionHtml(improved);
    if (baselineBox) baselineBox.innerHTML = confusionHtml(baseline);
    const interp = $("researchInterp");
    if (interp) {
      interp.innerHTML = "<h3>How to read this comparison</h3>" +
        interpretComparison(improved, baseline).map((item) => `<p>${esc(item)}</p>`).join("");
    }
    const settingLine = [
      settings.train_on ? "train_on=" + settings.train_on : "",
      settings.n_estimators ? "n_estimators=" + settings.n_estimators : "",
      settings.max_samples ? "max_samples=" + settings.max_samples : "",
      settings.decision_threshold != null && asFinite(settings.decision_threshold) != null
        ? "threshold=" + asFinite(settings.decision_threshold).toFixed(6)
        : "",
      ingest.rows_read != null ? "rows=" + fmtCount(ingest.rows_read) : "",
      lastFullLoadedAt ? "loaded " + lastFullLoadedAt.toLocaleString() : ""
    ].filter(Boolean).join(" · ");
    setText("researchSettings", settingLine);
    const limits = $("researchLimits");
    if (limits) {
      const items = Array.isArray(data.limitations) ? data.limitations : [];
      limits.innerHTML = items.map((item) => `<li>${esc(item)}</li>`).join("");
    }
  }

  function loadFullMetrics() {
    if (fullMetricsTask) return fullMetricsTask;
    if (fullMetricsCtrl) fullMetricsCtrl.abort();
    fullMetricsCtrl = new AbortController();
    const signal = fullMetricsCtrl.signal;
    renderFullMetricsState("loading");
    fullMetricsTask = fetchJson("/api/hdfs-full-metrics", { signal })
      .then((data) => {
        if (!isFullReady(data)) {
          lastFullMetrics = null;
          lastFullLoadedAt = null;
          renderFullMetricsState(
            "unavailable",
            (data && data.reason) || "The endpoint did not return held-out HDFS_v1 results."
          );
          return null;
        }
        lastFullMetrics = data;
        lastFullLoadedAt = new Date();
        renderFullMetricsState("ready", null, data);
        return data;
      })
      .catch((err) => {
        if (err && err.name === "AbortError") return null;
        lastFullMetrics = null;
        lastFullLoadedAt = null;
        renderFullMetricsState("error", err && err.message ? err.message : "Research metrics request failed.");
        return null;
      })
      .finally(() => {
        fullMetricsTask = null;
      });
    return fullMetricsTask;
  }

  function rowHtml(row, compact) {
    const labelClass = row.Label === "Anomaly" ? "anom" : "ok";
    const levelClass = row.Level === "WARN" ? "warn" : row.Level === "ERROR" ? "anom" : "level";
    const selected = String(row.LineId) === String(selectedLineId) ? " selected" : "";
    if (compact) {
      return `<tr class="clickable${selected}" data-line="${esc(row.LineId)}" tabindex="0">
        <td class="col-id">${esc(row.LineId)}</td>
        <td class="col-event">${esc(row.EventId)}</td>
        <td class="col-level"><span class="pill ${levelClass}">${esc(row.Level)}</span></td>
        <td class="col-comp">${esc(row.Component)}</td>
        <td class="col-score">${esc(row.anomaly_score)}</td>
        <td class="col-label"><span class="pill ${labelClass}">${esc(row.Label)}</span></td>
        <td class="msg" title="${esc(row.Content)}">${esc(row.Content)}</td>
      </tr>`;
    }
    return `<tr class="clickable${selected}" data-line="${esc(row.LineId)}" tabindex="0">
      <td class="col-id">${esc(row.LineId)}</td>
      <td class="col-block msg" title="${esc(row.BlockId)}">${esc(row.BlockId)}</td>
      <td class="col-event">${esc(row.EventId)}</td>
      <td class="col-level"><span class="pill ${levelClass}">${esc(row.Level)}</span></td>
      <td class="col-comp">${esc(row.Component)}</td>
      <td class="col-score">${esc(row.anomaly_score)}</td>
      <td class="col-label"><span class="pill ${labelClass}">${esc(row.Label)}</span></td>
      <td class="msg" title="${esc(row.Content)}">${esc(row.Content)}</td>
    </tr>`;
  }

  function renderOverviewTable() {
    const filtered = labelFilter === "ALL" ? overviewRows : overviewRows.filter((row) => row.Label === labelFilter);
    $("rowCount").textContent = filtered.length;
    $("rowTotal").textContent = overviewRows.length;
    $("filterAll").textContent = "All (" + overviewRows.length + ")";
    $("filterNormal").textContent = "Normal (" + overviewRows.filter((r) => r.Label === "Normal").length + ")";
    $("filterAnomaly").textContent = "Anomaly (" + overviewRows.filter((r) => r.Label === "Anomaly").length + ")";
    $("rows").innerHTML = filtered.length
      ? filtered.map((row) => rowHtml(row, false)).join("")
      : `<tr><td colspan="8" class="msg">No scored lines returned for this filter.</td></tr>`;
  }

  function applyExplorerFilters(rows) {
    const q = ($("logSearch").value || "").trim().toLowerCase();
    const level = $("levelFilter").value;
    const label = $("labelFilterLogs").value;
    const sort = $("sortLogs").value;
    let next = rows.filter((row) => {
      const hay = [row.LineId, row.BlockId, row.EventId, row.Level, row.Component, row.anomaly_score, row.Label, row.Content]
        .join(" ").toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (level && row.Level !== level) return false;
      if (label && row.Label !== label) return false;
      return true;
    });
    next.sort((a, b) => {
      if (sort === "score-asc") return Number(a.anomaly_score) - Number(b.anomaly_score);
      if (sort === "line-asc") return Number(a.LineId) - Number(b.LineId);
      if (sort === "line-desc") return Number(b.LineId) - Number(a.LineId);
      return Number(b.anomaly_score) - Number(a.anomaly_score);
    });
    return next;
  }

  function renderLogs() {
    if (!$("levelFilter").options.length || $("levelFilter").options.length === 1) {
      const levels = [...new Set(explorerRows.map((r) => r.Level).filter(Boolean))].sort();
      $("levelFilter").innerHTML = `<option value="">All levels</option>` + levels.map((lv) => `<option>${esc(lv)}</option>`).join("");
    }
    const filtered = applyExplorerFilters(explorerRows);
    $("logRows").innerHTML = filtered.length
      ? filtered.map((row) => rowHtml(row, false)).join("")
      : `<tr><td colspan="8" class="msg">No rows match this search or filter. The explorer only contains API-returned scored lines.</td></tr>`;
    $("logCount").textContent = `Showing ${filtered.length} of ${explorerRows.length} API rows (limit 200 maximum)`;
  }

  function renderInvestigation() {
    const q = ($("invSearch").value || "").trim().toLowerCase();
    const focus = $("invFocus").value;
    let rows = explorerRows.slice();
    if (focus === "anomaly") rows = rows.filter((r) => r.Label === "Anomaly");
    if (focus === "priority") {
      const anomalies = rows.filter((r) => r.Label === "Anomaly");
      const others = rows.filter((r) => r.Label !== "Anomaly").slice(0, 15);
      rows = anomalies.concat(others);
    }
    if (q) {
      rows = rows.filter((row) => [row.LineId, row.EventId, row.Component, row.Content, row.Label].join(" ").toLowerCase().includes(q));
    }
    $("invRows").innerHTML = rows.length
      ? rows.map((row) => rowHtml(row, true)).join("")
      : `<tr><td colspan="7" class="msg">No investigation rows available from the anomalies API.</td></tr>`;
    $("invCount").textContent = `${rows.length} rows from GET /api/anomalies · demo investigation workspace`;
  }

  function renderCharts(stats, rows) {
    Chart.defaults.color = "#9fb0c3";
    Chart.defaults.borderColor = "#1e2a3c";
    Chart.defaults.font.family = "Inter, Segoe UI, sans-serif";
    const navy = "#e8eef6", accent = "#3b82f6", muted = "#334155", danger = "#ef4444", ok = "#22c55e";
    const remaining = Math.max((stats.total_logs || 0) - (stats.detected_anomalies || 0), 0);
    if (distChart) distChart.destroy();
    distChart = new Chart($("distChart"), {
      type: "bar",
      data: {
        labels: ["2,000-line corpus"],
        datasets: [
          { label: "Detected anomalies", data: [stats.detected_anomalies], backgroundColor: danger, minBarLength: 10, barThickness: 26 },
          { label: "Remaining log lines", data: [remaining], backgroundColor: muted, barThickness: 26 }
        ]
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { color: navy, boxWidth: 10 } },
          tooltip: { callbacks: { afterBody: () => "Corpus view from /api/stats; not held-out F1." } }
        },
        scales: {
          x: { stacked: true, beginAtZero: true, ticks: { color: navy } },
          y: { stacked: true, display: false }
        }
      }
    });
    const topScores = rows.slice().sort((a, b) => Number(b.anomaly_score) - Number(a.anomaly_score)).slice(0, 10);
    const scoreVals = topScores.map((row) => Number(row.anomaly_score));
    const scoreMin = scoreVals.length ? Math.min.apply(null, scoreVals) : 0;
    if (scoreChart) scoreChart.destroy();
    scoreChart = new Chart($("scoreChart"), {
      type: "bar",
      data: {
        labels: topScores.map((row) => "Line " + row.LineId),
        datasets: [{
          label: "Anomaly score",
          data: scoreVals,
          backgroundColor: topScores.map((row) => row.Label === "Anomaly" ? danger : accent),
          borderRadius: 4,
          barThickness: 16
        }]
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { afterLabel: (ctx) => "Ground-truth: " + (topScores[ctx.dataIndex] || {}).Label } }
        },
        scales: {
          x: {
            beginAtZero: false,
            suggestedMin: Math.max(0, scoreMin - 0.01),
            ticks: { color: navy },
            grid: { color: "#1e2a3c" }
          },
          y: { ticks: { color: navy, font: { size: 11 } }, grid: { display: false } }
        }
      }
    });
    const nAnom = rows.filter((r) => r.Label === "Anomaly").length;
    const nNormal = rows.filter((r) => r.Label === "Normal").length;
    if (labelChart) labelChart.destroy();
    labelChart = new Chart($("labelChart"), {
      type: "doughnut",
      data: {
        labels: ["Normal", "Anomaly"],
        datasets: [{ data: [nNormal, nAnom], backgroundColor: [ok, danger], borderWidth: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "62%",
        plugins: {
          legend: { position: "bottom", labels: { color: navy, boxWidth: 10, padding: 16 } },
          tooltip: { callbacks: { afterBody: () => "Among the 20 highest-scoring API rows, not the full corpus." } }
        }
      }
    });
  }

  function renderActivity() {
    const items = readJson(ACTIVITY_KEY, []);
    if (!items.length) {
      $("activityList").innerHTML = `<div class="empty-state">No local demo activity yet. Sign-in, refresh, investigation, and retrain events will appear here.</div>`;
      return;
    }
    $("activityList").innerHTML = items.map((item) => `
      <article class="event">
        <span class="dotline"></span>
        <div>
          <h3>${esc(item.title)}</h3>
          <p>${esc(item.detail)}</p>
        </div>
        <div>
          <span class="pill demo">Demo activity</span>
          <div class="hint eval-follow">${esc(new Date(item.at).toLocaleString())}</div>
        </div>
      </article>
    `).join("");
  }

  function renderNotices() {
    const items = readJson(NOTIFY_KEY, []);
    $("notifyDot").hidden = !items.some((n) => n.unread);
    $("notifyMenu").innerHTML = items.length
      ? items.map((n) => `<div class="menu-item" style="cursor:default"><strong>${esc(n.text)}</strong><div class="hint">${esc(n.at)} · demo notice</div></div>`).join("")
      : `<div class="menu-item">No demo notices yet.</div>`;
  }

  function openDrawer(lineId) {
    const row = explorerRows.concat(overviewRows).find((r) => String(r.LineId) === String(lineId));
    if (!row) return;
    const isNew = String(selectedLineId) !== String(row.LineId);
    selectedLineId = row.LineId;
    if (isNew) addActivity("investigate", "Opened log detail", "LineId " + row.LineId + " · score " + row.anomaly_score + " · Label " + row.Label);
    $("drawerBody").innerHTML = `
      <p class="pill demo spaced">API fields only · no inferred root cause</p>
      <dl class="kv">
        <dt>LineId</dt><dd>${esc(row.LineId)}</dd>
        <dt>BlockId</dt><dd>${esc(row.BlockId)}</dd>
        <dt>EventId</dt><dd>${esc(row.EventId)}</dd>
        <dt>Level</dt><dd>${esc(row.Level)}</dd>
        <dt>Component</dt><dd>${esc(row.Component)}</dd>
        <dt>Anomaly score</dt><dd>${esc(row.anomaly_score)}</dd>
        <dt>Ground-truth label</dt><dd><span class="pill ${row.Label === "Anomaly" ? "anom" : "ok"}">${esc(row.Label)}</span></dd>
      </dl>
      <div class="tech-card note-card spaced">
        A high anomaly score ranks isolation difficulty. It is not automatically a confirmed incident.
      </div>
      <div class="kpi-label eval-follow">Raw Content</div>
      <div class="raw-log">${esc(row.Content)}</div>
    `;
    $("drawer").hidden = false;
    $("drawerBackdrop").hidden = false;
    renderOverviewTable();
    renderLogs();
    renderInvestigation();
  }

  function closeDrawer() {
    $("drawer").hidden = true;
    $("drawerBackdrop").hidden = true;
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(url + " returned HTTP " + response.status);
    return response.json();
  }

  async function refreshData(successMessage, recordActivity) {
    setBusy(true);
    showBanner("info", "Loading live API data…");
    try {
      const [health, stats, anomalies] = await Promise.all([
        fetchJson("/api/health"),
        fetchJson("/api/stats"),
        fetchJson("/api/anomalies?limit=20"),
        loadFullMetrics()
      ]);
      const healthy = health && health.status === "ok";
      setHealth(healthy, healthy ? "LIVE" : "Offline");
      $("total").textContent = Number(stats.total_logs).toLocaleString();
      $("detected").textContent = stats.detected_anomalies;
      $("rate").textContent = stats.anomaly_rate + "%";
      $("events").textContent = stats.event_types;
      $("actualHint").textContent = stats.actual_anomalies != null
        ? stats.detected_anomalies + " model flags · " + stats.actual_anomalies + " labelled anomalies in the corpus"
        : "Model flags on the full corpus";
      $("compHint").textContent = stats.components != null
        ? stats.event_types + " event types · " + stats.components + " components"
        : "Unique EventId values in the corpus";
      $("rateHint").textContent = stats.detected_anomalies + " of " + Number(stats.total_logs).toLocaleString() + " lines · not F1";
      overviewRows = Array.isArray(anomalies) ? anomalies : [];
      lastStats = stats;
      renderCharts(stats, overviewRows);
      renderOverviewTable();
      renderAlerts();
      $("refreshed").textContent = nowStamp();
      if (successMessage) showBanner("ok", successMessage);
      else $("banner").classList.remove("show");
      if (recordActivity !== false) {
        addActivity("refresh", "Dashboard refresh", "GET /api/health, /api/stats, /api/anomalies?limit=20");
        addNotice("Corpus view refreshed from live APIs");
      }
    } catch (err) {
      setHealth(false, "Offline");
      showBanner("err", "Refresh failed: " + err.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadExplorer(recordActivity) {
    if (explorerLoading) return;
    explorerLoading = true;
    try {
      const rows = await fetchJson("/api/anomalies?limit=200");
      explorerRows = Array.isArray(rows) ? rows : [];
      renderLogs();
      renderInvestigation();
      if (recordActivity) addActivity("logs", "Opened log explorer", explorerRows.length + " rows from GET /api/anomalies?limit=200");
    } catch (err) {
      $("logRows").innerHTML = `<tr><td colspan="8" class="msg">Explorer unavailable: ${esc(err.message)}</td></tr>`;
      $("invRows").innerHTML = `<tr><td colspan="7" class="msg">Investigation unavailable: ${esc(err.message)}</td></tr>`;
      showBanner("err", "Log explorer failed: " + err.message);
    } finally {
      explorerLoading = false;
    }
  }

  function setRetrainStage(name) {
    $("retrainStage").textContent = {
      prepare: "Preparing log analysis",
      train: "Training and evaluating the model",
      refresh: "Refreshing detection results"
    }[name] || name;
    const order = ["prepare", "train", "refresh"];
    const idx = order.indexOf(name);
    document.querySelectorAll(".stage-list li").forEach((item) => {
      const itemIdx = order.indexOf(item.dataset.stage);
      item.classList.toggle("active", item.dataset.stage === name);
      item.classList.toggle("done", name === "refresh" && itemIdx < idx);
    });
  }

  function showRetrainOverlay(show) {
    $("retrainOverlay").hidden = !show;
    if (!show) {
      clearTimeout(stageTimer);
      stageTimer = null;
      document.querySelectorAll(".stage-list li").forEach((item) => item.classList.remove("active", "done"));
    }
  }

  function hideToast() {
    $("toast").hidden = true;
  }

  function showToast(kind, title, body, actionLabel) {
    const toast = $("toast");
    toast.className = "toast " + kind;
    toast.hidden = false;
    $("toastTitle").textContent = title;
    $("toastBody").textContent = body;
    $("toastAction").textContent = actionLabel || "Review flagged logs";
    $("toastAction").hidden = false;
  }

  function addDetectionRun(entry) {
    const items = readJson(RUNS_KEY, []);
    items.unshift(Object.assign({ id: Date.now(), demo: true, at: new Date().toISOString() }, entry));
    writeLocal(RUNS_KEY, items.slice(0, 20));
    renderAlerts();
  }

  function latestRun() {
    return readJson(RUNS_KEY, [])[0] || null;
  }

  function renderAlerts() {
    if (!$("alertStatusCard")) return;
    const stats = lastStats;
    const flagged = stats ? Number(stats.detected_anomalies) : null;
    const actual = stats ? stats.actual_anomalies : null;
    const total = stats ? stats.total_logs : null;
    const run = latestRun();
    $("alertFlagged").textContent = flagged == null ? "—" : flagged;
    $("alertActual").textContent = actual == null ? "—" : actual;
    $("alertTotal").textContent = total == null ? "—" : Number(total).toLocaleString();
    $("alertLastRun").textContent = run ? new Date(run.at).toLocaleString() : "No session run";
    $("alertLastRunHint").textContent = run
      ? "Demo / session history · not a server-side audit trail"
      : "Retrain to record a demo run. Corpus flags below are from /api/stats.";

    const card = $("alertStatusCard");
    const runWhen = run ? new Date(run.at).toLocaleString() : "";
    if (!stats) {
      card.className = "tech-card alert-status empty";
      card.innerHTML = `<div><span class="pill">Empty</span><h2 class="section-title" style="margin-top:8px">Waiting for corpus stats</h2><p>Load /api/stats to show model-flagged counts. This is not a live security feed.</p></div>`;
    } else if (run && run.status === "failed") {
      card.className = "tech-card alert-status fail";
      card.innerHTML = `<div><span class="pill anom">Failed</span><h2 class="section-title" style="margin-top:8px">Last detection run failed</h2><p>${esc(asSentence(run.detail || "POST /api/retrain did not complete"))} Completed at ${esc(runWhen)}. Corpus counts below still reflect the last successful /api/stats response.</p></div><div class="alert-actions"><button class="btn primary" type="button" data-retry-retrain>Retry retrain</button></div>`;
    } else if (flagged === 0) {
      card.className = "tech-card alert-status ok";
      card.innerHTML = `<div><span class="pill ok">Completed</span><h2 class="section-title" style="margin-top:8px">No model-flagged records</h2><p>The Isolation Forest flagged 0 of ${Number(total).toLocaleString()} corpus lines. That is a neutral completion, not proof that the system is incident-free. ${actual != null ? actual + " lines still have ground-truth Label = Anomaly. " : ""}${runWhen ? "Last run completed " + esc(runWhen) + "." : ""}</p></div>`;
    } else {
      card.className = "tech-card alert-status warn";
      card.innerHTML = `<div><span class="pill warn">Attention</span><h2 class="section-title" style="margin-top:8px">${flagged} model-flagged record${flagged === 1 ? "" : "s"}</h2><p>Corpus count from /api/stats (<code>anomaly_prediction</code>). These are candidate anomalies, not confirmed incidents. Ground-truth labelled anomalies: ${actual}. The table is a highest-score API sample, not the complete flagged set.${runWhen ? " Last detection run completed " + esc(runWhen) + "." : ""}</p></div><div class="alert-actions"><button class="btn primary" type="button" data-review-flagged>Review flagged logs</button></div>`;
    }

    const sample = overviewRows.slice(0, 10);
    $("alertRows").innerHTML = sample.length
      ? sample.map((row) => rowHtml(row, true)).join("")
      : `<tr><td colspan="7" class="msg">No /api/anomalies rows yet. Refresh or wait for corpus load.</td></tr>`;
    $("alertRowNote").textContent = sample.length
      ? "Showing " + sample.length + " highest-scoring API rows · not the complete flagged set"
      : "No sample rows";

    const runs = readJson(RUNS_KEY, []);
    $("alertRunList").innerHTML = runs.length
      ? runs.map((item) => `
          <article class="run-item">
            <div>
              <strong>${esc(item.title || (item.status === "failed" ? "Detection run failed" : "Detection run completed"))}</strong>
              <p class="hint">${esc(item.detail)}</p>
            </div>
            <div>
              <span class="pill ${item.status === "failed" ? "anom" : item.flagged ? "warn" : "ok"}">${esc(item.status)}</span>
              <div class="hint eval-follow">${esc(new Date(item.at).toLocaleString())}</div>
              <div class="hint">Demo history</div>
            </div>
          </article>
        `).join("")
      : `<div class="empty-state">No local detection-run history yet. Retrain model to store a demo session record here.</div>`;
  }

  function openFlaggedInvestigation() {
    $("invFocus").value = "priority";
    showView("investigate");
    if (!explorerRows.length) loadExplorer(true);
    else renderInvestigation();
    showBanner("info", "Investigation shows the anomalies API sample. It is not the complete corpus flagged set.");
  }

  async function retrainModel() {
    if (retrainInFlight) return;
    retrainInFlight = true;
    setBusy(true);
    hideToast();
    showRetrainOverlay(true);
    setRetrainStage("prepare");
    showBanner("info", "Retraining Isolation Forest on the server. Please wait…");
    addActivity("retrain", "Retrain requested", "POST /api/retrain · demo action");
    stageTimer = setTimeout(() => setRetrainStage("train"), 2500);
    try {
      const metrics = await fetchJson("/api/retrain", { method: "POST" });
      clearTimeout(stageTimer);
      stageTimer = null;
      setRetrainStage("refresh");
      if (metrics && metrics.evaluation === "held_out_test_blocks") {
        sessionStorage.setItem(EVAL_KEY, JSON.stringify(metrics));
        renderEval(metrics);
        addActivity("retrain", "Retrain finished", "Held-out F1 " + Number(metrics.f1).toFixed(4) + " on " + metrics.test_blocks + " test blocks · corpus flags " + metrics.detected_anomalies);
        addNotice("Retrain finished · " + metrics.detected_anomalies + " model-flagged records");
        addDetectionRun({
          status: "completed",
          title: "Detection run completed",
          flagged: metrics.detected_anomalies,
          total: metrics.total_logs,
          f1: metrics.f1,
          processing_time_sec: metrics.processing_time_sec,
          detail: metrics.detected_anomalies + " model-flagged of " + metrics.total_logs + " corpus lines · held-out F1 " + Number(metrics.f1).toFixed(4) + " stored separately" + (metrics.processing_time_sec != null ? " · server time " + Number(metrics.processing_time_sec).toFixed(1) + "s" : "")
        });
      }
      try {
        await refreshData(null, false);
      } catch (refreshErr) {
        showBanner("err", "Retrain succeeded, but refresh failed: " + refreshErr.message);
      }
      const flagged = (metrics && metrics.detected_anomalies != null)
        ? metrics.detected_anomalies
        : (lastStats ? lastStats.detected_anomalies : "unknown");
      const total = (metrics && metrics.total_logs != null)
        ? metrics.total_logs
        : (lastStats ? lastStats.total_logs : "");
      showBanner("ok", "Retrain finished. " + flagged + " model-flagged records on the corpus. Held-out metrics are separate.");
      showToast(
        flagged ? "warn" : "ok",
        "Detection run completed",
        flagged + " model-flagged record" + (flagged === 1 ? "" : "s") + (total ? " on " + Number(total).toLocaleString() + " corpus lines" : "") + ". These are candidate anomalies, not confirmed incidents. Held-out precision / recall / F1 stay on Model Evaluation.",
        "Review flagged logs"
      );
    } catch (err) {
      showBanner("err", "Retrain failed: " + err.message);
      addActivity("retrain", "Retrain failed", err.message);
      addDetectionRun({
        status: "failed",
        title: "Detection run failed",
        flagged: lastStats ? lastStats.detected_anomalies : null,
        detail: err.message
      });
      showToast("fail", "Detection run failed", asSentence(err.message) + " You can retry from this page. Corpus stats were not replaced.", "Retry retrain");
    } finally {
      clearTimeout(stageTimer);
      stageTimer = null;
      showRetrainOverlay(false);
      setBusy(false);
      retrainInFlight = false;
    }
  }

  function currentView() {
    const hash = (location.hash || "#/overview").replace("#/", "");
    return VIEWS.includes(hash) ? hash : "overview";
  }

  function showView(name, push) {
    if (push !== false) location.hash = "#/" + name;
    VIEWS.forEach((view) => {
      $("view-" + view).hidden = view !== name;
    });
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      const on = btn.dataset.view === name;
      btn.classList.toggle("active", on);
      if (on) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    $("sidebar").classList.remove("open");
    if ($("navScrim")) $("navScrim").hidden = true;
    if (name === "overview" && distChart) {
      [distChart, scoreChart, labelChart].forEach((chart) => { if (chart) chart.resize(); });
    }
    if ((name === "logs" || name === "investigate") && !explorerRows.length) loadExplorer(true);
    if (name === "alerts") renderAlerts();
    if (name === "activity") renderActivity();
  }

  function closeMenus() {
    $("notifyMenu").hidden = true;
    $("profileMenu").hidden = true;
    $("scrim").hidden = true;
    $("profileBtn").setAttribute("aria-expanded", "false");
  }

  function enterWorkspace(method) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      email: DEMO.email,
      name: DEMO.name,
      at: new Date().toISOString(),
      mock: true,
      method
    }));
    if (!readJson(ACTIVITY_KEY, []).length) {
      writeLocal(ACTIVITY_KEY, [{
        id: 1,
        type: "system",
        title: "Demo workspace provisioned",
        detail: "Nexora Observability · fictional organization · HDFS-2k",
        at: new Date().toISOString(),
        demo: true
      }]);
    }
    addActivity("auth", "Demo sign-in", method + " · " + DEMO.email + " · mock authentication");
    addNotice("Signed in to the Nexora demo workspace");
    showApp();
  }

  function showLogin() {
    $("loginScreen").hidden = false;
    $("appShell").hidden = true;
    document.body.style.overflow = "auto";
  }

  function showApp() {
    $("loginScreen").hidden = true;
    $("appShell").hidden = false;
    document.body.style.overflow = "hidden";
    renderEval(readJson(EVAL_KEY, null));
    renderNotices();
    renderActivity();
    renderAlerts();
    showView(currentView(), false);
    refreshData(null, false);
  }

  function signOut() {
    sessionStorage.removeItem(SESSION_KEY);
    if (fullMetricsCtrl) fullMetricsCtrl.abort();
    addActivity("auth", "Demo sign-out", "Local mock session cleared. Evaluation metrics in sessionStorage were kept.");
    closeDrawer();
    closeMenus();
    showLogin();
  }

  function validateLogin() {
    const email = $("email").value.trim();
    const password = $("password").value;
    let ok = true;
    $("emailError").textContent = "";
    $("passwordError").textContent = "";
    $("loginError").textContent = "";
    if (!email) {
      $("emailError").textContent = "Email is required.";
      ok = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      $("emailError").textContent = "Enter a valid email address.";
      ok = false;
    }
    if (!password) {
      $("passwordError").textContent = "Password is required.";
      ok = false;
    }
    if (!ok) return false;
    if (email.toLowerCase() !== DEMO.email || !DEMO.altPasswords.includes(password)) {
      $("loginError").textContent = "Demo sign-in only accepts the labelled fictional account. This is not production authentication.";
      return false;
    }
    return true;
  }

  $("loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (validateLogin()) enterWorkspace("Sign in to workspace");
  });
  $("demoEnter").addEventListener("click", () => enterWorkspace("Enter Demo Workspace"));
  $("togglePassword").addEventListener("click", () => {
    const input = $("password");
    const hidden = input.type === "password";
    input.type = hidden ? "text" : "password";
    $("togglePassword").textContent = hidden ? "Hide" : "Show";
  });
  $("signOutBtn").addEventListener("click", signOut);
  $("refreshBtn").addEventListener("click", () => refreshData("Corpus view updated from /api/stats and /api/anomalies."));
  $("retrainBtn").addEventListener("click", retrainModel);
  $("evalRetrainBtn").addEventListener("click", retrainModel);
  $("alertRetrainBtn").addEventListener("click", retrainModel);
  $("reviewFlaggedBtn").addEventListener("click", openFlaggedInvestigation);
  $("clearRunsBtn").addEventListener("click", () => {
    localStorage.removeItem(RUNS_KEY);
    renderAlerts();
  });
  $("toastClose").addEventListener("click", hideToast);
  $("toastAction").addEventListener("click", () => {
    const retry = $("toastAction").textContent.indexOf("Retry") !== -1;
    hideToast();
    if (retry) retrainModel();
    else openFlaggedInvestigation();
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-review-flagged]")) openFlaggedInvestigation();
    if (event.target.closest("[data-retry-retrain]")) retrainModel();
  });
  $("logsRefreshBtn").addEventListener("click", () => loadExplorer(true));
  $("filterAll").addEventListener("click", () => { labelFilter = "ALL"; document.querySelectorAll("#view-overview .filters button").forEach((b) => b.classList.remove("active")); $("filterAll").classList.add("active"); renderOverviewTable(); });
  $("filterNormal").addEventListener("click", () => { labelFilter = "Normal"; document.querySelectorAll("#view-overview .filters button").forEach((b) => b.classList.remove("active")); $("filterNormal").classList.add("active"); renderOverviewTable(); });
  $("filterAnomaly").addEventListener("click", () => { labelFilter = "Anomaly"; document.querySelectorAll("#view-overview .filters button").forEach((b) => b.classList.remove("active")); $("filterAnomaly").classList.add("active"); renderOverviewTable(); });
  ["logSearch", "levelFilter", "labelFilterLogs", "sortLogs"].forEach((id) => $(id).addEventListener("input", renderLogs));
  ["invSearch", "invFocus"].forEach((id) => $(id).addEventListener("input", renderInvestigation));
  $("clearActivityBtn").addEventListener("click", () => {
    localStorage.removeItem(ACTIVITY_KEY);
    renderActivity();
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });
  $("menuToggle").addEventListener("click", () => {
    const open = $("sidebar").classList.toggle("open");
    $("navScrim").hidden = !open;
  });
  $("navScrim").addEventListener("click", () => {
    $("sidebar").classList.remove("open");
    $("navScrim").hidden = true;
  });
  $("profileBtn").addEventListener("click", () => {
    const open = $("profileMenu").hidden;
    closeMenus();
    $("profileMenu").hidden = !open;
    $("profileBtn").setAttribute("aria-expanded", String(open));
    $("scrim").hidden = !open;
  });
  $("notifyBtn").addEventListener("click", () => {
    const open = $("notifyMenu").hidden;
    closeMenus();
    $("notifyMenu").hidden = !open;
    $("scrim").hidden = !open;
    if (open) {
      const items = readJson(NOTIFY_KEY, []).map((n) => ({ ...n, unread: false }));
      writeLocal(NOTIFY_KEY, items);
      renderNotices();
      $("notifyMenu").hidden = false;
      $("scrim").hidden = false;
    }
  });
  $("scrim").addEventListener("click", closeMenus);
  $("closeDrawer").addEventListener("click", closeDrawer);
  $("drawerBackdrop").addEventListener("click", closeDrawer);
  document.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-line]");
    if (row) openDrawer(row.dataset.line);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDrawer();
      closeMenus();
    }
    if (event.key === "Enter" && event.target.closest("tr[data-line]")) {
      openDrawer(event.target.closest("tr[data-line]").dataset.line);
    }
  });
  window.addEventListener("hashchange", () => {
    if (getSession()) showView(currentView(), false);
  });
  window.addEventListener("resize", () => {
    [distChart, scoreChart, labelChart].forEach((chart) => { if (chart) chart.resize(); });
  });

  if (getSession()) showApp();
  else showLogin();
})();
