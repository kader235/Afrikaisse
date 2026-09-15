; ============================================================================
;  AfriKaisse — Logiciel du restaurant (Windows)
;
;  Un seul AfriKaisse-Setup.exe : Node embarqué, serveur, application web, superviseur,
;  console Electron (si construite), lanceur navigateur de repli.
;  Aucune base de données à installer (SQLite intégré à Node) ni module natif.
;
;   - Programme -> C:\Program Files\AfriKaisse   (non modifiable sans administrateur)
;   - Données   -> C:\ProgramData\AfriKaisse     (base, journaux, sauvegardes ; conservées à la désinstallation)
;   - Serveur   -> tâche planifiée « AfriKaisse\Serveur », compte Service local, au démarrage de Windows
;                  (lanceur\tache.cjs ; choix expliqué dans docs/DESKTOP.md, ADR-007)
;
;  Construit par : node infrastructure/windows/build.mjs [--console]
; ============================================================================

#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#define AppName "AfriKaisse"
#define AppPublisher "GLOBALTECH BUSINESS TD"
#define TaskName "AfriKaisse\Serveur"
#define ConsoleAppId "GlobalTech.AfriKaisse.Console"
; Console présente dans la charge : raccourcis vers elle. Absente : raccourcis vers le navigateur.
#if FileExists(AddBackslash(SourcePath) + "charge\console\AfriKaisse.exe")
  #define WithConsole
#endif

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

[Dirs]
; Utilisateurs : lecture du fichier de port et des journaux, sauvegarde depuis la console.
; Le Service local (compte du serveur) reçoit ses droits par lanceur\tache.cjs (icacls) : Inno Setup n'a pas de SID « localservice ».
Name: "{commonappdata}\{#AppName}"; Permissions: users-modify; Flags: uninsneveruninstall

[InstallDelete]
; Phase 11 : démarrage à l'ouverture de session, remplacé par la tâche planifiée (recréé seulement en repli).
Type: files; Name: "{commonstartup}\{#AppName} (serveur).lnk"

[Files]
Source: "charge\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
#ifdef WithConsole
Name: "{group}\{#AppName}"; Filename: "{app}\console\AfriKaisse.exe"; WorkingDir: "{app}\console"; IconFilename: "{app}\afrikaisse.ico"; AppUserModelID: "{#ConsoleAppId}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\console\AfriKaisse.exe"; WorkingDir: "{app}\console"; IconFilename: "{app}\afrikaisse.ico"; AppUserModelID: "{#ConsoleAppId}"; Tasks: desktopicon
Name: "{group}\Appairer une tablette"; Filename: "{app}\console\AfriKaisse.exe"; Parameters: "--appairage"; WorkingDir: "{app}\console"; IconFilename: "{app}\afrikaisse.ico"; AppUserModelID: "{#ConsoleAppId}"
Name: "{group}\{#AppName} dans le navigateur"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\AfriKaisse.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\afrikaisse.ico"
#else
Name: "{group}\{#AppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\AfriKaisse.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\afrikaisse.ico"
Name: "{autodesktop}\{#AppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\AfriKaisse.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\afrikaisse.ico"; Tasks: desktopicon
#endif
Name: "{group}\Désinstaller {#AppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\pare-feu.ps1"" -Programme ""{app}\runtime\node\node.exe"""; Flags: runhidden waituntilterminated; StatusMsg: "Ouverture du réseau du restaurant aux tablettes…"
#ifdef WithConsole
; Lancée sous le compte de la personne qui installe (pas l'administrateur) : icône, caisse, démarrage avec sa session.
Filename: "{app}\console\AfriKaisse.exe"; WorkingDir: "{app}\console"; Description: "Ouvrir {#AppName}"; Flags: nowait postinstall skipifsilent runasoriginaluser
#else
Filename: "{sys}\wscript.exe"; Parameters: """{app}\AfriKaisse.vbs"""; Description: "Ouvrir {#AppName}"; Flags: nowait postinstall skipifsilent runasoriginaluser
#endif

[UninstallRun]
; Consoles ouvertes (tous comptes) : sinon leurs fichiers restent verrouillés dans Program Files.
Filename: "{sys}\taskkill.exe"; Parameters: "/IM AfriKaisse.exe /T /F"; Flags: runhidden waituntilterminated; RunOnceId: "FermerConsole"
; Tâche planifiée supprimée, superviseur et serveur arrêtés. Les données restent.
Filename: "{app}\runtime\node\node.exe"; Parameters: """{app}\lanceur\tache.cjs"" desinstaller"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "TacheAfriKaisse"
Filename: "{sys}\wscript.exe"; Parameters: """{app}\Arreter AfriKaisse.vbs"""; Flags: runhidden waituntilterminated; RunOnceId: "ArreterAfriKaisse"
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\pare-feu.ps1"" -Retirer"; Flags: runhidden waituntilterminated; RunOnceId: "PareFeuAfriKaisse"

[UninstallDelete]
Type: files; Name: "{commonstartup}\{#AppName} (serveur).lnk"

[Code]
var
  TacheSuspendue: Boolean;
  TacheEnregistree: Boolean;

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

function Schtasks(const Parametres: String): Integer;
var
  Code: Integer;
begin
  if Exec(ExpandConstant('{sys}\schtasks.exe'), Parametres, '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Result := Code
  else
    Result := -1;
end;

{ Copie de la base, serveur arrêté, AVANT de remplacer le programme (§73).
  Le serveur fait déjà une copie au démarrage avant ses migrations, mais celle-ci sort de la rotation
  horaire au bout d'un jour : pour revenir à l'ancienne version plusieurs jours après, il faut la base
  d'avant la mise à jour. Une seule copie, remplacée à chaque mise à jour, hors de la rotation.
  Échec de la copie : installation annulée, rien n'est modifié. }
function SauvegarderAvantMiseAJour: String;
var
  Donnees, Dossier: String;
begin
  Result := '';
  Donnees := ExpandConstant('{commonappdata}\AfriKaisse');
  if not FileExists(Donnees + '\afrikaisse.sqlite') then Exit;
  Dossier := Donnees + '\sauvegardes\avant-mise-a-jour';
  WizardForm.StatusLabel.Caption := 'Sauvegarde des données avant la mise à jour…';
  if not ForceDirectories(Dossier) then
  begin
    Result := 'Sauvegarde avant mise à jour impossible (dossier ' + Dossier + '). Installation annulée : rien n''a été modifié.';
    Exit;
  end;
  DeleteFile(Dossier + '\afrikaisse.sqlite-wal');
  DeleteFile(Dossier + '\afrikaisse.sqlite-shm');
  if not CopyFile(Donnees + '\afrikaisse.sqlite', Dossier + '\afrikaisse.sqlite', False) then
  begin
    Result := 'Sauvegarde avant mise à jour impossible (copie de la base). Installation annulée : rien n''a été modifié.';
    Exit;
  end;
  { Serveur arrêté brutalement : les dernières écritures peuvent être dans le journal WAL, copié avec la base. }
  if FileExists(Donnees + '\afrikaisse.sqlite-wal') then
    if not CopyFile(Donnees + '\afrikaisse.sqlite-wal', Dossier + '\afrikaisse.sqlite-wal', False) then
      Result := 'Sauvegarde avant mise à jour impossible (journal de la base). Installation annulée : rien n''a été modifié.';
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Arret: String;
  Code: Integer;
begin
  Result := '';
  { Version avec tâche planifiée : l'arrêt la désactive ; DeinitializeSetup la réactive si l'on n'arrive pas au bout. }
  TacheSuspendue := Schtasks('/Query /TN "{#TaskName}"') = 0;
  Arret := ExpandConstant('{app}\Arreter AfriKaisse.vbs');
  if FileExists(Arret) then
  begin
    WizardForm.StatusLabel.Caption := 'Arrêt d''AfriKaisse avant la mise à jour…';
    Exec('wscript.exe', '"' + Arret + '"', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Sleep(1500);
  end;
  Result := SauvegarderAvantMiseAJour;
end;

{ Serveur au démarrage de Windows, sans session ouverte (lanceur\tache.cjs : droits du Service local,
  tâche planifiée, lancement immédiat). Refus : repli sur le démarrage à l'ouverture de session (phase 11). }
procedure EnregistrerServeur;
var
  Code: Integer;
begin
  WizardForm.StatusLabel.Caption := 'Démarrage automatique du serveur AfriKaisse…';
  if Exec(ExpandConstant('{app}\runtime\node\node.exe'), '"' + ExpandConstant('{app}\lanceur\tache.cjs') + '" installer',
      ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0) then
  begin
    TacheEnregistree := True;
    Exit;
  end;
  CreateShellLink(ExpandConstant('{commonstartup}\AfriKaisse (serveur).lnk'), 'Serveur AfriKaisse',
    ExpandConstant('{sys}\wscript.exe'), '"' + ExpandConstant('{app}\AfriKaisse.vbs') + '" --silencieux',
    ExpandConstant('{app}'), ExpandConstant('{app}\afrikaisse.ico'), 0, SW_SHOWNORMAL);
  SuppressibleMsgBox(
    'Le démarrage du serveur avec Windows n''a pas pu être enregistré.' #13#10 #13#10 +
    'AfriKaisse démarrera à l''ouverture de session. Détail : ' +
    ExpandConstant('{commonappdata}\AfriKaisse\journaux\installation.log'),
    mbInformation, MB_OK, IDOK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then EnregistrerServeur;
end;

procedure DeinitializeSetup;
begin
  { Mise à jour annulée après l'arrêt du serveur : l'ancienne version repart. }
  if TacheSuspendue and not TacheEnregistree then
  begin
    Schtasks('/Change /TN "{#TaskName}" /ENABLE');
    Schtasks('/Run /TN "{#TaskName}"');
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  { Démarrage de la console avec la session (entrée écrite par Electron sous le nom de son AppUserModelId). }
  if CurUninstallStep = usPostUninstall then
    RegDeleteValue(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\Run', '{#ConsoleAppId}');
end;
