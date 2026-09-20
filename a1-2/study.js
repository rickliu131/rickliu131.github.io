const api = "https://emotion-study-a1-rick.rickliu131.chatgpt.site/api/pages";
const storageKey = "a1-2-participant-token";
const emotions = [
  ["anger", "Anger", "Frustration, irritation, or resentment"],
  ["fear", "Fear", "Worry, anxiety, or feeling threatened"],
  ["joy", "Joy", "Happiness, delight, or contentment"],
  ["love", "Love", "Affection, care, or closeness"],
  ["sadness", "Sadness", "Sorrow, disappointment, or loss"],
  ["surprise", "Surprise", "Amazement or something unexpected"],
];
const main = document.getElementById("study");
let session = null, selected = "", busy = false, error = "";
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]);

async function request(path, body) {
  const token = localStorage.getItem(storageKey);
  const response = await fetch(api + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "omit",
    cache: "no-store",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { "X-Participant-Token": token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("The response server is unavailable. Please try again later.");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Your response could not be saved. Please try again.");
  if (data.token) localStorage.setItem(storageKey, data.token);
  return data.session;
}

function render(focusHeading = false) {
  const current = session?.assignments.find(item => !item.label);
  const count = session?.assignments.filter(item => item.label).length || 0;
  main.classList.toggle("complete", !!session?.completedAt);
  main.setAttribute("aria-busy", String(busy));
  const errors = error ? `<div class="error" role="alert"><p>${escape(error)}</p><button type="button" class="secondary" id="reload" ${busy ? "disabled" : ""}>Reload saved progress</button></div>` : "";
  if (session?.completedAt) {
    main.innerHTML = `<h1 tabindex="-1">Task complete</h1><p>Your five responses have been saved. Thank you.</p>
      <div class="receipt-heading"><div><h2>Saved responses</h2><p>Participant ID: <span class="mono">${escape(session.participantId)}</span></p></div><button class="secondary" id="download">Download CSV</button></div>
      <div class="table-wrap" role="region" aria-label="Saved responses" tabindex="0"><table><thead><tr><th>Participant ID</th><th>Tweet ID</th><th>Tweet text</th><th>Selected emotion</th><th>Saved at (UTC)</th></tr></thead><tbody>${session.assignments.map(item => `<tr><td class="mono">${escape(session.participantId)}</td><td class="mono">${escape(item.tweetId)}</td><td class="tweet-cell">${escape(item.text)}</td><td class="emotion">${escape(item.label)}</td><td class="time">${escape(item.submittedAt.slice(0,10))}<br>${escape(item.submittedAt.slice(11,19))}</td></tr>`).join("")}</tbody></table></div>
      ${errors}<div class="completion-actions"><p>You can close this page.</p><button class="secondary" id="new-session" ${busy ? "disabled" : ""}>${busy ? "Starting…" : "Start a new session"}</button></div>`;
    document.getElementById("download").onclick = download;
    document.getElementById("new-session").onclick = () => act("/session", {newSession:true});
  } else if (current) {
    main.innerHTML = `<div class="progress-heading"><h1 tabindex="-1">Tweet ${current.position} of 5</h1><span aria-live="polite">${count} saved</span></div>
      <progress max="5" value="${count}" aria-label="${count} of 5 responses saved"></progress>
      <blockquote>${escape(current.text)}</blockquote>
      <form id="answer"><fieldset ${busy ? "disabled" : ""}><legend>Which emotion is most strongly expressed?</legend><p class="note">Select one emotion.</p><div class="options">${emotions.map(([value,name,description]) => `<label class="option"><input type="radio" name="emotion" value="${value}" required ${selected === value ? "checked" : ""}><span><strong>${name}</strong><small>${description}</small></span></label>`).join("")}</div></fieldset>${errors}
      <div class="save-row"><button type="submit" id="save" ${!selected || busy ? "disabled" : ""}>${busy ? "Saving…" : current.position === 5 ? "Finish task" : "Save & continue"}</button></div></form>
      <p class="note">Saved answers cannot be changed. You can return on this browser to finish later.</p>`;
    const form = document.getElementById("answer");
    form.onchange = event => { selected = event.target.value; document.getElementById("save").disabled = !selected || busy; };
    form.onsubmit = event => { event.preventDefault(); if (selected && !busy) void act("/labels", {tweetId:current.tweetId,label:selected}); };
  } else {
    main.innerHTML = `<h1 tabindex="-1">Tweet emotion labeling</h1><p>Label the emotion expressed in <strong>5 randomly selected tweets</strong>.</p>
      <ol><li>Read the whole tweet, including context and negation.</li><li>Choose the one emotion most strongly expressed in the text.</li><li>If more than one emotion seems possible, choose the best fit.</li></ol>
      <h2>Emotion categories</h2><dl>${emotions.map(([,name,description]) => `<div><dt>${name}</dt><dd>${description}</dd></div>`).join("")}</dl>
      <p class="note">Judge the emotion expressed in the words, not the writer’s actual feelings.</p>
      <p class="note">Your responses are stored with an anonymous participant ID. No name or email is needed. Some tweets discuss difficult experiences; you can stop at any time.</p>
      ${errors}<button id="begin" ${busy || error ? "disabled" : ""}>${busy ? "Starting…" : "Begin labeling"}</button>`;
    document.getElementById("begin").onclick = () => act("/session", {newSession:false});
  }
  if (error) document.getElementById("reload").onclick = refresh;
  if (focusHeading) main.querySelector("h1").focus();
}

async function act(path, body) {
  if (busy) return;
  busy = true; error = ""; render();
  let saved = false;
  try { session = await request(path, body); selected = ""; saved = true; }
  catch (e) { error = e instanceof TypeError ? "Could not reach the response server. Check your connection and try again." : e.message; }
  finally { busy = false; render(saved); }
}

async function refresh() {
  if (busy) return;
  busy = true; error = "";
  try {
    const check = storageKey + "-check";
    localStorage.setItem(check, "1"); localStorage.removeItem(check);
    session = await request("/session"); selected = "";
  } catch (e) {
    error = e.name === "SecurityError" || e.name === "QuotaExceededError"
      ? "Allow browser storage for this site so your participant session can be saved."
      : e instanceof TypeError ? "Could not reach the response server. Check your connection and try again." : e.message;
  } finally { busy = false; render(); }
}

function download() {
  const rows = session.assignments.map(item => ({participant_id:session.participantId,tweet_id:item.tweetId,tweet_text:item.text,position:item.position,selected_emotion:item.label,submitted_at:item.submittedAt}));
  const keys = Object.keys(rows[0]);
  const cell = value => `"${String(value ?? "").replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""')}"`;
  const csv = [keys.map(cell).join(","), ...rows.map(row => keys.map(key => cell(row[key])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8"}));
  const link = document.createElement("a"); link.href = url; link.download = `responses-${session.participantId}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

void refresh();
