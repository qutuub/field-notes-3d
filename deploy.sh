#!/usr/bin/env bash
# Build and publish dist/ to the gh-pages branch of qutuub/field-notes-3d.
set -euo pipefail
cd "$(dirname "$0")"
npm run build
d=$(mktemp -d); cp -r dist/. "$d"/; touch "$d/.nojekyll"
cd "$d"; git init -q -b gh-pages; git add -A; git commit -qm "Deploy build"
git remote add origin https://github.com/qutuub/field-notes-3d.git
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push -f origin gh-pages
