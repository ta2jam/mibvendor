#!/bin/sh
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
REPOSITORY=$(CDPATH='' cd -- "$ROOT/../.." && pwd)
RESULTS=${1:-"$ROOT/results/public-latest"}
mkdir -p "$RESULTS"
RESULTS=$(CDPATH='' cd -- "$RESULTS" && pwd)
rm -f "$RESULTS/pysmi.json" "$RESULTS/libsmi.json" "$RESULTS/net-snmp.json" "$RESULTS/summary.json"
SAFE_CORPUS=$(mktemp -d "${TMPDIR:-/tmp}/mibvendor-public-corpus.XXXXXX")

cleanup() {
    rm -rf "$SAFE_CORPUS"
}
trap cleanup EXIT INT TERM

if ! docker info >/dev/null 2>&1; then
    echo "Docker-compatible daemon is unavailable; public container run not executed." >&2
    exit 2
fi

"$ROOT/scripts/fetch_sources.sh"
python3 "$ROOT/scripts/public_corpus_gate.py" >/dev/null
cp "$ROOT/corpus/manifest.json" "$SAFE_CORPUS/manifest.json"

SOURCE_COMMIT=${GITHUB_SHA:-$(git -C "$REPOSITORY" rev-parse --verify HEAD)}
case "$SOURCE_COMMIT" in
    ''|*[!0-9a-f]*) echo "Could not determine a full lowercase Git source commit." >&2; exit 2 ;;
esac
if [ "${#SOURCE_COMMIT}" -ne 40 ]; then
    echo "Could not determine a full lowercase Git source commit." >&2
    exit 2
fi

for candidate in pysmi libsmi net-snmp; do
    tag="mibvendor/parser-bakeoff:$candidate"
    docker build \
        --file "$ROOT/containers/Dockerfile.$candidate" \
        --tag "$tag" \
        "$ROOT"
    docker run --rm \
        --user "$(id -u):$(id -g)" \
        --env USER=mibvendor-benchmark \
        --env LOGNAME=mibvendor-benchmark \
        --env HOME=/tmp \
        --env BAKEOFF_SOURCE_COMMIT="$SOURCE_COMMIT" \
        --network none \
        --read-only \
        --cap-drop ALL \
        --security-opt no-new-privileges \
        --pids-limit 256 \
        --cpus 2 \
        --memory 1g \
        --memory-swap 1g \
        --tmpfs /tmp:rw,size=512m \
        --mount "type=bind,src=$REPOSITORY/data,dst=/workspace/data,readonly" \
        --mount "type=bind,src=$ROOT/scripts,dst=/workspace/experiments/parser-bakeoff/scripts,readonly" \
        --mount "type=bind,src=$ROOT/public-corpus,dst=/workspace/experiments/parser-bakeoff/public-corpus,readonly" \
        --mount "type=bind,src=$SAFE_CORPUS,dst=/workspace/experiments/parser-bakeoff/corpus,readonly" \
        --mount "type=bind,src=$RESULTS,dst=/results" \
        --entrypoint python \
        "$tag" \
        /workspace/experiments/parser-bakeoff/scripts/run_public_bakeoff.py \
        --candidate "$candidate" \
        --results-dir /results
    size=$(docker image inspect --format '{{.Size}}' "$tag")
    python3 "$ROOT/scripts/set_container_size.py" "$RESULTS/$candidate.json" "$size"
done

python3 "$ROOT/scripts/run_public_bakeoff.py" --aggregate-only --results-dir "$RESULTS"
