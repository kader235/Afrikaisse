; ============================================================================
;  AfriKaisse — Serveur du restaurant (Windows)
;
;  Un seul AfriKaisse-Setup.exe : Node embarqué, serveur, application web, lanceur.
;  Aucune base de données à installer (SQLite intégré à Node) ni module natif.
;
;   - Programme -> C:\Program Files\AfriKaisse   (non modifiable sans administrateur)
;   - Données   -> C:\ProgramData\AfriKaisse     (base, journaux ; conservées à la désinstallation)
;
;  Construit par : node infrastructure/windows/build.mjs
; ============================================================================

#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#define AppName "AfriKaisse"
#define AppPublisher "GLOBALTECH BUSINESS TD"

[Setup]
AppId={{B6F4C2D1-7A3E-4F0B-9C58-AF12CA55E001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\afrikaisse.ico
SetupIconFile=charge\afrikaisse.ico
OutputDir=sortie
OutputBaseFilename=AfriKaisse-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Node 24 exige Windows 10 1809 (build 17763) ou plus récent : refuser tôt, en le disant.
MinVersion=10.0.17763
; Mise à jour : AfriKaisse est arrêté avant la copie (PrepareToInstall), jamais de dossier à moitié écrit.
CloseApplications=force
RestartApplications=no

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
; Coché : le serveur est prêt quand les tablettes arrivent, même si personne n'a ouvert AfriKaisse.
Name: "demarrage"; Description: "Démarrer le serveur AfriKaisse à l'ouverture de session Windows (recommandé)"; GroupDescription: "Fonctionnement :"

[Dirs]
Name: "{commonappdata}\{#AppName}"; Permissions: users-modify; Flags: uninsneveruninstall

[Files]
Source: "charge\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\AfriKaisse.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\afrikaisse.ico"
Name: "{autodesktop}\{#AppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\AfriKaisse.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\afrikaisse.ico"; Tasks: desktopicon
Name: "{commonstartup}\{#AppName} (serveur)"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\AfriKaisse.vbs"" --silencieux"; WorkingDir: "{app}"; IconFilename: "{app}\afrikaisse.ico"; Tasks: demarrage
Name: "{group}\Désinstaller {#AppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\pare-feu.ps1"" -Programme ""{app}\runtime\node\node.exe"""; Flags: runhidden waituntilterminated; StatusMsg: "Ouverture du réseau du restaurant aux tablettes…"
Filename: "{sys}\wscript.exe"; Parameters: """{app}\AfriKaisse.vbs"""; Description: "Démarrer {#AppName} maintenant"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\Arreter AfriKaisse.vbs"""; Flags: runhidden waituntilterminated; RunOnceId: "ArreterAfriKaisse"
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\pare-feu.ps1"" -Retirer"; Flags: runhidden waituntilterminated; RunOnceId: "PareFeuAfriKaisse"

[Code]
function InitializeSetup: Boolean;
var
  Version: TWindowsVersion;
begin
  Result := True;
  GetWindowsVersionEx(Version);
  if (Version.Major < 10) or ((Version.Major = 10) and (Version.Build < 17763)) then
  begin
    MsgBox(
      'Ce poste ne peut pas accueillir AfriKaisse.' #13#10 #13#10 +
      'AfriKaisse a besoin de Windows 10 version 1809 (octobre 2018) ou plus récent.' #13#10 +
      'Ce poste est en version ' + IntToStr(Version.Major) + '.' + IntToStr(Version.Minor) +
      ' (build ' + IntToStr(Version.Build) + ').' #13#10 #13#10 +
      'Installez les mises à jour de Windows, ou utilisez un autre PC.' #13#10 +
      'Rien n''a été modifié sur cet ordinateur.',
      mbCriticalError, MB_OK);
    Result := False;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Arret: String;
  Code: Integer;
begin
  Result := '';
  Arret := ExpandConstant('{app}\Arreter AfriKaisse.vbs');
  if FileExists(Arret) then
  begin
    WizardForm.StatusLabel.Caption := 'Arrêt d''AfriKaisse avant la mise à jour…';
    Exec('wscript.exe', '"' + Arret + '"', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Sleep(1500);
  end;
end;
