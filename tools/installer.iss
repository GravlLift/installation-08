; installer.iss — the Windows installer for Installation 08 (Inno Setup 6).
;
; Compiled by tools\package.ps1 -Installer with two defines:
;
;   /DVersion=<version>      the release version (the AppVersion)
;   /DPackageDir=<folder>    the release folder to install (the exe, LICENSE,
;                            NOTICE.md, README.md, tools, third_party)
;
; The install is per-user (no administrator prompt) into
; {localappdata}\Programs\Installation 08. The uninstaller removes the
; installed files only; the user's data folder
; (%LOCALAPPDATA%\infinite-theater-3d) is never touched.

#define MyAppName "Installation 08"
#define MyAppPublisher "llampwall"
#define MyAppURL "https://github.com/llampwall/infinite-theater-3d"
#define MyAppExeName "installation-08.exe"
; Fixed for all versions of this installer: updates are detected by this id, not by the
; folder name.
#define MyAppId "{{9B6C1F2E-4D7A-4E3B-9C58-2A0D6E7F4C11}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#Version}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\Installation 08
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
LicenseFile={#PackageDir}\LICENSE
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=installation-08-{#Version}-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[InstallDelete]
; The exe was infinite-theater-3d.exe before the rename; an upgrade removes it.
Type: files; Name: "{app}\infinite-theater-3d.exe"

[Files]
Source: "{#PackageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{app}\unins000.exe"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
