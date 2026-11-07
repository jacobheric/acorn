# Relay

Run CI once. Carry the result.

Relay lets a trusted developer run CI on their laptop, sign the result, and bring that result to a pull request. GitHub checks the receipt instead of repeating the suite. When fresh compute is needed, Relay starts a container through Railway's GraphQL API, runs CI, and removes the container.

[Live dashboard](https://relay-production-f406.up.railway.app) · [Demo repository](https://github.com/jacobheric/railway-demo)

## Why

CI can become the longest part of a small change. More parallel jobs and faster machines help, but they still repeat work that may already be done. This is an experiment in trusting a signed result from a known device, with an independent full run on each merge to main.

It is deliberately small: one public repository, one CI recipe, one active Railway runner. No team onboarding, billing, or general workflow engine.

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
git -C ../railway-demo push
npm run relay -- publish /path/printed/by/the/run.json
```

Commit changes before running. The CLI rejects a dirty working tree, exports the committed snapshot, and tests it in the exact Linux image configured by the coordinator. It signs only a successful result. Neither the device key nor the operator token enters the test container.

Push before publishing the receipt: the server asks GitHub to confirm that the claimed tree belongs to the commit. The PR check allows one minute for the receipt to arrive. If it arrives later, rerun the check.

Keys default to `~/.config/relay/key.pem`. Use `--key` to choose another path, `--out` to choose the receipt path, and `--server` to override `RELAY_URL`.

## What is trusted

A receipt contains the repository, original commit, Git tree, recipe digest, signer ID, timestamps, successful exit code, and log digest. The claim is serialized with sorted keys and signed with Ed25519. The server checks the signature against its trusted key registry.

Reuse requires the same repository, **entire Git tree**, and recipe. The recipe includes the pinned image digest, `linux/amd64`, command, environment, timeout, and protocol version. A commit-message amendment preserves the tree; changing any file, including a comment or README, changes it. There is no source rewriting or comment detection.

Receipts expire after seven days. Revoking a key invalidates its receipts on the next verification. A recipe change invalidates old receipts. A merge to main always requests fresh CI, regardless of existing receipts.

**A signature proves who made an assertion, not that the assertion is honest.** A trusted signer can lie, alter their CLI, or lose their key. This design accepts that trust boundary. It is not suitable for untrusted contributors without an independent runner. Passing tests also do not prove that the suite is complete.

The merge firewall runs **after** a push to main. It detects integration failures; it does not prevent a bad merge or test GitHub's synthetic merge commit. A production version could move that run into a merge queue.

## GitHub integration

`action/` is a dependency-free composite action. It posts a check on the exact commit with the tree, recipe, signer, receipt, and dashboard link.

| Mode       | Behavior                                                  |
| ---------- | --------------------------------------------------------- |
| `verify`   | Verify a receipt; never start compute.                    |
| `fallback` | Reuse a valid receipt, otherwise start Railway CI.        |
| `firewall` | Always start fresh Railway CI and require its own result. |

The demo uses a base-branch `pull_request_target` workflow to verify receipts. It never checks out or executes PR code in the privileged Actions job. The action is pinned to a commit. Test code runs only in the disposable container, without GitHub or Railway credentials.

The **Run on Railway** workflow provides the optional fallback. Pushes to main use the firewall mode. Both need the `RELAY_URL` repository variable and `RELAY_AUTOMATION_TOKEN` secret. The automation token can only request runs; it cannot add keys or stop runs.

The coordinator is part of the trusted system: Actions trusts its HTTPS verification response. Requiring the `Relay / trusted receipt` check in branch protection is a separate repository policy choice. A production GitHub App would provide installation identity and better key ownership than this small operator-token setup.

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

The suite has a 3 minute timeout, the worker a hard 8 minute exit, and the coordinator a 10 minute lease. SQLite reserves the single runner slot. Cleanup is retried and remains visible until Railway confirms removal. A deterministic service name allows recovery when a create response is lost or the coordinator restarts. Unknown services are not deleted; only Relay's UUID-named runners are managed.

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

Tests cover altered claims, changed trees and recipes, revoked and expired keys, concurrent starts, cancellation races, late callbacks, uncertain provisioning, cleanup retries, forced merge runs, and API authorization.

For the walkthrough: compare a local receipt with a Railway receipt, amend only the commit message to show reuse, change a source comment to show invalidation, then start and stop a fresh container. The interesting question is where to place the trust boundary, and which work actually needs to run again.
