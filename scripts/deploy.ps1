$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$configurationPath = Join-Path $projectRoot '.deploy.psd1'
if (!(Test-Path -LiteralPath $configurationPath)) { throw 'Copy .deploy.example.psd1 to .deploy.psd1 and configure your host.' }
$deployment = Import-PowerShellDataFile -LiteralPath $configurationPath
foreach ($field in @('HostName', 'UserName', 'IdentityFile', 'RemoteRoot', 'ActivatePath', 'HealthUrl')) {
    if ([string]::IsNullOrWhiteSpace($deployment[$field])) { throw "Missing deployment field: $field" }
}
$sshOptions = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', '-o', 'IdentitiesOnly=yes', '-i', $deployment.IdentityFile)
$server = "$($deployment.UserName)@$($deployment.HostName)"
$remoteRoot = $deployment.RemoteRoot.TrimEnd('/')
$sshPort = [int]$deployment.Port
if ($sshPort -lt 1 -or $sshPort -gt 65535 -or $remoteRoot -notmatch '^/[a-zA-Z0-9_./-]+$' -or $deployment.ActivatePath -notmatch '^/[a-zA-Z0-9_./-]+$') { throw 'Invalid deployment port or path.' }
$release = 'release-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$artifactDirectory = Join-Path $projectRoot 'local-artifacts'
New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
$archive = Join-Path $artifactDirectory "$release.tar.gz"
& tar -czf $archive app.js startup.cjs package.json package-lock.json src scripts
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
& scp @sshOptions -P $sshPort $archive "${server}:${remoteRoot}/$release.tar.gz"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed.' }
$remoteScript = @'
set -e
ROOT=__ROOT__
test -d "$ROOT/app"
mkdir -p "$ROOT/backups"
chmod 700 "$ROOT/backups"
tar --exclude=node_modules --exclude=.env --exclude=tmp --exclude=logs -czf "$ROOT/backups/code-__RELEASE__.tar.gz" -C "$ROOT/app" .
tar -xzf "$ROOT/__RELEASE__.tar.gz" -C "$ROOT/app"
cd "$ROOT/app"
. __ACTIVATE__
npm ci --omit=dev --ignore-scripts
mkdir -p tmp
mkdir -p config
printf '{"release":"__RELEASE__"}' > config/release.json
node --input-type=module -e 'import fs from "node:fs"; fs.writeFileSync("tmp/reload-request.json",JSON.stringify({id:"__RELEASE__",action:"restart",expires:Date.now()+600000}),{mode:0o600});'
touch tmp/restart.txt
'@
$remoteScript = $remoteScript.Replace('__RELEASE__', $release).Replace('__ROOT__', $remoteRoot).Replace('__ACTIVATE__', $deployment.ActivatePath)
$remoteScript | & ssh @sshOptions -p $sshPort $server "tr -d '\r' | sh -s"
if ($LASTEXITCODE -ne 0) { throw 'Remote deployment failed.' }
Write-Host 'Source uploaded. Verify the exact running release before marking deployment complete.'
