from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

from anomaly_pipeline import load_and_prepare, load_model, train_and_evaluate  # noqa: E402

app = FastAPI(title="AI Log Anomaly Detection API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=ROOT / "dashboard"), name="static")


def result_df():
    try:
        import pandas as pd
        results = ROOT / "results" / "anomaly_results.csv"
        if not results.exists():
            train_and_evaluate()
        return pd.read_csv(results)
    except Exception:
        return load_and_prepare()


@app.get("/", response_class=HTMLResponse)
def home():
    return (ROOT / "dashboard" / "index.html").read_text(encoding="utf-8")


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "AI Log Anomaly Detection"}


@app.get("/api/stats")
def stats():
    df = result_df()
    detected = int(df["anomaly_prediction"].sum())
    total = int(len(df))
    actual = int((df["Label"] == "Anomaly").sum())
    return {
        "total_logs": total,
        "detected_anomalies": detected,
        "actual_anomalies": actual,
        "anomaly_rate": round((detected / total) * 100, 2) if total else 0,
        "event_types": int(df["EventId"].nunique()),
        "components": int(df["Component"].nunique()),
    }


@app.get("/api/anomalies")
def anomalies(limit: int = Query(20, ge=1, le=200)):
    df = result_df().sort_values("anomaly_score", ascending=False).head(limit)
    records = df[["LineId", "BlockId", "EventId", "Level", "Component", "Content", "anomaly_score", "Label"]].copy()
    records["anomaly_score"] = records["anomaly_score"].round(4)
    return records.fillna("").to_dict(orient="records")


@app.post("/api/retrain")
def retrain():
    _, metrics = train_and_evaluate()
    return metrics
