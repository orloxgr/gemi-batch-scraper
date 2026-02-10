// ==UserScript==
// @name         GEMI Scraper V4 (Industrial | IndexedDB | Turbo)
// @namespace    https://publicity.businessportal.gr/
// @version      4.0.0
// @description  Industrial scale scraper. Uses IndexedDB for unlimited queue size (200k+ URLs), Turbo speed (1.5s), and split KAD columns.
// @match        https://publicity.businessportal.gr/company/*
// @run-at       document-start
// @grant        GM_download
// ==/UserScript==

(function () {
  "use strict";

  /********************************************************************
   * CONFIGURATION (TURBO MODE)
   ********************************************************************/
  const CONFIG = {
    CHUNK_SIZE: 50,      // Export & Clear memory every 50 rows
    DELAY_MIN_MS: 1000,  // Fast: 1.0 second
    DELAY_MAX_MS: 1500   // Fast: 1.5 seconds
  };

  /********************************************************************
   * 0) NO-REDIRECT SHIELD
   ********************************************************************/
  (function noRedirectShield() {
    const isAllowed = (u) => {
      try {
        const s = String(u || "");
        return s.includes("/company/") || s.startsWith("blob:");
      } catch (_) { return false; }
    };
    const blockLog = (type, u) => { try { console.warn("[SHIELD] Blocked:", type, u); } catch (_) {} };

    const _pushState = history.pushState.bind(history);
    const _replaceState = history.replaceState.bind(history);

    history.pushState = function (state, title, url) {
      if (url && !isAllowed(url)) { blockLog("history.pushState", url); return; }
      return _pushState(state, title, url);
    };
    history.replaceState = function (state, title, url) {
      if (url && !isAllowed(url)) { blockLog("history.replaceState", url); return; }
      return _replaceState(state, title, url);
    };

    document.addEventListener("click", function (e) {
      const a = e.target && e.target.closest ? e.target.closest("a") : null;
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (href && !href.startsWith("#") && !isAllowed(href)) {
        e.preventDefault(); e.stopPropagation();
        blockLog("anchor.click", href);
      }
    }, true);
  })();

  /********************************************************************
   * 1) INDEXED DB MANAGER (Handles 200k+ URLs)
   ********************************************************************/
  const DB_NAME = "GEMI_TURBO_DB";
  const DB_VERSION = 1;
  const STORE_NAME = "scraper_state";

  const IDB = {
    open: () => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    get: async (key) => {
      const db = await IDB.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    set: async (key, val) => {
      const db = await IDB.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const req = tx.objectStore(STORE_NAME).put(val, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    clear: async () => {
      const db = await IDB.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const req = tx.objectStore(STORE_NAME).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  };

  /********************************************************************
   * 2) UTILITIES
   ********************************************************************/
  const UI_ID = "gemi-batch-ui-v4";

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function randDelay(min, max) { return Math.floor(Math.random() * (max - min + 1) + min); }
  function clean(s) { return (s || "").replace(/\s+/g, " ").trim(); }
  function nowISO() { return new Date().toISOString(); }
  function safeJson(v) { try { return JSON.stringify(v); } catch (_) { return "[]"; } }

  function csvEscape(v) {
    const s = v === null || v === undefined ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function toCSV(rows, headers) {
    const out = [];
    out.push(headers.map(csvEscape).join(","));
    for (const r of rows) out.push(headers.map((h) => csvEscape(r[h])).join(","));
    return out.join("\n");
  }

  function downloadCSV(filename, csvText, uiLog) {
    const bomCtx = "\uFEFF" + csvText;
    try {
      if (typeof GM_download === "function") {
        const blob = new Blob([bomCtx], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        GM_download({
          url,
          name: filename,
          saveAs: true,
          onload: () => { setTimeout(() => URL.revokeObjectURL(url), 1000); },
          onerror: () => {
            uiLog && uiLog("[download] GM_download failed, trying Blob...");
            downloadViaBlob(filename, bomCtx, uiLog);
          }
        });
        return true;
      }
    } catch (_) {}
    return downloadViaBlob(filename, bomCtx, uiLog);
  }

  function downloadViaBlob(filename, content, uiLog) {
    try {
      const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 2000);
      return true;
    } catch (e) {
      uiLog && uiLog("[download] Blob blocked. Copy from CSV box.");
      return false;
    }
  }

  function normalizeCompanyUrl(u) {
    if (!u) return null;
    let s = String(u).trim();
    if (/^\d{12}$/.test(s)) s = "https://publicity.businessportal.gr/company/" + s;
    if (s.startsWith("http://")) s = "https://" + s.slice(7);
    return s;
  }

  function getCompanyIdFromUrl(u) {
    const m = String(u || "").match(/\/company\/(\d{12})/);
    return m ? m[1] : null;
  }

  /********************************************************************
   * 3) STATE LOGIC (ASYNC DB)
   ********************************************************************/
  async function loadState() {
    // We load two things: the 'metadata' and the 'urls' list
    const meta = await IDB.get("meta");
    const urls = await IDB.get("urls");

    if (meta && urls) return { ...meta, urls };
    return null;
  }

  async function saveState(state) {
    // We split saving to keep it fast. We rarely change the URL list.
    const { urls, ...meta } = state;
    await IDB.set("meta", meta);
    // Only save URLs if we just loaded them (optimization)
    if(state._urls_changed) {
        await IDB.set("urls", urls);
        state._urls_changed = false;
    }
  }

  async function ensureStateSkeleton() {
    const st = await loadState();
    if (st && st.v === 4.0) return st;

    return {
      v: 4.0,
      running: false,
      idx: 0,
      urls: [],       // This will hold 200k+ strings
      rows: [],       // Current memory chunk
      total_saved: 0,
      last_url: "",
      chunk_counter: 1,
      _urls_changed: true
    };
  }

  async function resetState() { await IDB.clear(); }

  /********************************************************************
   * 4) EXTRACTORS
   ********************************************************************/
  async function ensureAccordionOpenById(id) {
    const root = document.querySelector("#" + CSS.escape(id));
    if (!root) return null;
    if (!root.classList.contains("Mui-expanded")) {
      const btn = root.querySelector(".MuiAccordionSummary-root");
      if (btn) {
        btn.click();
        await sleep(300); // Tighter timing for Turbo
      }
    }
    return root;
  }

  function findAccordionByText(text) {
    const accs = Array.from(document.querySelectorAll(".MuiAccordion-root"));
    return accs.find(a => (a.textContent || "").toLowerCase().includes(text.toLowerCase()));
  }

  async function openAllSections() {
    await ensureAccordionOpenById("moreInfo");
    await ensureAccordionOpenById("Persons");
    await ensureAccordionOpenById("Activity");

    // Fallbacks
    const contact = findAccordionByText("Στοιχεία Επικοινωνίας");
    if(contact && !contact.classList.contains("Mui-expanded")) { contact.querySelector("div[role=button]")?.click(); await sleep(200); }

    const activity = findAccordionByText("Δραστηριότητα");
    if(activity && !activity.classList.contains("Mui-expanded")) { activity.querySelector("div[role=button]")?.click(); await sleep(200); }
  }

  function extractBasic() {
    const out = {
      url: location.href,
      company_id: getCompanyIdFromUrl(location.href) || "",
      gemi: "", afm: "", legal_form: "", status: "", name_latin: "", address: ""
    };

    const scanRows = document.querySelectorAll("table tr");
    for (const tr of scanRows) {
      const tds = tr.querySelectorAll("td");
      if (tds.length < 2) continue;
      const label = clean(tds[0].textContent);
      const value = clean(tds[1].textContent);

      if (label.includes("Αριθμός ΓΕΜΗ")) out.gemi = value;
      else if (label === "ΑΦΜ" || label.includes("ΑΦΜ")) out.afm = value;
      else if (label.includes("Νομική Μορφή")) out.legal_form = value;
      else if (label.includes("Κατάσταση")) out.status = value;
      else if (label.includes("Επωνυμία με λατινικούς")) out.name_latin = value;
      else if (label.includes("Διεύθυνση")) out.address = value;
    }

    // Correct SuspensionInfo Status
    const suspBox = document.getElementById("SuspensionInfo");
    if (suspBox) {
        const table = suspBox.querySelector("table");
        if (table) {
            const rows = table.querySelectorAll("tr");
            if (rows.length >= 2) {
                const tds = rows[1].querySelectorAll("td");
                if (tds.length >= 2) {
                    out.status = `${clean(tds[0].textContent)} - ${clean(tds[1].textContent)}`;
                }
            }
        }
    }
    return out;
  }

  function extractContact() {
    const emailA = document.querySelector("a[href^='mailto:']");
    const telA = document.querySelector("a[href^='tel:']");
    return {
      email: emailA ? clean(emailA.textContent) : "",
      phone: telA ? clean(telA.textContent) : ""
    };
  }

  function extractPartners() {
    const persons = [];
    const tables = document.querySelectorAll("#Persons table, table[aria-label*='Persons']");
    tables.forEach(table => {
      const rows = table.querySelectorAll("tbody tr");
      rows.forEach(tr => {
        const tds = tr.querySelectorAll("td");
        if (tds.length === 0) return;
        const nameNode = tr.querySelector("p");
        if (!nameNode) return;

        const p = { name: clean(nameNode.textContent), role: "", pct: "" };
        if (tds.length >= 4) p.role = clean(tds[3].textContent);
        if (tds.length >= 5) p.pct = clean(tds[4].textContent);
        persons.push(p);
      });
    });

    const uniq = persons.filter((v,i,a)=>a.findIndex(t=>(t.name===v.name && t.role===v.role))===i);
    return { partners_json: safeJson(uniq) };
  }

  function extractKAD() {
    let kad_main_code = "";
    let kad_main_desc = "";
    let kad_sec = [];

    const tables = document.querySelectorAll("table");
    tables.forEach(tbl => {
        const header = (tbl.querySelector("thead")?.textContent || "").toLowerCase();
        const rows = tbl.querySelectorAll("tbody tr");

        if (header.includes("κύριος") || header.includes("main")) {
            const tds = rows[0]?.querySelectorAll("td");
            if (tds && tds.length > 1) {
                kad_main_code = clean(tds[0].textContent);
                kad_main_desc = clean(tds[1].textContent);
            }
        }
        else if (header.includes("δευτερεύοντες") || header.includes("secondary")) {
            rows.forEach(r => {
                const tds = r.querySelectorAll("td");
                if (tds.length > 1) {
                    kad_sec.push(clean(tds[0].textContent) + "|" + clean(tds[1].textContent));
                }
            });
        }
    });

    return {
        kad_main_code,
        kad_main_desc,
        kad_secondary_json: safeJson(kad_sec)
    };
  }

  async function extractAllData() {
    await openAllSections();

    const basic = extractBasic();
    const contact = extractContact();
    const part = extractPartners();
    const kad = extractKAD();

    return {
      ...basic,
      email: contact.email,
      phone: contact.phone,
      partners_json: part.partners_json,
      kad_main_code: kad.kad_main_code,
      kad_main_description: kad.kad_main_desc,
      kad_secondary_json: kad.kad_secondary_json,
      scraped_at: nowISO()
    };
  }

  /********************************************************************
   * 5) EXPORT ENGINE
   ********************************************************************/
  function buildCSV(rows) {
    const headers = [
      "company_id", "gemi", "afm", "legal_form", "status", "name_latin",
      "address", "email", "phone",
      "kad_main_code", "kad_main_description",
      "partners_json", "kad_secondary_json",
      "url", "scraped_at"
    ];
    return { headers, csv: toCSV(rows, headers) };
  }

  async function handleAutoExport(state, ui) {
    if (state.rows.length >= CONFIG.CHUNK_SIZE) {
        const { csv } = buildCSV(state.rows);
        const filename = `GEMI_Export_Part${state.chunk_counter}_${nowISO().slice(0,10)}.csv`;

        const success = downloadCSV(filename, csv, ui.log);

        if (success) {
            ui.log(`[Auto-Save] Saved ${filename} (${state.rows.length} rows)`);
            state.total_saved += state.rows.length;
            state.rows = []; // Clean RAM
            state.chunk_counter++;
            await saveState(state); // Update DB
            return true;
        } else {
            ui.log(`[Error] Auto-save failed. Memory not cleared.`);
            return false;
        }
    }
    return false;
  }

  /********************************************************************
   * 6) MAIN LOOP
   ********************************************************************/
  async function runOne(st) {
    const ui = window.__GEMI_UI__;

    // Page load waiter
    let attempts = 0;
    while (!document.querySelector("table") && attempts < 25) {
        await sleep(200);
        attempts++;
    }

    const data = await extractAllData();

    st.rows.push(data);
    st.idx++;
    st.last_url = location.href;
    await saveState(st);

    ui.log(`[OK] ${data.company_id} | AFM:${data.afm} | KAD:${data.kad_main_code}`);
    ui.setProgress(st.idx, st.urls.length, st.total_saved + st.rows.length);

    await handleAutoExport(st, ui);

    if (st.idx < st.urls.length) {
        // TURBO SPEED DELAY
        const wait = randDelay(CONFIG.DELAY_MIN_MS, CONFIG.DELAY_MAX_MS);
        ui.setPill(`WAIT ${wait}ms`, "#64748b");
        await sleep(wait);

        ui.setPill("NEXT", "#1f6feb");
        window.location.assign(st.urls[st.idx]);
    } else {
        st.running = false;
        await saveState(st);
        ui.setPill("DONE", "#2e7d32");
        ui.log("[DONE] All URLs processed.");

        if (st.rows.length > 0) {
             const { csv } = buildCSV(st.rows);
             downloadCSV(`GEMI_Export_FINAL_${nowISO().slice(0,10)}.csv`, csv, ui.log);
        }
    }
  }

  /********************************************************************
   * 7) UI BUILDER
   ********************************************************************/
  function buildUI() {
    if (document.getElementById(UI_ID)) return;
    const div = document.createElement("div");
    div.id = UI_ID;
    div.style.cssText = "position:fixed; top:10px; right:10px; width:360px; background:#1e1e1e; color:#eee; z-index:999999; padding:15px; border-radius:8px; font-family:sans-serif; box-shadow:0 10px 30px rgba(0,0,0,0.5); font-size:12px;";

    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <b style="font-size:14px;">GEMI Turbo V4.0</b>
        <span id="gemi-pill" style="background:#444; padding:2px 8px; border-radius:10px; font-weight:bold;">IDLE</span>
      </div>

      <input type="file" id="gemi-file" accept=".txt,.csv" style="width:100%; margin-bottom:10px; padding:5px; background:#333; border:none; color:#fff;">
      <div style="font-size:10px; color:#aaa; margin-bottom:8px;">Supports large files (200k+ URLs) via IndexedDB.</div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">
        <button id="gemi-start" style="padding:8px; background:#2fa4e7; border:none; border-radius:4px; color:#fff; cursor:pointer; font-weight:bold;">START / RESUME</button>
        <button id="gemi-stop" style="padding:8px; background:#d9534f; border:none; border-radius:4px; color:#fff; cursor:pointer; font-weight:bold;">STOP</button>
      </div>

      <div style="background:#111; padding:8px; border-radius:4px; margin-bottom:10px;">
         <div style="display:flex; justify-content:space-between;">
            <span>Progress:</span>
            <span id="gemi-prog" style="font-weight:bold; color:#2fa4e7;">0 / 0</span>
         </div>
         <div style="display:flex; justify-content:space-between;">
            <span>Total Saved:</span>
            <span id="gemi-saved" style="font-weight:bold; color:#5cb85c;">0</span>
         </div>
         <div style="font-size:10px; color:#777; margin-top:4px;">Speed: ${CONFIG.DELAY_MIN_MS}-${CONFIG.DELAY_MAX_MS}ms | Chunk: ${CONFIG.CHUNK_SIZE}</div>
      </div>

      <div id="gemi-log" style="height:120px; overflow-y:auto; background:#000; padding:5px; font-family:monospace; border:1px solid #444; color:#ccc;"></div>

      <div style="margin-top:10px; text-align:right;">
         <button id="gemi-reset" style="background:transparent; border:none; color:#777; cursor:pointer; text-decoration:underline;">Hard Reset (Clear DB)</button>
         <button id="gemi-dl-current" style="background:transparent; border:none; color:#5cb85c; cursor:pointer; text-decoration:underline; margin-left:10px;">Download Pending</button>
      </div>
    `;

    document.body.appendChild(div);

    const $ = (s) => div.querySelector(s);
    const ui = {
        log: (m) => { const l = $("#gemi-log"); l.innerHTML += `<div>${m}</div>`; l.scrollTop = l.scrollHeight; },
        setPill: (t, c) => { const p = $("#gemi-pill"); p.textContent = t; p.style.background = c; },
        setProgress: (idx, total, saved) => {
            $("#gemi-prog").textContent = `${idx} / ${total}`;
            if(saved !== undefined) $("#gemi-saved").textContent = saved;
        }
    };
    window.__GEMI_UI__ = ui;

    $("#gemi-start").onclick = async () => {
        let st = await ensureStateSkeleton();
        const file = $("#gemi-file").files[0];

        if (file) {
            ui.log("Reading file... (this may take 5-10s for 200k lines)");
            const text = await file.text();
            const urls = text.split("\n").map(normalizeCompanyUrl).filter(Boolean);

            st.urls = urls;
            st.idx = 0;
            st.rows = [];
            st.total_saved = 0;
            st.chunk_counter = 1;
            st._urls_changed = true;
            ui.log(`Loaded ${urls.length} URLs into IndexedDB.`);
        } else if (st.urls.length === 0) {
            return ui.log("Error: No file selected and no saved state.");
        }

        st.running = true;
        await saveState(st);

        const target = st.urls[st.idx];
        if (target && normalizeCompanyUrl(location.href) !== target) {
            window.location.assign(target);
        } else {
            runOne(st);
        }
    };

    $("#gemi-stop").onclick = async () => {
        const st = await ensureStateSkeleton();
        st.running = false;
        await saveState(st);
        ui.setPill("STOPPED", "#d9534f");
    };

    $("#gemi-reset").onclick = async () => {
        if(confirm("HARD RESET: This will delete the entire 200k queue from Database. Confirm?")) {
            await resetState();
            location.reload();
        }
    };

    $("#gemi-dl-current").onclick = async () => {
        const st = await ensureStateSkeleton();
        if(st.rows.length) {
            const {csv} = buildCSV(st.rows);
            downloadCSV(`Manual_Dump_${nowISO().slice(0,10)}.csv`, csv, ui.log);
        } else {
            ui.log("No pending rows in memory.");
        }
    };
  }

  /********************************************************************
   * 8) BOOTSTRAP
   ********************************************************************/
  function init() {
     const t = setInterval(async () => {
        if(!document.body) return;
        clearInterval(t);

        buildUI();
        const st = await ensureStateSkeleton();

        if(window.__GEMI_UI__) {
            window.__GEMI_UI__.setProgress(st.idx, st.urls.length, st.total_saved);
            if(st.running) {
                const target = st.urls[st.idx];
                const current = normalizeCompanyUrl(location.href);
                if (target && current !== target) {
                    window.__GEMI_UI__.log("Navigating to next index...");
                    window.location.assign(target);
                } else {
                    runOne(st);
                }
            }
        }
     }, 100);
  }

  init();

})();