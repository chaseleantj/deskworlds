#!/bin/sh
# Stop the wallpaper agent and remove it. The installer never changes the desktop picture,
# so the one underneath is still yours.
set -eu

label=com.chaselean.deskworlds
agent="$HOME/Library/LaunchAgents/$label.plist"

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
rm -f "$agent"
rm -rf "$HOME/Applications/Deskworlds.app"
echo "Deskworlds removed."
