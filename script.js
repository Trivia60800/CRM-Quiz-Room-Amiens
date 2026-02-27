// ==========================================
// CONFIG & INIT
// ==========================================
const CONFIG = {
  URL:       'https://sdtgzlrwsrmhsvoztdat.supabase.co',
  ANON_KEY:  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkdGd6bHJ3c3JtaHN2b3p0ZGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxODgwMjksImV4cCI6MjA4Nzc2NDAyOX0.DZYgBhijp71scgO1fTAte5e536WsDaMb9zTFE_eoa8k',
  AUTH_PASS: 'AMIENS2026'
};

const _sb = supabase.createClient(CONFIG.URL, CONFIG.ANON_KEY);

// Simple auth
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
let clients        = [];
let currentId      = null;
let currentRelanceId = null;
let relanceMoyen   = null;
let currentView    = 'kanban';
let activeFilter   = 'all';
let sortCol        = null;
let sortAsc        = true;
let sortableInstances = [];

const TODAY    = new Date().toISOString().split('T')[0];
const STATUSES = ['new', 'progress', 'urgent', 'won', 'lost'];

// ==========================================
// UTILITIES
// ==========================================
function addBusinessDays(date, days) {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    if (result.getDay() !== 0 && result.getDay() !== 6) added++;
  }
  return result.toISOString().split('T')[0];
}

function fmt(val) {
  return (parseFloat(val) || 0).toLocaleString('fr-FR') + '€';
}

function daysDiff(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date(TODAY)) / (1000 * 60 * 60 * 24));
}

function toast(msg, type = 'success') {
  const t    = document.getElementById('toast');
  const icon = document.getElementById('toast-icon');
  const msgEl = document.getElementById('toast-msg');

  const icons = { success: 'fa-check', error: 'fa-xmark', info: 'fa-info' };
  const colors = { success: 'var(--won)', error: 'var(--urgent)', info: 'var(--accent)' };

  icon.className   = `fa-solid ${icons[type] || icons.success}`;
  icon.style.color = colors[type] || colors.success;
  msgEl.textContent = msg;

  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
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
    refreshUI();
    updateNotifications();
  } else {
    toast('Erreur chargement données', 'error');
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
    // Recherche texte
    if (search) {
      const hay = (c.entreprise + ' ' + (c.contact || '')).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    // Filtre statut
    if (activeFilter !== 'all') {
      const isOverdue = c.dateR && c.dateR <= TODAY && c.status !== 'won' && c.status !== 'lost';
      if (activeFilter === 'urgent') {
        if (!(isOverdue || c.status === 'urgent')) return false;
      } else {
        if (c.status !== activeFilter) return false;
        if (isOverdue && activeFilter !== 'urgent') return false;
      }
    }
    // Filtre dates événement
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

// ==========================================
// REFRESH UI
// ==========================================
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

    const items = clients.filter(c => {
      if (search && !(c.entreprise + ' ' + (c.contact || '')).toLowerCase().includes(search)) return false;
      if (dateFrom && c.dateE && c.dateE < dateFrom) return false;
      if (dateTo   && c.dateE && c.dateE > dateTo)   return false;

      const isOverdue = c.dateR && c.dateR <= TODAY && c.status !== 'won' && c.status !== 'lost';
      if (status === 'urgent')   return isOverdue || c.status === 'urgent';
      if (status === 'new' || status === 'progress') return c.status === status && !isOverdue;
      return c.status === status;
    });

    document.getElementById('cnt-' + status).textContent = items.length;

    items.forEach(c => {
      const diff = daysDiff(c.dateR);
      let timeLabel = c.dateR ? new Date(c.dateR).toLocaleDateString('fr-FR') : '--';
      let timeClass = '';
      if (diff === 0)                   { timeLabel = "AUJOURD'HUI"; timeClass = 'today'; }
      else if (diff !== null && diff < 0) { timeLabel = `RETARD ${Math.abs(diff)}J`; timeClass = 'overdue'; }

      const card = document.createElement('div');
      card.className = 'card';
      card.setAttribute('data-id', c.id);
      card.innerHTML = `
        <div class="card-company">${c.entreprise}</div>
        <div class="card-contact">${c.contact || 'N/C'}</div>
        <div class="card-price">${fmt(c.prix)}</div>
        <div class="card-meta">
          <span class="relance-badge">
            <i class="fa-solid fa-rotate-right" style="font-size:8px;margin-right:4px"></i>
            ${c.nbRelances || 0} relance${(c.nbRelances || 0) > 1 ? 's' : ''}
          </span>
          <span class="date-badge ${timeClass}">${timeLabel}</span>
        </div>
        <div class="card-actions">
          <button class="card-btn script"  onclick="copyScript(${c.id}, event)">SCRIPT</button>
          <button class="card-btn relance" onclick="openRelanceModal(${c.id}, event)">RELANCÉ</button>
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
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:40px">Aucun résultat</td></tr>`;
    return;
  }

  const statusLabels = { new: 'Nouveau', progress: 'En cours', urgent: 'À relancer', won: 'Gagné', lost: 'Perdu' };
  const pillClass    = { new: 'pill-new', progress: 'pill-progress', urgent: 'pill-urgent', won: 'pill-won', lost: 'pill-lost' };

  data.forEach(c => {
    const isOverdue     = c.dateR && c.dateR <= TODAY && c.status !== 'won' && c.status !== 'lost';
    const displayStatus = isOverdue ? 'urgent' : c.status;
    const diff          = daysDiff(c.dateR);

    let relLabel = c.dateR ? new Date(c.dateR).toLocaleDateString('fr-FR') : '--';
    if (diff === 0)                   relLabel = "AUJOURD'HUI";
    else if (diff !== null && diff < 0) relLabel = `RETARD ${Math.abs(diff)}J`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:700">${c.entreprise}</td>
      <td>${c.contact || '--'}</td>
      <td style="font-family:var(--font-head);font-weight:800;color:var(--accent)">${fmt(c.prix)}</td>
      <td><span class="status-pill ${pillClass[displayStatus]}">${statusLabels[displayStatus]}</span></td>
      <td style="color:${diff !== null && diff <= 0 ? 'var(--urgent)' : 'var(--muted)'};font-size:12px">${relLabel}</td>
      <td style="color:var(--muted);font-size:12px">${c.dateE ? new Date(c.dateE).toLocaleDateString('fr-FR') : '--'}</td>
      <td style="color:var(--muted);font-size:12px">${c.nbRelances || 0}</td>
      <td>
        <button class="card-btn relance" style="padding:6px 12px;font-size:9px;border-radius:8px"
          onclick="openRelanceModal(${c.id}, event)">RELANCÉ</button>
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

  document.getElementById('statPending').textContent = pending.toLocaleString('fr-FR') + '€';
  document.getElementById('statWon').textContent     = won.toLocaleString('fr-FR') + '€';
  document.getElementById('statDue').textContent     = due;

  const total = cWon + cLost;
  document.getElementById('statConv').textContent = total > 0 ? Math.round(cWon / total * 100) + '%' : '0%';
}

// ==========================================
// NOTIFICATIONS
// ==========================================
function updateNotifications() {
  const overdue = clients
    .filter(c => c.dateR && c.dateR <= TODAY && c.status !== 'won' && c.status !== 'lost')
    .sort((a, b) => (a.dateR || '') < (b.dateR || '') ? -1 : 1);

  const badge = document.getElementById('notif-badge');
  if (overdue.length > 0) {
    badge.textContent  = overdue.length;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }

  const list = document.getElementById('notif-list');
  list.innerHTML = '';

  if (overdue.length === 0) {
    list.innerHTML = `
      <div class="notif-empty">
        <i class="fa-solid fa-check-circle" style="color:var(--won);margin-bottom:8px;font-size:20px;display:block"></i>
        Toutes les relances sont à jour !
      </div>`;
    return;
  }

  overdue.forEach(c => {
    const diff = daysDiff(c.dateR);
    const item = document.createElement('div');
    item.className = 'notif-item';
    item.innerHTML = `
      <span class="notif-item-badge">RETARD ${Math.abs(diff)}J</span>
      <div class="notif-item-company">${c.entreprise}</div>
      <div class="notif-item-detail">${c.contact || ''} · ${fmt(c.prix)}</div>
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

    const instance = Sortable.create(el, {
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
    });
    sortableInstances.push(instance);
  });
}

async function moveCard(id, newStatus) {
  const { error } = await _sb.from('clients').update({ status: newStatus }).eq('id', id);
  if (!error) {
    const c = clients.find(x => x.id === id);
    if (c) c.status = newStatus;
    toast(`Déplacé vers "${newStatus}"`, 'info');
    refreshUI();
    updateNotifications();
  } else {
    toast('Erreur mise à jour', 'error');
    refreshUI();
  }
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
  const steps    = [3, 5, 10];
  const nextDate = addBusinessDays(new Date(), steps[n - 1] || 15);
  const dateJour = new Date().toLocaleDateString('fr-FR');

  let log = `[${dateJour}] Relance par ${relanceMoyen}`;
  if (note) log += ` : ${note}`;

  const { error } = await _sb.from('clients').update({
    status:     'progress',
    nbRelances: n,
    dateR:      nextDate,
    infos:      log + '\n' + (c.infos || '')
  }).eq('id', currentRelanceId);

  if (!error) {
    toast(`Relance enregistrée — prochaine le ${new Date(nextDate).toLocaleDateString('fr-FR')}`, 'success');
    closeRelanceModal();
    loadData();
  } else {
    toast('Erreur enregistrement', 'error');
  }
}

// ==========================================
// SCRIPT COPY
// ==========================================
function copyScript(id, e) {
  if (e) e.stopPropagation();
  const c = clients.find(x => x.id === id);
  const texte = `Bonjour ${c.contact || c.entreprise},\n\nJe reviens vers vous concernant votre projet Quiz Room Amiens (${fmt(c.prix)}).\n\nAvez-vous pu en discuter en interne ?\n\nÀ très bientôt !`;
  navigator.clipboard.writeText(texte).then(() => toast('Script copié !', 'success'));
}

// ==========================================
// MODAL ADD / EDIT
// ==========================================
function openAddModal() {
  currentId = null;
  document.getElementById('modal-title').textContent = 'Nouveau dossier';
  ['f-entreprise','f-contact','f-email','f-tel','f-infos'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-prix').value      = '0';
  document.getElementById('f-status').value    = 'new';
  document.getElementById('f-dateE').value     = '';
  document.getElementById('f-dateR').value     = '';
  document.getElementById('f-nbRelances').value = '0';
  document.getElementById('modal').classList.add('open');
}

function openEditModal(id) {
  currentId = id;
  const c = clients.find(x => x.id === id);
  if (!c) return;

  document.getElementById('modal-title').textContent   = c.entreprise;
  document.getElementById('f-entreprise').value        = c.entreprise  || '';
  document.getElementById('f-contact').value           = c.contact     || '';
  document.getElementById('f-email').value             = c.email       || '';
  document.getElementById('f-tel').value               = c.tel         || '';
  document.getElementById('f-prix').value              = c.prix        || 0;
  document.getElementById('f-status').value            = c.status      || 'new';
  document.getElementById('f-dateE').value             = c.dateE       || '';
  document.getElementById('f-dateR').value             = c.dateR       || '';
  document.getElementById('f-nbRelances').value        = c.nbRelances  || 0;
  document.getElementById('f-infos').value             = c.infos       || '';
  document.getElementById('modal').classList.add('open');
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

async function saveClient() {
  const entreprise = document.getElementById('f-entreprise').value.trim();
  if (!entreprise) { toast('Entreprise requise', 'error'); return; }

  const data = {
    entreprise,
    contact:    document.getElementById('f-contact').value,
    email:      document.getElementById('f-email').value,
    tel:        document.getElementById('f-tel').value,
    prix:       parseFloat(document.getElementById('f-prix').value)      || 0,
    status:     document.getElementById('f-status').value,
    dateE:      document.getElementById('f-dateE').value                 || null,
    dateR:      document.getElementById('f-dateR').value                 || null,
    nbRelances: parseInt(document.getElementById('f-nbRelances').value)  || 0,
    infos:      document.getElementById('f-infos').value
  };

  let error;
  if (currentId) {
    ({ error } = await _sb.from('clients').update(data).eq('id', currentId));
  } else {
    data.dateC = TODAY;
    ({ error } = await _sb.from('clients').insert([data]));
  }

  if (!error) {
    toast(currentId ? 'Dossier mis à jour' : 'Dossier créé', 'success');
    closeModal();
    loadData();
  } else {
    toast('Erreur enregistrement', 'error');
  }
}

async function deleteClient() {
  if (!currentId) return;
  const c = clients.find(x => x.id === currentId);
  if (!confirm(`Supprimer "${c?.entreprise}" ?`)) return;

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
// CSV IMPORT
// ==========================================
function handleCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const lines   = e.target.result.split('\n').filter(l => l.trim());
    const headers = lines[0].split(';').map(h => h.trim().toLowerCase());
    let imported  = 0;

    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(';');
      const row  = {};
      headers.forEach((h, idx) => row[h] = (vals[idx] || '').trim());
      if (!row.entreprise) continue;

      await _sb.from('clients').insert([{
        entreprise: row.entreprise,
        contact:    row.contact    || '',
        email:      row.email      || '',
        tel:        row.tel        || row.telephone || '',
        prix:       parseFloat(row.prix) || 0,
        status:     row.status     || 'new',
        dateE:      row.datee      || row['date evenement'] || null,
        dateR:      row.dater      || row['date relance']   || null,
        infos:      row.infos      || row.notes             || '',
        nbRelances: 0,
        dateC:      TODAY
      }]);
      imported++;
    }
    toast(`${imported} dossier${imported > 1 ? 's' : ''} importé${imported > 1 ? 's' : ''}`, 'success');
    loadData();
  };
  reader.readAsText(file);
}

// ==========================================
// KEYBOARD SHORTCUTS & EVENTS
// ==========================================
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeRelanceModal();
    document.getElementById('notif-panel').style.display = 'none';
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    openAddModal();
  }
});

// Fermer notif panel en cliquant ailleurs
document.addEventListener('click', e => {
  const panel = document.getElementById('notif-panel');
  if (!panel.contains(e.target) && !document.getElementById('notif-btn').contains(e.target)) {
    panel.style.display = 'none';
  }
});

// Fermer modales en cliquant sur le backdrop
document.getElementById('modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modal')) closeModal();
});
document.getElementById('relance-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('relance-modal')) closeRelanceModal();
});

// ==========================================
// START
// ==========================================
loadData();
