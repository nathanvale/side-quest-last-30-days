#!/usr/bin/env bash
set -euo pipefail

PR_NUMBER="${1:-}"
REPO="${2:-}"

if [ -z "${PR_NUMBER}" ]; then
	echo "Usage: scripts/pr-blockers.sh <pr-number> [owner/repo]" >&2
	exit 1
fi

if [ -z "${REPO}" ]; then
	REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi

OWNER="${REPO%/*}"
NAME="${REPO#*/}"

PR_JSON="$(gh pr view "${PR_NUMBER}" --repo "${REPO}" --json url,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup)"
THREAD_JSON="$(
	gh api graphql \
		-f query='query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){reviewThreads(first:100){nodes{isResolved isOutdated comments(first:20){nodes{author{login}}}}}}}}' \
		-F owner="${OWNER}" \
		-F repo="${NAME}" \
		-F pr="${PR_NUMBER}"
)"

echo "PR: $(echo "${PR_JSON}" | jq -r '.url')"
echo "Draft: $(echo "${PR_JSON}" | jq -r '.isDraft')"
echo "Review decision: $(echo "${PR_JSON}" | jq -r '.reviewDecision // "NONE"')"
echo "Merge state: $(echo "${PR_JSON}" | jq -r '.mergeStateStatus')"
echo "CodeRabbit check: $(
	echo "${PR_JSON}" | jq -r '
		[
			.statusCheckRollup[]?
			| select(
				(.__typename == "CheckRun" and .name == "CodeRabbit")
				or
				(.__typename == "StatusContext" and .context == "CodeRabbit")
			)
		]
		| last
		| if . == null then "missing"
		  elif .__typename == "CheckRun" then (.status + "/" + (.conclusion // ""))
		  else (.state // "unknown")
		  end
	'
)"
echo "CodeRabbit unresolved threads: $(
	echo "${THREAD_JSON}" | jq -r '
		[
			.data.repository.pullRequest.reviewThreads.nodes[]
			| select(
				any(
					.comments.nodes[];
					.author.login | test("^coderabbitai(\\[bot\\])?$")
				)
			)
		] as $threads
		| ($threads | map(select(.isResolved == false)) | length) as $u
		| ($threads | map(select(.isResolved == false and .isOutdated == false)) | length) as $a
		| ($threads | map(select(.isResolved == false and .isOutdated == true)) | length) as $o
		| "total=\($u) active=\($a) outdated=\($o)"
	'
)"
