Option Explicit

Dim shell, fileSystem, scriptDir, projectDir, nodePath, serverPath, command
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
projectDir = fileSystem.GetParentFolderName(scriptDir)
nodePath = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
serverPath = fileSystem.BuildPath(scriptDir, "office-server.mjs")

If Not fileSystem.FileExists(nodePath) Then nodePath = "node"
If Not fileSystem.FileExists(serverPath) Then WScript.Quit 1

If IsServerRunning(serverPath) Then WScript.Quit 0

command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & serverPath & Chr(34)

' Keep the localhost dashboard alive without creating a terminal window.
Do
  shell.CurrentDirectory = projectDir
  shell.Run command, 0, True
  WScript.Sleep 5000
Loop

Function IsServerRunning(targetPath)
  Dim service, processes, process
  IsServerRunning = False
  Set service = GetObject("winmgmts:\\.\root\cimv2")
  Set processes = service.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name = 'node.exe'")
  For Each process In processes
    If Not IsNull(process.CommandLine) Then
      If InStr(1, process.CommandLine, targetPath, vbTextCompare) > 0 Then
        IsServerRunning = True
        Exit Function
      End If
    End If
  Next
End Function
