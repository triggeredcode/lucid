import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SocketBackend, socketPathFor } from "./socket";
import { createLucidMcpServer } from "./server";

/**
 * `lucid-mcp`: the Model Context Protocol server for Lucid, over stdio. The Lucid app must be running: it owns the pages
 * and the editor, and this process asks it over a local socket (so what an agent does is one undo step on screen).
 *
 *   claude mcp add lucid -- node packages/mcp/dist/lucid-mcp.mjs
 */
const server = createLucidMcpServer(new SocketBackend(socketPathFor()));
await server.connect(new StdioServerTransport());
