#!/bin/bash
# Builds the Windows side on this Mac (or any machine with the .NET 8 SDK) and packs it into the
# one download, windows/setup/dist/USB-C Display Setup.exe:
#   1. the screen receiver, UsbcDisplay.exe (self-contained, so the laptop needs no .NET)
#   2. the tray watcher, UsbcWatcher.exe (.NET Framework 4.8, which ships with Windows)
#   3. the Mac app, mac/dist/USB-C-Display.zip, if mac/build.sh has made it
#   4. the setup app, with 1-3 inside
#
# usage: tools/build-windows.sh [arm64|x64]
#   APP_NOTARIZED=true   the Mac zip is notarized (the guide then shows the shorter first open);
#                        default: what mac/build.sh wrote to mac/dist/notarized.txt
#   DOTNET=/path/dotnet  which dotnet to use (default: ~/.dotnet/dotnet, then the one on PATH)
set -euo pipefail

ARCH="${1:-arm64}"
case "$ARCH" in arm64|x64) ;; *) echo "usage: $0 [arm64|x64]" >&2; exit 2 ;; esac
RID="win-$ARCH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SETUP="$ROOT/windows/setup"
BUILD="$SETUP/build/$RID"
PAYLOAD="$SETUP/payload"
DIST="$SETUP/dist"
[ "$ARCH" = x64 ] && DIST="$SETUP/dist/x64"
DOTNET="${DOTNET:-$HOME/.dotnet/dotnet}"
[ -x "$DOTNET" ] || DOTNET="$(command -v dotnet || true)"
[ -n "$DOTNET" ] || { echo "No dotnet found. Install the .NET 8 SDK or set DOTNET." >&2; exit 1; }
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

rm -rf "$BUILD" "$PAYLOAD"
mkdir -p "$BUILD" "$PAYLOAD" "$DIST"

echo "== 1/4 Receiver ($RID, self-contained)"
"$DOTNET" publish "$ROOT/windows/UsbcDisplay.csproj" -c Release -r "$RID" --self-contained true \
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true \
    -p:EnableWindowsTargeting=true -p:DebugType=embedded \
    -o "$BUILD/receiver" -nologo -v quiet
cp "$BUILD/receiver/UsbcDisplay.exe" "$PAYLOAD/"

echo "== 2/4 Watcher (.NET Framework 4.8)"
mkdir -p "$BUILD/watcher"
cat > "$BUILD/watcher/UsbcWatcher.csproj" <<EOF
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net48</TargetFramework>
    <LangVersion>5</LangVersion>
    <AssemblyName>UsbcWatcher</AssemblyName>
    <Prefer32Bit>false</Prefer32Bit>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <DebugType>none</DebugType>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="$ROOT/windows/watcher/UsbcWatcher.cs" />
    <Reference Include="System.Windows.Forms" />
    <Reference Include="System.Drawing" />
    <PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="1.0.3" PrivateAssets="all" />
  </ItemGroup>
</Project>
EOF
"$DOTNET" build "$BUILD/watcher/UsbcWatcher.csproj" -c Release -o "$BUILD/watcher/out" -nologo -v quiet
cp "$BUILD/watcher/out/UsbcWatcher.exe" "$PAYLOAD/"

echo "== 3/4 Mac app"
if [ -f "$ROOT/mac/dist/USB-C-Display.zip" ]; then
    cp "$ROOT/mac/dist/USB-C-Display.zip" "$PAYLOAD/"
    echo "   included mac/dist/USB-C-Display.zip"
    # The download page shows the same icon the Mac will show for the app.
    if [ -f "$ROOT/mac/dist/icon.png" ]; then cp "$ROOT/mac/dist/icon.png" "$SETUP/web/icon.png"; fi
else
    echo "   mac/dist/USB-C-Display.zip not found (run mac/build.sh on the Mac): the setup won't carry the Mac app"
fi
if [ ! -f "$SETUP/ui/index.html" ]; then
    echo "   windows/setup/ui/index.html not found: the setup will show a placeholder instead of its screens"
fi

NOTARIZED="${APP_NOTARIZED:-$(cat "$ROOT/mac/dist/notarized.txt" 2>/dev/null || echo false)}"
echo "   Mac app notarized: $NOTARIZED"

echo "== 4/4 Setup ($RID)"
"$DOTNET" publish "$SETUP/UsbcDisplaySetup.csproj" -c Release -p:SetupRid="$RID" \
    -p:AppNotarized="$NOTARIZED" -p:SetupBuild="$(date -u +%Y%m%d%H%M)" \
    -o "$BUILD/setup" -nologo -v quiet
cp "$BUILD/setup/USB-C Display Setup.exe" "$DIST/"

echo
ls -l "$PAYLOAD"
echo
ls -l "$DIST/USB-C Display Setup.exe"
