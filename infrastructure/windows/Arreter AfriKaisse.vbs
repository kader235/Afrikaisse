' Arrête le serveur AfriKaisse (utilisé par la mise à jour et la désinstallation).
Set shell = CreateObject("WScript.Shell")
dossier = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & dossier & "\runtime\node\node.exe"" """ & dossier & "\lanceur\arreter.cjs""", 0, True
