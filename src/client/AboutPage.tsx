import {
  ArrowDownLeft,
  ArrowUpRight,
  FileCheck2,
  GitBranch,
  GitFork,
  Laptop,
  LockKeyhole,
  Server,
  Terminal,
} from "lucide-react";

import { PageHeading, Step } from "./components.tsx";

export const AboutPage = () => {
  return (
    <>
      <PageHeading
        eyebrow="A SMALL CHANGE IN DIRECTION"
        title="Bring the result with you."
        description="Instead of asking a central queue to repeat every test, let trusted compute do the work once."
      />
      <div className="about-grid">
        <section className="panel about-steps">
          <Step
            n="01"
            icon={<Laptop size={22} />}
            title="Run the full suite locally"
          >
            Relay tests a committed snapshot in a pinned Linux container. Your
            signing key stays outside the container.
          </Step>
          <Step n="02" icon={<FileCheck2 size={22} />} title="Sign a receipt">
            The receipt binds the source tree, CI recipe, result, timestamps,
            and log digest to your device’s key.
          </Step>
          <Step
            n="03"
            icon={<GitFork size={22} />}
            title="Let GitHub check the evidence"
          >
            A lightweight PR check verifies the receipt. Same tree, same recipe,
            trusted signer: no repeat run.
          </Step>
          <Step
            n="04"
            icon={<Server size={22} />}
            title="Use fresh compute where it counts"
          >
            Missing receipt? Request a Railway runner. Merge to main? Run the
            full suite again, even if a receipt exists.
          </Step>
        </section>
        <section className="panel getting-started">
          <div className="panel-heading">
            <div>
              <h2>From your laptop</h2>
              <p>Node 24+, Git, and Docker.</p>
            </div>
            <Terminal size={20} />
          </div>
          <pre>{`git clone https://github.com/jacobheric/railway\ncd railway && npm ci\n\n# Create a device key\nnpm run relay -- keygen\n\n# Register with operator access\nexport RELAY_URL=${window.location.origin}\nexport RELAY_ADMIN_TOKEN=<operator-token>\nnpm run relay -- register --label "My laptop"\nunset RELAY_ADMIN_TOKEN\n\n# Run before pushing\nnpm run relay -- run --repo ../railway-demo\n\n# Push, then publish the saved receipt\ngit -C ../railway-demo push\nnpm run relay -- publish /path/to/receipt.json`}</pre>
          <a
            className="text-button"
            href="https://github.com/jacobheric/railway#readme"
            target="_blank"
            rel="noreferrer"
          >
            Full setup guide <ArrowUpRight size={14} />
          </a>
        </section>
      </div>
      <div className="principles">
        <div>
          <GitBranch size={20} />
          <h3>Hash the tree.</h3>
          <p>
            Commit-message amendments preserve the result. Any file edit changes
            the tree. No comment parsing or fragile heuristics.
          </p>
        </div>
        <div>
          <LockKeyhole size={20} />
          <h3>Keep the scope small.</h3>
          <p>
            One public demo repo, one active runner, a hard timeout. No
            repository secrets are passed to test code.
          </p>
        </div>
        <div>
          <ArrowDownLeft size={20} />
          <h3>Keep a second check.</h3>
          <p>
            The merge firewall runs independently on main. It detects
            integration failures after merge; it is not a merge queue.
          </p>
        </div>
      </div>
    </>
  );
};
