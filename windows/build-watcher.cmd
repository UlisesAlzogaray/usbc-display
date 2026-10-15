@echo off
rem Builds app\UsbcWatcher.exe with the .NET Framework compiler that ships with Windows.
setlocal
set "CSC=%WINDIR%\Microsoft.NET\FrameworkArm64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
cd /d "%~dp0"
"%CSC%" /nologo /target:winexe /optimize+ /out:app\UsbcWatcher.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll watcher\UsbcWatcher.cs
