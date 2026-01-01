# Release Process

This document describes the release workflow for Zcash Web Wallet.

## Overview

- **develop**: Main development branch. All feature PRs target this branch.
- **main**: Production branch. Deployed to GitHub Pages automatically.
- Releases are always created from `develop` and merged into `main`.
- The `__COMMIT_HASH__` placeholder must always be present on `develop`.

## Branch Protection

### develop branch

- `__COMMIT_HASH__` placeholder must be present in `frontend/index.html`
- CI enforces this on all PRs targeting develop

### main branch

- `__COMMIT_HASH__` must be replaced with actual commit hash
- Checksums are verified before deployment

## Release Workflow

### Step 1: Prepare the Release (on develop)

Create a PR targeting `develop` that finalizes the changelog:

1. Move entries from `## [Unreleased]` to a new version section
2. Add the version number and release date: `## [X.Y.Z] - YYYY-MM-DD`
3. Add the version link at the bottom of the file
4. Commit and create PR targeting `develop`

```markdown
## [0.2.0] - 2026-01-15

### Added

- Feature X (#123)
- Feature Y (#124)

### Fixed

- Bug Z (#125)
```

The merge commit of this PR defines the release version.

### Step 2: Create Release Branch

After the changelog PR is merged to `develop`:

```bash
git checkout develop
git pull origin develop
git checkout -b release/vX.Y.Z
```

### Step 3: Merge main into Release Branch

```bash
git merge origin/main
```

### Step 4: Update Commit Hash

After the merge, `frontend/index.html` contains main's previous release commit
hash. Manually update it with the current commit hash:

1. Get the current commit hash:

   ```bash
   git rev-parse HEAD        # Full hash
   git rev-parse --short HEAD # Short hash (7 chars)
   ```

2. Edit `frontend/index.html` and replace:
   - The full hash in the GitHub commit URL
   - The short hash in the link text

3. Commit the change:
   ```bash
   git add frontend/index.html
   git commit -m "chore: update commit hash for release vX.Y.Z"
   ```

### Step 5: Update Checksums

```bash
make generate-checksums
git add CHECKSUMS.json
git commit -m "chore: update checksums for release vX.Y.Z"
```

### Step 6: Create PR to main

```bash
git push -u origin release/vX.Y.Z
gh pr create --base main --title "Release vX.Y.Z"
```

CI will verify:

- `__COMMIT_HASH__` is not present (replaced with actual hash)
- Checksums are valid

### Step 7: Merge and Deploy

Once CI passes and the PR is approved:

1. Merge the PR to `main`
2. GitHub Pages deployment triggers automatically
3. Checksums are verified before deployment

### Step 8: Tag and Release

After merging to main, create a tag and GitHub release from the HEAD of main:

```bash
git checkout main
git pull origin main
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z" --notes "See CHANGELOG.md for details"
```

**Important:** The tag must be created from the HEAD of main (the merge commit),
not from the release branch.

## CI Checks

### PRs targeting develop

- All build and test jobs run
- WASM files must be in dedicated commits
- CSS files must be in dedicated commits
- CHECKSUMS.json must be in dedicated commit
- CHANGELOG.md must be updated
- `__COMMIT_HASH__` placeholder must be present

### PRs targeting main

- Only release validation jobs run
- `__COMMIT_HASH__` must NOT be present (replaced with actual hash)

### Push to main

- Checksums are verified
- Deploy to GitHub Pages

## Quick Reference

```bash
# After changelog PR is merged to develop
git checkout develop && git pull
git checkout -b release/vX.Y.Z
git merge origin/main
# Manually edit frontend/index.html to update commit hash
# (replace old hash with output of: git rev-parse HEAD / git rev-parse --short HEAD)
git add frontend/index.html && git commit -m "chore: update commit hash"
make generate-checksums
git add CHECKSUMS.json && git commit -m "chore: update checksums"
git push -u origin release/vX.Y.Z
gh pr create --base main --title "Release vX.Y.Z"
```
