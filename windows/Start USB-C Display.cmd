@echo off
rem Starts the Windows side of USB-C Display. Press Esc on the laptop to stop.
set "DOTNET_ROOT=%USERPROFILE%\.dotnet-sdk"
"%~dp0app\UsbcDisplay.exe" %*
