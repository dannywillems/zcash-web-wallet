#!/bin/bash
# Verify that CHECKSUMS.json is updated in a dedicated commit
# Usage: verify-checksum-commit.sh <base_ref> <head_ref>
#
# Rules:
# 1. If checksummed files are modified, CHECKSUMS.json must also be updated
# 2. CHECKSUMS.json must be updated in its own commit (no other files)
#
# This ensures auditors can easily review code changes separately from
# checksum updates.

set -e

BASE_REF="${1:-origin/develop}"
HEAD_REF="${2:-HEAD}"

echo "Verifying CHECKSUMS.json is updated in dedicated commits..."
echo "Base: $BASE_REF"
echo "Head: $HEAD_REF"
echo ""

# Get all commits in the PR that modify CHECKSUMS.json
CHECKSUM_COMMITS=$(git log --format="%H" "$BASE_REF..$HEAD_REF" -- CHECKSUMS.json)

if [ -z "$CHECKSUM_COMMITS" ]; then
    echo "No commits modify CHECKSUMS.json"
    # Check if any checksummed files were modified without updating CHECKSUMS.json
    MODIFIED_FILES=$(git diff --name-only "$BASE_REF..$HEAD_REF" -- \
        'frontend/js/*.js' 'frontend/js/**/*.js' 'frontend/css/*.css' 'frontend/index.html')
    if [ -n "$MODIFIED_FILES" ]; then
        echo "ERROR: Checksummed files were modified but CHECKSUMS.json was not updated"
        echo "Modified files:"
        echo "$MODIFIED_FILES"
        exit 1
    fi
    exit 0
fi

# For each commit that modifies CHECKSUMS.json, verify it only contains CHECKSUMS.json
for COMMIT in $CHECKSUM_COMMITS; do
    SHORT_HASH=$(echo "$COMMIT" | cut -c1-7)
    FILES=$(git diff-tree --no-commit-id --name-only -r "$COMMIT")
    FILE_COUNT=$(echo "$FILES" | wc -l | tr -d ' ')

    echo "Commit $SHORT_HASH modifies CHECKSUMS.json"
    echo "  Files in commit: $FILE_COUNT"

    if [ "$FILE_COUNT" -ne 1 ] || [ "$FILES" != "CHECKSUMS.json" ]; then
        echo "ERROR: CHECKSUMS.json must be updated in its own dedicated commit"
        echo "  This commit also contains:"
        echo "$FILES" | grep -v "CHECKSUMS.json" | sed 's/^/    /'
        exit 1
    fi

    echo "  OK: Dedicated checksum commit"
done

echo ""
echo "All checksum commit rules verified"
