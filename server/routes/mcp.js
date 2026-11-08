import { Router } from 'express';
import { authenticateMcp, handleMcpMessages } from '../mcp.js';

const router = Router();

router.post('/', async (req, res) => {
  const client = authenticateMcp(req);
  if (!client) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="cove"');
    return res.status(401).json({
      jsonrpc: '2.0',
      id: req.body?.id ?? null,
      error: { code: -32001, message: 'Unauthorized: send an MCP token from Settings → Connections as a Bearer token' },
    });
  }

  try {
    const response = await handleMcpMessages(req.body, req);
    if (!response) return res.status(202).end();
    res.json(response);
  } catch (error) {
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body?.id ?? null,
      error: { code: -32603, message: 'Internal error', data: String(error.message || error) },
    });
  }
});

router.get('/', (req, res) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32000, message: 'Use POST for the Streamable HTTP MCP endpoint' },
  });
});

router.delete('/', (req, res) => {
  res.setHeader('Allow', 'POST');
  res.status(405).end();
});

export default router;
