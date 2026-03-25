// server.js
// GreenLeaf Retail Co. — AI Chatbot Backend

require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const crypto    = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const { queries, initDb }                                      = require('./db');
const { detectIntent, detectEscalation, suggestQuickReplies } = require('./intent');
const { getSystemPrompt }                                      = require('./prompts');

// ── Setup ─────────────────────────────────────────────────────────────────────
const app       = express();
const PORT      = process.env.PORT || 4000;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',   // free tier model
  systemInstruction: getSystemPrompt(),
});
// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '16kb' }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (Postman, curl)
    if (!origin) return cb(null, true);
    // Allow anything in the allowed origins list
    if (allowedOrigins.includes(origin)) return cb(null, true);
    // Allow all localhost ports in development
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    // Allow GitHub Pages domain always
    if (origin.startsWith('https://ashleycodinggeek.github.io')) {
      return cb(null, true);
    }
    cb(new Error('Not allowed by CORS'));
  },
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false,
}));

// Handle OPTIONS preflight requests explicitly
app.options('*', cors());

app.use('/api/', rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max:      parseInt(process.env.RATE_LIMIT_MAX) || 60,
  message:  { error: 'Too many requests. Please wait a moment.' },
}));

function hashIp(ip) {
  return crypto
    .createHash('sha256')
    .update((ip || 'unknown') + 'greenleaf_salt')
    .digest('hex')
    .slice(0, 16);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    company:   'GreenLeaf Retail Co.',
    bot:       'Lea',
    model:     'gemini-2.5-flash',
    timestamp: new Date().toISOString(),
  });
});

// Create session
app.post('/api/sessions', (req, res) => {
  try {
    const id     = uuidv4();
    const ipHash = hashIp(req.ip);
    queries.createSession(id, ipHash);
    res.status(201).json({ session_id: id });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// End session
app.post('/api/sessions/:id/end', (req, res) => {
  try {
    const session = queries.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    queries.endSession(req.params.id);
    res.json({ message: 'Session ended', session_id: req.params.id });
  } catch (err) {
    console.error('End session error:', err);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// Get session + messages
app.get('/api/sessions/:id', (req, res) => {
  try {
    const session = queries.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const messages = queries.getSessionMessages(req.params.id);
    res.json({ session, messages });
  } catch (err) {
    console.error('Get session error:', err);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// Main chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { session_id, message } = req.body;

    if (!session_id || typeof session_id !== 'string')
      return res.status(400).json({ error: 'session_id is required' });
    if (!message || typeof message !== 'string' || !message.trim())
      return res.status(400).json({ error: 'message must not be empty' });
    if (message.length > 2000)
      return res.status(400).json({ error: 'Message too long (max 2000 characters)' });

    const session = queries.getSession(session_id);
    if (!session)         return res.status(404).json({ error: 'Session not found' });
    if (session.ended_at) return res.status(410).json({ error: 'Session has ended' });

    const userText = message.trim();
    const intent   = detectIntent(userText);

    // Save user message
    queries.saveMessage({
      session_id,
      role:         'user',
      content:      userText,
      intent,
      escalated:    0,
      response_ms:  null,
      token_input:  null,
      token_output: null,
    });

    // Get full conversation history for memory
    const history = queries.getHistory(session_id);

    // Call Gemini API
    const t0 = Date.now();
    let botReply, inputTokens = 0, outputTokens = 0;

    try {
      // Build chat history in Gemini format (all turns except the last user message)
      const geminiHistory = history.slice(0, -1).map(m => ({
        role:  m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const chat    = model.startChat({ history: geminiHistory });
      const result  = await chat.sendMessage(userText);
      botReply      = result.response.text();
      inputTokens   = result.response.usageMetadata?.promptTokenCount     || 0;
      outputTokens  = result.response.usageMetadata?.candidatesTokenCount || 0;
    } catch (aiErr) {
      console.error('Gemini API error:', aiErr.message);
      return res.status(502).json({ error: 'AI service error: ' + aiErr.message });
    }

    const responseMs  = Date.now() - t0;
    const isEscalated = detectEscalation(botReply) ? 1 : 0;

    // Save bot reply
    queries.saveMessage({
      session_id,
      role:         'assistant',
      content:      botReply,
      intent,
      escalated:    isEscalated,
      response_ms:  responseMs,
      token_input:  inputTokens,
      token_output: outputTokens,
    });

    res.json({
      reply:         botReply,
      intent,
      escalated:     !!isEscalated,
      response_ms:   responseMs,
      tokens:        { input: inputTokens, output: outputTokens },
      quick_replies: suggestQuickReplies(intent),
    });

  } catch (err) {
    console.error('Chat route error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Feedback
app.post('/api/feedback', (req, res) => {
  try {
    const { session_id, rating, comment = '' } = req.body;
    if (!session_id)
      return res.status(400).json({ error: 'session_id required' });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      return res.status(400).json({ error: 'rating must be 1–5' });

    const session = queries.getSession(session_id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    queries.saveFeedback(session_id, rating, comment.slice(0, 500));
    res.status(201).json({ message: 'Feedback saved' });
  } catch (err) {
    console.error('Feedback error:', err);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// Analytics
app.get('/api/analytics', (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id)
      return res.status(400).json({ error: 'session_id query param required' });

    const session = queries.getSession(session_id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const stats   = queries.sessionStats(session_id);
    const intents = queries.intentBreakdown(session_id);

    const intentMap = {};
    intents.forEach(r => { intentMap[r.intent] = r.count; });
    const totalUserTurns = intents.reduce((a, r) => a + r.count, 0) || 1;

    const resolved       = (stats.bot_turns || 0) - (stats.escalations || 0);
    const completionRate = stats.bot_turns
      ? Math.round((resolved / stats.bot_turns) * 100) : 0;

    res.json({
      session_id,
      metrics: {
        total_turns:     stats.total_turns,
        escalations:     stats.escalations,
        completion_rate: completionRate,
        avg_response_ms: Math.round(stats.avg_response_ms || 0),
        min_response_ms: stats.min_response_ms,
        max_response_ms: stats.max_response_ms,
      },
      intent_distribution: {
        faq:      intentMap.faq      || 0,
        order:    intentMap.order    || 0,
        returns:  intentMap.returns  || 0,
        product:  intentMap.product  || 0,
        hours:    intentMap.hours    || 0,
        payment:  intentMap.payment  || 0,
        loyalty:  intentMap.loyalty  || 0,
        escalate: intentMap.escalate || 0,
        total:    totalUserTurns,
      },
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Error handler
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start server ──────────────────────────────────────────────────────────────
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🌿 GreenLeaf Chatbot Backend`);
    console.log(`   Running at  → http://localhost:${PORT}`);
    console.log(`   Bot         → Lea (GreenLeaf Retail Co.)`);
    console.log(`   Model       → gemini-2.5-flash (free tier)`);
    console.log(`   Environment → ${process.env.NODE_ENV || 'development'}\n`);
  });
}).catch(err => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
});