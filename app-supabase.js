// ============================================
// LinguaLift - Supabase-Powered Version
// Problems fetched from DB, cached locally, checkers rebuilt client-side
// ============================================

const SUPABASE_URL = "https://jlmbxmjeopycmikcpalr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsbWJ4bWplb3B5Y21pa2NwYWxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzQ4ODAsImV4cCI6MjA5MTg1MDg4MH0.A55QtmLMwsS43XEhJanh7Cw5s-F23oDQpBxFk5hR634";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// Problem Fetching & Caching
// ============================================

const CACHE_KEY = 'problems-cache';
const CACHE_TIME_KEY = 'problems-cache-time';
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

async function fetchProblems() {
  // 1. Try cache first
  const cached = localStorage.getItem(CACHE_KEY);
  const cacheTime = localStorage.getItem(CACHE_TIME_KEY);

  if (cached && cacheTime && Date.now() - Number(cacheTime) < CACHE_TTL) {
    console.log('[Cache] Using cached problems');
    const parsed = JSON.parse(cached);
    return parsed.map(p => transformProblemFromDB(p));
  }

  // 2. Fetch from Supabase
  console.log('[Supabase] Fetching problems...');
  const { data, error } = await supabaseClient
    .from('problems')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Supabase] Fetch failed:', error);
    // Fall back to stale cache
    if (cached) {
      console.log('[Cache] Falling back to stale cache');
      const parsed = JSON.parse(cached);
      return parsed.map(p => transformProblemFromDB(p));
    }
    return [];
  }

  // 3. Cache raw data (no functions)
  localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  localStorage.setItem(CACHE_TIME_KEY, String(Date.now()));

  // 4. Transform and return
  return data.map(p => transformProblemFromDB(p));
}

function transformProblemFromDB(row) {
  // Rebuild camelCase aliases for backward compatibility with existing UI
  const problem = {
    id: row.slug,
    slug: row.slug,
    mode: row.mode,
    type: row.type,
    title: row.title,
    contest: row.contest,
    label: row.label,
    year: row.year,
    topic: row.topic,
    difficulty: row.difficulty,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    prompt: row.prompt,
    hint: row.hint,
    solution: row.solution,
    answerKey: row.answer_key,
    matching: row.matching,
    datasets: row.datasets || [],
    translationTables: row.translation_tables,
    tasks: row.tasks,
    acceptableAnswers: row.acceptable_answers,
    // Attach the dynamic checker
    check: buildChecker(row),
    createdAt: row.created_at,
  };
  return problem;
}

// ============================================
// Checker Reconstruction (replaces stored functions)
// ============================================

function buildChecker(problem) {
  if (problem.mode === 'matching') {
    const key = (problem.answer_key || []).map(k => String(k).toUpperCase());
    return (selections) =>
      Array.isArray(selections) &&
      selections.length === key.length &&
      selections.every((s, i) => String(s || '').toUpperCase() === key[i]);
  }

  if (problem.mode === 'translation_table') {
    const tables = problem.translation_tables || [];
    return (inputs) => {
      // inputs: array of { tableIndex, rowIndex, value }
      let score = 0, total = 0;
      inputs.forEach(({ tableIndex, rowIndex, value }) => {
        const accepted = (tables[tableIndex]?.acceptable_answers?.[rowIndex] || [])
          .map(a => normalizeLoose(a));
        if (accepted.includes(normalizeLoose(value))) score++;
        total++;
      });
      return { correct: score === total, score, total };
    };
  }

  if (problem.mode === 'multi_task') {
    return (taskResults) => {
      let total = 0, score = 0;
      const tasks = problem.tasks || [];

      tasks.forEach((task, ti) => {
        const result = taskResults[ti];
        if (!result) return;

        if (task.mode === 'matching') {
          const key = (task.answer_key || []).map(k => String(k).toUpperCase());
          const sel = result.selections || [];
          let taskScore = 0;
          sel.forEach((s, i) => {
            if (String(s || '').toUpperCase() === key[i]) taskScore++;
          });
          score += taskScore;
          total += key.length;
        }

        if (task.mode === 'translation_table') {
          const tables = task.translation_tables || [];
          (result.inputs || []).forEach(({ tableIndex, rowIndex, value }) => {
            const accepted = (tables[tableIndex]?.acceptable_answers?.[rowIndex] || [])
              .map(a => normalizeLoose(a));
            if (accepted.includes(normalizeLoose(value))) score++;
            total++;
          });
        }
      });

      return { correct: score === total, score, total };
    };
  }

  // Fallback for text answers
  if (problem.acceptable_answers) {
    const normalized = problem.acceptable_answers.map(a => normalize(a));
    return (val) => normalized.includes(normalize(val));
  }

  return () => false;
}

function matchingChecker(answerKey) {
  const normalizedKey = answerKey.map((item) => item.toUpperCase());
  return (selections) =>
    Array.isArray(selections) &&
    selections.length === normalizedKey.length &&
    selections.every((item, index) => String(item || "").toUpperCase() === normalizedKey[index]);
}

function countCorrectMatches(answerKey, selections) {
  const normalizedKey = answerKey.map((item) => String(item).toUpperCase());
  if (!Array.isArray(selections)) return 0;

  return normalizedKey.reduce((total, correctAnswer, index) => {
    return total + (String(selections[index] || "").toUpperCase() === correctAnswer ? 1 : 0);
  }, 0);
}

function exactChecker(...answers) {
  const normalizedAnswers = answers.map((answer) => normalize(answer));
  return (value) => normalizedAnswers.includes(normalize(value));
}

// ============================================
// State & Storage
// ============================================

const storageKey = "lingualift-state-v4";
const defaultState = {
  attempts: [],
  bookmarks: [],
  reviewQueue: [],
  sprintRuns: [],
  history: [],
  activeBoard: "overall"
};

const seededOverall = [
  { name: "ME", score: 26, meta: "fdsa" },
  { name: "ME", score: 24, meta: "asfd" },
  { name: "ME", score: 22, meta: "safds" },
  { name: "ME", score: 20, meta: "asdf" }
];

const seededSprint = [
  { name: "ME", score: 220, meta: "best sprint board" },
  { name: "ME", score: 200, meta: "best sprint board" },
  { name: "ME", score: 190, meta: "best sprint board" },
  { name: "ME", score: 180, meta: "best sprint board" }
];

let problems = [];
let filteredProblems = [];
let currentProblem = null;
let currentReviewId = null;
let currentMatchSelections = [];
let sprintState = {
  active: false,
  timer: 180,
  round: 0,
  score: 0,
  order: [],
  intervalId: null
};

let state = loadState();

// ============================================
// DOM References
// ============================================

const emailInput = document.querySelector("#emailInput");
const passwordInput = document.querySelector("#passwordInput");
const signUpBtn = document.querySelector("#signUpBtn");
const signInBtn = document.querySelector("#signInBtn");
const signOutBtn = document.querySelector("#signOutBtn");
const authStatus = document.querySelector("#authStatus");
const problemScore = document.querySelector("#problemScore");
const contestFilter = document.querySelector("#contestFilter");
const topicFilter = document.querySelector("#topicFilter");
const difficultyFilter = document.querySelector("#difficultyFilter");
const entryTypeFilter = document.querySelector("#entryTypeFilter");
const sortFilter = document.querySelector("#sortFilter");
const activeFilterChips = document.querySelector("#activeFilterChips");
const problemList = document.querySelector("#problemList");
const problemCount = document.querySelector("#problemCount");
const nextProblemButton = document.querySelector("#nextProblemButton");
const problemMeta = document.querySelector("#problemMeta");
const problemTitle = document.querySelector("#problemTitle");
const problemDifficulty = document.querySelector("#problemDifficulty");
const problemPrompt = document.querySelector("#problemPrompt");
const sourceStrip = document.querySelector("#sourceStrip");
const sourceLabel = document.querySelector("#sourceLabel");
const sourceLink = document.querySelector("#sourceLink");
const problemDataset = document.querySelector("#problemDataset");
const matchingPanel = document.querySelector("#matchingPanel");
const matchingPrompts = document.querySelector("#matchingPrompts");
const matchingOptions = document.querySelector("#matchingOptions");
const matchingGrid = document.querySelector("#matchingGrid");
const textAnswerBlock = document.querySelector("#textAnswerBlock");
const answerInput = document.querySelector("#answerInput");
const checkAnswerButton = document.querySelector("#checkAnswerButton");
const showHintButton = document.querySelector("#showHintButton");
const showSolutionButton = document.querySelector("#showSolutionButton");
const hintCard = document.querySelector("#hintCard");
const resultCard = document.querySelector("#resultCard");
const solutionCard = document.querySelector("#solutionCard");
const bookmarkButton = document.querySelector("#bookmarkButton");
const statSolved = document.querySelector("#statSolved");
const statAccuracy = document.querySelector("#statAccuracy");
const statReview = document.querySelector("#statReview");
const statBest = document.querySelector("#statBest");
const historyCount = document.querySelector("#historyCount");
const historyList = document.querySelector("#historyList");
const reviewTitle = document.querySelector("#reviewTitle");
const reviewPrompt = document.querySelector("#reviewPrompt");
const reviewCount = document.querySelector("#reviewCount");
const reviewProblemButton = document.querySelector("#reviewProblemButton");
const clearReviewButton = document.querySelector("#clearReviewButton");
const sprintTimer = document.querySelector("#sprintTimer");
const sprintScore = document.querySelector("#sprintScore");
const sprintRound = document.querySelector("#sprintRound");
const sprintPrompt = document.querySelector("#sprintPrompt");
const sprintAnswer = document.querySelector("#sprintAnswer");
const startSprintButton = document.querySelector("#startSprintButton");
const submitSprintButton = document.querySelector("#submitSprintButton");
const sprintFeedback = document.querySelector("#sprintFeedback");
const leaderboardList = document.querySelector("#leaderboardList");
const boardButtons = [...document.querySelectorAll("[data-board]")];
const navButtons = [...document.querySelectorAll("[data-nav-target]")];
const translationTablePanel = document.querySelector("#translationTablePanel");
const translationTableWrap = document.querySelector("#translationTableWrap");

// ============================================
// Initialization
// ============================================

initialize();

async function initialize() {
  // Show loading state
  problemList.innerHTML = '<div class="feedback-card info">Loading problems...</div>';

  // Fetch problems from Supabase (or cache)
  problems = await fetchProblems();
  filteredProblems = [...problems];

  if (problems.length === 0) {
    problemList.innerHTML = '<div class="feedback-card error">Failed to load problems. Check your connection.</div>';
    return;
  }

  populateFilters();
  attachEvents();
  applyFilters();
  renderDashboard();
  renderHistory();
  renderReview();
  renderLeaderboards();
  updateAuthUI();

  supabaseClient.auth.onAuthStateChange(async () => {
    await updateAuthUI();
    await loadUserData();
  });
}

// ============================================
// Rendering
// ============================================

function renderDashboard() {
  const attempts = state.attempts;
  const solved = new Set(
    attempts
      .filter((attempt) => attempt.correct)
      .map((attempt) => attempt.problemId)
  ).size;

  const accuracy = attempts.length
    ? Math.round(
        (attempts.filter((attempt) => attempt.correct).length / attempts.length) * 100
      )
    : 0;

  const bestSprint = state.sprintRuns[0]?.score || 0;

  statSolved.textContent = String(solved);
  statAccuracy.textContent = `${accuracy}%`;
  statReview.textContent = String(state.reviewQueue.length);
  statBest.textContent = String(bestSprint);
}

function updateProblemScoreDisplay(score, total) {
  if (!problemScore) return;

  if (typeof score === "number" && typeof total === "number") {
    problemScore.textContent = `Score: ${score} / ${total}`;
  } else {
    problemScore.textContent = "Score: -";
  }
}

// ============================================
// Filters
// ============================================

function populateFilters() {
  contestFilter.innerHTML = ["All contests", ...new Set(problems.map((problem) => problem.contest))]
    .map(renderOption)
    .join("");

  topicFilter.innerHTML = ["All topics", ...new Set(problems.map((problem) => problem.topic))]
    .map(renderOption)
    .join("");

  difficultyFilter.innerHTML = ["All difficulties", 3, 4, 5]
    .map(renderOption)
    .join("");

  contestFilter.value = "All contests";
  topicFilter.value = "All topics";
  difficultyFilter.value = "All difficulties";
  entryTypeFilter.value = "All problems";
  sortFilter.value = "recommended";
}

function renderOption(value) {
  return `<option value="${value}">${value}</option>`;
}

function applyFilters() {
  const contest = contestFilter.value || "All contests";
  const topic = topicFilter.value || "All topics";
  const difficulty = difficultyFilter.value || "All difficulties";
  const type = entryTypeFilter.value || "All problems";
  const sort = sortFilter.value || "recommended";

  filteredProblems = problems.filter((problem) => {
    const matchesContest = contest === "All contests" || problem.contest === contest;
    const matchesTopic = topic === "All topics" || problem.topic === topic;
    const matchesDifficulty = difficulty === "All difficulties" || String(problem.difficulty) === String(difficulty);
    const matchesType = type === "All problems" || (problem.type || "adapted") === type;
    return matchesContest && matchesTopic && matchesDifficulty && matchesType;
  });

  filteredProblems.sort((left, right) => {
    if (sort === "difficulty") {
      return left.difficulty - right.difficulty || right.year - left.year;
    }
    if (sort === "latest") {
      return right.year - left.year || left.title.localeCompare(right.title);
    }
    if (sort === "title") {
      return left.title.localeCompare(right.title);
    }

    const leftMisses = getAttempts(left.id).filter((attempt) => !attempt.correct).length;
    const rightMisses = getAttempts(right.id).filter((attempt) => !attempt.correct).length;
    return rightMisses - leftMisses || right.year - left.year || left.title.localeCompare(right.title);
  });

  renderFilterChips();
  renderProblemList();

  if (!currentProblem || !filteredProblems.some((problem) => problem.id === currentProblem.id)) {
    selectProblem(filteredProblems[0] || null);
  } else {
    renderProblemList();
  }
}

function renderFilterChips() {
  const chips = [
    contestFilter.value,
    topicFilter.value,
    difficultyFilter.value,
    entryTypeFilter.options[entryTypeFilter.selectedIndex].textContent
  ];

  activeFilterChips.innerHTML = chips.map((chip) => `<span>${chip}</span>`).join("");
}

// ============================================
// Problem List
// ============================================

function renderProblemList() {
  problemCount.textContent = `${filteredProblems.length} problems`;

  if (!filteredProblems.length) {
    problemList.innerHTML = '<div class="feedback-card muted">No problems match this filter set yet.</div>';
    return;
  }

  problemList.innerHTML = filteredProblems.map((problem) => {
    const active = currentProblem?.id === problem.id ? "active" : "";
    const attempts = getAttempts(problem.id).length;
    return `
      <button class="problem-list-item ${active}" type="button" data-problem-id="${problem.id}">
        <strong>${problem.title}</strong>
        <p>${problem.contest} · ${problem.topic} · ${problem.year}</p>
        <span class="problem-kind">${problem.label} · ${attempts} attempt${attempts === 1 ? "" : "s"}</span>
      </button>
    `;
  }).join("");

  [...document.querySelectorAll("[data-problem-id]")].forEach((button) => {
    button.addEventListener("click", () => {
      const selected = problems.find((problem) => problem.id === button.dataset.problemId);
      selectProblem(selected);
    });
  });
}

function selectRandomProblem() {
  if (!filteredProblems.length) {
    return;
  }

  const pool = filteredProblems.filter((problem) => problem.id !== currentProblem?.id);
  const selected = pool.length ? randomItem(pool) : filteredProblems[0];
  selectProblem(selected);
}

function selectProblem(problem) {
  currentProblem = problem;
  currentMatchSelections = [];
  renderProblemList();
  answerInput.value = "";
  setFeedback(hintCard, "Hints appear here.", "muted");
  setFeedback(resultCard, "Checking feedback appears here.", "muted");
  setFeedback(solutionCard, "Worked solutions appear here.", "muted");
  matchingPanel.classList.add("hidden");
  translationTablePanel.classList.add("hidden");
  textAnswerBlock.classList.add("hidden");
  updateProblemScoreDisplay(null, null);

  if (!problem) {
    problemMeta.textContent = "Select a problem";
    problemTitle.textContent = "Your active workspace will appear here.";
    problemDifficulty.textContent = "-";
    problemPrompt.textContent = "Choose any item from the bank to start solving.";
    sourceStrip.classList.add("hidden");
    problemDataset.innerHTML = "";
    bookmarkButton.textContent = "☆";
    return;
  }

  pushHistory(problem.id);
  bookmarkButton.textContent = state.bookmarks.includes(problem.id) ? "★" : "☆";
  problemMeta.textContent = `${problem.label || "Problem"} · ${problem.contest} · ${problem.topic}`;
  problemTitle.textContent = problem.title;
  problemDifficulty.textContent = `${problem.mode} · ${problem.difficulty}`;
  problemPrompt.textContent = problem.prompt;
  problemDataset.innerHTML = (problem.datasets || []).map(renderDataset).join("");

  if (problem.sourceUrl) {
    sourceStrip.classList.remove("hidden");
    sourceLabel.textContent = `${problem.sourceName} · ${problem.year}`;
    sourceLink.href = problem.sourceUrl;
  } else {
    sourceStrip.classList.add("hidden");
  }

  if (problem.tasks) {
    renderProblemTasks(problem);
  } else if (problem.mode === "matching") {
    renderMatchingProblem(problem);
  } else if (problem.mode === "translation_table") {
    renderTranslationTable(problem);
  } else {
    textAnswerBlock.classList.remove("hidden");
  }

  renderHistory();
}

// ============================================
// Problem Rendering (Matching, Translation, Multi-Task)
// ============================================

function renderMatchingProblem(problem) {
  matchingPanel.classList.remove("hidden");
  textAnswerBlock.classList.add("hidden");
  matchingPrompts.innerHTML = problem.matching.prompts.map((item) => `<div class="match-item">${item}</div>`).join("");
  matchingOptions.innerHTML = problem.matching.options.map((item) => `<div class="match-item"><strong>${item.key}</strong> ${item.text}</div>`).join("");
  currentMatchSelections = new Array(problem.matching.prompts.length).fill("");

  matchingGrid.innerHTML = problem.matching.prompts.map((_, index) => {
    const options = ['<option value="">-</option>', ...problem.matching.options.map((item) => `<option value="${item.key}">${item.key}</option>`)].join("");
    return `
      <div class="match-select">
        <label for="match-${index}">Item ${index + 1}</label>
        <select id="match-${index}" data-match-index="${index}">${options}</select>
      </div>
    `;
  }).join("");

  [...matchingGrid.querySelectorAll("[data-match-index]")].forEach((select) => {
    select.addEventListener("change", () => {
      currentMatchSelections[Number(select.dataset.matchIndex)] = select.value;
      select.classList.remove("correct-select", "wrong-select");
    });
  });
}

function renderDataset(dataset) {
  return `
    <section class="dataset-card">
      <h4>${dataset.label}</h4>
      <table class="dataset-table">
        <thead>
          <tr>${dataset.headers.map((header) => `<th>${header}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${dataset.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderTranslationTable(problem) {
  const tables = getTranslationTables(problem);

  translationTablePanel.classList.remove("hidden");

  translationTableWrap.innerHTML = tables.map((table, tableIndex) => `
    <section class="dataset-card translation-task-card">
      <h4>${table.title || `Task ${tableIndex + 1}`}</h4>
      <p class="problem-copy">${table.prompt || ""}</p>
      <table class="dataset-table translation-input-table">
        <thead>
          <tr>
            ${table.headers.map((header) => `<th>${header}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${table.rows.map((row, rowIndex) => `
            <tr>
              <td>${row.label}</td>
              <td>${row.prompt}</td>
              <td>
                <input
                  type="text"
                  class="translation-input"
                  data-table-index="${tableIndex}"
                  data-row-index="${rowIndex}"
                  placeholder="Type your translation..."
                />
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `).join("");

  translationTableWrap.addEventListener("input", handleTranslationInputReset);
}

function getTranslationTables(problem) {
  if (Array.isArray(problem.translationTables) && problem.translationTables.length) {
    return problem.translationTables;
  }

  if (problem.translationTable) {
    return [
      {
        title: "Task 1",
        prompt: problem.prompt || "Complete the table.",
        headers: problem.translationTable.headers,
        rows: problem.translationTable.rows,
        acceptableAnswers: problem.acceptableAnswers || []
      }
    ];
  }

  return [];
}

function renderProblemTasks(problem) {
  matchingPanel.classList.add("hidden");
  translationTablePanel.classList.add("hidden");
  textAnswerBlock.classList.add("hidden");

  problemDataset.innerHTML = (problem.datasets || []).map(renderDataset).join("");

  problem.tasks.forEach((task, taskIndex) => {
    const taskCard = document.createElement("section");
    taskCard.className = "dataset-card";

    const title = document.createElement("h4");
    title.textContent = task.title || `Task ${taskIndex + 1}`;
    taskCard.appendChild(title);

    const prompt = document.createElement("p");
    prompt.className = "problem-copy";
    prompt.textContent = task.prompt || "";
    taskCard.appendChild(prompt);

    if (task.mode === "matching") {
      const matchingWrap = document.createElement("div");
      matchingWrap.className = "matching-task-block";

      const promptsHtml = task.matching.prompts
        .map((item) => `<div class="match-item">${item}</div>`)
        .join("");

      const optionsHtml = task.matching.options
        .map((item) => `<div class="match-item"><strong>${item.key}</strong> ${item.text}</div>`)
        .join("");

      const gridHtml = task.matching.prompts.map((_, index) => {
        const options = [
          '<option value="">-</option>',
          ...task.matching.options.map((item) => `<option value="${item.key}">${item.key}</option>`)
        ].join("");

        return `
          <div class="match-select">
            <label for="task-${taskIndex}-match-${index}">Item ${index + 1}</label>
            <select id="task-${taskIndex}-match-${index}" data-task-match-index="${taskIndex}-${index}">
              ${options}
            </select>
          </div>
        `;
      }).join("");

      matchingWrap.innerHTML = `
        <div class="matching-columns">
          <section class="match-card">
            <h4>Prompt Set</h4>
            <div class="match-list">${promptsHtml}</div>
          </section>
          <section class="match-card">
            <h4>Options</h4>
            <div class="match-list">${optionsHtml}</div>
          </section>
        </div>
        <div class="match-grid-wrap">
          <p class="problem-copy">Choose one letter for each numbered item.</p>
          <div class="matching-grid">${gridHtml}</div>
        </div>
      `;

      taskCard.appendChild(matchingWrap);

      task._selections = new Array(task.matching.prompts.length).fill("");

      matchingWrap.querySelectorAll("[data-task-match-index]").forEach((select) => {
        select.addEventListener("change", () => {
          const [, rowIndex] = select.dataset.taskMatchIndex.split("-").map(Number);
          task._selections[rowIndex] = select.value;
          select.classList.remove("correct-select", "wrong-select");
        });
      });
    }

    if (task.mode === "translation_table") {
      const tables = task.translationTables || [];

      tables.forEach((table, tableIndex) => {
        const tableWrap = document.createElement("div");
        tableWrap.className = "translation-task-card";

        tableWrap.innerHTML = `
          <p class="problem-copy">${table.prompt || ""}</p>
          <table class="dataset-table translation-input-table">
            <thead>
              <tr>
                ${table.headers.map((header) => `<th>${header}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${table.rows.map((row, rowIndex) => `
                <tr>
                  <td>${row.label}</td>
                  <td>${row.prompt}</td>
                  <td>
                    <input
                      type="text"
                      class="translation-input"
                      data-task="${taskIndex}"
                      data-table="${tableIndex}"
                      data-row="${rowIndex}"
                      placeholder="Type your translation..."
                    />
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `;

        taskCard.appendChild(tableWrap);
      });
    }

    problemDataset.appendChild(taskCard);
  });
}

function handleTranslationInputReset(event) {
  if (event.target.classList.contains("translation-input")) {
    event.target.classList.remove("correct-cell", "wrong-cell");
  }
}

// ============================================
// Answer Checking
// ============================================

function handleCheckAnswer() {
  if (currentProblem.tasks) {
    let total = 0;
    let score = 0;

    currentProblem.tasks.forEach((task, taskIndex) => {
      if (task.mode === "matching") {
        const selects = document.querySelectorAll(`[data-task-match-index^="${taskIndex}-"]`);
        const selections = [];

        selects.forEach((select, i) => {
          selections[i] = select.value;
        });

        if (selections.some(v => !v)) {
          setFeedback(resultCard, "Complete all matching items.", "error");
          return;
        }

        const correctAnswers = task.answerKey;

        selects.forEach((select, i) => {
          const user = selections[i];
          const correct = correctAnswers[i];

          select.classList.remove("correct-select", "wrong-select");

          if (user === correct) {
            score++;
            select.classList.add("correct-select");
          } else {
            select.classList.add("wrong-select");
          }

          total++;
        });
      }

      if (task.mode === "translation_table") {
        const inputs = document.querySelectorAll(`.translation-input[data-task="${taskIndex}"]`);

        inputs.forEach(input => {
          const tableIndex = Number(input.dataset.table);
          const rowIndex = Number(input.dataset.row);

          const answers =
            task.translationTables[tableIndex]
              .acceptableAnswers[rowIndex];

          const user = input.value.trim().toLowerCase();

          const correct = answers.some(a => a.toLowerCase() === user);

          input.classList.remove("correct-cell", "wrong-cell");

          if (correct) {
            score++;
            input.classList.add("correct-cell");
          } else {
            input.classList.add("wrong-cell");
          }

          total++;
        });
      }
    });

    updateProblemScoreDisplay(score, total);

    setFeedback(
      resultCard,
      `You scored ${score} / ${total}.`,
      score === total ? "success" : "error"
    );

    // Record attempt
    state.attempts.unshift({
      id: crypto.randomUUID(),
      problemId: currentProblem.id,
      correct: score === total,
      answer: `Multi-task: ${score}/${total}`,
      score,
      total,
      timestamp: Date.now()
    });

    if (score === total) {
      removeFromReview(currentProblem.id);
      removeReviewItemFromCloud(currentProblem.id);
    } else {
      pushToReview(currentProblem.id);
      saveReviewItemToCloud(currentProblem.id);
    }

    persistState();
    renderDashboard();
    renderReview();
    renderLeaderboards();
    renderProblemList();
    saveAttemptToCloud(state.attempts[0]);

    return;
  }

  if (!currentProblem) {
    return;
  }

  let correct = false;
  let answerValue = "";
  let score = null;
  let total = null;

  if (currentProblem.mode === "matching") {
    if (currentMatchSelections.some((item) => !item)) {
      setFeedback(resultCard, "Complete each match slot before checking.", "error");
      return;
    }

    answerValue = currentMatchSelections.join("");
    total = currentProblem.answerKey.length;
    score = countCorrectMatches(currentProblem.answerKey, currentMatchSelections);
    correct = score === total;

    const selects = [...document.querySelectorAll("[data-match-index]")];

    selects.forEach((select, index) => {
      const user = currentMatchSelections[index];
      const correctAnswer = currentProblem.answerKey[index];

      select.classList.remove("correct-select", "wrong-select");

      if (user === correctAnswer) {
        select.classList.add("correct-select");
      } else {
        select.classList.add("wrong-select");
      }
    });

    updateProblemScoreDisplay(score, total);
  } else if (currentProblem.mode === "translation_table") {
    const inputs = [...document.querySelectorAll(".translation-input")];

    if (inputs.some((input) => !input.value.trim())) {
      setFeedback(resultCard, "Complete each table row before checking.", "error");
      return;
    }

    const tableResult = checkTranslationTable(currentProblem);
    correct = tableResult.correct;
    score = tableResult.score;
    total = tableResult.total;
    answerValue = tableResult.results.map((item) => item.userAnswer);
    updateProblemScoreDisplay(score, total);
  } else {
    const answer = answerInput.value.trim();
    if (!answer) {
      setFeedback(resultCard, "Add an answer first so the problem can be checked.", "error");
      return;
    }

    answerValue = answer;
    correct = currentProblem.check(answer);
    score = correct ? 1 : 0;
    total = 1;
    updateProblemScoreDisplay(score, total);
  }

  state.attempts.unshift({
    id: crypto.randomUUID(),
    problemId: currentProblem.id,
    correct,
    answer: answerValue,
    score,
    total,
    timestamp: Date.now()
  });

  if (correct) {
    removeFromReview(currentProblem.id);
    removeReviewItemFromCloud(currentProblem.id);
    setFeedback(resultCard, `Correct. You scored ${score} / ${total}.`, "success");
  } else {
    pushToReview(currentProblem.id);
    saveReviewItemToCloud(currentProblem.id);
    setFeedback(resultCard, `You scored ${score} / ${total}. Incorrect parts are highlighted.`, "error");
  }

  persistState();
  renderDashboard();
  renderReview();
  renderLeaderboards();
  renderProblemList();
  saveAttemptToCloud(state.attempts[0]);
}

function checkTranslationTable(problem) {
  const tables = getTranslationTables(problem);
  const inputs = [...document.querySelectorAll(".translation-input")];

  const results = [];
  let score = 0;
  let total = 0;

  inputs.forEach((input) => {
    const tableIndex = Number(input.dataset.tableIndex);
    const rowIndex = Number(input.dataset.rowIndex);

    const accepted = (tables[tableIndex]?.acceptableAnswers?.[rowIndex] || []).map(normalizeLoose);
    const userAnswer = normalizeLoose(input.value);
    const isCorrect = accepted.includes(userAnswer);

    input.classList.remove("correct-cell", "wrong-cell");

    if (isCorrect) {
      input.classList.add("correct-cell");
      score += 1;
    } else {
      input.classList.add("wrong-cell");
    }

    total += 1;

    results.push({
      tableIndex,
      rowIndex,
      userAnswer: input.value,
      correct: isCorrect
    });
  });

  return {
    score,
    total,
    correct: score === total,
    results
  };
}

// ============================================
// Bookmarks & Review
// ============================================

function toggleBookmark() {
  if (!currentProblem) return;

  const id = currentProblem.id;
  const isBookmarked = state.bookmarks.includes(id);

  if (isBookmarked) {
    state.bookmarks = state.bookmarks.filter((item) => item !== id);
    removeFromReview(id);
    removeBookmarkFromCloud(id);
    removeReviewItemFromCloud(id);
  } else {
    state.bookmarks.push(id);
    pushToReview(id);
    saveBookmarkToCloud(id);
    saveReviewItemToCloud(id);
  }

  bookmarkButton.textContent = state.bookmarks.includes(id) ? "★" : "☆";

  persistState();
  renderReview();
  renderDashboard();
}

function pushToReview(problemId) {
  if (!state.reviewQueue.includes(problemId)) {
    state.reviewQueue.push(problemId);
  }
}

function removeFromReview(problemId) {
  state.reviewQueue = state.reviewQueue.filter((id) => id !== problemId);
}

function renderReview() {
  const queued = state.reviewQueue
    .map((id) => problems.find((problem) => problem.id === id))
    .filter(Boolean);

  reviewCount.textContent = `${queued.length} queued`;

  if (!queued.length) {
    reviewTitle.textContent = "Nothing queued yet";
    reviewPrompt.textContent = "Miss a problem or bookmark one to keep it here.";
    currentReviewId = null;
    return;
  }

  const next = queued[0];
  currentReviewId = next.id;
  reviewTitle.textContent = next.title;
  reviewPrompt.textContent = `${next.contest} · ${next.topic} · difficulty ${next.difficulty}`;
}

function openReviewProblem() {
  if (!currentReviewId) {
    return;
  }
  const problem = problems.find((item) => item.id === currentReviewId);
  selectProblem(problem);
}

function clearReviewQueue() {
  state.reviewQueue = [];
  persistState();
  renderDashboard();
  renderReview();
}

// ============================================
// History
// ============================================

function renderHistory() {
  const items = state.history
    .map((id) => problems.find((problem) => problem.id === id))
    .filter(Boolean)
    .slice(0, 6);

  historyCount.textContent = `${items.length} items`;

  if (!items.length) {
    historyList.innerHTML = '<div class="feedback-card muted">Your recently opened problems will appear here.</div>';
    return;
  }

  historyList.innerHTML = items.map((problem) => `
    <article class="history-item">
      <strong>${problem.title}</strong>
      <p>${problem.contest} · ${problem.year}</p>
    </article>
  `).join("");
}

function pushHistory(problemId) {
  state.history = [problemId, ...state.history.filter((id) => id !== problemId)].slice(0, 8);
  persistState();
}

// ============================================
// Sprint
// ============================================

function startSprint() {
  if (sprintState.active) {
    return;
  }

  // Only include problems with a valid check function (no multi-task for now)
  const sprintable = filteredProblems.filter(p => p.check && !p.tasks && p.mode !== "multi_task");

  if (!sprintable.length) {
    setFeedback(sprintFeedback, "No compatible problems match the current filters.", "error");
    return;
  }

  sprintState = {
    active: true,
    timer: 180,
    round: 1,
    score: 0,
    order: shuffle([...sprintable]).slice(0, Math.min(5, sprintable.length)),
    intervalId: window.setInterval(tickSprint, 1000)
  };

  sprintAnswer.value = "";
  loadSprintProblem();
  renderSprintStatus();
  setFeedback(sprintFeedback, "Sprint started. Use compact answers like letter strings or short forms.", "info");
}

function tickSprint() {
  sprintState.timer -= 1;
  renderSprintStatus();
  if (sprintState.timer <= 0) {
    finishSprint();
  }
}

function loadSprintProblem() {
  const problem = sprintState.order[sprintState.round - 1];
  if (!problem) {
    translationTablePanel.classList.add("hidden");
    finishSprint();
    return;
  }

  sprintPrompt.textContent = `${problem.title}: ${problem.mode === "matching" ? `enter the answer pattern, e.g. ${problem.answerKey.map((_, index) => `${index + 1}=A`).join(", ")}` : problem.prompt}`;
}

function submitSprintAnswer() {
  if (!sprintState.active) {
    setFeedback(sprintFeedback, "Start a sprint before submitting.", "error");
    return;
  }

  const problem = sprintState.order[sprintState.round - 1];
  const raw = sprintAnswer.value.trim();

  if (!raw) {
    setFeedback(sprintFeedback, "Type an answer before submitting this round.", "error");
    return;
  }

  let correct = false;
  if (problem.mode === "matching") {
    const parsed = raw
      .replace(/[^A-Za-z]/g, "")
      .toUpperCase()
      .split("");
    correct = problem.check(parsed);
  } else {
    correct = problem.check(raw);
  }

  const points = problem.difficulty * 10;
  if (correct) {
    sprintState.score += points;
    setFeedback(sprintFeedback, `Correct. +${points} points.`, "success");
  } else {
    const expected = problem.mode === "matching" ? problem.answerKey.join("") : (problem.acceptableAnswers?.[0] || "see solution");
    setFeedback(sprintFeedback, `Incorrect. Expected ${expected}.`, "error");
  }

  sprintState.round += 1;
  sprintAnswer.value = "";

  if (sprintState.round > sprintState.order.length) {
    finishSprint();
    return;
  }

  loadSprintProblem();
  renderSprintStatus();
}

function finishSprint() {
  const finalScore = sprintState.score;
  if (sprintState.intervalId) {
    window.clearInterval(sprintState.intervalId);
  }

  if (sprintState.active) {
    state.sprintRuns.push({
      id: crypto.randomUUID(),
      score: finalScore,
      completedAt: Date.now()
    });
    state.sprintRuns.sort((left, right) => right.score - left.score || right.completedAt - left.completedAt);
    state.sprintRuns = state.sprintRuns.slice(0, 8);
    persistState();
  }

  sprintState = {
    active: false,
    timer: 180,
    round: 0,
    score: 0,
    order: [],
    intervalId: null
  };

  renderSprintStatus();
  renderDashboard();
  renderLeaderboards();
  sprintPrompt.textContent = "Run a five-question timed set built from the current archive bank.";
  setFeedback(sprintFeedback, `Sprint finished with ${finalScore} points.`, "info");
}

function renderSprintStatus() {
  sprintTimer.textContent = formatTime(sprintState.timer);
  sprintScore.textContent = String(sprintState.score);
  sprintRound.textContent = `${Math.min(sprintState.round, 5)} / 5`;
}

// ============================================
// Leaderboards
// ============================================

function renderLeaderboards() {
  boardButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.board === state.activeBoard);
  });

  const boardEntries = state.activeBoard === "overall" ? buildOverallBoard() : buildSprintBoard();
  leaderboardList.innerHTML = boardEntries.map((entry, index) => `
    <article class="leaderboard-entry ${entry.me ? "me" : ""}">
      <div>
        <span class="leaderboard-rank">#${index + 1}</span>
        <strong>${entry.name}</strong>
        <p>${entry.meta}</p>
      </div>
      <strong>${entry.score}</strong>
    </article>
  `).join("");
}

function buildOverallBoard() {
  const solvedCount = new Set(state.attempts.filter((attempt) => attempt.correct).map((attempt) => attempt.problemId)).size;
  const accuracy = state.attempts.length ? Math.round((state.attempts.filter((attempt) => attempt.correct).length / state.attempts.length) * 100) : 0;
  const yourEntry = {
    name: "You",
    score: solvedCount,
    meta: `${accuracy}% accuracy · ${state.attempts.length} attempts`,
    me: true
  };

  return [...seededOverall, yourEntry]
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 5);
}

function buildSprintBoard() {
  const yourEntry = {
    name: "You",
    score: state.sprintRuns[0]?.score || 0,
    meta: state.sprintRuns.length ? "best local sprint" : "no sprint runs yet",
    me: true
  };

  return [...seededSprint, yourEntry]
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 5);
}

// ============================================
// Events
// ============================================

function attachEvents() {
  [contestFilter, topicFilter, difficultyFilter, entryTypeFilter, sortFilter].forEach((element) => {
    element.addEventListener("change", applyFilters);
  });

  nextProblemButton.addEventListener("click", selectRandomProblem);
  checkAnswerButton.addEventListener("click", handleCheckAnswer);
  showHintButton.addEventListener("click", () => currentProblem && setFeedback(hintCard, currentProblem.hint, "info"));
  showSolutionButton.addEventListener("click", () => currentProblem && setFeedback(solutionCard, currentProblem.solution, "info"));
  bookmarkButton.addEventListener("click", toggleBookmark);
  reviewProblemButton.addEventListener("click", openReviewProblem);
  clearReviewButton.addEventListener("click", clearReviewQueue);
  startSprintButton.addEventListener("click", startSprint);
  submitSprintButton.addEventListener("click", submitSprintAnswer);

  boardButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeBoard = button.dataset.board;
      persistState();
      renderLeaderboards();
    });
  });

  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      navButtons.forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.navTarget)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  signUpBtn.addEventListener("click", async () => {
    try {
      await signUp(emailInput.value.trim(), passwordInput.value);
      authStatus.textContent = "Account created. Check your email if confirmation is enabled.";
      await updateAuthUI();
      await loadUserData();
    } catch (error) {
      authStatus.textContent = error.message;
    }
  });

  signInBtn.addEventListener("click", async () => {
    try {
      await signIn(emailInput.value.trim(), passwordInput.value);
      authStatus.textContent = "Logged in.";
      await updateAuthUI();
      await loadUserData();
    } catch (error) {
      authStatus.textContent = error.message;
    }
  });

  signOutBtn.addEventListener("click", async () => {
    try {
      await signOut();
      authStatus.textContent = "Logged out.";
      state.bookmarks = [];
      state.reviewQueue = [];
      persistState();
      renderDashboard();
      renderReview();
      renderProblemList();
    } catch (error) {
      authStatus.textContent = error.message;
    }
  });
}

// ============================================
// Auth
// ============================================

async function signUp(email, password) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password
  });
  if (error) throw error;
  return data;
}

async function signIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  return data;
}

async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) throw error;
}

async function getCurrentUser() {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error) throw error;
  return data.user;
}

async function updateAuthUI() {
  try {
    const user = await getCurrentUser();
    authStatus.textContent = user
      ? `Signed in as ${user.email}`
      : "Not signed in.";
  } catch (error) {
    authStatus.textContent = "Auth status unavailable.";
  }
}

async function loadUserData() {
  const user = await getCurrentUser();
  if (!user) return;

  const [{ data: bookmarks }, { data: reviewQueue }] = await Promise.all([
    supabaseClient
      .from("bookmarks")
      .select("problem_id")
      .eq("user_id", user.id),
    supabaseClient
      .from("review_queue")
      .select("problem_id")
      .eq("user_id", user.id)
  ]);

  state.bookmarks = (bookmarks || []).map(row => row.problem_id);
  state.reviewQueue = (reviewQueue || []).map(row => row.problem_id);

  persistState();
  renderDashboard();
  renderReview();

  if (currentProblem) {
    bookmarkButton.textContent = state.bookmarks.includes(currentProblem.id) ? "★" : "☆";
  }
}

// ============================================
// Cloud Sync
// ============================================

async function saveBookmarkToCloud(problemId) {
  const user = await getCurrentUser();
  if (!user) return;

  await supabaseClient.from("bookmarks").upsert({
    user_id: user.id,
    problem_id: problemId
  });
}

async function removeBookmarkFromCloud(problemId) {
  const user = await getCurrentUser();
  if (!user) return;

  await supabaseClient
    .from("bookmarks")
    .delete()
    .eq("user_id", user.id)
    .eq("problem_id", problemId);
}

async function saveReviewItemToCloud(problemId) {
  const user = await getCurrentUser();
  if (!user) return;

  await supabaseClient.from("review_queue").upsert({
    user_id: user.id,
    problem_id: problemId
  });
}

async function removeReviewItemFromCloud(problemId) {
  const user = await getCurrentUser();
  if (!user) return;

  await supabaseClient
    .from("review_queue")
    .delete()
    .eq("user_id", user.id)
    .eq("problem_id", problemId);
}

async function saveAttemptToCloud(attempt) {
  const user = await getCurrentUser();
  if (!user) return;

  await supabaseClient.from("attempts").insert({
    user_id: user.id,
    problem_id: attempt.problemId,
    correct: attempt.correct,
    answer: attempt.answer,
    score: attempt.score ?? null,
    total: attempt.total ?? null
  });
}

// ============================================
// Utilities
// ============================================

function getAttempts(problemId) {
  return state.attempts.filter((attempt) => attempt.problemId === problemId);
}

function setFeedback(element, text, tone) {
  element.textContent = text;
  element.className = `feedback-card ${tone}`;
}

function loadState() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey));
    return parsed ? { ...defaultState, ...parsed } : { ...defaultState };
  } catch (error) {
    return { ...defaultState };
  }
}

function persistState() {
  window.localStorage.setItem(storageKey, JSON.stringify(state));
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle(items) {
  const clone = [...items];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }
  return clone;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function normalize(value) {
  return value.toLowerCase().trim().replace(/\s+/g, " ").replace(/[^\p{L}\p{N}\-?]+/gu, "");
}

function normalizeLoose(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ");
}
