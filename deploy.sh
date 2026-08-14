#!/bin/bash
# One-command deploy for devansh-ca.
# Usage: ./deploy.sh ["optional commit message"]
set -e
cd "$(dirname "$0")"

MSG="${1:-Update site $(date '+%Y-%m-%d %H:%M')}"

git add -A

if git diff --cached --quiet; then
  echo "Nothing to commit — working tree already matches the last commit."
else
  git commit -m "$MSG"
fi

git push origin main
echo "Done — pushed to GitHub."
