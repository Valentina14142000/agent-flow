import React, { useState, useCallback } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
} from '@xyflow/react';

// Include the ReactFlow styles directly
import '@xyflow/react/dist/style.css';

// Initial visual nodes representing our agent flow
const initialNodes = [
  {
    id: 'node_retrieve',
    type: 'default',
    data: { label: '🔍 Retrieve Context (Qdrant)' },
    position: { x: 100, y: 150 },
    style: { padding: 10, borderRadius: 5, border: '1px solid #ddd', transition: 'all 0.5s ease' },
  },
  {
    id: 'node_agent',
    type: 'default',
    data: { label: '🧠 Gemini Writer (LLM)' },
    position: { x: 350, y: 150 },
    style: { padding: 10, borderRadius: 5, border: '1px solid #ddd', transition: 'all 0.5s ease' },
  },
  {
    id: 'node_evaluator',
    type: 'default',
    data: { label: '📝 Memory Extractor' },
    position: { x: 600, y: 150 },
    style: { padding: 10, borderRadius: 5, border: '1px solid #ddd', transition: 'all 0.5s ease' },
  },
];

const initialEdges = [
  { id: 'edge_1', source: 'node_retrieve', target: 'node_agent', animated: true },
  { id: 'edge_2', source: 'node_agent', target: 'node_evaluator', animated: true },
];

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState([]);

  // Handle manual edge drawing
  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  // Trigger the Server-Sent Events execution loop from FastAPI
  const runWorkflow = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setLogs((prev) => [...prev, '🚀 Starting Workflow Execution...']);

    // Reset node styles to default before running
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        style: { ...n.style, border: '1px solid #ddd', boxShadow: 'none', background: '#fff' },
      }))
    );

    try {
      const response = await fetch('/api/graph/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphId: 'usr_flow',
          nodes: nodes.map((n) => ({
            id: n.id,
            type: n.id === 'node_agent' ? 'llmNode' : n.id === 'node_retrieve' ? 'retrievalNode' : 'utilityNode',
            position: n.position,
            data: n.data,
          })),
          edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
          })),
        }),
      });

      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // Keep partial line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          // Parse SSE stream format
          const eventMatch = line.match(/^event:\s*(.*)$/m);
          const dataMatch = line.match(/^data:\s*(.*)$/m);

          if (eventMatch && dataMatch) {
            const eventType = eventMatch[1].trim();
            const eventData = JSON.parse(dataMatch[1].trim());

            if (eventType === 'node_start') {
              setLogs((prev) => [...prev, `⏳ Node started: ${eventData.label}`]);
              // Glow the node yellow when active
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === eventData.nodeId
                    ? {
                        ...n,
                        style: {
                          ...n.style,
                          border: '2px solid #eab308',
                          boxShadow: '0 0 15px rgba(234, 179, 8, 0.6)',
                          background: '#fef9c3',
                        },
                      }
                    : n
                )
              );
            } else if (eventType === 'node_complete') {
              setLogs((prev) => [
                ...prev,
                `✅ Node finished: ${eventData.nodeId} -> ${JSON.stringify(eventData.output)}`,
              ]);
              // Turn the completed node vibrant green
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === eventData.nodeId
                    ? {
                        ...n,
                        style: {
                          ...n.style,
                          border: '2px solid #22c55e',
                          boxShadow: '0 0 15px rgba(34, 197, 94, 0.6)',
                          background: '#f0fdf4',
                        },
                      }
                    : n
                )
              );
            } else if (eventType === 'graph_complete') {
              setLogs((prev) => [...prev, '🎉 Agent execution complete!']);
            }
          }
        }
      }
    } catch (err) {
      setLogs((prev) => [...prev, `❌ Connection error: ${err.message}`]);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', fontFamily: 'sans-serif', background: '#fafafa' }}>
      {/* Left Canvas Panel */}
      <div style={{ flex: 1, height: '100%' }}>
        <div style={{ padding: '10px', background: '#fff', borderBottom: '1px solid #eee', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '18px', color: '#333' }}>🤖 Agent-Flow Studio</h2>
          <button
            onClick={runWorkflow}
            disabled={isRunning}
            style={{
              padding: '8px 16px',
              backgroundColor: isRunning ? '#cbd5e1' : '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: isRunning ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
            }}
          >
            {isRunning ? 'Running...' : 'Run Agent Graph 🚀'}
          </button>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <Controls />
          <MiniMap />
          <Background variant="dots" gap={12} size={1} />
        </ReactFlow>
      </div>

      {/* Right Log Panel */}
      <div style={{ width: '350px', background: '#0f172a', color: '#38bdf8', padding: '15px', display: 'flex', flexDirection: 'column', borderLeft: '1px solid #334155' }}>
        <h3 style={{ margin: '0 0 10px 0', color: '#f8fafc', borderBottom: '1px solid #334155', paddingBottom: '10px' }}>📟 Execution Terminal</h3>
        <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {logs.length === 0 ? (
            <span style={{ color: '#64748b' }}>Waiting for run signal...</span>
          ) : (
            logs.map((log, i) => <div key={i}>{log}</div>)
          )}
        </div>
      </div>
    </div>
  );
}
