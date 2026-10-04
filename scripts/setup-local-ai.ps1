# Downloads the local vision model and llama.cpp (CUDA) into models/ and runtime/llama/, and the
# local voice models (Silero VAD, NVIDIA Nemotron ASR, Supertonic TTS) into models/voice/.
# Both folders are git-ignored. Re-running skips files that are already present.
# Also fetches multilingual Whisper base (int8, ~200 MB), the backup speech engine used when Nemotron
# is missing or fails; pass -SkipWhisper to leave it out.
# GPU voice: whisper.cpp's CUDA server (runtime/whisper) and Whisper small q5_1 (models/voice), which
# re-reads each finished utterance on the GPU for a cleaner final transcript. -WhisperTurbo adds
# large-v3-turbo q5_0 (used only when the GPU has room); -SkipGpuVoice leaves all of it out.
param([switch]$SkipWhisper, [switch]$WhisperTurbo, [switch]$SkipGpuVoice)
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
if (-not $SkipWhisper) {
  # Must match WHISPER_SIZE in src-tauri/src/voice/models.rs. Multilingual (not ".en"), so it hears Hindi.
  $packs += @{ Name = "sherpa-onnx-whisper-base"; Url = "$sherpa/asr-models/sherpa-onnx-whisper-base.tar.bz2" }
}
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

# ---- GPU voice: whisper.cpp CUDA server + GGML Whisper models ----
function Get-Verified([string]$Url, [string]$Target, [string]$Sha256) {
  if (Test-Path $Target) { Write-Host "have  $Target"; return }
  Write-Host "fetch $Target"
  & curl.exe -L --fail --retry 3 -o "$Target.part" $Url
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
  $hash = (Get-FileHash -Algorithm SHA256 "$Target.part").Hash
  if ($hash -ne $Sha256) { Remove-Item "$Target.part"; throw "Checksum mismatch for $Url (got $hash)" }
  Move-Item "$Target.part" $Target -Force
}
if (-not $SkipGpuVoice) {
  # Must match WHISPER_SERVER_EXE and the model names in src-tauri/src/voice/gpu_asr.rs.
  $whisperBuild = "b5130"
  $whisperZip = Join-Path $root "runtime/whisper-cublas-12.4.0-bin-x64.zip"
  $whisperDir = Join-Path $root "runtime/whisper"
  if (-not (Test-Path (Join-Path $whisperDir "whisper-server.exe"))) {
    Get-Verified "https://github.com/ggml-org/whisper.cpp/releases/download/$whisperBuild/whisper-cublas-12.4.0-bin-x64.zip" $whisperZip "AF520DDD034D985B55DFEEA3E465ED93653BA2AEE1A55E865033EDC548C272A7"
    New-Item -ItemType Directory -Force -Path $whisperDir | Out-Null
    # Only the server and its ggml backends: the zip's own CUDA runtime (~560 MB) duplicates runtime/llama's,
    # and its ggml DLLs must not mix with llama's (same names, different builds).
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($whisperZip)
    try {
      foreach ($entry in $zip.Entries) {
        if ($entry.Name -match '^(whisper-server\.exe|whisper\.dll|ggml\.dll|ggml-base\.dll|ggml-cuda\.dll|ggml-cpu-.+\.dll)$') {
          [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $whisperDir $entry.Name), $true)
        }
      }
    } finally { $zip.Dispose() }
    Remove-Item $whisperZip
  }
  foreach ($dll in @("cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll")) {
    $link = Join-Path $whisperDir $dll
    if (-not (Test-Path $link)) { New-Item -ItemType HardLink -Path $link -Target (Join-Path $llamaDir $dll) | Out-Null }
  }
  Write-Host "ready: $(Join-Path $whisperDir 'whisper-server.exe')"
  $hf = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"
  Get-Verified "$hf/ggml-small-q5_1.bin" (Join-Path $voiceDir "ggml-small-q5_1.bin") "AE85E4A935D7A567BD102FE55AFC16BB595BDB618E11B2FC7591BC08120411BB"
  if ($WhisperTurbo) {
    Get-Verified "$hf/ggml-large-v3-turbo-q5_0.bin" (Join-Path $voiceDir "ggml-large-v3-turbo-q5_0.bin") "394221709CD5AD1F40C46E6031CA61BCE88931E6E088C188294C6D5A55FFA7E2"
  }
  Write-Host "GPU voice ready: $whisperDir"
}
