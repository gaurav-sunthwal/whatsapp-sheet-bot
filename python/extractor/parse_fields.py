"""Field extraction using embedding label matching + Mahadiscom layout rules."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from .embeddings import LabelMatcher

VALUE_BLACKLIST = {
    "MAHADISCOM",
    "MAHADISCOMIN",
    "BENEFICIARY",
    "APPLICATION",
    "DETAILS",
    "DISTRICT",
    "TALUKA",
    "VILLAGE",
    "DIVISION",
    "SELECTION",
    "STATUS",
    "CATEGORY",
    "VENDOR",
    "MOBILE",
    "GENERAL",
    "NAME",
    "DATE",
    "PUMP",
    "CAPACITY",
    "HP",
    "CURRENT",
    "SUB",
    "OF",
}


def normalize_lines(text: str) -> List[str]:
    lines: List[str] = []
    for raw in str(text or "").replace("\r\n", "\n").split("\n"):
        line = re.sub(r"[ \t]+", " ", raw).strip()
        if line:
            lines.append(line)
    return lines


def clean_value(value: str) -> str:
    v = str(value or "")
    v = re.sub(r"^[:.\-|\"'*;,\s]+", "", v)
    v = re.sub(r"[:.\-|\"'*;,\s]+$", "", v)
    return re.sub(r"\s+", " ", v).strip()


def is_plausible_id(token: str) -> bool:
    if not token:
        return False
    t = token.upper()
    if not (8 <= len(t) <= 20):
        return False
    if t in VALUE_BLACKLIST:
        return False
    if not re.search(r"\d", t):
        return False
    if not re.fullmatch(r"[A-Z0-9]+", t):
        return False
    return True


def sanitize_id(raw: str) -> str:
    tokens = re.findall(r"[A-Za-z0-9]{8,20}", raw or "")
    for tok in tokens:
        up = tok.upper()
        if is_plausible_id(up):
            return up
    return ""


CATEGORY_TOKENS = {
    "OBC", "SC", "ST", "OPEN", "GENERAL", "EWS", "NT", "SBC", "VJNT",
}


def looks_like_name(value: str, *, allow_short_token: bool = False) -> bool:
    v = clean_value(value)
    if not v or len(v) < 3:
        return False
    if is_plausible_id(re.sub(r"\s+", "", v)):
        return False
    if re.fullmatch(r"[\dXx]+", v):
        return False
    letters = re.findall(r"[A-Za-z]", v)
    if len(letters) < 3:
        return False
    if v.upper() in VALUE_BLACKLIST:
        return False
    if v.upper() in CATEGORY_TOKENS:
        return False
    if re.search(r"\b(district|taluka|village|mobile|vendor|status|category|pump|sub-?|s/dn|division|\bid\b)\b", v, re.I):
        return False
    tokens = v.split()
    if len(tokens) == 1 and len(tokens[0]) < (3 if allow_short_token else 5):
        return False
    return True


def looks_like_mobile(value: str) -> bool:
    m = re.sub(r"[^\dXx]", "", value or "")
    return bool(re.fullmatch(r"[\dXx]{8,15}", m))


def _is_beneficiary_word(text: str) -> bool:
    return bool(re.match(r"^d?enef\w*|^benef\w*", text.strip(), re.I))


def _is_name_of_subdivision_label(text: str) -> bool:
    low = text.lower().strip()
    return low in {"name of", "name of sub", "name of sub-"} or bool(
        re.match(r"^name\s+of\b", low)
    ) and "benef" not in low


class FieldExtractor:
    def __init__(self):
        self.matcher = LabelMatcher(threshold=0.40)

    def extract(self, text: str) -> Dict[str, str]:
        lines = normalize_lines(text)
        fields: Dict[str, str] = {
            "receivedAt": datetime.now().strftime("%d/%m/%Y, %I:%M:%S %p"),
        }

        labeled = self._extract_labeled(lines)
        fields.update({k: v for k, v in labeled.items() if v})

        fields["beneficiaryId"] = (
            sanitize_id(fields.get("beneficiaryId", ""))
            or self._find_id(lines)
        )
        labeled_name = self._normalize_name(fields.get("beneficiaryName", ""))
        found_name = self._find_name(lines)
        fields["beneficiaryName"] = (
            found_name if len(found_name) >= len(labeled_name) else labeled_name
        )
        fields["mobile"] = self._normalize_mobile(fields.get("mobile", "")) or self._find_mobile(lines)
        fields["applicationDate"] = self._normalize_datey(fields.get("applicationDate", ""))
        fields["vendorSelectionDate"] = self._normalize_datey(fields.get("vendorSelectionDate", ""))
        fields["pumpCapacity"] = self._normalize_pump(fields.get("pumpCapacity", ""))
        fields["currentStatus"] = self._normalize_status(fields.get("currentStatus", ""))
        fields["category"] = self._normalize_category(fields.get("category", "")) or self._find_category(lines)
        fields["vendorName"] = self._normalize_vendor(fields.get("vendorName", ""), lines)
        fields["subDivision"] = clean_value(fields.get("subDivision", "")) or self._find_subdivision(lines)
        fields["subDivision"] = re.sub(
            r"^(name\s+of|sub-?|division)\b[:.\-\s]*", "", fields["subDivision"], flags=re.I
        ).strip()

        for k, v in list(fields.items()):
            if isinstance(v, str):
                fields[k] = clean_value(v)

        return fields

    def _split_label_value(self, line: str) -> Tuple[str, str]:
        for sep in (":", "|", ";", "+"):
            if sep in line:
                left, right = line.split(sep, 1)
                return left.strip(), right.strip()
        # "load - PRIYA..." / "Beneficiary - OBC"
        if " - " in line:
            left, right = line.split(" - ", 1)
            if len(left.strip()) <= 24:
                return left.strip(), right.strip()
        if "." in line:
            left, right = line.split(".", 1)
            if len(left.strip()) <= 24:
                return left.strip(), right.strip()
        return line.strip(), ""

    def _line_label_key(self, line: str) -> Optional[Tuple[str, float, str]]:
        left, right = self._split_label_value(line)

        # "Name of" / "Sub-" belongs to subdivision, never beneficiary name
        if _is_name_of_subdivision_label(left) or _is_name_of_subdivision_label(line):
            return "subDivision", 0.95, right
        if re.match(r"^sub-?\b", left, re.I):
            return "subDivision", 0.95, right

        if _is_beneficiary_word(left) and not re.search(r"\b(name|id|category)\b", left, re.I):
            if sanitize_id(right):
                return "beneficiaryId", 0.99, right
            # Short caste/category codes on a Beneficiary line
            if right.upper().strip(" .") in CATEGORY_TOKENS:
                return "category", 0.9, right
            if looks_like_name(right):
                return "beneficiaryName", 0.99, right
            if right.strip().lower() in {"", "name", "ame", "id"}:
                return "beneficiaryName", 0.55, right

        # Require "name" to be beneficiary-related, not bare "Name of"
        m = self.matcher.best_match(left)
        if m and m[2] >= self.matcher.threshold:
            key = m[0]
            if key == "beneficiaryName":
                if _is_name_of_subdivision_label(left) or (
                    "name" in left.lower() and "benef" not in left.lower() and "of" in left.lower()
                ):
                    return "subDivision", m[2], right
                if left.lower().strip() in {"name", "ame"}:
                    return "beneficiaryName", 0.5, right
            # If value wasn't split out, try remainder after the matched phrase
            val = right
            if not val:
                val = clean_value(re.sub(re.escape(m[1]), "", left, count=1, flags=re.I))
                if not val:
                    val = clean_value(re.sub(re.escape(m[1]), "", line, count=1, flags=re.I))
            if key == "mobile" and val and not looks_like_mobile(val):
                return key, m[2], ""
            if key == "category" and val:
                val = re.sub(r"^[^A-Za-z0-9]+", "", val)
            return key, m[2], val

        m = self.matcher.best_match(line)
        if m and m[2] >= self.matcher.threshold:
            if m[0] == "beneficiaryName" and _is_name_of_subdivision_label(line):
                return "subDivision", m[2], ""
            remainder = clean_value(re.sub(re.escape(m[1]), "", line, count=1, flags=re.I))
            if m[0] == "category" and remainder:
                remainder = re.sub(r"^[^A-Za-z0-9]+", "", remainder)
            return m[0], m[2], remainder
        return None

    def _is_labelish(self, line: str) -> bool:
        if self._line_label_key(line):
            return True
        low = line.lower().strip()
        if low in {"name", "ame", "ate", "date", "id", "division", "hp", "vendor", "status", "category"}:
            return True
        if re.match(r"^(name of|sub-?|benef\w*|denef\w*|pump|capacity|current|selection)\b", low):
            return True
        return False

    def _extract_labeled(self, lines: List[str]) -> Dict[str, str]:
        out: Dict[str, str] = {}
        i = 0
        while i < len(lines):
            line = lines[i]
            hit = self._line_label_key(line)
            if not hit:
                i += 1
                continue
            key, _score, value = hit

            if key == "beneficiaryName":
                name = self._collect_name(lines, i, value)
                # Prefer later real name hits over weak early false positives
                if name and (
                    "beneficiaryName" not in out
                    or len(name) > len(out["beneficiaryName"])
                ):
                    out["beneficiaryName"] = name
                i += 1
                continue

            if key == "beneficiaryId":
                bid = sanitize_id(value) or sanitize_id(self._next_value(lines, i))
                if bid and "beneficiaryId" not in out:
                    out["beneficiaryId"] = bid
                i += 1
                continue

            if key == "mobile":
                mob = value if looks_like_mobile(value) else ""
                if not mob:
                    nxt = self._next_value(lines, i)
                    if looks_like_mobile(nxt):
                        mob = nxt
                if mob and "mobile" not in out:
                    out["mobile"] = mob
                i += 1
                continue

            if key == "currentStatus":
                status = clean_value(value)
                if not status and re.match(r"^current\b", line, re.I):
                    status = clean_value(re.sub(r"^current(?:\s*status)?\b[:.\-\s]*", "", line, flags=re.I))
                nxt = lines[i + 1] if i + 1 < len(lines) else ""
                if re.match(r"^status\b", nxt, re.I):
                    tail = re.sub(r"^status\b[:.\-\s]*", "", nxt, flags=re.I)
                    status = clean_value(f"{status} {tail}")
                elif not status:
                    status = self._next_value(lines, i)
                if status and "currentStatus" not in out:
                    out["currentStatus"] = status
                i += 1
                continue

            if key == "vendorName":
                vendor = clean_value(value)
                if not vendor or vendor.lower() in {"name", "ame", "selection"}:
                    vendor = self._find_vendor_near(lines, i)
                if vendor and "vendorName" not in out:
                    out["vendorName"] = vendor
                i += 1
                continue

            if key == "vendorSelectionDate":
                date_v = clean_value(value) or self._next_value(lines, i)
                if date_v and "vendorSelectionDate" not in out:
                    out["vendorSelectionDate"] = date_v
                i += 1
                continue

            if key == "applicationDate":
                date_v = clean_value(value)
                if not date_v or date_v.lower() in {"date", "ate"} or re.fullmatch(r"\d{1,2}", date_v):
                    nxt = lines[i + 1] if i + 1 < len(lines) else ""
                    if re.match(r"^(date|ate)\b", nxt, re.I):
                        date_v = clean_value(re.sub(r"^(date|ate)\b[:.\-\s]*", "", nxt, flags=re.I))
                    else:
                        date_v = self._next_value(lines, i)
                if date_v and not re.fullmatch(r"\d{1,2}", date_v) and "applicationDate" not in out:
                    out["applicationDate"] = date_v
                i += 1
                continue

            if key == "pumpCapacity":
                cap = clean_value(value)
                if not cap or cap.lower() in {"in", "hp", "pump", "capacity"}:
                    for j in range(i, min(i + 4, len(lines))):
                        m = re.search(r"(\d+\s*H\.?P\.?)", lines[j], re.I)
                        if m:
                            cap = m.group(1)
                            break
                        if ":" in lines[j]:
                            right = clean_value(lines[j].split(":", 1)[1])
                            if re.search(r"\d", right):
                                cap = right
                                break
                if cap and re.search(r"\d", cap) and "pumpCapacity" not in out:
                    out["pumpCapacity"] = cap
                i += 1
                continue

            if key == "category":
                cat = clean_value(value)
                if not cat or cat.lower() in {"beneficiary", "name"}:
                    # "Beneficiary |" then "Category * sc"
                    nxt = lines[i + 1] if i + 1 < len(lines) else ""
                    if re.match(r"^category\b", nxt, re.I):
                        cat = clean_value(re.sub(r"^category\b[:.\-|\"'*;\s]*", "", nxt, flags=re.I))
                    else:
                        cat = self._next_value(lines, i)
                cat = re.sub(r"^[^A-Za-z0-9]+", "", cat)
                if cat.upper() in CATEGORY_TOKENS or (cat and len(cat) <= 12):
                    if cat and "category" not in out:
                        out["category"] = cat
                i += 1
                continue

            if key == "subDivision":
                sub = clean_value(value) or self._next_value(lines, i)
                sub = re.sub(r"^(name\s+of|sub-?|division)\b[:.\-\s]*", "", sub, flags=re.I)
                sub = clean_value(sub)
                if sub and "subDivision" not in out:
                    out["subDivision"] = sub
                i += 1
                continue

            if not value:
                value = self._next_value(lines, i)
            value = clean_value(value)
            if value and key not in out:
                out[key] = value
            i += 1

        return out

    def _next_value(self, lines: List[str], i: int) -> str:
        if i + 1 >= len(lines):
            return ""
        nxt = lines[i + 1]
        key_hit = self._line_label_key(nxt)
        if key_hit and not key_hit[2]:
            return ""
        if self._is_labelish(nxt) and len(nxt) < 12 and " " not in clean_value(nxt):
            if i + 2 < len(lines) and not self._line_label_key(lines[i + 2]):
                return clean_value(lines[i + 2])
            return ""
        return clean_value(nxt)

    def _collect_name(self, lines: List[str], i: int, first_value: str) -> str:
        parts: List[str] = []
        if looks_like_name(first_value):
            parts.append(clean_value(first_value))

        for j in range(i + 1, min(i + 3, len(lines))):
            line = lines[j]
            low = line.lower().strip()
            if low in {"name", "ame"} or re.match(r"^(name|ame)\b", low):
                rest = clean_value(re.sub(r"^(name|ame)\b[:.\-|\"'*;\s]*", "", line, flags=re.I))
                if looks_like_name(rest, allow_short_token=True):
                    parts.append(rest)
                continue
            if self._line_label_key(line) and not looks_like_name(line):
                break
            if looks_like_name(line) and not sanitize_id(line):
                left = line.split(":")[0]
                if self.matcher.match_key(left) in {"district", "taluka", "village", "mobile"}:
                    break
                parts.append(clean_value(line))
            else:
                break
        return self._normalize_name(" ".join(parts))

    def _find_name(self, lines: List[str]) -> str:
        for i, line in enumerate(lines):
            low = line.lower()
            # OCR sometimes turns "Beneficiary" into "load" / "rpnenciary" etc.
            is_benef = bool(re.match(r"^(benef|denef|rpnenci|load)\b", low))
            if not is_benef and not (
                i + 1 < len(lines) and lines[i + 1].lower().strip() in {"ame", "name"}
            ):
                continue
            if re.search(r"\b(id|category)\b", low):
                continue

            _left, rest = self._split_label_value(line)
            rest = clean_value(rest)
            if rest.upper() in CATEGORY_TOKENS:
                continue

            # "load - PRIYA SURESH SHARMA" / "ame"
            if looks_like_name(rest) or (
                rest and i + 1 < len(lines) and lines[i + 1].lower().strip() in {"ame", "name"}
            ):
                chunks = [rest] if looks_like_name(rest, allow_short_token=True) or looks_like_name(rest) else []
                if not chunks and rest and looks_like_name(rest, allow_short_token=True):
                    chunks = [rest]
                if not chunks and rest and len(re.findall(r"[A-Za-z]", rest)) >= 6:
                    chunks = [rest]
                for j in range(i + 1, min(i + 3, len(lines))):
                    nxt = lines[j]
                    if re.match(r"^(name|ame)\b", nxt, re.I) or nxt.lower().strip() in {"name", "ame"}:
                        bit = clean_value(re.sub(r"^(name|ame)\b[:.\-|\"'*;\s]*", "", nxt, flags=re.I))
                        if looks_like_name(bit, allow_short_token=True):
                            chunks.append(bit)
                        continue
                    break
                name = self._normalize_name(" ".join(chunks))
                if name:
                    return name

            if rest.lower() in {"", "name", "ame"} or re.fullmatch(r"name", rest, re.I):
                chunks = []
                for j in range(i + 1, min(i + 4, len(lines))):
                    nxt = lines[j]
                    if re.match(r"^(name|ame)\b", nxt, re.I):
                        bit = clean_value(re.sub(r"^(name|ame)\b[:.\-|\"'*;\s]*", "", nxt, flags=re.I))
                        if looks_like_name(bit, allow_short_token=True):
                            chunks.append(bit)
                        continue
                    if looks_like_name(nxt) and not self._line_label_key(nxt):
                        chunks.append(clean_value(nxt))
                    elif sanitize_id(nxt):
                        break
                    else:
                        break
                name = self._normalize_name(" ".join(chunks))
                if name:
                    return name
                continue

            if looks_like_name(rest):
                chunks = [rest]
                for j in range(i + 1, min(i + 3, len(lines))):
                    nxt = lines[j]
                    if re.match(r"^(name|ame)\b", nxt, re.I):
                        bit = clean_value(re.sub(r"^(name|ame)\b[:.\-|\"'*;\s]*", "", nxt, flags=re.I))
                        if looks_like_name(bit, allow_short_token=True):
                            chunks.append(bit)
                        continue
                    if nxt.lower() in {"name", "ame"}:
                        continue
                    break
                name = self._normalize_name(" ".join(chunks))
                if name:
                    return name
        return ""

    def _find_id(self, lines: List[str]) -> str:
        joined = "\n".join(lines)
        m = re.search(r"(?:benef|denef)\w*\s*(?:id)?\s*[:.\-|]?\s*([A-Za-z0-9]{8,20})", joined, re.I)
        if m and is_plausible_id(m.group(1)):
            return m.group(1).upper()

        candidates = []
        for line in lines[:12]:
            for tok in re.findall(r"[A-Za-z0-9]{8,20}", line):
                up = tok.upper()
                if is_plausible_id(up):
                    score = 0
                    if re.search(r"[A-Z]", up) and re.search(r"\d", up):
                        score += 20
                    if re.match(r"^(MH|MT|AG|BE|BN|6A)", up):
                        score += 15
                    if re.fullmatch(r"\d{10}", up):
                        score -= 10
                    candidates.append((score, up))
        candidates.sort(reverse=True)
        return candidates[0][1] if candidates else ""

    def _find_mobile(self, lines: List[str]) -> str:
        for line in lines:
            if not re.search(r"mobile", line, re.I):
                continue
            _l, right = self._split_label_value(line)
            cand = right or re.sub(r"^.*mobile\b[:.\-+|\"'*;\s]*", "", line, flags=re.I)
            cand = clean_value(cand)
            if looks_like_mobile(cand):
                return self._normalize_mobile(cand)
        return ""

    def _find_category(self, lines: List[str]) -> str:
        for i, line in enumerate(lines):
            if re.match(r"^category\b", line, re.I) or re.search(r"\bcategory\b", line, re.I):
                val = clean_value(re.sub(r"^.*category\b[:.\-|\"'*;\s]*", "", line, flags=re.I))
                val = re.sub(r"^[^A-Za-z0-9]+", "", val)
                if val.upper() in CATEGORY_TOKENS:
                    return val.upper()
            # Beneficiary . OBC then Category
            left, right = self._split_label_value(line)
            if _is_beneficiary_word(left) and right.upper().strip() in CATEGORY_TOKENS:
                return right.upper().strip()
            if _is_beneficiary_word(line) and i + 1 < len(lines) and re.match(r"^category\b", lines[i + 1], re.I):
                val = clean_value(re.sub(r"^category\b[:.\-|\"'*;\s]*", "", lines[i + 1], flags=re.I))
                val = re.sub(r"^[^A-Za-z0-9]+", "", val)
                if val:
                    return val.upper()
        return ""

    def _find_subdivision(self, lines: List[str]) -> str:
        for i, line in enumerate(lines):
            if re.search(r"sub-?", line, re.I) and ":" in line:
                return clean_value(line.split(":", 1)[1])
            if i > 0 and re.search(r"name of", lines[i - 1], re.I) and re.search(r"sub", line, re.I):
                if ":" in line:
                    return clean_value(line.split(":", 1)[1])
        return ""

    def _find_vendor_near(self, lines: List[str], i: int) -> str:
        window = lines[max(0, i - 2) : min(len(lines), i + 4)]
        for line in window:
            low = line.lower()
            if "selection" in low and re.search(r"\d", line):
                continue
            if re.match(r"^(vendor|name|ame|selection|date)\b", low):
                rest = clean_value(re.sub(r"^(vendor|name|ame|selection|date)\b[:.\-|\"'*;\s]*", "", line, flags=re.I))
                if len(rest) >= 4 and not sanitize_id(rest) and "selection" not in rest.lower():
                    return rest
            if re.search(r"\b(pvt|ltd|limited|solutions|solar|brothers|india|ecozen)\b", low):
                v = re.sub(r"^(vendor|name|ame|ili)\b[:.\-|\"'*;\s]*", "", line, flags=re.I)
                return clean_value(v)
        return ""

    def _normalize_name(self, name: str) -> str:
        n = clean_value(name)
        n = re.sub(r"\b(name|ame)\b", " ", n, flags=re.I)
        n = re.sub(r"\s+", " ", n).strip()
        if not looks_like_name(n):
            return ""
        return n.upper()

    def _normalize_mobile(self, mobile: str) -> str:
        return re.sub(r"[^\dXx]", "", mobile or "")

    def _normalize_datey(self, value: str) -> str:
        v = clean_value(value)
        v = re.sub(r"^(date|ate)\b[:.\-\s]*", "", v, flags=re.I)
        v = clean_value(v)
        if re.search(r"\b(vendor|selection|status|category)\b", v, re.I) and not re.search(r"\d", v):
            return ""
        return v

    def _normalize_vendor(self, value: str, lines: List[str]) -> str:
        v = clean_value(value)
        v = re.sub(r"^(yndor|vendor|name|ame|ili)\b[:.\-|\"'*;\s]*", "", v, flags=re.I)
        v = clean_value(v)
        if re.search(r"\b(current|status|information|received|scheduled|survey)\b", v, re.I) and not re.search(
            r"\b(pvt|ltd|limited|solutions|solar|brothers|india|ecozen)\b", v, re.I
        ):
            v = ""
        if (
            not v
            or v.lower() in {"selection", "date", "name", "ame"}
            or v.lower().startswith("selection")
        ):
            for line in lines:
                if re.search(r"\b(pvt|ltd|limited|solutions|solar|brothers|india|ecozen)\b", line, re.I):
                    cand = re.sub(r"^(yndor|vendor|name|ame|ili)\b[:.\-|\"'*;\s]*", "", line, flags=re.I)
                    cand = clean_value(cand)
                    if cand and "selection" not in cand.lower():
                        return cand.upper()
            return ""
        return v.upper()

    def _normalize_pump(self, value: str) -> str:
        v = clean_value(value)
        m = re.search(r"(\d+\s*H\.?P\.?)", v, re.I)
        if m:
            return re.sub(r"[.\s]", "", m.group(1).upper())
        if not re.search(r"\d", v):
            return ""
        return v


    def _normalize_status(self, value: str) -> str:
        v = clean_value(value)
        v = re.sub(r"^(current\s*)?status\b[:.\-\s]*", "", v, flags=re.I)
        v = v.replace('"', " ").replace("'", " ")
        v = re.sub(r"^current\b[:.\-\s]*", "", v, flags=re.I)
        return clean_value(v).upper()

    def _normalize_category(self, value: str) -> str:
        v = clean_value(value)
        v = re.sub(r"^(beneficiary\s*)?category\b[:.\-\s]*", "", v, flags=re.I)
        v = clean_value(v)
        if v.lower() in {"pump", "capacity", "hp"}:
            return ""
        return v.upper()


def extract_fields_from_text(text: str) -> Dict[str, str]:
    return FieldExtractor().extract(text)
