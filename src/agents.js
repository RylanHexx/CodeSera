/* ═══════════════════════════════════════════════════════════
   CodeSera — agents.js
   Multi-agent pipeline:
     1. PlannerAgent  → course structure JSON
     2. ResearchAgent → per-lesson deep notes
     3. WriterAgent   → full HTML lesson files
     4. IndexAgent    → course index page
═══════════════════════════════════════════════════════════ */

'use strict';

/* ── STOP SIGNAL ─────────────────────────────────────────── */
let _stopRequested = false;
function requestStop()  { _stopRequested = true;  }
function resetStop()    { _stopRequested = false; }
function isStopped()    { return _stopRequested;  }

/* ── EVENT BUS ───────────────────────────────────────────── */
const AgentEvents = {
  _l: {},
  on(e, fn)  { (this._l[e] = this._l[e] || []).push(fn); },
  off(e, fn) { if (this._l[e]) this._l[e] = this._l[e].filter(f => f !== fn); },
  emit(e, d) { (this._l[e] || []).forEach(fn => fn(d)); },
};

/* ── PROMPTS ─────────────────────────────────────────────── */

const PLANNER_PROMPT =
`You are an expert curriculum designer. Output ONLY valid JSON, no markdown, no explanation.

JSON schema:
{
  "courseTitle": "string (4-7 words, descriptive)",
  "description": "string (1-2 sentences)",
  "targetAudience": "string",
  "lessons": [
    {
      "id": "lesson-N",
      "title": "string",
      "topics": ["keyword1", "keyword2", "keyword3"],
      "docsHints": ["official doc URL or doc name to reference"]
    }
  ]
}

Rules:
- beginner→intermediate: 4-5 lessons
- intermediate→advanced: 5-6 lessons  
- beginner→master: 7-8 lessons
- Each lesson: 3-5 topics, 1-2 doc hints (official docs, MDN, Python docs, Rust book, etc.)
- Titles must be progressive and build on each other
- Topics are specific, not vague
- FIRST lesson must always be: "[Language] Overview, History & Setup" — never jump straight to syntax`;

const RESEARCH_PROMPT =
`You are a senior technical writer and educator. Write dense, accurate lesson notes.

Format (plain text only, no HTML):
CORE CONCEPTS:
[3-5 precise technical explanations, each 2-3 sentences. Reference exact syntax, behavior, edge cases.]

CODE PATTERNS:
[2-3 concrete code snippets with brief explanations. Include real-world usage patterns.]

COMMON PITFALLS:
[3-4 specific mistakes beginners make, with why they happen and how to fix them.]

PRO TIPS:
[2-3 practical tips from real usage, performance or best practices.]

DEPTH REQUIREMENT: Be specific and technical. Avoid generic advice. Max 400 words.
Reference official documentation patterns where relevant.`;

/* ── WRITER SYSTEM PROMPT ────────────────────────────────── */
/* ── WRITER SYSTEM PROMPT ───────────────────────────────────
   Single-pass. Lean — no HTML boilerplate (model knows HTML).
   Just rules + lesson.css class reference + teaching approach.
──────────────────────────────────────────────────────────── */
/* ── WRITER SYSTEM PROMPT (hybrid — sections only) ───────────
   AI writes ONLY <section> content fragments.
   JS renderer (renderer.js) assembles the full page shell.
   This halves token usage and makes structure 100% reliable.
──────────────────────────────────────────────────────────── */
const WRITER_SYSTEM_PROMPT =
`You are a technical educator. Generate HTML content sections for a lesson page.

OUTPUT RULES:
- Output ONLY <section> elements. Nothing else — no html/head/body/aside/nav/script tags.
- Start your output directly with <section class="section" ...>
- No markdown fences, no explanation before or after.
- Use real newlines inside <code> tags. Never \\n escape sequences.

REQUIRED ON EVERY SECTION:
<section class="section" id="SLUG" data-section="SLUG">
  <h2 class="section-title"><div class="section-num">N</div>Title</h2>
  [content]
</section>
- id and data-section MUST be the slugified version of the topic name from TOPICS list
  e.g. topic "For Loops" → id="for-loops" data-section="for-loops"
- section-num counts up: 1, 2, 3...
- Subsections: <div class="subsection" id="sub-slug" data-section="sub-slug"><h3 class="subsection-title">T</h3></div>
- At the very top of each section's content (after h2), add: <span id="SLUG" style="display:block;height:0;margin:0;padding:0"></span>
  This anchor ensures nav links scroll to the right position even with sticky headers.

ALLOWED COMPONENTS (all pre-styled — use freely):
Pills: <div class="pill-list"><span class="pill blue|green|yellow|purple">word</span></div>
Cards: <div class="cards-grid"><div class="card"><div class="card-header"><div class="card-icon blue|green|yellow|purple|red">EMOJI</div><div><div class="card-title">T</div></div></div><p>text</p></div></div>
Callout: <div class="callout tip|info|warning|danger"><span class="callout-icon">EMOJI</span><div><strong>Label:</strong> text</div></div>
Code: <div class="code-block"><div class="code-block-header"><div class="code-block-dots"><span></span><span></span><span></span></div><span class="code-block-lang">LANG</span><button class="copy-btn">Copy</button></div><pre><code class="language-LANG">CODE HERE</code></pre></div>
Table: <table class="def-table"><thead><tr><th>A</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>
Steps: <ol class="steps"><li><div class="step-num">1</div><div class="step-body"><div class="step-title">T</div><div class="step-desc">D</div></div></li></ol>
Doc link: <a href="URL" target="_blank" class="doc-link">📎 Official Docs</a>
Exercise (only when valuable):
<div class="exercise-section"><div class="exercise-header"><div class="ex-icon">🧩</div><div><div class="exercise-title">T</div><div class="exercise-subtitle">N questions</div></div><div class="exercise-score">0/0<span>Score</span></div></div>
MCQ: <div class="mcq-card" data-answer="b"><div class="mcq-question"><span class="q-num">Q1</span> Q?</div><div class="mcq-options"><div class="mcq-option" data-value="a"><span class="opt-letter">A</span><span>opt</span><span class="opt-icon"></span></div>[repeat b,c,d]</div><div class="mcq-feedback"><span>💡</span><span class="fb-text">Explanation.</span></div></div>
Fill: <div class="fill-card" data-answer="method()|Method()"><div class="fill-question"><span class="q-num">Q2</span> Which method does X? <code>str.___</code></div><input class="fill-input" type="text" placeholder="e.g. split()"><div class="fill-hint">Type the method/value with parentheses if needed</div></div>
  For non-code courses use: data-answer="word|alternative" with a plain text placeholder.
TF: <div class="tf-card" data-answer="true|false"><div class="tf-question"><span class="q-num">Q3</span> S.</div><div class="tf-buttons"><button class="tf-btn true-btn">✅ True</button><button class="tf-btn false-btn">❌ False</button></div></div>
End every exercise-section with: <div class="exercise-actions"><button class="btn btn-primary btn-check">Check ✓</button><button class="btn btn-ghost btn-reset">↺ Reset</button></div><div class="exercise-result"></div></div>

STRICT CONSTRAINTS:
- NEVER use external libraries (no Bootstrap, Font Awesome, jQuery, Tailwind, etc.)
- NEVER put code outside .code-block — all code inside <pre><code class="language-LANG">
- NEVER output a full HTML page — only <section> elements
- ONLY use the CSS classes listed above — do not invent new ones
- All id and data-section must be lowercase-hyphenated slugs matching the TOPICS list order
- EXPANDABLE SECTIONS: Add data-expandable="true" on <section> tags where a learner might want deeper detail (complex concepts, large APIs, advanced patterns). Do NOT add it to intro/overview/summary sections.

TEACHING APPROACH:
- HISTORY & SETUP: Only include language history, who invented it, and installation guide in LESSON 1 (when LESSON_NUM=1). All other lessons must NOT include history or setup — jump straight into the topic.
- OPENING: Start each concept section with one plain-English sentence explaining what the concept does in real life. Vary the opening — never start with the word "Why".
- INLINE CODE: Use <code>methodName()</code> inline within prose for mentioning names, syntax, or short expressions — e.g. "Use <code>str.split()</code> to divide a string." This is the PRIMARY way to reference code in explanations.
- FULL CODE BLOCKS (.code-block): Only use for runnable examples (min 3 lines). Show expected output as comments. Keep first example per section to 5-8 lines. Optionally add a more complete example at end of section.
- SECONDARY METHODS: One sentence description with inline <code> + doc link. Never a full code block.
- Callouts: tip=best practice, info=interesting context, warning=common mistake, danger=code-breaking error.`;

/* ── SECTION ID NORMALIZER ──────────────────────────────────
   After AI generates content, remap section IDs to match the
   exact slugs used in the sidebar nav links. This ensures
   nav topic links always scroll to the right section.
──────────────────────────────────────────────────────────── */
function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

// Score how well a section heading matches a topic name
function topicMatchScore(heading, topic) {
  const h = heading.toLowerCase().replace(/[^a-z0-9 ]/g,' ').trim();
  const t = topic.toLowerCase().replace(/[^a-z0-9 ]/g,' ').trim();
  if (h === t) return 100;
  if (h.includes(t) || t.includes(h)) return 80;
  // Word overlap
  const hw = new Set(h.split(/\s+/));
  const tw = t.split(/\s+/);
  const overlap = tw.filter(w => hw.has(w)).length;
  return overlap > 0 ? (overlap / Math.max(hw.size, tw.length)) * 60 : 0;
}

function normalizeSectionIds(content, topics) {
  if (!topics || !topics.length) return content;

  // Extract section headings to match by content similarity
  const headingRe = /<section[^>]*class="[^"]*section[^"]*"[^>]*>[\s\S]*?<h2[^>]*>(.*?)<\/h2>/gi;
  const sectionHeadings = [];
  let m;
  const tempContent = content;
  while ((m = headingRe.exec(tempContent)) !== null) {
    sectionHeadings.push(m[1].replace(/<[^>]+>/g,'').replace(/[0-9]+/,'').trim());
  }

  // Build best topic→section mapping using similarity scores
  const usedTopics = new Set();
  const sectionTopicMap = sectionHeadings.map((heading, i) => {
    let best = null, bestScore = -1;
    topics.forEach((topic, ti) => {
      if (usedTopics.has(ti)) return;
      const score = topicMatchScore(heading, topic);
      if (score > bestScore) { bestScore = score; best = ti; }
    });
    if (best !== null && bestScore > 0) {
      usedTopics.add(best);
      return { topicIdx: best, slug: slugify(topics[best]) };
    }
    // Fallback: use position
    const fallbackIdx = i < topics.length ? i : topics.length - 1;
    return { topicIdx: fallbackIdx, slug: slugify(topics[fallbackIdx]) };
  });

  let result = content;
  let secIdx = 0;
  result = result.replace(/<section([^>]*class="[^"]*section[^"]*"[^>]*)>/gi, (match, attrs) => {
    const info = sectionTopicMap[secIdx++];
    if (!info) return match;
    const { slug } = info;
    let newAttrs = attrs
      .replace(/\bid="[^"]*"/g, 'id="' + slug + '"')
      .replace(/\bdata-section="[^"]*"/g, 'data-section="' + slug + '"');
    if (!newAttrs.includes('id=')) newAttrs += ' id="' + slug + '"';
    if (!newAttrs.includes('data-section=')) newAttrs += ' data-section="' + slug + '"';
    return '<section' + newAttrs + '>';
  });

  return result;
}

// Extract topic names from generated section headings
// Strips the section-num div and captures the actual title text
function extractTopicsFromContent(content) {
  const topics = [];
  // Match h2.section-title, strip all inner tags, then get text after section-num
  const re = new RegExp('<h2[^>]*class="[^"]*section-title[^"]*"[^>]*>([\\s\\S]*?)<\\/h2>', 'gi');
  let m;
  while((m = re.exec(content)) !== null) {
    // Strip all HTML tags to get raw text
    const raw = m[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    // Remove leading numbers (section-num text like "1", "2" etc.)
    const t   = raw.replace(/^\d+\s*/, '').trim();
    if (t && t.length > 1) topics.push(t);
  }
  return topics.length ? topics : null;
}

/* ── CONTENT VALIDATION ──────────────────────────────────── */
function validateLessonContent(content, topics) {
  if (!content || content.length < 400)           return { ok: false, reason: 'Output too short (< 400 chars)' };
  if (!content.includes('<section'))              return { ok: false, reason: 'No <section> elements found' };
  if (!content.includes('data-section'))          return { ok: false, reason: 'Missing data-section attributes' };
  if (!content.includes('class="section-title"'))return { ok: false, reason: 'Missing section titles' };
  const sectionCount = (content.match(/<section/g) || []).length;
  if (sectionCount < 2)                           return { ok: false, reason: `Only ${sectionCount} section(s) — need at least 2` };
  return { ok: true };
}

/* ── SMART RETRY DELAY ───────────────────────────────────── */
const RETRYABLE_ERRORS = [
  /rate.?limit/i,
  /too many requests/i,
  /tpm|tokens per minute/i,
  /too large|request size/i,
  /high spikes/i,
  /overloaded/i,
  /service unavailable/i,
  /timeout/i,
  /quota.{0,40}exceed/i,
  /quota.{0,40}free.tier/i,
  /please retry/i,
  /503|529/,
];

function isRetryableError(msg) {
  return RETRYABLE_ERRORS.some(p => p.test(msg));
}

// Parse "retry in Xs" hint from provider error (Gemini does this)
function parseRetryAfter(msg) {
  const m = msg.match(/retry in ([0-9.]+)s/i);
  if (m) return Math.ceil(parseFloat(m[1])) + 2; // add 2s buffer
  return null;
}

async function callWithRetry(systemPrompt, userMsg, lessonLabel) {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callApi(systemPrompt, userMsg);
    } catch (err) {
      const msg = err.message || '';
      if (attempt < MAX_RETRIES && isRetryableError(msg)) {
        // Use provider-suggested wait time if available, else exponential backoff
        const suggested = parseRetryAfter(msg);
        const waitSecs  = suggested || (attempt === 0 ? 15 : attempt === 1 ? 30 : 60);
        AgentEvents.emit('step', {
          status: 'warn',
          msg: `⏳ ${lessonLabel}: rate limited — waiting ${waitSecs}s then retrying… (attempt ${attempt+1}/${MAX_RETRIES})`,
          isRetry: true,
          waitSecs,
        });
        await new Promise(r => setTimeout(r, waitSecs * 1000));
        AgentEvents.emit('step', { status: 'running', msg: `🔄 Retrying ${lessonLabel}…` });
      } else {
        throw err;
      }
    }
  }
}

/* ── WRITER AGENT ────────────────────────────────────────── */
/* ── AGENT 1: PLANNER ────────────────────────────────────── */
async function runPlannerAgent(prompt, settings) {
  AgentEvents.emit('step', { status: 'running', msg: '🗂 Planning course structure…' });
  const c = settings.customization || {};
  const appLine  = settings.targetApp ? `\nTarget application: ${settings.targetApp}` : '';
  const ckLines  = [
    c.newbie       ? 'Student has ZERO prior knowledge — build from absolute basics, define every term.' : '',
    c.teen         ? 'Write for a 13-year-old: short sentences, fun relatable examples, zero jargon.' : '',
    c.projectFocus ? 'Every lesson should build toward a real tangible project outcome.' : '',
  ].filter(Boolean).join('\n');
  const userMsg = `Request: ${prompt}\nLevel: ${settings.levelFrom} to ${settings.levelTo}\nStyle: ${settings.style}${appLine}${ckLines ? '\n' + ckLines : ''}`;
  const raw     = await callWithRetry(PLANNER_PROMPT, userMsg, 'planner');
  const cleaned = raw.replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
  let plan;
  try { plan = JSON.parse(cleaned); }
  catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Planner returned invalid JSON — try again.');
    plan = JSON.parse(m[0]);
  }
  if (!Array.isArray(plan.lessons) || !plan.lessons.length) throw new Error('Planner returned empty lesson list.');
  AgentEvents.emit('step', { status: 'done', msg: `✅ Course planned: ${plan.lessons.length} lessons` });
  return plan;
}

/* ── AGENT 2: RESEARCHER ─────────────────────────────────── */
async function runResearchAgent(plan, lesson, settings) {
  if (isKnownTopic(plan.courseTitle, lesson.title)) {
    AgentEvents.emit('step', { status: 'done', msg: `⚡ Research skipped (well-known): ${lesson.title}` });
    return `Topics: ${lesson.topics.join(', ')}`;
  }
  AgentEvents.emit('step', { status: 'running', msg: `🔍 Researching: ${lesson.title}…` });
  const docsRef = lesson.docsHints?.length ? `\nReference: ${lesson.docsHints.join(', ')}` : '';
  const userMsg = `Course: ${plan.courseTitle}\nLesson: ${lesson.title}\nTopics: ${lesson.topics.join(', ')}\nLevel: ${settings.levelFrom}→${settings.levelTo}${docsRef}`;
  const notes   = await callWithRetry(RESEARCH_PROMPT, userMsg, `research ${lesson.title}`);
  AgentEvents.emit('step', { status: 'done', msg: `✅ Research done: ${lesson.title}` });
  return notes;
}

async function runWriterAgent(plan, lesson, research, settings, lessonNum, total, prevLessonSummary) {
  const label = `lesson ${lessonNum}/${total}`;
  AgentEvents.emit('step', { status: 'running', msg: `✍️ Writing ${label}: ${lesson.title}…` });

  const styleMap = {
    concise:     'Concise: dense info, max 1 exercise, prefer tables/pills over long prose.',
    explanatory: 'Explanatory: rich descriptions, multiple analogies, real-world examples for every concept. Show the WHY before the HOW. 2-3 exercises mixing MCQ and fill-in. Expand each topic fully — do not summarize.',
    interactive: 'Interactive: exercises after every major concept. 3-5 exercises total.',
    formal:      'Formal: academic tone, precise terminology. 1-2 MCQ exercises only.',
  };

  const contextLine = prevLessonSummary
    ? `COURSE HISTORY (already covered — do NOT repeat these, build on them):\n${prevLessonSummary}`
    : `FIRST LESSON — start from the very basics for this level.`;

  const ck  = settings.customization || {};
  const dna = settings._dna || {};
  const targetAppLine = settings.targetApp ? `TARGET APPLICATION: ${settings.targetApp}` : null;

  // Build customization instructions — each adds focused behavior without conflicting
  const ckInstructions = [
    ck.newbie        ? 'NEWBIE MODE: Assume zero prior knowledge. Define every term on first use. Never assume familiarity.' : null,
    ck.teen          ? 'TONE: Write like explaining to a curious 13-year-old. Short sentences. Fun analogies. Zero jargon. If jargon needed, explain it immediately.' : null,
    ck.codeHeavy     ? 'CODE DENSITY: Maximize code examples. Every concept gets at least one code block. Minimize prose between code.' : null,
    ck.projectFocus  ? 'PROJECT FOCUS: Frame every section around building something real. End each section with what was just built.' : null,
    ck.objectives    ? `LEARNING OBJECTIVES: Start the lesson with a section titled "What You'll Learn" listing 3-5 specific skills the student will have after this lesson.` : null,
    ck.misconceptions? 'MISCONCEPTIONS: Include at least one <div class="callout danger"> per lesson exposing a common misconception: "Many people think X — but actually Y."' : null,
    ck.diffRamp      ? 'DIFFICULTY RAMP: First code example per section: 3-5 lines, heavily commented. Second example: more realistic/complete. Never start complex.' : null,
    ck.analogies     ? 'ANALOGIES: Before every new concept, give one real-world analogy in plain English. Then show the code.' : null,
  ].filter(Boolean);

  const userMsg = [
    `COURSE: ${plan.courseTitle}`,
    `LESSON ${lessonNum}/${total}: ${lesson.title}`,
    `LESSON_NUM: ${lessonNum}`,
    `TOPICS: ${lesson.topics.join(', ')}`,
    `LEVEL: ${settings.levelFrom} → ${settings.levelTo}`,
    `STYLE: ${styleMap[settings.style] || styleMap.concise}`,
    ...(targetAppLine ? [targetAppLine] : []),
    ...(ckInstructions.length ? ['\nCUSTOMIZATION:\n' + ckInstructions.join('\n')] : []),
    `COURSE DNA: tone=${dna.tone||'professional'} pacing=${dna.pacing||'moderate'} code=${dna.codeDensity||'medium'} depth=${dna.explanationDepth||'balanced'}`,
    contextLine,
    ``,
    `RESEARCH NOTES (expand into rich lesson content):`,
    (research || '').slice(0, 600),
  ].join('\n');

  // Retry loop for content validation
  const CONTENT_RETRIES = 2;
  for (let attempt = 0; attempt <= CONTENT_RETRIES; attempt++) {
    let raw;
    try {
      raw = await callWithRetry(WRITER_SYSTEM_PROMPT, userMsg, `lesson ${lessonNum}`);
    } catch (err) {
      throw err; // non-retryable or max retries exceeded
    }

    // Clean output
    const raw2 = raw
      .replace(/^```html\s*/i,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim()
      .replace(/<code([^>]*)>([\s\S]*?)<\/code>/g, (_,a,c) =>
        `<code${a}>${c.replace(/\\n/g,'\n').replace(/\\t/g,'  ')}</code>`);
    const content = normalizeSectionIds(raw2, lesson.topics);

    const valid = validateLessonContent(content);
    if (valid.ok) {
      // Extract topics from generated section headings for nav
      const extractedTopics = extractTopicsFromContent(content);
      if (extractedTopics && lesson.topics && extractedTopics.length > 0) {
        lesson.topics = extractedTopics;
      }
      AgentEvents.emit('step', { status: 'done', msg: `✅ Lesson ${lessonNum} content ready` });
      return content;
    }

    if (attempt < CONTENT_RETRIES) {
      AgentEvents.emit('step', {
        status: 'warn',
        msg: `⚠️ Lesson ${lessonNum} validation failed (${valid.reason}) — retrying…`,
        isRetry: true,
      });
      await new Promise(r => setTimeout(r, 1500));
    } else {
      // Accept partial output on final attempt rather than failing
      AgentEvents.emit('step', {
        status: 'warn',
        msg: `⚠️ Lesson ${lessonNum} accepted with warnings: ${valid.reason}`,
      });
      return content;
    }
  }
}


/* ── MAIN PIPELINE ───────────────────────────────────────── */
/**
 * buildCourse(prompt, settings, onLessonReady)
 *   onLessonReady({ id, title, html, lessonNum, total, filename }) called per lesson
 *   Returns: { courseTitle, description, indexHtml, lessons }
 */
// Languages/frameworks well-known to all major models — skip research to save tokens
const KNOWN_TOPICS = new Set([
  'python','javascript','typescript','java','c++','cpp','c#','csharp','c language',
  'rust','go','swift','kotlin','ruby','php','scala','r language','matlab',
  'html','css','react','vue','angular','node','nodejs','express','django','flask',
  'spring','laravel','rails','next.js','nextjs','nuxt','svelte',
  'sql','mysql','postgresql','sqlite','mongodb','redis',
  'git','docker','linux','bash','shell','algorithms','data structures',
  'machine learning','deep learning','numpy','pandas','tensorflow','pytorch',
]);

function isKnownTopic(courseTitle, lessonTitle) {
  const text = (courseTitle + ' ' + lessonTitle).toLowerCase();
  for (const kw of KNOWN_TOPICS) {
    if (text.includes(kw)) return true;
  }
  return false;
}

async function buildCourse(prompt, settings, onLessonReady) {
  resetStop();

  if (!hasApiKey()) {
    openApiModal();
    throw new Error('NO_KEY');
  }

  const plan  = await runPlannerAgent(prompt, settings);
  const total = plan.lessons.length;

  AgentEvents.emit('plan-ready', { plan, total });

  // Extract Lesson DNA — passed to every lesson for cross-lesson consistency
  const courseDNA = {
    tone:           settings.customization?.teen    ? 'casual-teen' :
                    settings.customization?.newbie  ? 'patient-simple' : 'professional',
    pacing:         settings.levelFrom === 'beginner' ? 'slow-thorough' : 'moderate',
    codeDensity:    settings.customization?.codeHeavy ? 'very-high' :
                    settings.style === 'interactive'   ? 'high' :
                    settings.style === 'formal'        ? 'low' : 'medium',
    analogyStyle:   settings.customization?.analogies !== false ? 'real-world' : 'minimal',
    explanationDepth: settings.style === 'explanatory' ? 'deep' :
                      settings.style === 'concise'     ? 'surface' : 'balanced',
  };

  await new Promise(r => setTimeout(r, 50));
  const safeFolderName = settings._safeFolderName || null;
  const lang = typeof detectLang === 'function'
    ? detectLang(plan.courseTitle + ' ' + plan.lessons.map(l => l.topics.join(' ')).join(' '))
    : 'javascript';

  const results      = [];
  let   prevSummary  = null; // context memory: topics covered so far

  for (let i = 0; i < total; i++) {
    if (isStopped()) {
      AgentEvents.emit('step', { status: 'warn', msg: `⏹ Stopped after ${i} lessons` });
      break;
    }

    const lesson    = plan.lessons[i];
    const lessonNum = i + 1;

    // Research — skip for well-known languages/frameworks to save tokens (~500 per lesson)
    let research = '';
    if (isKnownTopic(plan.courseTitle, lesson.title)) {
      research = `Topics: ${lesson.topics.join(', ')}`;
      AgentEvents.emit('step', { status: 'done', msg: `⚡ Research skipped (well-known topic): ${lesson.title}` });
    } else {
      try {
        research = await callWithRetry(RESEARCH_PROMPT,
          `Course: ${plan.courseTitle}\nLesson: ${lesson.title}\nTopics: ${lesson.topics.join(', ')}\nLevel: ${settings.levelFrom}→${settings.levelTo}`,
          `research ${lessonNum}`
        );
        AgentEvents.emit('step', { status: 'done', msg: `✅ Research done: ${lesson.title}` });
      } catch (err) {
        research = `Topics: ${lesson.topics.join(', ')}`;
        AgentEvents.emit('step', { status: 'warn', msg: `⚠️ Research skipped: ${err.message}` });
      }
    }

    if (isStopped()) {
      AgentEvents.emit('step', { status: 'warn', msg: `⏹ Stopped before writing lesson ${lessonNum}` });
      break;
    }

    // Write content fragments
    const prevLesson = plan.lessons[lessonNum - 2];
    const nextLesson = plan.lessons[lessonNum];
    const content = await runWriterAgent(plan, lesson, research,
      { ...settings, _dna: courseDNA }, lessonNum, total, prevSummary);

    // Assemble full HTML via renderer — guaranteed correct structure
    const meta = {
      courseTitle: plan.courseTitle,
      lessonTitle: lesson.title,
      lessonNum,
      total,
      levelFrom:  settings.levelFrom,
      levelTo:    settings.levelTo,
      style:      settings.style,
      topics:     lesson.topics,
      prevFile:   prevLesson ? `lesson-${lessonNum-1}.html` : 'index.html',
      prevTitle:  prevLesson ? prevLesson.title : 'Course Index',
      nextFile:   nextLesson ? `lesson-${lessonNum+1}.html` : '#',
      nextTitle:  nextLesson ? nextLesson.title : 'Course Complete',
      // All lessons for full sidebar shell (fallback when nav.html unavailable)
      allLessons: plan.lessons.map((l,i) => ({
        num:    i+1,
        title:  l.title,
        topics: l.topics || [],
        file:   `lesson-${i+1}.html`,
      })),
    };
    const html     = renderLesson(content, meta, lang);
    const filename = `lesson-${lessonNum}.html`;
    const title    = `${plan.courseTitle} — ${lesson.title}`;

    // Update context memory for next lesson
    prevSummary = lesson.topics.join(', ');

    const lessonResult = { id: lesson.id, title, html, lessonNum, total, filename, topics: lesson.topics || [] };
    results.push(lessonResult);

    if (typeof onLessonReady === 'function') {
      onLessonReady(lessonResult, i, total);
    }

    if (i < total - 1 && !isStopped()) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const allTitles  = results.map(r => r.title);
  const allTopics  = results.map((r,i) => plan.lessons[i]?.topics || []);
  const indexHtml  = renderIndex(plan, allTitles);
  const navHtml    = renderNav(plan, allTitles, allTopics);

  AgentEvents.emit('done', { plan, results });
  return { courseTitle: plan.courseTitle, description: plan.description, indexHtml, navHtml, lessons: results };
}

/* ── HELPERS ─────────────────────────────────────────────── */
function escHtmlIdx(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── SHARED NAV ──────────────────────────────────────────── */
const NAV_LOADER_SCRIPT = `
<script>
(function(){
  fetch('nav.html').then(function(r){return r.text();}).then(function(html){
    var tmp=document.createElement('div');tmp.innerHTML=html;
    var shared=tmp.querySelector('#sharedSidebar');
    var local=document.querySelector('aside.sidebar');
    if(shared&&local){
      var cur=location.pathname.split('/').pop();
      shared.querySelectorAll('a[href]').forEach(function(a){
        if(a.getAttribute('href')===cur)a.classList.add('active-sub');
      });
      local.replaceWith(shared);
      var btn=document.querySelector('.sidebar-toggle');
      if(btn)btn.addEventListener('click',function(){shared.classList.toggle('open');});
      var active=shared.querySelector('.active-sub');
      var first=(active?active.closest('.nav-subtopics'):null)||shared.querySelector('.nav-subtopics');
      if(first){first.classList.add('open');first.previousElementSibling&&first.previousElementSibling.classList.add('open','active');}
    }
  }).catch(function(){});
})();
<\/script>`;

function injectNavLoader(html) {
  return html.replace(/<\/body>/i, NAV_LOADER_SCRIPT + '</body>');
}

function generateNavHTML(plan, lessonTitles) {
  const items = lessonTitles.map((title, i) => {
    const short = title.split('—')[1]?.trim() || title;
    return `<div class="nav-section">
      <div class="nav-topic"><div class="topic-icon">${i+1}</div>${escHtmlIdx(short)}<span class="chevron">›</span></div>
      <ul class="nav-subtopics"><li><a href="lesson-${i+1}.html">${escHtmlIdx(short)}</a></li></ul>
    </div>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="lesson.css"></head><body>
<aside class="sidebar" id="sharedSidebar">
  <div class="sidebar-header"><div class="sidebar-logo"><div class="logo-icon">📚</div><div class="logo-text">${escHtmlIdx(plan.courseTitle)}<span class="logo-sub">${lessonTitles.length} lessons</span></div></div></div>
  <div class="sidebar-progress"><div class="progress-label"><span>Progress</span><span id="navPct">0%</span></div><div class="progress-bar"><div class="progress-bar-fill" id="navBar"></div></div></div>
  <nav class="sidebar-nav">${items}</nav>
</aside>
</body></html>`;
}

function generateIndexHTML(plan, lessonTitles) {
  const rows = lessonTitles.map((title, i) => {
    const s = title.split('—')[1]?.trim() || title;
    return `<a href="lesson-${i+1}.html" class="idx-card">
      <div class="idx-num">${i+1}</div>
      <div class="idx-info"><div class="idx-title">${escHtmlIdx(s)}</div><div class="idx-sub">Lesson ${i+1} of ${lessonTitles.length}</div></div>
      <span class="idx-arrow">→</span></a>`;
  }).join('');
  const t = plan.courseTitle;
  const words = t.split(' ');
  const main = words.slice(0,-1).join(' ') || t;
  const last = words.length > 1 ? words.at(-1) : '';
  return `<!DOCTYPE html><html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${escHtmlIdx(t)}</title>
  <link rel="stylesheet" href="lesson.css">
</head><body>
<button class="sidebar-toggle">☰</button>
<aside class="sidebar">
  <div class="sidebar-header"><div class="sidebar-logo"><div class="logo-icon">📚</div><div class="logo-text">${escHtmlIdx(t)}<span class="logo-sub">Course Index</span></div></div></div>
  <nav class="sidebar-nav"><div class="nav-section">
    <div class="nav-topic"><div class="topic-icon">📋</div>Lessons<span class="chevron">›</span></div>
    <ul class="nav-subtopics">${lessonTitles.map((tt,i)=>`<li><a href="lesson-${i+1}.html">${escHtmlIdx(tt.split('—')[1]?.trim()||tt)}</a></li>`).join('')}</ul>
  </div></nav>
</aside>
<main class="main-content">
  <header class="page-header">
    <span class="page-badge beginner">📚 Course</span>
    <h1 class="page-title">${escHtmlIdx(main)} <span>${escHtmlIdx(last)}</span></h1>
    <p class="page-subtitle">${escHtmlIdx(plan.description||'')}</p>
    <div class="page-meta"><span class="meta-item"><span>📖</span> ${lessonTitles.length} lessons</span></div>
  </header>
  <section class="section" id="lessons" data-section="lessons">
    <h2 class="section-title"><div class="section-num">📋</div>Course Lessons</h2>
    <div class="idx-grid">${rows}</div>
  </section>
  <div style="margin-top:40px">
    <a href="lesson-1.html" class="lesson-nav-btn next" style="display:inline-flex;text-decoration:none">
      <div class="nav-direction">Start Course →</div>
      <div class="nav-btn-title">${escHtmlIdx(lessonTitles[0]?.split('—')[1]?.trim()||'Lesson 1')}</div>
    </a>
  </div>
</main>
<script src="lesson.js"></script>
${NAV_LOADER_SCRIPT}
</body></html>`;
}
