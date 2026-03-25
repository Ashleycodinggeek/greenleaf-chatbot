// src/api.js — Backend API client
// All communication with the Express backend goes through here.

const BASE_URL = window.CHATBOT_API_URL || 'http://localhost:4000/api';

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(BASE_URL + path, opts);
  const data = await res.json();

  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

/** Create a new session for the chosen scenario */
export async function createSession(scenario) {
  return request('POST', '/sessions', { scenario });
}

/** End a session */
export async function endSession(sessionId) {
  return request('POST', `/sessions/${sessionId}/end`);
}

/** Get session detail + messages */
export async function getSession(sessionId) {
  return request('GET', `/sessions/${sessionId}`);
}

// ── Chat ──────────────────────────────────────────────────────────────────────

/** Send a user message, receive bot reply + metadata */
export async function sendMessage(sessionId, message) {
  return request('POST', '/chat', { session_id: sessionId, message });
}

// ── Feedback ──────────────────────────────────────────────────────────────────

/** Submit a satisfaction rating (1–5) */
export async function submitFeedback(sessionId, rating, comment = '') {
  return request('POST', '/feedback', { session_id: sessionId, rating, comment });
}

// ── Analytics ─────────────────────────────────────────────────────────────────

/** Get session-level analytics metrics */
export async function getAnalytics(sessionId) {
  const url = sessionId ? `/analytics?session_id=${sessionId}` : '/analytics';
  return request('GET', url);
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function healthCheck() {
  return request('GET', '/health');
}
