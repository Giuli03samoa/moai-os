#!/bin/bash
# Builds MOAI OS.app (native window around http://localhost:3000) and installs it in ~/Applications.
set -euo pipefail
cd "$(dirname "$0")"
APP="$HOME/Applications/MOAI OS.app"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

swiftc -O -swift-version 5 -parse-as-library -target "$(uname -m)-apple-macos13.0" \
  -framework Cocoa -framework WebKit MOAIOS.swift -o "$BUILD/MOAI OS"

B="$BUILD/MOAI OS.app/Contents"
mkdir -p "$B/MacOS" "$B/Resources"
mv "$BUILD/MOAI OS" "$B/MacOS/MOAI OS"
cp AppIcon.icns "$B/Resources/AppIcon.icns"
cp ../public/brand/moai-icon-cream.png "$B/Resources/monogram.png"
VERSION="$(node -p "require('../package.json').version" 2>/dev/null || echo 1.0.0)"
cat > "$B/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>MOAI OS</string>
  <key>CFBundleDisplayName</key><string>MOAI OS</string>
  <key>CFBundleIdentifier</key><string>it.moaiathletics.os.desktop</string>
  <key>CFBundleExecutable</key><string>MOAI OS</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>$(date +%Y%m%d%H%M)</string>
  <key>CFBundleDevelopmentRegion</key><string>it</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.business</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>MOAI Athletics · Discipline over noise</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
codesign --force --deep --sign - "$BUILD/MOAI OS.app" >/dev/null 2>&1 || true

mkdir -p "$HOME/Applications"
if [ -d "$APP" ]; then osascript -e 'quit app "MOAI OS"' >/dev/null 2>&1 || true; sleep 1; rm -rf "$APP"; fi
mv "$BUILD/MOAI OS.app" "$APP"
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null 2>&1 || true
echo "Installata: $APP"
