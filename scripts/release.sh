#!/usr/bin/env bash
set -e

BUMP=${1:-patch}

# Validate bump type
if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Usage: npm run release [-- patch|minor|major]"
  exit 1
fi

# Ensure clean working tree (only allow if nothing unstaged other than what we'll touch)
if ! git diff --quiet -- ':!package.json' ':!package-lock.json'; then
  echo "Error: uncommitted changes found. Commit or stash them first."
  git diff --name-only -- ':!package.json' ':!package-lock.json'
  exit 1
fi

echo "Bumping $BUMP version..."
npm version "$BUMP" --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")

echo "Building..."
npm run build

echo "Packaging VSIX..."
vsce package --out vsix/

echo "Committing v$VERSION..."
git add -u
git commit -m "chore: bump version to $VERSION"

echo "Pushing..."
git push origin main

echo ""
echo "Released v$VERSION — vsix/pikr-$VERSION.vsix"
