# Builds the plugin and packs a ready-to-install folder + zip into .\dist
param(
    [string]$Version = "1.0.0.0"
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$proj = Join-Path $root "Jellyfin.Plugin.PreviouslyOn\Jellyfin.Plugin.PreviouslyOn.csproj"

$dotnet = (Get-Command dotnet -ErrorAction SilentlyContinue).Source
$userDotnet = Join-Path $env:LOCALAPPDATA "Microsoft\dotnet\dotnet.exe"
if (Test-Path $userDotnet) { $dotnet = $userDotnet }

& $dotnet build $proj -c Release -nologo -p:AssemblyVersion=$Version -p:FileVersion=$Version
if ($LASTEXITCODE -ne 0) { throw "build failed" }

$dist = Join-Path $root "dist"
$folder = Join-Path $dist "PreviouslyOn_$Version"
if (Test-Path $folder) { Remove-Item $folder -Recurse -Force -Confirm:$false }
New-Item -ItemType Directory -Force $folder | Out-Null

Copy-Item (Join-Path $root "Jellyfin.Plugin.PreviouslyOn\bin\Release\net10.0\Jellyfin.Plugin.PreviouslyOn.dll") $folder

Copy-Item (Join-Path $root "images\logo.png") $folder

$meta = [ordered]@{
    category    = "General"
    changelog   = "First release: recap of the previous episodes before playback after a break"
    description = "Shows a short recap of the last episodes (from the episode descriptions in your library) before an episode starts after a long break."
    guid        = "6257f11a-c7cd-4fc5-b2c0-2e327ccf7c7d"
    name        = "Previously On"
    overview    = "Previously on: recap after a break"
    owner       = "skriewel"
    targetAbi   = "12.0.0.0"
    timestamp   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    version     = $Version
    status      = "Active"
    autoUpdate  = $true
    imagePath   = "logo.png"
    assemblies  = @("Jellyfin.Plugin.PreviouslyOn.dll")
}
[IO.File]::WriteAllText((Join-Path $folder "meta.json"), ($meta | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))

$zip = Join-Path $dist "PreviouslyOn_$Version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force -Confirm:$false }
Compress-Archive -Path (Join-Path $folder "*") -DestinationPath $zip
$md5 = (Get-FileHash $zip -Algorithm MD5).Hash
Write-Host "Done: $zip (MD5 $md5)"

& (Join-Path $root "update-manifest.ps1") -Version $Version
