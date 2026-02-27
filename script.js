// SYSTÈME DE SÉCURITÉ SIMPLE
const PASSWORD = "QUIZ-AMIENS-2024"; // Tu peux changer ce mot de passe

function checkAccess() {
    const session = sessionStorage.getItem('crm_access');
    if (session !== 'granted') {
        const input = prompt("Veuillez saisir le mot de passe d'accès :");
        if (input === PASSWORD) {
            sessionStorage.setItem('crm_access', 'granted');
        } else {
            alert("Accès refusé !");
            document.body.innerHTML = "<h1 style='padding:50px; text-align:center;'>Accès non autorisé.</h1>";
        }
    }
}

checkAccess(); // Se lance immédiatement au chargement

// INITIALISATION SUPABASE
const supabaseUrl = 'https://sdtgzlrwsrmhsvoztdat.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkdGd6bHJ3c3JtaHN2b3p0ZGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxODgwMjksImV4cCI6MjA4Nzc2NDAyOX0.DZYgBhijp71scgO1fTAte5e536WsDaMb9zTFE_eoa8k';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let clients = [];
let currentId = null;

// GESTION DES JOURS OUVRÉS
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

// CHARGEMENT INITIAL
async function loadData() {
    const { data, error } = await _supabase.from('clients').select('*');
    if (error) console.error(error);
    else {
        clients = data;
        refreshUI();
    }
}

// MISE À JOUR UI
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

            // Auto-Urgent
            if (c.dateR && c.dateR <= today && (status === 'new' || status === 'progress')) {
                updateStatus(c.id, 'urgent');
            }

            const card = document.createElement('div');
            card.className = "card";
            card.setAttribute('data-id', c.id);
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <span class="text-[9px] font-black text-slate-400 uppercase bg-slate-100 px-2 py-1 rounded-md tracking-wider">${c.entreprise}</span>
                    <span class="text-sm font-black text-indigo-600">${prix.toLocaleString()}€</span>
                </div>
                <div class="text-sm font-extrabold text-slate-800 mt-2">${c.contact || 'Inconnu'}</div>
                <div class="text-[10px] text-slate-400 mt-0.5">${c.email || ''}</div>
                <div class="mt-4 flex items-center justify-between">
                    <div class="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">Relances : ${c.nbRelances}</div>
                    <div class="text-[9px] font-bold ${c.dateR <= today && status !== 'won' ? 'text-rose-500 animate-pulse' : 'text-slate-400'}">
                        <i class="fa-regular fa-clock mr-1"></i>${c.dateR || '--'}
                    </div>
                </div>
                <div class="actions">
                    ${status === 'urgent' ? `<button onclick="doRelance(${c.id}, event)" class="flex-1 bg-indigo-600 text-white text-[9px] font-black py-2 rounded-lg uppercase tracking-widest">Relancé</button>` : ''}
                    <button onclick="updateStatus(${c.id}, 'won', event)" class="flex-1 bg-emerald-500 text-white text-[9px] font-black py-2 rounded-lg uppercase tracking-widest">Signé</button>
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
}

// ACTIONS SUPABASE
async function saveClient() {
    const btn = document.getElementById('btnSave');
    btn.disabled = true; btn.innerText = "Enregistrement...";

    const data = {
        entreprise: document.getElementById('f-entreprise').value,
        contact: document.getElementById('f-contact').value,
        email: document.getElementById('f-email').value,
        tel: document.getElementById('f-tel').value,
        prix: parseFloat(document.getElementById('f-prix').value) || 0,
        nbRelances: parseInt(document.getElementById('f-nbRelances').value) || 0,
        dateR: document.getElementById('f-dateR').value || null,
        dateE: document.getElementById('f-dateE').value || null,
        infos: document.getElementById('f-infos').value
    };

    if (currentId) {
        await _supabase.from('clients').update(data).eq('id', currentId);
    } else {
        data.status = 'new';
        data.dateC = new Date().toISOString().split('T')[0];
        if(!data.dateR) data.dateR = getNextRelanceDate(0);
        await _supabase.from('clients').insert([data]);
    }

    closeModal();
    btn.disabled = false; btn.innerText = "Enregistrer";
    loadData();
}

async function updateStatus(id, stat, e) {
    if(e) e.stopPropagation();
    await _supabase.from('clients').update({ status: stat }).eq('id', id);
    loadData();
}

async function doRelance(id, e) {
    e.stopPropagation();
    const c = clients.find(x => x.id === id);
    const n = (c.nbRelances || 0) + 1;
    await _supabase.from('clients').update({ 
        status: 'progress', 
        nbRelances: n,
        dateR: getNextRelanceDate(n)
    }).eq('id', id);
    loadData();
}

async function deleteClient() {
    if(confirm("Supprimer définitivement ?")) {
        await _supabase.from('clients').delete().eq('id', currentId);
        closeModal();
        loadData();
    }
}

// CSV IMPORT
async function handleCSV(event) {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = async function(e) {
        const rows = e.target.result.split('\n').slice(1);
        const toInsert = rows.map(row => {
            if (!row.trim()) return null;
            const cols = row.split(';');
            return {
                entreprise: cols[0] || "Client",
                contact: cols[1] || "",
                email: cols[2] || "",
                tel: cols[3] || "",
                prix: parseFloat(cols[4]) || 0,
                status: 'new',
                dateC: new Date().toISOString().split('T')[0],
                dateR: getNextRelanceDate(0)
            };
        }).filter(x => x);
        await _supabase.from('clients').insert(toInsert);
        loadData();
    };
    reader.readAsText(file);
}

// MODALE & UI
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
function setView(v) { 
    document.getElementById('main-content').className = 'p-6 ' + v + '-view';
    document.getElementById('btn-kanban').classList.toggle('active', v === 'kanban');
    document.getElementById('btn-list').classList.toggle('active', v === 'list');
}

// Drag & Drop
['new', 'progress', 'urgent', 'won', 'lost'].forEach(s => {
    new Sortable(document.getElementById(s), { group: 'crm', animation: 150, onEnd: async (e) => {
        const id = e.item.getAttribute('data-id');
        await _supabase.from('clients').update({ status: e.to.id }).eq('id', id);
        loadData();
    }});
});

loadData();
