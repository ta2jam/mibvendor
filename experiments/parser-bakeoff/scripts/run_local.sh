#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RESULTS=${1:-"$ROOT/results/latest"}

"$ROOT/scripts/bootstrap_local.sh"

export BAKEOFF_PYSMI="$ROOT/.tools/pysmi-venv/bin/mibdump"
export BAKEOFF_LIBSMI="$ROOT/.tools/libsmi-0.5.0/bin/smidump"
export BAKEOFF_SMILINT="$ROOT/.tools/libsmi-0.5.0/bin/smilint"
export BAKEOFF_NETSNMP="$ROOT/.tools/net-snmp-5.9.4/bin/snmptranslate"
export BAKEOFF_STANDARD_MIB_DIRS="$ROOT/.tools/libsmi-0.5.0/share/mibs/ietf:$ROOT/.tools/libsmi-0.5.0/share/mibs/iana"
export BAKEOFF_EXECUTION_MODE=local-source-build

exec python3 "$ROOT/scripts/run_bakeoff.py" --candidate all --results-dir "$RESULTS"
