import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock the route module to test internal functions
// We'll test via the GET endpoint behavior

// Store original env and fetch
const originalEnv = { ...process.env };
const originalFetch = global.fetch;

// Mock fetch for provider API calls
const mockFetch = vi.fn();

// Counter to generate unique model IDs (avoids cache collisions between tests)
let testCounter = 0;

// Helper to create mock NextRequest for GET with dynamic params
function createMockSchemaRequest(
  modelId: string,
  provider: string,
  headers?: Record<string, string>
): NextRequest {
  const url = new URL(`http://localhost:3000/api/models/${encodeURIComponent(modelId)}`);
  url.searchParams.set("provider", provider);

  return {
    nextUrl: url,
    headers: new Headers(headers),
  } as unknown as NextRequest;
}

// Helper to create Replicate model response with OpenAPI schema
function createReplicateModelResponse(inputProperties: Record<string, unknown>, required: string[] = []) {
  return {
    ok: true,
    json: () => Promise.resolve({
      latest_version: {
        id: "version123",
        openapi_schema: {
          components: {
            schemas: {
              Input: {
                type: "object",
                properties: inputProperties,
                required,
              },
            },
          },
        },
      },
    }),
  };
}

// Helper to create fal.ai model response with OpenAPI schema
function createFalModelResponse(inputProperties: Record<string, unknown>, required: string[] = []) {
  return {
    ok: true,
    json: () => Promise.resolve({
      models: [{
        openapi: {
          paths: {
            "/": {
              post: {
                requestBody: {
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: inputProperties,
                        required,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }],
    }),
  };
}

// Import the route after mocks are set up
import { GET } from "../route";

describe("/api/models/[modelId] schema endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.REPLICATE_API_KEY = "test-replicate-key";
    process.env.FAL_API_KEY = "test-fal-key";
    global.fetch = mockFetch;
    testCounter++;  // Ensure unique model IDs per test to avoid cache
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  describe("isImageInput classification", () => {
    it("should NOT classify boolean params with 'image' in name as image inputs", async () => {
      // This was the original bug: sequential_image_generation (boolean) was misclassified
      mockFetch.mockResolvedValueOnce(
        createReplicateModelResponse({
          sequential_image_generation: {
            type: "boolean",
            description: "Enable sequential image generation mode",
            default: false,
          },
          prompt: {
            type: "string",
            description: "Text prompt",
          },
        })
      );

      const modelId = `test/model-boolean-${testCounter}`;
      const request = createMockSchemaRequest(modelId, "replicate");
      const response = await GET(request, { params: Promise.resolve({ modelId }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // sequential_image_generation should be a parameter, NOT an input
      const paramNames = data.parameters.map((p: { name: string }) => p.name);
      const inputNames = data.inputs.map((i: { name: string }) => i.name);

      expect(paramNames).toContain("sequential_image_generation");
      expect(inputNames).not.toContain("sequential_image_generation");
    });

    it("should NOT classify integer params with 'image' in name as image inputs", async () => {
      // max_images, num_images should be parameters, not inputs
      mockFetch.mockResolvedValueOnce(
        createReplicateModelResponse({
          max_images: {
            type: "integer",
            description: "Maximum number of images",
            default: 1,
            minimum: 1,
            maximum: 15,
          },
          num_images: {
            type: "integer",
            description: "Number of images to generate",
          },
          image_count: {
            type: "integer",
            description: "Image count",
          },
        })
      );

      const modelId = `test/model-integer-${testCounter}`;
      const request = createMockSchemaRequest(modelId, "replicate");
      const response = await GET(request, { params: Promise.resolve({ modelId }) });
      const data = await response.json();

      expect(response.status).toBe(200);

      const paramNames = data.parameters.map((p: { name: string }) => p.name);
      const inputNames = data.inputs.map((i: { name: string }) => i.name);

      expect(paramNames).toContain("max_images");
      expect(paramNames).toContain("num_images");
      expect(paramNames).toContain("image_count");
      expect(inputNames).not.toContain("max_images");
      expect(inputNames).not.toContain("num_images");
      expect(inputNames).not.toContain("image_count");
    });

    it("should NOT classify number params with 'image' in name as image inputs", async () => {
      mockFetch.mockResolvedValueOnce(
        createReplicateModelResponse({
          image_guidance_scale: {
            type: "number",
            description: "Image guidance scale",
            default: 1.5,
          },
          image_scale: {
            type: "number",
            description: "Scale factor for image",
          },
        })
      );

      const modelId = `test/model-number-${testCounter}`;
      const request = createMockSchemaRequest(modelId, "replicate");
      const response = await GET(request, { params: Promise.resolve({ modelId }) });
      const data = await response.json();

      expect(response.status).toBe(200);

      const paramNames = data.parameters.map((p: { name: string }) => p.name);
      const inputNames = data.inputs.map((i: { name: string }) => i.name);

      expect(paramNames).toContain("image_guidance_scale");
      expect(paramNames).toContain("image_scale");
      expect(inputNames).not.toContain("image_guidance_scale");
      expect(inputNames).not.toContain("image_scale");
    });

    it("should classify string params matching IMAGE_INPUT_PATTERNS as image inputs", async () => {
      mockFetch.mockResolvedValueOnce(
        createReplicateModelResponse({
          image_url: {
            type: "string",
            description: "URL of the input image",
          },
          image_input: {
            type: "string",
            description: "Input image",
          },
          reference_image: {
            type: "string",
            description: "Reference image URL",
          },
          first_frame: {
            type: "string",
            description: "First frame image",
          },
        })
      );

      const modelId = `test/model-string-inputs-${testCounter}`;
      const request = createMockSchemaRequest(modelId, "replicate");
      const response = await GET(request, { params: Promise.resolve({ modelId }) });
      const data = await response.json();

      expect(response.status).toBe(200);

      const inputNames = data.inputs.map((i: { name: string }) => i.name);

      expect(inputNames).toContain("image_url");
      expect(inputNames).toContain("image_input");
      expect(inputNames).toContain("reference_image");
      expect(inputNames).toContain("first_frame");
    });

    it("should classify array params without items.type as image inputs when name matches", async () => {
      // This was a bug: arrays without items.type specification were rejected
      mockFetch.mockResolvedValueOnce(
        createReplicateModelResponse({
          image_input: {
            type: "array",
            // Note: no items.type specified - some schemas omit this
            description: "Input images for generation",
          },
          image_urls: {
            type: "array",
            items: { type: "string" },
            description: "List of image URLs",
          },
        })
      );

      const modelId = `test/model-array-${testCounter}`;
      const request = createMockSchemaRequest(modelId, "replicate");
      const response = await GET(request, { params: Promise.resolve({ modelId }) });
      const data = await response.json();

      expect(response.status).toBe(200);

      const inputNames = data.inputs.map((i: { name: string }) => i.name);

      // Both should be classified as image inputs
      expect(inputNames).toContain("image_input");
      expect(inputNames).toContain("image_urls");
    });

    it("should NOT classify array params with non-string items as image inputs", async () => {
      mockFetch.mockResolvedValueOnce(
        createReplicateModelResponse({
          image_sizes: {
            type: "array",
            items: { type: "integer" },
            description: "List of image sizes",
          },
        })
      );

      const modelId = `test/model-array-nonstring-${testCounter}`;
      const request = createMockSchemaRequest(modelId, "replicate");
      const response = await GET(request, { params: Promise.resolve({ modelId }) });
      const data = await response.json();

      expect(response.status).toBe(200);

      const paramNames = data.parameters.map((p: { name: string }) => p.name);
      const inputNames = data.inputs.map((i: { name: string }) => i.name);

      expect(paramNames).toContain("image_sizes");
      expect(inputNames).not.toContain("image_sizes");
    });

    it("should classify prompt and negative_prompt as text inputs", async () => {
      mockFetch.mockResolvedValueOnce(
        createReplicateModelResponse({
          prompt: {
            type: "string",
            description: "Text prompt for generation",
          },
          negative_prompt: {
            type: "string",
            description: "Negative prompt",
          },
        }, ["prompt"])
      );

      const modelId = `test/model-text-${testCounter}`;
      const request = createMockSchemaRequest(modelId, "replicate");
      const response = await GET(request, { params: Promise.resolve({ modelId }) });
      const data = await response.json();

      expect(response.status).toBe(200);

      const textInputs = data.inputs.filter((i: { type: string }) => i.type === "text");
      const textInputNames = textInputs.map((i: { name: string }) => i.name);

      expect(textInputNames).toContain("prompt");
      expect(textInputNames).toContain("negative_prompt");
    });

    it("should exclude image_size from image inputs (explicit exclusion)", async () => {
      mockFetch.mockResolvedValueOnce(
        createReplicateModelResponse({
          image_size: {
            type: "string",
            description: "Output image size",
            enum: ["512x512", "1024x1024"],
          },
        })
      );

      const modelId = `test/model-imagesize-${testCounter}`;
      const request = createMockSchemaRequest(modelId, "replicate");
      const response = await GET(request, { params: Promise.resolve({ modelId }) });
      const data = await response.json();

      expect(response.status).toBe(200);

      const paramNames = data.parameters.map((p: { name: string }) => p.name);
      const inputNames = data.inputs.map((i: { name: string }) => i.name);

      // image_size should be a parameter (for selecting output size), not an image input
      expect(paramNames).toContain("image_size");
      expect(inputNames).not.toContain("image_size");
    });

    it("should handle mixed schema with correct classification", async () => {
      // Simulate the seedream-4.5 schema that caused the original bug
      mockFetch.mockResolvedValueOnce(
        createReplicateModelResponse({
          prompt: {
            type: "string",
            description: "Text prompt",
          },
          image_input: {
            type: "array",
            description: "Input images",
          },
          max_images: {
            type: "integer",
            description: "Max images",
            default: 1,
          },
          sequential_image_generation: {
            type: "string",  // enum stored as string
            description: "Generation mode",
            enum: ["disabled", "auto"],
          },
          width: {
            type: "integer",
            description: "Image width",
          },
          height: {
            type: "integer",
            description: "Image height",
          },
        }, ["prompt"])
      );

      const modelId = `bytedance/seedream-${testCounter}`;
      const request = createMockSchemaRequest(modelId, "replicate");
      const response = await GET(request, { params: Promise.resolve({ modelId }) });
      const data = await response.json();

      expect(response.status).toBe(200);

      const paramNames = data.parameters.map((p: { name: string }) => p.name);
      const imageInputNames = data.inputs.filter((i: { type: string }) => i.type === "image").map((i: { name: string }) => i.name);
      const textInputNames = data.inputs.filter((i: { type: string }) => i.type === "text").map((i: { name: string }) => i.name);

      // Image inputs
      expect(imageInputNames).toContain("image_input");
      expect(imageInputNames).toHaveLength(1);

      // Text inputs
      expect(textInputNames).toContain("prompt");

      // Parameters (NOT inputs)
      expect(paramNames).toContain("max_images");
      expect(paramNames).toContain("sequential_image_generation");
      expect(paramNames).toContain("width");
      expect(paramNames).toContain("height");

      // These should NOT be in inputs
      expect(imageInputNames).not.toContain("max_images");
      expect(imageInputNames).not.toContain("sequential_image_generation");
    });
  });

  describe("fal.ai provider", () => {
    it("should correctly classify inputs from fal.ai schema", async () => {
      mockFetch.mockResolvedValueOnce(
        createFalModelResponse({
          prompt: {
            type: "string",
            description: "Text prompt",
          },
          image_url: {
            type: "string",
            format: "uri",
            description: "Input image URL",
          },
          num_inference_steps: {
            type: "integer",
            description: "Number of inference steps",
          },
        }, ["prompt"])
      );

      const modelId = `fal-ai/flux-${testCounter}`;
      const request = createMockSchemaRequest(modelId, "fal");
      const response = await GET(request, { params: Promise.resolve({ modelId }) });
      const data = await response.json();

      expect(response.status).toBe(200);

      const imageInputNames = data.inputs.filter((i: { type: string }) => i.type === "image").map((i: { name: string }) => i.name);
      const textInputNames = data.inputs.filter((i: { type: string }) => i.type === "text").map((i: { name: string }) => i.name);
      const paramNames = data.parameters.map((p: { name: string }) => p.name);

      expect(imageInputNames).toContain("image_url");
      expect(textInputNames).toContain("prompt");
      expect(paramNames).toContain("num_inference_steps");
    });
  });

  describe("error handling", () => {
    it("should return 400 for invalid provider", async () => {
      const request = createMockSchemaRequest("test/model", "invalid");
      const response = await GET(request, { params: Promise.resolve({ modelId: "test/model" }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Invalid or missing provider");
    });

    it("should return 401 for Replicate without API key", async () => {
      delete process.env.REPLICATE_API_KEY;

      const modelId = `test/model-nokey-${testCounter}`;
      const request = createMockSchemaRequest(modelId, "replicate");
      const response = await GET(request, { params: Promise.resolve({ modelId }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Replicate API key required");
    });

    it("should handle API errors gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const modelId = `test/model-error-${testCounter}`;
      const request = createMockSchemaRequest(modelId, "replicate");
      const response = await GET(request, { params: Promise.resolve({ modelId }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });
  });

  describe("caching", () => {
    it("should return cached results on subsequent requests", async () => {
      mockFetch.mockResolvedValueOnce(
        createReplicateModelResponse({
          prompt: { type: "string" },
        })
      );

      const modelId = `cached/model-${testCounter}`;
      const request1 = createMockSchemaRequest(modelId, "replicate");
      const response1 = await GET(request1, { params: Promise.resolve({ modelId }) });
      const data1 = await response1.json();

      expect(response1.status).toBe(200);
      expect(data1.cached).toBe(false);

      // Second request should use cache
      const request2 = createMockSchemaRequest(modelId, "replicate");
      const response2 = await GET(request2, { params: Promise.resolve({ modelId }) });
      const data2 = await response2.json();

      expect(response2.status).toBe(200);
      expect(data2.cached).toBe(true);

      // Fetch should only have been called once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
