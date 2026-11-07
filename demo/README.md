# Relay demo shop

A tiny order calculator used to exercise [Relay](https://github.com/jacobheric/railway). Run `npm test` with Node 24 or later; there are no dependencies.

Push to a pull request normally. **PR CI** reuses a trusted receipt if one matches, otherwise it runs the tests on Railway. New pushes cancel obsolete runs for that PR. Test failures appear in the GitHub check, with full output in [Relay](https://relay-production-f406.up.railway.app).

Local CI is optional. To avoid a remote run, use the Relay CLI to test your committed files, publish the receipt, then push. See [the local setup](https://github.com/jacobheric/railway#run-ci-before-pushing).

When the PR is ready:

1. Update its branch from `main` if needed.
2. Open **Actions → Run merge gate → Run workflow**, use the `main` workflow, and enter the PR number.
3. Wait for **Relay / CI** and **Relay / merge gate** to pass, then merge.

The merge gate always runs fresh CI against GitHub’s proposed merge commit. Branch protection requires both checks and an up-to-date branch, including for administrators. The gate never merges or deploys by itself. There is no CI triggered after merging to main.

The automated demo workflows accept same-repository PRs. Test containers do not receive GitHub or Railway credentials. This repository’s history and CI results are independent of the starter source in Relay’s `demo/` folder.
