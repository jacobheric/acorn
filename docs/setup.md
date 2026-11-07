# Setup

[Back to Acorn](../README.md)

## Local development

Follow the [quick start](../README.md#run-locally). `scripts/setup.mjs` generates operator, automation, and signing credentials in `.env` and refuses to overwrite an existing file. The dashboard and local receipt flow work without Railway credentials.

For hot reload, run `npm run dev` and `npm run dev:ui` in separate terminals. Vite forwards API requests to port 3000.

## Run CI before pushing

From your Acorn checkout, register a device once:

```sh
export ACORN_URL=https://acorn-production-f406.up.railway.app
npm run acorn -- keygen
export ACORN_ADMIN_TOKEN=<operator-token>
npm run acorn -- register --label "My laptop"
unset ACORN_ADMIN_TOKEN
```

Then, for each change in the configured demo repo:

```sh
# Commit your changes first
npm run acorn -- run --repo ../acorn-demo
npm run acorn -- publish /path/printed/by/the/run.json
git -C ../acorn-demo push
```

The CLI requires a clean working tree and tests the committed snapshot in the configured Linux image. It signs only a successful result. Device keys stay outside the test container.

Keys default to `~/.config/acorn/key.pem`. Use `--key`, `--out`, or `--server` to override the key path, receipt path, or coordinator URL. The receipt can be published before the commit exists on GitHub; verification later checks GitHub's actual source tree.

## GitHub

The [demo workflows](../demo/.github/workflows/) use the pinned [composite action](../action/action.yml). Set the `ACORN_URL` repository variable and `ACORN_AUTOMATION_TOKEN` secret, using the coordinator's `AUTOMATION_TOKEN` value.

| Mode | Behavior |
| --- | --- |
| `verify` | Check an existing receipt without starting compute. |
| `fallback` | Reuse a matching receipt or run CI on Railway. |
| `firewall` | Run fresh CI against the proposed merge; the gate is on by default. |

The PR workflow uses `pull_request_target` for same-repository PRs. It never checks out PR code into the privileged job. Test failures appear in the GitHub check and Actions summary.

Require **Acorn / CI**, **Acorn / merge gate**, and an up-to-date branch in branch protection. Enable **Allow auto-merge** in the repository settings. When a PR is ready, update its branch if GitHub asks, then choose **Enable auto-merge** on the PR. This starts fresh CI against the proposed merge. GitHub merges only after all required checks and reviews pass. New pushes replace obsolete gate runs while auto-merge remains enabled.

The gate is on by default. Set the repository variable `ACORN_MERGE_GATE` to `false` to opt out of the extra pre-merge run. On the next PR event, its check reports **Merge gate disabled**; the regular CI check still applies. Leave both checks in branch protection. Remove the variable to restore the default. **Actions → Run merge gate** remains available to force a fresh run manually, including when the automatic gate is disabled.

## Railway

Deploy this repo with its Dockerfile and attach a volume at `/data`. Keep one dashboard replica: SQLite and coordination run in that process.

Create a separate project for disposable runners, then create a project token scoped to its environment. Set these variables on the dashboard service:

| Variable | Value |
| --- | --- |
| `PUBLIC_URL` | Public HTTPS dashboard URL for runner callbacks. |
| `DATABASE_PATH` | `/data/acorn.sqlite`, or the existing database path when upgrading. |
| `ADMIN_TOKEN` | Operator credential for runner controls and device registration. |
| `AUTOMATION_TOKEN` | Scoped credential used by the GitHub workflows. |
| `RECEIPT_PRIVATE_KEY` | Coordinator's Ed25519 private key; PEM or escaped newlines. |
| `RAILWAY_API_TOKEN` | Runner project token. |
| `RUNNER_PROJECT_ID` | Runner project ID. |
| `RUNNER_ENVIRONMENT_ID` | Environment authorized by the project token. |
| `DEMO_REPOSITORY` | Optional; defaults to `jacobheric/acorn-demo`. |
| `GITHUB_READ_TOKEN` | Optional read-only token; public Git is the fallback. |

Only the configured public repo can run. Test containers receive no GitHub or Railway credentials. One runner executes at a time; other PRs wait in a persistent queue. Tests time out after three minutes, workers exit after eight, and the coordinator enforces a ten-minute lease once a runner starts and retries cleanup. Rotating `RECEIPT_PRIVATE_KEY` retires the old coordinator key on the next boot.

Private repositories, LFS, submodules, and tests requiring secrets are outside this demo's scope.
