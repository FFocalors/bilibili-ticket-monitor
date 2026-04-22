$ErrorActionPreference = "Stop"

Write-Host "Checking OpenClaw bridge listener..." -ForegroundColor Cyan
$listeners = Get-NetTCPConnection -LocalPort 4174 -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
  $listeners | Select-Object LocalAddress, LocalPort, State, OwningProcess | Format-Table -AutoSize
} else {
  Write-Host "No process is listening on port 4174. Start the GUI first: .\start.ps1 or pnpm gui" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Checking firewall rule..." -ForegroundColor Cyan
$rule = Get-NetFirewallRule -DisplayName "Bilibili Bridge" -ErrorAction SilentlyContinue
if ($rule) {
  $rule | Select-Object DisplayName, Enabled, Direction, Action | Format-Table -AutoSize
  Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule | Select-Object Protocol, LocalPort | Format-Table -AutoSize
} else {
  Write-Host "Firewall rule not found. Run PowerShell as Administrator:" -ForegroundColor Yellow
  Write-Host 'netsh advfirewall firewall add rule name="Bilibili Bridge" dir=in action=allow protocol=TCP localport=4174' -ForegroundColor White
}

Write-Host ""
Write-Host "Local Windows checks:" -ForegroundColor Cyan
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:4174/health" -TimeoutSec 3 | ConvertTo-Json -Depth 5
} catch {
  Write-Host "127.0.0.1 health check failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "WSL should try one of these from inside WSL:" -ForegroundColor Cyan
Write-Host "curl -sS http://127.0.0.1:4174/health"
Write-Host 'WINDOWS_HOST="$(ip route | awk ''/default/ {print $3; exit}'')"'
Write-Host 'curl -sS "http://${WINDOWS_HOST}:4174/health"'
