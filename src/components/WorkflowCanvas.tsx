"use client";

import { useCallback, useRef, useState, useEffect, DragEvent } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  NodeTypes,
  EdgeTypes,
  Connection,
  Edge,
  useReactFlow,
  ReactFlowProvider,
  OnConnectEnd,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useWorkflowStore, WorkflowFile } from "@/store/workflowStore";
import {
  ImageInputNode,
  AnnotationNode,
  PromptNode,
  NanoBananaNode,
  LLMGenerateNode,
  OutputNode,
} from "./nodes";
import { EditableEdge } from "./edges";
import { ConnectionDropMenu } from "./ConnectionDropMenu";
import { NodeType } from "@/types";

const nodeTypes: NodeTypes = {
  imageInput: ImageInputNode,
  annotation: AnnotationNode,
  prompt: PromptNode,
  nanoBanana: NanoBananaNode,
  llmGenerate: LLMGenerateNode,
  output: OutputNode,
};

const edgeTypes: EdgeTypes = {
  editable: EditableEdge,
};

// Connection validation rules
// - Image handles (green) can only connect to image handles
// - Text handles (blue) can only connect to text handles
// - NanoBanana image input accepts multiple connections
// - All other inputs accept only one connection
const isValidConnection = (connection: Edge | Connection): boolean => {
  const sourceHandle = connection.sourceHandle;
  const targetHandle = connection.targetHandle;

  // Strict type matching: image <-> image, text <-> text
  if (sourceHandle === "image" && targetHandle !== "image") {
    return false;
  }
  if (sourceHandle === "text" && targetHandle !== "text") {
    return false;
  }

  return true;
};

interface ConnectionDropState {
  position: { x: number; y: number };
  flowPosition: { x: number; y: number };
  handleType: "image" | "text" | null;
  connectionType: "source" | "target";
  sourceNodeId: string | null;
  sourceHandleId: string | null;
}

function WorkflowCanvasInner() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode, updateNodeData, loadWorkflow } =
    useWorkflowStore();
  const { screenToFlowPosition } = useReactFlow();
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropType, setDropType] = useState<"image" | "workflow" | null>(null);
  const [connectionDrop, setConnectionDrop] = useState<ConnectionDropState | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection)) return;

      // Get all selected nodes
      const selectedNodes = nodes.filter((node) => node.selected);
      const sourceNode = nodes.find((node) => node.id === connection.source);

      // If the source node is selected and there are multiple selected nodes,
      // connect all selected nodes that have the same source handle type
      if (sourceNode?.selected && selectedNodes.length > 1 && connection.sourceHandle) {
        selectedNodes.forEach((node) => {
          // Skip if this is already the connection source
          if (node.id === connection.source) {
            onConnect(connection);
            return;
          }

          // Create connection from this selected node to the same target
          const multiConnection: Connection = {
            source: node.id,
            sourceHandle: connection.sourceHandle,
            target: connection.target,
            targetHandle: connection.targetHandle,
          };

          if (isValidConnection(multiConnection)) {
            onConnect(multiConnection);
          }
        });
      } else {
        // Single connection
        onConnect(connection);
      }
    },
    [onConnect, nodes]
  );

  // Handle connection dropped on empty space
  const handleConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      // Only show menu if connection was not completed (dropped on empty space)
      if (!connectionState.isValid && connectionState.fromNode) {
        const { clientX, clientY } = event as MouseEvent;

        // Get the handle type from the connection state
        const handleId = connectionState.fromHandle?.id || null;
        const handleType = (handleId === "image" || handleId === "text") ? handleId : null;

        // Determine if we're dragging from a source or target handle
        const connectionType = connectionState.fromHandle?.type === "source" ? "source" : "target";

        const flowPos = screenToFlowPosition({ x: clientX, y: clientY });

        setConnectionDrop({
          position: { x: clientX, y: clientY },
          flowPosition: flowPos,
          handleType,
          connectionType,
          sourceNodeId: connectionState.fromNode.id,
          sourceHandleId: handleId,
        });
      }
    },
    [screenToFlowPosition]
  );

  // Handle node selection from drop menu
  const handleNodeSelect = useCallback(
    (nodeType: NodeType) => {
      if (!connectionDrop) return;

      const { flowPosition, sourceNodeId, sourceHandleId, connectionType, handleType } = connectionDrop;

      // Create the new node at the drop position
      const newNodeId = addNode(nodeType, flowPosition);

      // Determine the correct handle IDs for the new node based on its type
      let targetHandleId: string | null = null;
      let sourceHandleIdForNewNode: string | null = null;

      // Map handle type to the correct handle ID based on node type
      if (handleType === "image") {
        if (nodeType === "annotation" || nodeType === "output") {
          targetHandleId = "image";
        } else if (nodeType === "nanoBanana") {
          targetHandleId = "image";
        } else if (nodeType === "imageInput") {
          sourceHandleIdForNewNode = "image";
        }
      } else if (handleType === "text") {
        if (nodeType === "nanoBanana" || nodeType === "llmGenerate") {
          targetHandleId = "text";
          // llmGenerate also has a text output
          if (nodeType === "llmGenerate") {
            sourceHandleIdForNewNode = "text";
          }
        } else if (nodeType === "prompt") {
          sourceHandleIdForNewNode = "text";
        }
      }

      // Create the connection based on which direction we're connecting
      if (connectionType === "source" && sourceNodeId && sourceHandleId && targetHandleId) {
        // Dragging from source (output), connect to new node's input
        const connection: Connection = {
          source: sourceNodeId,
          sourceHandle: sourceHandleId,
          target: newNodeId,
          targetHandle: targetHandleId,
        };
        onConnect(connection);
      } else if (connectionType === "target" && sourceNodeId && sourceHandleId && sourceHandleIdForNewNode) {
        // Dragging from target (input), connect from new node's output
        const connection: Connection = {
          source: newNodeId,
          sourceHandle: sourceHandleIdForNewNode,
          target: sourceNodeId,
          targetHandle: sourceHandleId,
        };
        onConnect(connection);
      }

      setConnectionDrop(null);
    },
    [connectionDrop, addNode, onConnect]
  );

  const handleCloseDropMenu = useCallback(() => {
    setConnectionDrop(null);
  }, []);

  // Keyboard shortcuts for stacking selected nodes
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const selectedNodes = nodes.filter((node) => node.selected);
      if (selectedNodes.length < 2) return;

      const STACK_GAP = 20;

      if (event.key === "v" || event.key === "V") {
        // Stack vertically - sort by current y position to maintain relative order
        const sortedNodes = [...selectedNodes].sort((a, b) => a.position.y - b.position.y);

        // Use the leftmost x position as the alignment point
        const alignX = Math.min(...sortedNodes.map((n) => n.position.x));

        let currentY = sortedNodes[0].position.y;

        sortedNodes.forEach((node) => {
          const nodeHeight = (node.style?.height as number) || (node.measured?.height) || 200;

          onNodesChange([
            {
              type: "position",
              id: node.id,
              position: { x: alignX, y: currentY },
            },
          ]);

          currentY += nodeHeight + STACK_GAP;
        });
      } else if (event.key === "h" || event.key === "H") {
        // Stack horizontally - sort by current x position to maintain relative order
        const sortedNodes = [...selectedNodes].sort((a, b) => a.position.x - b.position.x);

        // Use the topmost y position as the alignment point
        const alignY = Math.min(...sortedNodes.map((n) => n.position.y));

        let currentX = sortedNodes[0].position.x;

        sortedNodes.forEach((node) => {
          const nodeWidth = (node.style?.width as number) || (node.measured?.width) || 220;

          onNodesChange([
            {
              type: "position",
              id: node.id,
              position: { x: currentX, y: alignY },
            },
          ]);

          currentX += nodeWidth + STACK_GAP;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nodes, onNodesChange]);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";

    // Check if dragging files that are images or JSON
    const items = Array.from(event.dataTransfer.items);
    const hasImageFile = items.some(
      (item) => item.kind === "file" && item.type.startsWith("image/")
    );
    const hasJsonFile = items.some(
      (item) => item.kind === "file" && item.type === "application/json"
    );

    if (hasJsonFile) {
      setIsDragOver(true);
      setDropType("workflow");
    } else if (hasImageFile) {
      setIsDragOver(true);
      setDropType("image");
    }
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    setDropType(null);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      setDropType(null);

      const allFiles = Array.from(event.dataTransfer.files);

      // Check for JSON workflow files first
      const jsonFiles = allFiles.filter((file) => file.type === "application/json" || file.name.endsWith(".json"));
      if (jsonFiles.length > 0) {
        const file = jsonFiles[0];
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const workflow = JSON.parse(e.target?.result as string) as WorkflowFile;
            if (workflow.version && workflow.nodes && workflow.edges) {
              loadWorkflow(workflow);
            } else {
              alert("Invalid workflow file format");
            }
          } catch {
            alert("Failed to parse workflow file");
          }
        };
        reader.readAsText(file);
        return;
      }

      // Handle image files
      const imageFiles = allFiles.filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) return;

      // Get the drop position in flow coordinates
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      // Create a node for each dropped image
      imageFiles.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;

          // Create image to get dimensions
          const img = new Image();
          img.onload = () => {
            // Add the node at the drop position (offset for multiple files)
            const nodeId = addNode("imageInput", {
              x: position.x + index * 240,
              y: position.y,
            });

            // Update the node with the image data
            updateNodeData(nodeId, {
              image: dataUrl,
              filename: file.name,
              dimensions: { width: img.width, height: img.height },
            });
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(file);
      });
    },
    [screenToFlowPosition, addNode, updateNodeData, loadWorkflow]
  );

  return (
    <div
      ref={reactFlowWrapper}
      className={`flex-1 bg-canvas-bg relative ${isDragOver ? "ring-2 ring-inset ring-blue-500" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay indicator */}
      {isDragOver && (
        <div className="absolute inset-0 bg-blue-500/10 z-50 pointer-events-none flex items-center justify-center">
          <div className="bg-neutral-800 border border-neutral-600 rounded-lg px-6 py-4 shadow-xl">
            <p className="text-neutral-200 text-sm font-medium">
              {dropType === "workflow" ? "Drop to load workflow" : "Drop image to create node"}
            </p>
          </div>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        isValidConnection={isValidConnection}
        fitView
        deleteKeyCode={["Backspace", "Delete"]}
        multiSelectionKeyCode="Shift"
        selectionOnDrag={false}
        panOnDrag
        className="bg-neutral-900"
        defaultEdgeOptions={{
          type: "editable",
          animated: false,
        }}
      >
        <Background color="#404040" gap={20} size={1} />
        <Controls className="bg-neutral-800 border border-neutral-700 rounded-lg shadow-lg [&>button]:bg-neutral-800 [&>button]:border-neutral-700 [&>button]:fill-neutral-300 [&>button:hover]:bg-neutral-700 [&>button:hover]:fill-neutral-100" />
        <MiniMap
          className="bg-neutral-800 border border-neutral-700 rounded-lg shadow-lg"
          maskColor="rgba(0, 0, 0, 0.6)"
          nodeColor={(node) => {
            switch (node.type) {
              case "imageInput":
                return "#3b82f6";
              case "annotation":
                return "#8b5cf6";
              case "prompt":
                return "#f97316";
              case "nanoBanana":
                return "#22c55e";
              case "llmGenerate":
                return "#06b6d4";
              case "output":
                return "#ef4444";
              default:
                return "#94a3b8";
            }
          }}
        />
      </ReactFlow>

      {/* Connection drop menu */}
      {connectionDrop && connectionDrop.handleType && (
        <ConnectionDropMenu
          position={connectionDrop.position}
          handleType={connectionDrop.handleType}
          connectionType={connectionDrop.connectionType}
          onSelect={handleNodeSelect}
          onClose={handleCloseDropMenu}
        />
      )}
    </div>
  );
}

// Wrap with ReactFlowProvider to enable useReactFlow hook
export function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner />
    </ReactFlowProvider>
  );
}
