# Downloads the local vision model and llama.cpp (CUDA) into models/ and runtime/llama/.
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
