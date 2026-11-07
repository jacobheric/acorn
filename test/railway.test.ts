import { describe, expect, it, vi } from "vitest";
import { createRailway } from "../src/server/railway.ts";
import { recipe } from "../src/server/config.ts";

describe("Railway GraphQL adapter", () => {
  it("uses a project token and checks GraphQL errors even on HTTP 200", async () => {
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ errors: [{ message: "Not Authorized" }] }),
          { status: 200 },
        ),
    );
    const provider = createRailway(
      {
        token: "project-token",
        projectId: "p",
        environmentId: "e",
        publicUrl: "https://relay.example",
        recipe,
      },
      request,
    );
    await expect(provider.create("runner")).rejects.toThrow("Not Authorized");
    const options = request.mock.calls[0]![1] as RequestInit;
    expect(options.headers).toMatchObject({
      "Project-Access-Token": "project-token",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not blindly retry an ambiguous mutation", async () => {
    const request = vi.fn(async () => {
      throw new Error("Connection reset");
    });
    const provider = createRailway(
      {
        token: "project-token",
        projectId: "p",
        environmentId: "e",
        publicUrl: "https://relay.example",
        recipe,
      },
      request,
    );
    await expect(provider.create("runner")).rejects.toThrow("Connection reset");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
