import { db } from './db.js';
import { runTool, toolDescriptors } from './finance-tools.js';
import { nowISO, sha256 } from './util.js';

// Protocol revisions this server understands. Older clients do the initialize
// handshake; newer ones send per-request metadata. Both are accepted.
const SUPPORTED_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'];
const DEFAULT_VERSION = '2025-06-18';

export function createMcpToken(name) {
  const raw = `cove_mcp_${Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0'),
  ).join('')}`;
  db.prepare('INSERT INTO mcp_tokens (name, token_hash, prefix, created_at) VALUES (?, ?, ?, ?)').run(
    name || 'MCP client',
    sha256(raw),
    raw.slice(0, 16),
    nowISO(),
  );
  return raw;
}

export function listMcpTokens() {
  return db
    .prepare('SELECT id, name, prefix, created_at, last_used_at FROM mcp_tokens ORDER BY id DESC')
    .all();
}

export function revokeMcpToken(id) {
  db.prepare('DELETE FROM mcp_tokens WHERE id = ?').run(id);
}

export function authenticateMcp(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  const row = db.prepare('SELECT * FROM mcp_tokens WHERE token_hash = ?').get(sha256(token));
  if (!row) return null;
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 60_000) {
    db.prepare('UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?').run(nowISO(), row.id);
  }
  return { id: row.id, name: row.name };
}

const SERVER_INFO = { name: 'cove-finance', title: 'Cove Personal Finance', version: '1.0.0' };

const INSTRUCTIONS = [
  'Cove exposes read-only access to the user\'s personal finance database: spending, income, budgets,',
  'accounts, net worth, recurring bills and investment holdings. Amounts are decimal currency units.',
  'Use get_financial_overview first for broad questions, then the more specific tools.',
].join(' ');

function negotiateVersion(requested) {
  return SUPPORTED_VERSIONS.includes(requested) ? requested : DEFAULT_VERSION;
}

function jsonRpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

async function handleSingle(message, req) {
  const { id, method, params } = message || {};
  const isNotification = id === undefined || id === null;

  if (!method || typeof method !== 'string') {
    return isNotification ? null : jsonRpcError(id, -32600, 'Invalid Request: missing method');
  }

  if (isNotification) {
    // notifications/initialized, notifications/cancelled, etc.
    return null;
  }

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: negotiateVersion(requested),
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: toolDescriptors() } };
    case 'tools/call': {
      const name = params?.name;
      if (!name) return jsonRpcError(id, -32602, 'Invalid params: tool name is required');
      const tool = toolDescriptors().find((entry) => entry.name === name);
      if (!tool) return jsonRpcError(id, -32602, `Unknown tool: ${name}`);
      const result = await runTool(name, params?.arguments || {});
      const isError = Boolean(result?.error);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: isError ? `Error: ${result.error}` : JSON.stringify(result, null, 2),
            },
          ],
          isError,
        },
      };
    }
    case 'resources/list':
      return { jsonrpc: '2.0', id, result: { resources: [] } };
    case 'prompts/list':
      return { jsonrpc: '2.0', id, result: { prompts: [] } };
    case 'notifications/initialized':
      return null;
    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

/** Stateless Streamable HTTP handler. Returns the JSON-RPC response body. */
export async function handleMcpMessages(body, req) {
  if (Array.isArray(body)) {
    if (!body.length) return jsonRpcError(null, -32600, 'Invalid Request: empty batch');
    const responses = [];
    for (const message of body) {
      const response = await handleSingle(message, req);
      if (response) responses.push(response);
    }
    return responses.length ? responses : null;
  }
  return handleSingle(body, req);
}

export function mcpEndpointInfo() {
  return {
    protocolVersions: SUPPORTED_VERSIONS,
    tools: toolDescriptors().map((tool) => ({ name: tool.name, description: tool.description })),
  };
}
