#!/bin/sh
# Build the wallpaper agent, install it in ~/Applications with its own copy of the
# scenes, and start it now and at every login.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
project=$(dirname "$here")
label=com.chaselean.deskworlds
app="$HOME/Applications/Deskworlds.app"
agent="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"

if ! command -v swiftc >/dev/null; then
	echo "swiftc is missing. Install the Xcode command line tools: xcode-select --install" >&2
	exit 1
fi

build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
# Built for this machine's own architecture; the binary never leaves it.
swiftc -O -target "$(uname -m)-apple-macos13.0" -o "$build/Deskworlds" \
	"$here/Wallpaper.swift" -framework Cocoa -framework WebKit -framework IOKit

# Replace installations made under the project's earlier names.
launchctl bootout "$domain/com.chaselean.aquatica" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.chaselean.aquatica.plist"
rm -rf "$HOME/Applications/Aquatica.app"
habitats=com.chaselean.desktop-habitats
launchctl bootout "$domain/$habitats" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$habitats.plist"
rm -rf "$HOME/Applications/Desktop Habitats.app"
# Desktop Habitats' chosen scene and pause carry over, once; its preferences go after.
if world=$(defaults read "$habitats" habitat 2>/dev/null); then
	defaults write "$label" world "$world"
fi
# defaults reads a boolean back as 1 or 0 but only writes one as true or false.
if paused=$(defaults read "$habitats" paused 2>/dev/null); then
	if [ "$paused" = 1 ]; then paused=true; else paused=false; fi
	defaults write "$label" paused -bool "$paused"
fi
defaults delete "$habitats" 2>/dev/null || true

launchctl bootout "$domain/$label" 2>/dev/null || true

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/scene/scenes"
cp "$build/Deskworlds" "$app/Contents/MacOS/Deskworlds"
cp "$here/Info.plist" "$app/Contents/Info.plist"
cp "$here/AppIcon.icns" "$here/menubar.svg" "$app/Contents/Resources/"
# No trailing slash on the source: with one, cp copies the directory's contents.
for scene in "$project"/scenes/*; do
	cp -R "$scene" "$app/Contents/Resources/scene/scenes/"
done
cp -R "$project/vendor" "$project/ui" "$app/Contents/Resources/scene/"
rm -rf "$app"/Contents/Resources/scene/scenes/*/tests
codesign --force --sign - "$app" >/dev/null 2>&1 || true

mkdir -p "$(dirname "$agent")"
cat >"$agent" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$label</string>
	<key>ProgramArguments</key>
	<array>
		<string>$app/Contents/MacOS/Deskworlds</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>ProcessType</key>
	<string>Interactive</string>
	<key>StandardErrorPath</key>
	<string>/tmp/deskworlds.log</string>
</dict>
</plist>
PLIST

launchctl bootstrap "$domain" "$agent"
launchctl kickstart -k "$domain/$label"

# The desktop picture is left alone. macOS keeps one per Space and a script can only
# change the current one, so a still set here could never be fully undone.
echo "Deskworlds installed: $app"
