param([int]$Samples = 12, [int]$IntervalSeconds = 10)
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3333'
for ($sample = 0; $sample -lt $Samples; $sample++) {
  $health = Invoke-RestMethod "$base/api/health"
  $logger = Invoke-RestMethod "$base/api/loggers/LOGGER-001"
  $dashboard = Invoke-RestMethod "$base/api/dashboard"
  $search = Invoke-RestMethod "$base/api/parts?search=PT-00018429"
  $part = Invoke-RestMethod "$base/api/parts/PT-00018429"
  $age = if ($logger.lastSeen) {
    [math]::Round(([datetimeoffset]::Parse($health.timestamp) - [datetimeoffset]::Parse($logger.lastSeen)).TotalSeconds, 3)
  } else { $null }
  [pscustomobject]@{
    serverUtc = $health.timestamp
    lastSeen = $logger.lastSeen
    ageSeconds = $age
    logger = $logger.status
    online = $dashboard.summary.online
    offline = $dashboard.summary.offline
    search = $search.items[0].status
    part = $part.status
  } | ConvertTo-Json -Compress
  if ($sample + 1 -lt $Samples) { Start-Sleep -Seconds $IntervalSeconds }
}
