# Relay

Assert CI anywhere. Respect it everywhere.

Relay lets a trusted developer run CI on their laptop or in their agent's compute, sign the result, and ship that result with the pull request. A GitHub Actions workflow asks Relay to verify the receipt. Without one, CI runs automatically on Railway. For this, Relay starts a container through Railway's GraphQL API, runs CI, and removes the container. As a final check, a full CI run is required before a PR can merge.

[Live dashboard](https://relay-production-f406.up.railway.app) · [Demo repository](https://github.com/jacobheric/railway-demo)

## Why

At the rate agents write code and push changes to PRs, running large CI suites on every change becomes impractical in both cost and time. CI optimizations, parallel jobs and faster compute help, but they still repeat work that may already be done. This is an experiment in trusting a signed CI result from a known device, so we can distribute CI around and reduce the bottleneck.

## Try it

The dashboard is publicly readable. **Unlock runner controls** accepts the `ADMIN_TOKEN` configured on the Railway `relay` service.

1. Leave the ref at `main` and choose **Spin up runner**.
2. Watch provisioning, execution, the result, and container removal.
3. Open the run to see its output, then inspect its signed receipt.
4. Start another run and choose **Spin down runner** to exercise cancellation.
5. Use **Receipts → Check a commit** to verify a full commit SHA.

The sample is an order calculator with tests for discounts, rounding, invalid inputs, and integer overflow. Its tests run without installing dependencies. All displayed runs and receipts are real; there is no seeded activity.

## Run locally

Requires Node 24+, npm, Git, and Docker for laptop CI.

```sh
npm ci
node scripts/setup.mjs
npm run build
npm start
```

Open `http://localhost:3000`. Setup creates an ignored, private `.env` with operator, automation, and signing credentials. It refuses to overwrite an existing file. The UI and local receipt flow work without Railway credentials; remote execution stays disabled until configured.

For UI development, run `npm run dev` and `npm run dev:ui` in separate terminals. The Vite server forwards API requests to port 3000.

## Run CI before pushing

```sh
export RELAY_URL=https://relay-production-f406.up.railway.app
npm run relay -- keygen

export RELAY_ADMIN_TOKEN=<operator-token>
npm run relay -- register --label "My laptop"
unset RELAY_ADMIN_TOKEN

npm run relay -- run --repo ../railway-demo
npm run relay -- publish /path/printed/by/the/run.json
git -C ../railway-demo push
```

Commit changes before running. The CLI rejects a dirty working tree, exports the committed snapshot, and tests it in the exact Linux image configured by the coordinator. It signs only a successful result. Neither the device key nor the operator token enters the test container.

Publish before pushing. Relay validates the signature when you upload, then checks the actual GitHub source tree when the PR workflow requests verification. If you skip local CI, push normally: Relay starts remote CI immediately.

Keys default to `~/.config/relay/key.pem`. Use `--key` to choose another path, `--out` to choose the receipt path, and `--server` to override `RELAY_URL`.

## What is trusted

A receipt contains the repository, original commit, Git tree, recipe digest, signer ID, timestamps, successful exit code, and log digest. The claim is serialized with sorted keys and signed with Ed25519. The server checks the signature against its trusted key registry.

Reuse requires the same repository, **entire Git tree**, and recipe. The recipe includes the pinned image digest, `linux/amd64`, command, environment, timeout, and protocol version. A commit-message amendment preserves the tree; changing any file, including a comment or README, changes it. There is no source rewriting or comment detection.

Receipts expire after seven days. Revoking a key invalidates its receipts on the next verification. A recipe change invalidates old receipts. The merge gate always requests fresh remote CI, regardless of existing receipts.

**A signature proves who made an assertion, not that the assertion is honest.** A trusted signer can lie, alter their CLI, or lose their key. This design accepts that trust boundary. It is not suitable for untrusted contributors without an independent runner. Passing tests also do not prove that the suite is complete.

The merge gate tests **GitHub’s proposed merge commit before merging**, including the current target branch. It checks that the PR head and target branch have not changed before accepting the result. The demo requires the gate and an up-to-date branch through branch protection; deployments can keep their existing trigger after merge. There is no post-merge CI workflow.

## GitHub integration

`action/` is a dependency-free composite action. It reports the tested source, receipt, result, and the last 8,000 characters of test output in the GitHub check and Actions summary.

| Mode | Behavior |
| --- | --- |
| `verify` | Verify an existing receipt without requesting compute. |
| `fallback` | Reuse a valid receipt, otherwise run CI on Railway. |
| `firewall` | Always run fresh remote CI. With `pull-request`, test the proposed merge result. |

The demo’s **PR CI** workflow runs on PR creation and updates using `fallback`. It uses `pull_request_target` and a pinned action from this repository. The privileged job never checks out or executes PR code; tests run in the disposable container. Each PR has its own GitHub concurrency group with cancellation enabled.

A new PR head supersedes older work. Relay cancels and removes the old container, even if GitHub has already killed the waiting workflow. Its periodic reconciliation also checks PR heads independently. Different PRs wait in a persistent queue for the single physical runner. Delayed workflows for obsolete heads cannot start CI; late callbacks cannot create passing results after cancellation.

When a PR is ready, run **Run merge gate** from the demo repository’s Actions tab and enter the PR number. The required `Relay / merge gate` check runs a fresh suite against GitHub’s proposed merge commit. Branch protection also requires `Relay / CI` and an up-to-date branch, including for administrators. If the PR or base changes, update the branch and rerun the gate. The gate does not merge or deploy anything itself.

Both workflows need the `RELAY_URL` repository variable and `RELAY_AUTOMATION_TOKEN` secret. The automation token can request runs and supersede obsolete work for that PR; it cannot register keys or manually stop arbitrary runs. The GitHub workflow token posts check results and stays out of test containers.

GitHub’s native merge queue is available for organization-owned repositories, so this personal demo uses the explicit gate above. In an organization, trigger fresh CI on `merge_group` and make it a required check to have the queue schedule the final run automatically. See [GitHub’s merge queue documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue).

The coordinator is part of the trusted system: Actions trusts its HTTPS verification response. A production GitHub App would provide installation identity and better key ownership than this small operator-token setup.

## Railway deployment

The dashboard uses React, Vite, Hono, and SQLite on a Railway volume. The Docker build runs type checks, tests, and the UI build. Keep one dashboard replica because the store and lifecycle coordination are local to that process.

Create a second Railway project for runners so they do not share the dashboard's private network or application variables. Create a project token scoped to its environment. Set these variables on the dashboard service:

| Variable                | Purpose                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- |
| `PUBLIC_URL`            | Public HTTPS dashboard URL; used by runner callbacks.                            |
| `DATABASE_PATH`         | `/data/relay.sqlite`; attach a volume at `/data`.                                |
| `ADMIN_TOKEN`           | Operator access to compute and trusted devices.                                  |
| `AUTOMATION_TOKEN`      | GitHub's scoped run-request credential.                                          |
| `RECEIPT_PRIVATE_KEY`   | Ed25519 coordinator key; PEM or escaped newlines.                                |
| `RAILWAY_API_TOKEN`     | Runner project token.                                                            |
| `RUNNER_PROJECT_ID`     | Project that owns disposable runners.                                            |
| `RUNNER_ENVIRONMENT_ID` | Environment authorized by that token.                                            |
| `DEMO_REPOSITORY`       | Optional; defaults to `jacobheric/railway-demo`.                                 |
| `GITHUB_READ_TOKEN`     | Optional read-only token. Public Git is used if the API rate limits the request. |

`src/server/railway.ts` calls the [Railway GraphQL API](https://docs.railway.com/integrations/api) directly, with `Project-Access-Token` authentication. It creates an empty service, configures the pinned image and restart policy, sets a per-run callback credential, and deploys it. Stopping removes the disposable service and its deployment with `serviceDelete`.

The worker fetches the exact commit, checks its tree, and runs the recipe as an unprivileged user with a clean environment. The privileged supervisor holds only a credential for that run's callbacks. It holds no Railway or GitHub token. Submodules are rejected; private repositories, LFS, privileged jobs, and secrets-dependent suites are outside this demo's scope.

The suite has a 3 minute timeout, the worker a hard 8 minute exit, and the coordinator a 10 minute lease. SQLite reserves one physical runner slot and persists queued requests. Queued work expires after ten minutes; an allocated runner gets its own ten minute lease. Cleanup is retried and remains visible until Railway confirms removal. A deterministic service name allows recovery when a create response is lost or the coordinator restarts. Unknown services are not deleted; only Relay's UUID-named runners are managed.

If the coordinator is down, a worker exits on its own but its service record remains until reconciliation resumes. This is a cooperative contributor demo, not a hardened sandbox for hostile code. Provider resource limits, egress controls, durable work queues, and stronger tenant isolation belong in a production version.

## Code map

| Path                        | Responsibility                                            |
| --------------------------- | --------------------------------------------------------- |
| `src/core/`                 | Receipt schema, canonical signing, verification.          |
| `cli/`                      | Device keys, local Docker execution, receipt publication. |
| `src/server/coordinator.ts` | Run state, cancellation, deadlines, reconciliation.       |
| `src/server/railway.ts`     | GraphQL adapter behind a small provider interface.        |
| `runner/`                   | Container supervisor and isolated test execution.         |
| `src/server/app.ts`         | Public reads, operator writes, scoped callbacks.          |
| `src/client/`               | Dashboard, runner controls, receipts, device management.  |
| `action/`                   | GitHub check and optional remote execution.               |
| `demo/`                     | Starter source for the independent demo repository.       |

The provider interface is the seam for another compute backend. Receipt validation, the CLI, the UI, and the GitHub integration do not depend on Railway.

## Checks

```sh
npm run ci
```

Tests cover receipt uploads before push, source verification, revoked and expired keys, queued runs, PR supersession, changed merge bases, late callbacks, cleanup retries, fresh merge runs, API authorization, and failure reporting in GitHub.

For the walkthrough: compare a local receipt with a Railway receipt, amend only the commit message to show reuse, change a source comment to show invalidation, then start and stop a fresh container. The interesting question is where to place the trust boundary, and which work actually needs to run again.
