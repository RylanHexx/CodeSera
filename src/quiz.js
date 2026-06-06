/* ═══════════════════════════════════════════════════════
   CodeSera — quiz.js
   Quiz generation, lesson picker UI, quiz runner
═══════════════════════════════════════════════════════ */

'use strict';

const QUIZ_STORAGE_KEY = 'lf_quizzes'; // courseId → [{lessonNum, questions, scores}]

/* ── QUIZ SYSTEM PROMPT ─────────────────────────────── */
const QUIZ_SYSTEM_PROMPT =
`You are CodeSera Quiz Generator. Generate a quiz for a lesson.
Output ONLY valid JSON, no markdown, no explanation.

Schema:
{
  "title": "Quiz title",
  "questions": [
    {
      "type": "mcq",
      "question": "Question text",
      "options": ["A", "B", "C", "D"],
      "correct": 0,
      "explanation": "Why this is correct"
    },
    {
      "type": "fill",
      "question": "Question with ___ blank",
      "answer": "correct answer",
      "alternatives": ["alt1", "alt2"],
      "explanation": "Explanation"
    },
    {
      "type": "tf",
      "question": "Statement to evaluate",
      "correct": true,
      "explanation": "Explanation"
    }
  ]
}

Rules:
- 8-12 questions per quiz
- Mix all 3 types: roughly 50% MCQ, 25% fill, 25% T/F
- Questions must test real understanding, not trivia
- Explanations must be clear and educational
- Fill answers are lowercase, alternatives cover common correct spellings`;

/* ── STORAGE ─────────────────────────────────────────── */
function loadQuizzes() {
  try { return JSON.parse(localStorage.getItem(QUIZ_STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveQuizForLesson(courseId, lessonNum, questions) {
  const all = loadQuizzes();
  if (!all[courseId]) all[courseId] = {};
  all[courseId][lessonNum] = { questions, generatedAt: Date.now(), scores: [] };
  localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(all));
}

function getQuizForLesson(courseId, lessonNum) {
  return loadQuizzes()[courseId]?.[lessonNum] || null;
}

function saveQuizScore(courseId, lessonNum, score, total) {
  const all = loadQuizzes();
  if (!all[courseId]?.[lessonNum]) return;
  all[courseId][lessonNum].scores.push({ score, total, date: Date.now() });
  localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(all));
}

/* ── GENERATE QUIZ VIA API ───────────────────────────── */
async function generateQuizForLesson(course, lessonIdx) {
  const lesson = course.lessons[lessonIdx];
  if (!lesson) throw new Error('Lesson not found');

  const userMsg =
    `Course: ${course.title}\n` +
    `Lesson: ${lesson.title}\n` +
    `Level: ${course.settings.levelFrom} → ${course.settings.levelTo}`;

  const raw = await callApi(QUIZ_SYSTEM_PROMPT, userMsg);
  const cleaned = raw.replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();

  let quiz;
  try {
    quiz = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Quiz generation returned invalid JSON');
    quiz = JSON.parse(m[0]);
  }

  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    throw new Error('Quiz has no questions');
  }

  saveQuizForLesson(course.id, lessonIdx, quiz.questions);
  // Update course token count
  if (typeof getTotalTokens === 'function' && typeof courses !== 'undefined') {
    const c = courses.find(x => x.id === course.id);
    if (c) { c.tokensUsed = (c.tokensUsed||0) + getTotalTokens(); saveCourses(); }
  }
  return quiz;
}

/* ── QUIZ PICKER MODAL ───────────────────────────────── */
function openQuizPicker(courseId) {
  const course = (typeof courses !== 'undefined' ? courses : []).find(c => c.id === courseId);
  if (!course || !course.lessons.length) {
    showToast('No lessons in this course yet.');
    return;
  }

  const modal = document.getElementById('quizPickerModal');
  const list  = document.getElementById('quizLessonList');
  const title = document.getElementById('quizPickerTitle');

  title.textContent = course.title;

  const existingQuizzes = loadQuizzes()[courseId] || {};

  list.innerHTML = course.lessons.map((l, i) => {
    const shortTitle = l.title.split('—')[1]?.trim() || l.title;
    const hasQuiz    = !!existingQuizzes[i];
    const scores     = existingQuizzes[i]?.scores || [];
    const bestScore  = scores.length ? Math.max(...scores.map(s => Math.round(s.score/s.total*100))) : null;
    return `
      <div class="qpl-item" data-cid="${courseId}" data-lidx="${i}">
        <div class="qpl-num">${i+1}</div>
        <div class="qpl-info">
          <div class="qpl-title">${escHtml(shortTitle)}</div>
          ${hasQuiz
            ? `<div class="qpl-meta">Quiz ready${bestScore !== null ? ` · Best: ${bestScore}%` : ''}</div>`
            : `<div class="qpl-meta qpl-new">Tap to generate quiz</div>`}
        </div>
        <div class="qpl-arrow">${hasQuiz ? '▶' : '+'}</div>
      </div>`;
  }).join('');

  modal.classList.remove('hidden');
}

function closeQuizPicker() {
  document.getElementById('quizPickerModal')?.classList.add('hidden');
}

/* ── QUIZ RUNNER ─────────────────────────────────────── */
let _quizState = null;

async function startQuiz(courseId, lessonIdx) {
  const course = (typeof courses !== 'undefined' ? courses : []).find(c => c.id === courseId);
  if (!course) return;

  closeQuizPicker();

  // Check if quiz already exists
  let quizData = getQuizForLesson(courseId, lessonIdx);

  if (!quizData) {
    // Generate quiz
    showQuizLoading(true);
    try {
      const result = await generateQuizForLesson(course, lessonIdx);
      quizData = { questions: result.questions };
    } catch(e) {
      showQuizLoading(false);
      showToast('Quiz generation failed: ' + e.message);
      return;
    }
    showQuizLoading(false);
  }

  // Shuffle questions and run
  const questions = [...quizData.questions].sort(() => Math.random() - 0.5);
  const lesson    = course.lessons[lessonIdx];
  const shortTitle = lesson.title.split('—')[1]?.trim() || lesson.title;

  _quizState = {
    courseId,
    lessonIdx,
    questions,
    current:  0,
    answers:  [],
    startTime: Date.now(),
  };

  renderQuizRunner(shortTitle);
}

function showQuizLoading(show) {
  const modal = document.getElementById('quizRunnerModal');
  if (!modal) return;
  if (show) {
    modal.classList.remove('hidden');
    document.getElementById('quizRunnerBody').innerHTML = `
      <div class="quiz-loading">
        <div class="gen-spinner" style="width:28px;height:28px;border-width:3px;margin:0 auto 16px"></div>
        <div style="color:var(--txt2);font-size:14px">Generating quiz with AI…</div>
      </div>`;
  } else {
    modal.classList.add('hidden');
  }
}

function renderQuizRunner(lessonTitle) {
  const modal = document.getElementById('quizRunnerModal');
  const body  = document.getElementById('quizRunnerBody');
  const titleEl = document.getElementById('quizRunnerTitle');
  const progressEl = document.getElementById('quizProgress');
  const progressBar = document.getElementById('quizProgressBar');

  if (!_quizState) return;
  const { questions, current } = _quizState;
  const q = questions[current];
  const pct = Math.round((current / questions.length) * 100);

  titleEl.textContent  = lessonTitle || 'Quiz';
  progressEl.textContent = `${current + 1} / ${questions.length}`;
  progressBar.style.width = pct + '%';

  modal.classList.remove('hidden');

  if (q.type === 'mcq') {
    body.innerHTML = `
      <div class="quiz-q">${escHtml(q.question)}</div>
      <div class="quiz-options" id="quizOpts">
        ${q.options.map((opt, i) => `
          <div class="quiz-opt" data-idx="${i}">
            <span class="quiz-opt-letter">${'ABCD'[i]}</span>
            <span>${escHtml(opt)}</span>
          </div>`).join('')}
      </div>
      <div class="quiz-feedback hidden" id="quizFeedback"></div>
      <button class="btn btn-primary quiz-next hidden" id="quizNextBtn">Next →</button>`;

    document.getElementById('quizOpts').addEventListener('click', e => {
      const opt = e.target.closest('.quiz-opt');
      if (!opt || opt.classList.contains('answered')) return;
      const chosen = parseInt(opt.dataset.idx);
      const correct = q.correct;
      document.querySelectorAll('.quiz-opt').forEach(o => o.classList.add('answered'));
      opt.classList.add(chosen === correct ? 'correct' : 'wrong');
      document.querySelectorAll('.quiz-opt')[correct].classList.add('correct');
      _quizState.answers.push({ correct: chosen === correct });
      showQuizFeedback(q.explanation, chosen === correct);
    });

  } else if (q.type === 'fill') {
    body.innerHTML = `
      <div class="quiz-q">${escHtml(q.question)}</div>
      <input class="fill-input" id="quizFillInput" type="text" placeholder="Type your answer…" style="width:100%;margin-top:12px">
      <button class="btn btn-primary" id="quizSubmitFill" style="margin-top:10px">Submit</button>
      <div class="quiz-feedback hidden" id="quizFeedback"></div>
      <button class="btn btn-primary quiz-next hidden" id="quizNextBtn">Next →</button>`;

    document.getElementById('quizSubmitFill').addEventListener('click', () => {
      const input = document.getElementById('quizFillInput');
      const val   = input.value.trim().toLowerCase();
      const correct = val === q.answer.toLowerCase() ||
        (q.alternatives || []).some(a => a.toLowerCase() === val);
      input.disabled = true;
      document.getElementById('quizSubmitFill').disabled = true;
      input.classList.add(correct ? 'correct' : 'wrong');
      _quizState.answers.push({ correct });
      showQuizFeedback(q.explanation, correct);
    });

    document.getElementById('quizFillInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('quizSubmitFill')?.click();
    });

  } else { // T/F
    body.innerHTML = `
      <div class="quiz-q">${escHtml(q.question)}</div>
      <div class="tf-buttons" style="margin-top:16px">
        <button class="tf-btn true-btn" id="quizTrue">✅ True</button>
        <button class="tf-btn false-btn" id="quizFalse">❌ False</button>
      </div>
      <div class="quiz-feedback hidden" id="quizFeedback"></div>
      <button class="btn btn-primary quiz-next hidden" id="quizNextBtn">Next →</button>`;

    const check = (chosen) => {
      const correct = chosen === q.correct;
      document.getElementById('quizTrue').disabled = true;
      document.getElementById('quizFalse').disabled = true;
      _quizState.answers.push({ correct });
      showQuizFeedback(q.explanation, correct);
    };
    document.getElementById('quizTrue').addEventListener('click',  () => check(true));
    document.getElementById('quizFalse').addEventListener('click', () => check(false));
  }
}

function showQuizFeedback(explanation, correct) {
  const fb   = document.getElementById('quizFeedback');
  const next = document.getElementById('quizNextBtn');
  if (!fb) return;
  fb.className = `quiz-feedback ${correct ? 'correct' : 'wrong'}`;
  fb.innerHTML = `<span>${correct ? '✅' : '❌'}</span><span>${escHtml(explanation)}</span>`;
  if (next) next.classList.remove('hidden');

  next.onclick = () => {
    _quizState.current++;
    if (_quizState.current >= _quizState.questions.length) {
      showQuizResults();
    } else {
      const course  = courses.find(c => c.id === _quizState.courseId);
      const lesson  = course?.lessons[_quizState.lessonIdx];
      const title   = lesson?.title?.split('—')[1]?.trim() || 'Quiz';
      renderQuizRunner(title);
    }
  };
}

function showQuizResults() {
  const { questions, answers, courseId, lessonIdx } = _quizState;
  const score   = answers.filter(a => a.correct).length;
  const total   = questions.length;
  const pct     = Math.round((score / total) * 100);
  const elapsed = Math.round((Date.now() - _quizState.startTime) / 1000);
  const mins    = Math.floor(elapsed / 60);
  const secs    = elapsed % 60;

  saveQuizScore(courseId, lessonIdx, score, total);

  const grade  = pct >= 90 ? '🏆 Excellent!' : pct >= 70 ? '✅ Good job!' : pct >= 50 ? '📖 Keep studying' : '💪 Try again';
  const color  = pct >= 70 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)';

  document.getElementById('quizRunnerBody').innerHTML = `
    <div class="quiz-results">
      <div class="qr-score" style="color:${color}">${pct}%</div>
      <div class="qr-grade">${grade}</div>
      <div class="qr-stats">
        <span>✅ ${score}/${total} correct</span>
        <span>⏱ ${mins}m ${secs}s</span>
      </div>
      <div class="qr-actions">
        <button class="btn btn-primary" id="quizRetryBtn">↺ Try Again</button>
        <button class="btn btn-ghost" id="quizCloseBtn">Close</button>
      </div>
    </div>`;

  document.getElementById('quizProgressBar').style.width = '100%';
  document.getElementById('quizProgress').textContent = `${total}/${total}`;

  document.getElementById('quizRetryBtn').addEventListener('click', () => {
    startQuiz(courseId, lessonIdx);
  });
  document.getElementById('quizCloseBtn').addEventListener('click', closeQuizRunner);
}

function closeQuizRunner() {
  document.getElementById('quizRunnerModal')?.classList.add('hidden');
  _quizState = null;
}

/* ── INIT QUIZ EVENTS ────────────────────────────────── */
function initQuizEvents() {
  // Lesson list click in picker
  document.getElementById('quizLessonList')?.addEventListener('click', e => {
    const item = e.target.closest('.qpl-item');
    if (!item) return;
    startQuiz(item.dataset.cid, parseInt(item.dataset.lidx));
  });

  document.getElementById('quizPickerClose')?.addEventListener('click', closeQuizPicker);
  document.getElementById('quizPickerModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('quizPickerModal')) closeQuizPicker();
  });

  document.getElementById('quizRunnerClose')?.addEventListener('click', closeQuizRunner);
  document.getElementById('quizRunnerModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('quizRunnerModal')) closeQuizRunner();
  });
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
