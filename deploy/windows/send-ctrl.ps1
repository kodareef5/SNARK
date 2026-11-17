# Sends Ctrl+C, or a console close, to the console of another process, so that it stops as it does at a terminal. A SNARK
# server takes Ctrl+C (SIGINT) and a close (SIGHUP) alike: it saves its world and exits. Windows has no other way to ask a
# console program to stop: Stop-Process ends it at once, and a world loses what it did since its last save.
#
# It frees its own console to attach to the target's, so cluster.ps1 runs it in a powershell.exe of its own:
#   powershell -NoProfile -ExecutionPolicy Bypass -File send-ctrl.ps1 -TargetPid 1234 [-Mode close]
# The target must have a console of its own, as Start-Process gives every program it starts without -NoNewWindow;
# otherwise the event reaches every process on the console it shares. Exit code 0: sent; 2: no such console; 3, 4: not sent.
param([Parameter(Mandatory)][int]$TargetPid, [ValidateSet('ctrlc', 'close')][string]$Mode = 'ctrlc')
Add-Type -Namespace SnarkCluster -Name Console -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern bool FreeConsole();
[DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
[DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(System.IntPtr handler, bool add);
[DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint ctrlEvent, uint group);
[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();
[DllImport("user32.dll")]   public static extern bool PostMessage(System.IntPtr window, uint msg, System.IntPtr w, System.IntPtr l);
'@
[SnarkCluster.Console]::FreeConsole() | Out-Null
if (-not [SnarkCluster.Console]::AttachConsole([uint32]$TargetPid)) { exit 2 }
# This process is on that console now too: it ignores the Ctrl+C itself.
[SnarkCluster.Console]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
if ($Mode -eq 'ctrlc') {
  if (-not [SnarkCluster.Console]::GenerateConsoleCtrlEvent(0, 0)) { exit 3 }
} else {
  $window = [SnarkCluster.Console]::GetConsoleWindow()
  if ($window -eq [IntPtr]::Zero) { exit 4 }
  [SnarkCluster.Console]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null   # WM_CLOSE
}
exit 0
