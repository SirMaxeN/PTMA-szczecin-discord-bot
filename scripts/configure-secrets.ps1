$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$privateDirectory = Join-Path $projectRoot 'data'
New-Item -ItemType Directory -Path $privateDirectory -Force | Out-Null
$destination = Join-Path $privateDirectory 'secrets.json'
$settings = @{}
if (Test-Path -LiteralPath $destination) {
    $stored = Get-Content -LiteralPath $destination -Raw | ConvertFrom-Json
    foreach ($property in $stored.PSObject.Properties) { $settings[$property.Name] = $property.Value }
}
Write-Host 'Forum Bot - private configuration'
Write-Host 'Press Enter to preserve an existing value. Secrets are never displayed.'
foreach ($field in @('FORUM_USERNAME', 'FORUM_PASSWORD', 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID')) {
    $secureValue = Read-Host $field -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try {
        $plainValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        if ($plainValue.Length -gt 0) { $settings[$field] = $plainValue }
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $plainValue = $null }
}
$settings | ConvertTo-Json | Set-Content -LiteralPath $destination -Encoding UTF8
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $destination /inheritance:r /grant:r "${identity}:(F)" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict private configuration permissions.' }
Write-Host 'Private configuration saved. You may close this window.'
Read-Host 'Press Enter to close'
