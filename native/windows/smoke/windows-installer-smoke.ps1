# TEST-ONLY (pwsh 7, GitHub-hosted windows runner VM). Not packed into the app.
# Silent per-user NSIS install into a temp dir -> verify files/registry/shortcuts -> asar content check
# -> plain launch of the installed exe (network-blocked) + desktop screenshot (visual only)
# -> Playwright probe of the installed exe (assertions) -> source harness against installed app.asar
# -> silent uninstall -> verify clean removal. Uninstall is attempted even when a step fails.
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Evidence
)
# Continue: every step records its own PASS/FAIL; native stderr must not abort before uninstall.
$ErrorActionPreference = 'Continue'
$failed = 1
$AppRoot = Split-Path -Parent $PSScriptRoot                  # native/windows
$ProductName = [string]::new([char[]]@(0xC633, 0xC740)) + 'VOCA'   # Hangul product name built from code points (ASCII-only script)
$InstallDir = Join-Path $env:RUNNER_TEMP 'OrunVocaInstallTest'
$Exe = Join-Path $InstallDir "$ProductName.exe"
$Asar = Join-Path $InstallDir 'resources\app.asar'
$NetBlock = @('--proxy-server=http://127.0.0.1:9', '"--host-resolver-rules=MAP * ~NOTFOUND"')
New-Item -ItemType Directory -Force -Path $Evidence | Out-Null
$checks = [System.Collections.Generic.List[object]]::new()
$facts = [ordered]@{ runner = 'GitHub-hosted windows-latest VM (not a physical user device)'; os = [Environment]::OSVersion.VersionString; installDir = $InstallDir }
function Check([string]$Name, [bool]$Ok, $Detail = $null) {
  $checks.Add([ordered]@{ name = $Name; ok = $Ok; detail = $Detail })
  Write-Host ("{0}  {1}" -f ($(if ($Ok) { 'PASS' } else { 'FAIL' }), $Name))
}
function UninstallEntries {
  @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*') |
    ForEach-Object { Get-ItemProperty -Path $_ -ErrorAction SilentlyContinue } |
    Where-Object { $_.DisplayName -like "$ProductName*" } |
    Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, UninstallString, PSPath
}
function Shortcuts {
  $desk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$ProductName.lnk"
  $start = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$ProductName.lnk"
  [ordered]@{ desktop = $desk; desktopExists = (Test-Path $desk); startMenu = $start; startMenuExists = (Test-Path $start) }
}
function AppProcs { Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "$InstallDir*" } }
function ScreenShot([string]$Path) {
  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = [System.Drawing.Bitmap]::new($b.Width, $b.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
    return "$($b.Width)x$($b.Height)"
  } catch { return "screenshot failed: $_" }
}

try {
  $facts.installer = (Resolve-Path $Installer).Path
  $facts.preExistingUninstallEntries = @(UninstallEntries).Count
  Check 'no pre-existing installation entry' ($facts.preExistingUninstallEntries -eq 0)

  # 1) Silent per-user install (/D must be last, unquoted).
  $p = Start-Process -FilePath $Installer -ArgumentList '/S', '/currentuser', "/D=$InstallDir" -Wait -PassThru
  $facts.installerExitCode = $p.ExitCode
  $deadline = (Get-Date).AddSeconds(90)
  while (-not (Test-Path $Exe) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  Check 'silent NSIS installer exited 0' ($p.ExitCode -eq 0) $p.ExitCode
  Check 'installed exe exists' (Test-Path $Exe) $Exe
  Check 'installed resources\app.asar exists' (Test-Path $Asar) $Asar
  $uninst = Get-ChildItem -Path $InstallDir -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  Check 'uninstaller exists' ($null -ne $uninst) ($uninst.FullName)
  $entries = @(UninstallEntries)
  $facts.uninstallEntries = $entries
  Check 'Apps & features (Uninstall) registry entry created with version 1.0.1' (($entries.Count -eq 1) -and ($entries[0].DisplayVersion -eq '1.0.1')) $entries
  $facts.shortcutsAfterInstall = Shortcuts
  if (Test-Path $Exe) {
    $vi = (Get-Item $Exe).VersionInfo
    $facts.exeVersion = [ordered]@{ file = $vi.FileVersion; product = $vi.ProductVersion; productName = $vi.ProductName }
    $facts.exeSignature = (Get-AuthenticodeSignature $Exe).Status.ToString()
  }

  # 2) Packaged content must not contain smoke harness/fixture/test hooks.
  & node (Join-Path $AppRoot 'smoke\check-asar.js') $Asar (Join-Path $Evidence 'installed-asar-contents.json')
  Check 'installed app.asar contains only src/** + package.json and main.js has no test hooks' ($LASTEXITCODE -eq 0)

  # 3) Plain launch of the installed exe (no driver/inspector). Network blocked by Chromium switches,
  #    so the real site is not contacted; the window shows a network error page. Screenshot is VISUAL ONLY.
  $proc = Start-Process -FilePath $Exe -ArgumentList $NetBlock -PassThru
  Start-Sleep -Seconds 12
  $proc.Refresh()
  $main = AppProcs | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  $facts.plainLaunch = [ordered]@{ pid = $proc.Id; exited = $proc.HasExited; processCount = @(AppProcs).Count;
    mainWindowTitle = $(if ($main) { $main.MainWindowTitle } else { $null }) }
  Check 'plain launch: installed exe still running after 12s' (-not $proc.HasExited) $facts.plainLaunch
  Check "plain launch: top-level window titled $ProductName exists" ($main -and $main.MainWindowTitle -eq $ProductName) $facts.plainLaunch
  $facts.plainLaunch.screenshot = ScreenShot (Join-Path $Evidence 'VISUAL-ONLY-installed-plain-launch-screen.png')
  AppProcs | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3

  # 4) Assertions on the INSTALLED exe via Playwright (synthetic fixture on trusted origin, network blocked).
  & node (Join-Path $AppRoot 'smoke\installed-app.js') $Exe $Evidence
  Check 'installed exe: Playwright runtime probe passed (see installed-exe-summary.txt)' ($LASTEXITCODE -eq 0) $LASTEXITCODE
  AppProcs | Stop-Process -Force -ErrorAction SilentlyContinue

  # 5) Same probe via the dev Electron binary against the installed app.asar main (cross-check).
  Push-Location $AppRoot
  & npx electron smoke/harness-main.js "--app-main=$Asar\src\main.js" "--out=$Evidence" '--label=installed-asar' 2>&1 |
    Tee-Object -FilePath (Join-Path $Evidence 'logs-installed-asar-harness.txt')
  $harnessCode = $LASTEXITCODE
  Pop-Location
  Check 'installed app.asar main: source-harness probe passed' ($harnessCode -eq 0) $harnessCode
} catch {
  Check "installer smoke script error: $_" $false ($_.ScriptStackTrace)
} finally {
  # 6) Silent uninstall and clean-removal verification.
  AppProcs | Stop-Process -Force -ErrorAction SilentlyContinue
  $uninst = Get-ChildItem -Path $InstallDir -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($uninst) {
    $u = Start-Process -FilePath $uninst.FullName -ArgumentList '/S' -Wait -PassThru
    $facts.uninstallerExitCode = $u.ExitCode
    $deadline = (Get-Date).AddSeconds(120)   # NSIS uninstaller re-launches itself from %TEMP%
    while ((Test-Path $Exe) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
    Start-Sleep -Seconds 3
  }
  $left = @(Get-ChildItem -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue)
  $facts.leftoverFilesInInstallDir = $left | Select-Object -First 30 -ExpandProperty FullName
  $facts.shortcutsAfterUninstall = Shortcuts
  $facts.uninstallEntriesAfterUninstall = @(UninstallEntries)
  Check 'uninstall: installed exe removed' (-not (Test-Path $Exe))
  Check 'uninstall: install dir empty or removed' ($left.Count -eq 0) $facts.leftoverFilesInInstallDir
  Check 'uninstall: registry entry removed' ($facts.uninstallEntriesAfterUninstall.Count -eq 0)
  Check 'uninstall: desktop/start-menu shortcuts removed' ((-not $facts.shortcutsAfterUninstall.desktopExists) -and (-not $facts.shortcutsAfterUninstall.startMenuExists)) $facts.shortcutsAfterUninstall
  # App data is kept by design (deleteAppDataOnUninstall=false); record and remove it for runner hygiene.
  $facts.appDataDirs = @(@((Join-Path $env:APPDATA $ProductName), (Join-Path $env:APPDATA 'orunvoca-windows')) | Where-Object { Test-Path $_ })
  $facts.appDataDirs | ForEach-Object { Remove-Item -Recurse -Force $_ -ErrorAction SilentlyContinue }
  if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue }

  $failed = @($checks | Where-Object { -not $_.ok }).Count
  [ordered]@{ ok = ($failed -eq 0); failed = $failed; facts = $facts; checks = $checks } |
    ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $Evidence 'installer-lifecycle-result.json')
  Write-Host "installer lifecycle: $(if ($failed -eq 0) { 'ALL CHECKS PASSED' } else { "$failed FAILED" })"
}
if ($failed -ne 0) { exit 1 }
exit 0
