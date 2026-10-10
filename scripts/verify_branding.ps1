$ErrorActionPreference = "Stop"

Write-Output "=== MULE SHIELD BRANDING VERIFICATION ==="

# 1. Check all official logo assets
$assets = @(
    "assets/mule-shield-logo.svg",
    "assets/mule-shield-logo.png",
    "frontend/assets/mule-shield-logo.svg",
    "frontend/assets/mule-shield-logo.png",
    "public/assets/mule-shield-logo.svg",
    "public/assets/mule-shield-logo.png",
    "favicon.svg",
    "favicon.png",
    "frontend/favicon.svg",
    "frontend/favicon.png",
    "frontend/js/logo.js",
    "manifest.json"
)

$missingAssets = 0
foreach ($path in $assets) {
    if (Test-Path $path) {
        $size = (Get-Item $path).Length
        Write-Output " [PASS] $path ($size bytes)"
    } else {
        Write-Output " [FAIL] Missing $path"
        $missingAssets++
    }
}

# 2. Check HTML references
$html = Get-Content "index.html" -Raw
$refs = @(
    "assets/mule-shield-logo.svg",
    "assets/mule-shield-logo.png",
    "manifest.json",
    "frontend/css/styles.css",
    "frontend/js/logo.js",
    "frontend/js/csvValidator.js",
    "frontend/js/app.js"
)

$missingRefs = 0
foreach ($ref in $refs) {
    if ($html.Contains($ref)) {
        if (Test-Path $ref) {
            Write-Output " [PASS] Referenced in HTML & exists on disk: $ref"
        } else {
            Write-Output " [FAIL] Referenced in HTML but NOT found: $ref"
            $missingRefs++
        }
    } else {
        Write-Output " [FAIL] Missing reference in HTML: $ref"
        $missingRefs++
    }
}

# 3. Check for any remaining placeholder shield emojis
if ($html.Contains("🛡️") -or $html.Contains("🛡")) {
    Write-Output " [FAIL] Found remaining placeholder shield emoji in index.html"
    $missingRefs++
} else {
    Write-Output " [PASS] Zero placeholder emojis in index.html"
}

# 4. Check CSS classes
$css = Get-Content "frontend/css/styles.css" -Raw
$cssClasses = @(
    ".mule-shield-logo-img",
    ".mule-shield-logo--sidebar",
    ".mule-shield-logo--navbar",
    ".mule-shield-logo--loading",
    ".mule-shield-logo--report",
    ".mule-shield-logo--empty",
    ".sidebar.collapsed"
)

foreach ($cls in $cssClasses) {
    if ($css.Contains($cls)) {
        Write-Output " [PASS] CSS contains $cls"
    } else {
        Write-Output " [FAIL] CSS missing $cls"
        $missingRefs++
    }
}

Write-Output ""
if ($missingAssets -eq 0 -and $missingRefs -eq 0) {
    Write-Output "RESULT: ALL CHECKS PASSED PERFECTLY!"
} else {
    Write-Output "RESULT: CHECKS FAILED ($missingAssets missing assets, $missingRefs reference errors)"
    exit 1
}
