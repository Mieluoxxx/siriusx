# S3 session regression baselines

These are real DSH v4 session logs (zstd JSONL) produced by the DSH Web Host while driving the SiriusX executor-local plugin. The model was the deterministic local OpenAI-compatible mock; no upstream model was called.

| file | bytes | sha256 |
| --- | ---: | --- |
| 01-host-ui-run.jsonl.zstd | 5017 | 0d45595ffb8e396ea6ea94c5bed652f245110459bc050e0b3284ce883f904cc2 |
| 02-host-cli-run.jsonl.zstd | 5066 | 0460103c47d56e75b93d57b571e45519deb7e5962a146362459141e74b75d5eb |
| 03-third-task.jsonl.zstd | 5068 | 23635a935ff932059486156e4954bd2c7c4021cc6ddf340964bbeefe8becff0f |
| 04-failed-model-connection.jsonl.zstd | 7448 | aeca2735f8c4e6aeaf3986d25345f2eea83bde06030567ee66828ca210bcd0c7 |
