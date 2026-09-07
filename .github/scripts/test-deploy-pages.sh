#!/usr/bin/env bash
# ===========================================================================
# Exercise deploy-pages.sh against throwaway local repositories.
#
# The rule worth testing is the one that is easy to get wrong and expensive to
# get wrong: a production deploy clears the branch root but must leave every
# open pull request's preview standing, and a preview deploy must leave the
# production site standing. Get that backwards and either every open PR's
# preview 404s the next time main moves, or a preview takes the live site down.
#
# Nothing here touches GitHub — it clones this repository into a temp
# directory and pushes to a local bare repo standing in for origin. Run it
# before changing deploy-pages.sh:
#
#     bash .github/scripts/test-deploy-pages.sh
# ===========================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$HERE/deploy-pages.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

RIG="$(mktemp -d)"
trap 'rm -rf "$RIG"' EXIT

pass=0
fails=()
check() {
  if [ "$2" = "yes" ]; then pass=$((pass + 1)); echo "  PASS  $1"
  else fails+=("$1"); echo "  FAIL  $1${3:+  — $3}"; fi
}

# A bare repo standing in for origin. file:// rather than a plain path so that
# --depth behaves the way it will against GitHub rather than taking git's
# local-clone shortcut.
BARE="$RIG/origin.git"
git init --quiet --bare "$BARE"
# Point the bare repo's HEAD at main, the way a real GitHub repository is set
# up. Without this the deploy script's "branch does not exist yet" path clones
# what looks like an empty repository, which is not the case it will meet.
git --git-dir="$BARE" symbolic-ref HEAD refs/heads/main

# A clone of this repository to deploy FROM. Cloned rather than used in place
# so the test can commit throwaway files without touching your checkout.
SRC="$RIG/src"
git clone --quiet "$ROOT" "$SRC"
git -C "$SRC" config user.email test@example.com
git -C "$SRC" config user.name "deploy test"
git -C "$SRC" push --quiet "$BARE" HEAD:refs/heads/main 2>/dev/null

export PAGES_REMOTE="file://$BARE"
cd "$SRC"

# Read the deploy branch back out into a directory we can look at.
SNAP=""
snapshot() {
  rm -rf "$RIG/snap"
  git clone --quiet --branch gh-pages "file://$BARE" "$RIG/snap" 2>/dev/null || return 1
  SNAP="$RIG/snap"
}
have() { [ -e "$SNAP/$1" ] && echo yes || echo no; }
gone() { [ -e "$SNAP/$1" ] && echo no || echo yes; }

# ---- 1. the first production deploy --------------------------------------
bash "$DEPLOY" site >/dev/null
snapshot
check "the branch is created on the first deploy" "$([ -n "$SNAP" ] && echo yes || echo no)"
check "the tracker is published"                  "$(have tracker/browse.html)"
check "the root index is published"               "$(have index.html)"
check "a .nojekyll guard is written"              "$(have .nojekyll)"
check "no nested .git is copied in"               "$(gone tracker/.git)"

# ---- 2. two previews alongside it ----------------------------------------
bash "$DEPLOY" preview 1 >/dev/null
bash "$DEPLOY" preview 42 >/dev/null
snapshot
check "preview 1 publishes under its own directory" "$(have pr-preview/pr-1/tracker/browse.html)"
check "preview 42 publishes alongside it"           "$(have pr-preview/pr-42/tracker/browse.html)"
check "a preview deploy leaves production alone"    "$(have tracker/browse.html)"
check "a preview does not nest previews in itself"  "$(gone pr-preview/pr-1/pr-preview)"

# ---- 3. THE ONE THAT MATTERS ---------------------------------------------
# A production deploy clears the branch root. If it clears the previews too,
# every open PR's preview URL dies the next time main moves.
echo marker > "$SRC/deploy-test-marker.txt"
git -C "$SRC" add deploy-test-marker.txt
git -C "$SRC" commit --quiet -m "test marker"
bash "$DEPLOY" site >/dev/null
snapshot
check "a production deploy leaves open previews standing" \
      "$([ -e "$SNAP/pr-preview/pr-1/tracker/browse.html" ] &&
         [ -e "$SNAP/pr-preview/pr-42/tracker/browse.html" ] && echo yes || echo no)"
check "a production deploy republishes the root" "$(have deploy-test-marker.txt)"

# ---- 4. the root is cleared, not merged ----------------------------------
# A file that leaves the repository must leave the site, or deleting a page
# never actually unpublishes it.
git -C "$SRC" rm --quiet deploy-test-marker.txt
git -C "$SRC" commit --quiet -m "remove test marker"
bash "$DEPLOY" site >/dev/null
snapshot
check "a file removed from the repo leaves the site" "$(gone deploy-test-marker.txt)"

# ---- 5. only the committed tree is published -----------------------------
# An untracked file must not reach the site. This is the guard that stops a
# stray .env or a .dev.vars holding the Worker's session secret being served.
echo "SESSION_SECRET=hunter2" > "$SRC/.dev.vars"
echo "scratch" > "$SRC/untracked-scratch.txt"
bash "$DEPLOY" preview 7 >/dev/null
snapshot
check "an untracked secrets file is never published" "$(gone pr-preview/pr-7/.dev.vars)"
check "an untracked scratch file is never published" "$(gone pr-preview/pr-7/untracked-scratch.txt)"
rm -f "$SRC/.dev.vars" "$SRC/untracked-scratch.txt"

# ---- 6. teardown on close -------------------------------------------------
bash "$DEPLOY" remove 1 >/dev/null
snapshot
check "closing a PR removes its preview"          "$(gone pr-preview/pr-1)"
check "removing one preview leaves the others"    "$(have pr-preview/pr-42/tracker/browse.html)"
check "removing a preview leaves production alone" "$(have tracker/browse.html)"

# ---- 7. a PR number is not a path ----------------------------------------
if bash "$DEPLOY" preview '../../etc' >/dev/null 2>&1; then
  check "a non-numeric PR number is refused" no "it was accepted"
else
  check "a non-numeric PR number is refused" yes
fi

# ---- 8. a deploy that changes nothing -------------------------------------
BEFORE="$(git --git-dir="$BARE" rev-parse gh-pages)"
bash "$DEPLOY" site >/dev/null
AFTER="$(git --git-dir="$BARE" rev-parse gh-pages)"
check "an unchanged deploy adds no empty commit" \
      "$([ "$BEFORE" = "$AFTER" ] && echo yes || echo no)" "$BEFORE vs $AFTER"

echo
echo "$pass/$((pass + ${#fails[@]})) checks passed"
if [ ${#fails[@]} -gt 0 ]; then
  printf 'FAILED:\n'; printf '  - %s\n' "${fails[@]}"; exit 1
fi
