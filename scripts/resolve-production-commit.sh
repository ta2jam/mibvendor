#!/bin/sh
set -eu

VERSION_FILE=${VERSION_FILE:-VERSION}

fail() {
    printf 'production release resolution failed: %s\n' "$1" >&2
    exit 1
}

[ -f "$VERSION_FILE" ] || fail "$VERSION_FILE is missing"
version=$(tr -d '\r\n' < "$VERSION_FILE")
printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' \
    || fail "VERSION is not a supported semantic version"

tag="v$version"
commit=$(git rev-parse --verify "${tag}^{commit}" 2>/dev/null) \
    || fail "$tag does not resolve to a commit; fetch the immutable release tags"
git merge-base --is-ancestor "$commit" HEAD \
    || fail "$tag is not an ancestor of the checked-out main revision"

printf '%s\n' "$commit"
