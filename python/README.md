# WhatsApp Sheet Bot — Python Extractor (FastAPI)

Local OCR + field-extraction service used by the Electron bot.

## Setup

```bash
npm run extractor:install
```

## Run (manual)

```bash
npm run extractor
```

Service listens on `http://127.0.0.1:8765`.

The Electron app also auto-starts this API on first image extract.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness |
| POST | `/extract` | JSON `{"path":"/abs/image.jpg"}` |
| POST | `/extract/upload` | Multipart image upload |
| POST | `/extract/batch` | JSON `{"paths":[...]}` up to 500 images |
| POST | `/extract/text` | Parse raw OCR text (debug) |

## How it works

1. **Per-image fine-tuning** — each screenshot is preprocessed into multiple variants (contrast / binary / denoise / upscale).
2. **OCR** — Tesseract runs on each variant; the best text is selected.
3. **Vector embeddings** — character n-gram embeddings match noisy OCR labels (`Deneficiary`, `ame`, …) to canonical fields.
4. **Layout rules** — Mahadiscom-specific patterns (split `Beneficiary` / `Name` lines, `Sub- Division`, etc.).
5. **Scale** — FastAPI + thread pool (`EXTRACT_WORKERS`, default 4) handles concurrent `/extract/batch` jobs.

## Env

- `EXTRACT_HOST` (default `127.0.0.1`)
- `EXTRACT_PORT` (default `8765`)
- `EXTRACT_WORKERS` (default `4`)
