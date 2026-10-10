# Packs ArmorHUD_BP and ArmorHUD_RP into mods/ArmorEffectsHUD-v<version>.mcaddon for the site.
# Run from anywhere: powershell -File src/ArmorEffectsHUD/tools/package.ps1
# Zip entries use forward slashes; Compress-Archive in Windows PowerShell 5.1 writes backslashes,
# which Minecraft on iPad can't read.
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$modsDir = Join-Path (Split-Path -Parent (Split-Path -Parent $root)) "mods"
$version = ((Get-Content (Join-Path $root "ArmorHUD_BP\manifest.json") -Raw | ConvertFrom-Json).header.version)[0..1] -join "."
$out = Join-Path $modsDir "ArmorEffectsHUD-v$version.mcaddon"

New-Item -ItemType Directory -Force $modsDir | Out-Null
if (Test-Path $out) { Remove-Item $out -Confirm:$false }

$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
  Get-ChildItem (Join-Path $root "ArmorHUD_BP"), (Join-Path $root "ArmorHUD_RP") -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel)
  }
} finally {
  $zip.Dispose()
}
"Wrote $out"
