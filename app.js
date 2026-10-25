
/*
 * OS Fiscal Bot — Portal do Funcionário
 * Integração com as tabelas do projeto Campos e Filhos.
 *
 * Use somente a chave pública anon/publishable.
 * NUNCA coloque a service_role ou tokens secretos neste arquivo.
 */


const SUPABASE_URL = "https://udzztinbnvuigyrjltno.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_p_dvAb9ARGw4mw9lPotz8Q_T8Rwuvii";

// Preencha com o WhatsApp do encarregado, incluindo DDI e DDD.
// Exemplo de formato: 5531999999999
const ENCARREGADO_WHATSAPP = "";

const STATUS = {
  waiting: "Aguardando recebimento",
  received: "Recebida",
  progress: "Em execução",
  done: "Concluída"
};

const $ = (id) => document.getElementById(id);

let supabaseClient = null;
let currentProfile = null;
let orders = [];
let events = [];
let toastTimer = null;

const qrOrderId = new URLSearchParams(location.search).get("os");

function setMessage(id, text, type = "") {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = "message" + (type ? " " + type : "");
}

function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4000);
}

function formatDate(value) {
  if (!value) return "Não informada";
  const date = new Date(value.length === 10 ? value + "T12:00:00" : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
}

function formatDateTime(value) {
  if (!value) return "Data não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function statusLabel(status) {
  return STATUS[status] || "Status desconhecido";
}

function statusClass(status) {
  return {
    waiting: "status-waiting",
    received: "status-received",
    progress: "status-progress",
    done: "status-done"
  }[status] || "status-waiting";
}

function isConfigured() {
  return SUPABASE_URL.startsWith("https://") &&
    SUPABASE_ANON_KEY.length > 20 &&
    !SUPABASE_URL.includes("COLE_") &&
    !SUPABASE_ANON_KEY.includes("COLE_");
}

function setLoggedIn(isLoggedIn) {
  $("loginView").hidden = isLoggedIn;
  $("appView").hidden = !isLoggedIn;
  $("logoutBtn").hidden = !isLoggedIn;
}

function configureWhatsApp() {
  const button = $("whatsappBtn");

  if (!ENCARREGADO_WHATSAPP) {
    button.href = "#";
    button.addEventListener("click", event => {
      event.preventDefault();
      showToast("O encarregado precisa informar o número de WhatsApp.");
    });
    return;
  }

  const number = ENCARREGADO_WHATSAPP.replace(/\D/g, "");
  button.href = "https://wa.me/" + number +
    "?text=" + encodeURIComponent(
      "Olá, sou " + (currentProfile?.display_name || "funcionário") +
      ". Preciso falar sobre uma ordem de serviço."
    );
}

async function loadProfile() {
  const { data: authData, error: authError } =
    await supabaseClient.auth.getUser();

  if (authError || !authData.user) {
    currentProfile = null;
    setLoggedIn(false);
    return false;
  }

  const { data: profile, error } = await supabaseClient
    
.from("osfiscal_profiles")
.select("id,display_name,role,employee_legacy_id,active")
.eq("id", authData.user.id)
    
    .single();

  if (error) {
    throw new Error("Não foi possível carregar seu perfil: " + error.message);
  }

  
  if (profile.active !== true) {
    throw new Error(
      "Esta conta está inativa. Peça ao gerente para verificar seu acesso."
    );
  }

  if (profile.role !== "employee") {
    throw new Error(
      "Este portal é exclusivo para funcionários. Use a conta de funcionário autorizada."
    );
  }

  if (!profile.employee_legacy_id) {
    throw new Error(
      "Sua conta ainda não foi vinculada a um cadastro de funcionário. " +
      "Peça ao encarregado para vincular seu employee_legacy_id."
    );
  }
  

  currentProfile = profile;
  $("employeeName").textContent =
    "Olá, " + (profile.display_name || "funcionário") + "!";

  configureWhatsApp();
  setLoggedIn(true);
  return true;
}

async function loadOrders() {
  $("ordersList").innerHTML = "";
  $("ordersMessage").textContent = "Carregando suas ordens...";

  /*
   * A política RLS do Supabase deve limitar o resultado às OS
   * do funcionário autenticado. O filtro adicional reforça a consulta.
   */
  const { data, error } = await supabaseClient
    .from("osfiscal_orders")
    .select([
      "legacy_id",
      "employee_legacy_id",
      "code",
      "service_date",
      "due_date",
      "description",
      "location",
      "notes",
      "status",
      "updated_at",
      "created_at"
    ].join(","))
    .eq("employee_legacy_id", currentProfile.employee_legacy_id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Erro ao carregar as OS: " + error.message);
  }

  orders = data || [];
  renderOrders();
  renderStats();
}

function renderStats() {
  $("statWaiting").textContent =
    orders.filter(o => o.status === "waiting").length;
  $("statProgress").textContent =
    orders.filter(o => o.status === "progress").length;
  $("statDone").textContent =
    orders.filter(o => o.status === "done").length;
}

function renderOrders() {
  const list = $("ordersList");
  const filter = $("filterStatus").value;

  let visibleOrders = orders.filter(order =>
    filter === "all" || order.status === filter
  );

  // Se o QR trouxer uma OS específica, ela fica em destaque.
  if (qrOrderId) {
    visibleOrders.sort((a, b) =>
      String(b.legacy_id) === String(qrOrderId) ? 1 :
      String(a.legacy_id) === String(qrOrderId) ? -1 : 0
    );
  }

  if (!visibleOrders.length) {
    list.innerHTML = "";
    $("ordersMessage").textContent = qrOrderId
      ? "A OS indicada pelo QR Code não está entre suas ordens disponíveis. " +
        "Confirme o número e peça ao encarregado para verificar a atribuição."
      : "Nenhuma OS encontrada para este filtro.";
    return;
  }

  $("ordersMessage").textContent = "";

  list.innerHTML = visibleOrders.map(order => {
    const id = escapeHTML(order.legacy_id);
    const code = escapeHTML(order.code || ("OS-" + order.legacy_id));
    const status = order.status || "waiting";
    const description = escapeHTML(order.description || "Serviço sem descrição");
    const location = escapeHTML(order.location || "Local não informado");
    const notes = escapeHTML(order.notes || "Sem observações");
    const date = formatDate(order.service_date);
    const due = formatDate(order.due_date);

    let buttons = "";

    if (status === "waiting") {
      buttons = `
        <button class="btn btn-receive" data-action="received"
          data-id="${id}">Confirmar recebimento</button>`;
    } else if (status === "received") {
      buttons = `
        <button class="btn btn-start" data-action="progress"
          data-id="${id}">Iniciar serviço</button>`;
    } else if (status === "progress") {
      buttons = `
        <button class="btn btn-finish" data-action="done"
          data-id="${id}">Concluir serviço</button>`;
    }

    const isQrTarget = qrOrderId &&
      String(order.legacy_id) === String(qrOrderId);

    return `
      <article class="order-card" id="os-${id}">
        <div class="order-head">
          <div>
            <div class="order-code">${code}</div>
            <h3>${description}</h3>
          </div>
          <span class="status ${statusClass(status)}">
            ${statusLabel(status)}
          </span>
        </div>

        ${isQrTarget ? `
          <div class="notice">OS solicitada pelo QR Code.</div>
        ` : ""}

        <div class="order-meta">
          <div><strong>Data do serviço:</strong> ${date}</div>
          <div><strong>Prazo:</strong> ${due}</div>
          <div><strong>Local:</strong> ${location}</div>
          <div><strong>Observações:</strong> ${notes}</div>
          <div><strong>Última atualização:</strong>
            ${formatDateTime(order.updated_at)}</div>
        </div>

        ${buttons ? `
          <div class="order-actions">${buttons}</div>
        ` : `
          <div class="notice">Esta OS está marcada como concluída.</div>
        `}
      </article>`;
  }).join("");

  if (qrOrderId) {
    const target = $("os-" + CSS.escape(qrOrderId));
    if (target) {
      setTimeout(() => target.scrollIntoView({
        behavior: "smooth", block: "start"
      }), 150);
    }
  }
}

async function updateOrderStatus(orderId, newStatus) {
  const order = orders.find(o => String(o.legacy_id) === String(orderId));
  if (!order) {
    showToast("Esta OS não foi encontrada na sua lista.");
    return;
  }

  const allowed = {
    waiting: ["received"],
    received: ["progress"],
    progress: ["done"],
    done: []
  };

  if (!(allowed[order.status] || []).includes(newStatus)) {
    showToast("Esta mudança de status não é permitida.");
    return;
  }

  const confirmation = {
    received: "Confirmar que você recebeu esta ordem de serviço?",
    progress: "Confirmar o início deste serviço?",
    done: "Confirmar que o serviço foi concluído?"
  };

  if (!window.confirm(confirmation[newStatus])) return;

  const buttons = document.querySelectorAll(
    `[data-id="${CSS.escape(String(orderId))}"]`
  );
  buttons.forEach(button => button.disabled = true);

  try {
    /*
     * O banco executa a validação da OS e grava o histórico.
     * Não fazemos UPDATE direto: usamos a função do schema existente.
     */
    const { error } = await supabaseClient.rpc(
      "employee_update_order_status",
      {
        p_order_legacy_id: String(orderId),
        p_status: newStatus
      }
    );

    if (error) throw error;

    showToast("Atualização registrada com sucesso.");
    await loadOrders();
    await loadEvents();
  } catch (error) {
    console.error(error);
    showToast(
      "Não foi possível atualizar a OS. " +
      (error.message || "Tente novamente ou fale com o encarregado.")
    );
    buttons.forEach(button => button.disabled = false);
  }
}

async function loadEvents() {
  $("historyList").innerHTML = "";

  const { data, error } = await supabaseClient
    .from("osfiscal_events")
    .select("id,order_legacy_id,action,detail,actor,created_at")
    .eq("employee_legacy_id", currentProfile.employee_legacy_id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    $("historyList").textContent =
      "Não foi possível carregar o histórico: " + error.message;
    return;
  }

  events = data || [];

  if (!events.length) {
    $("historyList").textContent =
      "Ainda não há movimentações registradas.";
    return;
  }

  const orderCodes = new Map(
    orders.map(order => [
      String(order.legacy_id),
      order.code || ("OS-" + order.legacy_id)
    ])
  );

  $("historyList").innerHTML = events.map(event => `
    <div class="history-item">
      <strong>${escapeHTML(event.action)}</strong>
      <div>
        ${escapeHTML(orderCodes.get(String(event.order_legacy_id)) ||
          ("OS-" + event.order_legacy_id))}
      </div>
      ${event.detail ? `<div>${escapeHTML(event.detail)}</div>` : ""}
      <time>${formatDateTime(event.created_at)}</time>
    </div>
  `).join("");
}

async function refreshAll() {
  $("connectionMessage").textContent = "Atualizando dados...";
  try {
    await loadOrders();
    await loadEvents();
    $("connectionMessage").textContent =
      "Conectado ao Supabase. Dados carregados da base compartilhada.";
  } catch (error) {
    $("connectionMessage").textContent = error.message;
    console.error(error);
  }
}


function showRecoveryView() {
  $("loginView").hidden = true;
  $("recoveryView").hidden = false;
  $("appView").hidden = true;
  $("logoutBtn").hidden = true;
}

async function saveNewPassword(event) {
  event.preventDefault();

  const password = $("newPassword").value;
  const confirmation = $("confirmPassword").value;

  if (password.length < 8) {
    setMessage("recoveryMessage", "A senha precisa ter pelo menos 8 caracteres.", "error");
    return;
  }

  if (password !== confirmation) {
    setMessage("recoveryMessage", "As senhas não são iguais. Confira os dois campos.", "error");
    return;
  }

  const button = $("recoveryBtn");
  button.disabled = true;
  button.textContent = "Salvando...";
  setMessage("recoveryMessage", "");

  try {
    const { error } = await supabaseClient.auth.updateUser({
      password: password
    });

    if (error) throw error;

    $("newPassword").value = "";
    $("confirmPassword").value = "";

    setMessage(
      "recoveryMessage",
      "Senha alterada com sucesso! Você já pode voltar ao login.",
      "success"
    );
  } catch (error) {
    console.error(error);
    setMessage(
      "recoveryMessage",
      error.message || "Não foi possível alterar a senha.",
      "error"
    );
  } finally {
    button.disabled = false;
    button.textContent = "Salvar nova senha";
  }
}

async function login(event) {
  event.preventDefault();

  if (!isConfigured()) {
    setMessage(
      "loginMessage",
      "Configure a URL do Supabase e a chave pública no arquivo app.js.",
      "error"
    );
    return;
  }

  const button = $("loginBtn");
  button.disabled = true;
  button.textContent = "Entrando...";
  setMessage("loginMessage", "");

  try {
    const { error } = await supabaseClient.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });

    if (error) throw error;

    await startSession();
  } catch (error) {
    console.error(error);
    setMessage(
      "loginMessage",
      error.message || "Não foi possível entrar.",
      "error"
    );
  } finally {
    button.disabled = false;
    button.textContent = "Entrar no portal";
  }
}

async function startSession() {
  try {
    const ok = await loadProfile();
    if (!ok) return;

    await refreshAll();
  } catch (error) {
    console.error(error);
    setLoggedIn(false);
    setMessage("loginMessage", error.message, "error");
  }
}

async function logout() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    showToast("Não foi possível sair: " + error.message);
    return;
  }

  currentProfile = null;
  orders = [];
  events = [];
  setLoggedIn(false);
  $("password").value = "";
  setMessage("loginMessage", "Você saiu da sua conta.", "success");
}

function init() {
  configureWhatsApp();

  if (!window.supabase) {
    setMessage(
      "loginMessage",
      "A biblioteca Supabase não carregou. Verifique a conexão com a internet.",
      "error"
    );
    return;
  }

  if (!isConfigured()) {
    setMessage(
      "loginMessage",
      "Falta configurar a URL e a chave pública do projeto Supabase no app.js.",
      "error"
    );
    return;
  }

  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
    $("recoveryForm").addEventListener("submit", saveNewPassword);

  $("backToLoginBtn").addEventListener("click", () => {
    $("recoveryView").hidden = true;
    $("loginView").hidden = false;
    $("appView").hidden = true;
    setMessage("loginMessage", "");
  });

  $("loginForm").addEventListener("submit", login);
  $("logoutBtn").addEventListener("click", logout);
  $("refreshBtn").addEventListener("click", refreshAll);
  $("filterStatus").addEventListener("change", renderOrders);

  $("ordersList").addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    updateOrderStatus(button.dataset.id, button.dataset.action);
  });

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      setLoggedIn(false);
      return;
    }

    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
      // Evita iniciar várias leituras durante a mesma sessão.
      if (!currentProfile) {
        setTimeout(() => startSession(), 0);
      }
    }
  });

  startSession();
}

document.addEventListener("DOMContentLoaded", init);
