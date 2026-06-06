/* ============================================================
   LESSON.JS — Interactive behaviors for lesson pages
   ============================================================
   Handles: sidebar accordion, active links, copy buttons,
            MCQ checking, fill-in-blank, true/false, scoring,
            progress bar, mobile sidebar toggle
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── SIDEBAR ACCORDION ─────────────────────────────────────
     Accordion is wired by NAV_LOADER_INLINE (renderer.js).
     lesson.js skips wiring here to avoid double-binding after
     nav.html replaces the sidebar shell.
  ─────────────────────────────────────────────────────────── */

  /* ── ACTIVE SUBTOPIC ON SCROLL ──────────────────────────── */
  const sections = document.querySelectorAll('[data-section]');
  const navLinks = document.querySelectorAll('.nav-subtopics li a');

  // Track visible sections — debounced via requestAnimationFrame to batch entries
  const visibleSections = new Set();
  let _rafPending = false;

  function updateActiveLink() {
    _rafPending = false;
    let activeId = null;
    // Pick topmost visible section in DOM order
    sections.forEach(sec => {
      const id = sec.getAttribute('data-section');
      if (visibleSections.has(id) && !activeId) activeId = id;
    });
    if (!activeId) return;
    // Re-query every time in case nav.html replaced the sidebar
    const currentLinks = document.querySelectorAll('.nav-subtopics li a');
    currentLinks.forEach(link => {
      const href  = link.getAttribute('href') || '';
      // Match #slug or lesson-N.html#slug
      const isActive = href === '#' + activeId || href.endsWith('#' + activeId);
      link.classList.toggle('active-sub', isActive);
    });
  }

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const id = entry.target.getAttribute('data-section');
      if (entry.isIntersecting) visibleSections.add(id);
      else visibleSections.delete(id);
    });
    // Batch all entry updates into one RAF frame
    if (!_rafPending) {
      _rafPending = true;
      requestAnimationFrame(updateActiveLink);
    }
  }, { rootMargin: '-10% 0px -60% 0px', threshold: 0 });

  sections.forEach(el => observer.observe(el));

  /* ── AUTO-OPEN ACTIVE TOPIC IN SIDEBAR ──────────────────── */
  const activeLink = document.querySelector('.nav-subtopics li a.active-sub');
  if (activeLink) {
    const parentList = activeLink.closest('.nav-subtopics');
    if (parentList) {
      parentList.classList.add('open');
      parentList.previousElementSibling?.classList.add('open', 'active');
    }
  } else {
    // Open first topic by default
    const first = document.querySelector('.nav-subtopics');
    if (first) {
      first.classList.add('open');
      first.previousElementSibling?.classList.add('open', 'active');
    }
  }

  /* ── MOBILE SIDEBAR TOGGLE ──────────────────────────────── */
  const toggleBtn = document.querySelector('.sidebar-toggle');
  const sidebar   = document.querySelector('.sidebar');

  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      toggleBtn.textContent = sidebar.classList.contains('open') ? '✕' : '☰';
    });

    // Close sidebar when clicking outside
    document.addEventListener('click', e => {
      if (sidebar.classList.contains('open') &&
          !sidebar.contains(e.target) &&
          !toggleBtn.contains(e.target)) {
        sidebar.classList.remove('open');
        toggleBtn.textContent = '☰';
      }
    });

    // Close sidebar when clicking a link (mobile)
    sidebar.querySelectorAll('.nav-subtopics li a').forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth < 768) {
          sidebar.classList.remove('open');
          toggleBtn.textContent = '☰';
        }
      });
    });
  }

  /* ── COPY CODE BUTTONS ──────────────────────────────────── */
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const block = btn.closest('.code-block');
      const code  = block?.querySelector('code')?.innerText || '';
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = '✓ Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      });
    });
  });

  /* ── EXERCISE ENGINE ────────────────────────────────────── */

  /**
   * Score tracker per exercise section
   * Each .exercise-section gets its own state
   */
  document.querySelectorAll('.exercise-section').forEach(section => {
    let checked = false;

    const checkBtn  = section.querySelector('.btn-check');
    const resetBtn  = section.querySelector('.btn-reset');
    const resultEl  = section.querySelector('.exercise-result');
    const scoreEl   = section.querySelector('.exercise-score');

    if (!checkBtn) return;

    /* ── MCQ ── */
    section.querySelectorAll('.mcq-card').forEach(card => {
      const options  = card.querySelectorAll('.mcq-option');
      const correct  = card.getAttribute('data-answer'); // e.g. "b"

      options.forEach(opt => {
        opt.addEventListener('click', () => {
          if (checked || opt.classList.contains('disabled')) return;
          options.forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
          card.removeAttribute('data-unanswered');
        });
      });

      // Store answer key
      card._correctKey = correct;
      card._type = 'mcq';
    });

    /* ── FILL IN BLANK ── */
    section.querySelectorAll('.fill-card').forEach(card => {
      card._type = 'fill';
    });

    /* ── TRUE / FALSE ── */
    section.querySelectorAll('.tf-card').forEach(card => {
      const buttons = card.querySelectorAll('.tf-btn');
      const correct = card.getAttribute('data-answer'); // "true" or "false"

      buttons.forEach(btn => {
        btn.addEventListener('click', () => {
          if (checked) return;
          buttons.forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          card.removeAttribute('data-unanswered');
        });
      });

      card._correctKey = correct;
      card._type = 'tf';
    });

    /* ── CHECK ANSWERS ── */
    checkBtn.addEventListener('click', () => {
      if (checked) return;
      checked = true;

      let total = 0, correct = 0;

      // MCQ
      section.querySelectorAll('.mcq-card').forEach(card => {
        total++;
        const selected  = card.querySelector('.mcq-option.selected');
        const answer    = card._correctKey;
        const feedback  = card.querySelector('.mcq-feedback');
        const allOpts   = card.querySelectorAll('.mcq-option');

        allOpts.forEach(o => o.classList.add('disabled'));

        // Show correct option regardless
        allOpts.forEach(o => {
          if (o.getAttribute('data-value') === answer) {
            o.classList.add('show-correct');
            const icon = o.querySelector('.opt-icon');
            if (icon) icon.textContent = '✓';
          }
        });

        if (selected) {
          const val = selected.getAttribute('data-value');
          if (val === answer) {
            correct++;
            selected.classList.add('correct');
            if (feedback) { feedback.classList.add('correct'); feedback.querySelector('.fb-text').textContent += ' ✓ Correct!'; }
            card.classList.add('correct');
          } else {
            selected.classList.add('wrong');
            const icon = selected.querySelector('.opt-icon');
            if (icon) icon.textContent = '✗';
            if (feedback) feedback.classList.add('wrong');
            card.classList.add('wrong');
          }
        }
      });

      // Fill in blank
      section.querySelectorAll('.fill-card').forEach(card => {
        const input   = card.querySelector('.fill-input');
        const answer  = card.getAttribute('data-answer');
        if (!input || !answer) return;
        total++;

        const rawUser = input.value.trim();
        const userAnswer = rawUser.toLowerCase().replace(/\s+/g,'');
        const answers = answer.split('|').map(a => a.trim().toLowerCase().replace(/\s+/g,''));

        input.disabled = true;

        // Flexible matching: exact, or strip trailing () for method name check
        const normalizeCode = v => v.replace(/\(.*?\)/g,'()').replace(/\s+/g,'');
        const userNorm = normalizeCode(userAnswer);
        const matched  = answers.some(a =>
          a === userAnswer ||
          normalizeCode(a) === userNorm ||
          a.replace(/[()]/g,'') === userAnswer.replace(/[()]/g,'')
        );

        if (matched) {
          correct++;
          input.classList.add('correct');
          card.classList.add('correct');
        } else {
          input.classList.add('wrong');
          card.classList.add('wrong');
          const hint = card.querySelector('.fill-hint');
          if (hint) hint.textContent = `Answer: ${answer.split('|')[0]}`;
        }
      });

      // True / False
      section.querySelectorAll('.tf-card').forEach(card => {
        total++;
        const selected = card.querySelector('.tf-btn.selected');
        const answer   = card._correctKey;
        const buttons  = card.querySelectorAll('.tf-btn');

        buttons.forEach(b => b.classList.add('disabled'));

        if (selected) {
          const val = selected.classList.contains('true-btn') ? 'true' : 'false';
          if (val === answer) {
            correct++;
            card.classList.add('correct');
          } else {
            card.classList.add('wrong');
          }
        }
      });

      // Score
      const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

      if (scoreEl) {
        scoreEl.innerHTML = `${correct}/${total}<span>Score</span>`;
        if (pct === 100) scoreEl.style.color = '#10b981';
        else if (pct >= 60) scoreEl.style.color = '#f59e0b';
        else scoreEl.style.color = '#ef4444';
      }

      if (resultEl) {
        resultEl.classList.add('show');
        if (pct === 100) {
          resultEl.classList.add('perfect');
          resultEl.innerHTML = '🎉 Perfect score! Excellent work!';
        } else if (pct >= 60) {
          resultEl.classList.add('good');
          resultEl.innerHTML = `✅ ${correct} of ${total} correct — Nice job! Review the wrong answers.`;
        } else {
          resultEl.classList.add('retry');
          resultEl.innerHTML = `📚 ${correct} of ${total} correct — Keep practicing!`;
        }
      }

      checkBtn.disabled = true;
      checkBtn.style.opacity = '.5';

      // Update progress bar
      updateProgress();
    });

    /* ── RESET ── */
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        checked = false;

        // MCQ
        section.querySelectorAll('.mcq-option').forEach(o => {
          o.classList.remove('selected','correct','wrong','show-correct','disabled');
          const icon = o.querySelector('.opt-icon');
          if (icon) icon.textContent = '';
        });
        section.querySelectorAll('.mcq-card').forEach(c => c.classList.remove('correct','wrong'));
        section.querySelectorAll('.mcq-feedback').forEach(f => f.className = 'mcq-feedback');

        // Fill
        section.querySelectorAll('.fill-input').forEach(i => {
          i.value = '';
          i.disabled = false;
          i.classList.remove('correct','wrong');
        });
        section.querySelectorAll('.fill-card').forEach(c => c.classList.remove('correct','wrong'));
        section.querySelectorAll('.fill-hint').forEach(h => {
          if (h.textContent.startsWith('Answer:')) h.textContent = '';
        });

        // True/False
        section.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('selected','disabled'));
        section.querySelectorAll('.tf-card').forEach(c => c.classList.remove('correct','wrong'));

        // Reset UI
        if (resultEl) resultEl.className = 'exercise-result';
        if (scoreEl)  scoreEl.innerHTML = '0/0<span>Score</span>';
        checkBtn.disabled = false;
        checkBtn.style.opacity = '1';
      });
    }
  });

  /* ── PROGRESS BAR ──────────────────────────────────────────
     Progress is saved to localStorage per lesson URL so it
     persists across visits. Key = pathname of the lesson page.
  ─────────────────────────────────────────────────────────── */
  const PROGRESS_KEY = 'lf_progress:' + location.pathname;

  function saveProgress(pct) {
    try { localStorage.setItem(PROGRESS_KEY, pct); } catch(e) {}
  }

  function loadProgress() {
    try { return parseInt(localStorage.getItem(PROGRESS_KEY)) || 0; } catch(e) { return 0; }
  }

  function updateProgress() {
    const allExercises = document.querySelectorAll('.exercise-section');
    const done  = document.querySelectorAll('.exercise-section .btn-check[disabled]').length;
    const total = allExercises.length;

    const pct = total > 0 ? Math.round((done / total) * 100) : loadProgress();
    const fill  = document.querySelector('.progress-bar-fill');
    const label = document.querySelector('.progress-label span:last-child');

    if (fill)  fill.style.width = pct + '%';
    if (label) label.textContent = pct + '%';

    if (total > 0) {
      const saved = loadProgress();
      if (pct >= saved) saveProgress(pct); // never downgrade saved progress
    }

    // Show completion banner when all exercises done
    if (total > 0 && done === total) {
      const banner = document.querySelector('.completion-banner');
      if (banner) banner.classList.add('visible');
    }
  }

  // Restore saved progress on load (show bar immediately before exercises are checked)
  (function restoreProgress() {
    const saved = loadProgress();
    if (saved > 0) {
      const fill  = document.querySelector('.progress-bar-fill');
      const label = document.querySelector('.progress-label span:last-child');
      if (fill)  fill.style.width = saved + '%';
      if (label) label.textContent = saved + '%';
      if (saved === 100) {
        const banner = document.querySelector('.completion-banner');
        if (banner) banner.classList.add('visible');
      }
    }
  })();

  updateProgress();

  /* ── SMOOTH SCROLL for nav links ─────────────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', e => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

});
