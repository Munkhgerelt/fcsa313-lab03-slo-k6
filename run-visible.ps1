param([ValidateSet('pass','chaos','fail')][string]$Mode)
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "F.CSA313 Lab3 - $Mode"
& node .\run-lab.cjs $Mode
$RunExitCode = $LASTEXITCODE
Write-Host "Native runner exit code: $RunExitCode"
# -NoExit keeps the original execution visible for a genuine screenshot.
