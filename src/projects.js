/* ═══════════════════════════════════════════════════════════
   CodeSera — projects.js
   Project ideas list + full guided project lesson generation.
   Saved to courses/CourseName/projects/ subfolder.
═══════════════════════════════════════════════════════════ */

'use strict';

const PROJECTS_STORAGE_KEY = 'lf_projects'; // courseId → { list:[], generated:{slug: html} }

/* ── PROMPTS ─────────────────────────────────────────────── */
const PROJECTS_LIST_PROMPT =
`You are a programming educator. Generate a list of hands-on projects for a course.
Output ONLY valid JSON array, no markdown, no explanation.

Schema:
[
  {
    "title": "Project title (3-6 words)",
    "slug": "url-safe-slug",
    "level": "beginner|intermediate|advanced",
    "description": "One sentence: what the student will build and learn.",
    "skills": ["skill1", "skill2", "skill3"],
    "estimatedTime": "2-3 hours"
  }
]

Rules:
- Generate projects for EACH level in the range (beginner→advanced = beginner + intermediate + advanced)
- Per level count: beginner=3, intermediate=3, advanced=2 (adjust if range is smaller)
- Projects must be realistic and completable by a student at that level
- Skills must match what was taught in the course
- Slugs must be lowercase-hyphenated, URL safe
- No duplicate slugs`;

const PROJECT_LESSON_PROMPT =
`You are CodeSera. Generate a complete guided project lesson as HTML sections.

OUTPUT RULES:
- Output ONLY <section> elements — no html/head/body/aside/nav tags
- Start directly with <section class="section" ...>
- No markdown fences, no explanation before or after
- Use real newlines in <code> tags, never \\n escape sequences

SECTION IDs: use the slugified version of each skill from SKILLS list as section IDs.
e.g. skill "Error Handling" → id="error-handling" data-section="error-handling"
The sidebar nav links are generated from SKILLS — section IDs MUST match exactly.

ALLOWED COMPONENTS (all pre-styled in lesson.css):
- Pills: <div class="pill-list"><span class="pill blue|green|yellow|purple">word</span></div>
- Cards grid: <div class="cards-grid"><div class="card">...</div></div>
- Callout: <div class="callout tip|info|warning|danger"><span class="callout-icon">EMOJI</span><div><strong>Label:</strong> text</div></div>
- Code: <div class="code-block"><div class="code-block-header"><div class="code-block-dots"><span></span><span></span><span></span></div><span class="code-block-lang">LANG</span><button class="copy-btn">Copy</button></div><pre><code class="language-LANG">CODE</code></pre></div>
- Table: <table class="def-table"><thead><tr><th>A</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>
- Steps: <ol class="steps"><li><div class="step-num">1</div><div class="step-body"><div class="step-title">T</div><div class="step-desc">D</div></div></li></ol>
- Doc link: <a href="URL" target="_blank" class="doc-link">📎 Official Docs</a>
- Inline code: <code>method()</code> within prose

PROJECT LESSON STRUCTURE:
1. Overview section: what we are building, final result preview, skills needed, time estimate
2. Setup section: folder structure, files to create, dependencies (if any)
3. Step-by-step build sections: each major feature/component as its own section
   - Start with the goal of this step in plain English
   - Show full working code for this step
   - Explain each important part with inline <code> references
   - Include callouts for common mistakes or tips
4. Final section: complete working code, how to run it, possible extensions

RULES:
- NO exercises — this is a guided build, not a quiz
- Code snippets can be long (20-50 lines) — show complete, working code
- Use inline <code>method()</code> for referencing things in prose
- Callout tip/warning for gotchas
- NEVER use external libraries unless absolutely core to the project`;

/* ── STORAGE ─────────────────────────────────────────────── */
function loadProjects() {
  try { return JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveProjectsData(courseId, data) {
  const all = loadProjects();
  all[courseId] = data;
  localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(all));
}

function getCourseProjects(courseId) {
  return loadProjects()[courseId] || { list: [], generated: {} };
}

/* ── LEVEL HELPERS ───────────────────────────────────────── */
const LEVEL_ORDER = ['beginner', 'intermediate', 'advanced', 'master'];

function getLevelsInRange(from, to) {
  const fi = LEVEL_ORDER.indexOf(from);
  const ti = LEVEL_ORDER.indexOf(to);
  if (fi < 0 || ti < 0) return [from, to];
  return LEVEL_ORDER.slice(fi, ti + 1);
}

function levelColor(level) {
  return { beginner: 'green', intermediate: 'blue', advanced: 'purple', master: 'red' }[level] || 'blue';
}

function levelEmoji(level) {
  return { beginner: '🌱', intermediate: '⚙️', advanced: '🔥', master: '🏆' }[level] || '📘';
}

/* ── OPEN PROJECTS PICKER ─────────────────────────────────── */
function openProjectsPicker(courseId) {
  const course = (typeof courses !== 'undefined' ? courses : []).find(c => c.id === courseId);
  if (!course) return;

  const modal  = document.getElementById('projectsModal');
  const title  = document.getElementById('projectsModalTitle');
  const list   = document.getElementById('projectsList');
  const moreBtn = document.getElementById('projectsMoreBtn');

  if (!modal) return;
  title.textContent = course.title;
  modal.dataset.cid = courseId;
  modal.classList.remove('hidden');

  const data = getCourseProjects(courseId);

  if (data.list.length === 0) {
    renderProjectsLoading(list);
    generateProjectsList(course).then(projects => {
      const updated = getCourseProjects(courseId);
      renderProjectsList(list, updated.list, courseId);
    }).catch(err => {
      list.innerHTML = `<div class="qpl-item" style="color:var(--red)">⚠️ ${escHtml(err.message)}</div>`;
    });
  } else {
    renderProjectsList(list, data.list, courseId);
  }

  if (moreBtn) {
    moreBtn.onclick = () => {
      renderProjectsLoading(list);
      generateProjectsList(course, true).then(() => {
        const updated = getCourseProjects(courseId);
        renderProjectsList(list, updated.list, courseId);
      }).catch(err => {
        showToast('⚠️ ' + err.message);
        const updated = getCourseProjects(courseId);
        renderProjectsList(list, updated.list, courseId);
      });
    };
  }
}

function renderProjectsLoading(container) {
  container.innerHTML = `
    <div style="text-align:center;padding:32px 20px">
      <div class="gen-spinner" style="width:24px;height:24px;border-width:3px;margin:0 auto 12px"></div>
      <div style="color:var(--txt2);font-size:13px">Generating project ideas…</div>
    </div>`;
}

function renderProjectsList(container, projects, courseId) {
  if (!projects.length) {
    container.innerHTML = '<div style="color:var(--txt3);font-size:13px;padding:12px">No projects yet.</div>';
    return;
  }

  const data = getCourseProjects(courseId);

  container.innerHTML = projects.map(p => {
    const done   = !!data.generated[p.slug];
    const color  = levelColor(p.level);
    const emoji  = levelEmoji(p.level);
    return `
      <div class="qpl-item proj-item" data-cid="${courseId}" data-slug="${escHtml(p.slug)}" style="flex-direction:column;align-items:flex-start;gap:6px">
        <div style="display:flex;align-items:center;gap:8px;width:100%">
          <div class="qpl-num" style="background:var(--${color === 'green' ? 'acc-l' : color === 'purple' ? 'acc-l' : 'acc-l'});flex-shrink:0">${emoji}</div>
          <div class="qpl-info" style="flex:1">
            <div class="qpl-title">${escHtml(p.title)}</div>
            <div class="qpl-meta">${escHtml(p.estimatedTime || '')} · <span class="pill ${color}" style="font-size:10px;padding:1px 7px">${p.level}</span></div>
          </div>
          <div style="font-size:11px;color:${done ? 'var(--green)' : 'var(--acc2)'}">
            ${done ? '✅ Done' : '▶ Build'}
          </div>
        </div>
        <div style="font-size:12px;color:var(--txt3);padding-left:36px">${escHtml(p.description)}</div>
        <div style="padding-left:36px;display:flex;flex-wrap:wrap;gap:4px">
          ${(p.skills||[]).map(sk => `<span class="pill blue" style="font-size:10px;padding:1px 7px">${escHtml(sk)}</span>`).join('')}
        </div>
      </div>`;
  }).join('');
}

function closeProjectsPicker() {
  document.getElementById('projectsModal')?.classList.add('hidden');
}

/* ── GENERATE PROJECTS LIST ──────────────────────────────── */
async function generateProjectsList(course, append = false) {
  const levels  = getLevelsInRange(course.settings.levelFrom, course.settings.levelTo);
  const topics  = course.lessons.map(l => l.title.split('—')[1]?.trim() || l.title).join(', ');

  const userMsg =
    `Course: ${course.title}\n` +
    `Topics covered: ${topics}\n` +
    `Levels to include: ${levels.join(', ')}\n` +
    `${append ? 'Generate 5 MORE different project ideas not already in the list.' : 'Generate the full project list.'}`;

  const raw     = await callApi(PROJECTS_LIST_PROMPT, userMsg);
  const cleaned = raw.replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();

  let projects;
  try { projects = JSON.parse(cleaned); }
  catch {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Invalid project list format');
    projects = JSON.parse(m[0]);
  }

  // Merge with existing
  const data    = getCourseProjects(course.id);
  const existing = new Set(data.list.map(p => p.slug));
  const newOnes  = projects.filter(p => !existing.has(p.slug));
  data.list      = [...data.list, ...newOnes];
  saveProjectsData(course.id, data);

  // Update token count
  if (typeof getTotalTokens === 'function') {
    const c = (typeof courses !== 'undefined' ? courses : []).find(x => x.id === course.id);
    if (c) { c.tokensUsed = (c.tokensUsed||0) + getTotalTokens(); if(typeof saveCourses==='function') saveCourses(); }
  }

  return data.list;
}

/* ── GENERATE PROJECT LESSON ─────────────────────────────── */
async function buildProjectLesson(courseId, slug) {
  const course  = (typeof courses !== 'undefined' ? courses : []).find(c => c.id === courseId);
  if (!course) return;

  const data    = getCourseProjects(courseId);
  const project = data.list.find(p => p.slug === slug);
  if (!project) return;

  closeProjectsPicker();

  // Show overlay
  if (typeof showGenOverlay === 'function') showGenOverlay(`Building: ${project.title}`);
  if (typeof updateGenOverlay === 'function') updateGenOverlay('Generating project lesson…', 0.1);

  try {
    const topics   = course.lessons.map(l => l.title.split('—')[1]?.trim() || l.title).join(', ');

    const userMsg =
      `Course: ${course.title}\n` +
      `Project: ${project.title}\n` +
      `Level: ${project.level}\n` +
      `Skills: ${(project.skills||[]).join(', ')}\n` +
      `Time estimate: ${project.estimatedTime || '2-3 hours'}\n` +
      `Course covered: ${topics}\n\n` +
      `Build a complete guided project lesson. Show full working code at each step.\n` +
      `Use inline <code>references</code> in prose. No exercises. Long code blocks are fine.`;

    if (typeof updateGenOverlay === 'function') updateGenOverlay('Writing project steps…', 0.3);

    const raw = await callApi(PROJECT_LESSON_PROMPT, userMsg);
    const content = raw
      .replace(/^```html\s*/i,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim()
      .replace(/<code([^>]*)>([\s\S]*?)<\/code>/g, (_,a,c) =>
        `<code${a}>${c.replace(/\\n/g,'\n').replace(/\\t/g,'  ')}</code>`);

    if (typeof updateGenOverlay === 'function') updateGenOverlay('Assembling project page…', 0.7);

    // Assemble full HTML via renderer
    const lang = typeof detectLang === 'function' ? detectLang(course.title) : 'javascript';
    const meta = {
      courseTitle: course.title,
      lessonTitle: project.title,
      lessonNum:   1,
      total:       1,
      levelFrom:   project.level,
      levelTo:     project.level,
      style:       course.settings?.style || 'explanatory',
      topics:      project.skills || [],
      prevFile:    '#',
      prevTitle:   '',
      nextFile:    '#',
      nextTitle:   '',
      selfFile:    project.slug + '.html',
    };

    // Normalize section IDs to match nav slugs (project.skills = nav topics)
    const normalizedContent = typeof normalizeSectionIds === 'function'
      ? normalizeSectionIds(content, project.skills || [])
      : content;

    let html = typeof renderLesson === 'function'
      ? renderLesson(normalizedContent, meta, lang)
      : `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${project.title}</title><link rel="stylesheet" href="../lesson.css"></head><body><main class="main-content">${normalizedContent}</main></body></html>`;

    // Remove NAV_LOADER (fetches nav.html which doesn't exist in projects/ subfolder)
    // Remove NAV_LOADER script — try multiple patterns to ensure it's stripped
    html = html.replace(/<script>\s*\(function\(\)\{(?:[^<]|<(?!\/script>))*fetch\('nav\.html'\)(?:[^<]|<(?!\/script>))*<\/script>/gs, '');
    // Fallback: remove any inline script containing fetch('nav.html')
    html = html.replace(/<script>[\s\S]*?fetch\('nav\.html'\)[\s\S]*?<\/script>/g, '');

    // Inject simple back-to-course link in sidebar instead
    html = html.replace(
      '</aside>',
      `<div style="padding:16px 20px;border-top:1px solid var(--sidebar-border);margin-top:auto">
        <a href="../index.html" style="display:flex;align-items:center;gap:8px;color:var(--sidebar-text);text-decoration:none;font-size:13px;padding:8px 12px;border-radius:8px;background:var(--sidebar-hover)">
          ← Back to ${escHtml(course.title)}
        </a>
      </div></aside>`
    );

    // Save to localStorage
    data.generated[slug] = { html, generatedAt: Date.now() };
    saveProjectsData(courseId, data);

    // Save to server in projects/ subfolder
    if (typeof _serverAvailable !== 'undefined' && _serverAvailable && course.safeFolderName) {
      try {
        const filename = `${slug}.html`;
        await serverSave(`${course.safeFolderName}/projects/${filename}`, html);
        // Save blank nav.html to silence 404 — projects don't use course nav
        await serverSave(`${course.safeFolderName}/projects/nav.html`, '<html><body></body></html>');
        if (typeof updateGenOverlay === 'function') updateGenOverlay(`💾 Saved projects/${filename}`, 0.9);
      } catch(e) { console.warn('Project save failed:', e); }
    }

    // Update token count
    if (typeof getTotalTokens === 'function') {
      const c = (typeof courses !== 'undefined' ? courses : []).find(x => x.id === courseId);
      if (c) { c.tokensUsed = (c.tokensUsed||0) + getTotalTokens(); if(typeof saveCourses==='function') saveCourses(); }
    }

    if (typeof hideGenOverlay === 'function') hideGenOverlay();

    // Open in new tab
    openProjectInTab(html, course, project);

    if (typeof showToast === 'function') showToast(`✅ Project "${project.title}" ready!`);

  } catch(err) {
    if (typeof hideGenOverlay === 'function') hideGenOverlay();
    if (typeof showToast === 'function') showToast('⚠️ ' + err.message);
    console.error('buildProjectLesson failed:', err);
  }
}

function openProjectInTab(html, course, project) {
  // Prefer server URL so CSS/JS assets load from disk
  if (typeof _serverAvailable !== 'undefined' && _serverAvailable && course?.safeFolderName && project?.slug) {
    const url = `http://localhost:3000/${encodeURIComponent(course.safeFolderName)}/projects/${project.slug}.html`;
    window.open(url, '_blank');
    return;
  }
  // Fallback: in-memory tab
  const win = window.open('', '_blank');
  if (!win) { if(typeof showToast==='function') showToast('Popup blocked.'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/* ── OPEN SAVED PROJECT ───────────────────────────────────── */
function openSavedProject(courseId, slug) {
  const data    = getCourseProjects(courseId);
  const saved   = data.generated?.[slug];
  if (!saved?.html) {
    // Not generated yet — generate now
    buildProjectLesson(courseId, slug);
    return;
  }
  const course  = (typeof courses !== 'undefined' ? courses : []).find(c => c.id === courseId);
  const project = data.list.find(p => p.slug === slug);
  openProjectInTab(saved.html, course, project);
}

/* ── INIT PROJECT EVENTS ─────────────────────────────────── */
function initProjectEvents() {
  const modal    = document.getElementById('projectsModal');
  const closeBtn = document.getElementById('projectsModalClose');
  const list     = document.getElementById('projectsList');

  if (closeBtn) closeBtn.addEventListener('click', closeProjectsPicker);
  if (modal)    modal.addEventListener('click', e => { if (e.target === modal) closeProjectsPicker(); });

  if (list) {
    list.addEventListener('click', e => {
      const item = e.target.closest('.proj-item');
      if (!item) return;
      const { cid, slug } = item.dataset;
      if (!cid || !slug) return;
      openSavedProject(cid, slug);
    });
  }
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
