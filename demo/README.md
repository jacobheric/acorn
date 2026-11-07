# Relay demo shop

A tiny order calculator used to exercise [Relay](https://github.com/jacobheric/railway): local CI receipts, GitHub verification, and disposable Railway runners.

Run `npm test` with Node 24 or later. There are no dependencies.

Pull requests get a `Relay / trusted receipt` check. Publish a signed local receipt, or use the **Run on Railway** workflow to produce one, then rerun the receipt check. Merges to `main` always run fresh CI on Railway.

The `demo/` directory in the Relay repository is the starter for this repository. This repository's Git history and CI results are independent.
