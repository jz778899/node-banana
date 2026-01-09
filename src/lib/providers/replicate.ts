/**
 * Replicate Provider Implementation
 *
 * Implements ProviderInterface for Replicate.com's AI model marketplace.
 * Provides model discovery via Replicate's REST API and self-registers
 * in the provider registry when imported.
 *
 * Usage:
 *   import "@/lib/providers/replicate"; // Just importing registers the provider
 *
 *   // Or get it from registry:
 *   import { getProvider } from "@/lib/providers";
 *   const replicate = getProvider("replicate");
 */

import {
  ProviderInterface,
  ProviderModel,
  ModelCapability,
  GenerationInput,
  GenerationOutput,
  registerProvider,
} from "@/lib/providers";

const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const PROVIDER_SETTINGS_KEY = "node-banana-provider-settings";

/**
 * Response schema from Replicate's list models endpoint
 */
interface ReplicateModelsResponse {
  next: string | null;
  previous: string | null;
  results: ReplicateModel[];
}

/**
 * Response schema from Replicate's search endpoint
 */
interface ReplicateSearchResponse {
  next: string | null;
  results: ReplicateSearchResult[];
}

interface ReplicateSearchResult {
  model: ReplicateModel;
}

/**
 * Model schema from Replicate API
 */
interface ReplicateModel {
  url: string;
  owner: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
  github_url?: string;
  paper_url?: string;
  license_url?: string;
  run_count: number;
  cover_image_url?: string;
  default_example?: Record<string, unknown>;
  latest_version?: {
    id: string;
    openapi_schema?: Record<string, unknown>;
  };
}

/**
 * Get API key from localStorage (client-side only)
 * Returns null when running on server or if not configured
 */
function getApiKeyFromStorage(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const settingsJson = localStorage.getItem(PROVIDER_SETTINGS_KEY);
    if (!settingsJson) return null;

    const settings = JSON.parse(settingsJson);
    return settings?.providers?.replicate?.apiKey ?? null;
  } catch {
    return null;
  }
}

/**
 * Infer model capabilities from name and description
 */
function inferCapabilities(model: ReplicateModel): ModelCapability[] {
  const capabilities: ModelCapability[] = ["text-to-image"];

  const searchText = `${model.name} ${model.description ?? ""}`.toLowerCase();

  if (
    searchText.includes("img2img") ||
    searchText.includes("image-to-image") ||
    searchText.includes("inpaint") ||
    searchText.includes("controlnet")
  ) {
    capabilities.push("image-to-image");
  }

  if (
    searchText.includes("video") ||
    searchText.includes("animate") ||
    searchText.includes("motion")
  ) {
    if (searchText.includes("img2vid") || searchText.includes("image-to-video")) {
      capabilities.push("image-to-video");
    } else {
      capabilities.push("text-to-video");
    }
  }

  return capabilities;
}

/**
 * Map Replicate model to our normalized ProviderModel format
 */
function mapToProviderModel(model: ReplicateModel): ProviderModel {
  return {
    id: `${model.owner}/${model.name}`,
    name: model.name,
    description: model.description,
    provider: "replicate",
    capabilities: inferCapabilities(model),
    coverImage: model.cover_image_url,
  };
}

/**
 * Replicate provider implementation
 */
const replicateProvider: ProviderInterface = {
  id: "replicate",
  name: "Replicate",

  async listModels(): Promise<ProviderModel[]> {
    // This method is primarily for client-side use or testing
    // Real API calls should go through the API route
    const apiKey = getApiKeyFromStorage();
    if (!apiKey) {
      console.warn("[Replicate] No API key configured, cannot list models");
      return [];
    }

    try {
      const response = await fetch(`${REPLICATE_API_BASE}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Replicate API error: ${response.status}`);
      }

      const data: ReplicateModelsResponse = await response.json();
      // Defensive null check - API may return different structure
      if (!data.results) {
        console.warn("[Replicate] List returned no results array");
        return [];
      }
      return data.results.map(mapToProviderModel);
    } catch (error) {
      console.error("[Replicate] Failed to list models:", error);
      return [];
    }
  },

  async searchModels(query: string): Promise<ProviderModel[]> {
    const apiKey = getApiKeyFromStorage();
    if (!apiKey) {
      console.warn("[Replicate] No API key configured, cannot search models");
      return [];
    }

    try {
      const response = await fetch(
        `${REPLICATE_API_BASE}/search?query=${encodeURIComponent(query)}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Replicate API error: ${response.status}`);
      }

      const data: ReplicateSearchResponse = await response.json();
      // Defensive null check - search API may return different structure
      if (!data.results) {
        console.warn("[Replicate] Search returned no results array");
        return [];
      }
      return data.results.map((result) => mapToProviderModel(result.model));
    } catch (error) {
      console.error("[Replicate] Failed to search models:", error);
      return [];
    }
  },

  async getModel(modelId: string): Promise<ProviderModel | null> {
    const apiKey = getApiKeyFromStorage();
    if (!apiKey) {
      console.warn("[Replicate] No API key configured, cannot get model");
      return null;
    }

    // modelId format: "owner/name"
    const parts = modelId.split("/");
    if (parts.length !== 2) {
      console.error("[Replicate] Invalid model ID format:", modelId);
      return null;
    }

    const [owner, name] = parts;

    try {
      const response = await fetch(
        `${REPLICATE_API_BASE}/models/${owner}/${name}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Replicate API error: ${response.status}`);
      }

      const model: ReplicateModel = await response.json();
      return mapToProviderModel(model);
    } catch (error) {
      console.error("[Replicate] Failed to get model:", error);
      return null;
    }
  },

  async generate(_input: GenerationInput): Promise<GenerationOutput> {
    // Generation will be implemented in Phase 3
    return {
      success: false,
      error: "Not implemented - generation support coming in Phase 3",
    };
  },

  isConfigured(): boolean {
    return !!getApiKeyFromStorage();
  },

  getApiKey(): string | null {
    return getApiKeyFromStorage();
  },
};

// Self-register when module is imported
registerProvider(replicateProvider);

export default replicateProvider;
