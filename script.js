/**
 * WA Admin Dashboard  ·  script.js
 * ─────────────────────────────────
 * • SPA navigation
 * • Full localStorage persistence (leads, config, rules, prefs)
 * • API integration with graceful fallback to local storage
 * • Settings: Twilio config, editable rules (add/edit/delete), preferences
 */

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE  –  all localStorage keys in one place
// ═══════════════════════════════════════════════════════════════════════════
const LS = {
  LEADS:  "wa_leads",
  CONFIG: "wa_config",
  RULES:  "wa_rules",
  PREFS:  "wa_prefs",
};

const store = {
  get:    key      => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set:    (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} },
  remove: key      => { try { localStorage.removeItem(key); } catch {} },
};

// ─── Defaults ───────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = { sid:"", token:"", phone:"", botName:"StudyBot", apiBase:"http://localhost:5000" };

const DEFAULT_RULES = [
  { id:"r1", keywords:["hi","hello","hey","hii","namaste"],          reply:"👋 Welcome! I'm your virtual assistant.\n\nCould you please tell me your *name*? 😊", type:"contains" },
  { id:"r2", keywords:["fees","price","cost","charges"],             reply:"💰 *Fee Structure*\n\n• Foundation: ₹15,000/yr\n• Standard: ₹25,000/yr\n• Premium: ₹40,000/yr\n\nAll plans include study material & doubt sessions.", type:"contains" },
  { id:"r3", keywords:["hostel","accommodation","room","pg","stay"], reply:"🏠 *Hostel Info*\n\n• Boys: ₹8,000/month\n• Girls: ₹8,500/month\n• Facilities: WiFi, AC, Mess, Gym\n\nLimited seats — contact +91-XXXXXXXXXX.", type:"contains" },
  { id:"r4", keywords:["unknown"],                                   reply:"🙏 We received your message. Our team will contact you shortly. ✅\n\nAsk about *fees* or *hostel* anytime.", type:"fallback" },
];

const DEFAULT_PREFS = { newLeadAlert:true, sound:false, autoRefresh:true, darkSidebar:true };

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS  module
// ═══════════════════════════════════════════════════════════════════════════
const Settings = (() => {
  let editingRuleId = null;

  function load() {
    const cfg   = store.get(LS.CONFIG) || DEFAULT_CONFIG;
    const prefs = store.get(LS.PREFS)  || DEFAULT_PREFS;
    setVal("cfgSid",     cfg.sid);
    setVal("cfgToken",   cfg.token);
    setVal("cfgPhone",   cfg.phone);
    setVal("cfgBotName", cfg.botName || "StudyBot");
    setVal("cfgApiBase", cfg.apiBase || "http://localhost:5000");
    const base = cfg.apiBase || "http://localhost:5000";
    const webhookEl = document.getElementById("webhookUrl");
    if (webhookEl) webhookEl.textContent = base + "/webhook";
    setCheck("togNewLead",        prefs.newLeadAlert !== false);
    setCheck("togSound",          !!prefs.sound);
    setCheck("autoRefreshToggle", prefs.autoRefresh  !== false);
    setCheck("togDarkSidebar",    prefs.darkSidebar  !== false);
    if (!store.get(LS.RULES)) store.set(LS.RULES, DEFAULT_RULES);
    renderRules();
  }

  function saveTwilio() {
    const cfg = {
      sid:     getVal("cfgSid"),
      token:   getVal("cfgToken"),
      phone:   getVal("cfgPhone"),
      botName: getVal("cfgBotName"),
      apiBase: getVal("cfgApiBase") || "http://localhost:5000",
    };
    store.set(LS.CONFIG, cfg);
    const el = document.getElementById("webhookUrl");
    if (el) el.textContent = cfg.apiBase + "/webhook";
    flashBadge("twilioSavedBadge");
    App.toast("✅ Twilio config saved locally!");
  }

  function saveWebhook() {
    const cfg = store.get(LS.CONFIG) || DEFAULT_CONFIG;
    cfg.apiBase = getVal("cfgApiBase") || "http://localhost:5000";
    store.set(LS.CONFIG, cfg);
    const el = document.getElementById("webhookUrl");
    if (el) el.textContent = cfg.apiBase + "/webhook";
    flashBadge("webhookSavedBadge");
    App.toast("✅ Webhook config saved!");
  }

  function savePrefs() {
    const prefs = {
      newLeadAlert: getCheck("togNewLead"),
      sound:        getCheck("togSound"),
      autoRefresh:  getCheck("autoRefreshToggle"),
      darkSidebar:  getCheck("togDarkSidebar"),
    };
    store.set(LS.PREFS, prefs);
    flashBadge("prefsSavedBadge");
    App.toast("✅ Preferences saved!");
  }

  function renderRules() {
    const rules = store.get(LS.RULES) || DEFAULT_RULES;
    const container = document.getElementById("rulesContainer");
    if (!container) return;
    if (!rules.length) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:20px">No rules yet. Click &quot;+ Add Rule&quot;.</p>';
      return;
    }
    container.innerHTML = rules.map((r, i) => {
      const chips = r.type === "fallback"
        ? '<span class="rule-kw-chip fallback">✦ fallback</span>'
        : r.keywords.map(k => '<span class="rule-kw-chip">' + esc(k) + '</span>').join("");
      const typeBadge = { contains:"contains", exact:"exact match", fallback:"catch-all" }[r.type] || r.type;
      return '<div class="rule-card" style="animation-delay:' + (i*40) + 'ms">' +
        '<div class="rule-card-body">' +
          '<div class="rule-card-keywords">' + chips + '</div>' +
          '<div class="rule-card-reply">' + esc(r.reply) + '</div>' +
        '</div>' +
        '<span class="rule-type-badge">' + typeBadge + '</span>' +
        '<div style="display:flex;flex-direction:column;gap:5px">' +
          '<button class="btn-rule-edit" title="Edit" onclick="Settings.editRule(\'' + r.id + '\')">✏️</button>' +
          '<button class="btn-rule-del"  title="Delete" onclick="Settings.deleteRule(\'' + r.id + '\')">🗑</button>' +
        '</div></div>';
    }).join("");
  }

  function showAddRule() {
    editingRuleId = null;
    document.getElementById("ruleModalTitle").textContent = "Add Auto-Reply Rule";
    setVal("ruleKeywords", ""); setVal("ruleReply", "");
    document.getElementById("ruleType").value = "contains";
    document.getElementById("addRuleModal").classList.add("show");
    setTimeout(() => document.getElementById("ruleKeywords").focus(), 100);
  }

  function editRule(id) {
    const rules = store.get(LS.RULES) || [];
    const rule  = rules.find(r => r.id === id);
    if (!rule) return;
    editingRuleId = id;
    document.getElementById("ruleModalTitle").textContent = "Edit Rule";
    setVal("ruleKeywords", rule.keywords.join(", "));
    setVal("ruleReply",    rule.reply);
    document.getElementById("ruleType").value = rule.type;
    document.getElementById("addRuleModal").classList.add("show");
  }

  function saveRule() {
    const keywords = getVal("ruleKeywords").split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
    const reply    = getVal("ruleReply").trim();
    const type     = document.getElementById("ruleType").value;
    if (type !== "fallback" && !keywords.length) { App.toast("⚠️ Add at least one keyword."); return; }
    if (!reply) { App.toast("⚠️ Reply message cannot be empty."); return; }
    let rules = store.get(LS.RULES) || [];
    if (editingRuleId) {
      rules = rules.map(r => r.id === editingRuleId ? { ...r, keywords, reply, type } : r);
      App.toast("✏️ Rule updated!");
    } else {
      rules.push({ id: "r" + Date.now(), keywords, reply, type });
      App.toast("✅ Rule added!");
    }
    store.set(LS.RULES, rules);
    closeRuleModal();
    renderRules();
  }

  function deleteRule(id) {
    if (!confirm("Delete this rule?")) return;
    let rules = (store.get(LS.RULES) || []).filter(r => r.id !== id);
    store.set(LS.RULES, rules);
    renderRules();
    App.toast("🗑 Rule deleted.");
  }

  function closeRuleModal() {
    document.getElementById("addRuleModal").classList.remove("show");
    editingRuleId = null;
  }

  function clearLeads() {
    if (!confirm("Delete ALL leads from local storage? Cannot be undone.")) return;
    store.remove(LS.LEADS);
    App.toast("🗑 All local leads cleared.");
  }

  function resetAll() {
    if (!confirm("Reset ALL settings (config, rules, preferences) to defaults?")) return;
    [LS.CONFIG, LS.RULES, LS.PREFS].forEach(k => store.remove(k));
    store.set(LS.RULES, DEFAULT_RULES);
    load();
    App.toast("♻️ Settings reset to defaults.");
  }

  function flashBadge(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2500);
  }

  function initEye() {
    const btn   = document.getElementById("toggleTokenEye");
    const input = document.getElementById("cfgToken");
    if (btn && input && !btn._bound) {
      btn._bound = true;
      btn.addEventListener("click", () => {
        input.type = input.type === "password" ? "text" : "password";
        btn.textContent = input.type === "password" ? "👁" : "🙈";
      });
    }
  }

  return { load, saveTwilio, saveWebhook, savePrefs, renderRules, showAddRule, editRule, saveRule, deleteRule, closeRuleModal, clearLeads, resetAll, initEye };
})();


// ═══════════════════════════════════════════════════════════════════════════
// APP  module
// ═══════════════════════════════════════════════════════════════════════════
const App = (() => {
  let allLeads     = [];
  let refreshTimer = null;
  let prevCount    = null;

  function getApiBase() {
    const cfg = store.get(LS.CONFIG);
    return (cfg && cfg.apiBase) ? cfg.apiBase : "http://localhost:5000";
  }

  function toast(msg, duration = 3200) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove("show"), duration);
  }

  function navigate(page) {
    document.querySelectorAll(".nav-item").forEach(el =>
      el.classList.toggle("active", el.dataset.page === page));
    document.querySelectorAll(".page").forEach(el =>
      el.classList.toggle("active", el.id === "page-" + page));
    const titles = { dashboard:"Dashboard", leads:"Leads", chat:"Chat Viewer", settings:"Settings" };
    const titleEl = document.getElementById("pageTitle");
    if (titleEl) titleEl.textContent = titles[page] || page;
    if (page === "dashboard") loadDashboard();
    if (page === "leads")     loadLeads();
    if (page === "chat")      loadChatContacts();
    if (page === "settings")  { Settings.load(); Settings.initEye(); }
  }

  async function apiFetch(path, opts) {
    try {
      const res  = await fetch(getApiBase() + path, { signal: AbortSignal.timeout(5000), ...(opts||{}) });
      const data = await res.json();
      return { ok: res.ok, data };
    } catch { return { ok: false, data: null }; }
  }

  function saveLeadsLocal(leads) { store.set(LS.LEADS, leads); }
  function getLeadsLocal()       { return store.get(LS.LEADS) || []; }

  // ─── DASHBOARD ────────────────────────────────────────────────────────────
  async function loadDashboard() {
    const { ok, data } = await apiFetch("/stats");
    if (ok && data) {
      renderStats(data);
      renderRecentList(data.recent || []);
      drawChart(data.new, data.contacted, data.closed);
      const { ok:ok2, data:ld } = await apiFetch("/leads");
      if (ok2 && ld) saveLeadsLocal(ld.leads || []);
      const prefs = store.get(LS.PREFS) || DEFAULT_PREFS;
      if (prevCount !== null && data.total > prevCount && prefs.newLeadAlert !== false) {
        const diff = data.total - prevCount;
        toast("🔔 " + diff + " new lead" + (diff>1?"s":"") + " arrived!");
        showNotifBadge(diff);
      }
      prevCount = data.total;
    } else {
      const leads = getLeadsLocal();
      const newC  = leads.filter(l=>l.status==="new").length;
      const con   = leads.filter(l=>l.status==="contacted").length;
      const clo   = leads.filter(l=>l.status==="closed").length;
      renderStats({ total:leads.length, new:newC, contacted:con, closed:clo });
      const recent = [...leads].sort((a,b)=>(b.updated_at||"").localeCompare(a.updated_at||"")).slice(0,5);
      renderRecentList(recent);
      drawChart(newC, con, clo);
    }
  }

  function renderStats({ total, new:n, contacted, closed }) {
    animateCount("statTotal",     total);
    animateCount("statNew",       n);
    animateCount("statContacted", contacted);
    animateCount("statClosed",    closed);
  }

  function animateCount(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const start = parseInt(el.textContent)||0;
    const steps = 28; let i = 0;
    const tick = () => { i++; el.textContent = Math.round(start + (target-start)*(i/steps)); if(i<steps) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  function renderRecentList(leads) {
    const container = document.getElementById("recentList");
    if (!container) return;
    if (!leads.length) { container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px">No activity yet.</p>'; return; }
    container.innerHTML = leads.map((l,i) =>
      '<div class="recent-item" style="animation-delay:' + (i*55) + 'ms" onclick="App.openChatFor(\'' + l.id + '\')">' +
        '<div class="recent-avatar">' + initials(l.name) + '</div>' +
        '<div class="recent-info">' +
          '<div class="recent-name">' + esc(l.name) + '</div>' +
          '<div class="recent-msg">'  + esc(l.last_message) + '</div>' +
        '</div>' +
        '<div class="recent-time">' + relativeTime(l.updated_at) + '</div>' +
      '</div>').join("");
  }

  function drawChart(newC, contacted, closed) {
    const canvas = document.getElementById("statusChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const total = newC + contacted + closed || 1;
    const data  = [
      { label:"New",       value:newC,      color:"#38bdf8" },
      { label:"Contacted", value:contacted, color:"#facc15" },
      { label:"Closed",    value:closed,    color:"#34d399" },
    ];
    canvas.width = 320; canvas.height = 180;
    ctx.clearRect(0,0,320,180);
    const barW=58, gap=24, startX=34, maxH=120, baseY=150;
    data.forEach((d,i) => {
      const x=startX+i*(barW+gap), h=(d.value/total)*maxH;
      ctx.fillStyle="rgba(0,0,0,.04)"; ctx.beginPath(); ctx.roundRect(x,baseY-maxH,barW,maxH,6); ctx.fill();
      ctx.fillStyle=d.color; ctx.beginPath(); ctx.roundRect(x,baseY-h,barW,h,6); ctx.fill();
      ctx.fillStyle="#111"; ctx.font="bold 18px Syne,sans-serif"; ctx.textAlign="center";
      ctx.fillText(d.value, x+barW/2, baseY-h-8);
      ctx.fillStyle="#888"; ctx.font="12px DM Sans,sans-serif";
      ctx.fillText(d.label, x+barW/2, baseY+16);
    });
  }

  // ─── LEADS ────────────────────────────────────────────────────────────────
  async function loadLeads(search, status) {
    search = search || ""; status = status || "";
    const tbody = document.getElementById("leadsTableBody");
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="empty-row"><div class="loader"></div> Loading…</td></tr>';
    const qs = new URLSearchParams();
    if (search) qs.set("search", search);
    if (status) qs.set("status", status);
    const { ok, data } = await apiFetch("/leads?" + qs);
    if (ok && data) {
      allLeads = data.leads || [];
      saveLeadsLocal(allLeads);
    } else {
      let leads = getLeadsLocal();
      if (search) leads = leads.filter(l => (l.name||"").toLowerCase().includes(search) || (l.phone||"").toLowerCase().includes(search) || (l.last_message||"").toLowerCase().includes(search));
      if (status) leads = leads.filter(l => l.status === status);
      allLeads = leads;
    }
    renderTable(allLeads);
  }

  function renderTable(leads) {
    const tbody = document.getElementById("leadsTableBody");
    if (!tbody) return;
    if (!leads.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No leads found.</td></tr>'; return; }
    tbody.innerHTML = leads.map((l,i) =>
      '<tr style="animation:fadeSlide .22s ease ' + (i*28) + 'ms both">' +
        '<td style="color:var(--text-muted);font-size:12px">' + (i+1) + '</td>' +
        '<td><strong>' + esc(l.name) + '</strong></td>' +
        '<td style="font-family:monospace;font-size:13px">' + esc(l.phone) + '</td>' +
        '<td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(l.last_message||"—") + '</td>' +
        '<td><select class="filter-select" style="padding:4px 8px;font-size:12px" onchange="App.updateStatus(\'' + l.id + '\',this.value)">' +
          '<option value="new"       ' + (l.status==="new"?"selected":"")       + '>🆕 New</option>' +
          '<option value="contacted" ' + (l.status==="contacted"?"selected":"") + '>📞 Contacted</option>' +
          '<option value="closed"    ' + (l.status==="closed"?"selected":"")    + '>✅ Closed</option>' +
        '</select></td>' +
        '<td style="color:var(--text-muted);font-size:12px">' + formatDate(l.created_at) + '</td>' +
        '<td><div class="action-btns">' +
          '<button class="btn-icon view" title="View chat" onclick="App.openChatFor(\'' + l.id + '\')">💬</button>' +
          '<button class="btn-icon del"  title="Delete"    onclick="App.deleteLead(\'' + l.id + '\')">🗑</button>' +
        '</div></td>' +
      '</tr>').join("");
  }

  function showAddModal()  { document.getElementById("addLeadModal")?.classList.add("show"); }
  function closeAddModal() {
    document.getElementById("addLeadModal")?.classList.remove("show");
    ["newName","newPhone","newMessage"].forEach(id => setVal(id,""));
  }

  async function saveLead() {
    const name    = getVal("newName");
    const phone   = getVal("newPhone");
    const message = getVal("newMessage");
    const status  = document.getElementById("newStatus")?.value || "new";
    if (!name || !phone) { toast("⚠️ Name and phone are required."); return; }
    const { ok, data } = await apiFetch("/leads", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ name, phone, message, status }),
    });
    if (ok && data?.lead) {
      const leads = getLeadsLocal(); leads.push(data.lead); saveLeadsLocal(leads);
      toast("✅ Lead added!");
    } else {
      const now  = new Date().toISOString();
      const lead = { id:"local_"+Date.now(), name, phone, status, last_message:message||"Added manually", created_at:now, updated_at:now, messages:[{text:message||"Added manually",time:now,direction:"inbound"}] };
      const leads = getLeadsLocal(); leads.push(lead); saveLeadsLocal(leads);
      toast("✅ Lead saved locally (backend offline).");
    }
    closeAddModal(); loadLeads(); loadDashboard();
  }

  async function deleteLead(id) {
    if (!confirm("Delete this lead?")) return;
    await apiFetch("/leads/" + id, { method:"DELETE" });
    const leads = getLeadsLocal().filter(l => l.id !== id);
    saveLeadsLocal(leads);
    toast("🗑 Lead deleted."); loadLeads(); loadDashboard();
  }

  async function updateStatus(id, status) {
    const leads = getLeadsLocal().map(l => l.id===id ? {...l, status, updated_at:new Date().toISOString()} : l);
    saveLeadsLocal(leads);
    await apiFetch("/leads/" + id, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({status}) });
    toast("✅ Status → " + status);
  }

  function exportCsv() {
    if (!allLeads.length) { toast("No leads to export."); return; }
    const rows = allLeads.map(l => ['"'+(l.name||"").replace(/"/g,'""')+'"', '"'+(l.phone||"")+'"', '"'+(l.last_message||"").replace(/"/g,'""')+'"', '"'+(l.status||"")+'"', '"'+formatDate(l.created_at)+'"'].join(","));
    const csv  = ["Name,Phone,Last Message,Status,Created At", ...rows].join("\n");
    const url  = URL.createObjectURL(new Blob([csv], {type:"text/csv"}));
    Object.assign(document.createElement("a"), {href:url, download:"leads_export.csv"}).click();
    URL.revokeObjectURL(url);
    toast("📥 CSV downloaded!");
  }

  // ─── CHAT ─────────────────────────────────────────────────────────────────
  async function loadChatContacts() {
    const { ok, data } = await apiFetch("/leads");
    const leads = (ok && data) ? data.leads : getLeadsLocal();
    if (ok && data) saveLeadsLocal(leads);
    const list = document.getElementById("chatContactList");
    if (!list) return;
    if (!leads.length) { list.innerHTML = '<p style="padding:12px;color:var(--text-muted);font-size:13px">No conversations.</p>'; return; }
    list.innerHTML = leads.map(l =>
      '<div class="chat-contact" data-id="' + l.id + '" onclick="App.loadChatMessages(\'' + l.id + '\')">' +
        '<div class="chat-contact-avatar">' + initials(l.name) + '</div>' +
        '<div><div class="chat-contact-name">' + esc(l.name) + '</div>' +
        '<div class="chat-contact-sub">' + esc(l.last_message||l.phone) + '</div></div></div>').join("");
  }

  async function loadChatMessages(leadId) {
    document.querySelectorAll(".chat-contact").forEach(el => el.classList.toggle("active", el.dataset.id===leadId));
    const win = document.getElementById("chatWindow");
    if (!win) return;
    win.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%"><div class="loader"></div></div>';
    let lead, messages;
    const { ok, data } = await apiFetch("/leads/" + leadId + "/messages");
    if (ok && data) {
      lead = data.lead; messages = data.messages || [];
    } else {
      lead = getLeadsLocal().find(l => l.id===leadId);
      if (!lead) { win.innerHTML = "<p style='padding:20px;color:var(--text-muted)'>Not found.</p>"; return; }
      messages = lead.messages || [];
    }
    win.innerHTML =
      '<div class="chat-header">' +
        '<div style="width:36px;height:36px;border-radius:50%;background:var(--grad);color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">' + initials(lead.name) + '</div>' +
        '<div><div class="chat-header-name">' + esc(lead.name) + '</div><div class="chat-header-phone">' + esc(lead.phone) + '</div></div>' +
      '</div>' +
      '<div class="chat-messages" id="msgList">' +
        (messages.length ? messages.map(m =>
          '<div class="chat-bubble ' + (m.direction==="outbound"?"bubble-out":"bubble-in") + '">' +
            esc(m.text) + '<span class="bubble-time">' + relativeTime(m.time) + '</span></div>'
        ).join("") : '<p style="text-align:center;color:var(--text-muted);padding:20px">No messages.</p>') +
      '</div>';
    const msgList = document.getElementById("msgList");
    if (msgList) msgList.scrollTop = msgList.scrollHeight;
  }

  function openChatFor(id) {
    navigate("chat");
    setTimeout(() => loadChatMessages(id), 200);
  }

  function showNotifBadge(count) {
    const badge = document.getElementById("notifBadge");
    if (!badge) return;
    badge.textContent = count; badge.style.display = "flex";
  }

  function copyWebhook() {
    const text = document.getElementById("webhookUrl")?.textContent || "";
    navigator.clipboard.writeText(text).then(() => toast("📋 Webhook URL copied!"));
  }

  function startAutoRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      const prefs = store.get(LS.PREFS) || DEFAULT_PREFS;
      if (!prefs.autoRefresh) return;
      const active = document.querySelector(".page.active")?.id;
      if (active === "page-dashboard") loadDashboard();
      if (active === "page-leads") loadLeads(document.getElementById("searchInput")?.value||"", document.getElementById("filterStatus")?.value||"");
    }, 30000);
  }

  function init() {
    document.querySelectorAll(".nav-item").forEach(el =>
      el.addEventListener("click", e => { e.preventDefault(); navigate(el.dataset.page); }));
    document.getElementById("hamburger")?.addEventListener("click", () =>
      document.getElementById("sidebar")?.classList.toggle("open"));

    document.getElementById("addLeadBtn")?.addEventListener("click", showAddModal);
    document.getElementById("closeModal")?.addEventListener("click", closeAddModal);
    document.getElementById("cancelModal")?.addEventListener("click", closeAddModal);
    document.getElementById("saveLeadBtn")?.addEventListener("click", saveLead);
    document.getElementById("addLeadModal")?.addEventListener("click", e => { if (e.target.id==="addLeadModal") closeAddModal(); });

    let searchTimer;
    document.getElementById("searchInput")?.addEventListener("input", e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadLeads(e.target.value, document.getElementById("filterStatus")?.value||""), 350);
    });
    document.getElementById("filterStatus")?.addEventListener("change", e =>
      loadLeads(document.getElementById("searchInput")?.value||"", e.target.value));

    document.getElementById("exportCsvBtn")?.addEventListener("click", exportCsv);
    document.getElementById("refreshLeadsBtn")?.addEventListener("click", () =>
      loadLeads(document.getElementById("searchInput")?.value||"", document.getElementById("filterStatus")?.value||""));

    document.addEventListener("change", e => {
      if (e.target.id==="autoRefreshToggle") {
        if (e.target.checked) startAutoRefresh(); else clearInterval(refreshTimer);
      }
    });

    document.getElementById("notifBell")?.addEventListener("click", () => {
      const badge = document.getElementById("notifBadge");
      if (badge) badge.style.display = "none";
    });

    document.getElementById("addRuleModal")?.addEventListener("click", e => {
      if (e.target.id==="addRuleModal") Settings.closeRuleModal();
    });

    startAutoRefresh();
    navigate("dashboard");
  }

  return { init, navigate, toast, loadLeads, deleteLead, updateStatus, openChatFor, loadChatMessages, copyWebhook, exportCsv, showAddModal, closeAddModal, saveLead };
})();

// ═══════════════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════════════
function initials(name) { return ((name||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2))||"?"; }
function esc(str) { return String(str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function formatDate(iso) { if(!iso)return"—"; try{return new Date(iso).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});}catch{return iso;} }
function relativeTime(iso) {
  if(!iso)return"";
  try { const diff=Date.now()-new Date(iso).getTime(), m=Math.floor(diff/60000), h=Math.floor(m/60), d=Math.floor(h/24);
    if(m<1)return"just now"; if(m<60)return m+"m ago"; if(h<24)return h+"h ago"; return d+"d ago"; } catch{return"";}
}
function getVal(id)         { return (document.getElementById(id)?.value||"").trim(); }
function setVal(id, v)      { const el=document.getElementById(id); if(el) el.value=v||""; }
function getCheck(id)       { return !!document.getElementById(id)?.checked; }
function setCheck(id, bool) { const el=document.getElementById(id); if(el) el.checked=!!bool; }

document.addEventListener("DOMContentLoaded", App.init);