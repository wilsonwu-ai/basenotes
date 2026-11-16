#!/bin/zsh
# usage: shot.sh name  -> renders name.html at 1600 wide, full height, to ../name.png
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
N=$1; cd "$(dirname $0)"
H=$("$CH" --headless=new --disable-gpu --virtual-time-budget=4000 --window-size=1600,3000 --dump-dom file://$PWD/$N.html 2>/dev/null | grep -o 'data-h="[0-9]*"' | head -1 | tr -dc 0-9)
echo height $H
"$CH" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=4000 --window-size=1600,$H --screenshot=$PWD/../$N.png file://$PWD/$N.html 2>&1 | grep written
