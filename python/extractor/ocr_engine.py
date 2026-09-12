"""OCR runner over multiple per-image preprocess variants."""

from __future__ import annotations

import re
from typing import List, Tuple

import pytesseract
from PIL import Image

from .preprocess import preprocess_variants


def _score_ocr_text(text: str) -> float:
    """Heuristic quality score — prefer texts with known Mahadiscom cues."""
    if not text or not text.strip():
        return -1.0
    t = text.lower()
    score = 0.0
    for cue in (
        "district",
        "taluka",
        "village",
        "beneficiary",
        "mobile",
        "vendor",
        "pump",
        "category",
        "status",
    ):
        if cue in t:
            score += 3.0
    # Digits / IDs present
    score += min(len(re.findall(r"[A-Za-z]{1,4}\d{6,}", text)), 3) * 2.0
    score += min(len(re.findall(r"\d", text)), 40) * 0.05
    # Penalize mostly-garbage short OCR
    alpha = len(re.findall(r"[A-Za-z]", text))
    score += min(alpha, 200) * 0.02
    return score


def run_ocr_on_image(img: Image.Image) -> str:
    # PSM 6 = assume a single uniform block of text (form screenshot)
    config = "--oem 3 --psm 6"
    return pytesseract.image_to_string(img, lang="eng", config=config) or ""


def ocr_best_text(image_path: str) -> Tuple[str, str, List[Tuple[str, float]]]:
    """
    Fine-tune each image through multiple preprocess paths and pick the best OCR.
    Returns (best_text, best_variant_name, [(variant, score), ...]).
    """
    results: List[Tuple[str, float, str]] = []
    for name, img in preprocess_variants(image_path):
        text = run_ocr_on_image(img)
        score = _score_ocr_text(text)
        results.append((name, score, text))

    results.sort(key=lambda x: x[1], reverse=True)
    scored = [(n, s) for n, s, _ in results]
    if not results:
        return "", "none", scored
    best_name, _, best_text = results[0]
    return best_text, best_name, scored
