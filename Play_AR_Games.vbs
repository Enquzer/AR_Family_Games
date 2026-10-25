' ==============================================================================
' AR FAMILY GAMES - SINGLE-WINDOW ZERO-POPOUT LAUNCHER
' Closes any previously running instances and starts a fresh game session.
' ==============================================================================
Option Explicit

Dim WshShell, fso, currentDir, chromePath, edgePath, browserCmd, httpReq, attempts, serverReady, flags

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' 1. Terminate any previously running instances so we always start completely fresh
On Error Resume Next
Set httpReq = CreateObject("MSXML2.ServerXMLHTTP.6.0")
httpReq.Open "GET", "http://localhost:3000/api/shutdown", False
httpReq.setTimeouts 400, 400, 400, 400
httpReq.Send
On Error GoTo 0
WScript.Sleep 250

' Guarantee port 3000 is freed by closing any lingering node processes
WshShell.Run "taskkill /f /im node.exe", 0, True
WScript.Sleep 600

' 2. Start a fresh Node server in the background (0 = hidden, no console popouts)
WshShell.CurrentDirectory = currentDir
WshShell.Run "node """ & currentDir & "\server\index.js""", 0, False

' 3. Wait up to 10 seconds for the fresh server to confirm it is fully online
serverReady = False
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

If Not serverReady Then
    MsgBox "Server failed to start on port 3000." & vbCrLf & _
           "Please check that Node.js is installed and port 3000 is available.", vbCritical, "AR Family Games"
    WScript.Quit 1
End If

' 4. Select best available browser in dedicated standalone App Mode with camera permissions enabled
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

' 5. Launch the clean game window
WshShell.Run browserCmd, 1, False
