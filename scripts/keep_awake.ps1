Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinSleep {
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
    public static void KeepAwake() {
        // 0x80000000 (ES_CONTINUOUS) | 0x00000001 (ES_SYSTEM_REQUIRED) | 0x00000002 (ES_DISPLAY_REQUIRED)
        SetThreadExecutionState(0x80000003);
    }
}
"@
[WinSleep]::KeepAwake()
Write-Output "[power] Windows sleep and display-dimming prevented successfully."
