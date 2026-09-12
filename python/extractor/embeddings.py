"""Character n-gram vector embeddings for fuzzy OCR label matching."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np


def _char_ngrams(text: str, n_min: int = 2, n_max: int = 4) -> List[str]:
    s = f" {text.lower().strip()} "
    grams: List[str] = []
    for n in range(n_min, n_max + 1):
        if len(s) < n:
            continue
        grams.extend(s[i : i + n] for i in range(len(s) - n + 1))
    return grams


class LabelEmbedder:
    """
    Lightweight TF-style char-ngram embeddings.
    Offline, fast, and strong on OCR typos (Deneficiary ≈ Beneficiary).
    """

    def __init__(self, vocabulary: Optional[Dict[str, int]] = None):
        self.vocab: Dict[str, int] = vocabulary or {}
        self._idf: Optional[np.ndarray] = None

    def fit(self, corpus: Sequence[str]) -> "LabelEmbedder":
        df: Dict[str, int] = {}
        for doc in corpus:
            for g in set(_char_ngrams(doc)):
                df[g] = df.get(g, 0) + 1
        self.vocab = {g: i for i, g in enumerate(sorted(df))}
        n_docs = max(len(corpus), 1)
        idf = np.zeros(len(self.vocab), dtype=np.float32)
        for g, idx in self.vocab.items():
            idf[idx] = np.log((n_docs + 1) / (df[g] + 1)) + 1.0
        self._idf = idf
        return self

    def embed(self, text: str) -> np.ndarray:
        vec = np.zeros(len(self.vocab) or 1, dtype=np.float32)
        if not self.vocab:
            return vec
        counts: Dict[int, int] = {}
        for g in _char_ngrams(text):
            idx = self.vocab.get(g)
            if idx is not None:
                counts[idx] = counts.get(idx, 0) + 1
        for idx, c in counts.items():
            vec[idx] = float(c)
        if self._idf is not None and len(self._idf) == len(vec):
            vec *= self._idf
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec /= norm
        return vec

    def similarity(self, a: str, b: str) -> float:
        ea, eb = self.embed(a), self.embed(b)
        return float(np.dot(ea, eb))


@dataclass(frozen=True)
class FieldLabel:
    key: str
    canonical: str
    aliases: Tuple[str, ...] = ()


FIELD_LABELS: Tuple[FieldLabel, ...] = (
    FieldLabel("beneficiaryId", "Beneficiary Id", ("Beneficiary ID", "Benef ID", "Benificiary Id")),
    FieldLabel("beneficiaryName", "Beneficiary Name", ("Benef Name", "Beneficiary Nam")),
    FieldLabel("district", "District", ()),
    FieldLabel("taluka", "Taluka", ()),
    FieldLabel("village", "Village", ("Vinage", "Vilage")),
    FieldLabel("subDivision", "Sub Division", ("Sub-Division", "Subdivision", "Name of Sub Division")),
    FieldLabel("mobile", "Mobile", ("Mobile No", "Phone")),
    FieldLabel("applicationDate", "Application Date", ("Application",)),
    FieldLabel("currentStatus", "Current Status", ("Status",)),
    FieldLabel("category", "Beneficiary Category", ("Category",)),
    FieldLabel("pumpCapacity", "Pump Capacity", ("Pump Capacity in HP", "Capacity in HP")),
    FieldLabel("vendorName", "Vendor Name", ("Vendor",)),
    FieldLabel("vendorSelectionDate", "Vendor Selection Date", ("Selection Date",)),
)


class LabelMatcher:
    def __init__(self, threshold: float = 0.42):
        self.threshold = threshold
        corpus: List[str] = []
        self.entries: List[Tuple[str, str]] = []  # (key, phrase)
        for fl in FIELD_LABELS:
            phrases = (fl.canonical, *fl.aliases)
            for p in phrases:
                corpus.append(p)
                self.entries.append((fl.key, p))
        # Expand corpus with common OCR junk for better IDF
        corpus.extend(
            [
                "Beneficiary Application Details",
                "mahadiscom",
                "Name of",
                "Division",
                "HP",
            ]
        )
        self.embedder = LabelEmbedder().fit(corpus)
        self._phrase_vecs = [(k, p, self.embedder.embed(p)) for k, p in self.entries]

    def best_match(self, text: str) -> Optional[Tuple[str, str, float]]:
        cleaned = _normalize_label_candidate(text)
        if not cleaned:
            return None
        # Hard skip obvious headers
        if "application details" in cleaned.lower():
            return None

        q = self.embedder.embed(cleaned)
        best: Optional[Tuple[str, str, float]] = None
        for key, phrase, vec in self._phrase_vecs:
            score = float(np.dot(q, vec))
            # Prefer longer / more specific phrases on ties
            if best is None or score > best[2] + 1e-6 or (
                abs(score - best[2]) < 1e-6 and len(phrase) > len(best[1])
            ):
                best = (key, phrase, score)
        if best and best[2] >= self.threshold:
            return best
        return None

    def match_key(self, text: str) -> Optional[str]:
        m = self.best_match(text)
        return m[0] if m else None


def _normalize_label_candidate(text: str) -> str:
    t = text.strip()
    t = t.replace("|", " ").replace("'", " ").replace('"', " ").replace("*", " ")
    t = t.replace(";", ":").replace(",", " ")
    # Collapse separators at end used as label markers
    while t.endswith((":", ".", "-", "—")):
        t = t[:-1].rstrip()
    return " ".join(t.split())


def rank_lines_against_labels(
    lines: Iterable[str], matcher: LabelMatcher
) -> List[Tuple[int, str, str, float]]:
    """Return [(line_index, key, matched_phrase, score), ...] for lines that look like labels."""
    hits: List[Tuple[int, str, str, float]] = []
    for i, line in enumerate(lines):
        # Only consider the left side before a value separator when present
        left = line.split(":", 1)[0]
        left = left.split(".", 1)[0] if ":" not in line and len(line) < 40 else left
        m = matcher.best_match(left if len(left) <= 40 else line[:40])
        if m:
            hits.append((i, m[0], m[1], m[2]))
    return hits
