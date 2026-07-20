#!/bin/sh
set -eu

ORIGIN=${ORIGIN:-https://mibvendor.io}
EXPECTED_VERSION=${EXPECTED_VERSION:-}
EXPECTED_COMMIT=${EXPECTED_COMMIT:-}
EXPECTED_DATA_RELEASE=${EXPECTED_DATA_RELEASE:-}
EXPECTED_IDENTITY_RELEASE=${EXPECTED_IDENTITY_RELEASE:-}
CURL=${CURL:-curl}

fail() {
    printf 'production verification failed: %s\n' "$1" >&2
    exit 1
}

request() {
    "$CURL" --fail --silent --show-error --location \
        --retry 2 --retry-delay 1 --connect-timeout 5 --max-time 20 "$@"
}

status_and_location() {
    "$CURL" --silent --show-error --output /dev/null \
        --connect-timeout 5 --max-time 20 \
        --write-out '%{http_code} %{redirect_url}' "$1"
}

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

index_headers="$tmp_dir/index.headers"
index_body="$tmp_dir/index.html"
request --dump-header "$index_headers" --output "$index_body" "$ORIGIN/"
grep -q '<title>mibvendor' "$index_body" || fail "public HTML marker is missing"
grep -Eiq '^cache-control:[[:space:]]*public,[[:space:]]*max-age=0,[[:space:]]*must-revalidate,[[:space:]]*no-transform[[:space:]]*$' "$index_headers" \
    || fail "public HTML is transformable at the edge"

for header in \
    'strict-transport-security:.*max-age=31536000' \
    'x-content-type-options:.*nosniff' \
    'x-frame-options:.*DENY' \
    'referrer-policy:.*strict-origin-when-cross-origin' \
    'permissions-policy:' \
    'content-security-policy:'
do
    grep -Eiq "^${header}" "$index_headers" || fail "security header missing: $header"
done

health=$(request "$ORIGIN/healthz")
[ "$health" = "ok" ] || fail "/healthz did not return ok"

api_headers="$tmp_dir/api.headers"
data_release_json=$(request --dump-header "$api_headers" "$ORIGIN/v1/data-release")
grep -Eiq '^access-control-allow-origin:[[:space:]]*\*' "$api_headers" || fail "API CORS header is missing"
grep -Eiq '^ratelimit-limit:[[:space:]]*120' "$api_headers" || fail "API 120-unit rate-limit header is missing"

version_json=$(request "$ORIGIN/version")
VERSION_JSON=$version_json EXPECTED_VERSION=$EXPECTED_VERSION \
EXPECTED_COMMIT=$EXPECTED_COMMIT EXPECTED_DATA_RELEASE=$EXPECTED_DATA_RELEASE \
EXPECTED_IDENTITY_RELEASE=$EXPECTED_IDENTITY_RELEASE \
python3 - <<'PY'
import json
import os
import sys

try:
    document = json.loads(os.environ["VERSION_JSON"])
except (KeyError, json.JSONDecodeError) as exc:
    raise SystemExit(f"invalid /version response: {exc}")

if document.get("schema_version") != 1:
    raise SystemExit("unexpected /version schema")
for key, env_name in (
    ("version", "EXPECTED_VERSION"),
    ("commit", "EXPECTED_COMMIT"),
    ("data_release", "EXPECTED_DATA_RELEASE"),
    ("identity_release", "EXPECTED_IDENTITY_RELEASE"),
):
    expected = os.environ.get(env_name, "")
    if expected and document.get(key) != expected:
        raise SystemExit(f"{key}={document.get(key)!r}, expected {expected!r}")
print(f"release={document.get('version')} commit={document.get('commit')} data={document.get('data_release')}")
PY

DATA_RELEASE_JSON=$data_release_json EXPECTED_DATA_RELEASE=$EXPECTED_DATA_RELEASE \
EXPECTED_IDENTITY_RELEASE=$EXPECTED_IDENTITY_RELEASE python3 - <<'PY'
import json
import os
import re

document = json.loads(os.environ["DATA_RELEASE_JSON"])
if document.get("status") != "public-alpha":
    raise SystemExit("API is not reporting public-alpha status")
if document.get("object_count", 0) < 76606:
    raise SystemExit("unexpectedly small public object count")
if document.get("module_count") != 702 or document.get("redistributable_module_count") != 702:
    raise SystemExit("license-signaled module inventory mismatch")
if document.get("directory_only_source_count") != 20:
    raise SystemExit("directory-only source inventory mismatch")
statistics = document.get("statistics", {})
if statistics.get("definitions", {}).get("textual_conventions", {}).get("active_module_definitions") != 4138:
    raise SystemExit("textual-convention inventory mismatch")
if statistics.get("definitions", {}).get("notifications", {}).get("catalog_oid_nodes") != 1273:
    raise SystemExit("notification inventory mismatch")
if statistics.get("sources", {}).get("total") != 32:
    raise SystemExit("source inventory mismatch")
identity = document.get("identity_statistics", {})
publication = document.get("identity_publication", {})
identity_release = document.get("identity_release")
release_sha = publication.get("identity_release_sha256")
control_sha = publication.get("control_sha256")
control_revision = publication.get("control_revision")
disabled_sources = publication.get("disabled_sources")
if publication.get("identity_release") != identity_release:
    raise SystemExit("identity publication release mismatch")
if not isinstance(release_sha, str) or re.fullmatch(r"[0-9a-f]{64}", release_sha) is None:
    raise SystemExit("identity release digest is invalid")
if not isinstance(control_sha, str) or re.fullmatch(r"[0-9a-f]{64}", control_sha) is None:
    raise SystemExit("identity publication-control digest is invalid")
if not isinstance(control_revision, int) or isinstance(control_revision, bool) or control_revision < 1:
    raise SystemExit("identity publication-control revision is invalid")
if not isinstance(disabled_sources, list) or disabled_sources != sorted(set(disabled_sources)):
    raise SystemExit("disabled identity sources are not a sorted unique list")
expected_view = f"{identity_release}.{release_sha[:12]}.c{control_revision}.{control_sha[:12]}"
if publication.get("identity_view") != expected_view:
    raise SystemExit("identity publication view is not digest/revision bound")

count_fields = (
    "sys_object_id_mappings", "claims", "exact_models", "product_families",
    "vendor_identifiers", "platforms", "vendor_families",
    "project_observation_oids", "project_definition_oids",
    "project_identity_oid_coverage", "project_platform_prefixes",
    "project_prefix_platforms", "project_prefix_enterprises",
    "conflicting_observation_oids",
    "reviewed_organization_keys", "disabled_sources",
)
if any(not isinstance(identity.get(field), int) or isinstance(identity.get(field), bool) or identity[field] < 0 for field in count_fields):
    raise SystemExit("identity statistics contain an invalid count")
if identity.get("identity_release") != identity_release or identity.get("identity_release_sha256") != release_sha:
    raise SystemExit("identity statistics release identity mismatch")
if identity.get("identity_view") != expected_view or identity.get("publication_control_revision") != control_revision:
    raise SystemExit("identity statistics publication view mismatch")
if identity.get("publication_control_sha256") != control_sha:
    raise SystemExit("identity statistics publication-control digest mismatch")
if identity["claims"] != sum(identity[field] for field in ("exact_models", "product_families", "vendor_identifiers", "platforms")):
    raise SystemExit("identity claim-strength counts do not sum to the claim total")
if identity["sys_object_id_mappings"] > identity["claims"]:
    raise SystemExit("identity mapping count exceeds claim count")
if identity["project_definition_oids"] > identity["exact_models"]:
    raise SystemExit("project definition count exceeds exact-model claims")
if not max(identity["project_observation_oids"], identity["project_definition_oids"]) <= identity["project_identity_oid_coverage"] <= identity["project_observation_oids"] + identity["project_definition_oids"]:
    raise SystemExit("project identity OID coverage violates union bounds")
if identity["disabled_sources"] != len(disabled_sources):
    raise SystemExit("disabled-source count does not match publication controls")
expected_prefix_counts = (0, 0, 0) if "librenms-os-detection" in disabled_sources else (655, 406, 266)
actual_prefix_counts = tuple(identity[field] for field in (
    "project_platform_prefixes", "project_prefix_platforms", "project_prefix_enterprises"
))
if actual_prefix_counts != expected_prefix_counts:
    raise SystemExit(f"project platform-prefix inventory mismatch: {actual_prefix_counts!r}, expected {expected_prefix_counts!r}")
identity_sources = document.get("identity_sources")
if not isinstance(identity_sources, list) or not identity_sources:
    raise SystemExit("identity source inventory is missing")
source_ids = [source.get("source_id") for source in identity_sources]
if any(not isinstance(source_id, str) or not source_id for source_id in source_ids) or len(source_ids) != len(set(source_ids)):
    raise SystemExit("identity source ids are invalid or duplicated")
if any(not isinstance(source.get("enabled"), bool) for source in identity_sources):
    raise SystemExit("identity source enabled state is invalid")
effective_disabled = sorted(source.get("source_id") for source in identity_sources if source.get("enabled") is False)
if effective_disabled != disabled_sources:
    raise SystemExit("effective identity source state does not match publication controls")
if statistics.get("identity", {}).get("sys_object_id_mappings") != identity["sys_object_id_mappings"]:
    raise SystemExit("public and identity mapping statistics disagree")
if document.get("production_data") is not True:
    raise SystemExit("active rights-cleared data is not marked production")
if document.get("enterprise_count", 0) < 60000:
    raise SystemExit("IANA PEN snapshot is unexpectedly small")
expected = os.environ.get("EXPECTED_DATA_RELEASE", "")
if expected and document.get("data_release") != expected:
    raise SystemExit("API data release mismatch")
expected_identity = os.environ.get("EXPECTED_IDENTITY_RELEASE", "")
if expected_identity and document.get("identity_release") != expected_identity:
    raise SystemExit("API identity release mismatch")
PY

identity_release_for_request=$(DATA_RELEASE_JSON=$data_release_json \
    EXPECTED_IDENTITY_RELEASE=$EXPECTED_IDENTITY_RELEASE python3 - <<'PY'
import json
import os

document = json.loads(os.environ["DATA_RELEASE_JSON"])
release = os.environ.get("EXPECTED_IDENTITY_RELEASE") or document.get("identity_release")
if not isinstance(release, str):
    raise SystemExit("identity release is unavailable for the assessment probe")
print(release)
PY
)
identity_payload=$(printf '{"identity_release":"%s","signals":{"sys_object_id":"1.3.6.1.4.1.9.1.2494","ent_physical_model_name":"C9300-48P"}}' "$identity_release_for_request")
identity_conflict_payload=$(printf '{"identity_release":"%s","signals":{"sys_object_id":"1.3.6.1.4.1.9.1.2435","ent_physical_model_name":"C9300-24P"}}' "$identity_release_for_request")

enterprise_json=$(request "$ORIGIN/v1/enterprises/8072")
sys_exact_json=$(request "$ORIGIN/v1/sys-object-ids/1.3.6.1.4.1.8072.3.2.10")
sys_sigscale_json=$(request "$ORIGIN/v1/sys-object-ids/1.3.6.1.4.1.50386.1.1")
sys_boundary_json=$(request "$ORIGIN/v1/sys-object-ids/1.3.6.1.4.1.2.999999")
sys_c930024t_json=$(request "$ORIGIN/v1/sys-object-ids/1.3.6.1.4.1.9.1.2435")
sys_c930024p_json=$(request "$ORIGIN/v1/sys-object-ids/1.3.6.1.4.1.9.1.2436")
sys_c9300_family_json=$(request "$ORIGIN/v1/sys-object-ids/1.3.6.1.4.1.9.1.2494")
sys_cisco_identifier_json=$(request "$ORIGIN/v1/sys-object-ids/1.3.6.1.4.1.9.1.6")
sys_cisco_unknown_json=$(request "$ORIGIN/v1/sys-object-ids/1.3.6.1.4.1.9.999999")
sys_arista_prefix_json=$(request "$ORIGIN/v1/sys-object-ids/1.3.6.1.4.1.30065.1.99")
sys_racktables_sg300_json=$(request "$ORIGIN/v1/sys-object-ids/1.3.6.1.4.1.9.6.1.83.10.1")
sys_racktables_conflict_json=$(request "$ORIGIN/v1/sys-object-ids/1.3.6.1.4.1.9.1.615")
identity_headers="$tmp_dir/identity.headers"
identity_json=$(request --dump-header "$identity_headers" --request POST --header 'content-type: application/json' \
    --data "$identity_payload" \
    "$ORIGIN/v1/device-identities:assess")
grep -Eiq '^cache-control:[[:space:]]*no-store' "$identity_headers" || fail "identity assessment is cacheable"
grep -Eiq '^etag:' "$identity_headers" && fail "identity assessment exposes an ETag"
identity_conflict_json=$(request --request POST --header 'content-type: application/json' \
    --data "$identity_conflict_payload" \
    "$ORIGIN/v1/device-identities:assess")
object_json=$(request "$ORIGIN/v1/objects/if-mib--ifoperstatus")
dependencies_json=$(request "$ORIGIN/v1/modules/IF-MIB/dependencies")
module_json=$(request "$ORIGIN/v1/modules/BFD-STD-MIB")
source_json=$(request "$ORIGIN/v1/sources/cisco")
raw_headers="$tmp_dir/raw.headers"
raw_archive="$tmp_dir/BFD-STD-MIB.tar"
raw_dir="$tmp_dir/raw"
mkdir "$raw_dir"
request --dump-header "$raw_headers" --output "$raw_archive" "$ORIGIN/v1/modules/BFD-STD-MIB/raw"
grep -Eiq '^content-type:[[:space:]]*application/x-tar' "$raw_headers" || fail "raw MIB archive content type is wrong"
grep -Eiq '^cache-control:[[:space:]]*no-cache' "$raw_headers" || fail "raw MIB archive can bypass publication-control revalidation"
grep -Eiq '^x-content-sha256:[[:space:]]*[0-9a-f]{64}' "$raw_headers" || fail "raw MIB checksum header is missing"
grep -Eiq '^x-mib-sha256:[[:space:]]*[0-9a-f]{64}' "$raw_headers" || fail "exact MIB checksum header is missing"
grep -Eiq '^link:.*rel="license".*rel="original"' "$raw_headers" || fail "raw MIB license/source links are missing"
tar -tf "$raw_archive" > "$tmp_dir/raw.entries"
printf '%s\n' BFD-STD-MIB.mib LICENSE.txt PROVENANCE.json > "$tmp_dir/raw.expected-entries"
cmp -s "$tmp_dir/raw.expected-entries" "$tmp_dir/raw.entries" || fail "raw MIB archive entries are wrong"
tar -xf "$raw_archive" -C "$raw_dir"
grep -q 'BFD-STD-MIB DEFINITIONS ::= BEGIN' "$raw_dir/BFD-STD-MIB.mib" || fail "raw MIB body is wrong"
[ -s "$raw_dir/LICENSE.txt" ] || fail "raw MIB license is empty"
RAW_HEADERS=$raw_headers RAW_ARCHIVE=$raw_archive RAW_DIR=$raw_dir python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

headers = {}
for line in Path(os.environ["RAW_HEADERS"]).read_text(encoding="utf-8").splitlines():
    if ":" in line:
        name, value = line.split(":", 1)
        headers[name.lower()] = value.strip()

archive = Path(os.environ["RAW_ARCHIVE"]).read_bytes()
raw_dir = Path(os.environ["RAW_DIR"])
mib = (raw_dir / "BFD-STD-MIB.mib").read_bytes()
license_bytes = (raw_dir / "LICENSE.txt").read_bytes()
provenance = json.loads((raw_dir / "PROVENANCE.json").read_text(encoding="utf-8"))

archive_sha = hashlib.sha256(archive).hexdigest()
mib_sha = hashlib.sha256(mib).hexdigest()
license_sha = hashlib.sha256(license_bytes).hexdigest()
assert headers.get("x-content-sha256") == archive_sha
assert headers.get("x-mib-sha256") == mib_sha
assert provenance["schema_version"] == 1
assert provenance["module"]["id"] == "BFD-STD-MIB"
assert provenance["files"]["BFD-STD-MIB.mib"]["sha256"] == mib_sha
assert provenance["files"]["LICENSE.txt"]["sha256"] == license_sha
PY
batch_json=$(request --request POST --header 'content-type: application/json' \
    --data '{"oids":["1.3.6.1.2.1.2.2.1.8.7","bad"]}' "$ORIGIN/v1/resolve:batch")
openapi_json=$(request "$ORIGIN/openapi.json")

ENTERPRISE_JSON=$enterprise_json SYS_EXACT_JSON=$sys_exact_json SYS_SIGSCALE_JSON=$sys_sigscale_json \
SYS_BOUNDARY_JSON=$sys_boundary_json SYS_C930024T_JSON=$sys_c930024t_json SYS_C930024P_JSON=$sys_c930024p_json \
SYS_C9300_FAMILY_JSON=$sys_c9300_family_json SYS_CISCO_IDENTIFIER_JSON=$sys_cisco_identifier_json \
SYS_CISCO_UNKNOWN_JSON=$sys_cisco_unknown_json SYS_ARISTA_PREFIX_JSON=$sys_arista_prefix_json \
SYS_RACKTABLES_SG300_JSON=$sys_racktables_sg300_json \
SYS_RACKTABLES_CONFLICT_JSON=$sys_racktables_conflict_json DATA_RELEASE_JSON=$data_release_json \
IDENTITY_JSON=$identity_json IDENTITY_CONFLICT_JSON=$identity_conflict_json OBJECT_JSON=$object_json \
DEPENDENCIES_JSON=$dependencies_json MODULE_JSON=$module_json SOURCE_JSON=$source_json \
BATCH_JSON=$batch_json OPENAPI_JSON=$openapi_json \
python3 - <<'PY'
import json
import os
import re

release_document = json.loads(os.environ["DATA_RELEASE_JSON"])
publication = release_document["identity_publication"]
disabled_sources = set(publication["disabled_sources"])

def identity_result(name):
    document = json.loads(os.environ[name])
    assert document["identity_release"] == publication["identity_release"]
    assert document["identity_publication"] == publication
    result = document["result"]
    assert result["identity_release"] == publication["identity_release"]
    assert result["identity_release_sha256"] == publication["identity_release_sha256"]
    assert result["identity_view"] == publication["identity_view"]
    assert result["publication_control"] == publication
    return result

enterprise = json.loads(os.environ["ENTERPRISE_JSON"])["enterprise"]
assert enterprise["number"] == 8072 and enterprise["organization"] == "net-snmp"
assert "email" not in enterprise and "contact" not in enterprise

exact = identity_result("SYS_EXACT_JSON")
if "net-snmp" not in disabled_sources:
    assert exact["status"] == "resolved" and exact["match"]["platform"] == "Linux"
    assert exact["match"]["model"] is None
else:
    assert exact["status"] == "enterprise_only" and exact["match"] is None

sigscale = identity_result("SYS_SIGSCALE_JSON")
if "sigscale-mibs" not in disabled_sources:
    assert sigscale["status"] == "resolved"
    assert sigscale["match"]["product_family"] == "SigScale OCS"
    assert sigscale["match"]["claim_strength"] == "platform"
    assert sigscale["match"]["model"] is None
else:
    assert sigscale["status"] == "enterprise_only" and sigscale["match"] is None

boundary = identity_result("SYS_BOUNDARY_JSON")
assert boundary["status"] == "enterprise_only" and boundary["match"] is None

c930024t = identity_result("SYS_C930024T_JSON")
c930024p = identity_result("SYS_C930024P_JSON")
c9300_family = identity_result("SYS_C9300_FAMILY_JSON")
cisco_identifier = identity_result("SYS_CISCO_IDENTIFIER_JSON")
cisco_unknown = identity_result("SYS_CISCO_UNKNOWN_JSON")
arista_prefix = identity_result("SYS_ARISTA_PREFIX_JSON")
racktables_sg300 = identity_result("SYS_RACKTABLES_SG300_JSON")
racktables_conflict = identity_result("SYS_RACKTABLES_CONFLICT_JSON")
assert cisco_unknown["status"] == "enterprise_only" and cisco_unknown["identity_status"] == "vendor_only"
assert cisco_unknown["enterprise_number"] == 9 and cisco_unknown["organization_key"] == "Q173395"

if "librenms-os-detection" not in disabled_sources:
    assert arista_prefix["status"] == "resolved" and arista_prefix["identity_status"] == "platform"
    assert arista_prefix["enterprise_number"] == 30065
    arista_match = arista_prefix["match"]
    assert arista_match["oid"] == "1.3.6.1.4.1.30065.1"
    assert arista_match["match_type"] == "prefix"
    assert arista_match["claim_scope"] == "open-source-project-platform-prefix"
    assert arista_match["platform"] == "arista_eos"
    assert arista_match["model"] is None and arista_match["product_family"] is None
    assert arista_match["mib_identifier"] is None
    arista_provenance = arista_match["provenance"]
    assert arista_provenance["source_id"] == "librenms-os-detection"
    assert re.fullmatch(r"[0-9a-f]{40}", arista_provenance["source_revision"])
    assert arista_provenance["source_date"] == "2026-07-18"
    assert arista_provenance["publication_mode"] == "definition-only"
    assert arista_provenance["raw_download"] is False
    arista_candidates = arista_prefix["assessment"]["candidates"]
    assert arista_candidates[0]["match_type"] == "prefix"
    assert arista_candidates[0]["evidence"][0]["matched_oid"] == "1.3.6.1.4.1.30065.1"
else:
    assert arista_prefix["status"] == "enterprise_only" and arista_prefix["match"] is None

if "racktables-known-switches" not in disabled_sources:
    assert racktables_sg300["status"] == "resolved" and racktables_sg300["identity_status"] == "exact_model"
    assert racktables_sg300["enterprise_number"] == 9 and racktables_sg300["organization_key"] == "Q173395"
    racktables_match = racktables_sg300["match"]
    assert racktables_match["model"] == "SG 300-10"
    assert racktables_match["organization"] == "ciscoSystems"
    assert racktables_match["organization_name"] == "ciscoSystems"
    assert racktables_match["organization_key"] == "Q173395"
    assert racktables_match["claim_scope"] == "open-source-project-device-definition"
    assert racktables_match["confidence"] == "medium"
    assert racktables_match["source_assignment_confidence"] == "high"
    assert racktables_match["firmware_scope"] == "not_established"
    provenance = racktables_match["provenance"]
    assert provenance["source_id"] == "racktables-known-switches"
    assert provenance["repository_license_signal"] == "GPL-2.0-only"
    assert provenance["artifact_rights"] == "GPL-2.0-only source; mibvendor-normalized definition"
    assert provenance["publication_mode"] == "definition-only" and provenance["raw_download"] is False
    assert "source_text" not in json.dumps(racktables_sg300)

    assert racktables_conflict["status"] == "ambiguous"
    assert racktables_conflict["identity_status"] == "conflicting_evidence"
    assert racktables_conflict["enterprise_number"] == 9 and racktables_conflict["organization_key"] == "Q173395"
    assert racktables_conflict["match"] is None
    assert any(item.get("type") == "model_mismatch" for item in racktables_conflict["assessment"]["conflicts"])
else:
    assert racktables_sg300["status"] == "enterprise_only" and racktables_sg300["identity_status"] == "vendor_only"
    assert racktables_sg300["enterprise_number"] == 9 and racktables_sg300["organization_key"] == "Q173395"
    assert racktables_sg300["match"] is None
    assert racktables_conflict["status"] == "resolved"
    assert racktables_conflict["identity_status"] == "vendor_identifier"
    assert racktables_conflict["enterprise_number"] == 9 and racktables_conflict["organization_key"] == "Q173395"
    assert racktables_conflict["match"]["model"] is None
    assert racktables_conflict["match"]["provenance"]["source_id"] != "racktables-known-switches"

identity_document = json.loads(os.environ["IDENTITY_JSON"])
conflict_document = json.loads(os.environ["IDENTITY_CONFLICT_JSON"])
for document in (identity_document, conflict_document):
    assert document["identity_release"] == publication["identity_release"]
    assert document["identity_publication"] == publication
    assessment_result = document["assessment"]
    assert assessment_result["identity_release"] == publication["identity_release"]
    assert assessment_result["identity_release_sha256"] == publication["identity_release_sha256"]
    assert assessment_result["identity_view"] == publication["identity_view"]
    assert assessment_result["publication_control"] == publication

if "cisco-products" not in disabled_sources:
    assert c930024t["status"] == "resolved" and c930024t["identity_status"] == "exact_model"
    assert c930024t["enterprise_number"] == 9 and c930024t["organization_key"] == "Q173395"
    assert c930024t["match"]["model"] == "C9300-24T" and c930024t["match"]["product_family"] == "Catalyst 9300"
    assert c930024p["match"]["model"] == "C9300-24P" and c930024p["match"]["model"] != c930024t["match"]["model"]
    assert c9300_family["identity_status"] == "product_family" and c9300_family["match"]["model"] is None
    assert c9300_family["match"]["product_family"] == "Catalyst 9300"
    assert cisco_identifier["identity_status"] == "vendor_identifier"
    assert cisco_identifier["match"]["match_type"] == "exact"
    assert cisco_identifier["match"]["mib_identifier"] == "cisco3000"
    assert cisco_identifier["match"]["model"] is None and cisco_identifier["match"]["product_family"] is None
    assert cisco_identifier["assessment"]["candidates"][0]["match_type"] == "exact"

    assessment = identity_document["assessment"]
    assert assessment["identity_status"] == "exact_model" and assessment["model"] == "C9300-48P"
    assert assessment["enterprise_number"] == 9 and assessment["organization_key"] == "Q173395"
    has_c9300_corroboration = any(item.get("type") == "project-fixture-corroboration" and item.get("corroborates_reported_model") is True for item in assessment["evidence"])
    assert has_c9300_corroboration is ("librenms-project-tests" not in disabled_sources)

    conflict = conflict_document["assessment"]
    assert conflict["status"] == "ambiguous" and conflict["identity_status"] == "conflicting_evidence"
    assert conflict["model"] is None and conflict["organization_key"] is None
else:
    for result in (c930024t, c930024p, c9300_family, cisco_identifier):
        assert result["status"] == "enterprise_only" and result["match"] is None
    for assessment in (identity_document["assessment"], conflict_document["assessment"]):
        assert assessment["status"] == "vendor_only" and assessment["identity_status"] == "vendor_only"
        assert assessment["enterprise_number"] == 9
        assert assessment["model"] is None and assessment["product_family"] is None

obj = json.loads(os.environ["OBJECT_JSON"])["object"]
assert obj["syntax"]["enums"]["1"] == "up"
assert obj["access"] == "read-only" and obj["status"] == "current"
assert obj["description"]["status"] == "available"
assert obj["relationships"]["table"] == "ifTable"
assert obj["relationships"]["row"] == "ifEntry"
assert obj["relationships"]["indexes"] == ["ifIndex"]

deps = json.loads(os.environ["DEPENDENCIES_JSON"])
for key in ("direct", "transitive", "missing", "cyclic"):
    assert isinstance(deps[key], list)

module = json.loads(os.environ["MODULE_JSON"])["module"]
assert module["id"] == "BFD-STD-MIB" and module["raw_download"] is True
assert module["publication_mode"] == "redistributable"
assert len(module["artifact_sha256"]) == 64

source = json.loads(os.environ["SOURCE_JSON"])["source"]
assert source["id"] == "cisco" and source["publication_mode"] == "directory-only"
assert source["content_intake"] == "quarantine"
assert set(source["public_fields"]) == {"publisher", "official_source_url", "rights_state"}

batch = json.loads(os.environ["BATCH_JSON"])["results"]
assert batch[0]["instance_suffix"] == [7] and batch[1]["status"] == "invalid"

specification = json.loads(os.environ["OPENAPI_JSON"])
assert specification["x-mibvendor-status"] == "public-alpha"
assert "/v1/device-identities:assess" in specification["paths"]
PY

http_redirect=$(status_and_location "http://mibvendor.io/healthz")
case "$http_redirect" in
    301\ https://mibvendor.io/healthz|302\ https://mibvendor.io/healthz|307\ https://mibvendor.io/healthz|308\ https://mibvendor.io/healthz) ;;
    *) fail "HTTP redirect is wrong: $http_redirect" ;;
esac

www_redirect=$(status_and_location "https://www.mibvendor.io/healthz")
case "$www_redirect" in
    301\ https://mibvendor.io/healthz|302\ https://mibvendor.io/healthz|307\ https://mibvendor.io/healthz|308\ https://mibvendor.io/healthz) ;;
    *) fail "www redirect is wrong: $www_redirect" ;;
esac

for asset in styles.css app.js; do
    headers="$tmp_dir/$asset.headers"
    request --head --dump-header "$headers" --output /dev/null "$ORIGIN/$asset"
    case "$asset" in
        *.css) grep -Eiq '^content-type:[[:space:]]*text/css' "$headers" || fail "$asset has the wrong MIME type" ;;
        *.js) grep -Eiq '^content-type:[[:space:]]*(application|text)/javascript' "$headers" || fail "$asset has the wrong MIME type" ;;
    esac
done

pages_status=$("$CURL" --silent --show-error --output /dev/null \
    --connect-timeout 5 --max-time 20 --write-out '%{http_code}' \
    https://ta2jam.github.io/mibvendor/)
[ "$pages_status" = "404" ] || fail "retired GitHub Pages origin returned $pages_status, expected 404"

printf 'production verification passed for %s\n' "$ORIGIN"
