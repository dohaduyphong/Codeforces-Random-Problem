const API = "https://codeforces.com/api";
// Bump the version when the cached problem shape changes.
const CACHE_KEY = "cfrp:problems:v2";
const SETTINGS_KEY = "cfrp:settings";
const HISTORY_KEY = "cfrp:history";
const THEME_KEY = "cfrp:theme";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const HISTORY_LIMIT = 10;

const $ = (id) => document.getElementById(id);

let problems = [];
let history = storageGet(HISTORY_KEY) ?? [];
const solvedByHandle = new Map();

function storageGet(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked; everything still works without it.
  }
}

async function api(method, params = {}) {
  let res;
  try {
    res = await fetch(`${API}/${method}?${new URLSearchParams(params)}`);
  } catch {
    throw new Error("Couldn't reach Codeforces. Check your connection and try again.");
  }
  // Codeforces sends a JSON body with a `comment` even on 4xx (e.g. unknown handle).
  const data = await res.json().catch(() => null);
  if (!data) throw new Error(`Codeforces returned HTTP ${res.status}. Try again in a moment.`);
  if (data.status !== "OK") throw new Error(data.comment || "Codeforces API error.");
  return data.result;
}

const problemKey = (p) => `${p.contestId}${p.index}`;
const problemUrl = (p) => `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`;

const DIVISION_LABELS = {
  div1: "Div. 1",
  div2: "Div. 2",
  div3: "Div. 3",
  div4: "Div. 4",
  div12: "Div. 1 + 2",
  edu: "Educational",
  global: "Global",
  other: "Other",
};

// Order matters: Educational names say "Rated for Div. 2", combined rounds mention both divs.
function contestDivision(name) {
  if (/Educational/i.test(name)) return "edu";
  if (/Div\.\s*1\s*\+\s*(Div\.\s*)?2/i.test(name) || /^(Hello|Good Bye) \d{4}/.test(name)) return "div12";
  if (/Global Round/i.test(name)) return "global";
  if (/Div\.\s*1\b/i.test(name)) return "div1";
  if (/Div\.\s*2\b/i.test(name)) return "div2";
  if (/Div\.\s*3\b/i.test(name)) return "div3";
  if (/Div\.\s*4\b/i.test(name)) return "div4";
  return "other";
}

async function loadProblems() {
  const cached = storageGet(CACHE_KEY);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.problems;

  const [{ problems: raw, problemStatistics }, contests] = await Promise.all([
    api("problemset.problems"),
    api("contest.list", { gym: false }),
  ]);
  const solvedCount = new Map(problemStatistics.map((s) => [problemKey(s), s.solvedCount]));
  const division = new Map(contests.map((c) => [c.id, contestDivision(c.name)]));
  const list = raw
    .filter((p) => p.rating)
    .map((p) => ({
      contestId: p.contestId,
      index: p.index,
      name: p.name,
      rating: p.rating,
      tags: p.tags,
      solvedCount: solvedCount.get(problemKey(p)) ?? 0,
      division: division.get(p.contestId) ?? "other",
    }));
  storageSet(CACHE_KEY, { time: Date.now(), problems: list });
  return list;
}

async function loadSolved(handle) {
  const key = handle.toLowerCase();
  if (!solvedByHandle.has(key)) {
    let submissions;
    try {
      submissions = await api("user.status", { handle });
    } catch (err) {
      if (/not found/i.test(err.message)) {
        throw new Error(`No Codeforces user named "${handle}". Check the spelling, or clear the handle.`);
      }
      throw err;
    }
    const solved = new Set(
      submissions.filter((s) => s.verdict === "OK").map((s) => problemKey(s.problem)),
    );
    solvedByHandle.set(key, solved);
  }
  return solvedByHandle.get(key);
}

// Codeforces rank tiers; the colors live in style.css so each theme can tune them.
function rankTier(rating) {
  if (rating < 1200) return "newbie";
  if (rating < 1400) return "pupil";
  if (rating < 1600) return "specialist";
  if (rating < 1900) return "expert";
  if (rating < 2100) return "cm";
  if (rating < 2400) return "master";
  return "gm";
}

function setResultVisible(visible) {
  $("result").hidden = !visible;
  $("empty").hidden = visible;
}

function setStatus(message, isError = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", isError);
}

function checkedValues(container) {
  return [...container.querySelectorAll("input:checked")].map((input) => input.value);
}

const selectedTags = () => checkedValues($("tags"));
const selectedDivisions = () => checkedValues($("divisions"));

function updateTagCount() {
  const count = selectedTags().length;
  $("tag-count").textContent = count ? `(${count} selected)` : "";
}

function renderTagPicker(selected) {
  const allTags = [...new Set(problems.flatMap((p) => p.tags))].sort();
  $("tags").replaceChildren(
    ...allTags.map((tag) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = tag;
      input.checked = selected.includes(tag);
      label.append(input, tag);
      return label;
    }),
  );
  updateTagCount();
}

function saveSettings() {
  storageSet(SETTINGS_KEY, {
    min: $("min").value,
    max: $("max").value,
    handle: $("handle").value.trim(),
    tags: selectedTags(),
    divisions: selectedDivisions(),
    shortcut: $("shortcut").checked,
  });
}

function showProblem(p) {
  $("p-id").textContent = `${problemKey(p)} · ${DIVISION_LABELS[p.division]}`;
  $("p-rating").textContent = p.rating;
  $("p-rating").dataset.rank = rankTier(p.rating);
  $("p-link").textContent = p.name;
  $("p-link").href = problemUrl(p);
  $("p-solved").textContent = `Solved by ${p.solvedCount.toLocaleString()} people`;
  $("p-tags").replaceChildren(
    ...(p.tags.length ? p.tags : ["no tags"]).map((tag) => {
      const li = document.createElement("li");
      li.textContent = tag;
      return li;
    }),
  );
  $("result").querySelector("details").open = false;
  setResultVisible(true);
  // On one-column layouts the card sits below the filters; bring it on screen.
  const box = $("result").getBoundingClientRect();
  if (box.top < 0 || box.bottom > window.innerHeight) {
    $("result").scrollIntoView({ block: "nearest" });
  }
}

function renderHistory() {
  $("history-section").hidden = history.length === 0;
  $("history").replaceChildren(
    ...history.map((p) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = problemUrl(p);
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = `${problemKey(p)} · ${p.name}`;
      const rating = document.createElement("span");
      rating.className = "muted";
      rating.textContent = ` (${p.rating})`;
      li.append(a, rating);
      return li;
    }),
  );
}

function pushHistory(p) {
  history = [p, ...history.filter((h) => problemKey(h) !== problemKey(p))].slice(0, HISTORY_LIMIT);
  storageSet(HISTORY_KEY, history);
  renderHistory();
}

async function roll(event) {
  event.preventDefault();
  let min = Number($("min").value);
  let max = Number($("max").value);
  if (min > max) {
    [min, max] = [max, min];
    $("min").value = min;
    $("max").value = max;
  }
  const handle = $("handle").value.trim();
  const tags = selectedTags();
  const divisions = new Set(selectedDivisions());
  saveSettings();

  $("roll").disabled = true;
  try {
    if (handle && !solvedByHandle.has(handle.toLowerCase())) {
      setStatus(`Fetching ${handle}'s submissions…`);
    }
    const solved = handle ? await loadSolved(handle) : new Set();
    const pool = problems.filter(
      (p) =>
        p.rating >= min &&
        p.rating <= max &&
        (divisions.size === 0 || divisions.has(p.division)) &&
        tags.every((t) => p.tags.includes(t)) &&
        !solved.has(problemKey(p)),
    );
    if (pool.length === 0) {
      setResultVisible(false);
      setStatus("No problems match these filters. Widen the rating range or drop some tags or contest types.");
      return;
    }
    // Avoid repeating a recent pick unless that's all that's left.
    const recent = new Set(history.map(problemKey));
    const fresh = pool.filter((p) => !recent.has(problemKey(p)));
    const candidates = fresh.length ? fresh : pool;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    showProblem(pick);
    pushHistory(pick);
    setStatus(`${pool.length.toLocaleString()} problems match.`);
  } catch (err) {
    // Hide the previous pick so it isn't mistaken for the result of this roll.
    setResultVisible(false);
    setStatus(err.message, true);
  } finally {
    $("roll").disabled = false;
  }
}

async function loadAndStart(selectedTagsToRestore) {
  $("retry").hidden = true;
  setStatus("Loading problemset…");
  try {
    problems = await loadProblems();
    renderTagPicker(selectedTagsToRestore);
    setStatus(`${problems.length.toLocaleString()} rated problems loaded.`);
    $("roll").disabled = false;
  } catch (err) {
    setStatus(`Couldn't load problems. ${err.message}`, true);
    $("retry").hidden = false;
  }
}

function currentTheme() {
  return document.documentElement.dataset.theme ??
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function renderThemeToggle() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  $("theme-toggle").textContent = `Switch to ${next}`;
}

async function init() {
  const settings = storageGet(SETTINGS_KEY) ?? {};
  if (settings.min) $("min").value = settings.min;
  if (settings.max) $("max").value = settings.max;
  if (settings.handle) $("handle").value = settings.handle;
  const savedDivisions = settings.divisions ?? [];
  $("divisions").querySelectorAll("input").forEach((input) => {
    input.checked = savedDivisions.includes(input.value);
  });
  $("shortcut").checked = settings.shortcut ?? true;
  renderHistory();
  renderThemeToggle();

  $("filters").addEventListener("submit", roll);
  $("divisions").addEventListener("change", saveSettings);
  $("shortcut").addEventListener("change", saveSettings);
  // The tag chips don't exist until a load succeeds, so restore tags from storage.
  $("retry").addEventListener("click", () => loadAndStart(storageGet(SETTINGS_KEY)?.tags ?? []));
  $("theme-toggle").addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    storageSet(THEME_KEY, next);
    renderThemeToggle();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderThemeToggle);
  document.addEventListener("keydown", (event) => {
    // Single-key shortcuts must be switchable off (WCAG 2.1.4).
    if (!$("shortcut").checked) return;
    if (event.key.toLowerCase() !== "r" || event.metaKey || event.ctrlKey || event.altKey) return;
    // Don't hijack typing in the rating or handle fields.
    if (event.target.matches("input[type=text], input[type=number]")) return;
    if ($("roll").disabled) return;
    event.preventDefault();
    $("filters").requestSubmit();
  });
  $("tags").addEventListener("change", () => {
    updateTagCount();
    saveSettings();
  });
  $("clear-tags").addEventListener("click", () => {
    $("tags").querySelectorAll("input:checked").forEach((input) => (input.checked = false));
    updateTagCount();
    saveSettings();
  });

  await loadAndStart(settings.tags ?? []);
}

init();
