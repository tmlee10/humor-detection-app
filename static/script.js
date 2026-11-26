document.addEventListener("DOMContentLoaded", () => {
  const chatBox = document.getElementById("chat-box");
  const userInput = document.getElementById("user-input");
  const analyzeBtn = document.getElementById("analyze-btn");
  const sendBtn = document.getElementById("send-btn");
  const clearBtn = document.getElementById("clear-btn");
  const themeBtn = document.getElementById("theme-btn");
  const charCount = document.getElementById("char-count");
  const apiStatus = document.getElementById("api-status");
  const modelStatus = document.getElementById("model-status");
  const feedbackCount = document.getElementById("feedback-count");
  const lowBand = document.getElementById("low-band");
  const midBand = document.getElementById("mid-band");
  const highBand = document.getElementById("high-band");

  const dialNeedle = document.getElementById("dial-needle");
  const dialScore = document.getElementById("dial-score");
  const dialVerdict = document.getElementById("dial-verdict");
  const dialMargin = document.getElementById("dial-margin");
  const trailList = document.getElementById("trail-list");
  const trailCount = document.getElementById("trail-count");

  let busy = false;
  let thresholds = null;
  const publicDemo = document.getElementById("research3-public-bot-demo-v1") !== null;
  let runHistory = [];

  const pct = (v) => {
    const n = Number(v), p = n * 100;
    if (!Number.isFinite(n)) return "—";
    if ((p > 0 && p < 1) || (p > 99 && p < 100)) return `${p.toFixed(1)}%`;
    return `${Math.round(p)}%`;
  };

  const updateCounter = () => { charCount.textContent = `${userInput.value.length} / 8000`; };
  const setBusy = (value) => {
    busy = value;
    for (const control of [analyzeBtn, sendBtn, clearBtn, userInput]) control.disabled = value;
  };
  const scroll = () => requestAnimationFrame(() => { chatBox.scrollTop = chatBox.scrollHeight; });

  async function request(url, body, method = "POST") {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let d = {};
    try { d = await r.json(); } catch {}
    if (!r.ok) throw new Error(d.detail || `Request failed (${r.status})`);
    return d;
  }

  function validThresholds(low, high) {
    return Number.isFinite(low) && Number.isFinite(high) && 0 <= low && low < high && high <= 1;
  }

  const cutoff = (value) => `${Number((value * 100).toFixed(4))}%`;

  function displayBands({ low, high }) {
    lowBand.textContent = cutoff(low);
    highBand.textContent = cutoff(high);
    midBand.textContent = `${cutoff(low)}–${cutoff(high)}`;
    for (const [id, from, to] of [
      ["band-plain", 0, low], ["band-ambiguous", low, high], ["band-humorous", high, 1]
    ]) {
      document.getElementById(id).setAttribute("stroke-dasharray", `0 ${from * 100} ${(to - from) * 100} 100`);
    }
  }

  function updateDial(score, label, low, high, text = "") {
    const s = Math.max(0, Math.min(1, Number(score ?? 0)));
    const bounds = validThresholds(low, high) ? { low, high } : thresholds;
    if (bounds) displayBands(bounds);
    const deg = -90 + s * 180;

    if (dialNeedle) dialNeedle.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    if (dialScore) dialScore.textContent = pct(s);

    const toneClass = label === "Humorous" ? "is-humorous" : label === "Not Humorous" ? "is-plain" : "is-ambiguous";
    if (dialVerdict) {
      dialVerdict.textContent = label || "Evaluated";
      dialVerdict.className = `dial-verdict ${toneClass}`;
    }

    if (dialMargin) {
      if (!bounds) {
        dialMargin.textContent = "Model cutoffs unavailable.";
      } else {
        const { low, high } = bounds;
        const gap = (distance) => {
          const points = distance * 100;
          return points < 0.01 ? "less than 0.01 pts" : `${Number(points.toFixed(2))} pts`;
        };
        if (s === high) {
          dialMargin.textContent = `At the ${cutoff(high)} Humorous cutoff.`;
        } else if (s > high) {
          dialMargin.textContent = `${gap(s - high)} above the ${cutoff(high)} Humorous cutoff.`;
        } else if (s < low) {
          dialMargin.textContent = `${gap(low - s)} below the ${cutoff(low)} Not Humorous cutoff.`;
        } else {
          dialMargin.textContent = `Inside the Ambiguous band (${gap(high - s)} below Humorous).`;
        }
      }
    }

    if (text) {
      runHistory.push({ score: s, label, toneClass, bounds, text });
      renderTrail();
    }
  }

  function renderTrail() {
    if (trailCount) trailCount.textContent = `${runHistory.length} tested`;
    if (!trailList) return;
    if (!runHistory.length) {
      trailList.innerHTML = '<span class="trail-empty">Click any previous score chip to reload its prompt.</span>';
      return;
    }
    trailList.innerHTML = "";
    runHistory.slice(-6).forEach((item) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "trail-chip";
      chip.title = `Reload: ${item.text}`;
      const swatchClass = item.toneClass === "is-humorous" ? "swatch-humor" : item.toneClass === "is-plain" ? "swatch-plain" : "swatch-ambig";
      chip.innerHTML = `<span class="swatch ${swatchClass}" aria-hidden="true"></span><span>${pct(item.score)}</span>`;
      chip.addEventListener("click", () => {
        userInput.value = item.text;
        updateCounter();
        clearInputFeedback();
        updateDial(item.score, item.label, item.bounds?.low, item.bounds?.high);
        userInput.focus();
      });
      trailList.appendChild(chip);
    });
  }

  function correction(card, ctx, n) {
    const wrap = document.createElement("div");
    wrap.className = "correction-wrapper";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "incorrect-btn";
    btn.textContent = "Incorrect result?";
    const panel = document.createElement("div");
    panel.className = "correction-panel hidden";
    panel.innerHTML = "<strong>What should the label be?</strong>";
    const choices = document.createElement("div");
    choices.className = "correction-choices";
    ["Humorous", "Not Humorous", "Ambiguous / Uncertain"].filter((x) => x !== n.label).forEach((label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "correction-choice";
      b.textContent = label;
      b.onclick = async () => {
        try {
          const d = await request("/feedback", {
            input_text: ctx.inputText,
            original_label: n.label,
            original_score: Number(n.score),
            corrected_label: label,
            source: ctx.source || "analyze",
            model_source: n.modelSource || ""
          });
          panel.innerHTML = `<div class="correction-saved">Saved as ${label}. It will not change the live model immediately.</div>`;
          btn.disabled = true;
          btn.textContent = "Correction saved";
          if (feedbackCount) feedbackCount.textContent = d.counts.total;
        } catch (e) {
          const message = document.createElement("div");
          message.className = "correction-error";
          message.textContent = e.message;
          panel.appendChild(message);
        }
      };
      choices.appendChild(b);
    });
    panel.appendChild(choices);
    btn.onclick = () => panel.classList.toggle("hidden");
    wrap.append(btn, panel);
    card.appendChild(wrap);
  }

  function appendMessage(text, type, result = null, source = "", ctx = null) {
    const wrap = document.createElement("div");
    wrap.className = `message ${type}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    wrap.appendChild(bubble);

    if (result) {
      const n = {
        score: result.score ?? result.user_humor_score,
        label: result.label ?? result.user_label,
        strength: result.confidence ?? result.user_confidence,
        explanation: result.explanation ?? result.user_explanation,
        modelSource: result.model_source ?? "",
        low: result.low_threshold ?? null,
        high: result.high_threshold ?? null
      };

      updateDial(n.score, n.label, n.low, n.high, ctx?.inputText || "");

      const card = document.createElement("div");
      card.className = "result-card";

      const top = document.createElement("div");
      top.className = "result-top";
      [
        ["Humor score", pct(n.score), "score-cell"],
        ["Classification", n.label || "—", ""],
        ["Decision strength", n.strength || "—", ""]
      ].forEach(([labelText, valText, extra]) => {
        const cell = document.createElement("div");
        cell.className = `result-cell ${extra}`.trim();
        const s = document.createElement("span");
        s.textContent = labelText;
        const st = document.createElement("strong");
        st.textContent = valText;
        cell.append(s, st);
        top.appendChild(cell);
      });
      card.appendChild(top);

      if (n.explanation) {
        const p = document.createElement("p");
        p.className = "explanation";
        p.textContent = n.explanation;
        card.appendChild(p);
      }
      if (validThresholds(n.low, n.high)) {
        const p = document.createElement("p");
        p.className = "explanation";
        p.textContent = `Current decision range: below ${cutoff(n.low)} = Not Humorous, ${cutoff(n.low)} to below ${cutoff(n.high)} = Ambiguous, ${cutoff(n.high)} and above = Humorous.`;
        card.appendChild(p);
      }

      const s = document.createElement("div");
      s.className = "source";
      s.textContent = [source, n.modelSource ? `Model: ${n.modelSource}` : ""].filter(Boolean).join(" · ");
      card.appendChild(s);

      if (ctx?.inputText && !publicDemo) correction(card, ctx, n);
      wrap.appendChild(card);
    }

    chatBox.appendChild(wrap);
    scroll();
  }

  function showTyping(t) {
    document.getElementById("typing")?.remove();
    const e = document.createElement("div");
    e.id = "typing";
    e.className = "typing";
    e.textContent = `${t}…`;
    chatBox.appendChild(e);
    scroll();
  }
  const removeTyping = () => document.getElementById("typing")?.remove();

  async function loadHealth() {
    try {
      const r = await fetch("/health");
      if (!r.ok) throw new Error(`Health check failed (${r.status})`);
      const d = await r.json();
      apiStatus.textContent = "Online";
      apiStatus.className = "status-ok";
      modelStatus.textContent = d.local_model_ready ? "Local model" : d.bootstrap_allowed ? "Bootstrap ready" : "Not trained";
      if (feedbackCount) feedbackCount.textContent = d.feedback_count ?? 0;
      const { low, high } = d.thresholds || {};
      if (validThresholds(low, high)) {
        thresholds = { low, high };
        if (!runHistory.length) displayBands(thresholds);
      }
    } catch {
      apiStatus.textContent = "Offline";
      apiStatus.className = "status-error";
      modelStatus.textContent = "Unknown";
    }
  }

  const inputFeedback = document.createElement("p");
  inputFeedback.id = "input-feedback";
  inputFeedback.setAttribute("role", "alert");
  inputFeedback.hidden = true;
  userInput.insertAdjacentElement("afterend", inputFeedback);
  userInput.setAttribute("aria-describedby", "input-feedback");

  function clearInputFeedback() {
    inputFeedback.textContent = "";
    inputFeedback.hidden = true;
    userInput.removeAttribute("aria-invalid");
  }

  userInput.addEventListener("input", () => {
    if (userInput.value.trim()) clearInputFeedback();
  });

  function getText() {
    const text = userInput.value.trim();
    if (!text) {
      inputFeedback.textContent = "Enter some text or choose an example, then select Analyze only or Generate reply.";
      inputFeedback.hidden = false;
      userInput.setAttribute("aria-invalid", "true");
      userInput.focus();
      return null;
    }
    clearInputFeedback();
    return text;
  }

  async function analyze() {
    const text = getText();
    if (!text || busy) return;
    appendMessage(text, "user");
    updateCounter();
    setBusy(true);
    showTyping("Analyzing");
    try {
      const d = await request("/analyze", { text });
      removeTyping();
      appendMessage("Here is the model result.", "bot", d, "Analyze only", { inputText: text, source: "analyze" });
    } catch (e) {
      removeTyping();
      appendMessage(e.message, "error");
    } finally {
      setBusy(false);
      userInput.focus();
    }
  }

  async function generate() {
    const text = getText();
    if (!text || busy) return;
    appendMessage(text, "user");
    userInput.value = "";
    updateCounter();
    setBusy(true);
    showTyping("Analyzing and generating");
    try {
      const d = await request("/chat", { message: text });
      removeTyping();
      appendMessage(d.reply || "No reply was returned.", "bot", d, d.response_source || "", { inputText: text, source: "chat" });
    } catch (e) {
      removeTyping();
      appendMessage(e.message, "error");
    } finally {
      setBusy(false);
      userInput.focus();
    }
  }

  function reset() {
    chatBox.innerHTML = "";
    runHistory = [];
    if (thresholds) displayBands(thresholds);
    renderTrail();
    if (dialNeedle) dialNeedle.style.transform = "rotate(0deg)";
    if (dialScore) dialScore.textContent = "—";
    if (dialVerdict) {
      dialVerdict.textContent = "Awaiting input";
      dialVerdict.className = "dial-verdict";
    }
    if (dialMargin) dialMargin.textContent = "Test a sentence to see where it lands on the humor dial.";
    appendMessage("Enter a short piece of text. I will classify it as Humorous, Not Humorous, or Ambiguous / Uncertain.", "bot");
  }

  analyzeBtn.onclick = analyze;
  sendBtn.onclick = generate;
  clearBtn.onclick = reset;
  if (themeBtn) {
    themeBtn.onclick = () => {
      document.body.classList.toggle("light-theme");
      themeBtn.textContent = document.body.classList.contains("light-theme") ? "☾" : "☀";
    };
  }
  userInput.oninput = updateCounter;
  userInput.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      generate();
    }
  };
  document.querySelectorAll("[data-sample]").forEach((b) => {
    b.onclick = () => {
      userInput.value = b.dataset.sample;
      updateCounter();
      clearInputFeedback();
      userInput.focus();
    };
  });

  reset();
  updateCounter();
  loadHealth();
  userInput.focus();
});
