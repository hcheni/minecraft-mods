# Packs EnchantmentMods_BP and EnchantmentMods_RP into mods/EnchantmentMods-v<version>.mcaddon for the site.
# Run from anywhere: powershell -File src/EnchantmentMods/tools/package.ps1
# Zip entries use forward slashes; Compress-Archive in Windows PowerShell 5.1 writes backslashes,
# which Minecraft on iPad can't read.
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$modsDir = Join-Path (Split-Path -Parent (Split-Path -Parent $root)) "mods"
$v = (Get-Content (Join-Path $root "EnchantmentMods_BP\manifest.json") -Raw | ConvertFrom-Json).header.version
$version = if ($v[2] -ne 0) { $v -join "." } else { $v[0..1] -join "." }
$out = Join-Path $modsDir "EnchantmentMods-v$version.mcaddon"

New-Item -ItemType Directory -Force $modsDir | Out-Null
if (Test-Path $out) { Remove-Item $out -Confirm:$false }

$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
  Get-ChildItem (Join-Path $root "EnchantmentMods_BP"), (Join-Path $root "EnchantmentMods_RP") -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel)
  }
} finally {
  $zip.Dispose()
}
"Wrote $out"
