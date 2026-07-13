#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RESULTS=${1:-"$ROOT/results/latest"}
mkdir -p "$RESULTS"
RESULTS=$(CDPATH= cd -- "$RESULTS" && pwd)

if ! docker info >/dev/null 2>&1; then
    echo "Docker-compatible daemon is unavailable; container run not executed." >&2
    exit 2
fi

"$ROOT/scripts/fetch_sources.sh"

for candidate in pysmi libsmi net-snmp; do
    tag="mibvendor/parser-bakeoff:$candidate"
    docker build \
        --file "$ROOT/containers/Dockerfile.$candidate" \
        --tag "$tag" \
        "$ROOT"
    docker run --rm \
        --network none \
        --read-only \
        --tmpfs /tmp:rw,size=256m \
        --mount "type=bind,src=$RESULTS,dst=/results" \
        "$tag"
    size=$(docker image inspect --format '{{.Size}}' "$tag")
    python3 "$ROOT/scripts/set_container_size.py" "$RESULTS/$candidate.json" "$size"
done

python3 "$ROOT/scripts/run_bakeoff.py" --aggregate-only --results-dir "$RESULTS"
