# How this app works — refresher

This is the start-here document if you have been away from the project. It describes what is actually running in `ready/`, not a planned architecture.

Related files if you need more depth:

- `README.md` — quick start and official 2k numbers
- `docs/FINAL_PROJECT_HANDOFF.md` — academic write-up of the 2k demo
- `docs/HDFS_FULL_EVALUATION.md` — full HDFS_v1 experiment
- `docs/PANEL_PRESENTATION.md` — talking points
- `results/metrics.json` and `results/hdfs_full_metrics.json` — sources of truth for numbers

---

## 1. What this project is

A university log-anomaly demo:

1. Train an **Isolation Forest** on HDFS Hadoop logs.
2. Evaluate it against **block-level** Normal/Anomaly labels without leaking the test set.
3. Serve a **FastAPI** backend and a **Nexora Observability** dashboard.

Nexora Technologies, Aarav Mehta, and the login screen are **fiction**. There is no real identity provider. The product name is UI branding around a research demo.

There are **two datasets**. They are not interchangeable.

| Mode | Data | What the dashboard shows | Can you retrain from the UI? |
|---|---|---|---|
| **Demo Dataset — HDFS-2k** (default) | 2,000 structured log lines | Isolation Forest scores + ground-truth labels | Yes. `POST /api/retrain` trains 2k only. |
| **Research Dataset — Full HDFS_v1** | 11,175,629 parquet rows / 575,061 blocks | Real parquet browse + ground-truth labels. **No per-line model scores.** | No. Retrain buttons are disabled. Full training is `python src/hdfs_full_eval.py`. |

---

## 2. Stack — what we use and why

| Piece | Library / file | Why |
|---|---|---|
| Language | Python 3 | Training, evaluation, API |
| Tables | pandas, numpy | 2k CSV pipeline |
| Model | scikit-learn `IsolationForest` | Unsupervised outlier detector. Logs have labels for evaluation, not as a classification target. |
| Preprocess | `OneHotEncoder` + `StandardScaler` in a sklearn `Pipeline` | Categorical EventId/Level/Component + numeric lexical features |
| Persistence | joblib | Saved 2k model at `artifacts/isolation_forest_pipeline.joblib` |
| API | FastAPI + uvicorn | Serve dashboard HTML and JSON |
| Full corpus I/O | PyArrow dataset | Page 11M parquet rows without loading them into RAM or the browser |
| Frontend | vanilla HTML / CSS / JS + Chart.js (`/static/chart.umd.min.js`) | No React/Vue. Hash-routed SPA inside `dashboard/` |
| Charts | Chart.js | Overview bars / doughnut. Hidden views must `resize()` when shown. |

`requirements.txt`: pandas, numpy, scikit-learn, joblib, fastapi, uvicorn[standard], pyarrow.

DuckDB is **not** used. There is no database. 2k results live in CSV/JSON/Joblib. Full HDFS_v1 lives in parquet + `hdfs_full_metrics.json`.

---

## 3. Folder map

Work from the inner `ready/` directory (the one with `app/`, `src/`, `dashboard/`).

```
ready/
  app/main.py                 FastAPI app
  src/anomaly_pipeline.py     2k load / features / train / eval
  src/train_model.py          CLI: python src/train_model.py
  src/hdfs_full_eval.py       Full-corpus Isolation Forest experiment (offline)
  src/hdfs_full_store.py      Paginated parquet browse for the dashboard
  src/inspect_data.py         Read-only dataset inspector
  dashboard/                  Nexora UI (index.html, app.js, app.css)
  data/HDFS/                  HDFS-2k structured CSV, labels, templates, raw log
  results/anomaly_results.csv Scored 2k lines (what /api/stats reads)
  results/metrics.json        Official 2k evaluation dump
  results/hdfs_full_metrics.json  Official full-corpus evaluation dump
  artifacts/isolation_forest_pipeline.joblib
  scripts/test_hdfs_full_browse.py

../data/HDFS_full/data/       Five parquet shards (full HDFS_v1). Do not rewrite them.
```

Training uses `data/HDFS/HDFS_2k.log_structured.csv`, not the raw `.log`. Labels come from `data/HDFS/anomaly_label.csv` (full Loghub block list; 2k joins by `BlockId`).

---

## 4. The scientific idea, in plain language

HDFS labels a **block** (`blk_…`) as Normal or Anomaly, not each log line independently. A detector that is trained and scored on the same 2,000 lines is not a fair test.

The improved trainer therefore:

1. Turns lines into **one row per BlockId**.
2. Splits blocks **60 / 20 / 20**, stratified by label, `random_state=42`.
3. Fits rare-event **frequency maps on train blocks only** (so test frequencies cannot leak).
4. Fits Isolation Forest on train (normal-only if validation prefers that).
5. Picks a score threshold on **validation** (max F1, then precision).
6. Reports official metrics on **held-out test blocks**.

Isolation Forest is still unsupervised. Labels are used only to:

- drop known anomalies from training when `train_on=normal`
- choose the threshold on validation
- compute precision / recall / F1

They are **not** a supervised training target.

Anomaly score in this project is `-decision_function(X)`. Higher means the tree isolated the point faster, i.e. more unusual. A block is flagged if `score >= decision_threshold`.

---

## 5. HDFS-2k implementation

### Data

- 2,000 lines, 1,994 unique blocks.
- 1,931 Normal lines / 69 Anomaly lines (68 anomalous blocks, 0.35% of lines).
- 14 Drain EventIds from `HDFS_2k.log_templates.csv`. Do not train on `HDFS_templates.csv` (different EventId numbering).
- First `blk_…` in the line is used if several are mentioned.

### Features (`src/anomaly_pipeline.py`)

Categorical: `Level`, `Component`, `EventId`.

Numeric: message length, token/digit/IP counts, exception/delete/replicate/verify/served/warn flags, block mention count, hour, per-block `n_lines` / `n_events`, plus train-only `event_frequency`, `component_frequency`, `event_component_frequency`.

### Selected 2k model (`results/metrics.json`)

- Isolation Forest, `train_on=normal`, `n_estimators=200`, `max_samples=auto`, `contamination=auto`
- Threshold `0.182371` on validation
- Split: 1,196 / 399 / 399 blocks (41 / 14 / 13 anomalies)

### Official 2k held-out test (399 blocks, 13 anomalies)

| | Precision | Recall | F1 | FPR | TP/FP/FN |
|---|---|---|---|---|---|
| Improved | 0.5000 | 0.0769 | **0.1333** | 0.0026 | 1/1/12 |
| Fair baseline (original features, train fit) | 0.0556 | 0.0769 | 0.0645 | 0.0440 | 1/17/12 |
| Original in-sample (all 2,000 lines, leaked) | 0.0303 | 0.0435 | 0.0357 | 0.0497 | 3/96/66 |

Recall is low because HDFS_2k is almost **one line per block**. Real HDFS detectors look at event *sequences* inside a block. Most anomalous lines here reuse common templates (`E6`, `E10`, …). The saved model mainly flags rare `E14` verification lines.

### What `/api/retrain` does

Calls `train_and_evaluate()` which:

- retrains on HDFS-2k
- overwrites `artifacts/isolation_forest_pipeline.joblib`
- overwrites `results/anomaly_results.csv`
- overwrites `results/metrics.json`

It does **not** touch parquet or `hdfs_full_metrics.json`.

The JSON it returns mixes two scopes on purpose (kept for the original API contract):

- `precision` / `recall` / `f1` / `tp` / `fp` / `fn` → **held-out test blocks**
- `total_logs` / `detected_anomalies` → **whole 2k corpus** (dashboard KPI)

Do not treat those as the same number.

### What the live 2k API actually reads

`/api/stats` and `/api/anomalies` read **`results/anomaly_results.csv`**, not the Joblib file.

Corpus view after the saved run: **2,000 lines, 7 model flags (0.35%), 69 labelled anomalies**. That 7 is not the official test F1.

`/api/anomalies?limit=` returns the highest `anomaly_score` rows (max 200). Live Logs is that sample, not a live tail of a cluster.

---

## 6. Full HDFS_v1 implementation

### Data

Five parquet files:

`data/HDFS_full/data/train-00000-of-00005.parquet` … `train-00004-of-00005.parquet`

(also resolved as `ready/../data/HDFS_full/data/`)

Inspected schema: `line_number`, `date`, `time`, `pid`, `level`, `component`, `content`, `block_id`, `anomaly`.

Verified ingest: **11,175,629 rows**, **575,061 unique blocks**, **16,838 anomalous blocks** (2.93%). `line_number` is unique 1…11175629 across shards.

There is **no Drain EventId**. The evaluator hashes masked content (`E` + 8 hex chars of MD5). The browse API shows EventId as `—`.

### Offline evaluation (`src/hdfs_full_eval.py`)

Streaming pass over parquet row groups → one row per `block_id` → same 60/20/20 BlockId split → baseline vs “improved” (2k settings reused, **grid not rerun**).

Official held-out test: **115,013 blocks, 3,368 anomalies**.

| | Precision | Recall | F1 | PR-AUC | TP/FP/FN |
|---|---|---|---|---|---|
| Improved (2k settings + val threshold 0.129092) | 0.3181 | 0.5736 | **0.4093** | 0.2370 | 1932/4141/1436 |
| Baseline (contamination=0.05) | 0.3215 | 0.5582 | **0.4080** | **0.4652** | 1880/3967/1488 |

F1 is a **tie**. Baseline **ranks** anomalies better (higher PR-AUC). Do not claim the 2k settings improved the full corpus.

Results: `results/hdfs_full_metrics.json`. Reproduce with:

```powershell
python src/hdfs_full_eval.py --subset
python src/hdfs_full_eval.py
```

Do not rerun the 11M job unless you mean to. It takes a few minutes.

### Dashboard browse (`src/hdfs_full_store.py`)

PyArrow `dataset` filters so row groups can be skipped via `line_number` min/max stats.

- Pagination: exclusive keyset, `line_number > after_line`, default 50, max 200.
- `Label` is parquet `anomaly` copied onto each line of the block (**ground truth**).
- `anomaly_score` and `model_prediction` are always `null`. Scores were never saved per HDFS_v1 line. The UI must not invent them.

---

## 7. Backend API map

Served by `app/main.py`. CORS is open. `/` returns `dashboard/index.html`. `/static` is the dashboard folder.

### Unchanged 2k routes

| Method | Path | Behaviour |
|---|---|---|
| GET | `/api/health` | `{status: ok}` |
| GET | `/api/stats` | 2k corpus counts from CSV (`detected_anomalies` = sum of `anomaly_prediction`) |
| GET | `/api/anomalies?limit=` | Top scored 2k lines (1–200) |
| POST | `/api/retrain` | Retrain Isolation Forest on HDFS-2k |
| GET | `/api/hdfs-full-metrics` | Read-only JSON of the full experiment |

### Full-corpus browse routes

| Method | Path | Behaviour |
|---|---|---|
| GET | `/api/hdfs-full/stats` | 11,175,629 / 575,061 / 16,838. `detected_anomalies` is `null` |
| GET | `/api/hdfs-full/logs` | Paginated parquet. Query: `after_line`, `limit`, `q`, `label`, `level`, `component`, `block_id` |
| GET | `/api/hdfs-full/blocks?block_id=` | Lines for one BlockId. 404 if missing |

If parquet is missing, full browse returns HTTP 503. The 2k demo still works.

---

## 8. Dashboard — how the UI works

Vanilla IIFE in `dashboard/app.js`. Hash routes: `#/overview`, `#/logs`, `#/alerts`, `#/investigate`, `#/evaluation`, `#/activity`.

### Login (mock)

- Email: `aarav.mehta@nexora.example`
- Password: `nexora-enterprise` (also accepts `nexora-demo`)
- Or click **Enter Demo Workspace**
- Session: `sessionStorage.nexoraDemoSession`

### Dataset selector

Top bar `<select id="datasetSelect">`. Choice stored in `sessionStorage.nexoraDatasetMode` (`demo` or `full`). Default is demo.

When **Full HDFS_v1** is selected:

- Overview KPIs come from `/api/hdfs-full/stats` (row count, anomalous **blocks**, unique blocks)
- Tables come from `/api/hdfs-full/logs`
- Alerts treat counts as **ground truth**, not Isolation Forest flags
- Investigation can look up a real `BlockId`
- Live Logs uses Next/Previous keyset pages
- Retrain is disabled

When **HDFS-2k** is selected, behaviour is the original demo (stats + top scores + retrain).

The research benchmark cards (Precision/Recall/F1/PR-AUC comparison) always load `/api/hdfs-full-metrics`. Switching dataset does not recompute that experiment.

### Pages

- **Overview** — research cards (full eval JSON) plus the selected corpus KPIs, charts, and a sample table.
- **Live Logs** — explorer. 2k: client filter on `/api/anomalies?limit=200`. Full: server search/filter + pager.
- **Alerts** — 2k: 7 model flags vs 69 labels. Full: 16,838 labelled anomalous blocks; model detections shown as not stored.
- **Investigation** — row drawer. Full mode: BlockId lookup.
- **Model Evaluation** — 2k retrain session metrics + full-corpus comparison table (not hard-coded).
- **Activity** — local timeline in `localStorage` (not a server audit log).

Charts: do not read a high Isolation Forest score as a confirmed incident. On HDFS-2k many top-scoring lines are still Label = Normal.

---

## 9. Request life cycle (what happens when you click)

### Start the engine

From `ready/`:

```powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000

### Demo refresh

Browser → `GET /api/health` + `/api/stats` + `/api/anomalies?limit=20` + `/api/hdfs-full-metrics` → fill KPI cards and the 20-row table.

### Full-corpus refresh

Browser → `GET /api/health` + `/api/hdfs-full/stats` + `/api/hdfs-full/logs?after_line=0&limit=20` + `/api/hdfs-full-metrics`.

Stats use parquet **file metadata** for row count and saved ingest JSON for unique/anomalous blocks. They do not scan 11 million rows on every refresh.

### Retrain (2k only)

`POST /api/retrain` → `train_and_evaluate()` (~10–20 s) → rewrite CSV/Joblib/metrics → dashboard stores the returned held-out metrics in `sessionStorage.hdfsEvalMetrics` for the Evaluation page.

---

## 10. Rules that keep the numbers honest

1. **Corpus rate ≠ F1.** 0.35% (7/2000) is how many 2k lines the saved model flagged. Official 2k quality is held-out F1 0.1333.
2. **Ground truth ≠ model detection.** Full HDFS_v1 browse labels are parquet `anomaly`. Do not caption them as Isolation Forest hits.
3. **Do not invent scores** for HDFS_v1 lines. They were never persisted.
4. **Retrain is dataset-specific.** The button trains HDFS-2k. Full-corpus training is the separate eval script.
5. **Do not overwrite parquet.** Browse only.
6. **Do not mix 2k and full metrics** in one sentence without naming the corpus and the split.

---

## 11. How to run again after time away

```powershell
cd C:\Users\Faraa\Downloads\Log-Anomaly-Detection_Phase3_ready\ready
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt   # only if the venv is missing packages
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Optional one-off 2k retrain from CLI (overwrites 2k artifacts):

```powershell
python src/train_model.py
```

Sanity check full browse + old routes:

```powershell
python scripts/test_hdfs_full_browse.py
```

---

## 12. Honest limitations (say these out loud in a panel)

- Isolation Forest on HDFS_2k cannot see block event sequences; recall stays ~8% on 13 test anomalies.
- Validation/test anomaly counts on 2k are tiny (~13–14), so F1 is noisy.
- Full-corpus “improved” settings were **copied from 2k**, not re-tuned. F1 ties the baseline; baseline PR-AUC is better.
- The dashboard is a local demo, not a production SIEM, not a live log tail, and not a real company product.

## 13. Product shell

The dashboard is a demonstration product named **Nexora Observability**. Sign-in is mocked. The top bar breadcrumb names the current page and the selected dataset. API “LIVE” means the FastAPI process answered; it is not a streaming log tail.

Retrain asks for confirmation because it rewrites the HDFS-2k Joblib bundle, `results/anomaly_results.csv`, and `results/metrics.json`. It does not train HDFS_v1.

If the scored CSV is missing the prediction columns, `/api/stats` and `/api/anomalies` return HTTP 503 with a plain reason instead of a stack trace.
