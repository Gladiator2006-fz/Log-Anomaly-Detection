# Panel presentation report — Log Anomaly Detection

**Status:** Ready to present.  
**Repo:** https://github.com/Gladiator2006-fz/Log-Anomaly-Detection  
**Demo:** http://127.0.0.1:8000 after `uvicorn` from this `ready` folder.  
**Sources of truth:** `results/metrics.json` and live `/api/stats`. Do not invent extra decimals.

This is a local HDFS_2k + Isolation Forest + FastAPI demo. It is not a production SOC, not real-time streaming, and not a confirmed-incident system.

---

## 1. One-minute thesis

HDFS labels are **block-level**. The original trainer fitted and scored all 2,000 lines, which leaks evaluation data. This project:

1. Splits **BlockIds** 60 / 20 / 20, stratified.
2. Fits Isolation Forest on **train** (normal-only won validation).
3. Chooses the score threshold on **validation only**.
4. Reports official P / R / F1 / FPR on **399 held-out test blocks**.
5. Shows **corpus** flags (7 of 2,000) on the dashboard as a separate statistic.

Official test result: **precision 0.5000, recall 0.0769, F1 0.1333, FPR 0.0026** (TP/FP/FN = 1/1/12). Recall is low because HDFS_2k has about one line per block, so sequence signals are missing.

---

## 2. Numbers to quote (do not mix them)

| What you are asked | Say this | Do not say |
|---|---|---|
| Official academic result | Held-out test blocks: P 0.50, R 0.077, F1 0.133, FPR 0.0026 | “The model is 0.35% accurate” |
| Dashboard KPI | 2,000 lines, **7 model-flagged** records, 0.35% corpus rate | “7 confirmed incidents” |
| Ground truth in the sample | 69 lines with Label = Anomaly | That 69 is the model output |
| Baseline comparison | In-sample F1 0.036 → fair held-out F1 0.065 → improved F1 0.133 | That F1 is high |
| Alerts page | 7 candidate anomalies from `anomaly_prediction` | That the table is the complete flagged set |

`/api/anomalies` returns **highest scores**, not a filter on `anomaly_prediction=1`. The Alerts table is a sample. Totals come from `/api/stats`.

---

## 3. System the panel will see

OMEN X is the product name. Sign-in is mock (`aarav.mehta@nexora.example` / `nexora-enterprise`, or **Enter Demo Workspace**). Presidency University · CAI_37 is the project line.

After sign-in the first screen is **Home**: a greeting, one status sentence, and three counts. It does not say the system is safe. Corpus charts, the research benchmark, and retrain stay on **Overview**.

- **LIVE** means `/api/health` is ok. It is not a live tail.
- **Retrain** is on Overview and Model Evaluation. It rewrites the HDFS-2k model. Do not press it in the hall.
- Full HDFS_v1 is the dataset selector. Scores on those lines stay blank.

## 4. 8-minute demo script

1. **Launch.** `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000` from `ready/`.
2. **Login.** Enter Demo Workspace. Say: mock account.
3. **Home (60 s).** Read the greeting and the status line. Point at model flags, ground-truth labels, and the corpus rate. Say these are three different numbers.
4. **Overview (90 s).** Demo dataset: 2,000 / 7 / 0.35%. Then the HDFS_v1 research cards. F1 is effectively tied; baseline PR-AUC is higher.
5. **Dataset switch (60 s).** Full HDFS_v1. Show a parquet page and a blank score. Retrain is disabled.
6. **Stop.** Offer Q&A. Do not open Activity History. Do not retrain live.

If they ask for the official 2k result: precision 0.5000, recall 0.0769, F1 0.1333, FPR 0.0026, on 399 held-out blocks.

---

## 5. Setup if the demo machine is cold

```powershell
cd path\to\ready
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000  
If artifacts are missing: `python src/train_model.py` first.

Keep `results/anomaly_results.csv` intact. A corrupt CSV can break `/api/stats`.

---

## 6. Honest answers (short)

- **Why is F1 only 0.13?** Modest gain over a fair baseline of 0.065. Recall stayed 1/13.
- **Did training fail?** No. The dataset lacks per-block event sequences.
- **Is Isolation Forest supervised?** No. Labels are not `y`. They filter training when `train_on=normal`, pick the validation threshold, and score metrics.
- **Why evaluate blocks?** `anomaly_label.csv` is one label per BlockId.
- **What is 0.35%?** `7 / 2000` corpus flags. Not F1, not recall.
- **Can you stream logs?** No. Explorer max is 200 scored API rows.
- **What is the product name?** OMEN X. The sign-in account is a mock. It is not a production identity provider.

---

## 7. What was verified for this audit

- Live `GET /api/health` → `ok`
- Live `GET /api/stats` → 2000 / 7 / 69 / 0.35% / 14 events / 6 components
- Official metrics in `results/metrics.json` match the handoff table
- Saved model: `artifacts/isolation_forest_pipeline.joblib`
- GitHub `main` contains the project (`9d60327` at last push)
- Chart.js is now served from `/static/chart.umd.min.js` (no CDN for charts)

---

## 8. Known limits (say them; do not hide them)

- Low recall on HDFS_2k; small test anomaly count (13 blocks)
- Dashboard KPIs ≠ academic F1
- Retrain JSON mixes corpus counts and held-out metrics (keys are documented)
- Mock login, local-only, no Docker/cloud
- Google Fonts still load from the network; UI falls back to Segoe UI if that fails
