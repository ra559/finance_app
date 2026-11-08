import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Icon from '../icons.jsx';
import { Badge, Button, Card, EmptyState, PageHeader } from '../components.jsx';
import { useApp, useRouter } from '../state.jsx';
import { formatDate } from '../format.js';
import { initials } from '../format.js';

const SUGGESTIONS = [
  'How much did I spend on dining last month?',
  'What is my budget progress this month?',
  'Which subscriptions am I paying for?',
  'How has my net worth changed this year?',
  'What are my biggest merchants this month?',
  'How much did I save last month?',
];

const TOOL_LABELS = {
  get_financial_overview: 'Reading your overview',
  get_spending: 'Checking spending',
  list_transactions: 'Searching transactions',
  get_budget_status: 'Checking budgets',
  get_cashflow: 'Crunching cash flow',
  get_net_worth: 'Calculating net worth',
  get_recurring_bills: 'Looking up bills',
  get_investments: 'Reading portfolio',
  get_income: 'Checking income',
  get_accounts: 'Reading accounts',
  list_categories: 'Listing categories',
};

function parseTools(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.map((entry) => ({ name: entry.name, status: 'done' })) : [];
  } catch {
    return [];
  }
}

export default function AssistantPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);
  const { user } = useApp();
  const { navigate } = useRouter();

  const load = useCallback(async () => {
    try {
      const result = await api.get('/chat');
      setConfigured(result.configured);
      setModel(result.model);
      setMessages(
        result.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          tools: parseTools(message.tools),
          createdAt: message.created_at,
        })),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, streaming]);

  const patchAssistant = (patch) => {
    setMessages((current) => {
      const copy = [...current];
      for (let index = copy.length - 1; index >= 0; index -= 1) {
        if (copy[index].role === 'assistant') {
          copy[index] = { ...copy[index], ...patch };
          break;
        }
      }
      return copy;
    });
  };

  const addTool = (status, name) => {
    setMessages((current) => {
      const copy = [...current];
      for (let index = copy.length - 1; index >= 0; index -= 1) {
        if (copy[index].role !== 'assistant') continue;
        const tools = [...(copy[index].tools || [])];
        const existing = tools.findIndex((tool) => tool.name === name);
        if (existing >= 0) tools[existing] = { name, status };
        else tools.push({ name, status });
        copy[index] = { ...copy[index], tools };
        break;
      }
      return copy;
    });
  };

  const send = async (override) => {
    const text = String(override ?? input).trim();
    if (!text || streaming) return;
    setInput('');
    setError('');
    setStreaming(true);
    setMessages((current) => [
      ...current,
      { role: 'user', content: text },
      { role: 'assistant', content: '', tools: [], pending: true },
    ]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-cove-client': 'web' },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok || !response.body) {
        let message = `Request failed (${response.status})`;
        try {
          const payload = await response.json();
          message = payload.error || message;
        } catch {
          // keep default
        }
        throw new Error(message);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamed = '';

      const handleEvent = (event) => {
        if (event.type === 'delta' && event.text) {
          streamed += event.text;
          patchAssistant({ content: streamed, pending: true });
        } else if (event.type === 'tool') {
          addTool(event.status, event.name);
        } else if (event.type === 'done') {
          patchAssistant({
            content: event.content || streamed || 'I could not find an answer to that.',
            tools: (event.tools || []).map((name) => ({ name, status: 'done' })),
            pending: false,
          });
        } else if (event.type === 'error') {
          patchAssistant({ content: event.error || 'The assistant hit an error.', pending: false, error: true });
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
          const line = chunk
            .split('\n')
            .map((entry) => entry.trim())
            .find((entry) => entry.startsWith('data:'));
          if (!line) continue;
          try {
            handleEvent(JSON.parse(line.slice(5).trim()));
          } catch {
            // ignore malformed keepalives
          }
        }
      }

      patchAssistant((current) => ({ pending: false }));
    } catch (err) {
      patchAssistant({ content: err.message, pending: false, error: true });
      setError(err.message);
    } finally {
      setStreaming(false);
      setMessages((current) =>
        current.map((message) =>
          message.role === 'assistant' && !message.content && !message.pending
            ? { ...message, content: 'The assistant did not return an answer.' }
            : message,
        ),
      );
    }
  };

  const clear = async () => {
    try {
      await api.del('/chat');
      setMessages([]);
    } catch (err) {
      setError(err.message);
    }
  };

  const header = (
    <PageHeader title="Assistant" subtitle="Ask questions about your money, answered from your own data.">
      <Button variant="ghost" icon="trash" onClick={clear} disabled={!messages.length || streaming}>
        Clear
      </Button>
    </PageHeader>
  );

  if (!configured) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon="assistant"
            title="Connect an AI provider"
            description="Cove works with any OpenAI-compatible endpoint: OpenAI, OpenRouter, LM Studio, or a local Ollama server. Your data is sent only to the provider you choose — Ollama keeps it on this machine."
            action={
              <Button icon="settings" onClick={() => navigate('/settings')}>
                Open assistant settings
              </Button>
            }
          />
        </Card>
        <Card className="span-12" title="Suggested privacy setup" style={{ marginTop: 16 }}>
          <div className="stack-sm">
            <div className="kv">
              <span>Fully local</span>
              <strong>Ollama at http://host.docker.internal:11434/v1</strong>
            </div>
            <div className="kv">
              <span>Cloud</span>
              <strong>OpenAI or OpenRouter with a limited API key</strong>
            </div>
            <div className="kv">
              <span>What is shared</span>
              <strong>Your question plus the aggregates or transactions a tool reads</strong>
            </div>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      {error ? <div className="inline-error" style={{ marginBottom: 12 }}><Icon name="alert" size={16} /><span>{error}</span></div> : null}

      <div className="chat-shell">
        <div className="chat-head">
          <div className="chat-head-id">
            <span className="chat-orb">
              <Icon name="assistant" size={16} />
            </span>
            <div>
              <h2>Cove Assistant</h2>
              <p>{model ? `Using ${model}` : 'Your finance data, explained'}</p>
            </div>
          </div>
          <Badge color="var(--accent)">Read-only access</Badge>
        </div>

        <div className="chat-scroll" ref={scrollRef}>
          {!messages.length && !loading ? (
            <div className="chat-empty">
              <span className="chat-orb">
                <Icon name="assistant" size={24} />
              </span>
              <h2>What do you want to know?</h2>
              <p>
                I can read your Cove data — spending, budgets, cash flow, net worth, bills and investments — and answer
                with actual numbers. I never change anything.
              </p>
              <div className="suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" className="suggestion" onClick={() => send(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <div key={message.id || index} className={`msg ${message.role === 'user' ? 'msg-user' : 'msg-assistant'}`}>
                <span className="msg-avatar">
                  {message.role === 'user' ? initials(user?.name, user?.email) : <Icon name="assistant" size={14} />}
                </span>
                <div>
                  <div className={`msg-body ${message.error ? 'msg-error' : ''}`}>
                    {message.content || (message.pending ? (
                      <span className="typing">
                        <span />
                        <span />
                        <span />
                      </span>
                    ) : null)}
                  </div>
                  {message.tools?.length ? (
                    <div className="msg-tools">
                      {message.tools.map((tool, toolIndex) => (
                        <span key={`${tool.name}-${toolIndex}`} className={`tool-chip ${tool.status === 'running' ? 'running' : ''}`}>
                          {tool.status === 'running' ? <span className="spinner spinner-sm" /> : <Icon name="check" size={10} />}
                          {TOOL_LABELS[tool.name] || tool.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {message.createdAt ? <div className="msg-time">{formatDate(message.createdAt.slice(0, 10))}</div> : null}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="chat-input-wrap">
          <div className="chat-input">
            <textarea
              className="input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Ask about your spending, budgets, bills or net worth…"
              rows={1}
              disabled={streaming}
            />
            <Button icon="send" onClick={() => send()} loading={streaming} disabled={!input.trim()}>
              Ask
            </Button>
          </div>
          <div className="chat-hint">
            Answers come from your local data via tool calls. Check important numbers. Enter to send, Shift+Enter for a new line.
          </div>
        </div>
      </div>
    </>
  );
}
