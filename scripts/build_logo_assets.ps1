$ErrorActionPreference = "Stop"

# Copy PNGs
Copy-Item 'assets\mule-shield-logo-transparent.png' 'assets\mule-shield-logo.png' -Force
Copy-Item 'assets\mule-shield-logo-transparent.png' 'frontend\assets\mule-shield-logo.png' -Force
Copy-Item 'assets\mule-shield-logo-transparent.png' 'public\assets\mule-shield-logo.png' -Force

# Read base64
$bytes = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot "..\assets\mule-shield-logo.png"))
$b64 = [Convert]::ToBase64String($bytes)

# Build SVG
$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 479" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">' + "`n"
$svg += '  <title>MULE SHIELD logo</title>' + "`n"
$svg += '  <image width="500" height="479" href="data:image/png;base64,' + $b64 + '" />' + "`n"
$svg += '</svg>' + "`n"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
[System.IO.File]::WriteAllText((Join-Path $root "assets\mule-shield-logo.svg"), $svg)
[System.IO.File]::WriteAllText((Join-Path $root "frontend\assets\mule-shield-logo.svg"), $svg)
[System.IO.File]::WriteAllText((Join-Path $root "public\assets\mule-shield-logo.svg"), $svg)

# Also create a favicon in root and assets
Copy-Item 'assets\mule-shield-logo.png' 'favicon.png' -Force
Copy-Item 'assets\mule-shield-logo.png' 'frontend\favicon.png' -Force
Copy-Item 'assets\mule-shield-logo.svg' 'favicon.svg' -Force
Copy-Item 'assets\mule-shield-logo.svg' 'frontend\favicon.svg' -Force

Write-Output "SUCCESS: All logo assets created"
