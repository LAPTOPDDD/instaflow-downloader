$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Manifest = Get-Content (Join-Path $Root "manifest.json") -Raw | ConvertFrom-Json
$Output = Join-Path $Root ("InstaFlow-v" + $Manifest.version + ".zip")
$Stage = Join-Path $env:TEMP ("instaflow-package-" + [guid]::NewGuid().ToString("N"))

New-Item -ItemType Directory -Path $Stage | Out-Null

try {
    $Items = @(
        "manifest.json",
        "background.js",
        "content.js",
        "assets",
        "icons",
        "popup",
        "options",
        "PRIVACY.md",
        "README.md",
        "LICENSE"
    )

    foreach ($Item in $Items) {
        Copy-Item (Join-Path $Root $Item) -Destination $Stage -Recurse
    }

    if (Test-Path $Output) { Remove-Item $Output }
    Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $Output -CompressionLevel Optimal
    Write-Host "Created: $Output"
}
finally {
    Remove-Item $Stage -Recurse -Force
}
