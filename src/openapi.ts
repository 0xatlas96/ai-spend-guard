export function spendGuardOpenApiDocument(baseUrl?: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "AI Spend Guard HTTP Sidecar",
      version: "0.3.0",
      description:
        "Local-first pre-call financial firewall API for AI and other metered services.",
    },
    ...(baseUrl ? { servers: [{ url: baseUrl }] } : {}),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
      },
      schemas: {
        SpendContext: {
          type: "object",
          additionalProperties: false,
          properties: {
            provider: { type: "string" },
            model: { type: "string" },
            resource: { type: "string" },
            projectId: { type: "string" },
            userId: { type: "string" },
            sessionId: { type: "string" },
            agentId: { type: "string" },
            route: { type: "string" },
            environment: { type: "string" },
            tags: {
              type: "object",
              additionalProperties: { type: "string" },
            },
          },
        },
        SpendRequest: {
          type: "object",
          properties: {
            context: { $ref: "#/components/schemas/SpendContext" },
            estimatedCostUsd: { type: "number", minimum: 0 },
            requestId: { type: "string" },
            idempotencyKey: { type: "string" },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: {},
              },
            },
          },
        },
      },
    },
    paths: {
      "/healthz": {
        get: {
          summary: "Liveness check",
          security: [],
          responses: {
            "200": {
              description: "Healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { const: true } },
                  },
                },
              },
            },
          },
        },
      },
      "/api/status": {
        get: {
          summary: "Current policy and ledger status",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Firewall status" },
            "401": errorResponse("Authentication required"),
          },
        },
      },
      "/api/reservations": {
        get: {
          summary: "List open reservations",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "olderThanMs",
              in: "query",
              required: false,
              schema: { type: "number", minimum: 0 },
            },
          ],
          responses: {
            "200": { description: "Open reservations" },
            "401": errorResponse("Authentication required"),
          },
        },
      },
      "/api/explain": {
        post: spendRequestOperation(
          "Evaluate a hypothetical paid operation without changing the ledger",
          "200",
          "Policy decision"
        ),
      },
      "/api/reserve": {
        post: {
          ...spendRequestOperation(
            "Atomically reserve budget before paid work",
            "201",
            "Reservation created"
          ),
          responses: {
            "201": { description: "Reservation created" },
            "400": errorResponse("Invalid request"),
            "401": errorResponse("Authentication required"),
            "402": errorResponse("Spend policy denied operation"),
            "409": errorResponse("Idempotency conflict or duplicate operation"),
          },
        },
      },
      "/api/settle": {
        post: {
          summary: "Replace a reservation with actual settled spend",
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody({
            type: "object",
            required: ["id", "actualCostUsd"],
            properties: {
              id: { type: "string" },
              actualCostUsd: { type: "number", minimum: 0 },
              metadata: { type: "object", additionalProperties: true },
            },
          }),
          responses: {
            "200": { description: "Settlement result" },
            "400": errorResponse("Invalid request"),
            "404": errorResponse("Reservation not found"),
          },
        },
      },
      "/api/resize": {
        post: {
          summary: "Resize an outstanding reservation before additional paid work",
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody({
            type: "object",
            required: ["id", "estimatedCostUsd"],
            properties: {
              id: { type: "string" },
              estimatedCostUsd: { type: "number", minimum: 0 },
            },
          }),
          responses: {
            "200": { description: "Reservation adjustment" },
            "402": errorResponse("Higher reservation violates policy"),
            "404": errorResponse("Reservation not found"),
          },
        },
      },
      "/api/release": {
        post: {
          summary: "Explicitly release a reservation known to be unbilled",
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody({
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } },
          }),
          responses: {
            "200": { description: "Reservation released" },
            "404": errorResponse("Reservation not found"),
          },
        },
      },
      "/api/record": {
        post: {
          summary: "Record spend that already happened",
          security: [{ bearerAuth: [] }],
          requestBody: jsonBody({
            type: "object",
            required: ["actualCostUsd"],
            properties: {
              context: { $ref: "#/components/schemas/SpendContext" },
              actualCostUsd: { type: "number", minimum: 0 },
              requestId: { type: "string" },
              idempotencyKey: { type: "string" },
              metadata: { type: "object", additionalProperties: true },
            },
          }),
          responses: {
            "201": { description: "Spend recorded" },
            "400": errorResponse("Invalid request"),
            "409": errorResponse("Idempotency conflict or duplicate operation"),
          },
        },
      },
    },
  } as const;
}

function spendRequestOperation(
  summary: string,
  successStatus: string,
  successDescription: string
) {
  return {
    summary,
    security: [{ bearerAuth: [] }],
    requestBody: jsonBody({
      $ref: "#/components/schemas/SpendRequest",
    }),
    responses: {
      [successStatus]: { description: successDescription },
      "400": errorResponse("Invalid spend request"),
      "401": errorResponse("Authentication required"),
      "402": errorResponse("Spend policy denied operation"),
    },
  };
}

function jsonBody(schema: unknown) {
  return {
    required: true,
    content: {
      "application/json": { schema },
    },
  };
}

function errorResponse(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Error" },
      },
    },
  };
}
