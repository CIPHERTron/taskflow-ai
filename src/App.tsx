import React, { useState, useCallback, useEffect } from "react";
import {
  ReactFlow,
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Position,
  Handle,
} from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import { Drawer, Card, Tag, Intent, Button } from "@blueprintjs/core";
import "@xyflow/react/dist/style.css";
import "@blueprintjs/core/lib/css/blueprint.css";

const CustomNode = ({ data, selected }: { data: any; selected: any }) => {
  const [isVisible, setIsVisible] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const getNodeStyle = () => {
    const baseStyle = {
      padding: "8px 16px",
      boxShadow:
        "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
      borderRadius: "6px",
      border: "2px solid",
      cursor: "pointer",
      transition: "all 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
      minWidth: "120px",
      textAlign: "center" as const,
      transform: isVisible
        ? "scale(1) translateY(0)"
        : "scale(0.3) translateY(-20px)",
      opacity: isVisible ? 1 : 0,
    };

    if (selected) {
      return {
        ...baseStyle,
        borderColor: "#3B82F6",
        backgroundColor: "#EFF6FF",
      };
    }

    switch (data.type) {
      case "start":
        return {
          ...baseStyle,
          borderColor: "#10B981",
          backgroundColor: "#F0FDF4",
        };
      case "end":
        return {
          ...baseStyle,
          borderColor: "#EF4444",
          backgroundColor: "#FEF2F2",
        };
      case "parallel":
        return {
          ...baseStyle,
          borderColor: "#8B5CF6",
          backgroundColor: "#FAF5FF",
        };
      case "analysis":
        return {
          ...baseStyle,
          borderColor: "#F59E0B",
          backgroundColor: "#FFFBEB",
        };
      default:
        return {
          ...baseStyle,
          borderColor: "#9CA3AF",
          backgroundColor: "#FFFFFF",
        };
    }
  };

  const getStatusStyle = () => {
    const baseStyle = {
      fontSize: "11px",
      marginTop: "4px",
      padding: "2px 8px",
      borderRadius: "4px",
      display: "inline-block",
    };

    switch (data.status) {
      case "completed":
        return {
          ...baseStyle,
          backgroundColor: "#D1FAE5",
          color: "#065F46",
        };
      case "running":
        return {
          ...baseStyle,
          backgroundColor: "#FEF3C7",
          color: "#92400E",
        };
      case "pending":
        return {
          ...baseStyle,
          backgroundColor: "#F3F4F6",
          color: "#374151",
        };
      default:
        return {
          ...baseStyle,
          backgroundColor: "#FEE2E2",
          color: "#991B1B",
        };
    }
  };

  return (
    <div style={getNodeStyle()}>
      <Handle
        type="target"
        position={Position.Top}
        style={{ width: "8px", height: "8px" }}
      />
      <div style={{ fontSize: "12px", fontWeight: "bold", color: "#1F2937" }}>
        {data.label}
      </div>
      {data.status && <div style={getStatusStyle()}>{data.status}</div>}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ width: "8px", height: "8px" }}
      />
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

const initialNodes = [
  {
    id: "1",
    type: "custom",
    position: { x: 400, y: 0 },
    data: {
      label: "Deployment Started",
      type: "start",
      status: "completed",
      description: "AI agent initiated deployment verification process",
      timestamp: "2024-06-12T10:00:00Z",
      duration: "2s",
    },
  },
  {
    id: "2",
    type: "custom",
    position: { x: 400, y: 100 },
    data: {
      label: "Connect to APM Tool",
      type: "process",
      status: "completed",
      description:
        "Establishing connection to Application Performance Monitoring tool",
      timestamp: "2024-06-12T10:00:02Z",
      duration: "5s",
    },
  },
  {
    id: "3",
    type: "custom",
    position: { x: 200, y: 200 },
    data: {
      label: "Collect Pre-deployment Data",
      type: "parallel",
      status: "completed",
      description: "Gathering baseline metrics before deployment",
      timestamp: "2024-06-12T10:00:07Z",
      duration: "30s",
    },
  },
  {
    id: "4",
    type: "custom",
    position: { x: 600, y: 200 },
    data: {
      label: "Monitor System Health",
      type: "parallel",
      status: "running",
      description: "Continuous monitoring of system health metrics",
      timestamp: "2024-06-12T10:00:07Z",
      duration: "ongoing",
    },
  },
  {
    id: "5",
    type: "custom",
    position: { x: 100, y: 300 },
    data: {
      label: "CPU Metrics",
      type: "data",
      status: "completed",
      description: "Collecting CPU utilization and performance data",
      timestamp: "2024-06-12T10:00:10Z",
      duration: "15s",
    },
  },
  {
    id: "6",
    type: "custom",
    position: { x: 300, y: 300 },
    data: {
      label: "Memory Usage",
      type: "data",
      status: "completed",
      description: "Gathering memory consumption patterns",
      timestamp: "2024-06-12T10:00:10Z",
      duration: "15s",
    },
  },
  {
    id: "7",
    type: "custom",
    position: { x: 500, y: 300 },
    data: {
      label: "Response Times",
      type: "data",
      status: "completed",
      description: "Measuring API response time baselines",
      timestamp: "2024-06-12T10:00:15Z",
      duration: "20s",
    },
  },
  {
    id: "8",
    type: "custom",
    position: { x: 700, y: 300 },
    data: {
      label: "Error Rate Tracking",
      type: "data",
      status: "running",
      description: "Monitoring error rates and exception patterns",
      timestamp: "2024-06-12T10:00:15Z",
      duration: "ongoing",
    },
  },
  {
    id: "9",
    type: "custom",
    position: { x: 400, y: 400 },
    data: {
      label: "Execute Deployment",
      type: "process",
      status: "completed",
      description: "Running the actual deployment process",
      timestamp: "2024-06-12T10:01:00Z",
      duration: "2m 30s",
    },
  },
  {
    id: "10",
    type: "custom",
    position: { x: 200, y: 500 },
    data: {
      label: "Collect Post-deployment Data",
      type: "parallel",
      status: "running",
      description: "Gathering metrics after deployment completion",
      timestamp: "2024-06-12T10:03:30Z",
      duration: "ongoing",
    },
  },
  {
    id: "11",
    type: "custom",
    position: { x: 600, y: 500 },
    data: {
      label: "Run Health Checks",
      type: "parallel",
      status: "running",
      description: "Performing comprehensive health validation",
      timestamp: "2024-06-12T10:03:30Z",
      duration: "ongoing",
    },
  },
  {
    id: "12",
    type: "custom",
    position: { x: 400, y: 600 },
    data: {
      label: "Compare Metrics",
      type: "analysis",
      status: "pending",
      description: "AI analysis comparing pre and post deployment data",
      timestamp: "pending",
      duration: "estimated 1m",
    },
  },
  {
    id: "13",
    type: "custom",
    position: { x: 400, y: 700 },
    data: {
      label: "Generate Report",
      type: "process",
      status: "pending",
      description: "Creating comprehensive deployment verification report",
      timestamp: "pending",
      duration: "estimated 30s",
    },
  },
  {
    id: "14",
    type: "custom",
    position: { x: 400, y: 800 },
    data: {
      label: "Verification Complete",
      type: "end",
      status: "pending",
      description: "Deployment verification process completed",
      timestamp: "pending",
      duration: "N/A",
    },
  },
];

const initialEdges = [
  { id: "e1-2", source: "1", target: "2", animated: true },
  { id: "e2-3", source: "2", target: "3", animated: true },
  { id: "e2-4", source: "2", target: "4", animated: true },
  { id: "e3-5", source: "3", target: "5", animated: true },
  { id: "e3-6", source: "3", target: "6", animated: true },
  { id: "e4-7", source: "4", target: "7", animated: true },
  { id: "e4-8", source: "4", target: "8", animated: true },
  { id: "e5-9", source: "5", target: "9", animated: false },
  { id: "e6-9", source: "6", target: "9", animated: false },
  { id: "e7-9", source: "7", target: "9", animated: false },
  { id: "e8-9", source: "8", target: "9", animated: false },
  { id: "e9-10", source: "9", target: "10", animated: true },
  { id: "e9-11", source: "9", target: "11", animated: true },
  { id: "e10-12", source: "10", target: "12", animated: false },
  { id: "e11-12", source: "11", target: "12", animated: false },
  { id: "e12-13", source: "12", target: "13", animated: false },
  { id: "e13-14", source: "13", target: "14", animated: false },
];

export default function AIAgentFlow() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [visibleNodeCount, setVisibleNodeCount] = useState(0);
  const [isAnimating, setIsAnimating] = useState(true);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // Real-time animation effect
  useEffect(() => {
    if (visibleNodeCount < initialNodes.length) {
      const timer = setTimeout(() => {
        setVisibleNodeCount((prev) => prev + 1);
      }, 2000);

      return () => clearTimeout(timer);
    } else {
      setIsAnimating(false);
    }
  }, [visibleNodeCount]);

  // Update visible nodes and edges with zoom management
  useEffect(() => {
    const currentNodes = initialNodes.slice(0, visibleNodeCount);
    const currentEdges = initialEdges.filter((edge) => {
      const sourceExists = currentNodes.some((node) => node.id === edge.source);
      const targetExists = currentNodes.some((node) => node.id === edge.target);
      return sourceExists && targetExists;
    });

    setNodes(currentNodes);
    setEdges(currentEdges);

    // Auto-fit view when nodes are added to keep everything visible
    if (visibleNodeCount > 0 && reactFlowInstance) {
      setTimeout(() => {
        reactFlowInstance.fitView({
          padding: 0.2,
          minZoom: 0.1,
          maxZoom: 0.8,
          duration: 800,
        });
      }, 100);
    }
  }, [visibleNodeCount, setNodes, setEdges, reactFlowInstance]);

  const onInit = useCallback((instance: any) => {
    setReactFlowInstance(instance);
    // Initial fit view with better settings
    setTimeout(() => {
      instance.fitView({
        padding: 0.2,
        minZoom: 0.1,
        maxZoom: 0.8,
      });
    }, 100);
  }, []);

  const onConnect = useCallback(
    (params: any) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((event: any, node: any) => {
    setSelectedNode(node);
    setIsDrawerOpen(true);
  }, []);

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedNode(null);
  };

  const resetAnimation = () => {
    setVisibleNodeCount(0);
    setIsAnimating(true);
    setIsDrawerOpen(false);
    setSelectedNode(null);
  };

  const getStatusIntent = (status: any) => {
    switch (status) {
      case "completed":
        return Intent.SUCCESS;
      case "running":
        return Intent.PRIMARY;
      case "pending":
        return Intent.NONE;
      case "error":
        return Intent.DANGER;
      default:
        return Intent.NONE;
    }
  };

  return (
    <div
      style={{ width: "100vw", height: "100vh", backgroundColor: "#f9fafb" }}
    >
      {/* Control Panel */}
      <div
        style={{
          position: "absolute",
          top: "20px",
          left: "20px",
          zIndex: 10,
          display: "flex",
          gap: "10px",
          alignItems: "center",
        }}
      >
        <Button
          onClick={resetAnimation}
          intent={Intent.PRIMARY}
          disabled={isAnimating && visibleNodeCount > 0}
        >
          {isAnimating ? "Animating..." : "Restart Animation"}
        </Button>
        <div
          style={{
            backgroundColor: "white",
            padding: "8px 12px",
            borderRadius: "6px",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
            fontSize: "14px",
            fontWeight: "500",
          }}
        >
          Progress: {visibleNodeCount}/{initialNodes.length} events
        </div>
        {isAnimating && (
          <div
            style={{
              backgroundColor: "#EFF6FF",
              color: "#1E40AF",
              padding: "8px 12px",
              borderRadius: "6px",
              fontSize: "14px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "#3B82F6",
                animation: "pulse 2s infinite",
              }}
            ></div>
            Real-time simulation active
          </div>
        )}
      </div>

      <div style={{ width: "100%", height: "100%" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onInit={onInit}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{
            padding: 0.2,
            minZoom: 0.1,
            maxZoom: 0.8,
          }}
          defaultViewport={{ x: 0, y: 0, zoom: 0.3 }}
          minZoom={0.1}
          maxZoom={2}
          style={{ backgroundColor: "#f9fafb" }}
        >
          <Controls
            style={{
              backgroundColor: "white",
              boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
              borderRadius: "8px",
            }}
          />
          <MiniMap
            style={{
              backgroundColor: "white",
              boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
              borderRadius: "8px",
            }}
            nodeColor={(node) => {
              switch (node.data.type) {
                case "start":
                  return "#10B981";
                case "end":
                  return "#EF4444";
                case "parallel":
                  return "#8B5CF6";
                case "analysis":
                  return "#F59E0B";
                default:
                  return "#6B7280";
              }
            }}
          />
          <Background gap={12} size={1} />

          <style>{`
            @keyframes pulse {
              0%, 100% {
                opacity: 1;
              }
              50% {
                opacity: 0.5;
              }
            }
            
            @keyframes slideInFromTop {
              0% {
                transform: translateY(-20px) scale(0.8);
                opacity: 0;
              }
              100% {
                transform: translateY(0) scale(1);
                opacity: 1;
              }
            }
            
            .react-flow__node {
              animation: slideInFromTop 0.6s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            .react-flow__edge {
              animation: slideInFromTop 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            .react-flow__edge-path {
              stroke-dasharray: 5;
              stroke-dashoffset: 5;
              animation: dash 0.8s ease-in-out;
            }
            
            @keyframes dash {
              from {
                stroke-dashoffset: 5;
              }
              to {
                stroke-dashoffset: 0;
              }
            }
          `}</style>
        </ReactFlow>
      </div>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={closeDrawer}
        title="Event Details"
        position="right"
        size="400px"
        className="bp4-dark"
      >
        {selectedNode && (
          <div style={{ padding: "16px" }}>
            <Card elevation={2}>
              <h3
                style={{
                  fontSize: "18px",
                  fontWeight: "bold",
                  marginBottom: "12px",
                  color: "#111827",
                }}
              >
                {selectedNode.data.label}
              </h3>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: "500",
                      color: "#374151",
                      marginBottom: "4px",
                    }}
                  >
                    Status
                  </label>
                  <Tag intent={getStatusIntent(selectedNode.data.status)} large>
                    {selectedNode.data.status}
                  </Tag>
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: "500",
                      color: "#374151",
                      marginBottom: "4px",
                    }}
                  >
                    Description
                  </label>
                  <p style={{ fontSize: "14px", color: "#6B7280" }}>
                    {selectedNode.data.description}
                  </p>
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: "500",
                      color: "#374151",
                      marginBottom: "4px",
                    }}
                  >
                    Event Type
                  </label>
                  <Tag minimal>{selectedNode.data.type}</Tag>
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: "500",
                      color: "#374151",
                      marginBottom: "4px",
                    }}
                  >
                    Timestamp
                  </label>
                  <p
                    style={{
                      fontSize: "14px",
                      color: "#6B7280",
                      fontFamily: "monospace",
                    }}
                  >
                    {selectedNode.data.timestamp}
                  </p>
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: "500",
                      color: "#374151",
                      marginBottom: "4px",
                    }}
                  >
                    Duration
                  </label>
                  <p style={{ fontSize: "14px", color: "#6B7280" }}>
                    {selectedNode.data.duration}
                  </p>
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: "500",
                      color: "#374151",
                      marginBottom: "4px",
                    }}
                  >
                    Node ID
                  </label>
                  <p
                    style={{
                      fontSize: "14px",
                      color: "#6B7280",
                      fontFamily: "monospace",
                    }}
                  >
                    {selectedNode.id}
                  </p>
                </div>

                {selectedNode.data.type === "parallel" && (
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "14px",
                        fontWeight: "500",
                        color: "#374151",
                        marginBottom: "4px",
                      }}
                    >
                      Execution Type
                    </label>
                    <Tag intent={Intent.WARNING}>Parallel Execution</Tag>
                  </div>
                )}

                {selectedNode.data.status === "running" && (
                  <div
                    style={{
                      marginTop: "16px",
                      padding: "12px",
                      backgroundColor: "#EFF6FF",
                      borderRadius: "8px",
                    }}
                  >
                    <p style={{ fontSize: "14px", color: "#1E40AF" }}>
                      🔄 This event is currently in progress. Real-time data
                      collection active.
                    </p>
                  </div>
                )}

                {selectedNode.data.status === "pending" && (
                  <div
                    style={{
                      marginTop: "16px",
                      padding: "12px",
                      backgroundColor: "#F9FAFB",
                      borderRadius: "8px",
                    }}
                  >
                    <p style={{ fontSize: "14px", color: "#6B7280" }}>
                      ⏳ This event is queued and waiting for prerequisites to
                      complete.
                    </p>
                  </div>
                )}
              </div>
            </Card>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: "16px",
              }}
            >
              <Button onClick={closeDrawer} intent={Intent.PRIMARY}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
