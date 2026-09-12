"""Per-image preprocessing variants to improve OCR reliability."""

from __future__ import annotations

import io
from typing import List, Tuple

from PIL import Image, ImageEnhance, ImageFilter, ImageOps


def load_image(path: str) -> Image.Image:
    img = Image.open(path)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return img


def _upscale(img: Image.Image, min_width: int = 1200) -> Image.Image:
    if img.width >= min_width:
        return img
    scale = min_width / float(img.width)
    new_size = (int(img.width * scale), int(img.height * scale))
    return img.resize(new_size, Image.Resampling.LANCZOS)


def preprocess_variants(path: str) -> List[Tuple[str, Image.Image]]:
    """
    Build several tuned versions of the same screenshot.
    Each image is fine-tuned individually for contrast / sharpness / binarization.
    """
    base = _upscale(load_image(path))
    gray = ImageOps.grayscale(base)

    # Auto-contrast helps washed phone screenshots
    auto = ImageOps.autocontrast(gray, cutoff=2)

    sharp = ImageEnhance.Sharpness(auto).enhance(1.8)
    contrast = ImageEnhance.Contrast(sharp).enhance(1.6)

    # Adaptive-ish binary via point threshold around mean
    hist = contrast.histogram()
    total = sum(hist) or 1
    cum = 0
    thr = 128
    for i, v in enumerate(hist):
        cum += v
        if cum >= total * 0.55:
            thr = i
            break
    binary = contrast.point(lambda p: 255 if p > thr else 0)

    denoise = contrast.filter(ImageFilter.MedianFilter(size=3))

    return [
        ("original_upscaled", base.convert("RGB")),
        ("auto_contrast", contrast.convert("RGB")),
        ("binary", binary.convert("RGB")),
        ("denoise", denoise.convert("RGB")),
    ]


def image_to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
