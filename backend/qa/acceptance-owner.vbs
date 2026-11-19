' Read one command line through built-in WMI when WMIC is absent. Never print it.
If WScript.Arguments.Count <> 1 Then WScript.Quit 1
pid = CLng(WScript.Arguments(0))
Set rows = GetObject("winmgmts:\\.\root\cimv2").ExecQuery("SELECT CommandLine FROM Win32_Process WHERE ProcessId=" & pid)
For Each row In rows
  If Not IsNull(row.CommandLine) Then
    command = Replace(LCase(row.CommandLine), "\", "/")
    If InStr(command, "qa/phase7-live.ts") > 0 Then
      WScript.Echo "OWNED"
      WScript.Quit 0
    End If
  End If
Next
WScript.Echo "UNKNOWN"
