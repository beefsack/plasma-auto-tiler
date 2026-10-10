#!/usr/bin/env bash
# Rewrites the pinned per-release version strings across the tentative 0.1
# packaging recipes so they all track one version together:
#   RPM spec (Version + Source0), OBS _service (download URL, and optionally
#   the verify_file checksum), Arch PKGBUILD (pkgver plus sha256sums, with
#   .SRCINFO source URL, pkgver, sha256sums, and the native-effect exact
#   core depends pin kept consistent; canonical regen is makepkg --printsrcinfo),
#   Debian changelog (top stanza). A version change without --sha256 resets
#   all checksums to their fail-closed placeholders (SKIP / REPLACE-...).
#   Recipes additionally fail closed at build time when the tarball VERSION
#   file disagrees, so a missed rewrite breaks loudly.
#
# Usage:
#   packaging/bump-version.sh --version <X.Y.Z> [--sha256 <64-hex>]
# With --version equal to the current version this is a no-op (except it
# still fills the checksum when --sha256 is given and differs).
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  printf 'usage: bump-version.sh --version <X.Y.Z> [--sha256 <64-hex>]\n' >&2
}

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

VERSION=""
SHA256=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      VERSION="$2"
      shift 2
      ;;
    --sha256)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      SHA256="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
done
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || die "version must look like X.Y.Z (got '$VERSION')"
if [[ -n "$SHA256" ]]; then
  [[ "$SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || die "sha256 must be 64 hex characters"
  SHA256="$(printf '%s' "$SHA256" | tr 'A-F' 'a-f')"
fi

SPEC="$REPO_ROOT/packaging/rpm/plasma-auto-tiler.spec"
SERVICE="$REPO_ROOT/packaging/obs/_service"
PKGBUILD="$REPO_ROOT/packaging/arch/PKGBUILD"
CHANGELOG="$REPO_ROOT/packaging/debian/changelog"
SRCINFO="$REPO_ROOT/packaging/arch/.SRCINFO"
for f in "$SPEC" "$SERVICE" "$PKGBUILD" "$SRCINFO" "$CHANGELOG"; do
  [[ -f "$f" && ! -L "$f" ]] || die "expected recipe file missing: $f"
done

CURRENT="$(grep -E '^Version: ' "$SPEC" | head -n 1 | awk '{print $2}')" \
  || die "could not read current spec version"
[[ "$CURRENT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "current spec version is malformed: $CURRENT"
TAB="$(printf '\t')" || die "could not format tab separator"

# The PKGBUILD must keep interpolating versioned coordinates instead of
# pinning them: source URL and the native-effect exact core dependency.
# The generated .SRCINFO carries the expanded pins and is rewritten below.
grep -Eq '^source=\("https://github\.com/beefsack/plasma-auto-tiler/releases/download/v\$pkgver/plasma-auto-tiler-\$pkgver\.tar\.gz"\)$' "$PKGBUILD" \
  || die "PKGBUILD source does not interpolate \$pkgver in $PKGBUILD"
grep -Eq '^[[:space:]]*depends=\("plasma-auto-tiler=\$pkgver-\$pkgrel" kwin\)$' "$PKGBUILD" \
  || die "PKGBUILD native depends does not interpolate \$pkgver-\$pkgrel in $PKGBUILD"

replace_version() {
  local file="$1" pattern="$2"
  local count
  count="$(grep -Ec "$pattern" "$file")" || die "pattern missing in $file: $pattern"
  [[ "$count" -ge 1 ]] || die "pattern missing in $file: $pattern"
}

if [[ "$CURRENT" != "$VERSION" ]]; then
  # RPM spec: Version line only; Source0 already interpolates %{version}.
  replace_version "$SPEC" "^Version:[[:space:]]+$CURRENT\$"
  sed -i -E "s/^Version:[[:space:]]+$CURRENT\$/Version: $VERSION/" "$SPEC"
  grep -Eq '^Source0:.*releases/download/v%\{version\}/plasma-auto-tiler-%\{version\}\.tar\.gz$' "$SPEC" \
    || die "Source0 does not interpolate %{version} in $SPEC"
  # OBS service: pinned download URL and the verify_file generated name.
  replace_version "$SERVICE" "releases/download/v$CURRENT/plasma-auto-tiler-$CURRENT\\.tar\\.gz"
  sed -i -E "s|releases/download/v$CURRENT/plasma-auto-tiler-$CURRENT\\.tar\\.gz|releases/download/v$VERSION/plasma-auto-tiler-$VERSION.tar.gz|" "$SERVICE"
  replace_version "$SERVICE" "_service:download_url:plasma-auto-tiler-$CURRENT\\.tar\\.gz"
  sed -i -E "s|_service:download_url:plasma-auto-tiler-$CURRENT\\.tar\\.gz|_service:download_url:plasma-auto-tiler-$VERSION.tar.gz|" "$SERVICE"
  # Without a fresh checksum the service must fail closed, never trust.
  sed -i -E 's|<param name="checksum">[0-9a-f]{64}</param>|<param name="checksum">REPLACE-WITH-RELEASE-SIDECAR-SHA256</param>|' "$SERVICE"
  # Arch: pkgver only; the source URL interpolates $pkgver.
  replace_version "$PKGBUILD" "^pkgver=$CURRENT\$"
  sed -i -E "s/^pkgver=$CURRENT\$/pkgver=$VERSION/" "$PKGBUILD"
  # Stale checksums must not survive a version bump: reset both the PKGBUILD
  # and the generated .SRCINFO to SKIP until --sha256 pins the new tarball.
  # (Canonical .SRCINFO regeneration is `makepkg --printsrcinfo`; the sed
  # below keeps the two files consistent for the sums lines only.)
  sed -i -E 's/^sha256sums=\([0-9a-f]{64}\)$/sha256sums=(SKIP)/' "$PKGBUILD"
  grep -Eq '^sha256sums=\(SKIP\)$' "$PKGBUILD" || die "PKGBUILD sha256sums reset failed"
  sed -i -E "s/^${TAB}sha256sums = ([0-9a-f]{64}|SKIP)\$/${TAB}sha256sums = SKIP/" "$SRCINFO"
  grep -Eq "^${TAB}sha256sums = SKIP\$" "$SRCINFO" || die ".SRCINFO sha256sums reset failed"
  replace_version "$SRCINFO" "^${TAB}pkgver = $CURRENT\$"
  sed -i -E "s/^${TAB}pkgver = $CURRENT\$/${TAB}pkgver = $VERSION/" "$SRCINFO"
  replace_version "$SRCINFO" "releases/download/v$CURRENT/plasma-auto-tiler-$CURRENT\\.tar\\.gz"
  sed -i -E "s|releases/download/v$CURRENT/plasma-auto-tiler-$CURRENT\\.tar\\.gz|releases/download/v$VERSION/plasma-auto-tiler-$VERSION.tar.gz|" "$SRCINFO"
  # Generated .SRCINFO pins the exact core version for the native-effect
  # split package (pkgrel suffix preserved; bump-version does not manage it).
  replace_version "$SRCINFO" "^${TAB}depends = plasma-auto-tiler=$CURRENT-[0-9][0-9]*\$"
  sed -i -E "s/^(${TAB}depends = plasma-auto-tiler=)$CURRENT-([0-9][0-9]*)\$/\1$VERSION-\2/" "$SRCINFO"
  # Debian: new top stanza (date stamped now), old stanza kept below.
  {
    printf 'plasma-auto-tiler (%s-1) unstable; urgency=medium\n\n' "$VERSION"
    printf '  * Release %s.\n\n' "$VERSION"
    printf ' -- Plasma Auto Tiler Contributors <noreply@example.com>  %s\n\n' "$(date -R)"
    cat "$CHANGELOG"
  } > "$CHANGELOG.new"
  mv -- "$CHANGELOG.new" "$CHANGELOG"
fi

if [[ -n "$SHA256" ]]; then
  python3 - "$SERVICE" "$SHA256" "$PKGBUILD" "$SRCINFO" <<'PYEOF'
import re, sys
service_path, digest, pkgbuild_path, srcinfo_path = sys.argv[1:5]
with open(service_path, encoding="utf-8") as f:
    text = f.read()
pattern = r'(<param name="checksum">)(?:[0-9a-f]{64}|REPLACE-WITH-RELEASE-SIDECAR-SHA256)(</param>)'
updated, count = re.subn(pattern, r"\g<1>" + digest + r"\g<2>", text, count=1)
if count != 1:
    sys.exit("checksum placeholder not found exactly once")
with open(service_path, "w", encoding="utf-8") as f:
    f.write(updated)
# Same tarball feeds the AUR recipe: pin both the PKGBUILD and the
# generated .SRCINFO sums lines (each must occur exactly once).
for path, pat, repl in (
    (pkgbuild_path, r"^sha256sums=\((?:[0-9a-f]{64}|SKIP)\)$",
     "sha256sums=(" + digest + ")"),
    (srcinfo_path, r"^\tsha256sums = (?:[0-9a-f]{64}|SKIP)$",
     "\tsha256sums = " + digest),
):
    with open(path, encoding="utf-8") as f:
        content = f.read()
    new_content, n = re.subn(pat, repl, content, count=1, flags=re.M)
    if n != 1:
        sys.exit("sha256sums line not found exactly once in " + path)
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_content)
PYEOF
fi

printf 'packaging version: %s -> %s\n' "$CURRENT" "$VERSION"

# Every run doubles as a consistency check: the generated native depends
# pin must track the (possibly just bumped) version. File-wise a
# same-version run stays a no-op when consistent.
grep -Eq "^${TAB}depends = plasma-auto-tiler=$VERSION-[0-9][0-9]*\$" "$SRCINFO" \
  || die ".SRCINFO native depends pin does not track $VERSION"
