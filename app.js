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

  const KEY_LIBSEL = 'quiz_library_last_v1';

  // =========================
  // Biblioteca (archivos predeterminados)
  // =========================
 
  const LIB_SOURCES = [
    { id: 'Redes', label: 'Redes', url: './baterias/Redes.txt' },
  ];

  // =========================
  // Infinito
  // =========================
  const MAX_INFINITE_QUESTIONS = 2000; // límite de seguridad en una sesión infinita



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

  // =========================
  // State
  // =========================
  const state = {
    pool: [],
    poolById: new Map(),
    blocks: [],

    quiz: null, // { questions, idx, answers, mode, modeLabel, blockKey, blockLabel }
    locked: false,
    selected: null,
    infinite: false,

    mode: 'random', // random | block
    block: '',      // select value
    review: { open: false, attemptIndex: null }
  };

  // =========================
  // Elements (si falta alguno, no crashea)
  // =========================
  const el = {
    fileInput: $('#fileInput'),
    btnLoadLast: $('#btnLoadLast'),
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
    toggleContinuous: $('#toggleContinuous'),

    modeSelect: $('#modeSelect'),
    blockSelect: $('#blockSelect'),

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
  };

  // =========================
  // Parser (TXT)
  // =========================
  function parseQuestionsFromTxt(raw) {
    // separa bloque y pregunta si van pegados en misma línea
    const normalized = String(raw ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/(###\s*Bloque[^\n]*?)(\s*Pregunta\s*\d+\s*:)/gi, '$1\n$2');

    const lines = normalized.split('\n');

    let block = '';
    let i = 0;
    const questions = [];

    // más permisivas (tu TXT puede variar)
    const optRe   = /^\s*([a-d])\s*[\)\.\-:]\s*(.+)\s*$/i;      // a) / a. / a- / a:
    const qRe     = /^\s*Pregunta\s*(\d+)\s*:\s*(.*)\s*$/i;     // Pregunta9: o Pregunta 9:
    const solRe   = /^\s*Soluci[oó]n\s*:\s*([a-d])\s*$/i;
    const blockRe = /^\s*###\s*Bloque\s*(.*)\s*$/i;
    const justRe  = /^\s*Justificaci[oó]n\s*:\s*(.*)\s*$/i;

    function consumeUntilNextQuestion(startIdx) {
      const out = [];
      for (let k = startIdx; k < lines.length; k++) {
        const L = lines[k];
        if (qRe.test(L) || blockRe.test(L)) break;
        out.push(L);
      }
      return out.join('\n').trim();
    }

    while (i < lines.length) {
      const line = lines[i];

      const bm = line.match(blockRe);
      if (bm) { block = (bm[1] || '').trim() || 'Bloque'; i++; continue; }

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
            block: (block || '').trim(),
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

  function updateStartAvailability() {
    if (!el.btnStart) return;

    if (state.mode === 'random') {
      if (el.blockSelect) el.blockSelect.disabled = true;

      if (state.infinite) {
        el.btnStart.disabled = state.pool.length < 1;
        el.btnStart.textContent = 'Iniciar infinito';
      } else {
        el.btnStart.disabled = state.pool.length < 20;
        el.btnStart.textContent = 'Nuevo test (20)';
      }
      return;
    }

    if (el.blockSelect) el.blockSelect.disabled = false;
    const blockKey = resolveBlockValue(state.block || '');
    const count = state.pool.filter(q => (q.block || '') === blockKey).length;

    el.btnStart.disabled = !(state.block && count >= 1);

    if (state.infinite) {
      el.btnStart.textContent = state.block ? `Infinito (Bloque · ${count})` : 'Infinito (Bloque)';
    } else {
      el.btnStart.textContent = state.block ? `Nuevo test (Bloque · ${count})` : 'Nuevo test (Bloque)';
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
      el.scoreInline.textContent = `Puntuación: ${score.toFixed(2)} (✓${correct} ✗${wrong} ·${blank}) · ${effectivePercent.toFixed(1)}%`;
      el.countInline.textContent = `${state.quiz.idx + 1}/∞`;
      return;
    }

    const total = state.quiz.questions.length;
    const { correct, wrong, blank, score } = computeScore(state.quiz.answers, total);
    el.scoreInline.textContent = `Puntuación: ${score.toFixed(2)} (✓${correct} ✗${wrong} ·${blank})`;
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
  }

  function openReview(attemptIndex) {
    if (!el.reviewPanel || !el.reviewList || !el.reviewDetail) return;

    const hist = loadHistory();
    const attempt = hist[attemptIndex];
    if (!attempt) return;

    state.review.open = true;
    state.review.attemptIndex = attemptIndex;

    el.reviewPanel.hidden = false;
    if (el.reviewTitle) el.reviewTitle.textContent = `Revisión · ${fmtDate(attempt.ts)}`;
    if (el.reviewMeta) {
      el.reviewMeta.textContent =
        `${attempt.mode === 'block' ? `Bloque: ${attempt.blockLabel || attempt.block} · ` : ''}` +
        `✓${attempt.correct} ✗${attempt.wrong} ·${attempt.blank} · ${attempt.effectivePercent.toFixed(2)}%`;
    }

    const items = attempt.items || [];
    el.reviewList.innerHTML = items.map((it, idx) => {
      const badgeClass =
        it.result === 'correct' ? 'ok' :
        it.result === 'wrong' ? 'bad' : 'blank';

      const badgeText =
        it.result === 'correct' ? '✓' :
        it.result === 'wrong' ? '✗' : '—';

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

    el.reviewDetail.innerHTML = `
      <div class="mini">${esc(baseQ.block || '(Sin bloque)')} · Pregunta ${esc(baseQ.number)} · <strong>${esc(resultLabel)}</strong></div>

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
            ✓${h.correct} ✗${h.wrong} ·${h.blank} · score ${Number(h.score).toFixed(2)}
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
    if (state.mode === 'random') return state.pool.slice();
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
    if (!state.pool.length) return;
    setMobileQuizFocus(true);

    const infinite = !!state.infinite;

    let modeLabel = '';
    let blockKey = '';
    let blockLabel = '';

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
        infinite: true,
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
        selectedQuestions = sample(state.pool, 20);
        modeLabel = 'Aleatorio (20)';
      } else {
        blockKey = resolveBlockValue(state.block || '');
        selectedQuestions = shuffleArray(state.pool.filter(q => (q.block || '') === blockKey));
        if (!selectedQuestions.length) return;
        modeLabel = 'Bloque completo';
        blockLabel = blockKey || '(Sin bloque)';
      }

      // ✅ reordena opciones por pregunta y recalcula letra correcta
      const instanced = selectedQuestions.map(q => makeShuffledQuestionInstance(q));

      state.quiz = {
        questions: instanced,
        idx: 0,
        answers: [],
        mode: state.mode,
        modeLabel,
        blockKey,
        blockLabel,
        infinite: false
      };
    }

    state.locked = false;
    state.selected = null;

    if (el.quizFooter) el.quizFooter.hidden = false;
    if (el.btnFinish) el.btnFinish.hidden = !state.quiz.infinite;

    if (el.btnNext) el.btnNext.hidden = true;
    if (el.btnSubmit) { el.btnSubmit.hidden = false; el.btnSubmit.disabled = true; }

    setPill(`En curso · ${state.quiz.infinite ? '∞' : state.quiz.questions.length} preguntas`);
    renderQuestion();
    setProgress();
    updateFooterInline();
  }

  function renderQuestion() {
    const q = state.quiz.questions[state.quiz.idx];

    if (!el.quizBody) return;

    el.quizBody.innerHTML = `
      <div class="q-meta">
        <span class="tag">${esc(q.block || '(Sin bloque)')}</span>
        <span class="tag">Pregunta ${esc(q.number)}</span>
      </div>

      <div class="q-title">Elige la respuesta correcta</div>
      <div class="q-text" id="qText"></div>

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
          ? `<span class="tag ok">✓ Correcta</span>`
          : (result === 'wrong'
              ? `<span class="tag bad">✗ Incorrecta</span>`
              : `<span class="tag">· Omitida</span>`)
      );
    }

    const just = $('#justif', el.quizBody);
    if (just) just.hidden = false;

    state.locked = true;

    if (el.btnSubmit) el.btnSubmit.hidden = true;
    if (el.btnNext) {
      el.btnNext.hidden = false;
      el.btnNext.textContent = state.quiz.infinite
        ? 'Siguiente'
        : ((state.quiz.idx === state.quiz.questions.length - 1) ? 'Ver resultado' : 'Siguiente');
    }

    typesetMath(el.quizBody);
  }

  function submitAnswer() {
    if (!state.quiz || state.locked) return;

    const q = state.quiz.questions[state.quiz.idx];
    const selected = state.selected;

    const result = (!selected) ? 'blank' : (selected === q.answer ? 'correct' : 'wrong');

    state.quiz.answers.push({
      id: q.id,
      selected: selected || null,
      answer: q.answer,
      result
    });

    lockAndReveal(result, selected);
    setProgress();
    updateFooterInline();
  }

  function skipQuestion() {
    if (!state.quiz) return;
    if (state.locked) { nextQuestion(); return; }
    state.selected = null;
    submitAnswer();
  }

  function nextQuestion() {
    if (!state.quiz) return;

    if (!state.locked) {
      submitAnswer(); // si no respondió, cuenta como omitida
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

    const total = state.quiz.infinite ? state.quiz.answers.length : state.quiz.questions.length;
    const { correct, wrong, blank, score, effectivePercent } = computeScore(state.quiz.answers, Math.max(1, total));

    updatePerQuestionStats(state.quiz.answers);

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
        <button id="btnRestart" class="btn primary" type="button">
          ${state.infinite ? 'Volver a infinito' : (state.mode === 'random' ? 'Nuevo test (20)' : 'Nuevo test (Bloque)')}
        </button>
      </div>
    `;

    const res = `
Modo: ${attempt.modeLabel}${attempt.mode === 'block' ? ` · ${attempt.blockLabel}` : ''}
\n\nCorrectas: ${correct} · Incorrectas: ${wrong} · Omitidas: ${blank}
\nPuntuación neta: ${score.toFixed(2)} / ${total} (fallo = −1/3)
\nPorcentaje: ${effectivePercent.toFixed(2)}%${extra}
\n\nTip: haz clic en un intento del historial para revisarlo.
    `.trim();

    setMathText($('#resText', el.quizBody), res);
    typesetMath(el.quizBody);

    const btn = $('#btnRestart', el.quizBody);
    if (btn) btn.addEventListener('click', startQuiz);
  }// =========================
  // Battery load
  // =========================
  function setPool(questions, saved = false) {
    state.pool = questions;
    rebuildPoolIndexAndBlocks();

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
      setPool(qs, true);
      if (el.btnLoadLast) el.btnLoadLast.disabled = false;
    };
    reader.onerror = () => alert('No he podido leer el archivo.');
    reader.readAsText(file, 'utf-8');
  }

  function loadLast() {
    const raw = localStorage.getItem(KEY_RAW);
    if (!raw) return alert('No hay batería guardada en este navegador.');
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
      setLibHint('⚠️ Si abres con doble click (file://), el navegador no deja leer archivos del proyecto. Ábrelo con un servidor local (p.ej. Live Server / python -m http.server).');
    } else {
      setLibHint('Carga baterías desde rutas del proyecto (configurable en LIB_SOURCES en app.js).');
    }
  }

  async function loadFromUrl(url, label) {
    if (!url) return;
    try {
      setPill(`Cargando… ${label ? label : ''}`.trim());
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();

      localStorage.setItem(KEY_RAW, raw);
      const qs = parseQuestionsFromTxt(raw);
      setPool(qs, true);

      if (el.btnLoadLast) el.btnLoadLast.disabled = false;
      if (label) setLibHint(`✅ Cargado: ${label}`);
    } catch (e) {
      console.error(e);
      setLibHint(`❌ No he podido leer: ${url}`);
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
      loadFromUrl(src.url, src.label || src.id);
    });
  }

  if (el.btnLibRefresh) {
    el.btnLibRefresh.addEventListener('click', () => {
      renderLibrarySelect();
    });
  }


  if (el.btnLoadLast) el.btnLoadLast.addEventListener('click', loadLast);
  if (el.btnStart) el.btnStart.addEventListener('click', startQuiz);
  if (el.btnSubmit) el.btnSubmit.addEventListener('click', submitAnswer);
  if (el.btnSkip) el.btnSkip.addEventListener('click', skipQuestion);
  if (el.btnNext) el.btnNext.addEventListener('click', nextQuestion);
  if (el.btnFinish) {
    el.btnFinish.addEventListener('click', () => {
      if (!state.quiz) return;
      if (!state.locked) submitAnswer();
      finishQuiz('Parado por el usuario');
    });
  }

  if (el.toggleContinuous) {
    el.toggleContinuous.addEventListener('change', () => {
      state.infinite = !!el.toggleContinuous.checked;
      savePrefs({ mode: state.mode, block: state.block, infinite: state.infinite });
      updateStartAvailability();
    });
  }

  if (el.modeSelect) {
    el.modeSelect.addEventListener('change', () => {
      state.mode = (el.modeSelect.value === 'block') ? 'block' : 'random';
      savePrefs({ mode: state.mode, block: state.block, infinite: state.infinite });
      updateStartAvailability();
      updateStartAvailability();
    });
  }

  if (el.blockSelect) {
    el.blockSelect.addEventListener('change', () => {
      state.block = el.blockSelect.value;
      savePrefs({ mode: state.mode, block: state.block, infinite: state.infinite });
      updateStartAvailability();
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
  // Init
  // =========================
  try { document.body.classList.remove('focus-quiz'); } catch (_) {}

  renderHistory();

  renderLibrarySelect();

  if (el.btnLoadLast) el.btnLoadLast.disabled = !localStorage.getItem(KEY_RAW);

  const prefs = loadPrefs();
  state.mode = (prefs.mode === 'block') ? 'block' : 'random';
  state.block = prefs.block || '';
  state.infinite = !!prefs.infinite || !!prefs.continuous;

  if (el.modeSelect) el.modeSelect.value = state.mode;
  if (el.blockSelect) el.blockSelect.value = state.block;
  if (el.toggleContinuous) el.toggleContinuous.checked = state.infinite;

  updateStartAvailability();
})();
