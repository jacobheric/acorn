import { readFileSync } from "node:fs";
import type { Recipe } from "../core/types.ts";

export type RunnerService = {
  id: string;
  name: string;
  deploymentId: string | null;
  status: string | null;
};
export type Provider = {
  configured: boolean;
  create: (name: string) => Promise<string>;
  start: (serviceId: string, runId: string, token: string) => Promise<void>;
  remove: (serviceId: string) => Promise<void>;
  services: () => Promise<RunnerService[]>;
};

export const operations = {
  create:
    "mutation CreateRunner($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }",
  configure:
    "mutation ConfigureRunner($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }",
  variables:
    "mutation RunnerVariables($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }",
  deploy:
    "mutation DeployRunner($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }",
  remove: "mutation RemoveRunner($id: String!) { serviceDelete(id: $id) }",
  services:
    "query RunnerServices($id: String!) { environment(id: $id) { serviceInstances { edges { node { serviceId serviceName latestDeployment { id status } } } } } }",
};

export const createRailway = (
  options: {
    token: string;
    projectId: string;
    environmentId: string;
    publicUrl: string;
    recipe: Recipe;
  },
  request: typeof fetch = fetch,
): Provider => {
  const { token, projectId, environmentId, publicUrl, recipe } = options;
  const gql = async <T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> => {
    const response = await request("https://backboard.railway.com/graphql/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Project-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok)
      throw new Error(`Railway returned HTTP ${response.status}`);
    const body = (await response.json()) as {
      data?: T;
      errors?: { message: string }[];
    };
    if (body.errors?.length || !body.data)
      throw new Error(
        `Railway: ${body.errors?.map((error) => error.message).join("; ") ?? "missing response"}`,
      );
    return body.data;
  };
  const worker = () =>
    ["execute.mjs", "remote.mjs"]
      .map((name) =>
        readFileSync(new URL(`../../runner/${name}`, import.meta.url), "utf8"),
      )
      .join("\n");
  return {
    configured: Boolean(token && projectId && environmentId),
    create: async (name) =>
      (
        await gql<{ serviceCreate: { id: string } }>(operations.create, {
          input: { projectId, environmentId, name },
        })
      ).serviceCreate.id,
    start: async (serviceId, runId, callbackToken) => {
      const code = Buffer.from(worker()).toString("base64");
      await gql(operations.configure, {
        serviceId,
        environmentId,
        input: {
          source: { image: recipe.image },
          startCommand: `node --input-type=module -e 'await import("data:text/javascript;base64,${code}")'`,
          restartPolicyType: "NEVER",
          numReplicas: 1,
          sleepApplication: false,
        },
      });
      await gql(operations.variables, {
        input: {
          projectId,
          environmentId,
          serviceId,
          skipDeploys: true,
          variables: {
            RELAY_URL: publicUrl,
            RELAY_RUN_ID: runId,
            RELAY_CALLBACK_TOKEN: callbackToken,
          },
        },
      });
      await gql(operations.deploy, { serviceId, environmentId });
    },
    remove: async (id) => {
      await gql(operations.remove, { id });
    },
    services: async () => {
      const data = await gql<{
        environment: {
          serviceInstances: {
            edges: {
              node: {
                serviceId: string;
                serviceName: string;
                latestDeployment: { id: string; status: string } | null;
              };
            }[];
          };
        };
      }>(operations.services, { id: environmentId });
      return data.environment.serviceInstances.edges.map(({ node }) => ({
        id: node.serviceId,
        name: node.serviceName,
        deploymentId: node.latestDeployment?.id ?? null,
        status: node.latestDeployment?.status ?? null,
      }));
    },
  };
};
