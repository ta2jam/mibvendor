#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TOOLS="$ROOT/.tools"
BUILD="$TOOLS/build"
JOBS=${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)}

"$ROOT/scripts/fetch_sources.sh"
mkdir -p "$BUILD"

if [ ! -x "$TOOLS/libsmi-0.5.0/bin/smidump" ]; then
    rm -rf "$BUILD/libsmi-0.5.0"
    tar -xzf "$TOOLS/src/libsmi-0.5.0.tar.gz" -C "$BUILD"
    (
        cd "$BUILD/libsmi-0.5.0"
        CFLAGS="${CFLAGS:--O2 -Wno-error=implicit-function-declaration}" ./configure \
            --prefix="$TOOLS/libsmi-0.5.0" \
            --disable-shared \
            --enable-static \
            --disable-yang
        make -j"$JOBS"
        make install
    )
fi

if [ ! -x "$TOOLS/net-snmp-5.9.4/bin/snmptranslate" ]; then
    rm -rf "$BUILD/net-snmp-5.9.4"
    tar -xzf "$TOOLS/src/net-snmp-5.9.4.tar.gz" -C "$BUILD"
    (
        cd "$BUILD/net-snmp-5.9.4"
        ./configure \
            --prefix="$TOOLS/net-snmp-5.9.4" \
            --with-default-snmp-version=3 \
            --with-sys-contact=nobody@example.invalid \
            --with-sys-location=local \
            --with-logfile=/tmp/mibvendor-snmpd.log \
            --with-persistent-directory=/tmp/mibvendor-snmp \
            --disable-agent \
            --disable-manuals \
            --disable-scripts \
            --disable-embedded-perl \
            --without-openssl \
            --without-zlib
        make -j"$JOBS"
        make installbin installlibs
    )
fi

if [ ! -x "$TOOLS/pysmi-venv/bin/python" ]; then
    python3 -m venv "$TOOLS/pysmi-venv"
fi
"$TOOLS/pysmi-venv/bin/python" -m pip install \
    --disable-pip-version-check \
    --require-hashes \
    -r "$ROOT/requirements-pysmi.txt"

"$TOOLS/pysmi-venv/bin/mibdump" --version >/dev/null 2>&1
"$TOOLS/libsmi-0.5.0/bin/smidump" -V
"$TOOLS/net-snmp-5.9.4/bin/snmptranslate" -V
