(() => {
  "use strict";

  /* ============================================================
     THE STACK DATA STRUCTURE (LIFO: Last In, First Out)
     Plates on the table are stored here; only the TOP plate
     can be removed or served.
     ============================================================ */
  class Stack {
    constructor(maxSize) { this.items = []; this.maxSize = maxSize; }
    push(item) { if (this.isFull()) return false; this.items.push(item); return true; }
    pop() { return this.items.pop(); }
    peek() { return this.items[this.items.length - 1]; }
    isEmpty() { return this.items.length === 0; }
    isFull() { return this.items.length >= this.maxSize; }
    get size() { return this.items.length; }
    all() { return this.items.slice(); }
    includes(food) { return this.items.some((p) => p.food === food); }
  }

  /* ---------- Game settings ---------- */
  const FOODS = [
    { food: "🍕", name: "Pizza",    color: "#ff3b5c" },
    { food: "🍔", name: "Burger",   color: "#ff9500" },
    { food: "🍣", name: "Sushi",    color: "#22d36b" },
    { food: "🍩", name: "Donut",    color: "#b44cff" },
    { food: "🍎", name: "Apple",    color: "#2e8bff" },
    { food: "🌮", name: "Taco",     color: "#ffd60a" },
    { food: "🍇", name: "Grapes",   color: "#8e44ad" },
    { food: "🍪", name: "Cookie",   color: "#c47c3a" },
  ];
  const CUSTOMERS = ["😋", "🤠", "🥳", "😎", "🤩", "👽", "🐱", "🦊", "🐼", "🧑‍🍳"];
  const MAX_STACK = 4;               // <-- stack holds 4 plates
  const START_LIVES = 3;
  const BEST_KEY = "plateStackRushBest";
  const DEFAULT_TIP = "Plates auto-stack up to 4 — dig down to find the requested food!";
  const AUTO_STACK_INTERVAL = 2600;  // ms: auto-push a plate if room

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const scoreEl = $("score");
  const bestEl = $("best");
  const heartsEl = $("hearts");
  const sizeEl = $("size");
  const maxEl = $("max");
  const comboEl = $("combo");
  const muteBtn = $("mute");
  const stackZone = $("stackZone");
  const stackEl = $("stack");
  const stackArrayList = $("stack-array-list");
  const incomingEl = $("incoming");
  const orderEl = $("order");
  const orderNameEl = $("order-name");
  const faceEl = $("face");
  const barEl = $("bar");
  const messageEl = $("message");
  const customerEl = $("customer");
  const startOverlay = $("start-overlay");
  const overOverlay = $("over-overlay");
  const overText = $("over-text");

  /* ---------- State ---------- */
  let stack = new Stack(MAX_STACK);
  let incoming = null;
  let order = null;
  let score = 0, served = 0, combo = 0, lives = START_LIVES;
  let patience = 0, patienceMax = 6;   // <-- shorter patience
  let best = 0;
  let running = false;
  let lastT = 0;
  let rafId = 0;
  let msgTimer = 0;
  let autoTimer = null;

  try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { best = 0; }
  maxEl.textContent = MAX_STACK;
  bestEl.textContent = best;

  /* ---------- Sound ---------- */
  let audioCtx = null;
  let muted = false;

  function tone(freq, dur, type = "sine", vol = 0.08, delay = 0) {
    if (muted) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime + delay;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t); osc.stop(t + dur);
    } catch (e) { /* ignore */ }
  }
  const SFX = {
    push: () => tone(440, .12, "triangle"),
    good: () => { tone(660, .1, "square"); tone(880, .16, "square", .08, .1); },
    bad:  () => tone(180, .25, "sawtooth"),
    toss: () => tone(300, .12, "triangle"),
    over: () => { tone(300,.2,"sawtooth"); tone(220,.3,"sawtooth",.08,.2); tone(140,.5,"sawtooth",.08,.45); },
  };
  const sfx = (n) => { if (SFX[n]) SFX[n](); };

  /* ---------- Helpers ---------- */
  function retrigger(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function say(text, kind) {
    messageEl.textContent = text;
    messageEl.className = "message " + (kind || "");
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => {
      messageEl.textContent = DEFAULT_TIP;
      messageEl.className = "message";
    }, 2600);
  }

  function randFood() { return FOODS[Math.floor(Math.random() * FOODS.length)]; }

  function makePlate(item) {
    const el = document.createElement("div");
    el.className = "plate";
    el.style.setProperty("--c", item.color);
    el.title = item.name;
    const f = document.createElement("span");
    f.className = "food";
    f.textContent = item.food;
    el.appendChild(f);
    return el;
  }

  function detach(el, container) {
    const r = el.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    el.style.position = "absolute";
    el.style.left = (r.left - c.left) + "px";
    el.style.top = (r.top - c.top) + "px";
    el.style.margin = "0";
    el.classList.remove("drop", "slide-in", "top");
    el.classList.add("leaving");
  }

  function animateOut(el, cls, ms) {
    el.classList.add(cls);
    setTimeout(() => el.remove(), ms);
  }

  function livePlates() { return stackEl.querySelectorAll(".plate:not(.leaving)"); }

  function markTop() {
    stackEl.querySelectorAll(".plate").forEach((p) => p.classList.remove("top"));
    const els = livePlates();
    if (els.length) els[els.length - 1].classList.add("top");
    stackEl.classList.toggle("full", stack.isFull());
  }

  function renderStackArray() {
    stackArrayList.innerHTML = "";
    const items = stack.all();
    if (items.length === 0) {
      const li = document.createElement("li");
      li.textContent = "";
      stackArrayList.appendChild(li);
      return;
    }
    items.forEach((item, i) => {
      const li = document.createElement("li");
      if (i === items.length - 1) li.classList.add("top-item");
      li.innerHTML = `<span>${item.food} ${item.name}</span><span>${i}</span>`;
      stackArrayList.appendChild(li);
    });
  }

  function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
    sizeEl.textContent = stack.size;
    comboEl.textContent = combo;
    heartsEl.textContent = "❤️".repeat(lives) + "🖤".repeat(START_LIVES - lives);
  }

  function burst() {
    const palette = FOODS.map((f) => f.color);
    for (let i = 0; i < 16; i++) {
      const d = document.createElement("div");
      d.className = "confetti";
      const angle = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 90;
      d.style.setProperty("--dx", Math.cos(angle) * dist + "px");
      d.style.setProperty("--dy", Math.sin(angle) * dist + "px");
      d.style.background = palette[i % palette.length];
      customerEl.appendChild(d);
      setTimeout(() => d.remove(), 850);
    }
  }

  function floatText(text) {
    const f = document.createElement("div");
    f.className = "float";
    f.textContent = text;
    customerEl.appendChild(f);
    setTimeout(() => f.remove(), 1000);
  }

  /* ---------- Incoming + orders ---------- */
  function setIncoming() {
    incoming = randFood();
    const p = makePlate(incoming);
    p.classList.add("slide-in");
    incomingEl.innerHTML = "";
    incomingEl.appendChild(p);
  }

    function newOrder() {
    // Pick from the TOP 2 plates only (so it's always winnable)
    if (stack.size === 0) {
      order = incoming;
    } else {
      const items = stack.all();
      // Get the top 2 plates (or fewer if the stack is small)
      const topPlates = items.slice(-2); 
      order = topPlates[Math.floor(Math.random() * topPlates.length)];
    }
    
    // Give the player a bit more breathing room
    patienceMax = Math.max(4.5, 8 - served * 0.2); 
    patience = patienceMax;

    orderEl.innerHTML = "";
    const p = makePlate(order);
    p.classList.add("mini");
    orderEl.appendChild(p);
    orderNameEl.textContent = order.name;
    faceEl.textContent = CUSTOMERS[Math.floor(Math.random() * CUSTOMERS.length)];
    faceEl.classList.remove("angry");
  }

  /* ---------- Actions ---------- */
  function push() {
    if (!running) return;
    if (!stack.push(incoming)) {
      say("Stack is full (4)! Serve or remove the top plate first.", "bad");
      retrigger(stackZone, "shake");
      sfx("bad");
      return;
    }
    const el = makePlate(incoming);
    el.classList.add("drop");
    stackEl.appendChild(el);

    incomingEl.innerHTML = "";
    setIncoming();

    sfx("push");
    markTop();
    renderStackArray();
    updateHud();
  }

  function pop() {           // SERVE
    if (!running) return;
    if (stack.isEmpty()) {
      say("The stack is empty — push a plate first!", "bad");
      retrigger(stackZone, "shake");
      sfx("bad");
      return;
    }

    const item = stack.pop();
    const els = livePlates();
    const el = els[els.length - 1];
    detach(el, stackEl);

    if (item.food === order.food) {
      combo++;
      served++;
      const timeBonus = Math.round((patience / patienceMax) * 5);
      const gain = 10 + (combo - 1) * 2 + timeBonus;
      score += gain;
      if (score > best) best = score;

      animateOut(el, "serve-fly", 560);
      burst();
      floatText("+" + gain);
      sfx("good");
      say(combo >= 2 ? `Combo x${combo}! +${gain}` : `Yum! +${gain}`, "good");
      if (stack.size > 0) newOrder(); else newOrder();
      retrigger(faceEl, "cheer");
    } else {
      combo = 0;
      animateOut(el, "smash", 620);
      faceEl.textContent = "😡";
      retrigger(faceEl, "angry");
      say(`Oops! Served ${item.name}, they wanted ${order.name}.`, "bad");
      sfx("bad");
      loseLife();
      if (running) newOrder();
    }

    markTop();
    renderStackArray();
    updateHud();
  }

  function removeTop() {     // pop WITHOUT serving
    if (!running) return;
    if (stack.isEmpty()) {
      say("Nothing to remove — the stack is empty.", "bad");
      retrigger(stackZone, "shake");
      sfx("bad");
      return;
    }
    const item = stack.pop();
    const els = livePlates();
    const el = els[els.length - 1];
    detach(el, stackEl);
    animateOut(el, "lift", 420);
    say(`Removed ${item.name} from the top (no serve).`, "");
    sfx("toss");
    markTop();
    renderStackArray();
    updateHud();
  }

  function toss() {
    if (!running) return;
    const el = incomingEl.querySelector(".plate:not(.leaving)");
    if (el) { detach(el, incomingEl); animateOut(el, "toss", 460); }
    setIncoming();
    patience = Math.max(0.5, patience - 1.5);
    say("Tossed! The customer lost 1.5s of patience.", "");
    sfx("toss");
  }

  function loseLife() {
    lives--;
    updateHud();
    if (lives <= 0) gameOver();
  }

  /* ---------- Auto-stack loop ---------- */
  function startAutoStack() {
    stopAutoStack();
    autoTimer = setInterval(() => {
      if (!running) return;
      if (!stack.isFull()) {
        // Auto-push the incoming plate
        push();
      }
    }, AUTO_STACK_INTERVAL);
  }
  function stopAutoStack() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }

  /* ---------- Main loop ---------- */
  function loop(t) {
    if (!running) return;
    const dt = Math.min(0.1, (t - lastT) / 1000);
    lastT = t;

    patience -= dt;
    const pct = Math.max(0, patience / patienceMax);
    barEl.style.width = (pct * 100) + "%";
    barEl.style.background = `hsl(${Math.round(pct * 120)} 90% 50%)`;

    if (patience <= 0) {
      combo = 0;
      say("Too slow! The customer stormed off.", "bad");
      sfx("bad");
      loseLife();
      if (running) newOrder();
    }
    if (running) rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    cancelAnimationFrame(rafId);
    stopAutoStack();

    stack = new Stack(MAX_STACK);
    stackEl.innerHTML = "";
    incomingEl.innerHTML = "";
    score = 0; served = 0; combo = 0; lives = START_LIVES;
    running = true;

    startOverlay.classList.add("hidden");
    overOverlay.classList.add("hidden");

    setIncoming();
    // Seed a couple of plates so the order has variety
    push(); push();
    newOrder();
    markTop();
    renderStackArray();
    updateHud();
    say("Serve the plate they ask for — dig down if you must!", "");

    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
    startAutoStack();
  }

  function gameOver() {
    running = false;
    cancelAnimationFrame(rafId);
    stopAutoStack();
    if (score >= best) {
      best = score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {}
    }
    updateHud();
    sfx("over");
    overText.innerHTML =
      `Score: <b>${score}</b><br>Plates served: <b>${served}</b><br>Best: <b>${best}</b>` +
      `<br><br>Tip: the last plate pushed is the first one you can remove!`;
    setTimeout(() => overOverlay.classList.remove("hidden"), 700);
  }

  /* ---------- Controls ---------- */
  $("push").addEventListener("click", (e) => { push(); e.currentTarget.blur(); });
  $("pop").addEventListener("click", (e) => { pop(); e.currentTarget.blur(); });
  $("remove").addEventListener("click", (e) => { removeTop(); e.currentTarget.blur(); });
  $("trash").addEventListener("click", (e) => { toss(); e.currentTarget.blur(); });
  $("start-btn").addEventListener("click", start);
  $("again-btn").addEventListener("click", start);

  muteBtn.addEventListener("click", (e) => {
    muted = !muted;
    muteBtn.textContent = muted ? "🔇" : "🔊";
    e.currentTarget.blur();
  });

  document.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const k = e.key;
    const menuOpen = !startOverlay.classList.contains("hidden") || !overOverlay.classList.contains("hidden");
    if (menuOpen) {
      if (k === "Enter" || k === " ") { e.preventDefault(); start(); }
      return;
    }
    if (!running) return;

    if (k === " " || k === "ArrowDown") { e.preventDefault(); push(); }
    else if (k === "Enter" || k === "ArrowUp") { e.preventDefault(); pop(); }
    else if (k === "r" || k === "R") { e.preventDefault(); removeTop(); }
    else if (k === "t" || k === "T" || k === "ArrowRight") { e.preventDefault(); toss(); }
  });

  document.addEventListener("keyup", (e) => {
    if (e.key === " ") e.preventDefault();
  });

  updateHud();
  renderStackArray();
})();
