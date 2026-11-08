import { config } from './config.js';
import { db, getSetting } from './db.js';
import { decryptSecret } from './secrets.js';
import { openAiTools, runTool } from './finance-tools.js';
import { nowISO, todayISO } from './util.js';

function isLocalProvider(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === 'host.docker.internal' ||
      host.endsWith('.local') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

export function getAiConfig() {
  const baseUrlRaw = (config.ai.baseUrl || getSetting('ai_base_url', '')).trim().replace(/\/+$/, '');
  const apiKey = config.ai.apiKey || decryptSecret(getSetting('ai_api_key', ''));
  const model = (config.ai.model || getSetting('ai_model', '')).trim();
  // Ollama, LM Studio and other loopback/private endpoints do not need a key;
  // a remote provider without one would fail on every request, so treat it as
  // unconfigured and show the setup screen instead.
  const keyRequired = Boolean(baseUrlRaw) && !isLocalProvider(baseUrlRaw);
  return {
    baseUrl: baseUrlRaw,
    apiKey,
    model,
    configured: Boolean(baseUrlRaw && model && (apiKey || !keyRequired)),
    envOverrides: {
      baseUrl: Boolean(config.ai.baseUrl),
      apiKey: Boolean(config.ai.apiKey),
      model: Boolean(config.ai.model),
    },
  };
}

function endpoint(baseUrl) {
  if (/\/chat\/completions$/.test(baseUrl)) return baseUrl;
  return `${baseUrl}/chat/completions`;
}

function buildSystemPrompt() {
  const currency = getSetting('currency', 'USD');
  return [
    "You are Cove, the private finance assistant inside the user's self-hosted personal finance app.",
    `Today is ${todayISO()}. The base currency is ${currency}.`,
    'Use the provided tools for every factual claim about the user\'s money. Never invent balances, transactions or categories.',
    'Amounts returned by tools are decimal currency units (for example 1234.56), not cents.',
    'If a tool returns no data, say so plainly and suggest importing transactions or connecting a bank.',
    'Be concise and practical. Use short paragraphs or bullet points and format money with a currency symbol.',
    'Do not give regulated financial advice; offer observations and options instead.',
  ].join(' ');
}

function historyMessages(limit = 16) {
  const rows = db
    .prepare("SELECT role, content FROM chat_messages WHERE role IN ('user', 'assistant') ORDER BY id DESC LIMIT ?")
    .all(limit)
    .reverse();
  return rows.filter((row) => row.content).map((row) => ({ role: row.role, content: row.content }));
}

async function parseStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finishReason = null;
  const toolCalls = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      const choice = payload.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta || {};
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        onDelta(delta.content);
      }
      for (const call of delta.tool_calls || []) {
        const index = call.index ?? toolCalls.length;
        if (!toolCalls[index]) toolCalls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        const target = toolCalls[index];
        if (call.id) target.id = call.id;
        if (call.function?.name) target.function.name += call.function.name;
        if (typeof call.function?.arguments === 'string') target.function.arguments += call.function.arguments;
        else if (call.function?.arguments && typeof call.function.arguments === 'object') {
          target.function.arguments = JSON.stringify(call.function.arguments);
        }
      }
    }
  }

  return { content, finishReason, toolCalls: toolCalls.filter((call) => call?.function?.name) };
}

/**
 * Streams an assistant answer, executing finance tools as needed.
 * Events are emitted through onEvent for the SSE transport.
 */
export async function streamChat({ userMessage, onEvent, signal }) {
  const ai = getAiConfig();
  if (!ai.configured) {
    throw new Error('The AI assistant is not configured. Add a base URL and model in Settings → Assistant.');
  }

  const userRow = db
    .prepare('INSERT INTO chat_messages (role, content, created_at) VALUES (?, ?, ?)')
    .run('user', userMessage, nowISO());

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...historyMessages(18),
    { role: 'user', content: userMessage },
  ];

  const tools = openAiTools();
  let finalText = '';
  const toolTrace = [];

  for (let round = 0; round < 6; round += 1) {
    const response = await fetch(endpoint(ai.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: ai.model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 1800,
        stream: true,
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      let detail = text.slice(0, 500);
      try {
        detail = JSON.parse(text)?.error?.message || detail;
      } catch {
        // keep raw text
      }
      throw new Error(`AI provider error (${response.status}): ${detail || response.statusText}`);
    }

    const { content, finishReason, toolCalls } = await parseStream(response, (delta) => {
      onEvent({ type: 'delta', text: delta });
    });

    finalText += content;

    if (finishReason === 'tool_calls' && toolCalls.length) {
      messages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.function.name, arguments: call.function.arguments || '{}' },
        })),
      });

      for (const call of toolCalls) {
        let args = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }
        onEvent({ type: 'tool', status: 'running', name: call.function.name, arguments: args });
        const result = await runTool(call.function.name, args);
        toolTrace.push({ name: call.function.name, arguments: args, result });
        onEvent({
          type: 'tool',
          status: 'done',
          name: call.function.name,
          error: Boolean(result?.error),
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 20_000),
        });
      }
      continue;
    }

    break;
  }

  const assistantRow = db
    .prepare('INSERT INTO chat_messages (role, content, tools, created_at) VALUES (?, ?, ?, ?)')
    .run('assistant', finalText.trim(), toolTrace.length ? JSON.stringify(toolTrace) : null, nowISO());

  return {
    id: Number(assistantRow.lastInsertRowid),
    userMessageId: Number(userRow.lastInsertRowid),
    content: finalText.trim(),
    tools: toolTrace.map((entry) => entry.name),
  };
}

export async function testAiConnection() {
  const ai = getAiConfig();
  if (!ai.configured) throw new Error('Add a base URL, model and API key first (local endpoints do not need a key)');
  const response = await fetch(endpoint(ai.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: ai.model,
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
      max_tokens: 8,
      temperature: 0,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Provider returned ${response.status}`);
  }
  return { ok: true, model: ai.model, reply: payload.choices?.[0]?.message?.content?.trim() || '' };
}

export function chatHistory(limit = 60) {
  return db
    .prepare('SELECT id, role, content, tools, created_at FROM chat_messages ORDER BY id DESC LIMIT ?')
    .all(limit)
    .reverse();
}

export function clearChatHistory() {
  db.prepare('DELETE FROM chat_messages').run();
}
