$ErrorActionPreference = "SilentlyContinue"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $node)) {
  $node = (Get-Command node).Source
}

try {
  $health = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3001/api/health" -TimeoutSec 2
  if ($health.StatusCode -eq 200) {
    exit 0
  }
} catch {
}

Start-Process `
  -FilePath $node `
  -ArgumentList "server.mjs" `
  -WorkingDirectory $projectDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $projectDir "server-live.out.log") `
  -RedirectStandardError (Join-Path $projectDir "server-live.err.log")
