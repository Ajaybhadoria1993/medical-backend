#!/usr/bin/env sh
# Enforces branch naming convention: <type>/<kebab-case-description>
# Allowed types: feat, fix, refactor, chore, hotfix, release, docs, test, perf
# main/master/develop/staging are exempt.
#
# Usage: check-branch-name.sh [branch-name]
# If no branch name is given, the current git branch (git rev-parse --abbrev-ref HEAD) is used.
# In CI, pass the branch explicitly since checkouts are often in detached-HEAD state.

branch="${1:-$(git rev-parse --abbrev-ref HEAD)}"
allowed_regex="^(main|master|develop|staging)$|^(feat|fix|refactor|chore|hotfix|release|docs|test|perf)\/[a-z0-9._-]+$"

if ! echo "$branch" | grep -Eq "$allowed_regex"; then
  echo "Branch name '$branch' does not match the required naming convention."
  echo "  Allowed: main, master, develop, staging"
  echo "  Or:      <type>/<description>  (e.g. feat/appointment-reminders)"
  echo "  Types:   feat, fix, refactor, chore, hotfix, release, docs, test, perf"
  exit 1
fi
