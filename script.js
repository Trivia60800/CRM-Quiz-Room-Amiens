// ==========================================
// CONFIG & AUTH
// ==========================================
const CONFIG = {
  URL:       'https://sdtgzlrwsrmhsvoztdat.supabase.co',
  ANON_KEY:  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkdGd6bHJ3c3JtaHN2b3p0ZGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxODgwMjksImV4cCI6MjA4Nzc2NDAyOX0.DZYgBhijp71scgO1fTAte5e536WsDaMb9zTFE_eoa8k',
  AUTH_PASS: 'AMIENS2026'
};

const _sb = supabase.createClient(CONFIG.URL, CONFIG.ANON_KEY);

(function () {
  if (sessionStorage.getItem('qr_auth') !== 'ok') {
    const p = prompt('Accès CRM Quiz Room Amiens :');
    if (p === CONFIG.AUTH_PASS) {
      sessionStorage.setItem('qr_auth', 'ok');
    } else {
      alert('Mot de passe incorrect.');
      location.reload();
    }
  }
})();

// ==========================================
// STATE
// ==========================================
let clients           = [];
let currentId         = null;
let currentRelanceId  = null;
let relanceMoyen      = null;
let currentView       = 'kanban';
let activeFilter      = 'all';
let sortCol           = null;
let sortAsc           = true;
let sortableInstances = [];
let scriptClientId    = null;

const TODAY    = new Date().toISOString().split('T')[0];
const STATUSES = ['new', 'progress', 'urgent', 'won', 'lost'];

// ==========================================
// LOGIQUE DE RELANCE INTELLIGENTE
// ==========================================
/**
 * Calcule la prochaine date de relance selon deux logiques :
 * - Si événement dans < 30 jours : jalons à rebours depuis l'événement
 *   [-21j, -14j, -7j, -3j] — jamais à moins de 3j de l'événement
 * - Sinon : jalons depuis la date de création
 *   [J+3, J+7, J+14, J+30, puis +30 chaque mois]
 *
 * @param {object} client
 * @returns {string} date ISO AAAA-MM-JJ ou null
 */
function computeNextRelance(client) {
  const dateC = client.dateC || TODAY;
  const n     = client.nbRelances || 0;

  const created = new Date(dateC);

  // Jalons fixes depuis la date de création : J+3, J+7, J+14, J+30
  const jalons = [3, 7, 14, 30];
  for (let i = 0; i < jalons.length; i++) {
    if (i >= n) {
      const target = new Date(created);
      target.setDate(target.getDate() + jalons[i]);
      const targetStr = target.toISOString().split('T')[0];
      if (targetStr > TODAY) return targetStr;
    }
  }

  // Au-delà de J+30 : relance mensuelle (+30j à chaque fois)
  const monthlyBase = new Date(created);
  monthlyBase.setDate(monthlyBase.getDate() + 30);
  const extraMonths = n - jalons.length + 1;
  if (extraMonths > 0) {
    monthlyBase.setMonth(monthlyBase.getMonth() + extraMonths);
  }
  const monthlyStr = monthlyBase.toISOString().split('T')[0];
  return monthlyStr > TODAY ? monthlyStr : null;
}

/**
 * Retourne un label lisible pour la prochaine relance depuis une carte
 */
function relanceLabel(client) {
  const dateR = client.dateR;
  if (!dateR) return null;
  const diff = daysDiff(dateR);
  if (diff === null) return null;
  if (diff < 0)  return { text: `Retard ${Math.abs(diff)}j`, cls: 'overdue' };
  if (diff === 0) return { text: "Aujourd'hui",               cls: 'today' };
  if (diff === 1) return { text: 'Demain',                   cls: 'soon' };
  if (diff <= 3)  return { text: `Dans ${diff}j`,            cls: 'soon' };
  return { text: `Dans ${diff}j`,                             cls: '' };
}

// ==========================================
// SCORE DE PRIORITÉ (colonne "À relancer")
// ==========================================
/**
 * Plus le score est bas, plus la carte est prioritaire.
 * Critères :
 *   1. Nombre de relances faites (moins = plus urgent, car jamais eu de réponse)
 *   2. Événement proche (moins de jours = plus urgent)
 *   3. Retard de relance (plus ancien = plus urgent)
 */
function priorityScore(c) {
  const relances    = c.nbRelances || 0;
  const daysToEvent = c.dateE ? daysDiff(c.dateE) : 9999;
  const daysLate    = c.dateR ? Math.max(0, -daysDiff(c.dateR)) : 0;

  // Événement très proche → score très élevé (priorité max)
  const eventBonus = daysToEvent !== null && daysToEvent <= 14 ? (14 - daysToEvent) * 10 : 0;

  return relances * 3 - eventBonus - daysLate * 2;
}

// ==========================================
// UTILITIES
// ==========================================
function fmt(val) {
  return (parseFloat(val) || 0).toLocaleString('fr-FR') + ' €';
}

function daysDiff(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr + 'T12:00:00') - new Date(TODAY + 'T12:00:00')) / 86400000);
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR');
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function toast(msg, type = 'success') {
  const t     = document.getElementById('toast');
  const icon  = document.getElementById('toast-icon');
  const msgEl = document.getElementById('toast-msg');
  const icons  = { success: 'fa-check-circle', error: 'fa-xmark-circle', info: 'fa-info-circle' };
  const colors = { success: 'var(--won)', error: 'var(--urgent)', info: 'var(--accent)' };
  icon.className    = `fa-solid ${icons[type] || icons.success}`;
  icon.style.color  = colors[type] || colors.success;
  msgEl.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}

function showImportLoader(msg) {
  const el = document.getElementById('import-loader');
  document.getElementById('import-msg').textContent = msg || 'Import en cours…';
  el.classList.add('show');
}
function hideImportLoader() {
  document.getElementById('import-loader').classList.remove('show');
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==========================================
// DATA
// ==========================================
async function loadData() {
  const { data, error } = await _sb
    .from('clients')
    .select('*')
    .order('id', { ascending: false });

  if (!error && data) {
    clients = data;
    checkEventsPassed();
    refreshUI();
    updateNotifications();
  } else {
    console.error('Supabase error:', error);
    toast('Erreur chargement données', 'error');
  }
}

// ==========================================
// ENCART : ÉVÉNEMENT PASSÉ SANS CLASSEMENT
// ==========================================
function checkEventsPassed() {
  const toClassify = clients.filter(c =>
    c.dateE &&
    c.dateE < TODAY &&
    c.status !== 'won' &&
    c.status !== 'lost'
  );

  const banner = document.getElementById('classify-banner');
  const list   = document.getElementById('classify-list');

  if (toClassify.length === 0) {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = 'flex';
  list.innerHTML = '';

  toClassify.forEach(c => {
    const daysAgo = Math.abs(daysDiff(c.dateE));
    const item = document.createElement('div');
    item.className = 'classify-item';
    item.innerHTML = `
      <div class="classify-info">
        <span class="classify-name">${escHtml(c.entreprise)}</span>
        <span class="classify-date">Événement il y a ${daysAgo}j</span>
      </div>
      <div class="classify-actions">
        <button class="classify-btn won"  onclick="quickClassify(${c.id},'won')">
          <i class="fa-solid fa-check"></i> Gagné
        </button>
        <button class="classify-btn lost" onclick="quickClassify(${c.id},'lost')">
          <i class="fa-solid fa-xmark"></i> Perdu
        </button>
      </div>
    `;
    list.appendChild(item);
  });
}

async function quickClassify(id, status) {
  if (status === 'lost') {
    openLostModal(id);
    return;
  }
  // Gagné : effacer la date de relance
  const { error } = await _sb.from('clients').update({ status, dateR: null }).eq('id', id);
  if (!error) {
    toast('🎉 Marqué comme gagné !', 'success');
    loadData();
  } else {
    toast('Erreur mise à jour', 'error');
  }
}

function dismissBanner() {
  document.getElementById('classify-banner').style.display = 'none';
}

// ==========================================
// MODALE RAISON DE PERTE
// ==========================================
let lostClientId = null;

function openLostModal(id) {
  lostClientId = id;
  const c = clients.find(x => x.id === id);
  document.getElementById('lost-modal-company').textContent = c ? c.entreprise : '';
  document.getElementById('lost-reason').value = '';
  document.getElementById('lost-modal').classList.add('open');
}

function closeLostModal() {
  document.getElementById('lost-modal').classList.remove('open');
  lostClientId = null;
}

async function confirmLost() {
  if (!lostClientId) return;
  const reason = document.getElementById('lost-reason').value.trim();
  const c = clients.find(x => x.id === lostClientId);

  // Ajouter la raison dans l'historique si fournie
  let newInfos = c?.infos || '';
  if (reason) {
    const dateJour = new Date().toLocaleDateString('fr-FR');
    newInfos = `[${dateJour}] Perdu — Raison : ${reason}\n` + newInfos;
  }

  const { error } = await _sb.from('clients').update({
    status: 'lost',
    dateR:  null,
    infos:  newInfos
  }).eq('id', lostClientId);

  if (!error) {
    toast('Dossier classé comme perdu', 'info');
    closeLostModal();
    loadData();
  } else {
    toast('Erreur mise à jour', 'error');
  }
}

// ==========================================
// FILTERING
// ==========================================
function getFiltered() {
  const search   = document.getElementById('searchBar').value.toLowerCase();
  const dateFrom = document.getElementById('filterDateFrom').value;
  const dateTo   = document.getElementById('filterDateTo').value;

  return clients.filter(c => {
    if (search) {
      const hay = (c.entreprise + ' ' + (c.contact || '')).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (activeFilter !== 'all') {
      const isOverdue = c.dateR && c.dateR <= TODAY && c.status !== 'won' && c.status !== 'lost';
      if (activeFilter === 'urgent') {
        if (!(isOverdue || c.status === 'urgent')) return false;
      } else {
        if (c.status !== activeFilter) return false;
        if (isOverdue && activeFilter !== 'urgent') return false;
      }
    }
    if (dateFrom && c.dateE && c.dateE < dateFrom) return false;
    if (dateTo   && c.dateE && c.dateE > dateTo)   return false;
    return true;
  });
}

// ==========================================
// VIEWS
// ==========================================
function setView(view) {
  currentView = view;
  document.getElementById('kanban-view').style.display = view === 'kanban' ? 'flex'  : 'none';
  document.getElementById('list-view').style.display   = view === 'list'   ? 'block' : 'none';
  document.getElementById('btn-kanban').classList.toggle('active', view === 'kanban');
  document.getElementById('btn-list').classList.toggle('active',   view === 'list');
  refreshUI();
}

function setFilter(f) {
  activeFilter = f;
  document.querySelectorAll('.filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === f);
  });
  refreshUI();
}

function refreshUI() {
  if (currentView === 'kanban') renderKanban();
  else                          renderList();
  updateStats();
}

// ==========================================
// KANBAN RENDER
// ==========================================
function renderKanban() {
  const search   = document.getElementById('searchBar').value.toLowerCase();
  const dateFrom = document.getElementById('filterDateFrom').value;
  const dateTo   = document.getElementById('filterDateTo').value;

  STATUSES.forEach(status => {
    const container = document.getElementById('list-' + status);
    if (!container) return;
    container.innerHTML = '';

    let items = clients.filter(c => {
      if (search && !(c.entreprise + ' ' + (c.contact || '')).toLowerCase().includes(search)) return false;
      if (dateFrom && c.dateE && c.dateE < dateFrom) return false;
      if (dateTo   && c.dateE && c.dateE > dateTo)   return false;
      const isOverdue = c.dateR && c.dateR <= TODAY && c.status !== 'won' && c.status !== 'lost';
      if (status === 'urgent')   return isOverdue || c.status === 'urgent';
      if (status === 'new' || status === 'progress') return c.status === status && !isOverdue;
      return c.status === status;
    });

    // Priorisation de la colonne "À relancer"
    if (status === 'urgent') {
      items.sort((a, b) => priorityScore(a) - priorityScore(b));
    }

    document.getElementById('cnt-' + status).textContent = items.length;

    items.forEach((c, idx) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.setAttribute('data-id', c.id);

      const isUrgent = status === 'urgent';
      const lbl      = relanceLabel(c);

      // Badge de priorité pour "À relancer"
      let priorityBadge = '';
      if (isUrgent) {
        const rank = idx + 1;
        priorityBadge = `<span class="priority-rank">#${rank}</span>`;
      }

      // Countdown pour "En cours"
      let countdownHtml = '';
      if (status === 'progress' && c.dateR) {
        const diff = daysDiff(c.dateR);
        if (diff !== null) {
          const cls  = diff <= 0 ? 'countdown-overdue' : diff <= 3 ? 'countdown-soon' : 'countdown-ok';
          const txt  = diff < 0 ? `Retard ${Math.abs(diff)}j` : diff === 0 ? "Aujourd'hui !" : `Dans ${diff} jour${diff > 1 ? 's' : ''}`;
          countdownHtml = `<div class="card-countdown ${cls}"><i class="fa-solid fa-clock"></i> ${txt}</div>`;
        }
      }

      // Date événement
      let eventHtml = '';
      if (c.dateE) {
        const dEvent = daysDiff(c.dateE);
        const eventCls = dEvent !== null && dEvent <= 7 && dEvent >= 0 ? 'event-near' : dEvent !== null && dEvent < 0 ? 'event-past' : '';
        const eventTxt = dEvent !== null && dEvent < 0 ? `Événement passé (${fmtDate(c.dateE)})` : `Événement : ${fmtDate(c.dateE)}`;
        if (eventCls || isUrgent) {
          eventHtml = `<div class="card-event ${eventCls}"><i class="fa-solid fa-calendar-star" style="font-size:9px"></i> ${eventTxt}</div>`;
        }
      }

      card.innerHTML = `
        <div class="card-top">
          <span class="card-company">${escHtml(c.entreprise)}</span>
          <div style="display:flex;align-items:center;gap:6px">
            ${priorityBadge}
            <span class="card-price">${fmt(c.prix)}</span>
          </div>
        </div>
        <div class="card-contact">${escHtml(c.contact || 'N/C')}</div>
        ${countdownHtml}
        ${eventHtml}
        <div class="card-meta">
          <span class="relance-badge">
            <i class="fa-solid fa-rotate-right" style="font-size:8px"></i>
            ${c.nbRelances || 0} relance${(c.nbRelances || 0) > 1 ? 's' : ''}
          </span>
          ${lbl && !countdownHtml ? `<span class="date-badge ${lbl.cls}">${lbl.text}</span>` : ''}
        </div>
        <div class="card-actions">
          <button class="card-btn script"  onclick="openScriptModal(${c.id}, event)">
            <i class="fa-solid fa-message" style="font-size:9px"></i> Script
          </button>
          <button class="card-btn relance" onclick="openRelanceModal(${c.id}, event)">
            <i class="fa-solid fa-phone" style="font-size:9px"></i> Relancé
          </button>
        </div>
      `;
      card.onclick = () => openEditModal(c.id);
      container.appendChild(card);
    });
  });

  initSortable();
}

// ==========================================
// LIST RENDER
// ==========================================
function renderList() {
  let data = [...getFiltered()];

  if (sortCol) {
    data.sort((a, b) => {
      let va = a[sortCol] || '';
      let vb = b[sortCol] || '';
      if (sortCol === 'prix') { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; }
      if (va < vb) return sortAsc ? -1 :  1;
      if (va > vb) return sortAsc ?  1 : -1;
      return 0;
    });
  }

  const tbody = document.getElementById('list-tbody');
  tbody.innerHTML = '';

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:40px;font-size:13px">Aucun résultat</td></tr>`;
    return;
  }

  const statusLabels = { new: 'Nouveau', progress: 'En cours', urgent: 'À relancer', won: 'Gagné', lost: 'Perdu' };
  const pillClass    = { new: 'pill-new', progress: 'pill-progress', urgent: 'pill-urgent', won: 'pill-won', lost: 'pill-lost' };

  data.forEach(c => {
    const isOverdue     = c.dateR && c.dateR <= TODAY && c.status !== 'won' && c.status !== 'lost';
    const displayStatus = isOverdue ? 'urgent' : c.status;
    const diff          = daysDiff(c.dateR);
    let relLabel        = fmtDate(c.dateR);
    if (diff === 0)                     relLabel = "Aujourd'hui";
    else if (diff !== null && diff < 0) relLabel = `Retard ${Math.abs(diff)}j`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600">${escHtml(c.entreprise)}</td>
      <td style="color:var(--muted)">${escHtml(c.contact || '—')}</td>
      <td style="font-family:var(--font-head);font-weight:700;color:var(--accent)">${fmt(c.prix)}</td>
      <td><span class="status-pill ${pillClass[displayStatus]}">${statusLabels[displayStatus]}</span></td>
      <td style="color:${diff !== null && diff <= 0 ? 'var(--urgent)' : 'var(--muted)'};font-size:12px;font-weight:${diff !== null && diff <= 0 ? '700' : '400'}">${relLabel}</td>
      <td style="color:var(--muted);font-size:12px">${fmtDate(c.dateE)}</td>
      <td style="color:var(--muted);font-size:12px;text-align:center">${c.nbRelances || 0}</td>
      <td>
        <button class="card-btn relance" style="padding:6px 14px;font-size:10px;border-radius:8px;white-space:nowrap"
          onclick="openRelanceModal(${c.id}, event)">Relancé</button>
      </td>
    `;
    tr.onclick = () => openEditModal(c.id);
    tbody.appendChild(tr);
  });
}

function sortList(col) {
  if (sortCol === col) sortAsc = !sortAsc;
  else { sortCol = col; sortAsc = true; }
  renderList();
}

// ==========================================
// STATS
// ==========================================
function updateStats() {
  let pending = 0, won = 0, cWon = 0, cLost = 0, due = 0;
  clients.forEach(c => {
    const p = parseFloat(c.prix) || 0;
    if (c.status === 'won')       { won += p; cWon++; }
    else if (c.status === 'lost') { cLost++; }
    else                          { pending += p; }
    if (c.dateR && c.dateR <= TODAY && c.status !== 'won' && c.status !== 'lost') due++;
  });
  document.getElementById('statPending').textContent = pending.toLocaleString('fr-FR') + ' €';
  document.getElementById('statWon').textContent     = won.toLocaleString('fr-FR') + ' €';
  document.getElementById('statDue').textContent     = due;
  const total = cWon + cLost;
  document.getElementById('statConv').textContent = total > 0 ? Math.round(cWon / total * 100) + ' %' : '0 %';
}

// ==========================================
// NOTIFICATIONS
// ==========================================
function updateNotifications() {
  const overdue = clients
    .filter(c => c.dateR && c.dateR <= TODAY && c.status !== 'won' && c.status !== 'lost')
    .sort((a, b) => (a.dateR || '') < (b.dateR || '') ? -1 : 1);

  const badge = document.getElementById('notif-badge');
  badge.textContent   = overdue.length;
  badge.style.display = overdue.length > 0 ? 'flex' : 'none';

  const list = document.getElementById('notif-list');
  list.innerHTML = '';

  if (overdue.length === 0) {
    list.innerHTML = `<div class="notif-empty"><i class="fa-solid fa-circle-check" style="color:var(--won);font-size:22px;display:block;margin-bottom:8px"></i>Toutes les relances sont à jour !</div>`;
    return;
  }

  overdue.forEach(c => {
    const diff = daysDiff(c.dateR);
    const item = document.createElement('div');
    item.className = 'notif-item';
    item.innerHTML = `
      <span class="notif-item-badge">Retard ${Math.abs(diff)}j</span>
      <div class="notif-item-company">${escHtml(c.entreprise)}</div>
      <div class="notif-item-detail">${escHtml(c.contact || '')}${c.contact ? ' · ' : ''}${fmt(c.prix)}</div>
    `;
    item.onclick = () => { openEditModal(c.id); toggleNotifPanel(); };
    list.appendChild(item);
  });
}

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
}

// ==========================================
// DRAG & DROP
// ==========================================
function initSortable() {
  sortableInstances.forEach(s => s.destroy());
  sortableInstances = [];

  STATUSES.forEach(status => {
    const el = document.getElementById('list-' + status);
    if (!el) return;
    sortableInstances.push(Sortable.create(el, {
      group:      'kanban',
      animation:  200,
      ghostClass: 'sortable-ghost',
      dragClass:  'sortable-drag',
      onEnd: async (evt) => {
        const id        = parseInt(evt.item.getAttribute('data-id'));
        const newStatus = evt.to.id.replace('list-', '');
        if (newStatus === evt.from.id.replace('list-', '')) return;
        await moveCard(id, newStatus);
      }
    }));
  });
}

async function moveCard(id, newStatus) {
  // Si on dépose dans "perdu", ouvrir la modale de raison
  if (newStatus === 'lost') {
    openLostModal(id);
    return; // moveCard sera rappelé depuis confirmLost()
  }

  const update = { status: newStatus };
  // Gagné ou perdu → plus de relance
  if (newStatus === 'won' || newStatus === 'lost') {
    update.dateR = null;
  }

  const { error } = await _sb.from('clients').update(update).eq('id', id);
  if (!error) {
    const c = clients.find(x => x.id === id);
    if (c) { c.status = newStatus; if (update.dateR === null) c.dateR = null; }
    const labels = { new: 'Nouveaux', progress: 'En cours', urgent: 'À relancer', won: 'Gagné', lost: 'Perdu' };
    toast(`Déplacé vers « ${labels[newStatus] || newStatus} »`, 'info');
    refreshUI();
    updateNotifications();
  } else {
    toast('Erreur mise à jour', 'error');
    refreshUI();
  }
}

// ==========================================
// SCRIPT MODAL — chaleureux et personnalisé
// ==========================================
function openScriptModal(id, e) {
  if (e) e.stopPropagation();
  scriptClientId = id;
  const c = clients.find(x => x.id === id);
  if (!c) return;

  const n          = c.nbRelances || 0;
  const prenom     = (c.contact || c.entreprise).split(' ')[0];
  const dateE      = c.dateE ? fmtDate(c.dateE) : null;
  const daysToEvent = c.dateE ? daysDiff(c.dateE) : null;

  // Construire le contexte pour personnaliser le script
  let contexte = '';
  if (n === 0) {
    contexte = `Voici notre premier contact — présentation chaleureuse.`;
  } else {
    // Extraire la dernière note de l'historique
    const lastNote = (c.infos || '').split('\n').find(l => l.trim().startsWith('['));
    if (lastNote) contexte = `Dernier contact : ${lastNote.replace(/^\[.*?\]\s*/, '')}`;
  }

  // Choisir le bon script selon le contexte
  let script = '';

  if (daysToEvent !== null && daysToEvent >= 0 && daysToEvent <= 7) {
    // Événement très proche
    script = `Bonjour ${prenom},\n\nVotre événement du ${dateE} approche à grands pas ! Je voulais m'assurer que tout était bien calé de votre côté et répondre à d'éventuelles dernières questions.\n\nNous sommes prêts à vous accueillir et à faire de cette soirée un moment mémorable pour vous et vos invités. 🎉\n\nN'hésitez pas à me contacter si vous avez besoin de quoi que ce soit avant le grand jour !\n\nÀ très bientôt,\nL'équipe Quiz Room Amiens`;

  } else if (daysToEvent !== null && daysToEvent >= 8 && daysToEvent <= 30) {
    // Événement dans le mois
    script = `Bonjour ${prenom},\n\nJ'espère que vous allez bien ! Je reviens vers vous concernant votre projet de soirée Quiz Room pour le ${dateE}.\n\nAvez-vous eu l'occasion d'en discuter avec vos équipes / proches ? Je serais ravie de répondre à vos questions et de finaliser l'organisation ensemble.\n\nLe tarif pour votre groupe reste à ${fmt(c.prix)} — et je vous garantis une soirée dont tout le monde se souviendra !\n\nÀ bientôt,\nL'équipe Quiz Room Amiens`;

  } else if (n === 0) {
    // Première relance, pas d'événement proche
    script = `Bonjour ${prenom},\n\nJ'espère que vous allez bien ! Suite à notre échange, je voulais revenir vers vous concernant votre projet Quiz Room Amiens.\n\nAvez-vous eu le temps d'y réfléchir ? Je reste disponible pour répondre à toutes vos questions et vous préparer un devis sur-mesure.\n\nBonne journée,\nL'équipe Quiz Room Amiens`;

  } else if (n === 1) {
    script = `Bonjour ${prenom},\n\nJe me permets de revenir vers vous une nouvelle fois concernant votre projet de soirée Quiz Room (${fmt(c.prix)}).\n\nJe comprends que vous ayez beaucoup de choses à gérer, et je ne veux pas vous brusquer ! Mais si vous avez des questions ou souhaitez ajuster notre proposition, je suis là.\n\nUne petite question : y a-t-il un point particulier qui vous fait hésiter ? Je serais heureux(se) d'en discuter avec vous.\n\nCordialement,\nL'équipe Quiz Room Amiens`;

  } else {
    // Plusieurs relances déjà faites
    script = `Bonjour ${prenom},\n\nJe reviens une dernière fois vers vous au sujet de votre projet Quiz Room Amiens.\n\nSi ce projet n'est plus d'actualité pour le moment, dites-le moi sans hésiter — je comprendrai tout à fait ! Et si au contraire vous souhaitez qu'on en reparle, je reste à votre disposition.\n\nDans tous les cas, bonne continuation et à peut-être bientôt !\n\nL'équipe Quiz Room Amiens`;
  }

  document.getElementById('script-modal-title').textContent = `Script — ${c.entreprise}`;
  document.getElementById('script-context').textContent = n > 0 ? `${n} relance${n > 1 ? 's' : ''} effectuée${n > 1 ? 's' : ''}${dateE ? ` · Événement le ${dateE}` : ''}` : `Première prise de contact${dateE ? ` · Événement le ${dateE}` : ''}`;
  document.getElementById('script-text').value = script;
  document.getElementById('script-modal').classList.add('open');
}

function closeScriptModal() {
  document.getElementById('script-modal').classList.remove('open');
  scriptClientId = null;
}

function copyScriptText() {
  const text = document.getElementById('script-text').value;
  navigator.clipboard.writeText(text).then(() => {
    toast('Script copié dans le presse-papier !', 'success');
    closeScriptModal();
  });
}

// ==========================================
// RELANCE MODAL
// ==========================================
function openRelanceModal(id, e) {
  if (e) e.stopPropagation();
  currentRelanceId = id;
  relanceMoyen = null;
  document.getElementById('relance-note').value = '';
  document.querySelectorAll('.relance-option').forEach(o => o.classList.remove('selected'));

  // Afficher la prochaine date calculée
  const c = clients.find(x => x.id === id);
  if (c) {
    const nextDate = computeNextRelance({ ...c, nbRelances: (c.nbRelances || 0) + 1 });
    const el = document.getElementById('relance-next-date');
    if (nextDate) {
      const diff = daysDiff(nextDate);
      el.textContent = `Prochaine relance prévue : ${fmtDate(nextDate)} (dans ${diff}j)`;
      el.style.display = 'block';
    } else {
      el.textContent = c.dateE ? `Pas de relance prévue avant l'événement du ${fmtDate(c.dateE)}` : 'Aucune prochaine relance calculée';
      el.style.display = 'block';
    }
  }

  document.getElementById('relance-modal').classList.add('open');
}

function closeRelanceModal() {
  document.getElementById('relance-modal').classList.remove('open');
  currentRelanceId = null;
}

function selectRelanceOption(el) {
  document.querySelectorAll('.relance-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  relanceMoyen = el.dataset.val;
}

async function confirmRelance() {
  if (!relanceMoyen) { toast('Choisissez un moyen de relance', 'error'); return; }
  const c = clients.find(x => x.id === currentRelanceId);
  if (!c) return;

  const note     = document.getElementById('relance-note').value.trim();
  const n        = (c.nbRelances || 0) + 1;

  // Calcul intelligent de la prochaine date
  const nextDate = computeNextRelance({ ...c, nbRelances: n });

  const dateJour = new Date().toLocaleDateString('fr-FR');
  let log = `[${dateJour}] Relance #${n} par ${relanceMoyen}`;
  if (note) log += ` : ${note}`;

  const updateData = {
    status:     'progress',
    nbRelances: n,
    infos:      log + '\n' + (c.infos || '')
  };
  if (nextDate) updateData.dateR = nextDate;

  const { error } = await _sb.from('clients').update(updateData).eq('id', currentRelanceId);

  if (!error) {
    const msg = nextDate
      ? `Relance enregistrée · Prochaine le ${fmtDate(nextDate)}`
      : `Relance enregistrée · Pas de relance avant l'événement`;
    toast(msg, 'success');
    closeRelanceModal();
    loadData();
  } else {
    toast('Erreur enregistrement', 'error');
  }
}

// ==========================================
// MODAL ADD / EDIT
// ==========================================
function openAddModal() {
  currentId = null;
  document.getElementById('modal-title').textContent = 'Nouveau dossier';
  ['f-entreprise','f-contact','f-email','f-tel','f-infos'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-prix').value       = '0';
  document.getElementById('f-status').value     = 'new';
  document.getElementById('f-dateE').value      = '';
  document.getElementById('f-dateR').value      = '';
  document.getElementById('f-nbRelances').value = '0';
  document.getElementById('modal').classList.add('open');
}

function openEditModal(id) {
  currentId = id;
  const c = clients.find(x => x.id === id);
  if (!c) return;
  document.getElementById('modal-title').textContent    = c.entreprise;
  document.getElementById('f-entreprise').value         = c.entreprise  || '';
  document.getElementById('f-contact').value            = c.contact     || '';
  document.getElementById('f-email').value              = c.email       || '';
  document.getElementById('f-tel').value                = c.tel         || '';
  document.getElementById('f-prix').value               = c.prix        || 0;
  document.getElementById('f-status').value             = c.status      || 'new';
  document.getElementById('f-dateE').value              = c.dateE       || '';
  document.getElementById('f-dateR').value              = c.dateR       || '';
  document.getElementById('f-nbRelances').value         = c.nbRelances  || 0;
  document.getElementById('f-infos').value              = c.infos       || '';
  document.getElementById('modal').classList.add('open');
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

async function saveClient() {
  const entreprise = document.getElementById('f-entreprise').value.trim();
  if (!entreprise) { toast('Le champ Entreprise est requis', 'error'); return; }

  const status = document.getElementById('f-status').value;
  const data = {
    entreprise,
    contact:    document.getElementById('f-contact').value,
    email:      document.getElementById('f-email').value,
    tel:        document.getElementById('f-tel').value,
    prix:       parseFloat(document.getElementById('f-prix').value)     || 0,
    status,
    dateE:      document.getElementById('f-dateE').value                || null,
    dateR:      document.getElementById('f-dateR').value                || null,
    nbRelances: parseInt(document.getElementById('f-nbRelances').value) || 0,
    infos:      document.getElementById('f-infos').value
  };

  // Gagné ou perdu → on efface la date de relance
  if (status === 'won' || status === 'lost') {
    data.dateR = null;
  }

  let error;
  if (currentId) {
    ({ error } = await _sb.from('clients').update(data).eq('id', currentId));
  } else {
    data.dateC = TODAY;
    // Calculer la première date de relance automatiquement (sauf si won/lost)
    if (!data.dateR && status !== 'won' && status !== 'lost') {
      data.dateR = computeNextRelance({ ...data, nbRelances: 0 });
    }
    ({ error } = await _sb.from('clients').insert([data]));
  }

  if (!error) {
    toast(currentId ? 'Dossier mis à jour' : 'Dossier créé avec succès', 'success');
    closeModal();
    loadData();
  } else {
    console.error('Save error:', error);
    toast('Erreur : ' + (error.message || 'inconnue'), 'error');
  }
}

async function deleteClient() {
  if (!currentId) return;
  const c = clients.find(x => x.id === currentId);
  if (!confirm(`Supprimer le dossier "${c?.entreprise}" ? Cette action est irréversible.`)) return;
  const { error } = await _sb.from('clients').delete().eq('id', currentId);
  if (!error) {
    toast('Dossier supprimé', 'info');
    closeModal();
    loadData();
  } else {
    toast('Erreur suppression', 'error');
  }
}

// ==========================================
// IMPORT CSV — VERSION ROBUSTE CORRIGÉE
// ==========================================

/**
 * Parse une ligne CSV en tenant compte des guillemets (champs avec virgules/points-virgules)
 * Gère les valeurs comme "636,50€" ou "Mail, Téléphone"
 */
function parseCSVLine(line, sep) {
  const vals = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Guillemet double à l'intérieur d'un champ entre guillemets → on l'inclut
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      vals.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  vals.push(cur);
  return vals;
}

/**
 * Normalise un header CSV :
 * - minuscules
 * - supprime les accents
 * - supprime les apostrophes (gère "Date de l'événement" → "date de levenement")
 * - trim les espaces
 */
function normalizeHeader(h) {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // supprime les accents
    .replace(/['''\u2018\u2019\u02bc]/g, ''); // supprime toutes les formes d'apostrophes
}

function handleCSV(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    let raw = e.target.result;

    // Enlever le BOM UTF-8 si présent et nettoyer
    raw = raw.replace(/^\uFEFF/, '').trim();
    const lines = raw.split(/\r?\n/).filter(l => l.trim());

    if (lines.length < 2) {
      toast('Le fichier semble vide', 'error');
      return;
    }

    // Détection automatique du séparateur (virgule ou point-virgule)
    const firstLine = lines[0];
    const sep = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

    // Normalisation des headers (minuscules, sans accents, sans apostrophes)
    const rawHeaders = parseCSVLine(firstLine, sep);
    const headers = rawHeaders.map(h => normalizeHeader(h));

    console.log('[CSV Import] Séparateur détecté :', sep);
    console.log('[CSV Import] Headers normalisés :', headers);

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i], sep);

      const row = {};
      headers.forEach((h, idx) => {
        row[h] = (vals[idx] || '').trim();
      });

      // Mapping des colonnes du fichier vers les champs Supabase
      // On couvre plusieurs noms possibles pour chaque champ
      const entreprise =
        row['entreprise'] ||
        row['nom de lentreprise'] ||
        row['societe'] ||
        vals[0] || '';

      if (!entreprise || entreprise.toLowerCase() === 'entreprise') continue;

      // Nettoyage du prix : enlève €, espaces normaux et insécables (\u00a0), remplace , par .
      const prixRaw = row['prix du devis'] || row['prix'] || '0';
      const prix = parseFloat(
        prixRaw
          .replace(/[^\d.,]/g, '')   // garde uniquement chiffres, virgule, point
          .replace(',', '.')          // virgule décimale → point
      ) || 0;

      // Détermination du statut
      const statutRaw = (row['statut'] || '').toLowerCase();
      let status = 'new';
      if (statutRaw.includes('annul') || statutRaw.includes('perdu')) status = 'lost';
      else if (statutRaw.includes('won') || statutRaw.includes('gagne') || statutRaw.includes('gagn')) status = 'won';

      const rowData = {
        entreprise: entreprise,
        contact:    row['contact']    || row['nom du contact'] || '',
        email:      row['email']      || '',
        tel:        row['telephone']  || row['tel'] || '',
        prix:       prix,
        status:     status,
        dateE:      parseDate(row['date de levenement'] || row['date evenement'] || row['datee'] || ''),
        dateR:      parseDate(row['date de relance']    || row['dater'] || ''),
        infos:      row['infos +']    || row['infos']   || row['reponse relance'] || '',
        nbRelances: 0,
        dateC:      TODAY
      };

      rows.push(rowData);
    }

    console.log('[CSV Import] Lignes valides :', rows.length);

    if (rows.length === 0) {
      toast('Aucune donnée valide trouvée dans le fichier', 'error');
      return;
    }

    showImportLoader(`Import de ${rows.length} dossier(s)…`);

    const { error } = await _sb.from('clients').insert(rows);

    hideImportLoader();
    if (error) {
      console.error('[CSV Import] Erreur Supabase :', error);
      toast('Erreur Supabase : ' + error.message, 'error');
    } else {
      toast(`${rows.length} dossier${rows.length > 1 ? 's' : ''} importé${rows.length > 1 ? 's' : ''} avec succès !`, 'success');
      loadData();
    }
  };
  reader.readAsText(file, 'UTF-8');
}

/**
 * Parse une date depuis une chaîne :
 * - Format ISO  : AAAA-MM-JJ
 * - Format FR   : JJ/MM/AAAA ou JJ-MM-AAAA
 */
function parseDate(str) {
  if (!str) return null;
  str = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

// ==========================================
// KEYBOARD & EVENTS
// ==========================================
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeRelanceModal();
    closeScriptModal();
    closeLostModal();
    document.getElementById('notif-panel').style.display = 'none';
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    openAddModal();
  }
});

document.addEventListener('click', e => {
  const panel = document.getElementById('notif-panel');
  if (!panel.contains(e.target) && !document.getElementById('notif-btn').contains(e.target)) {
    panel.style.display = 'none';
  }
});

['modal','relance-modal','script-modal','lost-modal'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});

// ==========================================
// START
// ==========================================
loadData();
