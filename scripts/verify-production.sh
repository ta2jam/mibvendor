#!/bin/sh
set -eu

ORIGIN=${ORIGIN:-https://mibvendor.io}
EXPECTED_VERSION=${EXPECTED_VERSION:-}
EXPECTED_COMMIT=${EXPECTED_COMMIT:-}
EXPECTED_DATA_RELEASE=${EXPECTED_DATA_RELEASE:-}
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
grep -Eiq '^ratelimit-limit:[[:space:]]*120' "$api_headers" || fail "API rate-limit header is missing"

version_json=$(request "$ORIGIN/version")
VERSION_JSON=$version_json EXPECTED_VERSION=$EXPECTED_VERSION \
EXPECTED_COMMIT=$EXPECTED_COMMIT EXPECTED_DATA_RELEASE=$EXPECTED_DATA_RELEASE \
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
):
    expected = os.environ.get(env_name, "")
    if expected and document.get(key) != expected:
        raise SystemExit(f"{key}={document.get(key)!r}, expected {expected!r}")
print(f"release={document.get('version')} commit={document.get('commit')} data={document.get('data_release')}")
PY

DATA_RELEASE_JSON=$data_release_json EXPECTED_DATA_RELEASE=$EXPECTED_DATA_RELEASE python3 - <<'PY'
import json
import os

document = json.loads(os.environ["DATA_RELEASE_JSON"])
if document.get("status") != "public-alpha":
    raise SystemExit("API is not reporting public-alpha status")
if document.get("object_count", 0) < 5000:
    raise SystemExit("unexpectedly small public object count")
if document.get("module_count") != 110 or document.get("redistributable_module_count") != 110:
    raise SystemExit("rights-cleared module inventory mismatch")
if document.get("directory_only_source_count") != 20:
    raise SystemExit("directory-only source inventory mismatch")
if document.get("production_data") is not True:
    raise SystemExit("active rights-cleared data is not marked production")
if document.get("enterprise_count", 0) < 60000:
    raise SystemExit("IANA PEN snapshot is unexpectedly small")
expected = os.environ.get("EXPECTED_DATA_RELEASE", "")
if expected and document.get("data_release") != expected:
    raise SystemExit("API data release mismatch")
PY

enterprise_json=$(request "$ORIGIN/v1/enterprises/8072")
sys_exact_json=$(request "$ORIGIN/v1/sys-object-ids/1.3.6.1.4.1.8072.3.2.10")
sys_boundary_json=$(request "$ORIGIN/v1/sys-object-ids/1.3.6.1.4.1.2.999999")
sys_restricted_json=$(request "$ORIGIN/v1/sys-object-ids/1.3.6.1.4.1.9.999999")
object_json=$(request "$ORIGIN/v1/objects/if-mib--ifoperstatus")
dependencies_json=$(request "$ORIGIN/v1/modules/IF-MIB/dependencies")
module_json=$(request "$ORIGIN/v1/modules/BFD-STD-MIB")
source_json=$(request "$ORIGIN/v1/sources/cisco")
raw_headers="$tmp_dir/raw.headers"
raw_mib="$tmp_dir/BFD-STD-MIB.mib"
request --dump-header "$raw_headers" --output "$raw_mib" "$ORIGIN/v1/modules/BFD-STD-MIB/raw"
grep -Eiq '^x-content-sha256:[[:space:]]*[0-9a-f]{64}' "$raw_headers" || fail "raw MIB checksum header is missing"
grep -Eiq '^link:.*rel="license".*rel="original"' "$raw_headers" || fail "raw MIB license/source links are missing"
grep -q 'BFD-STD-MIB DEFINITIONS ::= BEGIN' "$raw_mib" || fail "raw MIB body is wrong"
batch_json=$(request --request POST --header 'content-type: application/json' \
    --data '{"oids":["1.3.6.1.2.1.2.2.1.8.7","bad"]}' "$ORIGIN/v1/resolve:batch")
openapi_json=$(request "$ORIGIN/openapi.json")

ENTERPRISE_JSON=$enterprise_json SYS_EXACT_JSON=$sys_exact_json \
SYS_BOUNDARY_JSON=$sys_boundary_json SYS_RESTRICTED_JSON=$sys_restricted_json OBJECT_JSON=$object_json \
DEPENDENCIES_JSON=$dependencies_json MODULE_JSON=$module_json SOURCE_JSON=$source_json \
BATCH_JSON=$batch_json OPENAPI_JSON=$openapi_json \
python3 - <<'PY'
import json
import os

enterprise = json.loads(os.environ["ENTERPRISE_JSON"])["enterprise"]
assert enterprise["number"] == 8072 and enterprise["organization"] == "net-snmp"
assert "email" not in enterprise and "contact" not in enterprise

exact = json.loads(os.environ["SYS_EXACT_JSON"])["result"]
assert exact["status"] == "resolved" and exact["match"]["platform"] == "Linux"
assert exact["match"]["model"] is None

boundary = json.loads(os.environ["SYS_BOUNDARY_JSON"])["result"]
assert boundary["status"] == "enterprise_only" and boundary["match"] is None

restricted = json.loads(os.environ["SYS_RESTRICTED_JSON"])["result"]
assert restricted["status"] == "unavailable_due_to_rights"
assert restricted["rights"]["api_output"] == "denied" and restricted["match"] is None

obj = json.loads(os.environ["OBJECT_JSON"])["object"]
assert obj["syntax"]["enums"]["1"] == "up"
assert obj["access"] == "read-only" and obj["status"] == "current"
assert obj["description"]["status"] == "available"

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
