#!/bin/bash
# Double-click to start the Mac side (rebuilds first if the source changed).
cd "$(dirname "$0")"
if [ ! -x usbc-display ] || [ usbc-display.m -nt usbc-display ]; then bash build.sh || exit 1; fi
./usbc-display "$@" 2>&1 | tee usbc-display.log
