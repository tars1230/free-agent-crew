# free-agent-crew installer for Windows (PowerShell 5+). Idempotent. No bash needed.
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1 [--no-cli] [--no-path] [--no-skills] [--upgrade] [--registry URL] [--force] [--tray] [--uninstall-tray]
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Src = Split-Path -Parent $MyInvocation.MyCommand.Path
$CrewHome = if ($env:CREW_HOME) { $env:CREW_HOME } else { Join-Path $HOME '.free-agent-crew' }
$App = Join-Path $CrewHome 'app'
New-Item -ItemType Directory -Force -Path $CrewHome | Out-Null

function Test-Node($p) {
  if (-not $p -or -not (Test-Path $p)) { return $false }
  try { $v = & $p -p "process.versions.node.split('.')[0]" 2>$null; return ([int]$v -ge 18) } catch { return $false }
}
function Find-Node {
  $c = @()
  $cmd = Get-Command node -ErrorAction SilentlyContinue; if ($cmd) { $c += $cmd.Source }
  $c += (Join-Path $CrewHome 'node\node.exe'), "$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
  foreach ($p in $c) { if (Test-Node $p) { return $p } }
  return $null
}
function Install-PortableNode {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  # CREW_NODE_MIRROR is tried first; HTTPS_PROXY/HTTP_PROXY is passed to Invoke-WebRequest (PowerShell 5.1 ignores those variables by itself)
  $bases = @($env:CREW_NODE_MIRROR, 'https://nodejs.org/dist/latest-v22.x', 'https://npmmirror.com/mirrors/node/latest-v22.x') | Where-Object { $_ }
  # Windows PowerShell 5.1 on older systems may not offer TLS 1.2, which nodejs.org / npmmirror require
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
  $px = @{}; $pv = if ($env:HTTPS_PROXY) { $env:HTTPS_PROXY } elseif ($env:HTTP_PROXY) { $env:HTTP_PROXY } else { $null }; if ($pv) { $px.Proxy = $pv }
  foreach ($base in $bases) {
    try {
      Write-Host "下载便携 Node 22 (win-$arch) from $base ..."
      $sums = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop @px -Uri "$base/SHASUMS256.txt").Content
      $line = ($sums -split "`r?`n" | ForEach-Object { $_.Trim() }) | Where-Object { $_ -match "node-v[\d.]+-win-$arch\.zip$" } | Select-Object -First 1
      if (-not $line) { continue }
      $want, $file = ($line.Trim() -split '\s+')[0, 1]
      $tmp = Join-Path $env:TEMP $file
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 600 -ErrorAction Stop @px -Uri "$base/$file" -OutFile $tmp
      if ((Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower() -ne $want.ToLower()) { Write-Host '校验失败，换源'; continue }
      $dst = Join-Path $CrewHome 'node'; $new = "$dst.new"
      if (Test-Path $new) { Remove-Item -Recurse -Force $new }
      Expand-Archive -Force $tmp $new
      $inner = Get-ChildItem $new | Select-Object -First 1
      if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
      Move-Item $inner.FullName $dst; Remove-Item -Recurse -Force $new; Remove-Item $tmp
      return (Join-Path $dst 'node.exe')
    } catch { Write-Host "失败: $($_.Exception.Message)" }
  }
  return $null
}

$Node = Find-Node
if (-not $Node) {
  Write-Host '没有找到 Node >= 18。'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host '尝试 winget 安装 OpenJS.NodeJS.LTS（用户范围）...'
    try { winget install -e --id OpenJS.NodeJS.LTS --scope user --accept-source-agreements --accept-package-agreements --silent | Out-Host } catch {}
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $Node = Find-Node
  }
  if (-not $Node) { $Node = Install-PortableNode }
  if (-not $Node) { Write-Host '❌ 自动安装 Node 失败，请手动安装 Node 20+ 后重跑。'; exit 1 }
}
Write-Host "Node: $Node ($(& $Node -v))"
$env:Path = (Split-Path $Node) + ';' + $env:Path   # npm from the same Node

if ((Resolve-Path $Src).Path -ne $App) {
  $new = "$App.new"; if (Test-Path $new) { Remove-Item -Recurse -Force $new }
  Copy-Item -Recurse -Force $Src $new
  if (Test-Path $App) { Remove-Item -Recurse -Force $App }
  Move-Item $new $App
}
$env:CREW_HOME = $CrewHome
& $Node (Join-Path $App 'bin\crew.js') setup @args
$rc = $LASTEXITCODE
Write-Host ''
& $Node (Join-Path $App 'bin\crew.js') doctor --quick
Write-Host ''
Write-Host "不依赖 PATH 的调用方式: & '$Node' '$(Join-Path $App 'bin\crew.js')' doctor"
exit $rc
