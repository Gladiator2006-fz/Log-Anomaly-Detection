# IEEE report facts: HDFS-2k and HDFS_v1

Use this note when writing the experimental section. The two corpora are different experiments. Do not put them in one results table.

A draft that titles a table “HDFS_v1 dataset statistics” and then reports a 399-trace confusion matrix is mixing the corpora. The 399-block matrix is the HDFS-2k held-out test. It is not a subset of the 575,061 HDFS_v1 blocks.

Do not print “29 feature dimensions (E1–E29).” This detector does not use that feature set.

## Features actually used

Twenty block-level inputs:

`Level`, `Component`, `EventId`, `message_length`, `token_count`, `digit_count`, `ip_count`, `has_exception`, `is_delete`, `is_replicate`, `is_verify`, `is_served`, `is_warn`, `block_mentions`, `hour`, `n_lines`, `n_events`, `event_frequency`, `component_frequency`, `event_component_frequency`.

HDFS_v1 has 12 masked-content event hashes in the saved ingest, not Drain templates E1–E29.

## Keep the two datasets apart

| | HDFS-2k | HDFS_v1 |
|---|---|---|
| What it is | Structured 2,000-line Loghub sample | Full parquet corpus, 5 files |
| Rows | 2,000 lines | 11,175,629 lines |
| Blocks | 1,994 BlockIds | 575,061 |
| Labels | 69 lines labelled Anomaly; 68 anomalous blocks (41 train / 14 validation / 13 test) | 16,838 anomalous blocks, 558,223 normal blocks (2.93%) |
| Official test | 399 blocks, 13 anomalies | 115,013 blocks, 3,368 anomalies |
| Score | `-decision_function`; flag if score is at least the threshold | Same rule, different threshold |
| Threshold | 0.182371. Max validation F1, then precision, over every unique validation score | 0.129092. Same rule, over 383 quantile candidates |
| Model | Isolation Forest, `train_on=normal`, 200 trees, `max_samples=auto`, `contamination=auto` | Same settings, reused from HDFS-2k. No full-corpus grid |
| Split | BlockId, stratified, `random_state=42`, 60/20/20. Frequency maps fit on train blocks only | Same protocol: 345,036 / 115,012 / 115,013 blocks |

The 0.35% figure is 7 model flags divided by 2,000 HDFS-2k lines. It is not precision, recall, F1, or accuracy, and it is not an HDFS_v1 result.

## HDFS-2k official held-out test

Source: `results/metrics.json`, object `improved_held_out_blocks`.

Validation chose the threshold. Do not mix validation counts into this table.

| | Predicted anomaly | Predicted normal |
|---|---|---|
| Actual anomaly (13) | TP = 1 | FN = 12 |
| Actual normal (386) | FP = 1 | TN = 385 |

- Precision: 0.5000
- Recall: 0.0769
- F1: 0.1333
- False-positive rate: 0.0026

Say that HDFS-2k is about one line per block, so sequence context is missing, and that 13 test anomalies make the F1 unstable.

The in-sample baseline (fit on all 2,000 lines) and the validation split are appendix material only.

## HDFS_v1 official held-out test

Source: `results/hdfs_full_metrics.json`, object `improved_held_out_blocks`.

Do not quote the validation PR-AUC of 0.2518 as the official number.

| | Predicted anomaly | Predicted normal |
|---|---|---|
| Actual anomaly (3,368) | TP = 1,932 | FN = 1,436 |
| Actual normal (111,645) | FP = 4,141 | TN = 107,504 |

Improved configuration:

- Precision: 0.3181
- Recall: 0.5736
- F1: 0.4093
- False-positive rate: 0.0371
- PR-AUC: 0.2370

Baseline on the same test blocks (`contamination=0.05`, original features, train fit, no tuned threshold):

- Precision: 0.3215
- Recall: 0.5582
- F1: 0.4080
- False-positive rate: 0.0355
- PR-AUC: 0.4652
- TP / FP / FN / TN: 1,880 / 3,967 / 1,488 / 107,678

F1 rises by 0.0012. That is a tie, not an improvement. Baseline PR-AUC is higher, so the baseline ranks test anomalies better. Say that in the discussion.

PR-AUC is average precision on the scores. It does not depend on the chosen threshold.

## Sections the IEEE report needs

1. **Datasets and citation.** Name Xu et al., SOSP 2009, for the HDFS block labels, and Zhu et al., ISSRE 2023, for the Loghub release. Say the label belongs to the block, not the line. This repository does not store a bibliography file.
2. **Preprocessing.** Keep only the first `blk_-?\d+` in a line. On HDFS_v1, `EventId` is an MD5 of the content after masking block id, IP, and digits. It is not an official Drain id.
3. **Leakage control.** Split by BlockId before fitting frequency maps. Labels are used to drop known anomalies from training, to pick the validation threshold, and to score the held-out test. They are not a supervised training target.
4. **Decision rule.** Score equals `-decision_function`. Publish the threshold and the objective: maximum validation F1, then precision. State that HDFS_v1 searched score quantiles rather than every unique score.
5. **Metrics.** Precision, recall, F1, false-positive rate, and the confusion counts on held-out blocks. Add PR-AUC for HDFS_v1 and state that it does not depend on the threshold. Define each metric once.
6. **Two result tables.** One for the 399-block HDFS-2k test. One for the 115,013-block HDFS_v1 test, with baseline beside improved. A third small table can list corpus size only.
7. **Limitations.** The HDFS-2k test count is small. On HDFS_v1 the F1 values are tied and the improved PR-AUC is worse. Settings were not re-tuned on the full corpus. The live demo still scores HDFS-2k only.

Retrain in the demo rewrites the HDFS-2k joblib, the results CSV, and `metrics.json`. It does not recompute the HDFS_v1 table. The numbers in this file are the saved result files, not a fresh run.
