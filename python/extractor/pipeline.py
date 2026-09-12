"""End-to-end extract pipeline for a single image or raw OCR text."""

from __future__ import annotations

from typing import Any, Dict, List

from .ocr_engine import ocr_best_text
from .parse_fields import extract_fields_from_text


def extract_from_text(text: str) -> Dict[str, Any]:
    fields = extract_fields_from_text(text)
    return {
        "ok": True,
        "fields": fields,
        "ocrText": text,
        "variant": "text-only",
        "variantScores": [],
    }


def extract_from_image(image_path: str) -> Dict[str, Any]:
    text, variant, scores = ocr_best_text(image_path)
    fields = extract_fields_from_text(text)
    return {
        "ok": bool(fields.get("beneficiaryId")),
        "fields": fields,
        "ocrText": text,
        "variant": variant,
        "variantScores": [{"name": n, "score": s} for n, s in scores],
    }


def extract_from_images(image_paths: List[str]) -> List[Dict[str, Any]]:
    return [extract_from_image(p) for p in image_paths]
