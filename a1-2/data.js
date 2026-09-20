const API = "https://emotion-study-a1-rick.rickliu131.chatgpt.site/api/pages/records";
const main = document.getElementById("collected-data");
const summary = document.getElementById("summary");
const responses = document.getElementById("responses");
const errorMessage = document.getElementById("error");
const refreshButton = document.getElementById("refresh");
const exportButton = document.getElementById("export");
let rows = null;

function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

async function load() {
  main.setAttribute("aria-busy", "true");
  refreshButton.disabled = true;
  refreshButton.textContent = "Loading…";
  errorMessage.hidden = true;
  try {
    const response = await fetch(API, { credentials: "omit", cache: "no-store" });
    if (!response.ok) throw new Error("Could not load responses. Please try Refresh.");
    const data = await response.json();
    if (!Array.isArray(data.records)) throw new Error("Could not load responses. Please try Refresh.");
    rows = data.records;
    const participants = new Set(rows.map(row => row.participant_id)).size;
    summary.textContent = `${rows.length} saved labels · ${participants} participant${participants === 1 ? "" : "s"} with responses`;
    responses.innerHTML = rows.length ? `<div class="table-wrap" role="region" aria-label="Saved responses" tabindex="0"><table>
      <thead><tr><th scope="col">Participant ID</th><th scope="col">Tweet ID</th><th scope="col">Tweet text</th><th scope="col">Selected emotion</th><th scope="col">Saved at (UTC)</th></tr></thead>
      <tbody>${rows.map(row => `<tr><td class="mono">${escape(row.participant_id)}</td><td class="mono">${escape(row.tweet_id)}</td><td class="tweet-cell">${escape(row.tweet_text)}</td><td class="emotion">${escape(row.selected_emotion)}</td><td class="time">${escape(row.submitted_at.slice(0, 10))}<br>${escape(row.submitted_at.slice(11, 19))}</td></tr>`).join("")}</tbody>
    </table></div>` : "<p>No responses yet. Complete a participant session to see the collected data here.</p>";
    exportButton.disabled = !rows.length;
    document.getElementById("csv-note").hidden = !rows.length;
  } catch (error) {
    if (rows === null) summary.textContent = "Responses could not be loaded.";
    errorMessage.textContent = error instanceof TypeError ? "Could not connect. Please check your connection and try Refresh." : error.message;
    errorMessage.hidden = false;
  } finally {
    main.setAttribute("aria-busy", "false");
    refreshButton.disabled = false;
    refreshButton.textContent = "Refresh";
  }
}

function exportCsv() {
  if (!rows?.length) return;
  const columns = ["participant_id", "tweet_id", "tweet_text", "selected_emotion", "submitted_at", "position", "reference_emotion", "session_started_at", "session_completed_at"];
  const cell = value => {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = [columns.join(","), ...rows.map(row => columns.map(key => cell(row[key])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "emotion-study-responses.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

refreshButton.addEventListener("click", load);
exportButton.addEventListener("click", exportCsv);
load();
