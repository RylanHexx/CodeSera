/* ═══════════════════════════════════════════════════════
   CodeSera — api.js
   API key storage, modal UI, callAPI(), generateLesson()
═══════════════════════════════════════════════════════ */

'use strict';

/* ── STORAGE — per-provider keys ───────────────────────── */
// lf_keys = { openrouter: {key, model}, chatgpt: {key}, ... }
// lf_active_provider = "openrouter"

function _loadKeys() {
  try { return JSON.parse(localStorage.getItem('lf_keys')) || {}; } catch { return {}; }
}
function _saveKeys(obj) { localStorage.setItem('lf_keys', JSON.stringify(obj)); }

function getApiKey(provider) {
  provider = provider || getProvider();
  return (_loadKeys()[provider] || {}).key || '';
}
function getOrModel() { return _getProviderModel('openrouter') || 'openrouter/auto'; }
function _getProviderModel(provider) {
  return (_loadKeys()[provider] || {}).model || '';
}
function _getOtherBaseUrl() { return (_loadKeys()['other'] || {}).baseUrl || ''; }
function getProvider() {
  return localStorage.getItem('lf_active_provider') || 'openrouter';
}
function hasApiKey(provider) { return !!getApiKey(provider || getProvider()); }

function saveProviderKey(provider, key, modelId, otherBaseUrl) {
  const keys = _loadKeys();
  keys[provider] = { key };
  if (modelId)      keys[provider].model   = modelId;
  if (otherBaseUrl) keys[provider].baseUrl = otherBaseUrl;
  _saveKeys(keys);
  localStorage.setItem('lf_active_provider', provider);
}

function setActiveProvider(provider) {
  if (hasApiKey(provider)) localStorage.setItem('lf_active_provider', provider);
}

/* ── MODAL ──────────────────────────────────────────────── */
function openApiModal() {
  const modal   = document.getElementById('apiModal');
  const provSel = document.getElementById('apiProviderSel');
  const orField = document.getElementById('orModelField');
  const hint    = document.getElementById('apiProviderHint');

  provSel.value = getProvider();
  _refreshModalKey(provSel.value);
  updateModalUI(provSel.value, orField, hint);
  _renderSavedKeysList();
  modal.classList.remove('hidden');
}

function _refreshModalKey(provider) {
  const keyInput   = document.getElementById('apiKeyInput');
  const modelInput = document.getElementById('orModelInput');
  const otherBase  = document.getElementById('otherBaseUrl');
  const keys       = _loadKeys();
  if (keyInput)   keyInput.value   = getApiKey(provider);
  if (modelInput) modelInput.value = _getProviderModel(provider) || (PROVIDERS[provider]?.defaultModel || '');
  if (otherBase)  otherBase.value  = (keys['other'] || {}).baseUrl || '';
}

function updateModalUI(provider, orField, hint) {
  const cfg        = PROVIDERS[provider];
  const otherField = document.getElementById('otherFields');
  const modelLabel = document.getElementById('modelInputLabel');
  if (!cfg) return;
  // Model input always shown — label changes per provider
  orField.classList.remove('hidden');
  const def = cfg.defaultModel || '';
  if (modelLabel) modelLabel.textContent = `Model ID (default: ${def || 'auto'})`;
  const inp = document.getElementById('orModelInput');
  if (inp) inp.placeholder = def || 'Leave blank for default';
  if (otherField) otherField.classList.toggle('hidden', provider !== 'other');
  hint.innerHTML = cfg.hint || '';
}

function _renderSavedKeysList() {
  const container = document.getElementById('savedKeysList');
  if (!container) return;
  const keys = _loadKeys();
  const entries = Object.entries(keys).filter(([,v]) => v.key);
  if (entries.length === 0) {
    container.innerHTML = '<div class="skl-empty">No keys saved yet.</div>';
    return;
  }
  container.innerHTML = entries.map(([prov, v]) => {
    const cfg    = PROVIDERS[prov];
    const active = getProvider() === prov ? ' skl-active' : '';
    const masked = v.key.slice(0,6) + '••••••' + v.key.slice(-4);
    const sub    = prov === 'other' && v.baseUrl
      ? `<span class="skl-key" style="font-size:10px">${v.baseUrl.slice(0,40)}</span>`
      : `<span class="skl-key">${masked}</span>`;
    return `<div class="skl-row${active}" data-prov="${prov}">
      <span class="skl-label">${cfg ? cfg.label : prov}</span>
      ${sub}
      <button class="skl-use" data-prov="${prov}">Use</button>
      <button class="skl-del" data-del="${prov}">×</button>
    </div>`;
  }).join('');
}

function initApiModal() {
  const modal     = document.getElementById('apiModal');
  const provSel   = document.getElementById('apiProviderSel');
  const keyInput  = document.getElementById('apiKeyInput');
  const orField   = document.getElementById('orModelField');
  const orInput   = document.getElementById('orModelInput');
  const hint      = document.getElementById('apiProviderHint');
  const toggleBtn = document.getElementById('apiKeyToggle');
  const saveBtn   = document.getElementById('apiModalSave');
  const cancelBtn = document.getElementById('apiModalCancel');
  const closeBtn  = document.getElementById('apiModalClose');
  const apiKeyBtn = document.getElementById('apiKeyBtn');
  const savedList = document.getElementById('savedKeysList');

  apiKeyBtn.addEventListener('click', openApiModal);

  provSel.addEventListener('change', () => {
    updateModalUI(provSel.value, orField, hint);
    _refreshModalKey(provSel.value);
  });

  toggleBtn.addEventListener('click', () => {
    const isPass = keyInput.type === 'password';
    keyInput.type = isPass ? 'text' : 'password';
    toggleBtn.textContent = isPass ? 'Hide' : 'Show';
  });

  saveBtn.addEventListener('click', () => {
    const key      = keyInput.value.trim();
    const modelId  = document.getElementById('orModelInput')?.value.trim() || '';
    const baseUrl  = document.getElementById('otherBaseUrl')?.value.trim()  || '';

    if (!key) {
      keyInput.style.borderColor = 'var(--red)';
      setTimeout(() => keyInput.style.borderColor = '', 1500);
      return;
    }
    if (provSel.value === 'other' && !baseUrl) {
      const el = document.getElementById('otherBaseUrl');
      if (el) { el.style.borderColor = 'var(--red)'; setTimeout(() => el.style.borderColor = '', 1500); }
      showApiToast('⚠️ Base URL is required for Other provider.');
      return;
    }
    saveProviderKey(provSel.value, key, modelId, baseUrl);
    _renderSavedKeysList();
    updateApiKeyBtn();
    _syncModelSelector();
    showApiToast('✅ Key saved for ' + (PROVIDERS[provSel.value]?.label || provSel.value));
  });

  // Saved keys list — delegate Use / delete
  if (savedList) {
    savedList.addEventListener('click', e => {
      const useBtn = e.target.closest('.skl-use');
      const delBtn = e.target.closest('.skl-del');
      if (useBtn) {
        setActiveProvider(useBtn.dataset.prov);
        _renderSavedKeysList();
        updateApiKeyBtn();
        _syncModelSelector();
        showApiToast(`Switched to ${PROVIDERS[useBtn.dataset.prov]?.label || useBtn.dataset.prov}`);
      }
      if (delBtn) {
        const keys = _loadKeys();
        delete keys[delBtn.dataset.del];
        _saveKeys(keys);
        if (getProvider() === delBtn.dataset.del) {
          const remaining = Object.keys(keys)[0];
          if (remaining) localStorage.setItem('lf_active_provider', remaining);
          else localStorage.removeItem('lf_active_provider');
        }
        _renderSavedKeysList();
        updateApiKeyBtn();
        _syncModelSelector();
      }
    });
  }

  const close = () => modal.classList.add('hidden');
  closeBtn.addEventListener('click',  close);
  cancelBtn.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  updateApiKeyBtn();
}

function updateApiKeyBtn() {
  const btn = document.getElementById('apiKeyBtn');
  if (!btn) return;
  const prov = getProvider();
  const cfg  = PROVIDERS[prov];
  if (hasApiKey(prov)) {
    btn.textContent = `✅ ${cfg ? cfg.label : prov}`;
    btn.classList.add('has-key');
  } else {
    btn.textContent = '🔑 API Key';
    btn.classList.remove('has-key');
  }
}

// Keep model selector in chat bar in sync
function _syncModelSelector() {
  const sel = document.getElementById('modelSelect');
  if (!sel) return;
  const keys = _loadKeys();
  // Rebuild options: only show providers that have saved keys
  const opts = Object.keys(PROVIDERS).map(p => {
    const hasKey = !!(keys[p] && keys[p].key);
    const active = getProvider() === p;
    return `<option value="${p}" ${active ? 'selected' : ''}>${PROVIDERS[p].label}${hasKey ? ' ✓' : ''}</option>`;
  });
  sel.innerHTML = opts.join('');
}


/* ── TOKEN COUNTER ──────────────────────────────────────── */
let _totalTokensUsed = 0;
function getTotalTokens() { return _totalTokensUsed; }
function resetTokenCounter() { _totalTokensUsed = 0; }
function addTokens(n) { _totalTokensUsed += (n || 0); }

const PROVIDERS = {
  openrouter: {
    label:   'OpenRouter',
    url:     'https://openrouter.ai/api/v1/chat/completions',
    model:   () => _getProviderModel('openrouter') || 'openrouter/auto',
    headers: key => ({
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer':  location.href,
      'X-Title':       'CodeSera',
      'Content-Type':  'application/json',
    }),
    hint: '🔗 Free key at <a href="https://openrouter.ai" target="_blank">openrouter.ai</a> — blank model = auto free router.',
    showModelInput: true,
    defaultModel: 'openrouter/auto',
  },
  chatgpt: {
    label:   'ChatGPT',
    url:     'https://api.openai.com/v1/chat/completions',
    model:   () => _getProviderModel('chatgpt') || 'gpt-4o-mini',
    headers: key => ({ 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }),
    hint: '🔗 <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com</a>',
    showModelInput: true,
    defaultModel: 'gpt-4o-mini',
  },
  deepseek: {
    label:   'DeepSeek',
    url:     'https://api.deepseek.com/chat/completions',
    model:   () => _getProviderModel('deepseek') || 'deepseek-chat',
    headers: key => ({ 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }),
    hint: '🔗 <a href="https://platform.deepseek.com" target="_blank">platform.deepseek.com</a>',
    showModelInput: true,
    defaultModel: 'deepseek-chat',
  },
  grok: {
    label:   'Grok',
    url:     'https://api.x.ai/v1/chat/completions',
    model:   () => _getProviderModel('grok') || 'grok-3-mini',
    headers: key => ({ 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }),
    hint: '🔗 <a href="https://console.x.ai" target="_blank">console.x.ai</a>',
    showModelInput: true,
    defaultModel: 'grok-3-mini',
  },
  gemini: {
    label:   'Gemini',
    url:     key => {
      const m = _getProviderModel('gemini') || 'gemini-3.1-flash-lite';
      return `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`;
    },
    model:   () => _getProviderModel('gemini') || 'gemini-3.1-flash-lite',
    headers: () => ({ 'Content-Type': 'application/json' }),
    hint: '🔗 Free key at <a href="https://aistudio.google.com/app/apikey" target="_blank">aistudio.google.com</a>',
    showModelInput: true,
    defaultModel: 'gemini-3.1-flash-lite',
    isGemini: true,
  },
  glm: {
    label:   'GLM-4',
    url:     'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model:   () => _getProviderModel('glm') || 'glm-4-flash',
    headers: key => ({ 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }),
    hint: '🔗 <a href="https://open.bigmodel.cn" target="_blank">open.bigmodel.cn</a>',
    showModelInput: true,
    defaultModel: 'glm-4-flash',
  },
  other: {
    label:   'Other',
    url:     () => _getOtherBaseUrl(),
    model:   () => _getProviderModel('other') || '',
    headers: key => ({ 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }),
    hint:    '🔗 Any OpenAI-compatible API. Set Base URL + optional model ID.',
    showModelInput: true,
    defaultModel: '',
    isOther: true,
  },
};


/* ── CALL API ───────────────────────────────────────── */
async function callApi(systemPrompt, userMessage) {
  const provider = getProvider();
  const key      = getApiKey(provider);
  const cfg      = PROVIDERS[provider];

  if (!key)  throw new Error('NO_KEY');
  if (!cfg)  throw new Error(`Unknown provider: ${provider}`);

  // For 'other', validate base URL is set
  if (cfg.isOther && !_getOtherBaseUrl()) {
    throw new Error('Base URL not set. Open API Key settings and add the Base URL for your provider.');
  }

  const model   = cfg.model();
  const url     = typeof cfg.url === 'function' ? cfg.url(key) : cfg.url;
  const headers = cfg.headers(key);

  let body;

  if (cfg.isGemini) {
    body = JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userMessage }] }
      ]
    });
  } else {
    const bodyObj = {
      max_tokens: 8000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  },
      ],
    };
    // Only include model field if set (some providers reject unknown model IDs)
    if (model) bodyObj.model = model;
    body = JSON.stringify(bodyObj);
  }

  // Route through local server proxy if available — fixes CORS for providers that block browsers
  const useProxy = typeof _serverAvailable !== 'undefined' && _serverAvailable && !cfg.isGemini;

  async function doFetch(overrideBody) {
    const b = overrideBody || body;
    if (useProxy) {
      return fetch('http://localhost:3000/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, headers, body: b }),
      });
    }
    return fetch(url, { method: 'POST', headers, body: b });
  }

  const resp = await doFetch();

  // Handle API errors — two retry strategies:
  // 1. Credit error ("can only afford N") → reduce max_tokens output
  // 2. TPM/size error ("too large", "tokens per minute") → trim user message input
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    let msg = `API error ${resp.status}`;
    try {
      const j = JSON.parse(errText);
      msg = j?.error?.message || j?.message || msg;
    } catch { /* ignore */ }

    const isCreditErr  = /can only afford (\d+)/.test(msg);
    const isSizeErr    = /too large|tokens per minute|tpm|reduce your message|request size|context.{0,30}exceed/i.test(msg);
    const creditMatch  = msg.match(/can only afford (\d+)/);
    const affordable   = creditMatch ? Math.max(1000, parseInt(creditMatch[1]) - 50) : null;

    if (!cfg.isGemini) {
      const retryObj = JSON.parse(body);

      if (isCreditErr && affordable) {
        retryObj.max_tokens = affordable;
      } else if (isSizeErr) {
        // Trim user message to ~50% to reduce input token count
        const userMsg = retryObj.messages?.find(m => m.role === 'user');
        if (userMsg) {
          userMsg.content = userMsg.content.slice(0, Math.floor(userMsg.content.length * 0.5))
            + '\n\n[Truncated. Generate lesson with available info above.]';
        }
        retryObj.max_tokens = Math.min(retryObj.max_tokens || 6000, 4000);
      } else {
        throw new Error(msg);
      }

      const retryResp = await doFetch(JSON.stringify(retryObj));
      if (retryResp.ok) {
        const retryData = await retryResp.json();
        return retryData?.choices?.[0]?.message?.content || '';
      }
      // If retry also failed, throw original error
    }

    throw new Error(msg);
  }

  const data = await resp.json();

  // Track token usage — check all known provider response shapes
  const usage = data?.usageMetadata || data?.usage || data?.usage_metadata;
  if (usage) {
    const total =
      usage.totalTokenCount ||
      usage.total_tokens ||
      usage.total_token_count ||
      ((usage.promptTokenCount  || usage.prompt_tokens  || usage.input_tokens  || 0) +
       (usage.candidatesTokenCount || usage.completion_tokens || usage.output_tokens || 0));
    if (total > 0) addTokens(total);
  }

  // Extract text from whatever shape the response is
  if (cfg.isGemini) {
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  return data?.choices?.[0]?.message?.content || '';
}

/* ── GENERATE LESSON ────────────────────────────────── */
const SYSTEM_PROMPT = `You are CodeSera. Generate a complete interactive HTML lesson page.

OUTPUT RULES — CRITICAL:
- Return ONLY raw HTML. No markdown. No explanation. No backticks.
- Start with <!DOCTYPE html> and end with </html>.
- lesson.css and lesson.js are always in the same folder — link them as: href="lesson.css" and src="lesson.js"
- Add Prism.js for syntax highlighting via CDN (already shown below).

NAVIGATION RULE — CRITICAL:
Every sidebar <a href="#id"> MUST match BOTH id="id" AND data-section="id" on the section element.

REQUIRED HTML STRUCTURE:
<!DOCTYPE html><html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>PAGE TITLE</title>
  <link rel="stylesheet" href="lesson.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js" defer><\/script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-LANG.min.js" defer><\/script>
</head><body>
  <button class="sidebar-toggle">☰</button>
  <aside class="sidebar"> [sidebar with nav-section/nav-topic/nav-subtopics] </aside>
  <main class="main-content"> [content] </main>
  <script src="lesson.js"><\/script>
</body></html>

SIDEBAR STRUCTURE:
<aside class="sidebar">
  <div class="sidebar-header"><div class="sidebar-logo"><div class="logo-icon">EMOJI</div><div class="logo-text">TITLE<span class="logo-sub">Level</span></div></div></div>
  <div class="sidebar-progress"><div class="progress-label"><span>Progress</span><span>0%</span></div><div class="progress-bar"><div class="progress-bar-fill"></div></div></div>
  <nav class="sidebar-nav">
    [For each topic:]
    <div class="nav-section">
      <div class="nav-topic"><div class="topic-icon">EMOJI</div>TOPIC NAME<span class="chevron">›</span></div>
      <ul class="nav-subtopics">
        <li><a href="#section-id">Subtopic Name</a></li>
      </ul>
    </div>
  </nav>
</aside>

CONTENT STRUCTURE:
<header class="page-header">
  <span class="page-badge beginner|intermediate|advanced">EMOJI Level</span>
  <h1 class="page-title">Title <span>Keyword</span></h1>
  <p class="page-subtitle">What the student will learn.</p>
  <div class="page-meta"><span class="meta-item"><span>⏱</span> X min</span><span class="meta-item"><span>🧩</span> N exercises</span></div>
</header>

[Sections — BOTH id AND data-section required:]
<section class="section" id="slug" data-section="slug">
  <h2 class="section-title"><div class="section-num">1</div>Title</h2>
  <p>Content</p>
  [subsections, cards, code blocks, callouts, tables, exercises]
</section>

COMPONENTS:
- Pills: <div class="pill-list"><span class="pill blue|green|yellow|purple">word</span></div>
- Card: <div class="card"><div class="card-header"><div class="card-icon blue|green|yellow|purple|red">EMOJI</div><div><div class="card-title">T</div></div></div><p>text <code>code</code></p></div>
- Cards grid: <div class="cards-grid">[cards]</div>
- Callout: <div class="callout tip|info|warning|danger"><span class="callout-icon">EMOJI</span><div><strong>Label:</strong> text</div></div>
- Code block: <div class="code-block"><div class="code-block-header"><div class="code-block-dots"><span></span><span></span><span></span></div><span class="code-block-lang">LANG</span><button class="copy-btn">Copy</button></div><pre><code class="language-LANG">CODE HERE</code></pre></div>
- Table: <table class="def-table"><thead><tr><th>A</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>
- Steps: <ol class="steps"><li><div class="step-num">1</div><div class="step-body"><div class="step-title">T</div><div class="step-desc">D</div></div></li></ol>
- Subsection: <div class="subsection" id="sub-id" data-section="sub-id"><h3 class="subsection-title">Title</h3></div>

EXERCISES (include 3-5 mixed questions per exercise block):
<div class="exercise-section">
  <div class="exercise-header"><div class="ex-icon">🧩</div><div><div class="exercise-title">Title</div><div class="exercise-subtitle">N questions</div></div><div class="exercise-score">0/0<span>Score</span></div></div>

  [MCQ — data-answer = data-value of correct option:]
  <div class="mcq-card" data-answer="b">
    <div class="mcq-question"><span class="q-num">Q1</span> Question?</div>
    <div class="mcq-options">
      <div class="mcq-option" data-value="a"><span class="opt-letter">A</span><span>text</span><span class="opt-icon"></span></div>
      <div class="mcq-option" data-value="b"><span class="opt-letter">B</span><span>text</span><span class="opt-icon"></span></div>
      <div class="mcq-option" data-value="c"><span class="opt-letter">C</span><span>text</span><span class="opt-icon"></span></div>
      <div class="mcq-option" data-value="d"><span class="opt-letter">D</span><span>text</span><span class="opt-icon"></span></div>
    </div>
    <div class="mcq-feedback"><span>💡</span><span class="fb-text">Explanation.</span></div>
  </div>

  [Fill-in-blank — pipe-separated accepted answers:]
  <div class="fill-card" data-answer="answer|alt"><div class="fill-question"><span class="q-num">Q2</span> Question?</div><input class="fill-input" type="text" placeholder="Type your answer..."><div class="fill-hint">Hint</div></div>

  [True/False — data-answer must be "true" or "false":]
  <div class="tf-card" data-answer="false"><div class="tf-question"><span class="q-num">Q3</span> Statement.</div><div class="tf-buttons"><button class="tf-btn true-btn">✅ True</button><button class="tf-btn false-btn">❌ False</button></div></div>

  [REQUIRED at end of every exercise-section:]
  <div class="exercise-actions"><button class="btn btn-primary btn-check">Check Answers ✓</button><button class="btn btn-ghost btn-reset">↺ Reset</button></div>
  <div class="exercise-result"></div>
</div>

LESSON FOOTER:
<nav class="lesson-nav">
  <a href="#" class="lesson-nav-btn prev"><div class="nav-direction">← Previous</div><div class="nav-btn-title">Prev</div></a>
  <a href="#" class="lesson-nav-btn next"><div class="nav-direction">Next →</div><div class="nav-btn-title">Next</div></a>
</nav>
<div class="completion-banner"><div class="completion-emoji">🏆</div><div class="completion-title">Lesson Complete!</div><div class="completion-msg">All exercises done!</div></div>

AT THE VERY END of the HTML (inside a comment) include a title tag like this:
<!-- LEARNFORGE_TITLE: Your Course Title Here -->`;

async function generateLesson(page, attachedFileObjects) {
  // Read any attached text files
  let fileContext = '';
  for (const f of (attachedFileObjects || [])) {
    try {
      if (f.type.startsWith('text/') || f.name.endsWith('.md') || f.name.endsWith('.txt')) {
        const text = await f.text();
        fileContext += `\n\n--- Attached file: ${f.name} ---\n${text.slice(0, 3000)}`;
      } else {
        fileContext += `\n\n--- Attached file: ${f.name} (binary, use filename as context) ---`;
      }
    } catch { /* skip unreadable */ }
  }

  const styleMap = {
    concise:     'Be concise: short explanations, dense info.',
    explanatory: 'Be explanatory: detailed descriptions and real-world examples.',
    interactive: 'Be interactive: many exercises and challenges.',
    formal:      'Be formal: academic tone, precise terminology.',
  };

  const userMessage =
    `Topic: ${page.prompt}\n` +
    `Level: ${page.levelFrom} → ${page.levelTo}\n` +
    `Teaching style: ${styleMap[page.style] || styleMap.concise}` +
    fileContext;

  const rawHtml = await callApi(SYSTEM_PROMPT, userMessage);

  // Extract AI-generated title if present
  const titleMatch = rawHtml.match(/<!--\s*LEARNFORGE_TITLE:\s*(.+?)\s*-->/);
  const aiTitle = titleMatch ? titleMatch[1].trim() : null;

  // Strip any accidental markdown fences
  const html = rawHtml
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/,      '')
    .replace(/\s*```$/,      '')
    .trim();

  return { html, aiTitle };
}

/* ── SMALL TOAST (used inside api.js) ──────────────── */
function showApiToast(msg) {
  // reuse app.js showToast if available, else DIY
  if (typeof showToast === 'function') { showToast(msg); return; }
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
}
