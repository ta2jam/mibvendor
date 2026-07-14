#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RESULTS=${1:-"$ROOT/results/latest"}
mkdir -p "$RESULTS"
RESULTS=$(CDPATH= cd -- "$RESULTS" && pwd)
PRIVATE_CORPUS="$ROOT/corpus/private"
CANARY_NAME=".mibvendor-build-context-canary-$$"
CANARY="$PRIVATE_CORPUS/$CANARY_NAME"

cleanup() {
    rm -f "$CANARY"
    rmdir "$PRIVATE_CORPUS" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if ! docker info >/dev/null 2>&1; then
    echo "Docker-compatible daemon is unavailable; container run not executed." >&2
    exit 2
fi

"$ROOT/scripts/fetch_sources.sh"
mkdir -p "$PRIVATE_CORPUS"
printf 'must never enter a parser image layer\n' > "$CANARY"

for candidate in pysmi libsmi net-snmp; do
    tag="mibvendor/parser-bakeoff:$candidate"
    docker build \
        --file "$ROOT/containers/Dockerfile.$candidate" \
        --tag "$tag" \
        "$ROOT"
    docker run --rm \
        --entrypoint /bin/sh \
        "$tag" \
        -c "test ! -e /bench/corpus/private/$CANARY_NAME"
    docker run --rm \
        --user "$(id -u):$(id -g)" \
        --env USER=mibvendor-benchmark \
        --env LOGNAME=mibvendor-benchmark \
        --env HOME=/tmp \
        --network none \
        --read-only \
        --tmpfs /tmp:rw,size=256m \
        --mount "type=bind,src=$RESULTS,dst=/results" \
        "$tag"
    size=$(docker image inspect --format '{{.Size}}' "$tag")
    python3 "$ROOT/scripts/set_container_size.py" "$RESULTS/$candidate.json" "$size"
done

python3 "$ROOT/scripts/run_bakeoff.py" --aggregate-only --results-dir "$RESULTS"
