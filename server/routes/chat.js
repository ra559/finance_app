import { Router } from 'express';
import { chatHistory, clearChatHistory, getAiConfig, streamChat } from '../ai.js';

const router = Router();

router.get('/', (req, res) => {
  const ai = getAiConfig();
  res.json({
    messages: chatHistory(),
    configured: ai.configured,
    model: ai.model,
    baseUrl: ai.baseUrl,
  });
});

router.delete('/', (req, res) => {
  clearChatHistory();
  res.json({ ok: true });
});

router.post('/', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Ask a question first' });
  if (message.length > 4000) return res.status(400).json({ error: 'Message is too long (max 4000 characters)' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const controller = new AbortController();
  // `req` emits close once its body has been consumed, which would abort the
  // provider call immediately. Only a closed *response* means the browser left.
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onClose);

  try {
    const result = await streamChat({ userMessage: message, onEvent: send, signal: controller.signal });
    send({ type: 'done', content: result.content, tools: result.tools, id: result.id });
  } catch (error) {
    if (!controller.signal.aborted) {
      send({ type: 'error', error: error.message || 'The assistant could not answer right now.' });
    }
  } finally {
    res.off('close', onClose);
    res.end();
  }
});

export default router;
