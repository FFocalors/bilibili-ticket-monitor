param(
  [string]$ActivityName,
  [string]$Url,
  [string[]]$Keywords,
  [int]$Quantity = 1,
  [int]$IntervalSeconds = 30,
  [ValidateSet("msedge", "chrome", "chromium")]
  [string]$BrowserChannel = "msedge",
  [string]$OpenClawEnabled = "",
  [string]$OpenClawUrl = "http://127.0.0.1:18789/hooks/wake",
  [string]$OpenClawTokenEnv = "OPENCLAW_HOOKS_TOKEN"
)

$ErrorActionPreference = "Stop"

function Read-Default {
  param(
    [string]$Prompt,
    [string]$Default
  )

  $suffix = if ($Default) { " [$Default]" } else { "" }
  $value = Read-Host "$Prompt$suffix"
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $Default
  }
  return $value.Trim()
}

function Read-IntDefault {
  param(
    [string]$Prompt,
    [int]$Default,
    [int]$Minimum = 1
  )

  while ($true) {
    $raw = Read-Default -Prompt $Prompt -Default ([string]$Default)
    $parsed = 0
    if ([int]::TryParse($raw, [ref]$parsed) -and $parsed -ge $Minimum) {
      return $parsed
    }
    Write-Host "Please enter an integer >= $Minimum." -ForegroundColor Yellow
  }
}

function Read-BoolDefault {
  param(
    [string]$Prompt,
    [bool]$Default
  )

  $defaultText = if ($Default) { "Y" } else { "N" }
  while ($true) {
    $raw = Read-Default -Prompt "$Prompt (Y/N)" -Default $defaultText
    switch -Regex ($raw) {
      "^(y|yes|true|1)$" { return $true }
      "^(n|no|false|0)$" { return $false }
      default { Write-Host "Please enter Y or N." -ForegroundColor Yellow }
    }
  }
}

function Convert-BoolText {
  param([string]$Value)

  switch -Regex ($Value.Trim()) {
    "^(y|yes|true|1)$" { return $true }
    "^(n|no|false|0)$" { return $false }
    default { throw "Invalid boolean value: $Value. Use true or false." }
  }
}

function Quote-Yaml {
  param([string]$Value)
  return '"' + ($Value -replace '\\', '\\' -replace '"', '\"') + '"'
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$configDir = Join-Path $repoRoot "config"
$configPath = Join-Path $configDir "events.yaml"

New-Item -ItemType Directory -Force -Path $configDir | Out-Null

if (-not $ActivityName) {
  $ActivityName = Read-Default -Prompt "Activity name" -Default "my-bilibili-monitor"
}

while (-not $Url) {
  $Url = Read-Default -Prompt "Bilibili show URL" -Default ""
}

if (-not ($Url -match '^https?://')) {
  throw "URL must start with http:// or https://."
}

if (-not $Keywords -or $Keywords.Count -eq 0) {
  $date = Read-Default -Prompt "Date keyword" -Default "2026-05-08"
  $price = Read-Default -Prompt "Price keyword" -Default "488"
  $area = Read-Default -Prompt "Area/ticket keyword" -Default "inner"
  $Keywords = @($date, $price, $area) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
} else {
  $Keywords = $Keywords |
    ForEach-Object { $_ -split "," } |
    ForEach-Object { $_.Trim().Trim('"').Trim("'") } |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}

if ($Quantity -lt 1) {
  $Quantity = Read-IntDefault -Prompt "Quantity" -Default 1 -Minimum 1
}

if ($IntervalSeconds -lt 10) {
  $IntervalSeconds = Read-IntDefault -Prompt "Refresh interval in seconds" -Default 30 -Minimum 10
}

$openClawEnabledValue = $false
if ([string]::IsNullOrWhiteSpace($OpenClawEnabled)) {
  $openClawEnabledValue = Read-BoolDefault -Prompt "Enable OpenClaw notification" -Default $false
} else {
  $openClawEnabledValue = Convert-BoolText -Value $OpenClawEnabled
}

if ($openClawEnabledValue) {
  $OpenClawUrl = Read-Default -Prompt "OpenClaw webhook URL" -Default $OpenClawUrl
  $OpenClawTokenEnv = Read-Default -Prompt "OpenClaw token env name" -Default $OpenClawTokenEnv
}

$keywordLines = ($Keywords | ForEach-Object { "          - " + (Quote-Yaml $_) }) -join [Environment]::NewLine
$openClawEnabledText = if ($openClawEnabledValue) { "true" } else { "false" }

$yaml = @"
defaults:
  intervalSeconds: $IntervalSeconds
  jitterRatio: 0.25
  maxParallelPages: 1
  headless: false
  browserChannel: $BrowserChannel
  userDataDir: .browser-profile
  logFile: logs/monitor.log
  screenshotDir: logs/screenshots

notifications:
  openclaw:
    enabled: $openClawEnabledText
    url: $OpenClawUrl
    tokenEnv: $OpenClawTokenEnv
    mode: now

events:
  - name: $(Quote-Yaml $ActivityName)
    url: $Url
    intervalSeconds: $IntervalSeconds
    targets:
      - name: $(Quote-Yaml $ActivityName)
        keywords:
$keywordLines
        quantity: $Quantity
        priority: 1
"@

Set-Content -LiteralPath $configPath -Value $yaml -Encoding UTF8

Write-Host "Config generated: $configPath" -ForegroundColor Green
if ($openClawEnabledValue) {
  Write-Host "Set this Windows environment variable before launch:" -ForegroundColor Yellow
  Write-Host ('$env:' + $OpenClawTokenEnv + '="token configured in OpenClaw"') -ForegroundColor Yellow
}
