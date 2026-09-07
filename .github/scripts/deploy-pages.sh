#!/usr/bin/env bash
# ===========================================================================
# Publish to the gh-pages branch.
#
# One branch holds two things that must not tread on each other:
#
#   /                     the production site, deployed from main
#   /pr-preview/pr-<n>/   one live copy per open pull request
#
# So neither deploy may simply wipe the branch and write its own files. The
# production deploy clears the root but steps around pr-preview/; a preview
# deploy touches only its own directory. That is the whole reason this is a
# script rather than two calls to an off-the-shelf publish action: the
# "clean everything except..." rule is the part that goes wrong, and it is
# worth being able to read it.
#
# It is also why there are no third-party actions in the workflows. This
# repository publishes a site that gives artists numbers they plan a season
# around, and the deploy path is not somewhere to add dependencies whose
# release tags can move under you.
#
# Usage:
#   deploy-pages.sh site                 publish the repo to the branch root
#   deploy-pages.sh preview <pr-number>  publish it to pr-preview/pr-<n>/
#   deploy-pages.sh remove <pr-number>   delete pr-preview/pr-<n>/
#
# Expects, in the environment:
#   GITHUB_TOKEN        a token with contents:write on this repository
#   GITHUB_REPOSITORY   owner/repo, which Actions sets for you
#
# Run it from the root of a checkout of the branch you want to publish.
# ===========================================================================
set -euo pipefail

MODE="${1:?usage: deploy-pages.sh site|preview|remove [pr-number]}"
PR="${2:-}"

BRANCH="${PAGES_BRANCH:-gh-pages}"
UMBRELLA="pr-preview"
SOURCE="$(pwd)"

# What gets published is the COMMITTED tree, via `git archive` — not whatever
# happens to be sitting in the working directory. Two reasons, and the second
# is the important one:
#
#   - it is portable. `rsync` is not on every runner image, and `tar` is.
#   - it cannot publish an untracked file. A stray .env, a .dev.vars with the
#     Worker's session secret in it, a half-finished scratch file — none of
#     them can reach the site, because they are not in the commit. An exclude
#     list is a promise you have thought of everything; this is a guarantee.
#
# It also means the published site always corresponds exactly to a commit
# somebody can check out, which is what makes a preview URL worth trusting.

case "$MODE" in
  site) ;;
  preview|remove)
    [ -n "$PR" ] || { echo "::error::$MODE needs a pull request number"; exit 1; }
    # The PR number lands in a filesystem path, so it is checked rather than
    # trusted. Anything but digits is a bug or an attack, and both stop here.
    [[ "$PR" =~ ^[0-9]+$ ]] || { echo "::error::bad PR number: $PR"; exit 1; }
    ;;
  *) echo "::error::unknown mode: $MODE"; exit 1 ;;
esac

# PAGES_REMOTE lets the script be pointed at a local bare repository, which is
# how the clean-except-previews rule below gets exercised without pushing
# anything to GitHub. See .github/scripts/test-deploy-pages.sh.
if [ -n "${PAGES_REMOTE:-}" ]; then
  REMOTE="$PAGES_REMOTE"
else
  : "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
  : "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
  REMOTE="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
fi
# Each attempt clones the branch fresh, re-applies the change and pushes. If
# the push is rejected because somebody else landed a commit in between, the
# next attempt starts from what they landed rather than trying to replay onto
# it — a deploy branch is a published artifact, and rebuilding it from the
# current tip is both simpler and safer than rebasing a shallow clone.
WORK=""
cleanup() { [ -n "$WORK" ] && rm -rf "$WORK"; }
trap cleanup EXIT

# Unpack the committed tree into a directory. `git archive` writes a tar of
# exactly the tracked files at HEAD, so nothing untracked can leak through.
publish() {
  git -C "$SOURCE" rev-parse --verify HEAD >/dev/null 2>&1 || {
    echo "::error::$SOURCE is not a git checkout with a commit to publish"
    exit 1
  }
  git -C "$SOURCE" archive --format=tar HEAD | tar -x -C "$1"
}

attempt_deploy() {
  cleanup
  WORK="$(mktemp -d)"

  # --depth 1: the deploy branch's history is not interesting, and cloning it
  # in full gets slower every deploy.
  if git clone --quiet --depth 1 --branch "$BRANCH" "$REMOTE" "$WORK" 2>/dev/null; then
    :
  else
    echo "$BRANCH does not exist yet — starting it"
    git clone --quiet --depth 1 "$REMOTE" "$WORK"
    git -C "$WORK" checkout --quiet --orphan "$BRANCH"
    git -C "$WORK" rm -rqf . 2>/dev/null || true
  fi

  git -C "$WORK" config user.name "github-actions[bot]"
  git -C "$WORK" config user.email "41898282+github-actions[bot]@users.noreply.github.com"

  case "$MODE" in
    site)
      # Clear the root, keeping the previews. `find -maxdepth 1` rather than a
      # wildcard so dotfiles are included: a leftover dotfile at the root of a
      # deploy branch is exactly the kind of thing that survives for months.
      find "$WORK" -maxdepth 1 -mindepth 1 \
        ! -name '.git' ! -name "$UMBRELLA" -exec rm -rf {} +
      publish "$WORK"
      ;;
    preview)
      TARGET="$WORK/$UMBRELLA/pr-$PR"
      rm -rf "$TARGET"
      mkdir -p "$TARGET"
      publish "$TARGET"
      ;;
    remove)
      rm -rf "${WORK:?}/$UMBRELLA/pr-$PR"
      ;;
  esac

  # Serve the tree as-is. Without this GitHub runs the branch through Jekyll,
  # which silently drops anything whose name starts with an underscore.
  [ "$MODE" = "remove" ] || touch "$WORK/.nojekyll"

  git -C "$WORK" add --all
  if git -C "$WORK" diff --cached --quiet; then
    echo "nothing changed — not pushing"
    return 0
  fi

  case "$MODE" in
    site)    MESSAGE="Publish site from ${GITHUB_SHA:-local}" ;;
    preview) MESSAGE="Preview for PR #$PR from ${GITHUB_SHA:-local}" ;;
    remove)  MESSAGE="Remove preview for PR #$PR" ;;
  esac
  git -C "$WORK" commit --quiet -m "$MESSAGE"

  git -C "$WORK" push --quiet "$REMOTE" "HEAD:$BRANCH" 2>/dev/null
}

for attempt in 1 2 3 4 5; do
  if attempt_deploy; then
    echo "published to $BRANCH"
    exit 0
  fi
  echo "push rejected (attempt $attempt) — someone else landed first, starting over"
  sleep $((attempt * 3))
done

echo "::error::could not push to $BRANCH after 5 attempts"
exit 1
