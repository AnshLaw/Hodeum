#!/bin/bash
# Packages the unsigned build into two IPAs for Sideloadly (free Apple ID):
#   Hodeum-sck.ipa   carries the ScreenCaptureKit entitlement (iOS 27 in-app capture)
#   Hodeum-basic.ipa has no special entitlement, in case free signing rejects it (ReplayKit still works)
# Both are ad-hoc signed only so the re-signer can read the entitlements; Sideloadly signs them for real.
set -euo pipefail

APP="$1"
DIST="$(pwd)/dist"
NAME="$(basename "$APP")"
mkdir -p "$DIST"

package() {
  local ipa="$1" entitlements="$2" work
  work="$(mktemp -d)"
  mkdir "$work/Payload"
  cp -R "$APP" "$work/Payload/"
  local app="$work/Payload/$NAME"
  for appex in "$app"/PlugIns/*.appex; do
    codesign --force --sign - "$appex"
  done
  if [ -n "$entitlements" ]; then
    codesign --force --sign - --entitlements "$entitlements" "$app"
  else
    codesign --force --sign - "$app"
  fi
  (cd "$work" && zip -qry "$DIST/$ipa" Payload)
  echo "Packaged $ipa"
}

package Hodeum-sck.ipa Hodeum/Hodeum-sck.entitlements
package Hodeum-basic.ipa ""
