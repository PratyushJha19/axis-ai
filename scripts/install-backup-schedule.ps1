param([Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference='Stop'
# Operator-run only. This script is never called by application startup or tests.
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Provide the absolute path to node.exe.' }
$axisRoot=Split-Path -Parent $PSScriptRoot
$axisNode=[System.Security.SecurityElement]::Escape((Resolve-Path -LiteralPath $NodePath).Path)
$axisWork=[System.Security.SecurityElement]::Escape($axisRoot)
foreach ($axisOperation in @('create','restore-check','health')) {
  $axisCalendar=if ($axisOperation -eq 'restore-check') { '<ScheduleByMonth><DaysOfMonth><Day>1</Day></DaysOfMonth><Months><January/><February/><March/><April/><May/><June/><July/><August/><September/><October/><November/><December/></Months></ScheduleByMonth>' } else { '<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>' }
  $axisHour=if($axisOperation -eq 'create'){'02'}elseif($axisOperation -eq 'restore-check'){'03'}else{'04'}
  $axisXml=@"
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<Triggers><CalendarTrigger><StartBoundary>2026-10-20T${axisHour}:00:00</StartBoundary><Enabled>true</Enabled>$axisCalendar</CalendarTrigger></Triggers>
<Principals><Principal id="Operator"><UserId>S-1-5-18</UserId><LogonType>ServiceAccount</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><WakeToRun>true</WakeToRun><ExecutionTimeLimit>PT4H</ExecutionTimeLimit></Settings>
<Actions Context="Operator"><Exec><Command>$axisNode</Command><Arguments>--env-file=.env --import tsx scripts/backup.ts $axisOperation</Arguments><WorkingDirectory>$axisWork</WorkingDirectory></Exec></Actions>
</Task>
"@
  Register-ScheduledTask -TaskName "AXIS-Backup-$axisOperation" -Xml $axisXml -ErrorAction Stop | Out-Null
}
Write-Output 'Tasks registered. Run and verify each task before calling automation active. Configure an operator alert on failed Task Scheduler results.'
