$proj   = 'C:\Users\nkaus\Desktop\Project\Projects\conference_notifications'
$node   = (Get-Command node).Source
$script = $proj + '\dist\scheduler.js'
$name   = 'TechDigestMCP-Scheduler'

Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue

$action    = New-ScheduledTaskAction -Execute $node -Argument $script -WorkingDirectory $proj
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERDOMAIN\$env:USERNAME
$settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Days 365) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

$task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if ($task) {
    Write-Host ""
    Write-Host "Task registered: $name" -ForegroundColor Green
    Write-Host "Runs as : $env:USERDOMAIN\$env:USERNAME"
    Write-Host "Node    : $node"
    Write-Host "Script  : $script"
    Write-Host ""
    try {
        Start-ScheduledTask -TaskName $name -ErrorAction Stop
        Write-Host "Scheduler started now." -ForegroundColor Green
    } catch {
        Write-Host "Registered OK — auto-starts on next login." -ForegroundColor Yellow
        Write-Host "Start manually now:" -ForegroundColor Yellow
        Write-Host "  node dist\scheduler.js" -ForegroundColor Cyan
    }
    Write-Host "State: $((Get-ScheduledTask -TaskName $name).State)"
} else {
    Write-Host "Registration failed." -ForegroundColor Red
}
