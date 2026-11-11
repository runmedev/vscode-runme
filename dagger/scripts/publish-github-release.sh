#!/usr/bin/env bash

set -euo pipefail

: "${RELEASE_CHANNEL:?release channel is required}"
: "${RELEASE_REPOSITORY:?release repository is required}"
: "${RELEASE_TAG:?release tag is required}"

release_dir=/tmp/release
shopt -s nullglob
artifacts=("${release_dir}"/*.vsix)
if (( ${#artifacts[@]} == 0 )); then
  echo "No VSIX artifacts found in ${release_dir}" >&2
  exit 1
fi

expected_prerelease=false
prerelease_args=()
if [[ "${RELEASE_CHANNEL}" == edge ]]; then
  expected_prerelease=true
  prerelease_args+=(--prerelease)
fi

if ! gh release view "${RELEASE_TAG}" --repo "${RELEASE_REPOSITORY}" >/dev/null 2>&1; then
  gh release create "${RELEASE_TAG}" "${artifacts[@]}" \
    --repo "${RELEASE_REPOSITORY}" \
    --title "${RELEASE_TAG}" \
    --generate-notes \
    --verify-tag \
    "${prerelease_args[@]}"
  exit 0
fi

actual_prerelease=$(gh release view "${RELEASE_TAG}" \
  --repo "${RELEASE_REPOSITORY}" \
  --json isPrerelease \
  --jq .isPrerelease)
if [[ "${actual_prerelease}" != "${expected_prerelease}" ]]; then
  echo "Existing GitHub Release channel does not match ${RELEASE_CHANNEL}" >&2
  exit 1
fi

download_dir=$(mktemp -d /tmp/runme-release-assets.XXXXXX)
trap 'rm -rf "${download_dir}"' EXIT

for artifact in "${artifacts[@]}"; do
  name=$(basename "${artifact}")
  if gh release download "${RELEASE_TAG}" \
    --repo "${RELEASE_REPOSITORY}" \
    --pattern "${name}" \
    --dir "${download_dir}" >/dev/null 2>&1; then
    if ! cmp --silent "${artifact}" "${download_dir}/${name}"; then
      echo "Existing GitHub Release asset ${name} differs from the rebuilt artifact" >&2
      exit 1
    fi
    echo "GitHub Release asset ${name} already matches"
  else
    gh release upload "${RELEASE_TAG}" "${artifact}" --repo "${RELEASE_REPOSITORY}"
  fi
done
