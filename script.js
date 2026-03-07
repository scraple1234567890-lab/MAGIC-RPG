(function () {
  const root = document.documentElement;
  const navToggle = document.getElementById("navToggle");
  const navLinks = document.getElementById("navLinks");
  const profileMenu = document.getElementById("profileMenu");
  const profileToggle = document.getElementById("profileMenuToggle");
  const profileMenuList = document.getElementById("profileMenuList");
  const loginButtons = Array.from(document.querySelectorAll('[data-auth-target="login-cta"]'));
  const loreFeeds = Array.from(document.querySelectorAll("[data-lore-feed]"));
  const loreComposerForm = document.getElementById("loreComposerForm");
  const loreComposerStatus = document.getElementById("loreComposerStatus");
  const LOCAL_LORE_KEY = "userLorePosts";
  const LOGIN_STATE_KEY = "auth:isLoggedIn";
  const DATA_POSTS_URL = "./data/posts.json";
  const header = document.querySelector(".header");

  const loreAuthors = ["Archivist Mira", "Keeper Iden", "Cantor Lysa", "Essence Steward", "Field Mentor Ryn", "Constellation Scribe Ixa"];
  const loreSchools = ["Touch", "Sight", "Sound", "Essence", "Cross-House", "Archival Wing"];
  const loreEvents = [
    {
      moment: "before dawn drills on the east battlements",
      incident: "a stray sigil sparked against the frost",
      detail: "the pattern matched an unfinished star map tucked under the rail.",
    },
    {
      moment: "during a midnight patrol",
      incident: "an unmarked lantern kept relighting itself in the rain",
      detail: "each flare sang the first bar of an old choir cadence.",
    },
    {
      moment: "at the third bell in the infirmary hallway",
      incident: "fresh ward chalk appeared over the door hinges",
      detail: "it smelled faintly of cinnamon ink—warm, precise, and protective.",
    },
    {
      moment: "while the observatory shutters were closed",
      incident: "light still traced the constellation of the Serpent Choir",
      detail: "no lenses were open; the glow echoed against copper pipes like a breath.",
    },
    {
      moment: "right after curfew checks",
      incident: "the southern wind carried pages of a practice journal into the courtyard",
      detail: "every page was stamped with thumbprints of salt and juniper oil.",
    },
    {
      moment: "as the refectory fires dimmed",
      incident: "a quiet humming rose from the speaking tubes",
      detail: "it harmonized with heartbeats, then faded when listeners steadied their breaths.",
    },
  ];
  const loreReactions = [
    "Students nearby felt the air tighten, then soften, as if invited to listen.",
    "Mentors traced the echoes and logged the finding for tonight's roundtable.",
    "Apprentices chalked the outline to study, noting the cadence never repeated twice.",
    "The hall monitors sealed the note under glass, convinced it was purposeful.",
    "Someone left a brass compass beside it, suggesting the act was deliberate, not accidental.",
    "The sensation lingered long after, like warmth left in stone steps.",
  ];

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Set a consistent theme (no toggle needed for this landing page)
  root.setAttribute("data-theme", "light");

  // Mobile nav
  function setNavOpen(open) {
    navLinks.classList.toggle("open", open);
    navToggle.setAttribute("aria-expanded", String(open));
  }

  navToggle?.addEventListener("click", () => {
    const open = !navLinks.classList.contains("open");
    setNavOpen(open);
    if (!open) {
      closeProfileMenu();
    }
  });

  // Close menu after clicking a link (mobile)
// Note: on some browsers, hiding the menu *during* the click can cancel navigation.
// We close the menu on the next tick for cross-page links.
navLinks?.addEventListener("click", (e) => {
  if (!navLinks.classList.contains("open")) return;
  if (!(e.target instanceof HTMLElement)) return;

  const actionEl = e.target.closest("a, button");
  if (!actionEl) return;

  const closeNow = () => {
    setNavOpen(false);
    closeProfileMenu();
  };

  if (actionEl.tagName === "A") {
    const href = actionEl.getAttribute("href") || "";
    if (href.startsWith("#")) {
      closeNow();
    } else {
      window.setTimeout(closeNow, 0);
    }
    return;
  }

  closeNow();
});

  function setProfileMenuOpen(open) {
    if (!(profileMenu instanceof HTMLElement)) return;
    profileMenu.classList.toggle("open", open);
    if (profileToggle) {
      profileToggle.setAttribute("aria-expanded", String(open));
    }
    if (profileMenuList) {
      profileMenuList.setAttribute("aria-hidden", String(!open));
    }
  }

  function closeProfileMenu() {
    setProfileMenuOpen(false);
  }

  profileToggle?.addEventListener("click", () => {
    const isOpen = profileMenu?.classList.contains("open");
    setProfileMenuOpen(!isOpen);
  });

  profileMenuList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.tagName === "A" || target.tagName === "BUTTON") {
      closeProfileMenu();
    }
  });

  document.addEventListener("click", (event) => {
    if (!profileMenu?.classList.contains("open")) return;
    if (!(event.target instanceof Node)) return;
    if (profileMenu.contains(event.target)) return;
    closeProfileMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeProfileMenu();
    }
  });

  // Close menu on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setNavOpen(false);
  });

  function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function toggleLoginButtons(show) {
    loginButtons.forEach((button) => {
      if (!(button instanceof HTMLElement)) return;
      if (!button.dataset.defaultDisplay) {
        button.dataset.defaultDisplay = button.style.display || "";
      }
      button.style.display = show ? button.dataset.defaultDisplay : "none";
    });
  }

  function toggleProfileMenuVisibility(show) {
    if (!(profileMenu instanceof HTMLElement)) return;
    if (!profileMenu.dataset.defaultDisplay) {
      profileMenu.dataset.defaultDisplay =
        profileMenu.style.display && profileMenu.style.display !== "none" ? profileMenu.style.display : "inline-flex";
    }
    profileMenu.style.display = show ? profileMenu.dataset.defaultDisplay : "none";
    if (!show) {
      closeProfileMenu();
    }
  }

  // Hide header while scrolling down
  if (header) {
    let lastScrollY = window.scrollY;
    const SCROLL_DELTA = 12;

    const updateHeaderVisibility = () => {
      const currentY = window.scrollY;
      const scrollingDown = currentY - lastScrollY > SCROLL_DELTA;
      const scrollingUp = lastScrollY - currentY > SCROLL_DELTA;
      const nearTop = currentY < 20;

      if (nearTop || scrollingUp) {
        header.classList.remove("header--hidden");
      } else if (scrollingDown) {
        header.classList.add("header--hidden");
      }

      lastScrollY = currentY;
    };

    window.addEventListener("scroll", updateHeaderVisibility, { passive: true });
  }

  function syncLoginButtonsFromStorage() {
    let isLoggedIn = false;
    try {
      isLoggedIn = localStorage.getItem(LOGIN_STATE_KEY) === "true";
    } catch (err) {
      console.warn("Unable to read auth state from storage", err);
    }
    toggleLoginButtons(!isLoggedIn);
    toggleProfileMenuVisibility(isLoggedIn);
  }

  syncLoginButtonsFromStorage();
  window.addEventListener("storage", (event) => {
    if (event.key === LOGIN_STATE_KEY) {
      syncLoginButtonsFromStorage();
    }
  });

  function createVisitLorePost() {
    const createdAt = new Date();
    const author = pickRandom(loreAuthors);
    const school = pickRandom(loreSchools);
    const event = pickRandom(loreEvents);
    const reaction = pickRandom(loreReactions);

    const text = `During ${event.moment}, ${event.incident}; ${event.detail} ${reaction}`;

    return {
      id: `visit-${createdAt.getTime()}-${Math.floor(Math.random() * 100000)}`,
      author,
      school,
      createdAt,
      text,
    };
  }

  function setFieldError(fieldName, message) {
    const el = document.querySelector(`.error[data-for="${fieldName}"]`);
    if (el) el.textContent = message || "";
  }

  function loadUserLorePosts() {
    try {
      const stored = localStorage.getItem(LOCAL_LORE_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn("Unable to read saved lore posts", err);
      return [];
    }
  }

  function saveUserLorePosts(posts) {
    try {
      localStorage.setItem(LOCAL_LORE_KEY, JSON.stringify(posts.slice(0, 200)));
    } catch (err) {
      console.warn("Unable to save lore posts", err);
    }
  }

  function normalizePosts(posts) {
    return Array.isArray(posts)
      ? posts
          .map((post) => {
            if (!post?.createdAt) return null;
            const createdAt = new Date(post.createdAt);
            if (Number.isNaN(createdAt.getTime())) return null;
            return { ...post, createdAt };
          })
          .filter(Boolean)
      : [];
  }

  async function fetchPostsFromFile(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    const posts = await response.json();
    return normalizePosts(posts);
  }

  async function loadLorePosts() {
    try {
      const posts = await fetchPostsFromFile(DATA_POSTS_URL);
      if (posts.length) {
        return { posts, source: "file" };
      }
    } catch (err) {
      console.warn("Unable to fetch shared posts from file", err);
    }

    const drafts = normalizePosts(loadUserLorePosts()).map((post) => ({ ...post, localOnly: true }));
    return { posts: drafts, source: "local" };
  }

  // Lore board rendering
  async function renderLoreBoards() {
    if (!loreFeeds.length) return;

    const setMessage = (feed, message) => {
      feed.innerHTML = "";
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = message;
      feed.appendChild(p);
    };

    loreFeeds.forEach((feed) => setMessage(feed, "Fetching today’s notices..."));

    try {
      const { posts, source } = await loadLorePosts();
      const feedPosts = posts.length ? posts.sort((a, b) => b.createdAt - a.createdAt) : [createVisitLorePost()];

      const renderToFeed = (feed, postsToRender) => {
        const limitAttr = Number(feed.getAttribute("data-limit"));
        const limit = Number.isFinite(limitAttr) && limitAttr > 0 ? limitAttr : postsToRender.length;
        const selection = postsToRender.slice(0, limit);

        if (!selection.length) {
          setMessage(feed, "No notices on the board yet. Check back after the daily quill writes again.");
          return;
        }

        feed.innerHTML = "";

        selection.forEach((post) => {
          const card = document.createElement("article");
          card.className = "post";

          const top = document.createElement("div");
          top.className = "postTop";

          const author = document.createElement("span");
          author.className = "postAuthor";
          author.textContent = post.author || "Unknown scribe";

          const meta = document.createElement("span");
          meta.className = "postMeta";
          const school = post.school || "Unknown hall";
          const date = post.createdAt?.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) || "Unknown time";
          const scope = post.localOnly || source === "local" ? " • Saved on this device" : "";
          meta.textContent = `${school} • ${date}${scope}`;

          top.append(author, meta);

          const body = document.createElement("p");
          body.className = "postBody";
          body.textContent = post.text || "A missing scrap of parchment.";

          card.append(top, body);
          feed.appendChild(card);
        });
      };

      loreFeeds.forEach((feed) => renderToFeed(feed, feedPosts));
    } catch (err) {
      console.error(err);
      const fallbackPost = createVisitLorePost();
      loreFeeds.forEach((feed) => {
        feed.innerHTML = "";
        const notice = document.createElement("p");
        notice.className = "muted";
        notice.textContent = "The quill is resting. Sharing the freshest whispered note instead.";
        feed.appendChild(notice);
        const card = document.createElement("article");
        card.className = "post";
        const top = document.createElement("div");
        top.className = "postTop";
        const author = document.createElement("span");
        author.className = "postAuthor";
        author.textContent = fallbackPost.author || "Unknown scribe";
        const meta = document.createElement("span");
        meta.className = "postMeta";
        meta.textContent = `${fallbackPost.school || "Unknown hall"} • ${fallbackPost.createdAt.toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })}`;
        top.append(author, meta);
        const body = document.createElement("p");
        body.className = "postBody";
        body.textContent = fallbackPost.text;
        card.append(top, body);
        feed.appendChild(card);
      });
    }
  }

  renderLoreBoards();

  async function publishSharedLorePost(submission) {
    console.info("Shared board endpoint unavailable on static hosting; saving locally instead.");
    const localPost = {
      ...submission,
      id: `local-${Date.now()}`,
      createdAt: new Date().toISOString(),
      localOnly: true,
    };
    const existing = loadUserLorePosts();
    saveUserLorePosts([localPost, ...existing]);
    return { post: localPost, shared: false };
  }

  // Lore composer (archive page only)
  if (loreComposerForm) {
    const nameInput = loreComposerForm.querySelector("#loreName");
    const schoolInput = loreComposerForm.querySelector("#loreSchool");
    const messageInput = loreComposerForm.querySelector("#loreMessage");

    const clearComposerErrors = () => {
      setFieldError("loreName", "");
      setFieldError("loreSchool", "");
      setFieldError("loreMessage", "");
    };

    loreComposerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearComposerErrors();
      if (loreComposerStatus) loreComposerStatus.textContent = "";

      const name = nameInput?.value.trim() || "";
      const school = schoolInput?.value.trim() || "";
      const message = messageInput?.value.trim() || "";

      let ok = true;
      if (name.length < 2) {
        setFieldError("loreName", "Please enter a name (at least 2 characters).");
        ok = false;
      }
      if (!school) {
        setFieldError("loreSchool", "Choose a school or hall.");
        ok = false;
      }
      if (message.length < 12) {
        setFieldError("loreMessage", "Share at least 12 characters so others can follow your note.");
        ok = false;
      }

      if (!ok) return;

      const submission = {
        author: name,
        school,
        text: message,
      };

      if (loreComposerStatus) loreComposerStatus.textContent = "Posting your note to the shared board...";
      const result = await publishSharedLorePost(submission);

      loreComposerForm.reset();
      if (loreComposerStatus) {
        loreComposerStatus.textContent = result.shared
          ? "Posted! Your note now appears on the Lore Board for everyone."
          : "Saved locally while the shared board is unavailable. It currently appears only on this device.";
      }
      renderLoreBoards();
    });

    loreComposerForm.addEventListener("reset", () => {
      clearComposerErrors();
      if (loreComposerStatus) loreComposerStatus.textContent = "";
    });
  }

  // Quiz (sorting ritual page only)
  const quizChooser = document.getElementById("quizChooser");
  const quizShell = document.getElementById("quizShell");
  const changeQuizBtn = document.getElementById("changeQuizBtn");
  const activeQuizLabel = document.getElementById("activeQuizLabel");
  const senseWrap = document.getElementById("senseQuizWrap");
  const elementWrap = document.getElementById("elementQuizWrap");
  const artifactWrap = document.getElementById("artifactQuizWrap");
  const animalWrap = document.getElementById("animalQuizWrap");

  function setupScoredQuiz({ form, result, status, breakdown, copy, order, quizType }) {
    if (!form || !result) return null;

    function clearQuizFeedback() {
      result.classList.remove("hasVerdict");
      form.querySelectorAll(".questionCard").forEach((field) => field.classList.remove("hasError"));

      result.replaceChildren();
      const title = document.createElement("h4");
      title.textContent = "Awaiting your answers";
      const body = document.createElement("p");
      body.className = "muted";
      body.textContent = "Complete all prompts to hear the academy's verdict.";
      result.append(title, body);

      if (status) status.textContent = "";
      if (breakdown) breakdown.replaceChildren();
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      clearQuizFeedback();

      const formData = new FormData(form);
      const questionCards = Array.from(form.querySelectorAll(".questionCard"));

      // Weighted scoring reduces ties; a deterministic tie-breaker makes ties improbable.
      const primeWeights = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];
      const weights =
        questionCards.length <= primeWeights.length
          ? primeWeights.slice(0, questionCards.length)
          : Array.from({ length: questionCards.length }, (_, i) => i + 2);

      const scores = {};
      const meta = {};
      order.forEach((key) => {
        scores[key] = 0;
        meta[key] = { picks: 0, lastIndex: -1 };
      });

      let valid = true;

      questionCards.forEach((field, index) => {
        const question = field.getAttribute("data-question");
        const choice = question ? formData.get(question) : null;

        if (!choice) {
          valid = false;
          field.classList.add("hasError");
          return;
        }

        if (choice in scores) {
          scores[choice] += weights[index];
          meta[choice].picks += 1;
          meta[choice].lastIndex = index;
        }
      });

      if (!valid) {
        if (status) status.textContent = "Answer each prompt to complete the ritual.";
        return;
      }

      const keys = Object.keys(scores);
      const ranked = keys
        .map((key) => ({
          key,
          score: scores[key],
          picks: meta[key].picks,
          lastIndex: meta[key].lastIndex,
        }))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (b.lastIndex !== a.lastIndex) return b.lastIndex - a.lastIndex;
          if (b.picks !== a.picks) return b.picks - a.picks;
          return a.key.localeCompare(b.key);
        });

      const top = ranked[0];
      const tiedOnScore = ranked.filter((entry) => entry.score === top.score).map((entry) => entry.key);
      let topKey = top.key;

      if (tiedOnScore.length > 1) {
        const bestLast = Math.max(...tiedOnScore.map((key) => meta[key]?.lastIndex ?? -1));
        let candidates = tiedOnScore.filter((key) => (meta[key]?.lastIndex ?? -1) === bestLast);

        if (candidates.length > 1) {
          const bestPicks = Math.max(...candidates.map((key) => meta[key]?.picks ?? 0));
          candidates = candidates.filter((key) => (meta[key]?.picks ?? 0) === bestPicks);
        }

        if (candidates.length === 1) {
          topKey = candidates[0];
        } else {
          const seed = questionCards
            .map((field) => {
              const q = field.getAttribute("data-question") || "";
              const v = formData.get(q) || "";
              return `${q}:${v}`;
            })
            .join("|");

          const hash = Array.from(seed).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
          topKey = candidates[hash % candidates.length];
        }
      }

      const pick = copy[topKey];

      if (pick) {
        result.classList.add("hasVerdict");

        const title = document.createElement("h4");
        title.textContent = `${pick.name} awaits you.`;

        const body = document.createElement("p");
        body.className = "resultDetail";
        body.textContent = pick.fit;

        const detail = document.createElement("p");
        detail.className = "muted";
        detail.textContent = pick.invitation;

        const totalPoints = Object.values(scores).reduce((sum, value) => sum + value, 0) || 1;
        const breakdownNode = document.createElement("div");
        breakdownNode.className = "scoreBreakdown";
        breakdownNode.setAttribute("role", "group");
        breakdownNode.setAttribute("aria-label", "Score breakdown");

        const breakdownTitle = document.createElement("p");
        breakdownTitle.className = "muted small";
        breakdownTitle.textContent = "Score breakdown";
        breakdownNode.append(breakdownTitle);

        order.forEach((key) => {
          const row = document.createElement("div");
          row.className = "scoreRow";

          const name = document.createElement("span");
          name.className = "scoreName";
          name.textContent = copy[key]?.name || key;

          const value = document.createElement("span");
          value.className = "scoreValue";
          const percent = Math.round((scores[key] / totalPoints) * 100);
          value.textContent = `${scores[key]} (${percent}%)`;

          row.append(name, value);

          const bar = document.createElement("div");
          bar.className = "scoreBar";

          const fill = document.createElement("div");
          fill.className = "scoreFill";
          fill.style.width = `${percent}%`;

          bar.append(fill);
          breakdownNode.append(row, bar);
        });

        const note = document.createElement("p");
        note.className = "muted small";
        const runnerUp = ranked.find((entry) => entry.key !== topKey);
        note.textContent = runnerUp ? `Second-strongest pull: ${copy[runnerUp.key]?.name || runnerUp.key}.` : "";

        result.replaceChildren(title, body, detail);
        if (note.textContent) result.append(note);

        if (breakdown) {
          breakdown.replaceChildren(breakdownNode);
        } else {
          result.append(breakdownNode);
        }

        if (status) status.textContent = `${pick.name}: ${pick.status}`;

        // Dispatch an event so other scripts can persist this result for the profile page.
        try {
          const safeQuizType = quizType || form?.getAttribute?.("id") || "quiz";
          const labels = {};
          order.forEach((key) => {
            labels[key] = copy[key]?.name || key;
          });

          window.dispatchEvent(
            new CustomEvent("ssa:quizCompleted", {
              detail: {
                quizType: safeQuizType,
                topKey,
                topName: pick.name,
                status: pick.status,
                scores,
                order,
                labels,
                totalPoints,
                completedAt: new Date().toISOString(),
              },
            }),
          );
        } catch (err) {
          console.warn("Quiz completion event failed", err);
        }

      }
    });

    form.addEventListener("reset", () => {
      clearQuizFeedback();
    });

    clearQuizFeedback();

    return { clear: clearQuizFeedback };
  }

  const senseQuiz = document.getElementById("schoolQuiz");
  const senseResult = document.getElementById("quizResult");
  const senseStatus = document.getElementById("quizStatus");
  const senseBreakdown = document.getElementById("quizBreakdown");

  const schoolCopy = {
    touch: {
      name: "Chamber of Touch",
      fit: "Your choices favored texture, warmth, and the certainty of things held in hand. You steady spells by feeling their shape and making them tangible.",
      invitation:
        "Within the Chamber of Touch you'll learn shield-weaving, tactile sigils, and restorative crafts—building wards and tools that pulse with your intent.",
      status: "You lead with grounding sensation and craft, anchoring magic through touch.",
    },
    sight: {
      name: "Observatory of Sight",
      fit: "You read meaning in diagrams, glints, and constellations. Patterns reveal themselves quickly to you, and you navigate by the stories light tells.",
      invitation:
        "The Observatory of Sight will refine your focus through star charts, illusion wards, and mapwork of ley lines—teaching you to draw the unseen into view.",
      status: "You lead with a precise gaze, mapping possibilities before others sense them.",
    },
    sound: {
      name: "Choir of Sound",
      fit: "Vibration, cadence, and harmony guide your focus. You listen between words and tune your magic like an instrument until everything resonates.",
      invitation:
        "The Choir of Sound pairs you with conductors who teach resonance spells, storm-calming chorales, and voice-bound wards that answer your rhythm.",
      status: "You lead with resonance and cadence, coaxing harmony from every element.",
    },
    essence: {
      name: "House of Essence",
      fit: "Memory and mood speak to you through aroma and flavor. You notice the way scent changes a room and trace emotion through what lingers in the air.",
      invitation:
        "Within the House of Essence you'll study aromatic divination, healing brews, and atmosphere-shaping rituals that braid memory into every casting.",
      status: "You lead with memory-rich essences, shaping spells through taste and scent.",
    },
  };

  const elementQuiz = document.getElementById("elementQuiz");
  const elementResult = document.getElementById("elementResult");
  const elementStatus = document.getElementById("elementStatus");
  const elementBreakdown = document.getElementById("elementBreakdown");

const artifactQuiz = document.getElementById("artifactQuiz");
const artifactResult = document.getElementById("artifactResult");
const artifactStatus = document.getElementById("artifactStatus");
const artifactBreakdown = document.getElementById("artifactBreakdown");

const animalQuiz = document.getElementById("animalQuiz");
const animalResult = document.getElementById("animalResult");
const animalStatus = document.getElementById("animalStatus");
const animalBreakdown = document.getElementById("animalBreakdown");

  const elementCopy = {
    water: {
      name: "Tide of Water",
      fit: "You move like a current, patient until the moment you redirect everything. You prefer control through adaptation, turning obstacles into routes.",
      invitation:
        "In the Tide, you'll practice flow-shaping, pressure wards, and calm recovery rituals—learning how to bend conflict without breaking yourself.",
      status: "You lead with adaptation and quiet control, reshaping the field like water.",
    },
    earth: {
      name: "Stone of Earth",
      fit: "You build trust the way mountains build time: slowly, surely, and without apology. You stabilize chaos and make promises that last.",
      invitation:
        "In the Stone, you'll train reinforcement seals, barrier craft, and grounding strikes—turning willpower into structure others can lean on.",
      status: "You lead with stability and protection, anchoring allies with earth-true resolve.",
    },
    fire: {
      name: "Flame of Fire",
      fit: "You ignite momentum. When you commit, the room changes. Your power thrives on courage, clarity, and decisive action.",
      invitation:
        "In the Flame, you'll learn controlled bursts, heat-forged wards, and rallying sparks—channeling intensity into precision instead of havoc.",
      status: "You lead with bold ignition and purpose, lighting the way forward.",
    },
    wind: {
      name: "Gale of Wind",
      fit: "You are motion with a point. You notice openings, read the air, and move before others decide. Freedom is your fuel.",
      invitation:
        "In the Gale, you'll master cutting drafts, silence slips, and range control—turning speed into elegance and escape into strategy.",
      status: "You lead with speed and clarity, choosing your angle and making it real.",
    },
  };

const artifactCopy = {
  ring: {
    name: "Ward Ring",
    fit: "You favor magic that can be worn, trusted, and relied on under pressure. You turn intent into something sturdy and repeatable.",
    invitation:
      "The Ward Ring rewards you with seals, anchors, and boundary craft—magic that holds the line when everything else wavers.",
    status: "You lead with structure and protection, binding outcomes into place.",
  },
  lens: {
    name: "Star Lens",
    fit: "You chase clarity. You want the hidden layer, the map beneath the paint, the signal inside the glare.",
    invitation:
      "The Star Lens trains focus, reveal-work, and pattern-reading—magic that makes the unseen legible.",
    status: "You lead with insight and precision, turning questions into clean answers.",
  },
  chime: {
    name: "Resonance Chime",
    fit: "You move with rhythm. You steady rooms, sync teams, and shape moments by what you hear and how you answer it.",
    invitation:
      "The Resonance Chime teaches cadence wards, call-signals, and harmony craft—magic that brings things into tune.",
    status: "You lead with resonance and timing, making chaos cooperate.",
  },
  vial: {
    name: "Essence Vial",
    fit: "You understand atmosphere. You notice moods, memories, and the way a space changes when one note shifts.",
    invitation:
      "The Essence Vial opens brewing, aura-blending, and comfort rituals—magic that carries calm like a lantern.",
    status: "You lead with presence and alchemy, shaping spells through scent and taste.",
  },
};

const animalCopy = {
  dragon: {
    name: "Pocket Dragon",
    fit: "You thrive when the stakes are real. Your companion amplifies resolve, guards your center, and turns fear into fuel.",
    invitation:
      "Together you'll practice boundary-holding, brave leaps, and stubborn protection—firelight discipline in a small fierce body.",
    status: "You lead with courage and anchored power.",
  },
  cat: {
    name: "Stargazer Cat",
    fit: "You notice what others skip. Your companion sharpens your attention and nudges you toward the detail that changes everything.",
    invitation:
      "Together you'll train observation, timing, and quiet repositioning—winning by seeing first and moving clean.",
    status: "You lead with insight and clean precision.",
  },
  wolf: {
    name: "Hallway Wolf",
    fit: "You build loyalty and momentum. Your companion keeps you steady and reminds you that you never have to carry alone.",
    invitation:
      "Together you'll train coordination, rally-calls, and protective instincts—turning a group into a unit.",
    status: "You lead with loyalty and forward motion.",
  },
  owl: {
    name: "Tea Owl",
    fit: "You bring calm. Your companion helps you read rooms, soften sharp edges, and choose the cleanest path through tension.",
    invitation:
      "Together you'll practice patience, memory-maps, and gentle resets—magic that steadies people as well as plans.",
    status: "You lead with steadiness and quiet care.",
  },
};

  const senseSetup = setupScoredQuiz({
    form: senseQuiz,
    result: senseResult,
    status: senseStatus,
    breakdown: senseBreakdown,
    copy: schoolCopy,
    order: ["touch", "sight", "sound", "essence"],
    quizType: "sense",
  });

  const elementSetup = setupScoredQuiz({
    form: elementQuiz,
    result: elementResult,
    status: elementStatus,
    breakdown: elementBreakdown,
    copy: elementCopy,
    order: ["water", "earth", "fire", "wind"],
    quizType: "element",
});

const artifactSetup = setupScoredQuiz({
  form: artifactQuiz,
  result: artifactResult,
  status: artifactStatus,
  breakdown: artifactBreakdown,
  copy: artifactCopy,
  order: ["ring", "lens", "chime", "vial"],
    quizType: "artifact",
});

const animalSetup = setupScoredQuiz({
  form: animalQuiz,
  result: animalResult,
  status: animalStatus,
  breakdown: animalBreakdown,
  copy: animalCopy,
  order: ["dragon", "cat", "wolf", "owl"],
    quizType: "animal",
});

function showChooser() {
    if (!quizChooser || !quizShell) return;

    quizChooser.hidden = false;
    quizShell.hidden = true;

    if (senseWrap) senseWrap.hidden = true;
    if (elementWrap) elementWrap.hidden = true;
    if (artifactWrap) artifactWrap.hidden = true;
    if (animalWrap) animalWrap.hidden = true;

    if (activeQuizLabel) activeQuizLabel.textContent = "";
  }

  function setActiveQuiz(type) {
    if (!quizChooser || !quizShell) return;

    const allowed = ["sense", "element", "artifact", "animal"];
    if (!allowed.includes(type)) {
      showChooser();
      return;
    }

    quizChooser.hidden = true;
    quizShell.hidden = false;

    const isSense = type === "sense";
    const isElement = type === "element";
    const isArtifact = type === "artifact";
    const isAnimal = type === "animal";

    if (senseWrap) senseWrap.hidden = !isSense;
    if (elementWrap) elementWrap.hidden = !isElement;
    if (artifactWrap) artifactWrap.hidden = !isArtifact;
    if (animalWrap) animalWrap.hidden = !isAnimal;

    if (activeQuizLabel) {
      activeQuizLabel.textContent = isSense
        ? "Sense Magic Quiz"
        : isElement
          ? "Elemental Magic Quiz"
          : isArtifact
            ? "Artifact Quiz"
            : "Animal Companion Quiz";
    }

    if (isSense) {
      senseQuiz?.reset();
      senseSetup?.clear?.();
      senseWrap?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    if (isElement) {
      elementQuiz?.reset();
      elementSetup?.clear?.();
      elementWrap?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    if (isArtifact) {
      artifactQuiz?.reset();
      artifactSetup?.clear?.();
      artifactWrap?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    if (isAnimal) {
      animalQuiz?.reset();
      animalSetup?.clear?.();
      animalWrap?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  if (quizChooser && quizShell) {
    const choiceButtons = Array.from(document.querySelectorAll("[data-quiz-choice]"));
    choiceButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const type = btn.getAttribute("data-quiz-choice");
        if (["sense","element","artifact","animal"].includes(type)) setActiveQuiz(type);
      });
    });

    if (changeQuizBtn) {
      changeQuizBtn.addEventListener("click", () => showChooser());
    }

    const params = new URLSearchParams(window.location.search);
    const preset = params.get("quiz");
    if (["sense", "element", "artifact", "animal"].includes(preset)) {
      setActiveQuiz(preset);
    } else {
      showChooser();
    }
  }

  // Contact form validation
  const form = document.getElementById("contactForm");
  const statusEl = document.getElementById("formStatus");
  const submitBtn = form?.querySelector('button[type="submit"]');

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = form.name.value.trim();
    const message = form.message.value.trim();

    setFieldError("name", "");
    setFieldError("message", "");
    if (statusEl) statusEl.textContent = "";

    let ok = true;

    if (name.length < 2) {
      setFieldError("name", "Please enter your name (at least 2 characters).");
      ok = false;
    }
    if (message.length < 10) {
      setFieldError("message", "Please write a message (at least 10 characters).");
      ok = false;
    }

    if (!ok) {
      if (statusEl) statusEl.textContent = "Please fix the highlighted fields.";
      return;
    }

    if (statusEl) statusEl.textContent = "Sending your message...";
    submitBtn?.setAttribute("disabled", "true");

    const formData = new FormData();
    formData.append("name", name);
    formData.append("message", message);

    try {
      const response = await fetch("https://formspree.io/f/meeqrlol", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        const errorMsg = data?.errors?.[0]?.message || "Something went wrong. Please try again.";
        throw new Error(errorMsg);
      }

      if (statusEl) statusEl.textContent = "Thanks! Your message has been sent.";
      form.reset();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to send your message right now.";
      if (statusEl) statusEl.textContent = message;
    } finally {
      submitBtn?.removeAttribute("disabled");
    }
  });
})();
