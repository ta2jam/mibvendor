#!/usr/bin/env python3
"""Validate the Phase 0 rights matrix using only the Python standard library."""

from __future__ import annotations

import csv
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from urllib.parse import urlparse


MATRIX = Path(__file__).with_name("rights-matrix.csv")
SCOPES = (
    "metadata_index",
    "rendered_text",
    "api_output",
    "raw_download",
    "bulk_export",
)
REQUIRED_COLUMNS = (
    "source_id",
    "source_vendor",
    "official_url",
    "access_method",
    "rights_url",
    "rights_evidence",
    *SCOPES,
    "proposed_public_tier",
    "permission_contact_action",
    "checked_date",
)
SCOPE_VALUES = {"approved", "denied", "unknown"}
TIERS = {"A", "B", "Q", "P"}


def fail(message: str) -> None:
    raise ValueError(message)


def validate_url(value: str, row_number: int, field: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        fail(f"row {row_number}: {field} must be an absolute HTTPS URL")


def main() -> int:
    with MATRIX.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != REQUIRED_COLUMNS:
            fail("CSV columns differ from the required schema")
        rows = list(reader)

    if len(rows) < 20:
        fail(f"expected at least 20 source families, found {len(rows)}")

    seen_ids: set[str] = set()
    for row_number, row in enumerate(rows, start=2):
        missing = [column for column in REQUIRED_COLUMNS if not row[column].strip()]
        if missing:
            fail(f"row {row_number}: empty required fields: {', '.join(missing)}")

        source_id = row["source_id"]
        if source_id in seen_ids:
            fail(f"row {row_number}: duplicate source_id {source_id!r}")
        seen_ids.add(source_id)

        validate_url(row["official_url"], row_number, "official_url")
        validate_url(row["rights_url"], row_number, "rights_url")

        for scope in SCOPES:
            if row[scope] not in SCOPE_VALUES:
                fail(f"row {row_number}: invalid {scope} value {row[scope]!r}")

        tier = row["proposed_public_tier"]
        if tier not in TIERS:
            fail(f"row {row_number}: invalid tier {tier!r}")
        if tier == "A" and any(row[scope] != "approved" for scope in SCOPES):
            fail(f"row {row_number}: Tier A requires all five scopes to be approved")
        if tier == "B":
            if row["metadata_index"] != "approved":
                fail(f"row {row_number}: Tier B requires approved metadata_index")
            if any(row[scope] == "approved" for scope in SCOPES[1:]):
                fail(f"row {row_number}: Tier B cannot approve public content scopes")

        checked = date.fromisoformat(row["checked_date"])
        if checked > date.today():
            fail(f"row {row_number}: checked_date cannot be in the future")

    tiers = Counter(row["proposed_public_tier"] for row in rows)
    scopes = {
        scope: Counter(row[scope] for row in rows)
        for scope in SCOPES
    }
    print(f"validated {len(rows)} source families from {MATRIX}")
    print("tiers:", ", ".join(f"{key}={tiers[key]}" for key in sorted(tiers)))
    for scope in SCOPES:
        counts = scopes[scope]
        print(
            f"{scope}: "
            + ", ".join(f"{key}={counts[key]}" for key in sorted(counts))
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as exc:
        print(f"rights matrix validation failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
