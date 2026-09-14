' AfriKaisse : lance le serveur du restaurant sans fenêtre noire, puis ouvre l'application.
Set shell = CreateObject("WScript.Shell")
dossier = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
options = ""
If WScript.Arguments.Count > 0 Then options = " " & WScript.Arguments(0)
shell.Run """" & dossier & "\runtime\node\node.exe"" """ & dossier & "\lanceur\demarrer.cjs""" & options, 0, False
