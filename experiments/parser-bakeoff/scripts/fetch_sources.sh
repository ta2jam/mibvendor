#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEST="$ROOT/.tools/src"
mkdir -p "$DEST"

sha256_file() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

fetch() {
    name=$1
    url=$2
    expected=$3
    destination="$DEST/$name"
    if [ ! -f "$destination" ]; then
        curl -fL --retry 3 --output "$destination" "$url"
    fi
    actual=$(sha256_file "$destination")
    if [ "$actual" != "$expected" ]; then
        echo "checksum mismatch for $name: expected $expected, got $actual" >&2
        exit 1
    fi
}

fetch \
    libsmi-0.5.0.tar.gz \
    https://www.ibr.cs.tu-bs.de/projects/libsmi/download/libsmi-0.5.0.tar.gz \
    f21accdadb1bb328ea3f8a13fc34d715baac6e2db66065898346322c725754d3

fetch \
    net-snmp-5.9.4.tar.gz \
    https://downloads.sourceforge.net/project/net-snmp/net-snmp/5.9.4/net-snmp-5.9.4.tar.gz \
    8b4de01391e74e3c7014beb43961a2d6d6fa03acc34280b9585f4930745b0544
