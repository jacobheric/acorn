import { describe, expect, it, vi } from "vitest";
import { createRailway } from "../src/server/railway.ts";
import { recipe } from "../src/server/config.ts";

describe("Railway GraphQL adapter", () => {
  it("refuses to send runner credentials over plain http", () => {
    const options = { token: "t", projectId: "p", environmentId: "e", recipe };
    expect(() =>
      createRailway({ ...options, publicUrl: "http://acorn.example" }),
    ).toThrow("HTTPS");
    expect(() =>
      createRailway({ ...options, publicUrl: "http://localhost:3000" }),
    ).not.toThrow();
  });
  it("limits deletion to the token's environment", async () => {
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ data: { serviceDelete: true } })),
    );
    const provider = createRailway(
      {
        token: "project-token",
        projectId: "p",
        environmentId: "e",
        publicUrl: "https://acorn.example",
        recipe,
      },
      request,
    );
    await provider.remove("runner");
    const body = JSON.parse(request.mock.calls[0][1]!.body as string);
    expect(body.variables).toEqual({ id: "runner", environmentId: "e" });
    expect(body.query).toContain("environmentId: $environmentId");
  });
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
        publicUrl: "https://acorn.example",
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
        publicUrl: "https://acorn.example",
        recipe,
      },
      request,
    );
    await expect(provider.create("runner")).rejects.toThrow("Connection reset");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
