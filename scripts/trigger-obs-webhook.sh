#!/usr/bin/env bash
# Fires the OBS SCM/CI workflow trigger for a stable release tag AFTER the
# GitHub Release exists. Invoked by the obs-trigger reusable workflow, which
# runs on needs: source-release in release.yml; that ordering (not a
# repo-level tag-push webhook) avoids the race where OBS would run before
# the release tarball is published.
#
# Provisioning contract (manual, one time; no accounts exist yet):
#   1. OBS account: create a workflow token (Profile > Manage Your Tokens, or
#      `osc token --create --operation workflow --scm-token <github PAT>`).
#      Record the token numerical ID and secret.
#   2. GitHub repo secret OBS_TOKEN with value "<token-id>:<token-secret>".
#   3. Repo variable OBS_TRIGGER_URL, default
#      https://build.opensuse.org/trigger/workflow. The documented webhook
#      Payload URL shape is <base>/trigger/workflow?id=<token-id> with the
#      token secret as webhook secret (OBS user guide, SCM/CI integration).
#   4. Do NOT add a repo-level GitHub webhook for tag pushes: delivery
#      happens solely here, after release creation. A repo webhook would
#      fire early (before the release asset exists) and double-trigger.
#   5. Recipe side (other unit): .obs/workflows.yml with a tag_push workflow
#      whose _service downloads the GitHub Release tarball for the pushed
#      tag; the service fails closed when the release asset is missing.
# Tag selection honesty: OBS documents no tag-name allowlist filter
# (branches filters explicitly exclude tag_push), so "stable only" rests on
# process (only maintainer vX.Y.Z tags are pushed) plus this job firing
# only after a GitHub Release was created for exactly the pushed tag.
#
# Inert: with OBS_TOKEN unset or empty, reports and exits 0 with no network.
# The token secret is never printed and never passed on a command line.
set -euo pipefail

usage() {
  printf 'usage: trigger-obs-webhook.sh --tag <vX.Y.Z> --sha <commit> --repo <owner/name> [--endpoint <url>]\n' >&2
}

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

TAG=""
SHA=""
REPO_SLUG=""
ENDPOINT="${OBS_TRIGGER_URL:-https://build.opensuse.org/trigger/workflow}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) [[ $# -ge 2 ]] || { usage; exit 1; }; TAG="$2"; shift 2 ;;
    --sha) [[ $# -ge 2 ]] || { usage; exit 1; }; SHA="$2"; shift 2 ;;
    --repo) [[ $# -ge 2 ]] || { usage; exit 1; }; REPO_SLUG="$2"; shift 2 ;;
    --endpoint) [[ $# -ge 2 ]] || { usage; exit 1; }; ENDPOINT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done
[[ -n "$TAG" && -n "$SHA" && -n "$REPO_SLUG" ]] || { usage; exit 1; }
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "tag must look like vX.Y.Z (got '$TAG')"
[[ "$SHA" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] || die "sha must be 40/64 lowercase hex"
[[ "$REPO_SLUG" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "repo must look like owner/name"

if [[ -z "${OBS_TOKEN:-}" ]]; then
  printf 'obs trigger: OBS_TOKEN is not configured; skipping delivery (inert).\n'
  exit 0
fi
TOKEN_ID="${OBS_TOKEN%%:*}"
TOKEN_SECRET="${OBS_TOKEN#*:}"
[[ -n "$TOKEN_ID" && -n "$TOKEN_SECRET" && "$TOKEN_ID" != "$OBS_TOKEN" ]] \
  || die "OBS_TOKEN must look like <token-id>:<token-secret>"
[[ "$TOKEN_ID" =~ ^[0-9]+$ ]] || die "OBS token id must be numeric"

for tool in curl python3; do
  command -v -- "$tool" >/dev/null 2>&1 || die "required tool '$tool' not found in PATH"
done

WORK="$(mktemp -d)"
cleanup() {
  if [[ -n "${WORK:-}" && -d "${WORK:-}" ]]; then
    rm -rf -- "$WORK"
  fi
}
trap cleanup EXIT

PAYLOAD="$WORK/payload.json"
python3 - --tag "$TAG" --sha "$SHA" --repo "$REPO_SLUG" --out "$PAYLOAD" <<'PYEOF'
import argparse, json
ap = argparse.ArgumentParser()
ap.add_argument("--tag"); ap.add_argument("--sha"); ap.add_argument("--repo"); ap.add_argument("--out")
a = ap.parse_args()
payload = {
    "ref": "refs/tags/" + a.tag,
    "before": "0000000000000000000000000000000000000000",
    "created": True,
    "head_commit": {"id": a.sha},
    "repository": {"full_name": a.repo},
}
with open(a.out, "w", encoding="utf-8") as f:
    json.dump(payload, f, separators=(",", ":"), sort_keys=True)
    f.write("\n")
PYEOF
[[ -s "$PAYLOAD" ]] || die "could not render webhook payload"

SIGNATURE="$(OBS_TOKEN_SECRET="$TOKEN_SECRET" python3 - --payload "$PAYLOAD" <<'PYEOF'
import argparse, hashlib, hmac, os
ap = argparse.ArgumentParser()
ap.add_argument("--payload")
a = ap.parse_args()
with open(a.payload, "rb") as f:
    body = f.read()
mac = hmac.new(os.environ["OBS_TOKEN_SECRET"].encode("utf-8"), body, hashlib.sha256).hexdigest()
print("sha256=" + mac)
PYEOF
)"
[[ "$SIGNATURE" =~ ^sha256=[0-9a-f]{64}$ ]] || die "could not sign webhook payload"

if [[ "$ENDPOINT" == *\?* ]]; then
  URL="$ENDPOINT&id=$TOKEN_ID"
else
  URL="$ENDPOINT?id=$TOKEN_ID"
fi

HTTP_CODE="$(curl --fail --silent --show-error -o /dev/null -w '%{http_code}' \
  -X POST --data-binary "@$PAYLOAD" \
  -H 'Content-Type: application/json' \
  -H 'X-GitHub-Event: push' \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  "$URL")" || die "webhook delivery to OBS failed"
printf 'obs trigger: delivered tag_push %s to OBS (HTTP %s).\n' "$TAG" "$HTTP_CODE"
