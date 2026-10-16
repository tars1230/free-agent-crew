# free-agent-crew tray (Windows): NotifyIcon from .NET WinForms, no third-party software.
# Shows three coloured dots (cline kilo opencode) from `crew quota --json`, refreshes every 60 s; right-click menu shows details.
# Started hidden by a Startup-folder shortcut written by `crew tray install`; exits by itself when this script file is removed (uninstall).
param([string]$Node = '', [string]$Entry = '', [int]$Seconds = 60, [int]$ExitAfter = 0)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$CrewHome = if ($env:CREW_HOME) { $env:CREW_HOME } else { Join-Path $HOME '.free-agent-crew' }
$cfgPath = Join-Path $CrewHome 'tray\tray.json'
if ((-not $Node -or -not $Entry) -and (Test-Path $cfgPath)) { $cfg = Get-Content -Raw -Encoding UTF8 $cfgPath | ConvertFrom-Json; if (-not $Node) { $Node = $cfg.node }; if (-not $Entry) { $Entry = $cfg.entry } }
if (-not $Entry) { $Entry = Join-Path $CrewHome 'app\bin\crew.js' }
if (-not $Node) { $Node = 'node' }
$Self = $MyInvocation.MyCommand.Path
$SelfStamp = if ($Self) { (Get-Item $Self).LastWriteTimeUtc } else { $null }   # reinstall rewrites the script -> old instance retires
$Order = @('cline', 'kilo', 'opencode')
$Colors = @{ green = [System.Drawing.Color]::FromArgb(48, 209, 88); yellow = [System.Drawing.Color]::FromArgb(255, 214, 10); red = [System.Drawing.Color]::FromArgb(255, 69, 58); unknown = [System.Drawing.Color]::Gray }

function Get-Quota {
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Node; $psi.Arguments = '"' + $Entry + '" quota --json'
    $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $false; $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEndAsync()
    if (-not $p.WaitForExit(30000)) { try { $p.Kill() } catch {}; return @{ error = '超时' } }
    if ($p.ExitCode -ne 0) { return @{ error = "退出码 $($p.ExitCode)" } }
    return @{ data = ($out.Result | ConvertFrom-Json) }
  } catch { return @{ error = $_.Exception.Message } }
}
function New-DotsIcon($statuses) {
  # 16x16: three dots left to right = cline, kilo, opencode
  $bmp = New-Object System.Drawing.Bitmap 16, 16
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.SmoothingMode = 'AntiAlias'; $g.Clear([System.Drawing.Color]::Transparent)
  for ($i = 0; $i -lt 3; $i++) {
    $c = $Colors[[string]$statuses[$i]]; if (-not $c) { $c = $Colors.unknown }
    $b = New-Object System.Drawing.SolidBrush $c; $g.FillEllipse($b, ($i * 5) + 0.5, 5.5, 5, 5); $b.Dispose()
  }
  $g.Dispose(); $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon()); $bmp.Dispose(); return $icon
}
$IconCache = @{}
$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$ni.ContextMenuStrip = $menu
function Render([switch]$Force) {
  if ($menu.Visible -and -not $Force) { return }   # don't rebuild the menu while the user is reading it
  $q = Get-Quota; $menu.Items.Clear(); $LogItems = @(); $st = @('unknown', 'unknown', 'unknown')
  if ($q.error) { [void]$menu.Items.Add("读取失败: $($q.error)") }
  else {
    foreach ($a in $q.data.agents) {
      $i = [array]::IndexOf($Order, $a.agent); if ($i -ge 0) { $st[$i] = $a.status }
      [void]$menu.Items.Add('-')
      $rate = if ($null -ne $a.success_rate) { '{0:P0}' -f [double]$a.success_rate } else { '—' }
      [void]$menu.Items.Add("● $($a.agent)  今日 $($a.calls_today) 次 · 成功率 $rate")
      if ($a.preferred_model) { [void]$menu.Items.Add("  首选: $($a.preferred_model)") }
      foreach ($r in $a.degraded_reasons) { [void]$menu.Items.Add("  降级: $r") }
      foreach ($r in $a.notes) { [void]$menu.Items.Add("  信息: $r") }
      [void]$menu.Items.Add("  门槛: 最低分 $($a.min_score) · 排除 $($a.gate_excluded_count) · 试用期 $($a.provisional_count) · 无结束记录 $($a.unknown_today)")
      foreach ($c in $a.cooling) { [void]$menu.Items.Add("  冷却: $($c.model) → $($c.reset_at) 恢复") }
      if ($a.hour_note) { [void]$menu.Items.Add("  $($a.hour_note)") }
      if ($a.last_failure) { [void]$menu.Items.Add("  最近失败: $($a.last_failure.time) $($a.last_failure.reason) $($a.last_failure.model)") }
      if ($a.log -and (Test-Path $a.log)) { $LogItems += [string]$a.log }
    }
    [void]$menu.Items.Add('-'); [void]$menu.Items.Add("更新于 $($q.data.generated_at)")
  }
  foreach ($it in $menu.Items) { if ($it -is [System.Windows.Forms.ToolStripMenuItem]) { $it.Enabled = $false } }
  foreach ($lp in $LogItems) { $li = $menu.Items.Add("打开日志 $(Split-Path $lp -Leaf)"); $li.Tag = $lp; $li.add_Click({ param($s, $e) Start-Process notepad.exe -ArgumentList ('"' + $s.Tag + '"') }) }
  $r = $menu.Items.Add('立即刷新'); $r.add_Click({ Render -Force })
  $x = $menu.Items.Add('退出'); $x.add_Click({ $ni.Visible = $false; [System.Windows.Forms.Application]::Exit() })
  $key = $st -join ','   # icons are cached per colour combination (at most 4^3), so no GDI handle leak over long uptimes
  if (-not $IconCache.ContainsKey($key)) { $IconCache[$key] = New-DotsIcon $st }
  $ni.Icon = $IconCache[$key]
  $tip = 'crew: ' + ((0..2 | ForEach-Object { $Order[$_] + '=' + $st[$_] }) -join ' ')
  $ni.Text = $tip.Substring(0, [Math]::Min(63, $tip.Length))   # NotifyIcon.Text max 63 chars
}
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [Math]::Max(10, $Seconds) * 1000
$started = Get-Date
$timer.add_Tick({
  if ($Self -and (-not (Test-Path $Self) -or (Get-Item $Self).LastWriteTimeUtc -ne $SelfStamp)) { $ni.Visible = $false; [System.Windows.Forms.Application]::Exit(); return }   # uninstalled or reinstalled
  if ($ExitAfter -gt 0 -and ((Get-Date) - $started).TotalSeconds -ge $ExitAfter) { $ni.Visible = $false; [System.Windows.Forms.Application]::Exit(); return }
  Render
})
Render
$timer.Start()
[System.Windows.Forms.Application]::Run()
$ni.Dispose()
