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
