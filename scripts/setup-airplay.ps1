# Builds the UxPlay AirPlay receiver and links it at runtime\uxplay, where Hodeum looks for it.
# No admin rights: MSYS2 goes to %LOCALAPPDATA%\msys64, a folder only this Windows account can write.
# UxPlay is GPL and is never bundled with Hodeum; this script builds the learner's own copy.
# Re-running skips finished steps. Pass -Rebuild to rebuild UxPlay.
param([switch]$Rebuild)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$msys = Join-Path $env:LOCALAPPDATA "msys64"
$source = Join-Path $env:LOCALAPPDATA "uxplay-src"
# UxPlay >= 1.74 has its own mDNS, so no Bonjour SDK is needed. Pinned so an upstream change can't break the demo.
$uxplayCommit = "8ef677617c864756ae930a565edf0ae03e7da134"
$packages = "cmake gcc ninja pkgconf libplist openssl gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-libav" -split " " | ForEach-Object { "mingw-w64-ucrt-x86_64-$_" }

function Invoke-Msys([string]$command) {
  & (Join-Path $msys "usr\bin\bash.exe") -lc $command
  if ($LASTEXITCODE -ne 0) { throw "MSYS2 command failed ($LASTEXITCODE): $command" }
}

if (-not (Test-Path (Join-Path $msys "usr\bin\bash.exe"))) {
  $sfx = Join-Path $env:TEMP "msys2-x86_64-latest.sfx.exe"
  Write-Host "fetch MSYS2"
  & curl.exe -L --fail --retry 3 -o $sfx "https://repo.msys2.org/distrib/msys2-x86_64-latest.sfx.exe"
  if ($LASTEXITCODE -ne 0) { throw "MSYS2 download failed" }
  & $sfx -y "-o$env:LOCALAPPDATA"
  if ($LASTEXITCODE -ne 0) { throw "MSYS2 extraction failed" }
  Remove-Item $sfx
  Invoke-Msys "true"  # first login creates the keyring
}
$env:MSYSTEM = "UCRT64"
# mirror.msys2.org redirects to a nearby mirror that can stall mid-download; ask the main server directly.
Invoke-Msys "sed -i 's|^Server = https://mirror.msys2.org|#&|' /etc/pacman.d/mirrorlist.mingw /etc/pacman.d/mirrorlist.msys"
Invoke-Msys "pacman -Sy --noconfirm --needed $($packages -join ' ')"

$exe = Join-Path $msys "ucrt64\bin\uxplay.exe"
# Lets Hodeum advertise the receiver on the laptop's Mobile Hotspot (see the patch's header).
$patch = Join-Path $PSScriptRoot "uxplay-mdns-interface.patch"
# Which source and patch the installed uxplay.exe was built from, so a changed patch triggers a rebuild.
$stamp = Join-Path $msys "ucrt64\share\uxplay-hodeum.stamp"
$build = "$uxplayCommit $((Get-FileHash $patch -Algorithm SHA256).Hash)"
$built = if (Test-Path $stamp) { (Get-Content $stamp -Raw).Trim() } else { "" }
if ($Rebuild -or -not (Test-Path $exe) -or $built -ne $build) {
  if (-not (Test-Path $source)) { & git clone https://github.com/FDH2/UxPlay.git $source; if ($LASTEXITCODE -ne 0) { throw "git clone failed" } }
  & git -C $source fetch --quiet origin $uxplayCommit
  # --force drops an older copy of the patch before it is applied again.
  & git -C $source checkout --quiet --force $uxplayCommit
  if ($LASTEXITCODE -ne 0) { throw "couldn't check out UxPlay $uxplayCommit" }
  & git -C $source apply $patch
  if ($LASTEXITCODE -ne 0) { throw "couldn't apply $patch to UxPlay $uxplayCommit" }
  $unixSource = (& (Join-Path $msys "usr\bin\cygpath.exe") -u $source)
  Invoke-Msys "cd '$unixSource' && cmake -S . -B build -G Ninja && cmake --build build && cmake --install build --prefix /ucrt64"
  Set-Content -Path $stamp -Value $build
}
Write-Host "built $exe"
# GStreamer scans every plugin on first use (about a minute); do it now so Show iPhone doesn't stall on "waiting".
Write-Host "warming the GStreamer plugin registry"
Invoke-Msys "gst-inspect-1.0 rtph264pay > /dev/null"

# A junction, so Hodeum finds UxPlay in its own fixed runtime folder. Hodeum resolves it before launching:
# GStreamer looks for its plugins relative to the real ucrt64\bin, not to the junction.
$link = Join-Path $root "runtime\uxplay"
if (-not (Test-Path (Join-Path $link "uxplay.exe"))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $link) | Out-Null
  if (Test-Path $link) { throw "$link exists but has no uxplay.exe; remove it and run again" }
  New-Item -ItemType Junction -Path $link -Target (Join-Path $msys "ucrt64\bin") | Out-Null
}
Write-Host "ready: $link\uxplay.exe"
Write-Host "Next: when Windows Firewall asks about uxplay.exe, allow Private and Public networks (the laptop hotspot and the iPhone cable link are Public)."
