/* ═══════════════════════════════════════════════════════════
   CodeSera — app.js
   Full application: pages, typewriter, course generation,
   localStorage persistence, new-tab page viewer
═══════════════════════════════════════════════════════════ */

'use strict';

/* ── CONSTANTS ─────────────────────────────────────────── */
const STORAGE_KEY = 'codesera_pages';
const SCHEDULE_KEY = 'codesera_schedule';

const HINTS = [
  'Teach me Python Programming',
  'Create C++ problems for competitive programming',
  'Create LeetCode problem sets for me',
  'Teach me C# for Game Development',
  'Teach me Math for Algorithms',
];

const MODEL_LABELS = {
  claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini',
  grok: 'Grok', openrouter: 'OpenRouter', deepseek: 'DeepSeek', glm: 'GLM-4',
};

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

/* ── STATE ─────────────────────────────────────────────── */
// courses[] — each course has: { id, title, description, prompt, settings, indexHtml, lessons:[{id,title,html,filename,lessonNum}], createdAt, updatedAt }
let courses       = [];
let currentCourseId = null;
let attachedFiles   = [];
let _expandCid      = null;  // set when expand button clicked
let _expandContext  = null;  // course context for expand (not shown in prompt)

const _deletedCourseIds = new Set(
  JSON.parse(localStorage.getItem('lf_deleted_ids') || '[]')
);
function _markDeleted(id) {
  _deletedCourseIds.add(id);
  localStorage.setItem('lf_deleted_ids', JSON.stringify([..._deletedCourseIds]));
}
let twTimer     = null;
let twPhrase    = 0;
let twChar      = 0;
let twDeleting  = false;
let twPaused    = false;

/* ── DOM REFS ──────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const chatList    = $('chatList');
const welcome     = $('welcome');
const messages    = $('messages');
const msgInput    = $('msgInput');
const sendBtn     = $('sendBtn');
const pageTitle   = $('pageTitle');
const modelBadge  = null; // removed — no longer in DOM
const modelSelect = $('modelSelect');
const styleSelect = $('styleSelect');
const levelFrom   = $('levelFrom');
const levelTo     = $('levelTo');
const newChatBtn  = $('newChatBtn');
const searchInput = $('searchInput');
const attachBtn   = $('attachBtn');
const attachMenu  = $('attachMenu');
const fileInput   = $('fileInput');
const filesPreview= $('filesPreview');
const twText      = $('twText');
const sidebarToggle=$('sidebarToggle');
const sidebar     = $('sidebar');

/* ════════════════════════════════════════════════════════
   STORAGE
════════════════════════════════════════════════════════ */
function saveCourses() {
  // Strip large html from lessons before saving — html lives on disk
  // This prevents localStorage overflow which silently trims courses
  const slim = courses.map(c => ({
    ...c,
    lessons: (c.lessons||[]).map(l => ({
      id: l.id, title: l.title, filename: l.filename,
      lessonNum: l.lessonNum, topics: l.topics || [],
      // Keep html only if small (< 50KB) — avoids overflow for new courses
      ...(l.html && l.html.length < 50000 ? { html: l.html } : {}),
    })),
    // Don't store full indexHtml/navHtml in localStorage — regenerate from server
    indexHtml: c.indexHtml && c.indexHtml.length < 20000 ? c.indexHtml : '',
    navHtml:   '',
  }));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch(e) {
    // Still full — strip ALL html and try again
    const minimal = slim.map(c => ({
      ...c,
      lessons: (c.lessons||[]).map(l => ({
        id: l.id, title: l.title, filename: l.filename,
        lessonNum: l.lessonNum, topics: l.topics || [],
      })),
      indexHtml: '', navHtml: '',
    }));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal)); }
    catch(e2) { console.warn('localStorage full even after stripping HTML', e2); }
  }
}

function loadCourses() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    // Support old page-based format: ignore it (old keys had .html directly)
    if (Array.isArray(raw) && raw.length && raw[0].lessons) {
      courses = raw;
    } else {
      courses = [];
    }
  } catch { courses = []; }
}

function createCourse(opts = {}) {
  return {
    id:          genId(),
    title:       opts.title       || 'New Course',
    description: opts.description || '',
    prompt:      opts.prompt      || '',
    settings: {
      model:     opts.model     || getProvider(),
      style:     opts.style     || 'concise',
      levelFrom: opts.levelFrom || 'beginner',
      levelTo:   opts.levelTo   || 'intermediate',
      files:     opts.files     || [],
    },
    indexHtml: opts.indexHtml || '',
    lessons:   [],              // filled incrementally
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}

function loadSchedule() {
  try { return JSON.parse(localStorage.getItem(SCHEDULE_KEY)) || {}; }
  catch { return {}; }
}

function saveSchedule(data) { localStorage.setItem(SCHEDULE_KEY, JSON.stringify(data)); }

/* ════════════════════════════════════════════════════════
   SIDEBAR RENDERING — shows courses, not individual pages
════════════════════════════════════════════════════════ */
function renderSidebar(filter = '') {
  const lc = filter.toLowerCase();
  const filtered = filter
    ? courses.filter(c => c.title.toLowerCase().includes(lc) || c.prompt.toLowerCase().includes(lc))
    : courses;

  if (filtered.length === 0) {
    chatList.innerHTML = `<p class="empty-hint">${filter ? 'No results' : 'No courses yet'}</p>`;
    return;
  }

  const sortVal = $('sortSelect')?.value || 'updated';
  const sorted  = filtered.slice().sort((a,b) => {
    if (sortVal === 'created') return (b.createdAt||0) - (a.createdAt||0);
    if (sortVal === 'title')   return (a.title||'').localeCompare(b.title||'');
    return (b.updatedAt||0) - (a.updatedAt||0);
  });

  chatList.innerHTML = sorted.map(c => {
      const active = c.id === currentCourseId ? ' active' : '';
      const icon   = pageIcon(c.title);
      const age    = relTime(c.updatedAt);
      const count  = c.lessons.length;
      return `
        <div class="chat-item${active}" data-cid="${c.id}">
          <div class="ci-icon">${icon}</div>
          <div class="ci-body">
            <div class="ci-title">${escHtml(c.title)}</div>
            <div class="ci-meta">${age} · ${count} lesson${count !== 1 ? 's' : ''}</div>
          </div>
          <button class="ci-del" data-del="${c.id}" title="Delete course">×</button>
        </div>`;
    }).join('');
}


function pageIcon(title) {
  const t = title.toLowerCase();
  if (t.includes('python'))   return '🐍';
  if (t.includes('c++') || t.includes('cpp')) return '⚡';
  if (t.includes('c#') || t.includes('csharp')) return '🎮';
  if (t.includes('java'))     return '☕';
  if (t.includes('react') || t.includes('js') || t.includes('javascript')) return '⚛️';
  if (t.includes('math'))     return '🔢';
  if (t.includes('algo') || t.includes('dsa') || t.includes('leetcode')) return '🌳';
  if (t.includes('rust'))     return '🦀';
  if (t.includes('go'))       return '🐹';
  return '📘';
}

function relTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000)        return 'Just now';
  if (diff < 3600000)      return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000)     return Math.floor(diff/3600000) + 'h ago';
  if (diff < 604800000)    return Math.floor(diff/86400000) + 'd ago';
  return new Date(ts).toLocaleDateString();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ════════════════════════════════════════════════════════
   ACTIVE COURSE — clicking sidebar item
════════════════════════════════════════════════════════ */
function setActiveCourse(courseId) {
  currentCourseId = courseId;
  const course = courses.find(c => c.id === courseId);
  if (!course) return;

  pageTitle.value = course.title;

  welcome.classList.add('hidden');
  messages.innerHTML = '';

  // User bubble
  const userRow = document.createElement('div');
  userRow.className = 'msg-row user';
  const fHtml = (course.settings.files || []).length
    ? `<div class="bubble-files">${course.settings.files.map(f=>`<span class="bfile-chip">📎 ${escHtml(f)}</span>`).join('')}</div>`
    : '';
  userRow.innerHTML = `<div class="msg-bubble">${fHtml}${escHtml(course.prompt)}</div>`;
  messages.appendChild(userRow);

  // Course card
  if (course.lessons.length > 0) {
    messages.appendChild(buildCourseCard(course));
  }

  const chatArea = $('chatArea');
  chatArea.scrollTop = chatArea.scrollHeight;
  renderSidebar(searchInput.value);
}

/* ════════════════════════════════════════════════════════
   OPEN LESSON/INDEX IN NEW TAB
════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════
/* ════════════════════════════════════════════════════════
   SERVER INTEGRATION
   Saves course files to /courses via Node.js server.
   Opens courses at http://localhost:3000/CourseName/
════════════════════════════════════════════════════════ */
const SERVER = 'http://localhost:3000';
let _serverAvailable = false;
let _pollTimer       = null;

async function checkServer() {
  const prev = _serverAvailable;
  try {
    const r = await fetch(`${SERVER}/courses`, { signal: AbortSignal.timeout(4000) });
    _serverAvailable = r.ok;
    if (r.ok) {
      const diskCourses = await r.json();
      syncCoursesFromDisk(diskCourses);
    }
  } catch { _serverAvailable = false; }
  // Only update UI when state changes — prevents button toggling on transient errors
  if (_serverAvailable !== prev) updateServerUI();
  return _serverAvailable;
}

// Merge courses found on disk into the in-memory courses array
function syncCoursesFromDisk(diskCourses) {
  if (!Array.isArray(diskCourses)) return;
  let changed = false;

  diskCourses.forEach(dc => {
    if (!dc.name || !dc.lessons?.length) return;
    if ([..._deletedCourseIds].some(id => { const c = courses.find(x=>x.id===id); return c && c.safeFolderName === dc.name; })) return;

    // Check if we already have a course matching this folder name
    const existing = courses.find(c => c.safeFolderName === dc.name);
    if (existing) {
      // Add any new lessons from disk not yet in memory
      dc.lessons.forEach(dl => {
        const has = existing.lessons.find(l => l.filename === dl.filename);
        if (!has) {
          existing.lessons.push({
            id:        dl.filename,
            title:     dl.title,
            html:      dl.html,
            filename:  dl.filename,
            lessonNum: dl.lessonNum,
          });
          existing.updatedAt = Date.now();
          changed = true;
        }
      });
      if (dc.indexHtml && !existing.indexHtml) {
        existing.indexHtml = dc.indexHtml;
        changed = true;
      }
    } else {
      // New course found on disk — create entry
      const titleFromIndex = dc.indexHtml?.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || dc.name;
      const newCourse = createCourse({
        title:     titleFromIndex,
        prompt:    `Loaded from disk: ${dc.name}`,
        indexHtml: dc.indexHtml,
      });
      newCourse.safeFolderName = dc.name;
      newCourse.lessons = dc.lessons.map(dl => ({
        id:        dl.filename,
        title:     dl.title,
        html:      dl.html,
        filename:  dl.filename,
        lessonNum: dl.lessonNum,
      }));
      courses.push(newCourse);
      changed = true;
    }
  });

  if (changed) {
    saveCourses();
    renderSidebar(searchInput?.value || '');
  }
}

function updateServerUI() {
  const btn  = $('folderPickerBtn');
  const name = $('folderName');
  if (!btn) return;
  if (_serverAvailable) {
    btn.textContent = '🟢 Server running';
    btn.classList.add('has-key');
    if (name) name.textContent = `localhost:3000`;
  } else {
    btn.textContent = '⚡ Start server';
    btn.classList.remove('has-key');
    if (name) name.textContent = 'Run: node server.js';
  }
}

// Poll every 10s for new course folders dropped into courses/
function startCoursePolling() {
  if (_pollTimer) return;
  // Immediate check — slight delay so DOM is ready
  setTimeout(() => {
    checkServer().then(ok => {
      updateServerUI();
      if (ok) syncCoursesFromDisk();
    });
  }, 300);
  _pollTimer = setInterval(() => {
    checkServer().then(ok => { updateServerUI(); if (ok) syncCoursesFromDisk(); });
  }, 10000);
}

async function saveFilesToServer(course) {
  const safe = course.safeFolderName;
  if (!safe) return false;
  try {
    // Save lesson.css + lesson.js once per course
    // Save index
    await serverSave(`${safe}/index.html`, course.indexHtml || '');
    // Save all lessons
    for (const l of course.lessons) {
      await serverSave(`${safe}/${l.filename}`, l.html || '');
    }
    return true;
  } catch(e) {
    console.warn('saveFilesToServer failed:', e);
    return false;
  }
}

async function serverSave(filepath, content) {
  const r = await fetch(`${SERVER}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filepath, content }),
  });
  if (!r.ok) throw new Error(`Server save failed: ${filepath}`);
}

function injectThemeCSS(html) {
  if (!html) return html;
  return html.replace(/<link[^>]*href=["']lesson\.css["'][^>]*\/?>/gi, `<style>${LESSON_CSS}</style>`);
}

function openCourseFile(course, filename, fallbackHtml) {
  try { localStorage.setItem('lf_open_course_id', course.id); } catch(e) {}
  // Prefer server URL — real HTTP, nav links work natively
  if (_serverAvailable && course.safeFolderName) {
    window.open(`${SERVER}/${encodeURIComponent(course.safeFolderName)}/${filename}`, '_blank');
    return;
  }
  // Fallback: open in-memory HTML
  if (fallbackHtml) { openInTab(fallbackHtml); return; }
  showToast('Start the server (node server.js) to open course files.');
}

function openInTab(html, fallbackMsg) {
  if (!html) { showToast(fallbackMsg || 'No content yet.'); return; }
  const win = window.open('', '_blank');
  if (!win) { showToast('Popup blocked — please allow popups.'); return; }
  win.document.open();
  win.document.write(injectThemeCSS(html));
  win.document.close();
}


/* ════════════════════════════════════════════════════════
   PROGRESS OVERLAY (top popup with stop button)
════════════════════════════════════════════════════════ */
function showGenOverlay(title) {
  const ov = $('genOverlay');
  $('genTitle').textContent = title || 'Building course…';
  $('genSub').textContent = 'Starting…';
  $('genBar').style.width = '0%';
  $('genSteps').innerHTML = '';
  ov.classList.remove('hidden');
}

function hideGenOverlay() {
  $('genOverlay')?.classList.add('hidden');
}

function updateGenOverlay(msg, progress, type) {
  const sub = $('genSub');
  const bar = $('genBar');
  if (sub) sub.textContent = msg;
  if (bar && progress != null) bar.style.width = Math.round(progress * 100) + '%';

  const steps = $('genSteps');
  if (steps) {
    const el = document.createElement('div');
    el.className = 'gen-step-row' + (type ? ` gen-step-${type}` : '');
    el.textContent = msg;
    steps.appendChild(el);
    if (steps.children.length > 12) steps.removeChild(steps.firstChild);
    el.scrollIntoView({ block:'nearest', behavior:'smooth' });
  }
}



/* ════════════════════════════════════════════════════════
   PROGRESS CARD UI
════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════
   COURSE CARD (shown in chat after generation)
════════════════════════════════════════════════════════ */
function buildCourseCard(course) {
  const row = document.createElement('div');
  row.className = 'msg-row ai';

  const lessonItems = course.lessons.map((l, i) => {
    const shortTitle = l.title.split('—')[1]?.trim() || l.title;
    return `<div class="cc-lesson">
      <span class="cc-num">${i+1}</span>
      <span class="cc-ltitle">${escHtml(shortTitle)}</span>
      <button class="lbtn sec open-lesson" data-cid="${course.id}" data-lnum="${i}" style="padding:4px 10px;font-size:11px">Open</button>
    </div>`;
  }).join('');

  row.innerHTML = `
    <div class="lesson-card" style="max-width:500px">
      <div class="lc-head">
        <div class="lc-dot">📚</div>
        <div>
          <div class="lc-title">${escHtml(course.title)}</div>
          <div class="lc-sub">${course.lessons.length} lessons · ${course.settings.levelFrom}→${course.settings.levelTo}</div>
        </div>
      </div>
      <div class="lc-tags">
        <span class="ltag model">${PROVIDERS[course.settings.model]?.label || course.settings.model}</span>
        <span class="ltag">${course.settings.style}</span>
        <span class="ltag">📅 ${new Date(course.createdAt).toLocaleDateString()}</span>
        ${course.tokensUsed > 0 ? `<span class="ltag">🔢 ${course.tokensUsed >= 1000 ? (course.tokensUsed/1000).toFixed(1)+'k' : course.tokensUsed} tokens</span>` : ''}
      </div>
      <div style="padding:10px 14px;display:flex;flex-direction:column;gap:5px">${lessonItems}</div>
      <div class="lc-acts">
        <button class="lbtn pri open-index" data-cid="${course.id}">📋 Course Index</button>
        <button class="lbtn sec open-lesson" data-cid="${course.id}" data-lnum="0">🚀 Start</button>
        <button class="lbtn sec edit-course" data-cid="${course.id}">✏️ Edit</button>
        <button class="lbtn sec quiz-course"    data-cid="${course.id}">🧠 Quiz</button>
        <button class="lbtn sec projects-course" data-cid="${course.id}">🛠️ Projects</button>
        <button class="lbtn sec expand-course"   data-cid="${course.id}">➕ Expand</button>
      </div>
    </div>`;
  return row;
}

/* ════════════════════════════════════════════════════════
   EXPAND COURSE — generates one new lesson and appends it
════════════════════════════════════════════════════════ */
async function handleExpandCourse(course, prompt) {
  sendBtn.disabled = true;
  welcome.classList.add('hidden');
  messages.innerHTML = '';
  const chatArea = $('chatArea');

  const userRow = document.createElement('div');
  userRow.className = 'msg-row user';
  userRow.innerHTML = `<div class="msg-bubble">${escHtml(prompt)}</div>`;
  messages.appendChild(userRow);

  showGenOverlay(`Expanding: ${course.title}`);
  updateGenOverlay('Researching new lesson…', 0.1);

  try {
    if (typeof resetTokenCounter === 'function') resetTokenCounter();
    const lessonNum = course.lessons.length + 1;
    const total     = lessonNum;

    // Use _expandContext (set by expand button) for clean context
    const ctx = _expandContext || {};
    _expandContext = null;

    // Derive a clean lesson title from user's prompt — never use full expand preamble
    let lessonTitle;
    const firstLine = prompt.split('\n')[0].trim();
    const matchContinue = firstLine.match(/^Continue from "([^"]+)"/i);
    if (matchContinue) {
      // User kept default — derive next topic from planner
      // Ask the planner for just the next lesson title
      try {
        const nextPlanMsg =
          `Course: ${course.title}\n` +
          `Already covered: ${ctx.covered || course.lessons.map((l,i)=>`${i+1}. ${l.title.split('—')[1]?.trim()||l.title}`).join(', ')}\n` +
          `Level: ${course.settings.levelFrom}→${course.settings.levelTo}\n` +
          `What should lesson ${lessonNum} be about? Reply with ONLY a short lesson title (3-6 words), nothing else.`;
        const titleRaw = await callWithRetry
          ? await callWithRetry('You are a curriculum designer. Reply with only a short lesson title.', nextPlanMsg, 'title')
          : null;
        lessonTitle = titleRaw ? titleRaw.trim().replace(/^["']|["']$/g,'').slice(0,80) : `Lesson ${lessonNum}`;
      } catch(e) {
        // Fallback: use numbered generic title
        lessonTitle = `Advanced Topics — Part ${lessonNum}`;
      }
    } else {
      // User typed custom topic — use first line only, strip any metadata
      lessonTitle = firstLine.replace(/^EXPAND COURSE:.*/i, '').replace(/lesson \d+/i, '').trim().slice(0, 80) || `Lesson ${lessonNum}`;
    }

    const allLessonsMeta = course.lessons.map((l, i) => ({
      id:        l.id || `lesson-${i+1}`,
      title:     l.title.split('—')[1]?.trim() || l.title,
      topics:    l.topics || [],
      docsHints: [],
    }));
    const newLessonMeta = {
      id:        `lesson-${lessonNum}`,
      title:     lessonTitle,
      topics:    [lessonTitle],
      docsHints: [],
    };
    const fakePlan = {
      courseTitle: course.title,
      lessons:     [...allLessonsMeta, newLessonMeta],
      description: course.description || '',
    };

    let research = '';
    try {
      research = await runResearchAgent(fakePlan, newLessonMeta, course.settings);
    } catch { research = `Topic: ${lessonTitle}`; }

    updateGenOverlay('Writing new lesson…', 0.5);

    const coveredSummary = ctx.covered ||
      course.lessons.map((l,i) => `${i+1}. ${l.title.split('—')[1]?.trim()||l.title}`).join(' | ');

    const content = await runWriterAgent(
      fakePlan, newLessonMeta, research, course.settings,
      lessonNum, total, coveredSummary
    );

    const lang = typeof detectLang === 'function' ? detectLang(course.title) : 'javascript';
    const prevLesson = fakePlan.lessons[fakePlan.lessons.length - 2];
    const meta = {
      courseTitle: course.title, lessonTitle: newLessonMeta.title,
      lessonNum, total,
      levelFrom: course.settings.levelFrom, levelTo: course.settings.levelTo,
      style: course.settings.style, topics: newLessonMeta.topics || [],
      prevFile:  prevLesson ? `lesson-${lessonNum-1}.html` : 'index.html',
      prevTitle: prevLesson ? prevLesson.title : 'Course Index',
      nextFile: '#', nextTitle: 'Course Complete',
      allLessons: fakePlan.lessons.map((l,i) => ({
        num:    i+1,
        title:  l.title,
        topics: l.topics || [],
        file:   'lesson-'+(i+1)+'.html',
      })),
    };
    const html     = renderLesson(content, meta, lang);
    const filename = `lesson-${lessonNum}.html`;
    const title    = `${course.title} — ${newLessonMeta.title}`;

    course.lessons.push({ id: newLessonMeta.id, title, html, filename, lessonNum, topics: newLessonMeta.topics || [] });

    const planMeta    = { courseTitle: course.title, description: course.description || '', targetAudience: '' };
    const titles      = course.lessons.map(l => l.title);
    const topicsList  = course.lessons.map(l => l.topics || []);
    course.indexHtml  = renderIndex(planMeta, titles);
    course.navHtml    = renderNav(planMeta, titles, topicsList);
    course.updatedAt  = Date.now();
    saveCourses();

    if (_serverAvailable && course.safeFolderName) {
      await serverSave(`${course.safeFolderName}/${filename}`, html);
      await serverSave(`${course.safeFolderName}/index.html`, course.indexHtml);
      await serverSave(`${course.safeFolderName}/nav.html`,   course.navHtml);
    }

    course.tokensUsed = (course.tokensUsed||0) + (typeof getTotalTokens==='function' ? getTotalTokens() : 0);
    saveCourses();
    hideGenOverlay();
    renderSidebar(searchInput.value);
    setActiveCourse(course.id);
    showToast(`✅ Lesson ${lessonNum} added to ${course.title}`);
  } catch(e) {
    hideGenOverlay();
    const errRow = document.createElement('div');
    errRow.className = 'msg-row ai';
    errRow.innerHTML = `<div class="typing-wrap" style="border-color:var(--red);color:var(--red)">⚠️ ${escHtml(e.message)}</div>`;
    messages.appendChild(errRow);
  } finally {
    sendBtn.disabled = false;
  }
}

/* ════════════════════════════════════════════════════════
   SEND — AGENT PIPELINE ENTRY POINT
════════════════════════════════════════════════════════ */
async function handleSend() {
  const prompt = msgInput.value.trim();
  if (!prompt) return;
  if (!hasApiKey()) {
    showToast('🔑 Add an API key first.');
    openApiModal();
    return;
  }

  // ── EXPAND MODE: append a single lesson to existing course ──
  if (_expandCid) {
    const cid = _expandCid;
    _expandCid = null;
    const targetCourse = courses.find(c => c.id === cid);
    if (targetCourse) {
      await handleExpandCourse(targetCourse, prompt);
      return;
    }
  }

  const targetApp = ($('targetAppInput')?.value || '').trim();

  // Read customization checklist flags
  function ckChecked(id) { return !!document.getElementById(id)?.checked; }
  const customization = {
    newbie:        ckChecked('ck-newbie'),
    teen:          ckChecked('ck-teen'),
    codeHeavy:     ckChecked('ck-codeheavy'),
    projectFocus:  ckChecked('ck-projectfocus'),
    objectives:    ckChecked('ck-objectives'),
    misconceptions:ckChecked('ck-misconceptions'),
    diffRamp:      ckChecked('ck-ramp'),
    analogies:     ckChecked('ck-analogies'),
  };

  const settings = {
    model:     modelSelect.value || getProvider(),
    style:     styleSelect.value,
    levelFrom: levelFrom.value,
    levelTo:   levelTo.value,
    targetApp:     targetApp || null,
    customization,
    files:     attachedFiles.map(f => f.name),
  };

  const fileSnapshot = [...attachedFiles];
  msgInput.value = '';
  autoResizeTextarea();
  clearFiles();
  sendBtn.disabled = true;

  welcome.classList.add('hidden');
  messages.innerHTML = '';
  const chatArea = $('chatArea');

  // User bubble
  const userRow = document.createElement('div');
  userRow.className = 'msg-row user';
  const fHtml = settings.files.length
    ? `<div class="bubble-files">${settings.files.map(n=>`<span class="bfile-chip">📎 ${escHtml(n)}</span>`).join('')}</div>`
    : '';
  userRow.innerHTML = `<div class="msg-bubble">${fHtml}${escHtml(prompt)}</div>`;
  messages.appendChild(userRow);
  chatArea.scrollTop = chatArea.scrollHeight;

  // Create course object immediately (lessons filled in as they arrive)
  const course = createCourse({ prompt, ...settings, title: 'Building…' });
  courses.unshift(course);
  currentCourseId = course.id;

  // Show overlay
  showGenOverlay('Building course…');
  let totalLessons = 0;

  const onStep = ({ status, msg, isRetry, waitSecs }) => {
    const type = isRetry ? 'retry' : status === 'warn' ? 'warn' : status === 'done' ? 'done' : null;
    const prog  = totalLessons > 0 ? course.lessons.length / totalLessons : 0;
    if (isRetry && waitSecs) {
      updateGenOverlay(msg, prog, 'retry');
      let rem = waitSecs;
      const ticker = setInterval(() => {
        rem--;
        const sub = $('genSub');
        if (sub) sub.textContent = `⏳ Waiting… ${rem}s`;
        if (rem <= 0) clearInterval(ticker);
      }, 1000);
    } else {
      updateGenOverlay(msg, prog, type);
    }
  };
  const onPlan = ({ plan, total }) => {
    totalLessons = total;
    course.title = plan.courseTitle;
    course.description = plan.description || '';
    // Compute and store the safe subfolder name now that title is known
    course.safeFolderName = plan.courseTitle.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 60);
    // Pass back into settings so buildCourse/agents can use it for nav hrefs
    settings._safeFolderName = course.safeFolderName;
    pageTitle.value = plan.courseTitle;
    $('genTitle').textContent = plan.courseTitle;
    renderSidebar(searchInput.value);
    updateGenOverlay(`Planned ${total} lessons`, 0);
  };

  AgentEvents.on('step', onStep);
  AgentEvents.on('plan-ready', onPlan);

  // Check if server is running
  const serverUp = await checkServer();
  if (!serverUp) {
    showToast('⚠️ Server not running — run "node server.js" first. Generating anyway…', 4000);
  }

  try {
    const result = await buildCourse(prompt, settings, async (lessonResult) => {
      course.lessons.push({
        id:        lessonResult.id,
        title:     lessonResult.title,
        html:      lessonResult.html,
        filename:  lessonResult.filename,
        lessonNum: lessonResult.lessonNum,
        topics:    lessonResult.topics || [],
      });
      course.updatedAt = Date.now();
      saveCourses();
      updateGenOverlay(`✅ Lesson ${lessonResult.lessonNum}/${lessonResult.total} done`, lessonResult.lessonNum / lessonResult.total);

      // Save each lesson to server immediately as it's ready
      if (_serverAvailable && course.safeFolderName) {
        try {
          await serverSave(`${course.safeFolderName}/${lessonResult.filename}`, lessonResult.html);
          updateGenOverlay(`💾 Saved ${lessonResult.filename}`, lessonResult.lessonNum / lessonResult.total);
        } catch(e) { console.warn('Server save failed:', e); }
      }

      renderSidebar(searchInput.value);
    });

    // Store and save index + nav
    course.indexHtml  = result.indexHtml;
    course.navHtml    = result.navHtml || '';
    course.tokensUsed = (course.tokensUsed || 0) + (typeof getTotalTokens === 'function' ? getTotalTokens() : 0);
    course.updatedAt  = Date.now();
    saveCourses();

    if (_serverAvailable && course.safeFolderName) {
      try {
        const sf = course.safeFolderName;
        // Re-save all lessons in case any individual save failed during generation
        for (const lesson of course.lessons) {
          if (lesson.html) {
            try { await serverSave(`${sf}/${lesson.filename}`, lesson.html); } catch {}
          }
        }
        await serverSave(`${sf}/index.html`, result.indexHtml);
        if (result.navHtml) await serverSave(`${sf}/nav.html`, result.navHtml);
        updateGenOverlay('💾 Saved to server', 1, 'done');
      } catch(e) { console.warn('Final save failed:', e); }
    }

    renderSidebar(searchInput.value);
    hideGenOverlay();

    const summaryRow = buildCourseCard(course);
    messages.appendChild(summaryRow);
    chatArea.scrollTop = chatArea.scrollHeight;

    const savedMsg = _serverAvailable
      ? `🎉 ${course.title} — open at localhost:3000/${course.safeFolderName}/`
      : `🎉 ${course.title} — ${course.lessons.length} lessons ready! Start server to view.`;
    showToast(savedMsg, 5000);

  } catch (err) {
    hideGenOverlay();
    if (err.message !== 'NO_KEY') {
      const errRow = document.createElement('div');
      errRow.className = 'msg-row ai';
      errRow.innerHTML = `<div class="typing-wrap" style="border-color:var(--red);color:var(--red)">
        ⚠️ <span style="font-size:13px;margin-left:6px">${escHtml(err.message || 'Unknown error')}</span>
      </div>`;
      messages.appendChild(errRow);
    }
    // Remove empty course from list
    if (course.lessons.length === 0) {
      courses = courses.filter(c => c.id !== course.id);
      saveCourses();
      renderSidebar(searchInput.value);
    }
  } finally {
    AgentEvents.off('step', onStep);
    AgentEvents.off('plan-ready', onPlan);
    sendBtn.disabled = false;
  }
}




function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function showToast(msg, duration = 2800) {
  // Remove any existing toast
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 320);
  }, duration);
}

/* ════════════════════════════════════════════════════════
   TYPEWRITER  (fixed: proper loop with pause)
════════════════════════════════════════════════════════ */
function startTypewriter() {
  twPhrase   = 0;
  twChar     = 0;
  twDeleting = false;
  twPaused   = false;
  if (twTimer) clearInterval(twTimer);
  twTimer = setInterval(tickTypewriter, 55);
}

function stopTypewriter() {
  if (twTimer) { clearInterval(twTimer); twTimer = null; }
  twText.textContent = '';
}

function tickTypewriter() {
  if (twPaused) return;

  const phrase = HINTS[twPhrase];

  if (!twDeleting) {
    // typing forward
    twChar++;
    twText.textContent = phrase.slice(0, twChar);
    if (twChar === phrase.length) {
      // finished typing — pause then start deleting
      twPaused = true;
      setTimeout(() => { twDeleting = true; twPaused = false; }, 1800);
    }
  } else {
    // deleting
    twChar--;
    twText.textContent = phrase.slice(0, twChar);
    if (twChar === 0) {
      twDeleting = false;
      twPhrase   = (twPhrase + 1) % HINTS.length;
      // brief pause before typing next phrase
      twPaused = true;
      setTimeout(() => { twPaused = false; }, 400);
    }
  }
}

/* ════════════════════════════════════════════════════════
   TEXTAREA AUTO-RESIZE
════════════════════════════════════════════════════════ */
function autoResizeTextarea() {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 150) + 'px';
}

/* ════════════════════════════════════════════════════════
   FILE HANDLING
════════════════════════════════════════════════════════ */
function addFiles(fileList) {
  Array.from(fileList).forEach(f => {
    if (!attachedFiles.find(e => e.name === f.name)) {
      attachedFiles.push(f);
    }
  });
  renderFilesPreview();
}

function renderFilesPreview() {
  if (attachedFiles.length === 0) {
    filesPreview.classList.add('hidden');
    filesPreview.innerHTML = '';
    return;
  }
  filesPreview.classList.remove('hidden');
  filesPreview.innerHTML = attachedFiles.map((f, i) => `
    <div class="fchip">
      <span>📎</span>
      <span class="fchip-name">${escHtml(f.name)}</span>
      <button class="fchip-rm" data-idx="${i}">×</button>
    </div>`).join('');
}

function clearFiles() {
  attachedFiles = [];
  fileInput.value = '';
  renderFilesPreview();
}

/* ════════════════════════════════════════════════════════
   SCHEDULER — browser notifications at user-defined times
════════════════════════════════════════════════════════ */
let _notifTimer = null;

function openSchedulerModal() {
  const schedule = loadSchedule();
  const daysGrid = $('daysGrid');
  const selDays  = schedule.days || [];

  daysGrid.innerHTML = DAYS.map(d =>
    `<button class="day-btn${selDays.includes(d) ? ' sel' : ''}" data-day="${d}">${d}</button>`
  ).join('');

  if (schedule.time)    $('scheduleTime').value    = schedule.time;
  if (schedule.message) $('scheduleMessage').value = schedule.message;

  $('schedulerModal').classList.remove('hidden');
}

/* ── SCHEDULER BACKGROUND NOTIFICATIONS ─────────────────── */
function registerSchedulerNotifications(schedule) {
  if (!schedule.time || !schedule.days?.length) return;

  // Request notification permission
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Register service worker for background notifications
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw-scheduler.js').then(reg => {
      // Send schedule to SW
      const msg = { type: 'SET_SCHEDULE', schedule };
      if (reg.active) reg.active.postMessage(msg);
      else reg.addEventListener('updatefound', () => {
        reg.installing?.addEventListener('statechange', function() {
          if (this.state === 'activated') reg.active.postMessage(msg);
        });
      });
    }).catch(() => {
      // SW not available — use setInterval fallback (only works while tab is open)
      scheduleLocalNotification(schedule);
    });
  } else {
    scheduleLocalNotification(schedule);
  }
}

function scheduleLocalNotification(schedule) {
  if (Notification.permission !== 'granted') return;
  // Check every minute if it's time
  const [h, m] = (schedule.time || '09:00').split(':').map(Number);
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  setInterval(() => {
    const now  = new Date();
    const day  = DAYS[now.getDay()];
    if (now.getHours() === h && now.getMinutes() === m && schedule.days?.includes(day)) {
      new Notification('CodeSera — Time to learn! 📘', {
        body:  schedule.pageId
          ? 'Your scheduled course is ready. Open CodeSera to continue.'
          : 'Time for your scheduled learning session!',
        icon:  '/favicon.ico',
      });
    }
  }, 60000);
}

function saveScheduleModal() {
  const days    = [...$('daysGrid').querySelectorAll('.day-btn.sel')].map(b => b.dataset.day);
  const time    = $('scheduleTime').value;
  const message = $('scheduleMessage').value.trim() || 'Time to study! 📚';

  saveSchedule({ time, days, message });

  const statusEl = $('connectorStatus');
  if (days.length && time) {
    statusEl.textContent = `${time} · ${days.join(', ')}`;
    $('schedulerConnector').classList.add('configured');
    startNotificationTicker();
  } else {
    statusEl.textContent = 'Click to configure';
    $('schedulerConnector').classList.remove('configured');
    stopNotificationTicker();
  }

  $('schedulerModal').classList.add('hidden');
  showToast('📅 Schedule saved!');

  // Request permission
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().then(p => {
      if (p === 'granted') showToast('✅ Notifications enabled!');
      else showToast('⚠️ Notifications blocked — enable in browser settings.');
    });
  }
}

function startNotificationTicker() {
  stopNotificationTicker();
  // Check every 30 seconds if it's time to fire
  _notifTimer = setInterval(checkNotificationTime, 30000);
  checkNotificationTime(); // check immediately too
}

function stopNotificationTicker() {
  if (_notifTimer) { clearInterval(_notifTimer); _notifTimer = null; }
}

function checkNotificationTime() {
  const schedule = loadSchedule();
  if (!schedule.time || !schedule.days?.length) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const now     = new Date();
  const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()];
  if (!schedule.days.includes(dayName)) return;

  const [hh, mm] = schedule.time.split(':').map(Number);
  const nowMins  = now.getHours() * 60 + now.getMinutes();
  const targMins = hh * 60 + mm;

  // Fire if within a 1-minute window and not already fired this minute
  if (Math.abs(nowMins - targMins) <= 1) {
    const fireKey = `lf_notif_last_${schedule.time}_${dayName}`;
    const today   = now.toDateString();
    if (localStorage.getItem(fireKey) === today) return; // already fired today
    localStorage.setItem(fireKey, today);

    new Notification('CodeSera', {
      body: schedule.message || 'Time to study! 📚',
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text y="28" font-size="28">⬡</text></svg>',
    });
  }
}

function initSchedulerStatus() {
  const schedule = loadSchedule();
  if (schedule.time && schedule.days?.length) {
    $('connectorStatus').textContent = `${schedule.time} · ${schedule.days.join(', ')}`;
    $('schedulerConnector').classList.add('configured');
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      startNotificationTicker();
    }
  }
}

/* ════════════════════════════════════════════════════════
   EVENT WIRING
════════════════════════════════════════════════════════ */
function wireEvents() {

  /* ─ New Chat ─ */
  newChatBtn.addEventListener('click', () => {
    _expandCid = null;
    currentCourseId = null;
    pageTitle.value = 'New Course';
    messages.innerHTML = '';
    welcome.classList.remove('hidden');
    msgInput.value = '';
    clearFiles();
    autoResizeTextarea();
    renderSidebar();
    startTypewriter();
  });

  /* ─ Sidebar clicks (delegate) ─ */
  chatList.addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.del;
      const dc = courses.find(c => c.id === id);
      if (!confirm('Delete "' + (dc?.title||'this course') + '"? This cannot be undone.')) return;
      _markDeleted(id);
      courses = courses.filter(c => c.id !== id);
      saveCourses();
      if (_serverAvailable && dc?.safeFolderName) {
        fetch(SERVER + '/courses/' + encodeURIComponent(dc.safeFolderName), { method:'DELETE' }).catch(()=>{});
      }
      if (currentCourseId === id) {
        currentCourseId = null;
        welcome.classList.remove('hidden');
        messages.innerHTML = '';
        pageTitle.value = 'New Course';
        startTypewriter();
      }
      renderSidebar(searchInput.value);
      return;
    }
    const item = e.target.closest('[data-cid]');
    if (item) setActiveCourse(item.dataset.cid);
  });

  /* ─ Search ─ */
  searchInput.addEventListener('input', () => renderSidebar(searchInput.value));
  $('sortSelect')?.addEventListener('change', () => renderSidebar(searchInput.value));

  /* ─ Send ─ */
  sendBtn.addEventListener('click', handleSend);
  msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  msgInput.addEventListener('input', autoResizeTextarea);

  /* ─ Page title edit ─ */
  pageTitle.addEventListener('dblclick', () => {
    pageTitle.removeAttribute('readonly');
    pageTitle.focus();
    pageTitle.select();
  });
  pageTitle.addEventListener('blur', () => {
    pageTitle.setAttribute('readonly', '');
    const newTitle = pageTitle.value.trim() || 'New Course';
    pageTitle.value = newTitle;
    if (currentCourseId) {
      const c = courses.find(x => x.id === currentCourseId);
      if (c) { c.title = newTitle; c.updatedAt = Date.now(); saveCourses(); renderSidebar(); }
    }
  });
  pageTitle.addEventListener('keydown', e => { if (e.key === 'Enter') pageTitle.blur(); });

  /* ─ Model select ─ */
  modelSelect.addEventListener('change', () => {
    setActiveProvider(modelSelect.value);
  });

  /* ─ Attach ─ */
  // Target application field toggle
  const targetAppBtn   = $('targetAppBtn');
  const targetAppRow   = $('targetAppRow');
  const targetAppInput = $('targetAppInput');
  const targetAppClear = $('targetAppClear');

  // Panels toggle — mutually exclusive (target app & checklist)
  const checklistBtn   = $('checklistBtn');
  const checklistPanel = $('checklistPanel');

  function togglePanel(showId, hideId, showBtn, hideBtn, focusEl) {
    const showEl = $(showId);
    const hideEl = $(hideId);
    if (!showEl) return;
    const isHidden = showEl.classList.contains('hidden');
    // Hide both first
    showEl.classList.add('hidden');
    hideEl?.classList.add('hidden');
    showBtn?.classList.remove('active');
    hideBtn?.classList.remove('active');
    // Toggle show panel
    if (isHidden) {
      showEl.classList.remove('hidden');
      showBtn?.classList.add('active');
      if (focusEl) setTimeout(() => focusEl.focus(), 50);
    }
  }

  checklistBtn?.addEventListener('click', () => {
    togglePanel('checklistPanel', 'targetAppRow', checklistBtn, targetAppBtn, null);
  });

  targetAppBtn?.addEventListener('click', () => {
    togglePanel('targetAppRow', 'checklistPanel', targetAppBtn, checklistBtn, targetAppInput);
  });
  targetAppClear?.addEventListener('click', () => {
    targetAppInput.value = '';
    targetAppRow.classList.add('hidden');
    targetAppBtn.classList.remove('active');
  });

  attachBtn.addEventListener('click', e => {
    e.stopPropagation();
    attachMenu.classList.toggle('hidden');
    attachBtn.classList.toggle('open', !attachMenu.classList.contains('hidden'));
  });
  document.addEventListener('click', e => {
    if (!attachMenu.contains(e.target) && e.target !== attachBtn) {
      attachMenu.classList.add('hidden');
      attachBtn.classList.remove('open');
    }
  });
  attachMenu.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'file') fileInput.click();
    if (btn.dataset.action === 'url')  showToast('URL import coming soon!');
    attachMenu.classList.add('hidden');
    attachBtn.classList.remove('open');
  });
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); attachMenu.classList.add('hidden'); });
  filesPreview.addEventListener('click', e => {
    const rm = e.target.closest('[data-idx]');
    if (rm) { attachedFiles.splice(parseInt(rm.dataset.idx), 1); renderFilesPreview(); }
  });

  /* ─ Chips ─ */
  document.getElementById('chips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    msgInput.value = chip.dataset.text;
    autoResizeTextarea();
    msgInput.focus();
  });

  /* ─ Messages delegate — open course index / lesson ─ */
  messages.addEventListener('click', e => {
    // Expand course
    const expandBtn = e.target.closest('.expand-course');
    if (expandBtn) {
      const c = courses.find(x => x.id === expandBtn.dataset.cid);
      if (!c) return;
      const nextNum   = c.lessons.length + 1;
      const lastTitle = c.lessons.at(-1)?.title?.split('—')[1]?.trim() || '';
      const allTopics = c.lessons.map((l,i) => `${i+1}. ${l.title.split('—')[1]?.trim()||l.title}`).join(', ');

      const levelOrder = ['beginner','intermediate','advanced','master'];
      const toIdx = levelOrder.indexOf(c.settings.levelTo);
      if (c.lessons.length >= 6 && toIdx < levelOrder.length - 1) {
        const nextLevel = levelOrder[toIdx + 1];
        if (confirm(`Promote to ${nextLevel} level for the new lesson?`)) {
          c.settings.levelFrom = c.settings.levelTo;
          c.settings.levelTo   = nextLevel;
          saveCourses();
          levelFrom.value = c.settings.levelFrom;
          levelTo.value   = c.settings.levelTo;
          showToast(`📈 Promoted to ${c.settings.levelFrom}→${nextLevel}`);
        }
      }

      // Store context separately — don't put it in the visible prompt
      // The visible prompt is just a topic suggestion user can edit
      _expandContext = {
        courseTitle: c.title,
        covered:     allTopics,
        lastTitle,
        lessonNum:   nextNum,
        levelFrom:   c.settings.levelFrom,
        levelTo:     c.settings.levelTo,
      };
      msgInput.value = lastTitle
        ? `Continue from "${lastTitle}" — lesson ${nextNum}`
        : `Lesson ${nextNum} of ${c.title}`;

      styleSelect.value = c.settings.style;
      levelFrom.value   = c.settings.levelFrom;
      levelTo.value     = c.settings.levelTo;
      _expandCid = c.id;
      autoResizeTextarea();
      msgInput.focus();
      showToast('✏️ Edit if needed, then Send to add the new lesson.');
      return;
    }
    const quizBtn = e.target.closest('.quiz-course');
    if (quizBtn) { openQuizPicker(quizBtn.dataset.cid); return; }
    const projBtn = e.target.closest('.projects-course');
    if (projBtn && typeof openProjectsPicker==='function') { openProjectsPicker(projBtn.dataset.cid); return; }
    // Edit course prompt
    const editBtn = e.target.closest('.edit-course');
    if (editBtn) {
      const c = courses.find(x => x.id === editBtn.dataset.cid);
      if (!c) return;
      msgInput.value    = c.prompt;
      styleSelect.value = c.settings.style;
      levelFrom.value   = c.settings.levelFrom;
      levelTo.value     = c.settings.levelTo;
      currentCourseId   = null;
      autoResizeTextarea();
      msgInput.focus();
      showToast('✏️ Edit your prompt and hit Send to regenerate.');
      return;
    }
    // Open index page
    const idxBtn = e.target.closest('.open-index');
    if (idxBtn) {
      const c = courses.find(x => x.id === idxBtn.dataset.cid);
      if (c) openCourseFile(c, 'index.html', c.indexHtml);
      return;
    }
    const lesBtn = e.target.closest('.open-lesson');
    if (lesBtn) {
      const c    = courses.find(x => x.id === lesBtn.dataset.cid);
      const lnum = parseInt(lesBtn.dataset.lnum);
      if (!c) return;
      const lesson = c.lessons[lnum];
      if (lesson?.html) {
        openCourseFile(c, lesson.filename || `lesson-${lnum+1}.html`, lesson.html);
      } else if (_serverAvailable && c.safeFolderName) {
        const fname = lesson?.filename || `lesson-${lnum+1}.html`;
        fetch(`${SERVER}/${encodeURIComponent(c.safeFolderName)}/${fname}`)
          .then(r => r.ok ? r.text() : Promise.reject())
          .then(html => { if (lesson) lesson.html=html; saveCourses(); openInTab(html); })
          .catch(() => showToast('Lesson not found. Try regenerating.'));
      } else {
        showToast('Start the server (node server.js) to open lessons.');
      }
      return;
    }
  });

  /* ─ Generation overlay stop button ─ */
  const stopBtn = $('genStopBtn');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      requestStop();
      stopBtn.textContent = 'Stopping…';
      stopBtn.disabled = true;
    });
  }

  /* ─ Mobile sidebar toggle ─ */
  sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('open'));

  /* ─ API Key modal ─ */
  initApiModal();

  /* ─ Scheduler ─ */
  $('schedulerConnector').addEventListener('click', openSchedulerModal);
  $('modalClose').addEventListener('click',  () => $('schedulerModal').classList.add('hidden'));
  $('modalCancel').addEventListener('click', () => $('schedulerModal').classList.add('hidden'));
  $('modalSave').addEventListener('click', saveScheduleModal);
  $('daysGrid').addEventListener('click', e => {
    const btn = e.target.closest('.day-btn');
    if (btn) btn.classList.toggle('sel');
  });
  $('schedulerModal').addEventListener('click', e => {
    if (e.target === $('schedulerModal')) $('schedulerModal').classList.add('hidden');
  });

  /* ─ Server status button ─ */
  const fpBtn = $('folderPickerBtn');
  if (fpBtn) fpBtn.addEventListener('click', async () => {
    showToast('Checking server…');
    await checkServer();
    if (!_serverAvailable) showToast('Server not found. Run: node server.js', 4000);
  });

  /* ─ Drag-and-drop files ─ */
  const inputBar = $('inputBar');
  inputBar.addEventListener('dragover', e => { e.preventDefault(); inputBar.style.borderColor='var(--acc)'; });
  inputBar.addEventListener('dragleave', () => { inputBar.style.borderColor=''; });
  inputBar.addEventListener('drop', e => {
    e.preventDefault();
    inputBar.style.borderColor = '';
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
}

/* ════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════ */
function init() {
  loadCourses();
  renderSidebar();
  initSchedulerStatus();
  _syncModelSelector();
  wireEvents();
  initQuizEvents();
  if (typeof initProjectEvents === 'function') initProjectEvents();
  startTypewriter();
  // Check server immediately on page load, then poll every 10s
  startCoursePolling();
  initTutorial();
}


// Handle nav link clicks from lesson tabs (postMessage + BroadcastChannel)
try {
  const _bc = new BroadcastChannel('lf_nav');
  _bc.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'lf-open') {
      window.dispatchEvent(new MessageEvent('message', { data: e.data }));
    }
  });
} catch(e) {}

// Handle nav link clicks postMessage from lesson tabs
window.addEventListener('message', function(e) {
  if (!e.data || e.data.type !== 'lf-open') return;
  const course = courses.find(c => c.id === e.data.courseId);
  if (!course) return;
  const href = e.data.href || '';
  const parts    = href.split('#');
  const filename = parts[0];
  if (filename === 'index.html') {
    if (course.indexHtml) openInTab(course.indexHtml);
    else openCourseFile(course, 'index.html', null);
    return;
  }
  const match = filename.match(/^lesson-([0-9]+)\.html$/);
  if (match) {
    const idx    = parseInt(match[1]) - 1;
    const lesson = course.lessons[idx];
    if (lesson?.html) {
      openInTab(lesson.html);
    } else if (_serverAvailable && course.safeFolderName) {
      fetch(SERVER + '/' + encodeURIComponent(course.safeFolderName) + '/' + filename)
        .then(r => r.ok ? r.text() : Promise.reject())
        .then(html => { if(lesson) lesson.html=html; saveCourses(); openInTab(html); })
        .catch(() => showToast('Lesson not found on server.'));
    }
  }
});

/* ── TUTORIAL MODAL ─────────────────────────────────────── */
function initTutorial() {
  const modal    = document.getElementById('tutorialModal');
  const closeBtn = document.getElementById('tutCloseBtn');
  const neverChk = document.getElementById('tutNeverShow');
  if (!modal) return;
  // Show if never dismissed
  if (!localStorage.getItem('lf_tutorial_seen')) {
    modal.classList.remove('hidden');
  }
  function closeTutorial() {
    modal.classList.add('hidden');
    if (neverChk && neverChk.checked) {
      localStorage.setItem('lf_tutorial_seen', '1');
    }
  }
  closeBtn && closeBtn.addEventListener('click', closeTutorial);
  modal.addEventListener('click', e => { if (e.target === modal) closeTutorial(); });
}

document.addEventListener('DOMContentLoaded', init);

