/* ═══════════════════════════════════════════════════════════
   CodeSera — renderer.js
   Assembles complete lesson HTML from AI content fragments.
   AI writes only <section> content. JS owns all structure:
   shell, sidebar, header, nav, scripts — guaranteed correct.
═══════════════════════════════════════════════════════════ */

'use strict';

/* ── HTML ESCAPE ─────────────────────────────────────────── */
function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── LEVEL → badge class ─────────────────────────────────── */
function levelBadge(from) {
  if (from === 'advanced')     return { cls: 'advanced',     emoji: '🔥' };
  if (from === 'intermediate') return { cls: 'intermediate', emoji: '⚙️' };
  return                              { cls: 'beginner',     emoji: '🌱' };
}

/* ── COURSE ICON ─────────────────────────────────────────── */
function courseIcon(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('python'))                           return '🐍';
  if (t.includes('c++') || t.includes('cpp'))        return '⚡';
  if (t.includes('c#')  || t.includes('csharp'))     return '🎮';
  if (t.includes('java'))                             return '☕';
  if (t.includes('rust'))                             return '🦀';
  if (t.includes('go ') || t.match(/\bgo\b/))        return '🐹';
  if (t.includes('javascript') || t.includes('js'))  return '⚛️';
  if (t.includes('typescript'))                       return '🔷';
  if (t.includes('math'))                             return '🔢';
  if (t.includes('algo') || t.includes('dsa'))       return '🌳';
  if (t.includes('web') || t.includes('html'))       return '🌐';
  if (t.includes('sql') || t.includes('data'))       return '🗄️';
  return '📘';
}

/* ══════════════════════════════════════════════════════════
   RENDER FULL LESSON PAGE
   params:
     content     — AI-generated <section> HTML fragments
     meta        — { courseTitle, lessonTitle, lessonNum,
                     total, levelFrom, levelTo, style,
                     prevFile, prevTitle, nextFile, nextTitle,
                     topics[] }
     prismLang   — e.g. 'python', 'javascript', 'cpp'
══════════════════════════════════════════════════════════ */
function renderLesson(content, meta, prismLang) {
  const badge   = levelBadge(meta.levelFrom);
  const icon    = courseIcon(meta.courseTitle);
  const lang    = prismLang || detectLang(meta.courseTitle + ' ' + (meta.topics || []).join(' '));


  // Clean up AI content — strip any accidental full-page wrapping
  let safeContent = content
    .replace(/^```html\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<html[^>]*>/gi, '').replace(/<\/html>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<body[^>]*>/gi, '').replace(/<\/body>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<button[^>]*sidebar-toggle[^>]*>[\s\S]*?<\/button>/gi, '')
    .replace(/<link[^>]*lesson\.css[^>]*\/?>/gi, '')
    .replace(/<script[^>]*lesson\.js[^>]*><\/script>/gi, '')
    .replace(/<main[^>]*>/gi, '').replace(/<\/main>/gi, '')
    .trim();

  // Extract topics from first section for meta display
  const sectionCount = (safeContent.match(/<section/gi) || []).length;
  const exerciseCount = (safeContent.match(/class="exercise-section"/gi) || []).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${esc(meta.courseTitle)} — ${esc(meta.lessonTitle)}</title>
  <style id="lf-theme">${LESSON_CSS}</style>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>
  <script>if(typeof Prism!=='undefined'&&Prism.plugins&&Prism.plugins.autoloader){Prism.plugins.autoloader.languages_path='https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/';}</script>
</head>
<body>
<button class="sidebar-toggle">☰</button>

${renderSidebarShell(meta, icon)}

<main class="main-content">

  ${renderPageHeader(meta, badge)}

  ${safeContent}

  ${renderLessonNav(meta)}

  <div class="completion-banner">
    <div class="completion-emoji">🏆</div>
    <div class="completion-title">Lesson Complete!</div>
    <div class="completion-msg">Great work! Move on to the next lesson.</div>
  </div>

</main>

<script src="/lesson.js"></script>
<script src="/lesson-chat.js"></script>
<script>
if(typeof Prism !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function(){ Prism.highlightAll(); });
  window.addEventListener('load', function(){ Prism.highlightAll(); });
}
</script>

<button id="lf-theme-toggle" title="Switch to Light" style="position:fixed;bottom:20px;right:20px;z-index:9999;width:40px;height:40px;border-radius:50%;border:none;font-size:18px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);background:#1e2433;color:#fff;display:flex;align-items:center;justify-content:center;transition:background .2s,color .2s">☀️</button>
<script>
(function(){
  var DARK_CSS  = ${JSON.stringify(LESSON_CSS)};
  var LIGHT_CSS = ${JSON.stringify(LESSON_LIGHT_CSS)};
  var btn       = document.getElementById('lf-theme-toggle');
  var themeEl   = document.getElementById('lf-theme');

  function applyTheme(isLight) {
    if (!themeEl) return;
    themeEl.textContent = isLight ? LIGHT_CSS : DARK_CSS;
    document.body.classList.toggle('lf-light', isLight);
    if (btn) {
      btn.textContent       = isLight ? '🌙' : '☀️';
      btn.title             = isLight ? 'Switch to Dark' : 'Switch to Light';
      btn.style.background  = isLight ? '#e8edf8' : '#1e2433';
      btn.style.color       = isLight ? '#1e2433' : '#ffffff';
    }
    try { localStorage.setItem('lf-page-theme', isLight ? 'light' : 'dark'); } catch(e) {}
  }

  if (btn) btn.addEventListener('click', function() {
    applyTheme(!document.body.classList.contains('lf-light'));
  });

  // Restore saved preference on load
  try {
    if (localStorage.getItem('lf-page-theme') === 'light') applyTheme(true);
  } catch(e) {}
})();
<\/script>

${NAV_LOADER_INLINE}
</body>
</html>`;
}

/* ── SIDEBAR SHELL (replaced at runtime by nav.html) ─────── */
function renderSidebarShell(meta, icon) {
  // Build nav items - use allLessons if provided for full nav, else just current
  const lessons = meta.allLessons && meta.allLessons.length
    ? meta.allLessons
    : [{ num: meta.lessonNum, title: meta.lessonTitle, topics: meta.topics||[], file: meta.selfFile||('lesson-'+meta.lessonNum+'.html') }];

  const navItems = lessons.map(function(l) {
    const isActive = l.num === meta.lessonNum;
    const subtopics = (l.topics||[]).map(t =>
      '<li><a href="'+l.file+'#'+slugify(t)+'">'+esc(t)+'</a></li>'
    ).join('');
    return `<div class="nav-section">
      <div class="nav-topic${isActive?' open active':''}">
        <div class="topic-icon">${l.num}</div>
        <span class="nav-topic-label">${esc(l.title)}</span><span class="chevron">›</span>
      </div>
      <ul class="nav-subtopics${isActive?' open':''}">${subtopics}</ul>
    </div>`;
  }).join('');

  return `<aside class="sidebar">
  <div class="sidebar-header">
    <div class="sidebar-logo">
      <div class="logo-icon">${icon}</div>
      <div class="logo-text">${esc(meta.courseTitle)}<span class="logo-sub">Lesson ${meta.lessonNum} of ${meta.total}</span></div>
    </div>
  </div>
  <div class="sidebar-progress">
    <div class="progress-label"><span>Progress</span><span>0%</span></div>
    <div class="progress-bar"><div class="progress-bar-fill"></div></div>
  </div>
  <nav class="sidebar-nav">${navItems}</nav>
</aside>`;
}

/* ── PAGE HEADER ─────────────────────────────────────────── */
function renderPageHeader(meta, badge) {
  const words = (meta.lessonTitle || '').trim().split(/\s+/);
  const titleMain = words.slice(0, -1).join(' ') || meta.lessonTitle;
  const titleLast = words.length > 1 ? words.at(-1) : '';

  return `<header class="page-header">
  <span class="page-badge ${badge.cls}">${badge.emoji} ${badge.cls.charAt(0).toUpperCase() + badge.cls.slice(1)}</span>
  <h1 class="page-title">${esc(titleMain)} <span>${esc(titleLast)}</span></h1>
  <p class="page-subtitle">Part of <strong>${esc(meta.courseTitle)}</strong> · ${esc(meta.levelFrom)} → ${esc(meta.levelTo)}</p>
  <div class="page-meta">
    <span class="meta-item"><span>📖</span> Lesson ${meta.lessonNum} of ${meta.total}</span>
    <span class="meta-item"><span>🎯</span> ${esc(meta.levelFrom)}→${esc(meta.levelTo)}</span>
  </div>
</header>`;
}

/* ── LESSON NAV ──────────────────────────────────────────── */
function renderLessonNav(meta) {
  const prevBtn = meta.prevFile && meta.prevFile !== '#'
    ? `<a href="${esc(meta.prevFile)}" class="lesson-nav-btn prev">
        <div class="nav-direction">← Previous</div>
        <div class="nav-btn-title">${esc(meta.prevTitle || 'Previous')}</div>
      </a>`
    : `<span></span>`;

  const nextBtn = meta.nextFile && meta.nextFile !== '#'
    ? `<a href="${esc(meta.nextFile)}" class="lesson-nav-btn next">
        <div class="nav-direction">Next →</div>
        <div class="nav-btn-title">${esc(meta.nextTitle || 'Next')}</div>
      </a>`
    : `<span></span>`;

  return `<nav class="lesson-nav">${prevBtn}${nextBtn}</nav>`;
}

/* ── NAV LOADER (fetches nav.html and replaces sidebar) ──── */
const NAV_LOADER_INLINE = `<script>
(function(){
  var cur = location.pathname.split('/').pop() || 'index.html';
  var isServer = location.protocol === 'http:' || location.protocol === 'https:';

  // Mark the current lesson as active in nav and open its subtopics
  function markActive(root) {
    var ctx = root || document;
    var anyActive = false;
    ctx.querySelectorAll('.nav-section').forEach(function(sec) {
      var links = sec.querySelectorAll('.nav-subtopics a[href]');
      var secActive = false;
      links.forEach(function(a) {
        var file = a.getAttribute('href').split('#')[0];
        if (file === cur) secActive = true;
      });
      var sub   = sec.querySelector('.nav-subtopics');
      var topic = sec.querySelector('.nav-topic');
      if (secActive) {
        anyActive = true;
        if (sub)   sub.classList.add('open');
        if (topic) topic.classList.add('open', 'active');
      }
    });
    // Fallback: open first section
    if (!anyActive) {
      var first = ctx.querySelector('.nav-section');
      if (first) {
        var sub   = first.querySelector('.nav-subtopics');
        var topic = first.querySelector('.nav-topic');
        if (sub)   sub.classList.add('open');
        if (topic) topic.classList.add('open', 'active');
      }
    }
  }

  // Wire chevron click toggling
  function wireToggles(root) {
    (root||document).querySelectorAll('.nav-topic').forEach(function(topic) {
      topic.style.cursor = 'pointer';
      topic.addEventListener('click', function() {
        var ctx = root || document;
        var sec = topic.closest('.nav-section');
        var sub = sec && sec.querySelector('.nav-subtopics');
        if (!sub) return;
        var isOpen = sub.classList.contains('open');
        // Close all sections (only open/chevron state, NOT active-sub links)
        ctx.querySelectorAll('.nav-subtopics').forEach(function(s){ s.classList.remove('open'); });
        ctx.querySelectorAll('.nav-topic').forEach(function(t){ t.classList.remove('open','active'); });
        // Open clicked section if it was closed
        if (!isOpen) { sub.classList.add('open'); topic.classList.add('open','active'); }
        // Re-mark the active link after toggling — never clear active-sub on close
        markActive(root);
      });
    });
  }

  // Wire nav link clicks
  // If served from server: native links work — just update active state
  // If in-memory tab (about:blank): intercept and postMessage to opener
  // Smart scroll: if anchor ID missing, find heading by text match
  function scrollToAnchor(hash) {
    var id = hash.replace('#','');
    var el = document.getElementById(id) || document.querySelector('[data-section="'+id+'"]');
    if (!el) {
      // Fallback: find heading whose text slugifies to the same value
      var headings = document.querySelectorAll('h2,h3,h4');
      for (var i=0;i<headings.length;i++){
        var hid = headings[i].textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
        if (hid === id || headings[i].id === id) { el = headings[i]; break; }
      }
    }
    if (el) { el.scrollIntoView({behavior:'smooth', block:'start'}); }
  }

  function wireLinks(root) {
    (root||document).querySelectorAll('a[href]').forEach(function(a) {
      var h = a.getAttribute('href');
      // Handle pure anchor links (same-page topic links)
      if (/^#.+/.test(h)) {
        a.addEventListener('click', function(e) {
          e.preventDefault();
          scrollToAnchor(h);
          (root||document).querySelectorAll('.nav-subtopics a').forEach(function(x){ x.classList.remove('active-sub'); });
          a.classList.add('active-sub');
        });
        return;
      }
      // Handle cross-lesson links (lesson-N.html or index.html, with optional #anchor)
      if (!/^(lesson-[0-9]+\.html|index\.html)(#.*)?$/.test(h)) return;
      var parts = h.split('#');
      var file  = parts[0];
      var anchor= parts[1] ? '#'+parts[1] : '';
      if (isServer) {
        // Server-served: native navigation, handle anchor separately
        if (anchor) {
          a.addEventListener('click', function(e) {
            // If same file, scroll instead of navigate
            if (file === cur) {
              e.preventDefault();
              scrollToAnchor(anchor);
              (root||document).querySelectorAll('.nav-subtopics a').forEach(function(x){ x.classList.remove('active-sub'); });
              a.classList.add('active-sub');
            }
            // Different file: let native link handle it
          });
        }
        a.addEventListener('click', function() {
          (root||document).querySelectorAll('.nav-subtopics a').forEach(function(x){ x.classList.remove('active-sub'); });
          a.classList.add('active-sub');
        });
      } else {
        // In-memory tab: postMessage to opener
        a.addEventListener('click', function(e) {
          e.preventDefault();
          var cid = window.__lfCourseId;
          try { if (!cid) cid = localStorage.getItem('lf_open_course_id'); } catch(x){}
          if (!cid) return;
          var msg = { type:'lf-open', courseId:cid, href:h };
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(msg, '*');
          } else {
            try { var bc = new BroadcastChannel('lf_nav'); bc.postMessage(msg); bc.close(); } catch(x){}
          }
        });
      }
    });
  }

  function initNav(root) {
    markActive(root);
    wireToggles(root);
    wireLinks(root);
    var toggle = document.querySelector('.sidebar-toggle');
    if (toggle) toggle.addEventListener('click', function(){
      var aside = (root||document).querySelector('aside.sidebar');
      if (aside) aside.classList.toggle('open');
    });
  }

  // Try fetch nav.html for full lesson list (only from course root, not subfolders)
  var inSubfolder = location.pathname.split('/').length > 3;
  var navPromise  = inSubfolder
    ? Promise.reject('subfolder')
    : fetch('nav.html').then(function(r){ return r.ok ? r.text() : Promise.reject('not found'); });
  navPromise
    .then(function(html) {
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      var shared = tmp.querySelector('#sharedSidebar');
      var local  = document.querySelector('aside.sidebar');
      if (shared && local) {
        local.replaceWith(shared);
        initNav(shared);
      }
    })
    .catch(function() {
      // nav.html unavailable — use shell sidebar as-is
      initNav(null);
    });
})();
<\/script>`;

/* ── LANGUAGE DETECTION ──────────────────────────────────── */
function detectLang(text) {
  const t = text.toLowerCase();
  if (t.includes('python'))                         return 'python';
  if (t.includes('javascript') || t.includes('js'))return 'javascript';
  if (t.includes('typescript'))                     return 'typescript';
  if (/\bc\b/.test(t) && !t.includes('c++') && !t.includes('css') && !t.includes('csharp') && !t.includes('script')) return 'c';
  if (t.includes('c++') || t.includes('cpp'))      return 'cpp';
  if (t.includes('c#') || t.includes('csharp'))    return 'csharp';
  if (t.includes('java'))                           return 'java';
  if (t.includes('rust'))                           return 'rust';
  if (t.includes('go ') || t.match(/\bgo\b/))      return 'go';
  if (t.includes('php'))                            return 'php';
  if (t.includes('ruby'))                           return 'ruby';
  if (t.includes('sql'))                            return 'sql';
  if (t.includes('bash') || t.includes('shell'))   return 'bash';
  if (t.includes('css'))                            return 'css';
  if (t.includes('html'))                           return 'markup';
  if (t.includes('swift'))                          return 'swift';
  if (t.includes('kotlin'))                         return 'kotlin';
  return 'javascript'; // safe default
}

/* ── SLUGIFY ─────────────────────────────────────────────── */
function slugify(str) {
  return String(str).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ══════════════════════════════════════════════════════════
   RENDER COURSE INDEX PAGE
══════════════════════════════════════════════════════════ */
function renderIndex(plan, lessonTitles) {
  const icon  = courseIcon(plan.courseTitle);
  const words = (plan.courseTitle || '').trim().split(/\s+/);
  const titleMain = words.slice(0, -1).join(' ') || plan.courseTitle;
  const titleLast = words.length > 1 ? words.at(-1) : '';

  const rows = lessonTitles.map((title, i) => {
    const short = title.split('—')[1]?.trim() || title;
    return `<a href="lesson-${i+1}.html" class="idx-card">
      <div class="idx-num">${i+1}</div>
      <div class="idx-info">
        <div class="idx-title">${esc(short)}</div>
        <div class="idx-sub">Lesson ${i+1} of ${lessonTitles.length}</div>
      </div>
      <span class="idx-arrow">→</span>
    </a>`;
  }).join('');

  const navItems = lessonTitles.map((t, i) => {
    const s = t.split('—')[1]?.trim() || t;
    return `<li><a href="lesson-${i+1}.html">${esc(s)}</a></li>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${esc(plan.courseTitle)}</title>
  <style id="lf-theme">${LESSON_CSS}</style>
</head>
<body>
<button class="sidebar-toggle">☰</button>
<aside class="sidebar">
  <div class="sidebar-header">
    <div class="sidebar-logo">
      <div class="logo-icon">${icon}</div>
      <div class="logo-text">${esc(plan.courseTitle)}<span class="logo-sub">Course Index</span></div>
    </div>
  </div>
  <nav class="sidebar-nav">
    <div class="nav-section">
      <div class="nav-topic"><div class="topic-icon">📋</div>Lessons<span class="chevron">›</span></div>
      <ul class="nav-subtopics">${navItems}</ul>
    </div>
  </nav>
</aside>
<main class="main-content">
  <header class="page-header">
    <span class="page-badge beginner">📚 Course</span>
    <h1 class="page-title">${esc(titleMain)} <span>${esc(titleLast)}</span></h1>
    <p class="page-subtitle">${esc(plan.description || '')}</p>
    <div class="page-meta">
      <span class="meta-item"><span>📖</span> ${lessonTitles.length} lessons</span>
      <span class="meta-item"><span>🎯</span> ${esc(plan.targetAudience || 'All levels')}</span>
    </div>
  </header>
  <section class="section" id="lessons" data-section="lessons">
    <h2 class="section-title"><div class="section-num">📋</div>Course Lessons</h2>
    <div class="idx-grid">${rows}</div>
  </section>
  <div style="margin-top:40px">
    <a href="lesson-1.html" class="lesson-nav-btn next" style="display:inline-flex;text-decoration:none">
      <div class="nav-direction">Start Course →</div>
      <div class="nav-btn-title">${esc(lessonTitles[0]?.split('—')[1]?.trim() || 'Lesson 1')}</div>
    </a>
  </div>
</main>
<script src="/lesson.js"></script>
</body>
</html>`;
}

/* ══════════════════════════════════════════════════════════
   RENDER NAV.HTML (shared sidebar — fetched by all lessons)
══════════════════════════════════════════════════════════ */
function renderNav(plan, lessonTitles, lessonTopics) {
  const icon  = courseIcon(plan.courseTitle);
  // lessonTopics is optional array of topic arrays [[t1,t2],[t1,t2],...]
  const items = lessonTitles.map((title, i) => {
    const short  = title.split('—')[1]?.trim() || title;
    const topics = (lessonTopics && lessonTopics[i]) || [];
    const subItems = topics.length
      ? topics.map(t => `<li><a href="lesson-${i+1}.html#${slugify(t)}">${esc(t)}</a></li>`).join('')
      : `<li><a href="lesson-${i+1}.html">${esc(short)}</a></li>`;
    return `<div class="nav-section">
      <div class="nav-topic">
        <div class="topic-icon">${i+1}</div>
        <span class="nav-topic-label">${esc(short)}</span><span class="chevron">›</span>
      </div>
      <ul class="nav-subtopics">${subItems}</ul>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style id="lf-theme">${LESSON_CSS}</style></head><body>
<aside class="sidebar" id="sharedSidebar">
  <div class="sidebar-header">
    <div class="sidebar-logo">
      <div class="logo-icon">${icon}</div>
      <div class="logo-text">${esc(plan.courseTitle)}<span class="logo-sub">${lessonTitles.length} lessons</span></div>
    </div>
  </div>
  <div class="sidebar-progress">
    <div class="progress-label"><span>Progress</span><span>0%</span></div>
    <div class="progress-bar"><div class="progress-bar-fill"></div></div>
  </div>
  <nav class="sidebar-nav">${items}</nav>
</aside>
</body></html>`;
}
