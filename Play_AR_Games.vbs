' ==============================================================================
' AR FAMILY GAMES - SINGLE-WINDOW ZERO-POPOUT LAUNCHER
' Launches the local server silently in the background and opens the game
' as a single standalone app window. When you close the game, the server stops.
' ==============================================================================
Option Explicit

Dim WshShell, fso, currentDir, chromePath, edgePath, browserCmd, httpReq

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Check if node is installed
On Error Resume Next
WshShell.Run "node -v", 0, True
If Err.Number <> 0 Then
    MsgBox "Node.js was not found in your system PATH." & vbCrLf & _
           "Please install Node.js from https://nodejs.org to play AR Family Games.", vbCritical, "AR Family Games"
    WScript.Quit 1
End If
On Error GoTo 0

' 1. Start Node server completely hidden (0 = no console window)
WshShell.CurrentDirectory = currentDir
WshShell.Run "cmd /c node server/index.js", 0, False

' 2. Wait up to 5 seconds for the server to respond on port 3000
Dim attempts, serverReady
serverReady = False

For attempts = 1 To 10
    WScript.Sleep 500
    On Error Resume Next
    Set httpReq = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    httpReq.Open "GET", "http://localhost:3000/api/info", False
    httpReq.setTimeouts 500, 500, 500, 500
    httpReq.Send
    If Err.Number = 0 Then
        If httpReq.Status = 200 Then
            serverReady = True
            On Error GoTo 0
            Exit For
        End If
    End If
    On Error GoTo 0
Next

' 3. Select best available browser in dedicated standalone App Mode (no tabs, no URL bar)
chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

If fso.FileExists(chromePath) Then
    browserCmd = """" & chromePath & """ --app=http://localhost:3000/ --start-maximized"
ElseIf fso.FileExists(edgePath) Then
    browserCmd = """" & edgePath & """ --app=http://localhost:3000/ --start-maximized"
Else
    browserCmd = "cmd /c start http://localhost:3000/"
End If

' 4. Launch the game window and wait until the player closes it
WshShell.Run browserCmd, 1, True

' 5. Clean up: When the game window is closed, gracefully terminate server
On Error Resume Next
Set httpReq = CreateObject("MSXML2.ServerXMLHTTP.6.0")
httpReq.Open "GET", "http://localhost:3000/api/shutdown", False
httpReq.setTimeouts 500, 500, 500, 500
httpReq.Send
On Error GoTo 0
WScript.Sleep 400
WshShell.Run "taskkill /f /im node.exe", 0, True
