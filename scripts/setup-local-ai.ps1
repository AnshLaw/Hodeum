# Downloads the local vision model and llama.cpp (CUDA) into models/ and runtime/llama/, and the
# local voice models (Silero VAD, NVIDIA Nemotron ASR, Supertonic TTS) into models/voice/.
# Both folders are git-ignored. Re-running skips files that are already present.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$llamaBuild = "b11380"
$cuda = "cuda-12.4"
$downloads = @(
  @{ Url = "https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/Qwen3VL-4B-Instruct-Q4_K_M.gguf"; Out = "models/Qwen3VL-4B-Instruct-Q4_K_M.gguf" },
  @{ Url = "https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-4B-Instruct-F16.gguf"; Out = "models/mmproj-Qwen3VL-4B-Instruct-F16.gguf" },
  @{ Url = "https://github.com/ggml-org/llama.cpp/releases/download/$llamaBuild/llama-$llamaBuild-bin-win-$cuda-x64.zip"; Out = "runtime/llama-$cuda.zip" },
  @{ Url = "https://github.com/ggml-org/llama.cpp/releases/download/$llamaBuild/cudart-llama-bin-win-$cuda-x64.zip"; Out = "runtime/cudart-$cuda.zip" }
)
foreach ($item in $downloads) {
  $target = Join-Path $root $item.Out
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
  if (Test-Path $target) { Write-Host "have  $($item.Out)"; continue }
  Write-Host "fetch $($item.Out)"
  & curl.exe -L --fail --retry 3 -o "$target.part" $item.Url
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $($item.Url)" }
  Move-Item "$target.part" $target
}
$llamaDir = Join-Path $root "runtime/llama"
if (-not (Test-Path (Join-Path $llamaDir "llama-server.exe"))) {
  Expand-Archive -Force (Join-Path $root "runtime/llama-$cuda.zip") $llamaDir
  Expand-Archive -Force (Join-Path $root "runtime/cudart-$cuda.zip") $llamaDir
}
Write-Host "ready: $(Join-Path $llamaDir 'llama-server.exe')"

# ---- Local voice (CPU): sherpa-onnx model packs ----
$sherpa = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
$voiceDir = Join-Path $root "models/voice"
New-Item -ItemType Directory -Force -Path $voiceDir | Out-Null
$vad = Join-Path $voiceDir "silero_vad.onnx"
if (-not (Test-Path $vad)) {
  & curl.exe -L --fail --retry 3 -o "$vad.part" "$sherpa/asr-models/silero_vad.onnx"
  if ($LASTEXITCODE -ne 0) { throw "Download failed: silero_vad.onnx" }
  Move-Item "$vad.part" $vad
}
$packs = @(
  @{ Name = "sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11"; Url = "$sherpa/asr-models/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11.tar.bz2" },
  @{ Name = "sherpa-onnx-supertonic-3-tts-int8-2026-05-11"; Url = "$sherpa/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2" },
  # Kokoro-82M: Hodey's most natural local voice (about 50 voices, full precision).
  @{ Name = "kokoro-multi-lang-v1_0"; Url = "$sherpa/tts-models/kokoro-multi-lang-v1_0.tar.bz2" }
)
foreach ($pack in $packs) {
  $dir = Join-Path $voiceDir $pack.Name
  if (Test-Path $dir) { Write-Host "have  models/voice/$($pack.Name)"; continue }
  $archive = Join-Path $voiceDir "$($pack.Name).tar.bz2"
  if (-not (Test-Path $archive)) {
    Write-Host "fetch models/voice/$($pack.Name)"
    & curl.exe -L --fail --retry 3 -o "$archive.part" $pack.Url
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $($pack.Url)" }
    Move-Item "$archive.part" $archive -Force
  }
  # Windows' own tar (bsdtar) reads bzip2 itself; Git's tar on PATH would need an external bzip2.
  & (Join-Path $env:SystemRoot "System32/tar.exe") -xjf $archive -C $voiceDir
  if ($LASTEXITCODE -ne 0) { throw "Couldn't unpack $archive" }
  Remove-Item $archive
}
Write-Host "voice ready: $voiceDir"
