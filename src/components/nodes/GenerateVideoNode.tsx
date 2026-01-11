"use client";

import { useCallback, useState, useEffect, useMemo } from "react";
import { Handle, Position, NodeProps, Node, useReactFlow } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import { ModelParameters } from "./ModelParameters";
import { useWorkflowStore } from "@/store/workflowStore";
import { GenerateVideoNodeData, ProviderType, SelectedModel, ModelInputDef } from "@/types";
import { ProviderModel, ModelCapability } from "@/lib/providers/types";

// Video generation capabilities
const VIDEO_CAPABILITIES: ModelCapability[] = ["text-to-video", "image-to-video"];

type GenerateVideoNodeType = Node<GenerateVideoNodeData, "generateVideo">;

export function GenerateVideoNode({ id, data, selected }: NodeProps<GenerateVideoNodeType>) {
  const nodeData = data;
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const providerSettings = useWorkflowStore((state) => state.providerSettings);
  const [externalModels, setExternalModels] = useState<ProviderModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsFetchError, setModelsFetchError] = useState<string | null>(null);

  // Get the current selected provider (default to fal since Gemini doesn't do video)
  const currentProvider: ProviderType = nodeData.selectedModel?.provider || "fal";

  // Get enabled providers (exclude Gemini since it doesn't do video)
  const enabledProviders = useMemo(() => {
    const providers: { id: ProviderType; name: string }[] = [];
    // fal.ai is always available (works without key but rate limited)
    providers.push({ id: "fal", name: "fal.ai" });
    // Add Replicate if configured
    if (providerSettings.providers.replicate?.enabled && providerSettings.providers.replicate?.apiKey) {
      providers.push({ id: "replicate", name: "Replicate" });
    }
    return providers;
  }, [providerSettings]);

  // Fetch models from external providers when provider changes
  const fetchModels = useCallback(async () => {
    setIsLoadingModels(true);
    setModelsFetchError(null);
    try {
      const capabilities = VIDEO_CAPABILITIES.join(",");
      const headers: HeadersInit = {};
      if (providerSettings.providers.replicate?.apiKey) {
        headers["X-Replicate-Key"] = providerSettings.providers.replicate.apiKey;
      }
      if (providerSettings.providers.fal?.apiKey) {
        headers["X-Fal-Key"] = providerSettings.providers.fal.apiKey;
      }
      const response = await fetch(`/api/models?provider=${currentProvider}&capabilities=${capabilities}`, { headers });
      if (response.ok) {
        const data = await response.json();
        setExternalModels(data.models || []);
        setModelsFetchError(null);
      } else {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || `Failed to load models (${response.status})`;
        setExternalModels([]);
        setModelsFetchError(
          currentProvider === "replicate" && response.status === 401
            ? "Invalid Replicate API key. Check your settings."
            : errorMsg
        );
      }
    } catch (error) {
      console.error("Failed to fetch video models:", error);
      setExternalModels([]);
      setModelsFetchError("Failed to load models. Check your connection.");
    } finally {
      setIsLoadingModels(false);
    }
  }, [currentProvider, providerSettings]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Handle provider change
  const handleProviderChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const provider = e.target.value as ProviderType;
      // Set placeholder for the provider
      const newSelectedModel: SelectedModel = {
        provider,
        modelId: "",
        displayName: "Select model...",
      };
      // Clear parameters when switching providers (different providers have different schemas)
      updateNodeData(id, { selectedModel: newSelectedModel, parameters: {} });
    },
    [id, updateNodeData]
  );

  // Handle model change
  const handleModelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const modelId = e.target.value;
      const model = externalModels.find(m => m.id === modelId);
      if (model) {
        const newSelectedModel: SelectedModel = {
          provider: currentProvider,
          modelId: model.id,
          displayName: model.name,
        };
        // Clear parameters when changing models (different models have different schemas)
        updateNodeData(id, { selectedModel: newSelectedModel, parameters: {} });
      }
    },
    [id, currentProvider, externalModels, updateNodeData]
  );

  const handleClearVideo = useCallback(() => {
    updateNodeData(id, { outputVideo: null, status: "idle", error: null });
  }, [id, updateNodeData]);

  const handleParametersChange = useCallback(
    (parameters: Record<string, unknown>) => {
      updateNodeData(id, { parameters });
    },
    [id, updateNodeData]
  );

  // Handle inputs loaded from schema
  const handleInputsLoaded = useCallback(
    (inputs: ModelInputDef[]) => {
      updateNodeData(id, { inputSchema: inputs });
    },
    [id, updateNodeData]
  );

  // Handle parameters expand/collapse - resize node height
  const { setNodes } = useReactFlow();
  const handleParametersExpandChange = useCallback(
    (expanded: boolean, parameterCount: number) => {
      // Each parameter row is ~24px, plus some padding
      const parameterHeight = expanded ? Math.max(parameterCount * 28 + 16, 60) : 0;
      const baseHeight = 300; // Default node height
      const newHeight = baseHeight + parameterHeight;

      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, style: { ...node.style, height: newHeight } }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const regenerateNode = useWorkflowStore((state) => state.regenerateNode);
  const isRunning = useWorkflowStore((state) => state.isRunning);

  const handleRegenerate = useCallback(() => {
    regenerateNode(id);
  }, [id, regenerateNode]);

  return (
    <BaseNode
      id={id}
      title="Generate Video"
      customTitle={nodeData.customTitle}
      comment={nodeData.comment}
      onCustomTitleChange={(title) => updateNodeData(id, { customTitle: title || undefined })}
      onCommentChange={(comment) => updateNodeData(id, { comment: comment || undefined })}
      onRun={handleRegenerate}
      selected={selected}
      isExecuting={isRunning}
      hasError={nodeData.status === "error"}
    >
      {/* Dynamic input handles based on model schema */}
      {nodeData.inputSchema && nodeData.inputSchema.length > 0 ? (
        // Render handles from schema, sorted by type (images first, text second)
        (() => {
          const imageInputs = nodeData.inputSchema!.filter(i => i.type === "image");
          const textInputs = nodeData.inputSchema!.filter(i => i.type === "text");
          const sortedInputs = [...imageInputs, ...textInputs];

          // Calculate positions with gap between image and text groups
          const imageCount = imageInputs.length;
          const textCount = textInputs.length;
          const totalSlots = imageCount + textCount + (imageCount > 0 && textCount > 0 ? 1 : 0); // +1 for gap

          return sortedInputs.map((input, index) => {
            // Add 1 to index for text inputs if there are image inputs (to account for gap)
            const adjustedIndex = input.type === "text" && imageCount > 0 ? index + 1 : index;
            const topPercent = ((adjustedIndex + 1) / (totalSlots + 1)) * 100;
            const isImage = input.type === "image";

            return (
              <div key={input.name}>
                <Handle
                  type="target"
                  position={Position.Left}
                  id={input.name}
                  style={{ top: `calc(${topPercent}% - 5px)` }}
                  data-handletype={input.type}
                  isConnectable={true}
                  title={input.description || input.label}
                />
                {/* Handle label - positioned outside node, colored to match handle */}
                <div
                  className="absolute text-[10px] font-medium whitespace-nowrap pointer-events-none text-right"
                  style={{
                    right: `calc(100% + 14px)`,
                    top: `calc(${topPercent}% - 7px)`,
                    color: isImage ? "var(--handle-color-image)" : "var(--handle-color-text)",
                  }}
                >
                  {input.label}
                </div>
              </div>
            );
          });
        })()
      ) : (
        // Default handles when no schema
        <>
          <Handle
            type="target"
            position={Position.Left}
            id="image"
            style={{ top: "calc(35% - 5px)" }}
            data-handletype="image"
            isConnectable={true}
          />
          {/* Default image label */}
          <div
            className="absolute text-[10px] font-medium whitespace-nowrap pointer-events-none text-right"
            style={{
              right: `calc(100% + 14px)`,
              top: "calc(35% - 7px)",
              color: "var(--handle-color-image)",
            }}
          >
            Image
          </div>
          <Handle
            type="target"
            position={Position.Left}
            id="text"
            style={{ top: "calc(65% - 5px)" }}
            data-handletype="text"
          />
          {/* Default text label */}
          <div
            className="absolute text-[10px] font-medium whitespace-nowrap pointer-events-none text-right"
            style={{
              right: `calc(100% + 14px)`,
              top: "calc(65% - 7px)",
              color: "var(--handle-color-text)",
            }}
          >
            Prompt
          </div>
        </>
      )}
      {/* Video output */}
      <Handle
        type="source"
        position={Position.Right}
        id="image"
        style={{ top: "calc(50% - 5px)" }}
        data-handletype="image"
      />
      {/* Output label */}
      <div
        className="absolute text-[10px] font-medium whitespace-nowrap pointer-events-none"
        style={{
          left: `calc(100% + 14px)`,
          top: "calc(50% - 7px)",
          color: "var(--handle-color-image)",
        }}
      >
        Video
      </div>

      <div className="flex-1 flex flex-col min-h-0 gap-2">
        {/* Preview area */}
        {nodeData.outputVideo ? (
          <div className="relative w-full flex-1 min-h-0">
            <video
              src={nodeData.outputVideo}
              controls
              className="w-full h-full object-contain rounded"
              playsInline
            />
            {/* Loading overlay for generation */}
            {nodeData.status === "loading" && (
              <div className="absolute inset-0 bg-neutral-900/70 rounded flex items-center justify-center">
                <svg
                  className="w-6 h-6 animate-spin text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              </div>
            )}
            <div className="absolute top-1 right-1">
              <button
                onClick={handleClearVideo}
                className="w-5 h-5 bg-neutral-900/80 hover:bg-red-600/80 rounded flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
                title="Clear video"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full flex-1 min-h-[112px] border border-dashed border-neutral-600 rounded flex flex-col items-center justify-center">
            {nodeData.status === "loading" ? (
              <svg
                className="w-4 h-4 animate-spin text-neutral-400"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            ) : nodeData.status === "error" ? (
              <span className="text-[10px] text-red-400 text-center px-2">
                {nodeData.error || "Failed"}
              </span>
            ) : (
              <span className="text-neutral-500 text-[10px]">
                Run to generate
              </span>
            )}
          </div>
        )}

        {/* Provider selector - only show if multiple providers are enabled */}
        {enabledProviders.length > 1 && (
          <select
            value={currentProvider}
            onChange={handleProviderChange}
            className="w-full text-[10px] py-1 px-1.5 border border-neutral-700 rounded bg-neutral-900/50 focus:outline-none focus:ring-1 focus:ring-neutral-600 text-neutral-300 shrink-0"
          >
            {enabledProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        {/* Model selector */}
        {modelsFetchError ? (
          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-[9px] text-red-400">{modelsFetchError}</span>
            <button
              onClick={fetchModels}
              className="text-[9px] px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-300 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <select
            value={nodeData.selectedModel?.modelId || ""}
            onChange={handleModelChange}
            disabled={isLoadingModels}
            className="w-full text-[10px] py-1 px-1.5 border border-neutral-700 rounded bg-neutral-900/50 focus:outline-none focus:ring-1 focus:ring-neutral-600 text-neutral-300 shrink-0 disabled:opacity-50"
          >
            {isLoadingModels ? (
              <option value="">Loading models...</option>
            ) : externalModels.length === 0 ? (
              <option value="">No video models available</option>
            ) : (
              <>
                <option value="">Select model...</option>
                {externalModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </>
            )}
          </select>
        )}

        {/* Model-specific parameters */}
        {nodeData.selectedModel?.modelId && !modelsFetchError && (
          <ModelParameters
            modelId={nodeData.selectedModel.modelId}
            provider={currentProvider}
            parameters={nodeData.parameters || {}}
            onParametersChange={handleParametersChange}
            onExpandChange={handleParametersExpandChange}
            onInputsLoaded={handleInputsLoaded}
          />
        )}
      </div>
    </BaseNode>
  );
}
