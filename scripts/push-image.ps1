# Build the current branch's pushed commit and push it to Docker Hub, tagged like CI.
# Usage: .\scripts\push-image.ps1   (staging -> staging-<sha> + staging, main -> prod-<sha> + latest)

$Repo = 'harhsitsharma/cms-backend'
$Root = Split-Path $PSScriptRoot -Parent

function Assert-Ok([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

$branch = git -C $Root branch --show-current
switch ($branch) {
  'staging' { $target = 'staging'; $prefix = 'staging'; $floating = 'staging' }
  'main' { $target = 'production'; $prefix = 'prod'; $floating = 'latest' }
  default { throw "You are on '$branch'. Switch to staging or main first (git checkout staging)." }
}

# The server deploys the commit it pulls, so the image must be built from that same commit.
git -C $Root fetch origin $branch --quiet; Assert-Ok "git fetch origin $branch"
if ((git -C $Root rev-parse HEAD) -ne (git -C $Root rev-parse "origin/$branch")) {
  throw "Your $branch differs from origin/$branch. Run 'git pull' (and 'git push' for new commits) first."
}
if (git -C $Root status --porcelain) {
  Write-Warning 'You have uncommitted changes; they are NOT in the image (it is built from the commit).'
}

$sha = git -C $Root rev-parse --short=7 HEAD
$tag = "$prefix-$sha"
$image = "${Repo}:$tag"
Write-Host "Branch $branch -> $target image $image"

docker manifest inspect $image *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host "$image is already on Docker Hub; nothing to build."
} else {
  # A temp checkout of the commit keeps local files (like .env) out of the build.
  $src = Join-Path ([IO.Path]::GetTempPath()) "cms-backend-$tag"
  git -C $Root worktree prune
  if (Test-Path $src) { Remove-Item -Recurse -Force $src }
  git -C $Root worktree add --quiet --detach $src HEAD; Assert-Ok 'git worktree add'
  try {
    docker build --platform linux/amd64 -f "$src/docker/Dockerfile" -t $image -t "${Repo}:$floating" $src
    Assert-Ok 'docker build'
    docker push $image; Assert-Ok "docker push $image"
    docker push "${Repo}:$floating"; Assert-Ok "docker push ${Repo}:$floating"
  } finally {
    git -C $Root worktree remove --force $src
  }
}

Write-Host ""
Write-Host "$image is on Docker Hub. On the $target server run:"
Write-Host "  bash scripts/deploy-server.sh"
