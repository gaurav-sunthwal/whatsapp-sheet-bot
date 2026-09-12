"""
FastAPI OCR + field extraction service.

Scalable local backend used by the Electron/WhatsApp bot:
  POST /extract          — JSON {"path": "..."} local image
  POST /extract/upload   — multipart image upload
  POST /extract/batch    — many image paths
  POST /extract/text     — parse raw OCR text
  GET  /health           — liveness
"""

from __future__ import annotations

import asyncio
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from extractor.pipeline import extract_from_image, extract_from_text

APP_DIR = Path(__file__).resolve().parent
MAX_WORKERS = int(os.environ.get("EXTRACT_WORKERS", "4"))
UPLOAD_DIR = Path(os.environ.get("EXTRACT_UPLOAD_DIR", str(APP_DIR / ".uploads")))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

executor = ThreadPoolExecutor(max_workers=MAX_WORKERS)

app = FastAPI(
    title="WhatsApp Sheet Bot Extractor",
    version="1.0.0",
    description="Per-image OCR fine-tuning + embedding-based Mahadiscom field extraction",
)


class PathExtractRequest(BaseModel):
    path: str = Field(..., description="Absolute path to an image on disk")


class TextExtractRequest(BaseModel):
    text: str = Field(..., description="Raw OCR text to parse")


class BatchPathRequest(BaseModel):
    paths: List[str] = Field(..., min_length=1, max_length=500)


class ExtractResponse(BaseModel):
    ok: bool
    fields: Dict[str, Any] = Field(default_factory=dict)
    variant: Optional[str] = None
    variantScores: Optional[List[Dict[str, Any]]] = None
    ocrText: Optional[str] = None
    error: Optional[str] = None


@app.on_event("startup")
def _warm() -> None:
    extract_from_text(
        "Beneficiary Id : WARMUP123456\nDistrict : PUNE\nBeneficiary Name : TEST USER"
    )


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "service": "extractor",
        "version": os.environ.get("EXTRACTOR_VERSION", "2026.09.12.3"),
        "workers": MAX_WORKERS,
    }


@app.post("/extract/text", response_model=ExtractResponse)
def extract_text(body: TextExtractRequest) -> ExtractResponse:
    return ExtractResponse(**extract_from_text(body.text))


@app.post("/extract", response_model=ExtractResponse)
async def extract_by_path(body: PathExtractRequest) -> ExtractResponse:
    path = body.path
    if not Path(path).exists():
        raise HTTPException(status_code=404, detail=f"Image not found: {path}")
    result = await _run_extract(path)
    return ExtractResponse(**result)


@app.post("/extract/upload", response_model=ExtractResponse)
async def extract_upload(file: UploadFile = File(...)) -> ExtractResponse:
    suffix = Path(file.filename or "upload.jpg").suffix or ".jpg"
    dest = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload")
    dest.write_bytes(data)
    try:
        result = await _run_extract(str(dest))
        return ExtractResponse(**result)
    finally:
        try:
            dest.unlink(missing_ok=True)
        except OSError:
            pass


@app.post("/extract/batch")
async def extract_batch(body: BatchPathRequest) -> Dict[str, Any]:
    missing = [p for p in body.paths if not Path(p).exists()]
    if missing:
        raise HTTPException(
            status_code=404,
            detail={"missing": missing[:20], "count": len(missing)},
        )

    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(executor, extract_from_image, p) for p in body.paths]
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    results = []
    for path, item in zip(body.paths, raw_results):
        if isinstance(item, Exception):
            results.append({"ok": False, "path": path, "error": str(item), "fields": {}})
        else:
            item["path"] = path
            results.append(item)

    processed = sum(1 for r in results if r.get("ok"))
    return {
        "ok": True,
        "total": len(results),
        "processed": processed,
        "failed": len(results) - processed,
        "results": results,
    }


async def _run_extract(image_path: str) -> Dict[str, Any]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, extract_from_image, image_path)


def run() -> None:
    import uvicorn

    host = os.environ.get("EXTRACT_HOST", "127.0.0.1")
    port = int(os.environ.get("EXTRACT_PORT", "8765"))
    uvicorn.run(
        "api:app",
        host=host,
        port=port,
        reload=False,
        workers=1,
        log_level="info",
    )


if __name__ == "__main__":
    run()
