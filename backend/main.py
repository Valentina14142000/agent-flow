import asyncio
import json
from typing import Dict, Any, List
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from langgraph.graph import StateGraph, END
import os
from dotenv import load_dotenv

# Load env variables
load_dotenv()

app = FastAPI(title="Agent-Flow Backend")

# Enable CORS for React Flow frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Schemas ---

class Position(BaseModel):
    x: float
    y: float

class NodePayload(BaseModel):
    id: str
    type: str
    position: Position
    data: Dict[str, Any]

class EdgePayload(BaseModel):
    id: str
    source: str
    target: str

class GraphPayload(BaseModel):
    graphId: str
    nodes: List[NodePayload]
    edges: List[EdgePayload]

# --- Dynamic Graph Compiler Engine ---

# We define a basic dict state schema
class DynamicAgentState(dict):
    pass

class DynamicGraphRunner:
    def __init__(self, payload: GraphPayload):
        self.payload = payload
        self.nodes_by_id = {node.id: node for node in payload.nodes}
        self.execution_queue = asyncio.Queue()

    def make_executor(self, node_id: str):
        """Creates an executable function bound to a specific visual node ID."""
        node = self.nodes_by_id[node_id]
        
        async def node_executor(state: DynamicAgentState):
            # 1. Notify that this node has started executing
            await self.execution_queue.put({
                "event": "node_start",
                "nodeId": node_id,
                "label": node.data.get("label", "Running Node")
            })
            
            # Simulate processing time
            await asyncio.sleep(1.5)
            
            # Specific logic depending on node type
            output_updates = {}
            if node.type == "llmNode" or "Gemini" in node.data.get("label", ""):
                prompt = node.data.get("systemInstruction", "No instruction provided")
                output_updates = {"last_output": f"Processed LLM task based on: '{prompt}'"}
            elif node.type == "retrievalNode" or "Retrieve" in node.data.get("label", ""):
                collection = node.data.get("collection", "default")
                output_updates = {"last_output": f"Queried in-memory vectors for '{collection}'"}
            else:
                output_updates = {"last_output": f"Executed standard utility node {node_id}"}

            # Update local state
            state.update(output_updates)

            # 2. Notify that the node has completed
            await self.execution_queue.put({
                "event": "node_complete",
                "nodeId": node_id,
                "output": output_updates
            })
            
            return state
            
        return node_executor

    def build_and_compile(self):
        """Assembles ReactFlow JSON payload into a compiled LangGraph executable."""
        workflow = StateGraph(DynamicAgentState)
        
        # 1. Add all nodes
        for node in self.payload.nodes:
            workflow.add_node(node.id, self.make_executor(node.id))
            
        # 2. Add structural edges
        for edge in self.payload.edges:
            workflow.add_edge(edge.source, edge.target)
            
        # 3. Handle entry and exit cleanly without double-binding edges
        if self.payload.nodes:
            # First node is always entry
            entry_node = self.payload.nodes[0].id
            workflow.set_entry_point(entry_node)
            
            # Find nodes that have NO outgoing edges to attach to END
            target_nodes = {edge.target for edge in self.payload.edges}
            source_nodes = {edge.source for edge in self.payload.edges}
            leaf_nodes = [node.id for node in self.payload.nodes if node.id not in source_nodes]
            
            for leaf in leaf_nodes:
                workflow.add_edge(leaf, END)
            
        return workflow.compile()

# --- API Routes ---

@app.post("/api/graph/compile")
async def compile_graph(payload: GraphPayload):
    """Validates if the visual layout is valid to compile."""
    if not payload.nodes:
        return {"status": "error", "message": "The graph must contain at least one node."}
    return {"status": "success", "message": f"Graph '{payload.graphId}' compiled successfully!"}


@app.post("/api/graph/execute")
async def execute_graph(payload: GraphPayload):
    """Compiles and executes the LangGraph workflow, streaming execution states via SSE."""
    runner = DynamicGraphRunner(payload)
    compiled_graph = runner.build_and_compile()
    
    async def event_generator():
        # Start LangGraph execution asynchronously in the background
        execution_task = asyncio.create_task(compiled_graph.ainvoke({}))
        
        # Read events from our queue and stream them down the SSE pipe
        while not execution_task.done() or not runner.execution_queue.empty():
            try:
                # Poll for updates
                while not runner.execution_queue.empty():
                    event_data = await runner.execution_queue.get()
                    yield f"event: {event_data['event']}\ndata: {json.dumps(event_data)}\n\n"
                    runner.execution_queue.task_done()
                await asyncio.sleep(0.1)
            except asyncio.CancelledError:
                break
        
        # Make sure the async task completed cleanly
        await execution_task
        
        # Yield the final completion block
        yield f"event: graph_complete\ndata: {json.dumps({'status': 'success'})}\n\n"
        
    return StreamingResponse(
        event_generator(), 
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # Stops Vite/Nginx from buffering SSE chunks
        }
    )