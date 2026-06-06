/* ═══════════════════════════════════════════════════════════
   CodeSera — lesson-chat.js
   AI chat panel within lesson pages.
   Features:
   1. Floating chat panel (toggle show/hide)
   2. Selected text → Reply with context
   3. Expand / Tell me more buttons in content
   All data stored in localStorage — never in lesson HTML.
═══════════════════════════════════════════════════════════ */
(function() {
'use strict';

/* ── CONFIG ─────────────────────────────────────────────── */
const SERVER       = 'http://localhost:3000';
const MAX_HISTORY  = 30;  // messages per lesson
const MAX_EXPAND   = 50;  // expand entries stored

/* ── STORAGE KEYS ───────────────────────────────────────── */
const pageKey  = location.pathname; // e.g. /CourseName/lesson-1.html
const CHAT_KEY = 'lf_chat:' + pageKey;
const EXP_KEY  = 'lf_expand:' + pageKey;

/* ── READ API SETTINGS FROM MAIN APP ────────────────────── */
function getApiSettings() {
  try {
    const provider = localStorage.getItem('lf_active_provider') || 'openrouter';
    const keys     = JSON.parse(localStorage.getItem('lf_keys') || '{}');
    const cfg      = keys[provider] || {};
    return { provider, key: cfg.key || '', model: cfg.model || '', baseUrl: cfg.baseUrl || '' };
  } catch { return { provider: 'openrouter', key: '', model: '', baseUrl: '' }; }
}

function getProviderUrl(cfg) {
  const urls = {
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    chatgpt:    'https://api.openai.com/v1/chat/completions',
    deepseek:   'https://api.deepseek.com/chat/completions',
    grok:       'https://api.x.ai/v1/chat/completions',
    glm:        'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    other:      cfg.baseUrl || '',
  };
  return urls[cfg.provider] || urls.openrouter;
}

function getDefaultModel(provider) {
  const defaults = {
    openrouter: 'openrouter/auto', chatgpt: 'gpt-4o-mini',
    deepseek: 'deepseek-chat', grok: 'grok-3-mini',
    gemini: 'gemini-3.1-flash-lite', glm: 'glm-4-flash',
  };
  return defaults[provider] || '';
}

/* ── CHAT HISTORY STORAGE ───────────────────────────────── */
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(CHAT_KEY)) || []; }
  catch { return []; }
}

function saveHistory(msgs) {
  const trimmed = msgs.slice(-MAX_HISTORY);
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(trimmed)); } catch {}
}

function clearHistory() {
  localStorage.removeItem(CHAT_KEY);
}

/* ── EXPAND STORAGE ─────────────────────────────────────── */
function loadExpand() {
  try { return JSON.parse(localStorage.getItem(EXP_KEY)) || {}; }
  catch { return {}; }
}

function saveExpand(slug, html) {
  const data = loadExpand();
  data[slug] = html;
  const keys = Object.keys(data);
  if (keys.length > MAX_EXPAND) delete data[keys[0]];
  try { localStorage.setItem(EXP_KEY, JSON.stringify(data)); } catch {}
}

/* ── API CALL ───────────────────────────────────────────── */
async function callLessonApi(messages) {
  const cfg   = getApiSettings();
  if (!cfg.key) throw new Error('No API key saved. Add one in CodeSera settings.');

  const isGemini = cfg.provider === 'gemini';
  const model    = cfg.model || getDefaultModel(cfg.provider);

  let url, headers, body;

  if (isGemini) {
    url     = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-3.1-flash-lite'}:generateContent?key=${cfg.key}`;
    headers = { 'Content-Type': 'application/json' };
    body    = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: messages.map(m => m.content).join('\n\n') }] }]
    });
  } else {
    url = getProviderUrl(cfg);
    headers = {
      'Authorization': 'Bearer ' + cfg.key,
      'Content-Type':  'application/json',
      'HTTP-Referer':  location.href,
      'X-Title':       'CodeSera Chat',
    };
    body = JSON.stringify({ model, max_tokens: 2000, messages });
  }

  // Try proxy first (fixes CORS), fall back to direct
  let resp;
  try {
    resp = await fetch(SERVER + '/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, headers, body }),
    });
  } catch {
    resp = await fetch(url, { method: 'POST', headers, body });
  }

  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    let msg = 'API error ' + resp.status;
    try { msg = JSON.parse(err)?.error?.message || msg; } catch {}
    throw new Error(msg);
  }

  const data = await resp.json();
  return data?.choices?.[0]?.message?.content
      || data?.candidates?.[0]?.content?.parts?.[0]?.text
      || '';
}

/* ── SMART RETRY WRAPPER ─────────────────────────────────── */
async function callApiWithRetry(messages, maxRetries) {
  maxRetries = maxRetries || 3;
  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callLessonApi(messages);
    } catch(err) {
      var m = err.message || '';
      var isRetryable = /rate.?limit|too many requests|high demand|spikes in demand|try again later|overloaded|service unavailable|503|529|quota|tpm|tokens per minute/i.test(m);
      if (!isRetryable || attempt === maxRetries) throw err;
      var waitMatch = m.match(/retry[^0-9]*([0-9.]+)s/i);
      var waitSecs  = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) + 2
                                : [10, 20, 40][attempt] || 40;
      console.warn('CodeSera chat retry in ' + waitSecs + 's:', m.slice(0,80));
      await new Promise(function(r){ setTimeout(r, waitSecs * 1000); });
    }
  }
}

/* ── LESSON CONTEXT ─────────────────────────────────────── */
function getLessonContext() {
  const lessonTitle = document.querySelector('.page-title')?.textContent?.trim() || document.title;
  const course      = document.querySelector('.logo-text')?.childNodes?.[0]?.textContent?.trim() || '';
  const level       = document.querySelector('.page-badge')?.textContent?.trim() || '';
  const sections    = [...document.querySelectorAll('.section-title')]
    .map(e => e.textContent.replace(/^[0-9]+/, '').trim()).join(', ');
  // Get visible text summary of current viewport section
  const allText     = document.querySelector('.main-content')?.innerText?.slice(0, 1200) || '';

  return `You are a helpful AI tutor embedded in a lesson page of an online course.

COURSE: ${course}
LESSON: ${lessonTitle}
LEVEL: ${level}
TOPICS IN THIS LESSON: ${sections}

LESSON CONTENT SUMMARY:
${allText}

Instructions:
- Answer questions about this specific lesson and course
- When user says "tell me more" or "expand", elaborate on the most recently discussed topic
- Keep answers concise but complete
- Show code examples in markdown code blocks when relevant
- If asked about something not in this lesson, say so but still help`;
}

/* ── INJECT CSS ─────────────────────────────────────────── */
function injectCSS() {
  if (document.getElementById('lf-chat-css')) return;
  const style = document.createElement('style');
  style.id = 'lf-chat-css';
  style.textContent = `
/* ── Chat Panel ─────────────────────────────────────────── */
#lf-chat-btn {
  position: fixed; bottom: 68px; right: 20px; z-index: 9998;
  width: 40px; height: 40px; border-radius: 50%; border: none;
  font-size: 18px; cursor: pointer;
  background: #1e2433; color: #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,.3);
  display: flex; align-items: center; justify-content: center;
  transition: background .2s, transform .15s;
}
#lf-chat-btn:hover { transform: scale(1.08); background: #2563eb; }
#lf-chat-btn.active { background: #2563eb; }

#lf-chat-panel {
  position: fixed; bottom: 116px; right: 20px; z-index: 9997;
  width: 360px; height: 420px; min-width: 280px; min-height: 260px;
  max-width: 700px; max-height: 90vh;
  background: #111827; border-radius: 14px;
  border: 1px solid #1e2336;
  box-shadow: 0 8px 32px rgba(0,0,0,.5);
  display: flex; flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13.5px; color: #e2e8f0;
  transform: scale(.95) translateY(10px); opacity: 0;
  pointer-events: none;
  transition: transform .2s, opacity .2s;
  resize: none; /* we handle resize manually */
  overflow: hidden;
}
/* Resize handle — top-left corner */
#lf-chat-resize {
  position: absolute; top: 0; left: 0;
  width: 22px; height: 22px;
  cursor: nw-resize; z-index: 2;
  border-radius: 14px 0 0 0;
  display: flex; align-items: flex-start; justify-content: flex-start;
  padding: 4px;
}
#lf-chat-resize::after {
  content: '⠿';
  font-size: 13px;
  color: #4b6cb7;
  line-height: 1;
  transform: rotate(-45deg);
  display: block;
}
#lf-chat-resize:hover::after { color: #93c5fd; }
#lf-chat-panel.open {
  transform: scale(1) translateY(0); opacity: 1;
  pointer-events: all;
}
@media (max-width: 500px) {
  #lf-chat-panel { width: calc(100vw - 24px); right: 12px; bottom: 108px; }
}

.lfc-head {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 14px; border-bottom: 1px solid #1e2336;
  flex-shrink: 0;
}
.lfc-head-title { font-weight: 700; color: #f1f5f9; flex: 1; font-size: 13px; }
.lfc-model-sel {
  background: #1e2336; color: #94a3b8; border: 1px solid #2a3050;
  border-radius: 6px; padding: 3px 6px; font-size: 11px; cursor: pointer;
  max-width: 130px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.lfc-clear-btn {
  background: none; border: none; color: #64748b; cursor: pointer;
  font-size: 13px; padding: 2px 6px; border-radius: 4px;
}
.lfc-clear-btn:hover { color: #ef4444; background: rgba(239,68,68,.1); }

.lfc-msgs {
  flex: 1; overflow-y: auto; padding: 12px 12px 6px;
  display: flex; flex-direction: column; gap: 10px;
  scroll-behavior: smooth;
}
.lfc-msgs::-webkit-scrollbar { width: 4px; }
.lfc-msgs::-webkit-scrollbar-thumb { background: #2a3050; border-radius: 2px; }

.lfc-empty {
  color: #475569; font-size: 12px; text-align: center;
  margin: auto; padding: 20px;
}
.lfc-msg { display: flex; gap: 8px; align-items: flex-start; }
.lfc-msg.user { flex-direction: row-reverse; }
.lfc-avatar {
  width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px;
}
.lfc-msg.ai   .lfc-avatar { background: #1e3a5f; }
.lfc-msg.user .lfc-avatar { background: #1e2336; }
.lfc-bubble {
  max-width: calc(100% - 40px);
  padding: 8px 11px; border-radius: 10px;
  line-height: 1.55; font-size: 13px;
}
.lfc-msg.ai   .lfc-bubble { background: #1e2336; color: #e2e8f0; }
.lfc-msg.user .lfc-bubble { background: #2563eb; color: #fff; }
.lfc-bubble pre {
  background: #0f1117; padding: 10px 12px; border-radius: 7px;
  overflow-x: auto; font-size: 12px; margin: 6px 0;
  white-space: pre; word-break: normal;
}
.lfc-bubble code { font-family: "Fira Code", "Cascadia Code", monospace; }
.lfc-bubble p { margin: 4px 0; }
.lfc-bubble strong { color: #93c5fd; }

.lfc-context-bar {
  margin: 0 12px 6px; padding: 7px 10px;
  background: rgba(37,99,235,.15); border: 1px solid rgba(37,99,235,.3);
  border-radius: 8px; font-size: 11.5px; color: #93c5fd;
  display: flex; align-items: flex-start; gap: 6px;
}
.lfc-context-bar.hidden { display: none; }
.lfc-context-text { flex: 1; font-style: italic; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.lfc-context-clear { background: none; border: none; color: #64748b;
  cursor: pointer; padding: 0 2px; font-size: 14px; flex-shrink: 0; }

.lfc-typing { display: flex; align-items: center; gap: 4px; padding: 6px 0; }
.lfc-dot { width: 6px; height: 6px; border-radius: 50%; background: #4b6cb7;
  animation: lfcPulse 1.2s infinite ease-in-out; }
.lfc-dot:nth-child(2) { animation-delay: .2s; }
.lfc-dot:nth-child(3) { animation-delay: .4s; }
@keyframes lfcPulse { 0%,80%,100%{transform:scale(.8);opacity:.5} 40%{transform:scale(1);opacity:1} }

.lfc-form {
  padding: 10px 12px; border-top: 1px solid #1e2336; flex-shrink: 0;
  display: flex; gap: 8px; align-items: flex-end;
}
.lfc-input {
  flex: 1; background: #1e2336; border: 1px solid #2a3050;
  border-radius: 8px; padding: 8px 10px; color: #e2e8f0;
  font-family: inherit; font-size: 13px; resize: none;
  max-height: 100px; outline: none; line-height: 1.4;
}
.lfc-input:focus { border-color: #2563eb; }
.lfc-input::placeholder { color: #475569; }
.lfc-send {
  width: 34px; height: 34px; border-radius: 8px; border: none;
  background: #2563eb; color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: background .15s;
}
.lfc-send:hover { background: #1d4ed8; }
.lfc-send:disabled { background: #1e2336; color: #475569; cursor: not-allowed; }

/* ── Selection Reply Button ──────────────────────────────── */
#lfc-reply-btn {
  position: absolute; z-index: 9996;
  background: #2563eb; color: #fff; border: none;
  padding: 5px 10px; border-radius: 6px; font-size: 12px;
  cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.3);
  display: none; align-items: center; gap: 5px;
  white-space: nowrap; pointer-events: all;
  transition: background .15s;
}
#lfc-reply-btn:hover { background: #1d4ed8; }

/* ── Expand / Tell me more ───────────────────────────────── */
.lfc-expand-wrap { margin: 20px 0; }
.lfc-expand-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 16px; border-radius: 8px;
  background: var(--acc-l, #eff6ff); color: var(--accent, #2563eb);
  border: 1px dashed var(--accent, #2563eb);
  cursor: pointer; font-size: 13px; font-weight: 500;
  transition: background .15s; user-select: none;
}
.lfc-expand-btn:hover { background: #dbeafe; }
.lfc-expand-btn svg { flex-shrink: 0; }
.lfc-expand-content {
  margin-top: 12px; padding: 16px;
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e4e9f2);
  border-radius: 10px; animation: lfc-fadein .2s ease;
}
.lfc-expand-content.hidden { display: none; }
@keyframes lfc-fadein { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:none} }

/* ── Markdown render classes (lfc- prefix = no collision) ─── */
.lfc-md-h1 { font-size:15px; font-weight:700; color:#f1f5f9; margin:10px 0 4px; }
.lfc-md-h2 { font-size:13.5px; font-weight:700; color:#cbd5e1; margin:8px 0 4px; border-bottom:1px solid #1e2336; padding-bottom:3px; }
.lfc-md-h3 { font-size:13px; font-weight:600; color:#94a3b8; margin:7px 0 3px; }
.lfc-md-p  { margin:3px 0; line-height:1.6; }
.lfc-md-gap { height:6px; }
.lfc-md-ul  { margin:4px 0 4px 16px; padding:0; }
.lfc-md-ul li { margin:2px 0; line-height:1.55; }
.lfc-md-hr  { border:none; border-top:1px solid #1e2336; margin:8px 0; }
.lfc-md-a   { color:#60a5fa; text-decoration:none; }
.lfc-md-a:hover { text-decoration:underline; }
.lfc-md-ic  { background:#0f1117; color:#93c5fd; padding:1px 5px; border-radius:4px; font-family:"Fira Code",monospace; font-size:.88em; }
.lfc-md-code { border-radius:8px; overflow:hidden; margin:6px 0; border:1px solid #1e2336; }
.lfc-md-code-head { background:#1a1f2e; padding:5px 12px; display:flex; align-items:center; }
.lfc-md-lang { font-size:11px; color:#60a5fa; text-transform:uppercase; font-weight:600; letter-spacing:.05em; }
.lfc-md-code pre { margin:0; padding:12px 14px; background:#0f1117; overflow-x:auto; }
.lfc-md-code pre code { font-size:12.5px; line-height:1.6; }

.lfc-expand-loading {
  display: flex; align-items: center; gap: 8px;
  color: var(--text-muted, #6b7280); font-size: 13px; padding: 8px 0;
}
`;
  document.head.appendChild(style);
}

/* ── INJECT HTML ─────────────────────────────────────────── */
function injectPanel() {
  if (document.getElementById('lf-chat-btn')) return;

  // Chat toggle button
  const chatBtn = document.createElement('button');
  chatBtn.id = 'lf-chat-btn';
  chatBtn.title = 'AI Lesson Assistant';
  chatBtn.innerHTML = '💬';
  document.body.appendChild(chatBtn);

  // Chat panel
  const panel = document.createElement('div');
  panel.id = 'lf-chat-panel';
  panel.innerHTML = `
    <div id="lf-chat-resize" title="Drag to resize"></div>
    <div class="lfc-head">
      <span class="lfc-head-title">💬 Lesson Assistant</span>
      <select class="lfc-model-sel" id="lfc-model-sel" title="Select model"></select>
      <button class="lfc-clear-btn" id="lfc-clear-btn" title="Clear chat">🗑</button>
    </div>
    <div class="lfc-msgs" id="lfc-msgs">
      <div class="lfc-empty" id="lfc-empty">Ask anything about this lesson</div>
    </div>
    <div class="lfc-context-bar hidden" id="lfc-context-bar">
      <span>↩</span>
      <span class="lfc-context-text" id="lfc-context-text"></span>
      <button class="lfc-context-clear" id="lfc-context-clear">×</button>
    </div>
    <div class="lfc-form">
      <textarea class="lfc-input" id="lfc-input" rows="1"
        placeholder="Ask about this lesson…"></textarea>
      <button class="lfc-send" id="lfc-send" disabled>
        <svg width="14" height="14" viewBox="0 0 14 14">
          <path d="M1.5 12.5L13 7 1.5 1.5V5.5L9 7 1.5 8.5Z" fill="currentColor"/>
        </svg>
      </button>
    </div>`;
  document.body.appendChild(panel);

  // Selection reply button
  const replyBtn = document.createElement('button');
  replyBtn.id = 'lfc-reply-btn';
  replyBtn.innerHTML = '↩ Reply';
  document.body.appendChild(replyBtn);

  populateModelSel();
  wirePanel(chatBtn, panel, replyBtn);
  restoreHistory(panel);
}

/* ── POPULATE MODEL SELECTOR ─────────────────────────────── */
function populateModelSel() {
  const sel = document.getElementById('lfc-model-sel');
  if (!sel) return;
  sel.innerHTML = '';
  try {
    const provider = localStorage.getItem('lf_active_provider') || 'openrouter';
    const keys     = JSON.parse(localStorage.getItem('lf_keys') || '{}');
    const labels   = { openrouter:'OpenRouter', chatgpt:'ChatGPT', deepseek:'DeepSeek',
                       grok:'Grok', gemini:'Gemini', glm:'GLM-4', other:'Other' };
    Object.entries(keys).forEach(([k, v]) => {
      if (!v.key) return;
      const opt = document.createElement('option');
      opt.value   = k;
      const model = v.model || getDefaultModel(k);
      opt.textContent = (labels[k] || k) + (model ? ' · ' + model.split('/').pop().slice(0,15) : '');
      opt.selected    = k === provider;
      sel.appendChild(opt);
    });
    if (!sel.options.length) {
      const opt = document.createElement('option');
      opt.textContent = 'No API key saved';
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      localStorage.setItem('lf_active_provider', sel.value);
    });
  } catch {}
}

/* ── WIRE PANEL EVENTS ───────────────────────────────────── */
let _replyContext = null;

function wirePanel(chatBtn, panel, replyBtn) {
  const msgs     = document.getElementById('lfc-msgs');
  const input    = document.getElementById('lfc-input');
  const sendBtn  = document.getElementById('lfc-send');
  const clearBtn = document.getElementById('lfc-clear-btn');
  const ctxBar   = document.getElementById('lfc-context-bar');
  const ctxText  = document.getElementById('lfc-context-text');
  const ctxClear = document.getElementById('lfc-context-clear');

  // Toggle panel
  chatBtn.addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    chatBtn.classList.toggle('active', open);
    if (open) { populateModelSel(); setTimeout(() => input.focus(), 200); }
  });

  // Clear history
  clearBtn.addEventListener('click', () => {
    clearHistory();
    msgs.innerHTML = '<div class="lfc-empty" id="lfc-empty">Ask anything about this lesson</div>';
    _replyContext = null;
    ctxBar.classList.add('hidden');
  });

  // Clear context
  ctxClear.addEventListener('click', () => {
    _replyContext = null;
    ctxBar.classList.add('hidden');
  });

  // Panel resize drag
  (function() {
    const handle = document.getElementById('lf-chat-resize');
    if (!handle) return;
    let startX, startY, startW, startH, startRight, startBottom;
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startW = rect.width; startH = rect.height;
      startRight  = window.innerWidth  - rect.right;
      startBottom = window.innerHeight - rect.bottom;
      function onMove(e) {
        const dw = startX - e.clientX;
        const dh = startY - e.clientY;
        const newW = Math.max(280, Math.min(700, startW + dw));
        const newH = Math.max(300, Math.min(window.innerHeight * .9, startH + dh));
        panel.style.width  = newW + 'px';
        panel.style.height = newH + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',  onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',  onUp);
    });
  })();

  // Input auto-resize + enable send
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    sendBtn.disabled = !input.value.trim();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  sendBtn.addEventListener('click', sendMessage);

  // Selection → reply button
  document.addEventListener('mouseup', handleSelection);
  replyBtn.addEventListener('click', () => {
    const sel = window.getSelection()?.toString()?.trim();
    if (!sel) return;
    _replyContext = sel;
    ctxText.textContent = sel.slice(0, 120) + (sel.length > 120 ? '…' : '');
    ctxBar.classList.remove('hidden');
    panel.classList.add('open');
    chatBtn.classList.add('active');
    replyBtn.style.display = 'none';
    input.focus();
  });

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    const empty = document.getElementById('lfc-empty');
    if (empty) empty.remove();

    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;

    // Build user message with optional context
    const displayText = text;
    const apiText = _replyContext
      ? `Regarding this from the lesson:\n"${_replyContext}"\n\n${text}`
      : text;

    // Clear context after use
    _replyContext = null;
    ctxBar.classList.add('hidden');

    appendMsg('user', displayText, msgs);

    // Show typing indicator
    const typing = document.createElement('div');
    typing.className = 'lfc-msg ai';
    typing.innerHTML = '<div class="lfc-avatar">🤖</div><div class="lfc-typing"><div class="lfc-dot"></div><div class="lfc-dot"></div><div class="lfc-dot"></div></div>';
    msgs.appendChild(typing);
    msgs.scrollTop = msgs.scrollHeight;

    // Build message history
    const history = loadHistory();
    const apiMessages = [
      { role: 'system', content: getLessonContext() },
      ...history.map(m => ({ role: m.role, content: m.text })),
      { role: 'user', content: apiText },
    ];

    try {
      const reply = await callApiWithRetry(apiMessages);
      typing.remove();
      appendMsg('ai', reply, msgs);

      // Save to history
      history.push({ role: 'user', text: displayText });
      history.push({ role: 'assistant', text: reply });
      saveHistory(history);
    } catch(err) {
      typing.remove();
      appendMsg('ai', '⚠️ ' + err.message, msgs);
    }
    sendBtn.disabled = !input.value.trim();
  }
}

function appendMsg(role, text, container) {
  const div  = document.createElement('div');
  div.className = 'lfc-msg ' + role;
  const avatar = role === 'ai' ? '🤖' : '👤';
  div.innerHTML = `<div class="lfc-avatar">${avatar}</div><div class="lfc-bubble">${renderMd(text)}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  // Highlight code if Prism available
  if (typeof Prism !== 'undefined') Prism.highlightAllUnder(div);
}

function restoreHistory(panel) {
  const history = loadHistory();
  if (!history.length) return;
  const msgs  = document.getElementById('lfc-msgs');
  const empty = document.getElementById('lfc-empty');
  if (empty) empty.remove();
  history.forEach(m => appendMsg(m.role === 'assistant' ? 'ai' : 'user', m.text, msgs));
}

/* ── SELECTION HANDLER ───────────────────────────────────── */
function handleSelection(e) {
  const replyBtn = document.getElementById('lfc-reply-btn');
  if (!replyBtn) return;
  // Ignore clicks inside chat panel
  if (e.target.closest('#lf-chat-panel') || e.target.closest('#lf-chat-btn')) {
    replyBtn.style.display = 'none'; return;
  }
  setTimeout(() => {
    const sel = window.getSelection();
    const txt = sel?.toString()?.trim();
    if (!txt || txt.length < 10) { replyBtn.style.display = 'none'; return; }
    const range = sel.getRangeAt(0).getBoundingClientRect();
    replyBtn.style.display   = 'inline-flex';
    replyBtn.style.top       = (window.scrollY + range.bottom + 6) + 'px';
    replyBtn.style.left      = (window.scrollX + range.left) + 'px';
  }, 10);
}

document.addEventListener('mousedown', e => {
  const rb = document.getElementById('lfc-reply-btn');
  if (rb && !e.target.closest('#lfc-reply-btn')) rb.style.display = 'none';
});

/* ── MARKDOWN → HTML (minimal) ───────────────────────────── */
/* ── Markdown renderer for chat bubbles ─────────────────────
   Uses lfc- prefixed classes to avoid collision with lesson.css.
   Code highlighting via Prism (already loaded on lesson pages).
──────────────────────────────────────────────────────────── */
function escMd(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderMd(text) {
  if (!text) return '';
  const lines = text.split('\n');
  let html = '';
  let inCode = false, codeLang = '', codeLines = [];
  let inList = false;

  function flushList() {
    if (!inList) return;
    html += '<ul class="lfc-md-ul">' + inList + '</ul>';
    inList = false;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)/);
    if (fenceMatch && !inCode) {
      flushList();
      inCode = true; codeLang = fenceMatch[1] || 'text'; codeLines = [];
      continue;
    }
    if (inCode) {
      if (line.startsWith('```')) {
        const lang = codeLang || 'text';
        const code = escMd(codeLines.join('\n'));
        html += `<div class="lfc-md-code"><div class="lfc-md-code-head"><span class="lfc-md-lang">${lang}</span></div><pre><code class="language-${lang}">${code}</code></pre></div>`;
        inCode = false; codeLines = [];
      } else { codeLines.push(line); }
      continue;
    }

    // Headings (## style) — use lfc- classes not lesson.css
    if (/^#{1,3} /.test(line)) {
      flushList();
      const level = line.match(/^(#{1,3})/)[1].length;
      const txt   = inlineFormat(line.replace(/^#+\s+/, ''));
      html += `<div class="lfc-md-h${level}">${txt}</div>`;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) {
      flushList(); html += '<hr class="lfc-md-hr">'; continue;
    }

    // Unordered list
    const liMatch = line.match(/^[\-\*] (.*)/);
    if (liMatch) {
      if (!inList) inList = '';
      inList += `<li>${inlineFormat(liMatch[1])}</li>`;
      continue;
    }
    // Ordered list
    const olMatch = line.match(/^\d+\. (.*)/);
    if (olMatch) {
      if (!inList) inList = '';
      inList += `<li>${inlineFormat(olMatch[1])}</li>`;
      continue;
    }

    flushList();

    // Empty line = paragraph break
    if (line.trim() === '') {
      html += '<div class="lfc-md-gap"></div>';
      continue;
    }

    // Regular paragraph line
    html += `<p class="lfc-md-p">${inlineFormat(line)}</p>`;
  }

  flushList();
  if (inCode && codeLines.length) {
    html += `<pre><code class="language-${codeLang||'text'}">${escMd(codeLines.join('\n'))}</code></pre>`;
  }

  return html;
}

function inlineFormat(text) {
  let s = escMd(text);
  // Inline code — use lfc-md-code-inline to avoid lesson.css conflict
  s = s.replace(/`([^`]+)`/g, '<code class="lfc-md-ic">$1</code>');
  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="lfc-md-a" href="$2" target="_blank">$1</a>');
  return s;
}

/* ══════════════════════════════════════════════════════════
   EXPAND / TELL ME MORE
   Scans sections for AI-generated expand markers or injects
   expand buttons on all code-block sections.
══════════════════════════════════════════════════════════ */
function initExpandButtons() {
  // Only add "Tell me more" to sections AI marked as expandable
  // Falls back to sections longer than 400 chars if none are marked
  const markedSections = document.querySelectorAll('.section[data-expandable="true"]');
  const targetSections = markedSections.length > 0
    ? markedSections
    : [...document.querySelectorAll('.section[data-section]')].filter(
        s => s.textContent.trim().length > 400 &&
             !s.dataset.section?.includes('overview') &&
             !s.dataset.section?.includes('introduction') &&
             !s.dataset.section?.includes('summary') &&
             !s.dataset.section?.includes('learn') &&
             !s.dataset.section?.includes('objective')
      );

  targetSections.forEach(sec => {
    const slug = sec.getAttribute('data-section');
    if (!slug) return;

    const wrap = document.createElement('div');
    wrap.className = 'lfc-expand-wrap';
    wrap.dataset.slug = slug;

    const btn = document.createElement('button');
    btn.className = 'lfc-expand-btn';
    btn.innerHTML = `🤖 Tell me more`;
    btn.title = 'Generate additional details for this section with AI';

    const content = document.createElement('div');
    content.className = 'lfc-expand-content hidden';
    content.id = 'lfc-exp-' + slug;

    wrap.appendChild(btn);
    wrap.appendChild(content);
    sec.appendChild(wrap);

    // Check if already generated
    const saved = loadExpand()[slug];
    if (saved) {
      content.innerHTML = saved;
      content.classList.remove('hidden');
      btn.innerHTML = `▲ Collapse`;
      btn.dataset.open = '1';
      if (typeof Prism !== 'undefined') Prism.highlightAllUnder(content);
    }

    btn.addEventListener('click', () => toggleExpand(btn, content, sec, slug));
  });
}

async function toggleExpand(btn, content, sec, slug) {
  const isOpen = btn.dataset.open === '1';

  if (isOpen) {
    // Collapse
    content.classList.add('hidden');
    btn.innerHTML = `🤖 Tell me more`;
    btn.dataset.open = '';
    return;
  }

  // Already generated — just show
  const saved = loadExpand()[slug];
  if (saved) {
    content.innerHTML = saved;
    content.classList.remove('hidden');
    btn.innerHTML = `▲ Collapse`;
    btn.dataset.open = '1';
    if (typeof Prism !== 'undefined') Prism.highlightAllUnder(content);
    return;
  }

  // Generate
  btn.disabled = true;
  content.classList.remove('hidden');
  content.innerHTML = '<div class="lfc-expand-loading"><div class="lfc-dot"></div><div class="lfc-dot"></div><div class="lfc-dot"></div>&nbsp; Generating…</div>';

  const sectionTitle = sec.querySelector('.section-title')?.textContent?.trim() || slug;
  const sectionText  = sec.innerText?.slice(0, 800) || '';
  const lessonTitle  = document.querySelector('.page-title')?.textContent || document.title;
  const course       = document.querySelector('.logo-text')?.childNodes?.[0]?.textContent?.trim() || '';

  const systemPrompt = `You are a technical educator. Generate additional lesson content as HTML sections only.
OUTPUT: Only <section> or <div> HTML — no full page tags.
Use these lesson.css classes freely: .code-block .code-block-header .code-block-dots .code-block-lang .copy-btn .callout .tip .info .warning .danger .def-table .pill .pill-list .steps .step-num .step-body .subsection .subsection-title
Code blocks must use: <div class="code-block"><div class="code-block-header"><div class="code-block-dots"><span></span><span></span><span></span></div><span class="code-block-lang">LANG</span><button class="copy-btn">Copy</button></div><pre><code class="language-LANG">CODE</code></pre></div>
Keep it dense and practical. No exercises. Medium length (200-400 words).`;

  const userMsg = `Course: ${course}\nLesson: ${lessonTitle}\nSection: ${sectionTitle}\n\nCurrent section content (summary):\n${sectionText}\n\nGenerate additional details, more examples, edge cases, or deeper explanation for "${sectionTitle}". Continue naturally from where the section left off.`;

  try {
    const html = await callApiWithRetry([
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMsg },
    ]);

    const clean = html.replace(/^```html\s*/i,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    content.innerHTML = clean;
    saveExpand(slug, clean);
    btn.disabled = false;
    btn.innerHTML = `▲ Collapse`;
    btn.dataset.open = '1';
    if (typeof Prism !== 'undefined') Prism.highlightAllUnder(content);
  } catch(err) {
    content.innerHTML = `<p style="color:var(--red,#ef4444)">⚠️ ${err.message}</p>`;
    btn.disabled = false;
  }
}

/* ── INIT ────────────────────────────────────────────────── */
function init() {
  injectCSS();
  injectPanel();
  initExpandButtons();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
