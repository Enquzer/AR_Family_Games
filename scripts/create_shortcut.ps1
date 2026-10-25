$WshShell = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath('Desktop')

$shortcutPath = Join-Path $desktop "AR Family Games.lnk"
$shortcut = $WshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"d:\my_codes\AR_Family_Games\Play_AR_Games.vbs`""
$shortcut.WorkingDirectory = "d:\my_codes\AR_Family_Games"
$shortcut.IconLocation = "d:\my_codes\AR_Family_Games\app_icon.ico"
$shortcut.Description = "AR Family Games - Camera-Driven Kinetic Sports & Dance Arena"
$shortcut.Save()

$localShortcutPath = "d:\my_codes\AR_Family_Games\AR Family Games.lnk"
$localShortcut = $WshShell.CreateShortcut($localShortcutPath)
$localShortcut.TargetPath = "wscript.exe"
$localShortcut.Arguments = "`"d:\my_codes\AR_Family_Games\Play_AR_Games.vbs`""
$localShortcut.WorkingDirectory = "d:\my_codes\AR_Family_Games"
$localShortcut.IconLocation = "d:\my_codes\AR_Family_Games\app_icon.ico"
$localShortcut.Description = "AR Family Games - Camera-Driven Kinetic Sports & Dance Arena"
$localShortcut.Save()

Write-Output "Shortcuts created on Desktop and in project directory."
