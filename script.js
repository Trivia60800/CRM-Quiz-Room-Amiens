let clients = JSON.parse(localStorage.getItem('qr_amiens_crm')) || [];
let currentId = null;

// --- GESTION DES JOURS OUVRÉS ---
function addBusinessDays(date, days) {
    let result = new Date(date);
    let added = 0;
    while (added < days) {
        result.setDate(result.getDate() + 1);
        if (result.getDay() !== 0 && result.getDay() !== 6) added++;
    }
    return result.toISOString().split('T')[0];
}

function getNextRelanceDate(count) {
    const steps = [3, 5, 10];
    const days = steps[count] || 15;
    return addBusinessDays(new Date(), days);
}

// --- IMPORT CSV ---
function handleCSV(event) {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const rows = text.split('\n').slice(1); // On ignore l'en-tête
        
        rows.forEach(row => {
            if (!row.trim()) return;
            const cols = row.split(';'); // Format CSV Français souvent en ";"
            const newClient = {
                id: Date.now() + Math.random(),
                entreprise: cols[0] || "Sans nom",
                contact: cols[1] || "",
                email: cols[2] || "",
                tel: cols[3] || "",
                prix: parseFloat(cols[4]) || 0,
                status: 'new',
                nbRelances: 0,
                dateC: new Date().toISOString().split('T')[0],
                dateR: getNextRelanceDate(0)
            };
            clients.push(newClient);
        });
        refreshUI();
        alert("Importation terminée !");
    };
    reader.readAsText(file);
}

// --- EXPORT SAUVEGARDE ---
function exportBackup() {
    const data = JSON.stringify(clients);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-crm-amiens-${new Date().toLocaleDateString()}.json`;
    a.click();
}

// --- RENDU ---
function refreshUI() {
    const today = new Date().toISOString().split('T')[0];
    const search = document.getElementById('searchBar').value.toLowerCase();
    const filterStart = document.getElementById('filterStart').value;
    const filterEnd = document.getElementById('filterEnd').value;

    let caPending = 0, caWon = 0, countWon = 0, countLost = 0;

    ['new', 'progress', 'urgent', 'won', 'lost'].forEach(status => {
        const container = document.getElementById(status);
        container.innerHTML = '';
        
        const filtered = clients.filter(c => {
            const matchesSearch = c.entreprise.toLowerCase().includes(search) || (c.contact && c.contact.toLowerCase().includes(search));
            const matchesDate = (!filterStart || c.dateC >= filterStart) && (!filterEnd || c.dateC <= filterEnd);
            return c.status === status && matchesSearch && matchesDate;
        });

        document.getElementById(`cnt-${status}`).innerText = filtered.length;

        filtered.forEach(c => {
            const prix = parseFloat(c.prix || 0);
            if (status !== 'won' && status !== 'lost') caPending += prix;
            if (status === 'won') { caWon += prix; countWon++; }
            if (status === 'lost') countLost++;

            if (c.dateR && c.dateR <= today && (status === 'new' || status === 'progress')) {
                c.status = 'urgent';
                setTimeout(refreshUI, 0);
            }

            const card = document.createElement('div');
            card.className = "card";
            card.setAttribute('data-id', c.id);
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <span class="text-[9px] font-black text-slate-400 uppercase bg-slate-100 px-2 py-0.5 rounded">${c.entreprise}</span>
                    <span class="text-xs font-black text-indigo-600">${prix.toLocaleString()}€</span>
                </div>
                <div class="text-sm font-bold text-slate-800 mt-1">${c.contact || 'N/C'}</div>
                <div class="text-[10px] text-slate-400 mt-1">${c.email || ''}</div>
                <div class="mt-3 flex items-center justify-between text-[9px] font-bold">
                    <div class="text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded">#${c.nbRelances} relance(s)</div>
                    <div class="${c.dateR <= today && status !== 'won' ? 'text-rose-500' : 'text-slate-400'}">
                        <i class="fa-regular fa-bell mr-1"></i>${c.dateR || '--'}
                    </div>
                </div>
                <div class="actions">
                    ${status === 'urgent' ? `<button onclick="doRelance(${c.id}, event)" class="flex-1 bg-indigo-600 text-white text-[9px] font-bold py-2 rounded-lg uppercase">Relancé</button>` : ''}
                    <button onclick="updateStatus(${c.id}, 'won', event)" class="flex-1 bg-emerald-500 text-white text-[9px] font-bold py-2 rounded-lg uppercase">Gagné</button>
                </div>
            `;
            card.onclick = () => openEditModal(c.id);
            container.appendChild(card);
        });
    });

    document.getElementById('statPending').innerText = caPending.toLocaleString() + "€";
    document.getElementById('statWon').innerText = caWon.toLocaleString() + "€";
    const total = countWon + countLost;
    document.getElementById('statConv').innerText = total > 0 ? Math.round((countWon / total) * 100) + "%" : "0%";
    localStorage.setItem('qr_amiens_crm', JSON.stringify(clients));
}

// --- ACTIONS ---
function doRelance(id, e) {
    e.stopPropagation();
    const c = clients.find(x => x.id === id);
    c.nbRelances++;
    c.status = 'progress';
    c.dateR = getNextRelanceDate(c.nbRelances);
    refreshUI();
}

function updateStatus(id, stat, e) { if(e) e.stopPropagation(); clients.find(x => x.id === id).status = stat; refreshUI(); }

function openEditModal(id) {
    currentId = id;
    const c = clients.find(x => x.id === id);
    document.getElementById('f-entreprise').value = c.entreprise;
    document.getElementById('f-contact').value = c.contact || '';
    document.getElementById('f-email').value = c.email || '';
    document.getElementById('f-tel').value = c.tel || '';
    document.getElementById('f-prix').value = c.prix || 0;
    document.getElementById('f-nbRelances').value = c.nbRelances || 0;
    document.getElementById('f-dateR').value = c.dateR || '';
    document.getElementById('f-dateE').value = c.dateE || '';
    document.getElementById('f-infos').value = c.infos || '';
    document.getElementById('modal').classList.remove('hidden');
}

function openAddModal() { currentId = null; document.getElementById('clientForm').reset(); document.getElementById('modal').classList.remove('hidden'); }
function closeModal() { document.getElementById('modal').classList.add('hidden'); }
function deleteClient() { if(confirm("Supprimer ce dossier ?")) { clients = clients.filter(x => x.id !== currentId); closeModal(); refreshUI(); } }

function saveClient() {
    const data = {
        entreprise: document.getElementById('f-entreprise').value,
        contact: document.getElementById('f-contact').value,
        email: document.getElementById('f-email').value,
        tel: document.getElementById('f-tel').value,
        prix: parseFloat(document.getElementById('f-prix').value) || 0,
        nbRelances: parseInt(document.getElementById('f-nbRelances').value) || 0,
        dateR: document.getElementById('f-dateR').value,
        dateE: document.getElementById('f-dateE').value,
        infos: document.getElementById('f-infos').value
    };
    if (currentId) {
        const idx = clients.findIndex(x => x.id === currentId);
        clients[idx] = { ...clients[idx], ...data };
    } else {
        data.id = Date.now();
        data.status = 'new';
        data.dateC = new Date().toISOString().split('T')[0];
        if(!data.dateR) data.dateR = getNextRelanceDate(0);
        clients.push(data);
    }
    closeModal();
    refreshUI();
}

// Drag & Drop
['new', 'progress', 'urgent', 'won', 'lost'].forEach(s => {
    new Sortable(document.getElementById(s), { group: 'crm', animation: 150, onEnd: (e) => {
        const id = e.item.getAttribute('data-id');
        clients.find(x => x.id == id).status = e.to.id;
        refreshUI();
    }});
});

refreshUI();