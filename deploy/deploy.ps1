# Deploys the committed code to your server and runs setup.sh there. From the repo folder:
#
#   .\deploy\deploy.ps1 -Server ubuntu@203.0.113.7 -Key C:\path\to\ssh-key.key [-Domain your.domain]
#
# Uses the ssh and scp that ship with Windows. Run it again whenever you want to update.
param(
  [Parameter(Mandatory)][string]$Server,
  [string]$Key,
  [string]$Domain = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$tarball = Join-Path $env:TEMP 'domus.tar.gz'

git -C $root archive --format=tar.gz -o $tarball HEAD
$sshArgs = @()
if ($Key) { $sshArgs = @('-i', $Key) }

scp @sshArgs $tarball (Join-Path $root 'deploy\setup.sh') "${Server}:"
ssh @sshArgs -t $Server "sudo bash setup.sh $Domain"
