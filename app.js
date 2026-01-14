/* Quiz tipo test · SPA local (sin build)
   - Lee TXT (File API)
   - Modo Aleatorio (20) o Bloque completo
   - Penalización: fallo = -1/3 del acierto
   - Historial + revisión por pregunta (qué fallaste / acertaste)
   - Matemáticas: TeX suelto (\alpha_1, \frac{a}{b}, \Sigma, ...) con MathJax
   - Opciones reordenadas por pregunta, evitando repetir siempre la misma posición de la correcta
*/

(() => {
  'use strict';

  // =========================
  // Storage keys
  // =========================
  const KEY_RAW = 'quiz_raw_questions_txt_v1';
  const KEY_HISTORY = 'quiz_history_v4';
  const KEY_QSTATS = 'quiz_question_stats_v2';
  const KEY_PREFS = 'quiz_prefs_v2';
  const KEY_LASTPOS = 'quiz_last_correct_pos_v1'; // id -> pos(0..3) última vez que cayó la correcta
  const KEY_SOURCE = 'quiz_last_source_v1';
  const KEY_MARKED = 'quiz_marked_v1';
  const KEY_SRS = 'quiz_srs_v1'; // SRS data per question
  const KEY_ACTIVITY = 'quiz_activity_v1'; // Activity heatmap data

  const KEY_LIBSEL = 'quiz_library_last_v1';

  // =========================
  // Biblioteca (archivos predeterminados)
  // =========================
 
  const LIB_SOURCES = [
    { id: 'Redes', label: 'Redes', url: './baterias/Redes.txt' },
  ];

  const EXAM_SOURCE_ID = 'Redes';
  const EXAM_SOURCE_FILE = 'Redes.txt';
  const EXAM_QUESTIONS = 35;
  const EXAM_DURATION_MS = 70 * 60 * 1000;

  // =========================
  // Infinito
  // =========================
  const MAX_INFINITE_QUESTIONS = 2000; // límite de seguridad en una sesión infinita

  const PREV_REF_RE = /\bejercicio\s+anterior\b/i;



  // =========================
  // DOM utils
  // =========================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // =========================
  // Basic utils
  // =========================
  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
  const esc = (s) => escapeHtml(s);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const nowISO = () => new Date().toISOString();
  const fmtDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  };

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const sample = (arr, n) => shuffleArray(arr).slice(0, Math.min(n, arr.length));

  // =========================
  // MathJax helpers (TeX suelto)
  // =========================
  function wrapBareTeX(input) {
    const text = String(input ?? '');

    // Protege fórmulas ya delimitadas
    const protectedChunks = [];
    const protectedText = text.replace(
      /(\$\$[\s\S]*?\$\$|\$[^$]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g,
      (m) => {
        const key = `@@MATH${protectedChunks.length}@@`;
        protectedChunks.push(m);
        return key;
      }
    );

    // Envuelve tokens TeX que empiezan por \comando...
    const wrapped = protectedText.replace(
      /(\\[a-zA-Z]+(?:\*?)((?:\{[^}]*\})*)?(?:\s*[_^](?:\{[^}]*\}|[a-zA-Z0-9]+))*)/g,
      (m) => `\\(${m}\\)`
    );

    return wrapped.replace(/@@MATH(\d+)@@/g, (_, i) => protectedChunks[Number(i)]);
  }

  function setMathText(el, rawText) {
    if (!el) return;
    const safe = escapeHtml(wrapBareTeX(rawText)).replace(/\n/g, '<br>');
    el.innerHTML = safe;
  }

  function typesetMath(container) {
    try {
      if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
        return window.MathJax.typesetPromise(container ? [container] : undefined);
      }
    } catch (_) {}
    return Promise.resolve();
  }

  // =========================
  // localStorage helpers
  // =========================
  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  }
  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadHistory() { return loadJSON(KEY_HISTORY, []); }
  function saveHistory(hist) { saveJSON(KEY_HISTORY, hist); }

  function loadQStats() { return loadJSON(KEY_QSTATS, {}); }
  function saveQStats(stats) { saveJSON(KEY_QSTATS, stats); }

  function loadPrefs() { return loadJSON(KEY_PREFS, {}); }
  function savePrefs(prefs) { saveJSON(KEY_PREFS, prefs); }

  function loadLastPos() { return loadJSON(KEY_LASTPOS, {}); }
  function saveLastPos(map) { saveJSON(KEY_LASTPOS, map); }

  function loadMarked() { return loadJSON(KEY_MARKED, []); }
  function saveMarked(list) { saveJSON(KEY_MARKED, list); }

  // =========================
  // SRS (Spaced Repetition System) - SM-2 Algorithm
  // =========================
  function loadSRS() { return loadJSON(KEY_SRS, {}); }
  function saveSRS(data) { saveJSON(KEY_SRS, data); }

  function initSRSCard() {
    return {
      interval: 1,        // days until next review
      easeFactor: 2.5,    // ease factor
      repetitions: 0,     // consecutive correct answers
      nextReview: 0,      // timestamp when due
      lastSeen: 0         // timestamp when last answered
    };
  }

  function getSRSCard(questionId) {
    const srs = loadSRS();
    const id = String(questionId);
    if (!srs[id]) {
      srs[id] = initSRSCard();
      saveSRS(srs);
    }
    return srs[id];
  }

  // SM-2 update: quality 0-5 (0=complete fail, 3=correct with difficulty, 5=perfect)
  function updateSRSCard(questionId, quality) {
    const srs = loadSRS();
    const id = String(questionId);
    const card = srs[id] || initSRSCard();

    if (quality < 3) {
      // Failed: reset repetitions, short interval
      card.repetitions = 0;
      card.interval = 1;
    } else {
      // Passed
      if (card.repetitions === 0) {
        card.interval = 1;
      } else if (card.repetitions === 1) {
        card.interval = 6;
      } else {
        card.interval = Math.round(card.interval * card.easeFactor);
      }
      card.repetitions += 1;
    }

    // Update ease factor (never below 1.3)
    card.easeFactor = Math.max(1.3, card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    
    // Set next review date and record last seen
    card.nextReview = Date.now() + card.interval * 24 * 60 * 60 * 1000;
    card.lastSeen = Date.now();
    
    srs[id] = card;
    saveSRS(srs);
    
    console.log(`[SRS] Updated card ${id}: interval=${card.interval}d, EF=${card.easeFactor.toFixed(2)}, reps=${card.repetitions}`);
  }

  function getSRSQuality(result) {
    // Map quiz result to SM-2 quality
    if (result === 'correct') return 4;  // correct response
    if (result === 'wrong') return 1;    // incorrect
    return 2; // blank/skipped
  }

  // =========================
  // Seeded Random (for Seed Challenge)
  // =========================
  function hashSeed(str) {
    // Simple hash function to convert string to number
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function createSeededRandom(seed) {
    // Mulberry32 PRNG
    let state = hashSeed(String(seed));
    return function() {
      state |= 0;
      state = state + 0x6D2B79F5 | 0;
      let t = Math.imul(state ^ state >>> 15, 1 | state);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(arr, seed) {
    const rng = createSeededRandom(seed);
    const result = arr.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function generateSeedCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    code += '-';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  // =========================
  // Activity Heatmap
  // =========================
  function loadActivity() { return loadJSON(KEY_ACTIVITY, {}); }
  function saveActivity(data) { saveJSON(KEY_ACTIVITY, data); }

  function getDateKey(date = new Date()) {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  function recordActivity() {
    const activity = loadActivity();
    const today = getDateKey();
    activity[today] = (activity[today] || 0) + 1;
    saveActivity(activity);
  }

  function calculateStreak() {
    const activity = loadActivity();
    let streak = 0;
    const today = new Date();
    
    for (let i = 0; i < 365; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const key = getDateKey(date);
      if (activity[key]) {
        streak++;
      } else if (i > 0) {
        break; // Streak broken
      }
    }
    return streak;
  }

  function renderHeatmap() {
    if (!el.heatmapGrid) return;
    
    const activity = loadActivity();
    const currentYear = new Date().getFullYear();
    const cells = [];
    
    // Generate all days of current year (Jan 1 to Dec 31)
    const startDate = new Date(currentYear, 0, 1); // Jan 1
    const endDate = new Date(currentYear, 11, 31); // Dec 31
    
    for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
      const key = getDateKey(date);
      const count = activity[key] || 0;
      
      let level = 0;
      if (count >= 10) level = 4;
      else if (count >= 5) level = 3;
      else if (count >= 2) level = 2;
      else if (count >= 1) level = 1;
      
      const dateStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
      cells.push(`<div class="heatmap-cell level-${level}" title="${dateStr}: ${count} tests"></div>`);
    }
    
    el.heatmapGrid.innerHTML = cells.join('');
    
    // Render months (Jan to Dec)
    if (el.heatmapMonths) {
      const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      el.heatmapMonths.innerHTML = months.map(m => `<span>${m}</span>`).join('');
    }
    
    // Update streak badge
    if (el.streakBadge) {
      const streak = calculateStreak();
      el.streakBadge.textContent = `🔥 ${streak}`;
      el.streakBadge.title = `Racha: ${streak} día${streak !== 1 ? 's' : ''}`;
    }
  }

  // =========================
  // State
  // =========================
  const state = {
    pool: [],
    poolById: new Map(),
    blocks: [],
    exams: [],

    quiz: null, // { questions, idx, answers, mode, modeLabel, blockKey, blockLabel }
    locked: false,
    selected: null,
    infinite: false,
    examUnlocked: false,
    currentSource: '',
    timerId: null,

    mode: 'random', // random | block | exam | examlist | single
    block: '',      // select value
    exam: '',       // select value
    questionNumber: '',
    review: { open: false, attemptIndex: null },
    markedSet: new Set(),
    marked: { open: false, ids: [], selectedIndex: null }
  };

  // =========================
  // Elements (si falta alguno, no crashea)
  // =========================
  const el = {
    fileInput: $('#fileInput'),
    btnLoadLast: $('#btnLoadLast'),
    btnMenuHome: $('#btnMenuHome'),
    btnStart: $('#btnStart'),
    pillState: $('#pillState'),
    quizBody: $('#quizBody'),
    quizFooter: $('#quizFooter'),
    btnSubmit: $('#btnSubmit'),
    btnNext: $('#btnNext'),
    btnSkip: $('#btnSkip'),
    btnFinish: $('#btnFinish'),
    progressBar: $('#progressBar'),
    scoreInline: $('#scoreInline'),
    countInline: $('#countInline'),
    timerInline: $('#timerInline'),
    toggleContinuous: $('#toggleContinuous'),

    modeSelect: $('#modeSelect'),
    blockSelect: $('#blockSelect'),
    examSelect: $('#examSelect'),
    questionInput: $('#questionInput'),
    modeHint: $('#modeHint'),
    blockHint: $('#blockHint'),
    examHint: $('#examHint'),
    questionHint: $('#questionHint'),

    libSelect: $('#libSelect'),
    btnLibLoad: $('#btnLibLoad'),
    btnLibRefresh: $('#btnLibRefresh'),
    libHint: $('#libHint'),

    historyList: $('#historyList'),
    btnResetHistory: $('#btnResetHistory'),
    kpiLast: $('#kpiLast'),
    kpiBest: $('#kpiBest'),
    kpiAvg: $('#kpiAvg'),
    sparkLine: $('#sparkLine'),

    reviewPanel: $('#reviewPanel'),
    reviewTitle: $('#reviewTitle'),
    reviewMeta: $('#reviewMeta'),
    reviewList: $('#reviewList'),
    reviewDetail: $('#reviewDetail'),
    btnCloseReview: $('#btnCloseReview'),
    btnReviewHome: $('#btnReviewHome'),

    markedCount: $('#markedCount'),
    btnMarkedOpen: $('#btnMarkedOpen'),
    markedPanel: $('#markedPanel'),
    markedTitle: $('#markedTitle'),
    markedMeta: $('#markedMeta'),
    markedList: $('#markedList'),
    markedDetail: $('#markedDetail'),
    btnMarkedHome: $('#btnMarkedHome'),
    dropOverlay: $('#dropOverlay'),
    toggleZen: $('#toggleZen'),
    btnZenHome: $('#btnZenHome'),
    srsCountField: $('#srsCountField'),
    srsCountInput: $('#srsCountInput'),
    seedInput: $('#seedInput'),
    btnSeedGen: $('#btnSeedGen'),
    heatmapGrid: $('#heatmapGrid'),
    heatmapMonths: $('#heatmapMonths'),
    streakBadge: $('#streakBadge'),
  };

  // =========================
  // Exam + timer helpers
  // =========================
  const normalizeSource = (value) => String(value ?? '').trim().toLowerCase();

  function isExamSource(value) {
    const normalized = normalizeSource(value);
    return normalized === normalizeSource(EXAM_SOURCE_ID) ||
      normalized === normalizeSource(EXAM_SOURCE_FILE);
  }

  function updateExamOption() {
    if (!el.modeSelect) return;
    const option = el.modeSelect.querySelector('option[value="exam"]');
    if (!option) return;
    option.disabled = !state.examUnlocked;
    option.textContent = state.examUnlocked
      ? `Examen (${EXAM_QUESTIONS} · 1h10)`
      : `Examen (${EXAM_QUESTIONS} · 1h10) - bloqueado`;
  }

  function updateExamListOption() {
    if (!el.modeSelect) return;
    const option = el.modeSelect.querySelector('option[value="examlist"]');
    if (!option) return;
    const available = (state.exams || []).length > 0;
    option.disabled = !available;
    option.textContent = available ? 'Examen (elige)' : 'Examen (sin datos)';
  }

  function ensureModeAllowed() {
    updateExamOption();
    updateExamListOption();
    if (!state.examUnlocked && state.mode === 'exam') {
      state.mode = 'random';
      if (el.modeSelect) el.modeSelect.value = state.mode;
      savePrefs({
        mode: state.mode,
        block: state.block,
        exam: state.exam,
        infinite: state.infinite,
        questionNumber: state.questionNumber
      });
    }

    if ((state.exams || []).length === 0 && state.mode === 'examlist') {
      state.mode = 'random';
      if (el.modeSelect) el.modeSelect.value = state.mode;
      savePrefs({
        mode: state.mode,
        block: state.block,
        exam: state.exam,
        infinite: state.infinite,
        questionNumber: state.questionNumber
      });
    }
  }

  function setSourceMeta(value) {
    state.currentSource = String(value || '').trim();
    if (state.currentSource) localStorage.setItem(KEY_SOURCE, state.currentSource);
    else localStorage.removeItem(KEY_SOURCE);
    state.examUnlocked = isExamSource(state.currentSource);
    ensureModeAllowed();
  }

  function formatCountdown(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function setTimerText(text) {
    if (el.timerInline) el.timerInline.textContent = text;
  }

  function setTimerIdle() {
    setTimerText('Tiempo 0:00');
  }

  function setTimerInfinity() {
    setTimerText('Tiempo sin límite');
  }

  function clearQuizTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function startQuizTimer(durationMs) {
    clearQuizTimer();
    if (!durationMs) {
      setTimerIdle();
      return;
    }

    const endAt = Date.now() + durationMs;

    const tick = () => {
      const remaining = endAt - Date.now();
      if (remaining <= 0) {
        setTimerText('Tiempo 0:00');
        clearQuizTimer();
        if (state.quiz) finishQuiz('Tiempo agotado');
        return;
      }
      setTimerText(`Tiempo ${formatCountdown(remaining)}`);
    };

    tick();
    state.timerId = setInterval(tick, 1000);
  }

  // =========================
  // Reference helpers
  // =========================
  function getPreviousReferenceId(baseQ) {
    if (!baseQ) return null;
    const haystack = [
      baseQ.text || '',
      ...(baseQ.options || []).map(o => o.text || '')
    ].join('\n');
    if (!PREV_REF_RE.test(String(haystack))) return null;
    const prevNumber = Number(baseQ.number) - 1;
    if (!Number.isFinite(prevNumber) || prevNumber < 1) return null;
    return String(prevNumber);
  }

  function renderPreviousReference(baseQ) {
    if (!el.quizBody) return;
    const wrap = $('#qRef', el.quizBody);
    const panel = $('#qRefPanel', el.quizBody);
    if (!wrap || !panel) return;

    const prevId = getPreviousReferenceId(baseQ);
    if (!prevId) {
      wrap.hidden = true;
      panel.hidden = true;
      return;
    }

    const prevQ = state.poolById.get(String(prevId));
    const idEl = $('#qRefId', el.quizBody);
    if (idEl) idEl.textContent = prevId;

    const btn = $('#qRefBtn', el.quizBody);
    const closeBtn = $('#qRefClose', el.quizBody);
    const titleEl = $('#qRefTitle', el.quizBody);
    const textEl = $('#qRefText', el.quizBody);
    const choicesEl = $('#qRefChoices', el.quizBody);

    wrap.hidden = false;
    panel.hidden = true;

    if (!prevQ) {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Enunciado no disponible';
        btn.setAttribute('title', 'No encuentro la pregunta anterior en esta batería.');
      }
      return;
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = `Ver pregunta ${prevId}`;
      btn.removeAttribute('title');
    }

    if (titleEl) titleEl.textContent = `Ejercicio anterior · Pregunta ${prevId}`;
    if (textEl) setMathText(textEl, prevQ.text);

    if (choicesEl) {
      choicesEl.innerHTML = prevQ.options.map(o => `
        <div class="choice ref-choice">
          <div class="letter">${esc(o.letter)})</div>
          <div class="c-text" data-letter="${esc(o.letter)}"></div>
        </div>
      `).join('');

      $$('.c-text', choicesEl).forEach(node => {
        const letter = node.getAttribute('data-letter');
        const opt = prevQ.options.find(x => x.letter === letter);
        setMathText(node, opt?.text ?? '');
      });
    }

    const openPanel = () => {
      panel.hidden = false;
      try { document.body.classList.add('ref-open'); } catch (_) {}
      typesetMath(panel);
    };
    const closePanel = () => {
      panel.hidden = true;
      try { document.body.classList.remove('ref-open'); } catch (_) {}
    };

    if (btn) btn.onclick = (e) => { e.preventDefault(); openPanel(); };
    if (closeBtn) closeBtn.onclick = (e) => { e.preventDefault(); closePanel(); };
    panel.onclick = (e) => {
      if (e.target === panel) closePanel();
    };
  }

  // =========================
  // Parser (TXT)
  // =========================
  function parseQuestionsFromTxt(raw) {
    // separa bloque y pregunta si van pegados en misma línea
    const normalized = String(raw ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00A0/g, ' ')
      .replace(/(###\s*Bloque[^\n]*?)(\s*Pregunta\s*\d+\s*:)/gi, '$1\n$2')
      .replace(/(###\s*Examen[^\n]*?)(\s*Pregunta\s*\d+\s*:)/gi, '$1\n$2');

    const lines = normalized.split('\n');

    let block = '';
    let exam = '';
    let i = 0;
    const questions = [];

    // más permisivas (tu TXT puede variar)
    const optRe   = /^\s*([a-d])\s*[\)\.\-:]\s*(.+)\s*$/i;      // a) / a. / a- / a:
    const qRe     = /^\s*Pregunta\s*(\d+)\s*:\s*(.*)\s*$/i;     // Pregunta9: o Pregunta 9:
    const solRe   = /^\s*Soluci[oó]n\s*:\s*([a-d])\s*$/i;
    const blockRe = /^\s*###\s*Bloque\s*(.*)\s*$/i;
    const examRe  = /^\s*###\s*Examen\b\s*(.*)\s*$/i;
    const justRe  = /^\s*Justificaci[oó]n\s*:\s*(.*)\s*$/i;

    function consumeUntilNextQuestion(startIdx) {
      const out = [];
      for (let k = startIdx; k < lines.length; k++) {
        const L = lines[k];
        if (qRe.test(L) || blockRe.test(L) || examRe.test(L)) break;
        out.push(L);
      }
      return out.join('\n').trim();
    }

    while (i < lines.length) {
      const line = lines[i];

      const em = line.match(examRe);
      if (em) {
        const rawLabel = (em[1] || '').trim().replace(/\s+/g, ' ');
        exam = rawLabel || 'Sin título';
        block = '';
        i++;
        continue;
      }

      const bm = line.match(blockRe);
      if (bm) { block = (bm[1] || '').trim() || 'Bloque'; exam = ''; i++; continue; }

      const qm = line.match(qRe);
      if (qm) {
        const number = parseInt(qm[1], 10);
        let text = (qm[2] || '').trim();

        // texto multilinea hasta opciones/solución/justificación/otra pregunta
        let j = i + 1;
        while (j < lines.length) {
          const L = lines[j];
          if (optRe.test(L) || solRe.test(L) || justRe.test(L) || qRe.test(L) || blockRe.test(L)) break;
          if (L.trim() !== '') text += (text ? '\n' : '') + L.trim();
          j++;
        }

        // opciones raw
        const optionsRaw = [];
        i = j;
        while (i < lines.length) {
          const om = lines[i].match(optRe);
          if (!om) break;
          optionsRaw.push({ letter: om[1].toLowerCase(), text: om[2].trim() });
          i++;
        }

        // dedup por letra (fusiona texto si se repite)
        const merged = new Map(); // letter -> {letter,text}
        for (const o of optionsRaw) {
          if (!merged.has(o.letter)) merged.set(o.letter, { letter: o.letter, text: o.text });
          else {
            const prev = merged.get(o.letter);
            prev.text = (prev.text + '\n' + o.text).trim();
            merged.set(o.letter, prev);
          }
        }
        const order = ['a', 'b', 'c', 'd'];
        const options = order.filter(l => merged.has(l)).map(l => merged.get(l));

        // solución
        let answer = null;
        while (i < lines.length && lines[i].trim() === '') i++;
        const sm = (i < lines.length) ? lines[i].match(solRe) : null;
        if (sm) { answer = sm[1].toLowerCase(); i++; }

        // justificación
        let justification = '';
        while (i < lines.length && lines[i].trim() === '') i++;
        const jm = (i < lines.length) ? lines[i].match(justRe) : null;

        if (jm) {
          const first = (jm[1] || '').trim();
          i++;
          const rest = consumeUntilNextQuestion(i);
          justification = (first + (rest ? '\n' + rest : '')).trim();
          while (i < lines.length && !(qRe.test(lines[i]) || blockRe.test(lines[i]))) i++;
        } else {
          const rest = consumeUntilNextQuestion(i);
          if (rest) justification = rest.trim();
          while (i < lines.length && !(qRe.test(lines[i]) || blockRe.test(lines[i]))) i++;
        }

        // valida: debe tener solución y que exista en opciones
        const letters = new Set(options.map(o => o.letter));
        const ok =
          !!text &&
          options.length >= 2 &&
          /^[a-d]$/.test(answer || '') &&
          letters.has(answer);

        if (ok) {
          questions.push({
            id: String(number),
            number,
            block: (exam ? '' : (block || '').trim()),
            exam: (exam || '').trim(),
            text: text.trim(),
            options,
            answer,
            justification: (justification || '').trim(),
          });
        }

        continue;
      }

      i++;
    }

    return questions;
  }

  // =========================
  // Blocks + pool index
  // =========================
  function buildExamMapFromRaw(raw) {
    if (!raw) return new Map();
    const normalized = String(raw)
      .replace(/\r\n?/g, '\n')
      .replace(/\u00A0/g, ' ')
      .replace(/(###\s*Bloque[^\n]*?)(\s*Pregunta\s*\d+\s*:)/gi, '$1\n$2')
      .replace(/(###\s*Examen[^\n]*?)(\s*Pregunta\s*\d+\s*:)/gi, '$1\n$2');

    const lines = normalized.split('\n');
    const examRe = /^\s*###\s*Examen\b\s*(.*)\s*$/i;
    const blockRe = /^\s*###\s*Bloque\b\s*(.*)\s*$/i;
    const headingRe = /^\s*###\s*/;
    const qRe = /^\s*Pregunta\s*(\d+)\s*:/i;

    let exam = '';
    const map = new Map();

    for (const line of lines) {
      const em = line.match(examRe);
      if (em) {
        const rawLabel = (em[1] || '').trim().replace(/\s+/g, ' ');
        exam = rawLabel || 'Sin título';
        continue;
      }
      if (blockRe.test(line) || headingRe.test(line)) {
        exam = '';
        continue;
      }
      const qm = line.match(qRe);
      if (qm && exam) {
        map.set(String(qm[1]), exam);
      }
    }
    return map;
  }

  function rebuildPoolIndexAndBlocks() {
    state.poolById = new Map(state.pool.map(q => [String(q.id), q]));

    const counts = new Map(); // key -> count
    for (const q of state.pool) {
      const key = (q.block || '').trim();
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    state.blocks = Array.from(counts.entries())
      .map(([key, count]) => ({ key, label: key || '(Sin bloque)', count }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));

    if (el.blockSelect) {
      const prev = state.block;
      el.blockSelect.innerHTML =
        `<option value="">—</option>` +
        state.blocks.map(b => {
          const value = (b.key === '') ? '__NONE__' : b.key;
          return `<option value="${esc(value)}">${esc(b.label)} (${b.count})</option>`;
        }).join('');
      if (prev) el.blockSelect.value = prev;
    }
  }

  function rebuildExamIndex() {
    const counts = new Map(); // key -> count
    for (const q of state.pool) {
      const key = (q.exam || '').trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    state.exams = Array.from(counts.entries())
      .map(([key, count]) => ({ key, label: key || '(Sin examen)', count }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));

    if (el.examSelect) {
      const prev = state.exam;
      el.examSelect.innerHTML =
        `<option value="">—</option>` +
        state.exams.map(e => {
          return `<option value="${esc(e.key)}">${esc(e.label)} (${e.count})</option>`;
        }).join('');
      if (prev && state.exams.some(e => String(e.key) === String(prev))) {
        el.examSelect.value = prev;
      } else {
        el.examSelect.value = '';
      }
      state.exam = el.examSelect.value;
    }
  }

  function resolveBlockValue(selectValue) {
    if (selectValue === '__NONE__') return '';
    return selectValue;
  }

  // =========================
  // Shuffle options per question instance
  // =========================
  function makeShuffledQuestionInstance(baseQ) {
    // baseQ.options: [{letter:'a'..,text}]
    const originalOptions = baseQ.options.map(o => ({ ...o }));
    const correctOriginalLetter = baseQ.answer;

    // encuentra opción correcta original (por letra original)
    const correctOpt = originalOptions.find(o => o.letter === correctOriginalLetter);
    if (!correctOpt) {
      return { ...baseQ, options: originalOptions, answer: correctOriginalLetter };
    }

    const lastPosMap = loadLastPos();
    const lastPos = lastPosMap[String(baseQ.id)];

    let chosen = null;

    for (let tries = 0; tries < 12; tries++) {
      const shuffled = shuffleArray(originalOptions);
      const idxCorrect = shuffled.findIndex(o => o.letter === correctOriginalLetter);
      if (idxCorrect === -1) continue;

      if (Number.isInteger(lastPos) && shuffled.length > 1) {
        if (idxCorrect === lastPos) {
          // guarda candidato por si no hay alternativa (raro)
          chosen = chosen || { shuffled, idxCorrect };
          continue;
        }
      }

      chosen = { shuffled, idxCorrect };
      break;
    }

    if (!chosen) {
      const idxCorrect = originalOptions.findIndex(o => o.letter === correctOriginalLetter);
      chosen = { shuffled: originalOptions, idxCorrect };
    }

    const letters = ['a', 'b', 'c', 'd'];
    const newOptions = chosen.shuffled.map((o, idx) => ({
      letter: letters[idx] ?? String(idx + 1),
      text: o.text
    }));

    const newCorrectLetter = letters[chosen.idxCorrect] ?? correctOriginalLetter;

    // guarda última posición de correcta
    lastPosMap[String(baseQ.id)] = chosen.idxCorrect;
    saveLastPos(lastPosMap);

    return {
      ...baseQ,
      options: newOptions,
      answer: newCorrectLetter,
    };
  }

  // =========================
  // Scoring
  // =========================
  function computeScore(answers, total) {
    let correct = 0, wrong = 0, blank = 0;
    for (const a of answers) {
      if (a.result === 'correct') correct++;
      else if (a.result === 'wrong') wrong++;
      else blank++;
    }
    const score = correct - (wrong / 3);
    const denom = Math.max(1, total || answers.length || 1);
    const effectivePercent = clamp((score / denom) * 100, 0, 100);
    return { correct, wrong, blank, score, effectivePercent };
  }

  // =========================
  // UI helpers
  // =========================
  function setPill(text) { if (el.pillState) el.pillState.textContent = text; }

  function getManualQuestionNumber() {
    const raw = (el.questionInput ? el.questionInput.value : state.questionNumber) || '';
    const num = parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(num) || num < 1) return null;
    return num;
  }

  function updateStartAvailability() {
    if (!el.btnStart) return;

    ensureModeAllowed();
    updateExamListOption();

    // Show/hide SRS count field based on mode
    if (el.srsCountField) {
      el.srsCountField.style.display = state.mode === 'srs' ? '' : 'none';
    }

    const isExam = state.mode === 'exam';
    const isExamList = state.mode === 'examlist';
    const isSingle = state.mode === 'single';
    const prevInfinite = state.infinite;
    if (el.toggleContinuous) {
      if ((isExam || isExamList || isSingle) && state.infinite) {
        state.infinite = false;
        el.toggleContinuous.checked = false;
      }
      el.toggleContinuous.disabled = isExam || isExamList || isSingle;
    }
    if (prevInfinite !== state.infinite) {
      savePrefs({
        mode: state.mode,
        block: state.block,
        exam: state.exam,
        infinite: state.infinite,
        questionNumber: state.questionNumber
      });
    }

    if (isExam) {
      if (el.blockSelect) el.blockSelect.disabled = true;
      if (el.examSelect) el.examSelect.disabled = true;
      if (el.questionInput) el.questionInput.disabled = true;
      const canStart = state.examUnlocked && state.pool.length >= EXAM_QUESTIONS;
      el.btnStart.disabled = !canStart;
      el.btnStart.textContent = `Nuevo examen (${EXAM_QUESTIONS} · 1h10)`;
      updateFieldHints();
      return;
    }

    if (isExamList) {
      if (el.blockSelect) el.blockSelect.disabled = true;
      if (el.examSelect) el.examSelect.disabled = false;
      if (el.questionInput) el.questionInput.disabled = true;
      const examKey = state.exam || '';
      const count = examKey
        ? state.pool.filter(q => (q.exam || '') === examKey).length
        : 0;
      el.btnStart.disabled = !(examKey && count >= 1);
      el.btnStart.textContent = examKey ? `Examen · ${count} preguntas` : 'Examen';
      updateFieldHints();
      return;
    }

    if (isSingle) {
      if (el.blockSelect) el.blockSelect.disabled = true;
      if (el.examSelect) el.examSelect.disabled = true;
      if (el.questionInput) el.questionInput.disabled = false;
      const num = getManualQuestionNumber();
      const exists = num && state.poolById.has(String(num));
      el.btnStart.disabled = !exists;
      el.btnStart.textContent = num ? `Ver pregunta ${num}` : 'Ver pregunta';
      updateFieldHints();
      return;
    }

    if (state.mode === 'srs') {
      if (el.blockSelect) el.blockSelect.disabled = true;
      if (el.examSelect) el.examSelect.disabled = true;
      if (el.questionInput) el.questionInput.disabled = true;
      if (el.toggleContinuous) el.toggleContinuous.disabled = true;

      const dueCount = getDueQuestions().length;
      const srsMax = el.srsCountInput ? parseInt(el.srsCountInput.value, 10) || 20 : 20;
      const willDo = Math.min(dueCount, srsMax);
      el.btnStart.disabled = dueCount < 1;
      el.btnStart.textContent = dueCount > 0 ? `Repaso SRS (${willDo} de ${dueCount})` : 'SRS (nada pendiente)';
      updateFieldHints();
      return;
    }

    if (state.mode === 'random') {
      if (el.blockSelect) el.blockSelect.disabled = true;
      if (el.examSelect) el.examSelect.disabled = true;
      if (el.questionInput) el.questionInput.disabled = true;

      if (state.infinite) {
        el.btnStart.disabled = state.pool.length < 1;
        el.btnStart.textContent = 'Iniciar infinito';
      } else {
        el.btnStart.disabled = state.pool.length < 20;
        el.btnStart.textContent = 'Nuevo test (20)';
      }
      updateFieldHints();
      return;
    }

    if (el.blockSelect) el.blockSelect.disabled = false;
    if (el.examSelect) el.examSelect.disabled = true;
    if (el.questionInput) el.questionInput.disabled = true;
    const blockKey = resolveBlockValue(state.block || '');
    const count = state.pool.filter(q => (q.block || '') === blockKey).length;

    el.btnStart.disabled = !(state.block && count >= 1);

    if (state.infinite) {
      el.btnStart.textContent = state.block ? `Infinito (Bloque · ${count})` : 'Infinito (Bloque)';
    } else {
      el.btnStart.textContent = state.block ? `Nuevo test (Bloque · ${count})` : 'Nuevo test (Bloque)';
    }
    updateFieldHints();
  }

  function updateFieldHints() {
    const blockKey = resolveBlockValue(state.block || '');
    const blockCount = blockKey
      ? state.pool.filter(q => (q.block || '') === blockKey).length
      : 0;
    const examKey = state.exam || '';
    const examCount = examKey
      ? state.pool.filter(q => (q.exam || '') === examKey).length
      : 0;
    const qNum = getManualQuestionNumber();
    const qExists = qNum && state.poolById.has(String(qNum));

    if (el.modeHint) {
      if (state.mode === 'random') {
        el.modeHint.textContent = state.infinite
          ? 'Sigue sacando preguntas sin límite.'
          : '20 preguntas aleatorias de la batería.';
      } else if (state.mode === 'srs') {
        const dueCount = getDueQuestions().length;
        el.modeHint.textContent = dueCount > 0
          ? `Repaso inteligente: ${dueCount} preguntas pendientes.`
          : 'Todas las preguntas están al día. ¡Vuelve mañana!';
      } else if (state.mode === 'block') {
        el.modeHint.textContent = 'Selecciona un bloque para practicarlo completo.';
      } else if (state.mode === 'exam') {
        el.modeHint.textContent = 'Examen cronometrado (solo batería oficial).';
      } else if (state.mode === 'examlist') {
        el.modeHint.textContent = examKey
          ? `${examCount} preguntas en el examen seleccionado.`
          : 'Elige un examen de la lista.';
      } else {
        el.modeHint.textContent = 'Escribe el número exacto de la pregunta.';
      }
    }

    if (el.blockHint) {
      el.blockHint.textContent = blockKey
        ? `${blockCount} preguntas en este bloque.`
        : (state.mode === 'block' ? 'Elige un bloque.' : '—');
    }

    if (el.examHint) {
      el.examHint.textContent = examKey
        ? `${examCount} preguntas en este examen.`
        : (state.mode === 'examlist' ? 'Elige un examen.' : '—');
    }

    if (el.questionHint) {
      if (qNum == null) {
        el.questionHint.textContent = state.mode === 'single'
          ? 'Escribe un ID válido.'
          : '—';
      } else {
        el.questionHint.textContent = qExists
          ? 'Pregunta disponible en la batería.'
          : 'No existe en la batería actual.';
      }
    }
  }

  function setProgress() {
    if (!el.progressBar) return;
    if (!state.quiz) {
      el.progressBar.style.width = '0%';
      el.progressBar.classList.remove('infinite');
      return;
    }

    if (state.quiz.infinite) {
      el.progressBar.style.width = '100%';
      el.progressBar.classList.add('infinite');
      return;
    }

    el.progressBar.classList.remove('infinite');
    const total = state.quiz.questions.length || 1;
    const done = state.quiz.answers.length;
    el.progressBar.style.width = `${clamp((done / total) * 100, 0, 100)}%`;
  }

  function updateFooterInline() {
    if (!state.quiz || !el.scoreInline || !el.countInline) return;

    if (state.quiz.infinite) {
      const asked = state.quiz.answers.length || 0;
      const { correct, wrong, blank, score, effectivePercent } = computeScore(state.quiz.answers, Math.max(1, asked));
      el.scoreInline.textContent = `Puntuación: ${score.toFixed(2)} (Aciertos ${correct} · Fallos ${wrong} · Blancas ${blank}) · ${effectivePercent.toFixed(1)}%`;
      el.countInline.textContent = `${state.quiz.idx + 1}/infinito`;
      return;
    }

    const total = state.quiz.questions.length;
    const { correct, wrong, blank, score } = computeScore(state.quiz.answers, total);
    el.scoreInline.textContent = `Puntuación: ${score.toFixed(2)} (Aciertos ${correct} · Fallos ${wrong} · Blancas ${blank})`;
    el.countInline.textContent = `${Math.min(state.quiz.idx + 1, total)}/${total}`;
  }// =========================
  // History + stats
  // =========================
  function pushAttempt(attempt) {
    const hist = loadHistory();
    hist.unshift(attempt);
    saveHistory(hist.slice(0, 120));
    renderHistory();
  }

  function updatePerQuestionStats(answers) {
    const stats = loadQStats();
    for (const a of answers) {
      const id = String(a.id);
      stats[id] = stats[id] || { seen: 0, correct: 0, wrong: 0, blank: 0 };
      stats[id].seen += 1;
      if (a.result === 'correct') stats[id].correct += 1;
      else if (a.result === 'wrong') stats[id].wrong += 1;
      else stats[id].blank += 1;
    }
    saveQStats(stats);
  }

  // =========================
  // Review panel
  // =========================
  function closeReview() {
    state.review.open = false;
    state.review.attemptIndex = null;
    if (el.reviewPanel) el.reviewPanel.hidden = true;
    try { document.body.classList.remove('review-open'); } catch (_) {}
  }

  function openReview(attemptIndex) {
    if (!el.reviewPanel || !el.reviewList || !el.reviewDetail) return;

    const hist = loadHistory();
    const attempt = hist[attemptIndex];
    if (!attempt) return;

    closeMarkedPanel();

    state.review.open = true;
    state.review.attemptIndex = attemptIndex;

    el.reviewPanel.hidden = false;
    try { document.body.classList.add('review-open'); } catch (_) {}
    if (el.reviewTitle) el.reviewTitle.textContent = `Revisión · ${fmtDate(attempt.ts)}`;
    if (el.reviewMeta) {
      el.reviewMeta.textContent =
        `${attempt.mode === 'block' ? `Bloque: ${attempt.blockLabel || attempt.block} · ` : ''}` +
        `${attempt.mode === 'examlist' ? `Examen: ${attempt.examLabel || attempt.exam} · ` : ''}` +
        `Aciertos ${attempt.correct} · Fallos ${attempt.wrong} · Blancas ${attempt.blank} · ${attempt.effectivePercent.toFixed(2)}%`;
    }

    const items = attempt.items || [];
    el.reviewList.innerHTML = items.map((it, idx) => {
      const badgeClass =
        it.result === 'correct' ? 'ok' :
        it.result === 'wrong' ? 'bad' : 'blank';

      const badgeText =
        it.result === 'correct' ? 'A' :
        it.result === 'wrong' ? 'F' : 'B';

      const baseQ = state.poolById.get(String(it.id));
      const label = baseQ ? `Pregunta ${baseQ.number}` : `Pregunta ${it.id}`;

      return `
        <div class="review-item" data-idx="${idx}">
          <div>${esc(label)}</div>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
      `;
    }).join('');

    el.reviewDetail.innerHTML = `<div class="muted">Selecciona una pregunta para verla aquí.</div>`;
  }

  function renderReviewDetail(answerIdx) {
    if (!el.reviewDetail || !el.reviewList) return;

    const hist = loadHistory();
    const attempt = hist[state.review.attemptIndex];
    if (!attempt) return;

    const it = (attempt.items || [])[answerIdx];
    if (!it) return;

    const baseQ = state.poolById.get(String(it.id));
    if (!baseQ) {
      el.reviewDetail.innerHTML = `
        <div class="muted">No encuentro esta pregunta en la batería actual.</div>
        <div class="muted small" style="margin-top:6px;">Carga el mismo TXT con el que hiciste el test.</div>
      `;
      return;
    }

    const resultLabel =
      it.result === 'correct' ? 'Correcta' :
      it.result === 'wrong' ? 'Incorrecta' : 'Omitida';

    // Si el intento guardó el orden mostrado, úsalo
    const shownOptions = (it.optionsShown && it.optionsShown.length) ? it.optionsShown : baseQ.options;

    const scopeLabel = baseQ.exam
      ? `Examen ${baseQ.exam}`
      : (baseQ.block || '(Sin bloque)');

    el.reviewDetail.innerHTML = `
      <div class="mini">${esc(scopeLabel)} · Pregunta ${esc(baseQ.number)} · <strong>${esc(resultLabel)}</strong></div>

      <div class="q-title" style="margin-top:6px;">Enunciado</div>
      <div class="q-text" id="rvQText"></div>

      <div class="ansrow">
        <span class="pill">Tu respuesta: <strong>${esc(it.selected ?? '—')}</strong></span>
        <span class="pill">Correcta: <strong>${esc(it.answer ?? '—')}</strong></span>
      </div>

      <div class="q-title" style="margin-top:12px;">Opciones</div>
      <div class="choices" id="rvChoices"></div>

      <div class="justif" style="margin-top:12px">
        <h4>Justificación</h4>
        <p id="rvJustif"></p>
      </div>
    `;

    setMathText($('#rvQText', el.reviewDetail), baseQ.text);

    const rvChoices = $('#rvChoices', el.reviewDetail);
    rvChoices.innerHTML = shownOptions.map(o => {
      const isCorrect = o.letter === it.answer;
      const isWrongSelected = it.selected && o.letter === it.selected && it.selected !== it.answer;
      const cls = `choice ${isCorrect ? 'correct' : ''} ${isWrongSelected ? 'wrong' : ''}`.trim();
      return `
        <div class="${cls}">
          <div class="letter">${esc(o.letter)})</div>
          <div class="c-text" data-letter="${esc(o.letter)}"></div>
        </div>
      `;
    }).join('');

    $$('.c-text', rvChoices).forEach(node => {
      const letter = node.getAttribute('data-letter');
      const opt = shownOptions.find(x => x.letter === letter);
      setMathText(node, opt?.text ?? '');
    });

    setMathText($('#rvJustif', el.reviewDetail), baseQ.justification || '—');

    $$('.review-item', el.reviewList).forEach(x => x.classList.remove('active'));
    const active = $(`.review-item[data-idx="${answerIdx}"]`, el.reviewList);
    if (active) active.classList.add('active');

    typesetMath(el.reviewDetail);
  }

  // =========================
  // Marked questions
  // =========================
  function getMarkedIdsSorted() {
    return Array.from(state.markedSet)
      .map(id => String(id))
      .sort((a, b) => Number(a) - Number(b));
  }

  function renderMarkedCount() {
    if (el.markedCount) el.markedCount.textContent = String(state.markedSet.size);
    if (el.btnMarkedOpen) el.btnMarkedOpen.disabled = state.markedSet.size === 0;
  }

  function pruneMarkedToPool() {
    const filtered = new Set(
      Array.from(state.markedSet).filter(id => state.poolById.has(String(id)))
    );
    if (filtered.size !== state.markedSet.size) {
      state.markedSet = filtered;
      saveMarked(Array.from(state.markedSet));
    }
    renderMarkedCount();
    if (state.marked.open) renderMarkedList();
  }

  function updateMarkButton(baseQ) {
    if (!el.quizBody || !baseQ) return;
    const btn = $('#btnToggleMark', el.quizBody);
    if (!btn) return;
    const marked = state.markedSet.has(String(baseQ.id));
    btn.textContent = marked ? 'Marcada' : 'Marcar';
    btn.classList.toggle('marked', marked);
    btn.setAttribute('aria-pressed', marked ? 'true' : 'false');
  }

  function toggleMarkById(id) {
    const key = String(id);
    if (state.markedSet.has(key)) state.markedSet.delete(key);
    else state.markedSet.add(key);
    saveMarked(Array.from(state.markedSet));
    renderMarkedCount();

    if (state.marked.open) {
      const activeId = state.marked.ids[state.marked.selectedIndex];
      renderMarkedList();
      if (activeId && state.markedSet.has(activeId)) {
        const newIdx = state.marked.ids.indexOf(activeId);
        if (newIdx >= 0) renderMarkedDetail(newIdx);
      } else if (state.marked.ids.length) {
        renderMarkedDetail(0);
      } else if (el.markedDetail) {
        el.markedDetail.innerHTML = `<div class="muted">Selecciona una pregunta para verla aquí.</div>`;
      }
    }
  }

  function renderMarkedList() {
    if (!el.markedList || !el.markedDetail) return;
    const ids = getMarkedIdsSorted();
    state.marked.ids = ids;
    if (el.markedMeta) el.markedMeta.textContent = `Total: ${ids.length}`;

    if (!ids.length) {
      el.markedList.innerHTML = `<div class="muted small" style="padding: 10px 6px 0;">No hay preguntas marcadas.</div>`;
      el.markedDetail.innerHTML = `<div class="muted">Selecciona una pregunta para verla aquí.</div>`;
      return;
    }

    el.markedList.innerHTML = ids.map((qid, idx) => {
      const baseQ = state.poolById.get(String(qid));
      const label = baseQ ? `Pregunta ${baseQ.number}` : `Pregunta ${qid}`;
      return `
        <div class="review-item" data-idx="${idx}">
          <div>${esc(label)}</div>
          <span class="badge marked">M</span>
        </div>
      `;
    }).join('');
  }

  function renderMarkedDetail(markedIdx) {
    if (!el.markedDetail || !el.markedList) return;
    const id = state.marked.ids[markedIdx];
    if (!id) return;
    state.marked.selectedIndex = markedIdx;

    const baseQ = state.poolById.get(String(id));
    if (!baseQ) {
      el.markedDetail.innerHTML = `
        <div class="muted">No encuentro esta pregunta en la batería actual.</div>
        <div class="muted small" style="margin-top:6px;">Carga el mismo TXT con el que la marcaste.</div>
      `;
      return;
    }

    const scopeLabel = baseQ.exam
      ? `Examen ${baseQ.exam}`
      : (baseQ.block || '(Sin bloque)');

    el.markedDetail.innerHTML = `
      <div class="mini">${esc(scopeLabel)} · Pregunta ${esc(baseQ.number)} · <strong>Marcada</strong></div>

      <div class="q-title" style="margin-top:6px;">Enunciado</div>
      <div class="q-text" id="mkQText"></div>

      <div class="ansrow">
        <span class="pill">Correcta: <strong>${esc(baseQ.answer ?? '—')}</strong></span>
      </div>

      <div class="q-title" style="margin-top:12px;">Opciones</div>
      <div class="choices" id="mkChoices"></div>

      <div class="justif" style="margin-top:12px">
        <h4>Justificación</h4>
        <p id="mkJustif"></p>
      </div>

      <div class="btnrow" style="margin-top:12px; justify-content:flex-start;">
        <button id="btnUnmark" class="btn ghost" type="button">Quitar marca</button>
      </div>
    `;

    setMathText($('#mkQText', el.markedDetail), baseQ.text);

    const mkChoices = $('#mkChoices', el.markedDetail);
    mkChoices.innerHTML = baseQ.options.map(o => {
      const isCorrect = o.letter === baseQ.answer;
      const cls = `choice ${isCorrect ? 'correct' : ''}`.trim();
      return `
      <div class="${cls}">
        <div class="letter">${esc(o.letter)})</div>
        <div class="c-text" data-letter="${esc(o.letter)}"></div>
      </div>
      `;
    }).join('');

    $$('.c-text', mkChoices).forEach(node => {
      const letter = node.getAttribute('data-letter');
      const opt = baseQ.options.find(x => x.letter === letter);
      setMathText(node, opt?.text ?? '');
    });

    setMathText($('#mkJustif', el.markedDetail), baseQ.justification || '—');

    const btnUnmark = $('#btnUnmark', el.markedDetail);
    if (btnUnmark) {
      btnUnmark.addEventListener('click', () => {
        toggleMarkById(id);
        if (state.quiz && state.quiz.questions[state.quiz.idx]?.id === String(id)) {
          updateMarkButton(state.quiz.questions[state.quiz.idx]);
        }
      });
    }

    $$('.review-item', el.markedList).forEach(x => x.classList.remove('active'));
    const active = $(`.review-item[data-idx="${markedIdx}"]`, el.markedList);
    if (active) active.classList.add('active');

    typesetMath(el.markedDetail);
  }

  function openMarkedPanel() {
    if (!el.markedPanel || !el.markedList || !el.markedDetail) return;
    closeReview();
    state.marked.open = true;
    state.marked.selectedIndex = null;
    el.markedPanel.hidden = false;
    try { document.body.classList.add('marked-open'); } catch (_) {}
    if (el.markedTitle) el.markedTitle.textContent = 'Marcadas';
    renderMarkedList();
  }

  function closeMarkedPanel() {
    state.marked.open = false;
    state.marked.selectedIndex = null;
    if (el.markedPanel) el.markedPanel.hidden = true;
    try { document.body.classList.remove('marked-open'); } catch (_) {}
  }

  // =========================
  // History UI
  // =========================
  function renderHistory() {
    if (!el.historyList) return;
    const hist = loadHistory();

    const last = hist[0]?.effectivePercent;
    const best = hist.length ? Math.max(...hist.map(h => h.effectivePercent)) : null;
    const avg = hist.length
      ? (hist.slice(0, 10).reduce((s, h) => s + h.effectivePercent, 0) / Math.min(10, hist.length))
      : null;

    if (el.kpiLast) el.kpiLast.textContent = (last == null) ? '—' : `${last.toFixed(2)}%`;
    if (el.kpiBest) el.kpiBest.textContent = (best == null) ? '—' : `${best.toFixed(2)}%`;
    if (el.kpiAvg) el.kpiAvg.textContent = (avg == null) ? '—' : `${avg.toFixed(2)}%`;

    if (el.sparkLine) {
      const data = hist.slice(0, 20).map(h => h.effectivePercent).reverse();
      if (data.length >= 2) {
        const pts = data.map((v, idx) => {
          const x = (idx / (data.length - 1)) * 200;
          const y = 40 - (v / 100) * 36 - 2;
          return `${x.toFixed(1)},${clamp(y, 2, 38).toFixed(1)}`;
        }).join(' ');
        el.sparkLine.setAttribute('points', pts);
      } else {
        el.sparkLine.setAttribute('points', '');
      }
    }

    if (!hist.length) {
      el.historyList.innerHTML = `<div class="muted small" style="padding: 10px 6px 0;">Aún no hay intentos.</div>`;
      return;
    }

    el.historyList.innerHTML = hist.slice(0, 12).map((h, idx) => `
      <div class="hist-item" data-idx="${idx}" style="cursor:pointer;">
        <div class="hist-main">
          <div class="hist-top">
            <div class="hist-date">${esc(fmtDate(h.ts))}</div>
            <div class="hist-score">${esc(h.effectivePercent.toFixed(2))}%</div>
          </div>
          <div class="hist-sub">
            ${h.mode === 'block' ? `Bloque: ${esc(h.blockLabel || h.block)} · ` : ''}
            ${h.mode === 'examlist' ? `Examen: ${esc(h.examLabel || h.exam)} · ` : ''}
            Aciertos ${h.correct} · Fallos ${h.wrong} · Blancas ${h.blank} · puntuación ${Number(h.score).toFixed(2)}
            · <span class="muted">click para revisar</span>
          </div>
        </div>
      </div>
    `).join('');
  }


  // =========================
  // Mobile "solo test" mode
  // =========================
  function setMobileQuizFocus(on) {
    try {
      const isMobile = window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
      if (!isMobile) return;
      document.body.classList.toggle('focus-quiz', !!on);
    } catch (_) {}
  }

  // =========================
  // Quiz flow
  // =========================

  function getBasePoolForQuiz() {
    if (state.mode === 'random' || state.mode === 'exam' || state.mode === 'single') {
      return state.pool.slice();
    }
    if (state.mode === 'examlist') {
      const examKey = state.exam || '';
      return state.pool.filter(q => (q.exam || '') === examKey);
    }
    const blockKey = resolveBlockValue(state.block || '');
    return state.pool.filter(q => (q.block || '') === blockKey);
  }

  function takeNextBaseQuestion(quiz) {
    if (!quiz || !quiz.basePool || !quiz.basePool.length) return null;
    if (quiz.deckPtr >= quiz.deck.length) {
      quiz.deck = shuffleArray(quiz.basePool);
      quiz.deckPtr = 0;
    }
    const q = quiz.deck[quiz.deckPtr];
    quiz.deckPtr += 1;
    return q;
  }

  function startQuiz() {
    closeReview();
    closeMarkedPanel();
    if (!state.pool.length) return;
    setMobileQuizFocus(true);

    clearQuizTimer();
    const infinite = !!state.infinite &&
      state.mode !== 'exam' &&
      state.mode !== 'examlist' &&
      state.mode !== 'single';

    let modeLabel = '';
    let blockKey = '';
    let blockLabel = '';
    let examKey = '';
    let examLabel = '';
    let durationMs = 0;

    if (infinite) {
      const basePool = getBasePoolForQuiz();
      if (!basePool.length) return;

      if (state.mode === 'block') {
        blockKey = resolveBlockValue(state.block || '');
        blockLabel = blockKey || '(Sin bloque)';
        modeLabel = 'Infinito (Bloque)';
      } else {
        modeLabel = 'Infinito (Aleatorio)';
      }

      const quiz = {
        questions: [],
        idx: 0,
        answers: [],
        mode: state.mode,
        modeLabel,
        blockKey,
        blockLabel,
        examKey,
        examLabel,
        infinite: true,
        durationMs,
        basePool,
        deck: shuffleArray(basePool),
        deckPtr: 0
      };

      const firstBase = takeNextBaseQuestion(quiz);
      if (!firstBase) return;
      quiz.questions.push(makeShuffledQuestionInstance(firstBase));
      state.quiz = quiz;
    } else {
      let selectedQuestions = [];

      if (state.mode === 'random') {
        if (state.pool.length < 20) return;
        
        // Check for seed challenge
        const seed = el.seedInput ? el.seedInput.value.trim().toUpperCase() : '';
        if (seed && seed.length >= 4) {
          // Use seeded shuffle for reproducible order
          const shuffled = seededShuffle(state.pool, seed);
          selectedQuestions = shuffled.slice(0, 20);
          modeLabel = `Seed: ${seed}`;
        } else {
          selectedQuestions = sample(state.pool, 20);
          modeLabel = 'Aleatorio (20)';
        }
      } else if (state.mode === 'srs') {
        const due = getDueQuestions();
        if (!due.length) return;
        const srsMax = el.srsCountInput ? parseInt(el.srsCountInput.value, 10) || 20 : 20;
        selectedQuestions = due.slice(0, Math.min(srsMax, 100));
        modeLabel = `Repaso SRS (${selectedQuestions.length})`;
      } else if (state.mode === 'exam') {
        if (!state.examUnlocked || state.pool.length < EXAM_QUESTIONS) return;
        selectedQuestions = sample(state.pool, EXAM_QUESTIONS);
        modeLabel = `Examen (${EXAM_QUESTIONS} · 1h10)`;
        durationMs = EXAM_DURATION_MS;
      } else if (state.mode === 'examlist') {
        examKey = state.exam || '';
        examLabel = examKey || '(Sin examen)';
        selectedQuestions = shuffleArray(state.pool.filter(q => (q.exam || '') === examKey));
        if (!selectedQuestions.length) return;
        modeLabel = `Examen · ${examLabel}`;
      } else if (state.mode === 'single') {
        const num = getManualQuestionNumber();
        const picked = num ? state.poolById.get(String(num)) : null;
        if (!picked) return;
        selectedQuestions = [picked];
        modeLabel = `Pregunta ${num}`;
      } else {
        blockKey = resolveBlockValue(state.block || '');
        selectedQuestions = shuffleArray(state.pool.filter(q => (q.block || '') === blockKey));
        if (!selectedQuestions.length) return;
        modeLabel = 'Bloque completo';
        blockLabel = blockKey || '(Sin bloque)';
      }

      // Reordena opciones por pregunta y recalcula letra correcta
      const instanced = selectedQuestions.map(q => makeShuffledQuestionInstance(q));

      state.quiz = {
        questions: instanced,
        idx: 0,
        answers: [],
        mode: state.mode,
        modeLabel,
        blockKey,
        blockLabel,
        examKey,
        examLabel,
        infinite: false,
        durationMs
      };
    }

    state.locked = false;
    state.selected = null;

    if (el.quizFooter) el.quizFooter.hidden = false;
    if (el.btnFinish) el.btnFinish.hidden = !state.quiz.infinite;

    if (el.btnNext) el.btnNext.hidden = true;
    if (el.btnSubmit) { el.btnSubmit.hidden = false; el.btnSubmit.disabled = true; }

    if (state.quiz.infinite) {
      setTimerInfinity();
    } else if (state.quiz.durationMs) {
      startQuizTimer(state.quiz.durationMs);
    } else {
      setTimerIdle();
    }

    setPill(`En curso · ${state.quiz.infinite ? 'modo infinito' : `${state.quiz.questions.length} preguntas`}`);
    renderQuestion();
    setProgress();
    updateFooterInline();
  }

  function renderQuestion() {
    const q = state.quiz.questions[state.quiz.idx];

    if (!el.quizBody) return;

    el.quizBody.innerHTML = `
      <div class="q-meta">
        ${q.exam
          ? `<span class="tag">Examen · ${esc(q.exam)}</span>`
          : `<span class="tag">${esc(q.block || '(Sin bloque)')}</span>`}
        <span class="tag">Pregunta ${esc(q.number)}</span>
        <button class="tag tag-action" type="button" id="btnToggleMark" aria-pressed="false">Marcar</button>
      </div>

      <div class="q-title">Elige la respuesta correcta</div>
      <div class="q-text" id="qText"></div>

      <div class="q-ref" id="qRef" hidden>
        <div class="q-ref-text">
          <span class="tag">Referencia</span>
          <span>Ejercicio anterior · ID <strong id="qRefId"></strong></span>
        </div>
        <button class="btn ghost q-ref-link" type="button" id="qRefBtn">Ver enunciado</button>
      </div>

      <div class="q-ref-panel" id="qRefPanel" hidden role="dialog" aria-modal="true" aria-labelledby="qRefTitle">
        <div class="q-ref-card" role="document">
          <div class="q-ref-head">
            <div class="q-ref-title" id="qRefTitle">Ejercicio anterior</div>
            <button class="btn ghost q-ref-close" type="button" id="qRefClose">Cerrar</button>
          </div>
          <div class="q-text" id="qRefText"></div>
          <div class="ref-choices" id="qRefChoices"></div>
        </div>
      </div>

      <div class="choices" role="radiogroup" aria-label="Opciones">
        ${q.options.map(o => `
          <label class="choice" data-letter="${esc(o.letter)}">
            <input type="radio" name="choice" value="${esc(o.letter)}" />
            <div class="letter">${esc(o.letter)})</div>
            <div class="c-text"></div>
          </label>
        `).join('')}
      </div>

      <div id="justif" class="justif" hidden>
        <h4>Justificación</h4>
        <p id="justifText"></p>
      </div>
    `;

    setMathText($('#qText', el.quizBody), q.text);

    const choiceEls = $$('.choice', el.quizBody);
    choiceEls.forEach((ch, idx) => {
      setMathText($('.c-text', ch), q.options[idx]?.text ?? '');
    });

    setMathText($('#justifText', el.quizBody), q.justification || '—');

    renderPreviousReference(q);

    const markBtn = $('#btnToggleMark', el.quizBody);
    if (markBtn) {
      updateMarkButton(q);
      markBtn.addEventListener('click', () => {
        toggleMarkById(q.id);
        updateMarkButton(q);
      });
    }

    // selección: change en input
    $$('.choice input', el.quizBody).forEach((input) => {
      input.addEventListener('change', () => {
        if (state.locked) return;
        state.selected = input.value;
        if (el.btnSubmit) el.btnSubmit.disabled = false;
      });
    });

    state.locked = false;
    state.selected = null;

    if (el.btnSubmit) {
      el.btnSubmit.disabled = true;
      el.btnSubmit.textContent = 'Responder';
      el.btnSubmit.hidden = false;
    }
    if (el.btnNext) el.btnNext.hidden = true;

    typesetMath(el.quizBody);
  }

  function lockAndReveal(result, selectedLetter) {
    const q = state.quiz.questions[state.quiz.idx];
    const choiceEls = $$('.choice', el.quizBody);

    // Airbag: marca SOLO 1 correcta y SOLO 1 wrong aunque el HTML se duplicase por error
    let correctMarked = false;
    let wrongMarked = false;

    for (const ch of choiceEls) {
      const input = $('input', ch);
      if (input) input.disabled = true;

      const letter = ch.dataset.letter;

      if (letter === q.answer && !correctMarked) {
        ch.classList.add('correct');
        correctMarked = true;
        continue;
      }
      if (selectedLetter && letter === selectedLetter && letter !== q.answer && !wrongMarked) {
        ch.classList.add('wrong');
        wrongMarked = true;
      }
    }

    const meta = $('.q-meta', el.quizBody);
    if (meta) {
      meta.insertAdjacentHTML('beforeend',
        result === 'correct'
          ? `<span class="tag ok">Correcta</span>`
          : (result === 'wrong'
              ? `<span class="tag bad">Incorrecta</span>`
              : `<span class="tag">Omitida</span>`)
      );
    }

    const just = $('#justif', el.quizBody);
    if (just) just.hidden = false;

    state.locked = true;

    if (el.btnSubmit) el.btnSubmit.hidden = true;
    if (el.btnNext) {
      // Hide button if end of quiz (users should click Terminar)
      if (!state.quiz.infinite && state.quiz.idx === state.quiz.questions.length - 1) {
        el.btnNext.hidden = true;
      } else {
        el.btnNext.hidden = false;
        el.btnNext.textContent = 'Siguiente';
      }
    }

    typesetMath(el.quizBody);
  }

  function submitAnswer({ allowBlank = false } = {}) {
    if (!state.quiz || state.locked) return;

    const q = state.quiz.questions[state.quiz.idx];
    const selected = state.selected;
    if (!selected && !allowBlank) return;

    const result = (!selected) ? 'blank' : (selected === q.answer ? 'correct' : 'wrong');

    state.quiz.answers.push({
      id: q.id,
      selected: selected || null,
      answer: q.answer,
      result
    });

    // SRS update
    if (state.quiz.mode === 'srs') {
      updateSRSCard(q.id, getSRSQuality(result));
    }

    // Haptic feedback (mobile)
    hapticFeedback(result);

    lockAndReveal(result, selected);
    setProgress();
    updateFooterInline();
  }

  function skipQuestion() {
    if (!state.quiz) return;
    if (state.locked) { nextQuestion(); return; }
    submitAnswer({ allowBlank: true });
  }

  function nextQuestion() {
    if (!state.quiz) return;

    if (!state.locked) {
      if (!state.selected) return;
      submitAnswer();
      return;
    }

    if (state.quiz.infinite) {
      if (state.quiz.questions.length >= MAX_INFINITE_QUESTIONS) {
        finishQuiz('Límite alcanzado');
        return;
      }

      const nextBase = takeNextBaseQuestion(state.quiz);
      if (!nextBase) {
        finishQuiz('Sin preguntas');
        return;
      }

      state.quiz.idx += 1;
      state.quiz.questions.push(makeShuffledQuestionInstance(nextBase));

      state.locked = false;
      state.selected = null;
      renderQuestion();
      setProgress();
      updateFooterInline();
      return;
    }

    if (state.quiz.idx < state.quiz.questions.length - 1) {
      state.quiz.idx += 1;
      state.locked = false;
      state.selected = null;
      renderQuestion();
      setProgress();
      updateFooterInline();
      return;
    }

    finishQuiz();
  }

  function finishQuiz(reason) {
    if (!state.quiz) return;

    clearQuizTimer();
    setTimerIdle();

    const total = state.quiz.infinite ? state.quiz.answers.length : state.quiz.questions.length;
    const { correct, wrong, blank, score, effectivePercent } = computeScore(state.quiz.answers, Math.max(1, total));

    updatePerQuestionStats(state.quiz.answers);
    
    // Record activity for heatmap
    recordActivity();
    renderHeatmap();

    // Guardamos exactamente lo que vio el usuario (incluye optionsShown con letras ya re-etiquetadas)
    const items = state.quiz.questions.slice(0, state.quiz.answers.length).map((q, idx) => ({
      id: q.id,
      optionsShown: q.options, // orden mostrado en ese intento
      selected: state.quiz.answers[idx]?.selected ?? null,
      answer: q.answer,        // correcta en ese intento (ya remapeada)
      result: state.quiz.answers[idx]?.result ?? 'blank'
    }));

    const attempt = {
      ts: nowISO(),
      mode: state.quiz.mode,
      modeLabel: state.quiz.modeLabel,
      block: state.quiz.blockKey || '',
      blockLabel: state.quiz.blockLabel || '',
      exam: state.quiz.examKey || '',
      examLabel: state.quiz.examLabel || '',
      total,
      correct, wrong, blank,
      score: Number(score.toFixed(3)),
      effectivePercent: Number(effectivePercent.toFixed(2)),
      items
    };

    pushAttempt(attempt);

    setPill('Finalizado');
    setMobileQuizFocus(false);

    if (el.progressBar) {
      el.progressBar.style.width = '100%';
      el.progressBar.classList.remove('infinite');
    }
    if (el.quizFooter) el.quizFooter.hidden = true;
    if (el.btnFinish) el.btnFinish.hidden = true;

    if (!el.quizBody) return;

    const extra = reason ? `\n\nMotivo: ${reason}` : '';

    el.quizBody.innerHTML = `
      <div class="q-title">Resultado</div>
      <div class="q-text" id="resText"></div>

      <div class="btnrow" style="margin-top:14px">
        <button id="btnViewReview" class="btn ghost" type="button">
          Ver resultado
        </button>
        <button id="btnRestart" class="btn primary" type="button">
          ${state.infinite
            ? 'Volver a infinito'
            : (state.mode === 'random'
                ? 'Nuevo test (20)'
                : (state.mode === 'exam'
                    ? `Nuevo examen (${EXAM_QUESTIONS} · 1h10)`
                    : (state.mode === 'examlist'
                        ? 'Repetir examen'
                        : (state.mode === 'single'
                            ? 'Ver otra pregunta'
                            : 'Nuevo test (Bloque)'))))}
        </button>
      </div>
    `;

    const res = `
Modo: ${attempt.modeLabel}${attempt.mode === 'block' ? ` · ${attempt.blockLabel}` : ''}${attempt.mode === 'examlist' ? ` · ${attempt.examLabel}` : ''}
\n\nCorrectas: ${correct} · Incorrectas: ${wrong} · Omitidas: ${blank}
\nPuntuación neta: ${score.toFixed(2)} / ${total} (fallo = −1/3)
\nPorcentaje: ${effectivePercent.toFixed(2)}%${extra}
    `.trim();

    setMathText($('#resText', el.quizBody), res);
    typesetMath(el.quizBody);

    const btn = $('#btnRestart', el.quizBody);
    if (btn) btn.addEventListener('click', startQuiz);
    
    const btnReview = $('#btnViewReview', el.quizBody);
    if (btnReview) btnReview.addEventListener('click', () => openReview(0));

    // Avoid duplicate finishes from lingering key handlers after showing results.
    state.quiz = null;
    state.locked = true;
    state.selected = null;
  }// =========================
  // Battery load
  // =========================
  function setPool(questions, saved = false) {
    state.pool = questions;
    const raw = localStorage.getItem(KEY_RAW) || '';
    const examMap = buildExamMapFromRaw(raw);
    if (examMap.size) {
      for (const q of state.pool) {
        const exam = examMap.get(String(q.id));
        if (exam && !q.exam) {
          q.exam = exam;
          q.block = '';
        }
      }
    }
    rebuildPoolIndexAndBlocks();
    rebuildExamIndex();
    updateExamListOption();
    pruneMarkedToPool();

    setPill(`Batería cargada · ${state.pool.length} preguntas`);
    updateStartAvailability();

    if (!el.quizBody) return;

    if (state.pool.length < 2) {
      el.quizBody.innerHTML = `
        <div class="empty">
          <h2>Batería insuficiente</h2>
          <p>He cargado <strong>${esc(state.pool.length)}</strong> preguntas válidas.</p>
        </div>
      `;
      return;
    }

    el.quizBody.innerHTML = `
      <div class="empty">
        <h2>Listo</h2>
        <p>He cargado <strong>${esc(state.pool.length)}</strong> preguntas.</p>
        <p class="muted">Elige modo y pulsa “Nuevo test”.</p>
        ${saved ? `<p class="muted">Batería guardada para “Cargar última”.</p>` : ``}
      </div>
    `;
  }

  function loadFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      localStorage.setItem(KEY_RAW, raw);
      const qs = parseQuestionsFromTxt(raw);
      setSourceMeta(file?.name || '');
      setPool(qs, true);
      if (el.btnLoadLast) el.btnLoadLast.disabled = false;
    };
    reader.onerror = () => alert('No he podido leer el archivo.');
    reader.readAsText(file, 'utf-8');
  }

  function loadLast() {
    const raw = localStorage.getItem(KEY_RAW);
    if (!raw) return alert('No hay batería guardada en este navegador.');
    const source = localStorage.getItem(KEY_SOURCE) || '';
    setSourceMeta(source);
    const qs = parseQuestionsFromTxt(raw);
    setPool(qs, false);
  }

  // =========================
  // Biblioteca (carga por fetch desde rutas del proyecto)
  // =========================
  function findLibSource(id) {
    return (LIB_SOURCES || []).find(s => String(s.id) === String(id));
  }

  function setLibHint(text) {
    if (!el.libHint) return;
    el.libHint.textContent = text || '';
  }

  function renderLibrarySelect() {
    if (!el.libSelect) return;

    const prev = localStorage.getItem(KEY_LIBSEL) || '';
    const sources = Array.isArray(LIB_SOURCES) ? LIB_SOURCES : [];

    el.libSelect.innerHTML =
      '<option value="">—</option>' +
      sources.map(s => `<option value="${esc(String(s.id))}">${esc(String(s.label || s.id))}</option>`).join('');

    if (prev && sources.some(s => String(s.id) === String(prev))) {
      el.libSelect.value = prev;
    }

    if (el.btnLibLoad) el.btnLibLoad.disabled = !el.libSelect.value;

    if (location.protocol === 'file:') {
      setLibHint('Aviso: si abres con doble clic (file://), el navegador no deja leer archivos del proyecto. Abre con un servidor local (p.ej. Live Server / python -m http.server).');
    } else {
      setLibHint('Carga baterías desde rutas del proyecto (configurable en LIB_SOURCES en app.js).');
    }
  }

  async function loadFromUrl(url, label, sourceId) {
    if (!url) return;
    try {
      setPill(`Cargando… ${label ? label : ''}`.trim());
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();

      localStorage.setItem(KEY_RAW, raw);
      const qs = parseQuestionsFromTxt(raw);
      setSourceMeta(sourceId || label || '');
      setPool(qs, true);

      if (el.btnLoadLast) el.btnLoadLast.disabled = false;
      if (label) setLibHint(`Cargado: ${label}`);
    } catch (e) {
      console.error(e);
      setLibHint(`No he podido leer: ${url}`);
      alert('No he podido cargar ese archivo. Si estás en file://, usa un servidor local.');
      setPill('Sin batería cargada');
    }
  }


  // =========================
  // Events
  // =========================
  if (el.fileInput) {
    el.fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      loadFromFile(file);
      el.fileInput.value = '';
    });
  }


  // Biblioteca
  function updateLibLoadBtn() {
    if (!el.libSelect || !el.btnLibLoad) return;
    el.btnLibLoad.disabled = !el.libSelect.value;
    if (el.libSelect.value) localStorage.setItem(KEY_LIBSEL, el.libSelect.value);
  }

  if (el.libSelect) el.libSelect.addEventListener('change', updateLibLoadBtn);

  if (el.btnLibLoad) {
    el.btnLibLoad.addEventListener('click', () => {
      const id = el.libSelect ? el.libSelect.value : '';
      if (!id) return;
      const src = findLibSource(id);
      if (!src) return;
      loadFromUrl(src.url, src.label || src.id, src.id);
    });
  }

  if (el.btnLibRefresh) {
    el.btnLibRefresh.addEventListener('click', () => {
      renderLibrarySelect();
    });
  }


  if (el.btnLoadLast) el.btnLoadLast.addEventListener('click', loadLast);
  if (el.btnMenuHome) {
    el.btnMenuHome.addEventListener('click', () => {
      closeReview();
      closeMarkedPanel();
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
    });
  }
  if (el.btnStart) el.btnStart.addEventListener('click', startQuiz);
  if (el.btnSubmit) el.btnSubmit.addEventListener('click', submitAnswer);
  if (el.btnSkip) el.btnSkip.addEventListener('click', skipQuestion);
  if (el.btnNext) el.btnNext.addEventListener('click', nextQuestion);
  if (el.btnFinish) {
    el.btnFinish.addEventListener('click', () => {
      if (!state.quiz) return;
      if (!state.locked) submitAnswer({ allowBlank: true });
      finishQuiz('Parado por el usuario');
    });
  }

  if (el.toggleContinuous) {
    el.toggleContinuous.addEventListener('change', () => {
      state.infinite = !!el.toggleContinuous.checked;
      savePrefs({
        mode: state.mode,
        block: state.block,
        exam: state.exam,
        infinite: state.infinite,
        questionNumber: state.questionNumber
      });
      updateStartAvailability();
    });
  }

  if (el.modeSelect) {
    el.modeSelect.addEventListener('change', () => {
      if (el.modeSelect.value === 'block') state.mode = 'block';
      else if (el.modeSelect.value === 'exam') state.mode = 'exam';
      else if (el.modeSelect.value === 'examlist') state.mode = 'examlist';
      else if (el.modeSelect.value === 'single') state.mode = 'single';
      else if (el.modeSelect.value === 'srs') state.mode = 'srs';
      else state.mode = 'random';
      if (state.mode === 'exam' || state.mode === 'examlist' || state.mode === 'single' || state.mode === 'srs') {
        state.infinite = false;
        if (el.toggleContinuous) el.toggleContinuous.checked = false;
      }
      savePrefs({
        mode: state.mode,
        block: state.block,
        exam: state.exam,
        infinite: state.infinite,
        questionNumber: state.questionNumber
      });
      updateStartAvailability();
      updateStartAvailability();
    });
  }

  if (el.blockSelect) {
    el.blockSelect.addEventListener('change', () => {
      state.block = el.blockSelect.value;
      savePrefs({
        mode: state.mode,
        block: state.block,
        exam: state.exam,
        infinite: state.infinite,
        questionNumber: state.questionNumber
      });
      updateStartAvailability();
      updateStartAvailability();
    });
  }

  if (el.examSelect) {
    el.examSelect.addEventListener('change', () => {
      state.exam = el.examSelect.value;
      savePrefs({
        mode: state.mode,
        block: state.block,
        exam: state.exam,
        infinite: state.infinite,
        questionNumber: state.questionNumber
      });
      updateStartAvailability();
    });
  }

  if (el.questionInput) {
    el.questionInput.addEventListener('input', () => {
      state.questionNumber = el.questionInput.value;
      savePrefs({
        mode: state.mode,
        block: state.block,
        exam: state.exam,
        infinite: state.infinite,
        questionNumber: state.questionNumber
      });
      updateStartAvailability();
    });
  }

  if (el.btnResetHistory) {
    el.btnResetHistory.addEventListener('click', () => {
      if (!confirm('¿Borrar historial y estadísticas de preguntas?')) return;
      localStorage.removeItem(KEY_HISTORY);
      localStorage.removeItem(KEY_QSTATS);
      closeReview();
      renderHistory();
    });
  }

  if (el.btnMarkedOpen) el.btnMarkedOpen.addEventListener('click', openMarkedPanel);
  if (el.markedList) {
    el.markedList.addEventListener('click', (e) => {
      const item = e.target.closest('.review-item');
      if (!item) return;
      const idx = parseInt(item.getAttribute('data-idx'), 10);
      if (Number.isFinite(idx)) renderMarkedDetail(idx);
    });
  }
  if (el.btnMarkedHome) {
    el.btnMarkedHome.addEventListener('click', () => {
      closeMarkedPanel();
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
    });
  }

  if (el.historyList) {
    el.historyList.addEventListener('click', (e) => {
      const item = e.target.closest('.hist-item');
      if (!item) return;
      const idx = parseInt(item.getAttribute('data-idx'), 10);
      if (Number.isFinite(idx)) openReview(idx);
    });
  }

  if (el.reviewList) {
    el.reviewList.addEventListener('click', (e) => {
      const item = e.target.closest('.review-item');
      if (!item) return;
      const idx = parseInt(item.getAttribute('data-idx'), 10);
      if (Number.isFinite(idx)) renderReviewDetail(idx);
    });
  }

  if (el.btnCloseReview) el.btnCloseReview.addEventListener('click', closeReview);
  if (el.btnReviewHome) {
    el.btnReviewHome.addEventListener('click', () => {
      closeReview();
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
    });
  }

  // Atajos teclado
  document.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    const key = e.key;

    if (key === 'Escape') { e.preventDefault(); skipQuestion(); return; }
    if (!state.quiz) return;

    if (key === 'Enter') {
      e.preventDefault();
      if (!state.locked) submitAnswer();
      else nextQuestion();
      return;
    }

    if (state.locked) return;

    if (key >= '1' && key <= '9') {
      const idx = parseInt(key, 10) - 1;
      const inputs = $$('.choice input', el.quizBody);
      const input = inputs[idx];
      if (input) {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });

  // =========================
  // SRS getDueQuestions (needs state.pool)
  // =========================
  function getDueQuestions() {
    const srs = loadSRS();
    const now = Date.now();
    const due = [];
    
    if (!state.pool || !state.pool.length) return due;
    
    for (const q of state.pool) {
      const id = String(q.id);
      const card = srs[id];
      // Include if: never seen OR due for review
      if (!card || !card.nextReview || card.nextReview <= now) {
        due.push(q);
      }
    }
    
    // Sort logic: Review (Overdue) > New
    due.sort((a, b) => {
      const cardA = srs[String(a.id)];
      const cardB = srs[String(b.id)];
      // If no card or no nextReview -> New -> effective due = Infinity (do last)
      const dueA = (cardA && cardA.nextReview) ? cardA.nextReview : Number.MAX_SAFE_INTEGER;
      const dueB = (cardB && cardB.nextReview) ? cardB.nextReview : Number.MAX_SAFE_INTEGER;
      return dueA - dueB;
    });
    
    return due;
  }

  // =========================
  // Drag & Drop + Paste
  // =========================
  let dragCounter = 0;

  function showDropOverlay() {
    if (el.dropOverlay) el.dropOverlay.hidden = false;
  }

  function hideDropOverlay() {
    if (el.dropOverlay) el.dropOverlay.hidden = true;
  }

  function handleFileLoad(text, sourceName) {
    if (!text || !text.trim()) return;
    
    const questions = parseQuestionsFromTxt(text);
    if (!questions.length) {
      alert('No se encontraron preguntas válidas en el contenido.');
      return;
    }
    
    // Save and load like normal file input
    localStorage.setItem(KEY_RAW, text);
    state.pool = questions;
    rebuildPoolIndexAndBlocks();
    rebuildExamIndex();
    pruneMarkedToPool();
    setSourceMeta(sourceName || 'drop-paste');
    setPill(`${questions.length} preguntas cargadas`);
    updateStartAvailability();
    if (el.btnLoadLast) el.btnLoadLast.disabled = false;
  }

  // Drag events
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) showDropOverlay();
  });

  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      hideDropOverlay();
    }
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    hideDropOverlay();
    
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    
    const file = files[0];
    if (!file.name.endsWith('.txt') && !file.type.includes('text')) {
      alert('Por favor, arrastra un archivo .txt');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (evt) => {
      handleFileLoad(evt.target.result, file.name);
    };
    reader.readAsText(file);
  });

  // Paste handler (Ctrl+V)
  document.addEventListener('paste', (e) => {
    // Don't interfere with text inputs
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    
    const text = e.clipboardData?.getData('text/plain');
    if (!text || !text.trim()) return;
    
    // Check if it looks like question content
    if (text.includes('Pregunta') && (text.includes('a)') || text.includes('a.'))) {
      e.preventDefault();
      handleFileLoad(text, 'clipboard');
    }
  });

  // =========================
  // Zen Mode
  // =========================
  function setZenMode(on) {
    document.body.classList.toggle('zen-mode', !!on);
    if (el.toggleZen) el.toggleZen.checked = !!on;
  }

  if (el.toggleZen) {
    el.toggleZen.addEventListener('change', () => {
      setZenMode(el.toggleZen.checked);
    });
  }

  // Zen home button - exits zen mode
  if (el.btnZenHome) {
    el.btnZenHome.addEventListener('click', () => {
      setZenMode(false);
    });
  }

  // SRS count input change updates button text
  if (el.srsCountInput) {
    el.srsCountInput.addEventListener('input', () => {
      updateStartAvailability();
    });
  }

  // Seed Challenge button
  if (el.btnSeedGen) {
    el.btnSeedGen.addEventListener('click', () => {
      const code = generateSeedCode();
      if (el.seedInput) el.seedInput.value = code;
    });
  }

  // Haptic feedback helper
  function hapticFeedback(type) {
    if (!navigator.vibrate) return;
    try {
      if (type === 'correct') {
        navigator.vibrate(50);
      } else if (type === 'wrong') {
        navigator.vibrate([50, 50, 50]);
      }
    } catch (_) {}
  }

  // =========================
  // Init
  // =========================
  try { document.body.classList.remove('focus-quiz'); } catch (_) {}

  renderHistory();

  renderHeatmap();

  renderLibrarySelect();

  state.markedSet = new Set(loadMarked().map((id) => String(id)));
  renderMarkedCount();

  if (el.btnLoadLast) el.btnLoadLast.disabled = !localStorage.getItem(KEY_RAW);

  const prefs = loadPrefs();
  if (prefs.mode === 'block') state.mode = 'block';
  else if (prefs.mode === 'exam') state.mode = 'exam';
  else if (prefs.mode === 'examlist') state.mode = 'examlist';
  else if (prefs.mode === 'single') state.mode = 'single';
  else if (prefs.mode === 'srs') state.mode = 'srs';
  else state.mode = 'random';
  state.block = prefs.block || '';
  state.exam = prefs.exam || '';
  state.infinite = !!prefs.infinite || !!prefs.continuous;
  state.questionNumber = (prefs.questionNumber != null) ? String(prefs.questionNumber) : '';

  if (el.modeSelect) el.modeSelect.value = state.mode;
  if (el.blockSelect) el.blockSelect.value = state.block;
  if (el.examSelect) el.examSelect.value = state.exam;
  if (el.toggleContinuous) el.toggleContinuous.checked = state.infinite;
  if (el.questionInput) el.questionInput.value = state.questionNumber;

  updateStartAvailability();
})();
