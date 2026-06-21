/**
 * Tavily MCP integration for the editor agent.
 * Connects to the Tavily remote MCP server (streamable HTTP) using TAVILY_API_KEY.
 * Client is cached per process; reconnects automatically on first use.
 */
import { MCPClient } from "@mastra/mcp";

let _client: MCPClient | null = null;

function getClient(): MCPClient | null {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;

  if (!_client) {
    _client = new MCPClient({
      servers: {
        tavily: {
          url: new URL(`https://mcp.tavily.com/mcp/?tavilyApiKey=${key}`),
        },
      },
      timeout: 30_000,
    });
  }

  return _client;
}

export async function getTavilyToolsets(): Promise<Record<string, Record<string, unknown>>> {
  const client = getClient();
  if (!client) {
    console.log("[tavily-mcp] TAVILY_API_KEY not set, skipping Tavily tools");
    return {};
  }

  try {
    const toolsets = await client.listToolsets();
    const toolCount = Object.values(toolsets).reduce(
      (n, t) => n + Object.keys(t as object).length,
      0,
    );
    console.log(`[tavily-mcp] Connected — ${toolCount} tools available`);
    return toolsets as Record<string, Record<string, unknown>>;
  } catch (err) {
    console.warn("[tavily-mcp] Failed to connect:", err instanceof Error ? err.message : err);
    return {};
  }
}

export async function disconnectTavilyMcp() {
  if (_client) {
    await _client.disconnect().catch(() => undefined);
    _client = null;
  }
}
