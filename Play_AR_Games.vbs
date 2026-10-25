' ==============================================================================
' AR FAMILY GAMES - SINGLE-WINDOW ZERO-POPOUT LAUNCHER
' Launches the local server silently in the background and opens the game
' as a single standalone app window.
' ==============================================================================
Option Explicit

Dim WshShell, fso, currentDir, chromePath, edgePath, browserCmd, httpReq, attempts, serverReady, flags

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' 1. Check if server is already running on port 3000
serverReady = False
On Error Resume Next
Set httpReq = CreateObject("MSXML2.ServerXMLHTTP.6.0")
httpReq.Open "GET", "http://localhost:3000/api/info", False
httpReq.setTimeouts 500, 500, 500, 500
httpReq.Send
If Err.Number = 0 And httpReq.Status = 200 Then
    serverReady = True
End If
On Error GoTo 0

' 2. If not running, start node server in background
If Not serverReady Then
    WshShell.CurrentDirectory = currentDir
    WshShell.Run "cmd /c node server/index.js", 0, False

    ' Wait up to 10 seconds for the server to confirm it is fully online
    For attempts = 1 To 20
        WScript.Sleep 500
        On Error Resume Next
        Set httpReq = CreateObject("MSXML2.ServerXMLHTTP.6.0")
        httpReq.Open "GET", "http://localhost:3000/api/info", False
        httpReq.setTimeouts 500, 500, 500, 500
        httpReq.Send
        If Err.Number = 0 And httpReq.Status = 200 Then
            serverReady = True
            On Error GoTo 0
            Exit For
        End If
        On Error GoTo 0
    Next
End If

If Not serverReady Then
    MsgBox "Server failed to start on port 3000." & vbCrLf & _
           "Please check that Node.js is installed and port 3000 is available.", vbCritical, "AR Family Games"
    WScript.Quit 1
End If

' 3. Select best available browser in dedicated standalone App Mode with camera permissions enabled
chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

flags = " --app=http://localhost:3000/ --start-maximized --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required"

If fso.FileExists(edgePath) Then
    browserCmd = """" & edgePath & """" & flags
ElseIf fso.FileExists(chromePath) Then
    browserCmd = """" & chromePath & """" & flags
Else
    browserCmd = "cmd /c start http://localhost:3000/"
End If

' 4. Launch the game window (bWaitOnReturn = False so Node remains running and server stays online)
WshShell.Run browserCmd, 1, False
