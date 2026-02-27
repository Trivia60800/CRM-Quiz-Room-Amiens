// ==========================================
// 1. CONFIGURATION ET SÉCURITÉ
// ==========================================
const CONFIG = {
    URL: 'https://sdtgzlrwsrmhsvoztdat.supabase.co',
    ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkdGd6bHJ3c3JtaHN2b3p0ZGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxODgwMjksImV4cCI6MjA4Nzc2NDAyOX0.DZYgBhijp71scgO1fTAte5e536WsDaMb9zTFE_eoa8k',
    AUTH_PASS: "AMIENS2026"
};

const _supabase = supabase.createClient(CONFIG.URL, CONFIG.ANON_KEY);

// Verrouillage du site
(function() {
    let access = sessionStorage.getItem('qr_amiens_auth');
    while (access !== 'ok') {
        const mdp = prompt("Accès restreint - CRM Quiz Room Amiens :");
        if (mdp === null) return; 
        if (mdp === CONFIG.AUTH_PASS) {
            sessionStorage.setItem('qr_amiens_auth', 'ok');
            access = 'ok';
        } else {
            alert("Code incorrect.");
        }
    }
})();

let clients = [];
let currentId = null;
let currentView = 'kanban';

// ==========================================
// 2. LOGIQUE DES DATES ET CALCULS
// ==========================================

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

function getDaysDiff(dateR) {
    if (!dateR) return null;
    const today = new Date();
    today.setHours(0,0,0,0);
    const target = new Date(dateR);
    target.setHours(0,0,0,0);
    const diffTime = target - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// ==========================================
// 3. ACTION DE RELANCE AVEC COMMENTAIRE
// ==========================================

async function doRelance(id, e) {
    if (e) e.stopPropagation();
    const c = clients.find(x => x.id === id);
    
    // 1. Choisir le moyen de relance
    const moyen = prompt("Moyen de relance :\n1: Mail\n2: Téléphone\n3: SMS\n4: Autre", "1");
    if (!moyen) return;

    let texteMoyen = "";
    switch(moyen) {
        case "1": texteMoyen = "Mail"; break;
        case "2": texteMoyen = "Tel"; break;
        case "3": texteMoyen = "SMS"; break;
        default: texteMoyen = "Autre";
    }

    // 2. Ajouter une note spécifique à cette relance
    const noteRelance = prompt("Note sur cet échange (ex: 'A eu le boss au tel, attend validation budget') :");
    
    // 3. Préparer les données
    const n = (c.nbRelances || 0) + 1;
    const nextDate = getNextRelanceDate(n - 1);
    const dateJour = new Date().toLocaleDateString('fr-FR', {day: '2-digit', month: '2-digit'});
    
    // Formatage du message d'historique
    let logMessage = `[${dateJour}] Relance par ${texteMoyen}`;
    if (noteRelance && noteRelance.trim() !== "") {
        logMessage += ` : ${noteRelance.trim()}`;
    }

    // On ajoute la nouvelle info en haut des notes existantes
    const nouvelleNote = `${logMessage}\n${c.infos || ''}`;

    // 4. Mise à jour Supabase
    const { error } = await _supabase.from('clients').update({ 
        status: 'progress', 
        nbRelances: n,
        dateR: nextDate,
        infos: nouvelleNote
    }).eq('id', id);

    if (error) alert("Erreur : " + error.message);
    else loadData();
}

// ==========================================
// 4. CHARGEMENT ET AFFICHAGE
// ==========================================

async function loadData() {
    const { data, error } = await _supabase.from('clients').select('*').order('id', { ascending: false });
    if (!error) {
        clients = data || [];
        refreshUI();
    }
}

function refreshUI() {
    const todayStr = new Date().toISOString().split('T')[0];
    const search = document.getElementById('searchBar').value.toLowerCase();

    ['new', 'progress', 'urgent', 'won', 'lost'].forEach(status => {
        const container = document.getElementById(status);
        if (!container) return;
        container.innerHTML = '';
        
        const filtered = clients.filter(c => {
            const matchesSearch = c.entreprise.toLowerCase().includes(search) || (c.contact && c.contact.toLowerCase().includes(search));
            return c.status === status && matchesSearch;
        });

        document.getElementById(`cnt-${status}`).innerText = filtered.length;

        filtered.forEach(c => {
            const diff = getDaysDiff(c.dateR);
            
            // Passage auto en Urgent si échéance passée
            if (c.dateR && c.dateR <= todayStr && (status === 'new' || status === 'progress')) {
                updateStatus(c.id, 'urgent');
            }

            let timeBadge = "";
            if (c.dateR) {
                if (diff < 0) timeBadge = `<span class="text-rose-600 font-bold">Retard ${Math.abs(diff)}j</span>`;
                else if (diff === 0) timeBadge = `<span class="text-amber-600 font-bold animate-pulse">JOUR J</span>`;
                else timeBadge = `<span class="text-slate-400">J-${diff}</span>`;
            }

            const card = document.createElement('div');
            card.className = "card";
            card.setAttribute('data-id', c.id);
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <span class="text-[9px] font-black text-slate-400 uppercase bg-slate-100 px-2 py-1 rounded">${c.entreprise}</span>
                    <span class="text-sm font-black text-indigo-600">${c.prix || 0}€</span>
                </div>
                <div class="text-sm font-bold text-slate-800 mt-2">${c.contact || 'N/C'}</div>
                <div class="mt-4 flex items-center justify-between">
                    <div class="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">R : ${c.nbRelances || 0}</div>
                    <div class="text-[9px] uppercase tracking-tighter">${timeBadge}</div>
                </div>
                <div class="actions">
                    <button onclick="copyRelanceScript(${c.id}, event)" class="flex-1 bg-slate-800 text-white text-[9px] font-bold py-2 rounded-lg">SCRIPT</button>
                    <button onclick="doRelance(${c.id}, event)" class="flex-1 bg-indigo-600 text-white text-[9px] font-bold py-2 rounded-lg">RELANCÉ</button>
                </div>
            `;
            card.onclick = () => openEditModal(c.id);
            container.appendChild(card);
        });
    });
    updateStats();
}

// ==========================================
// 5. FONCTIONS CRUD
// ==========================================

async function saveClient() {
    const data = {
        entreprise: document.getElementById('f-entreprise').value,
        contact: document.getElementById('f-contact').value,
        email: document.getElementById('f-email').value,
        tel: document.getElementById('f-tel').value,
        prix: parseFloat(document.getElementById('f-prix').value) || 0,
        dateE: document.getElementById('f-dateE').value || null,
        dateR: document.getElementById('f-dateR').value || null,
        nbRelances: parseInt(document.getElementById('f-nbRelances').value) || 0,
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
    loadData();
}

async function updateStatus(id, stat, e) {
    if (e) e.stopPropagation();
    await _supabase.from('clients').update({ status: stat }).eq('id', id);
    loadData();
}

async function deleteClient() {
    if (confirm("Supprimer ce dossier ?")) {
        await _supabase.from('clients').delete().eq('id', currentId);
        closeModal();
        loadData();
    }
}

// ==========================================
// 6. MODALES & STATS
// ==========================================

function openEditModal(id) {
    currentId = id;
    const c = clients.find(x => x.id === id);
    document.getElementById('f-entreprise').value = c.entreprise;
    document.getElementById('f-contact').value = c.contact || '';
    document.getElementById('f-email').value = c.email || '';
    document.getElementById('f-tel').value = c.tel || '';
    document.getElementById('f-prix').value = c.prix || 0;
    document.getElementById('f-dateE').value = c.dateE || '';
    document.getElementById('f-dateR').value = c.dateR || '';
    document.getElementById('f-nbRelances').value = c.nbRelances || 0;
    document.getElementById('f-infos').value = c.infos || '';
    document.getElementById('modal').classList.remove('hidden');
}

function openAddModal() {
    currentId = null;
    document.getElementById('clientForm').reset();
    document.getElementById('modal').classList.remove('hidden');
}

function closeModal() { document.getElementById('modal').classList.add('hidden'); }

function updateStats() {
    let pending = 0, won = 0, cWon = 0, cLost = 0;
    clients.forEach(c => {
        const p = parseFloat(c.prix) || 0;
        if (c.status === 'won') { won += p; cWon++; }
        else if (c.status === 'lost') { cLost++; }
        else { pending += p; }
    });
    document.getElementById('statPending').innerText = pending.toLocaleString() + "€";
    document.getElementById('statWon').innerText = won.toLocaleString() + "€";
    const total = cWon + cLost;
    document.getElementById('statConv').innerText = total > 0 ? Math.round((cWon / total) * 100) + "%" : "0%";
}

function copyRelanceScript(id, e) {
    e.stopPropagation();
    const c = clients.find(x => x.id === id);
    const texte = `Bonjour ${c.contact || c.entreprise},\n\nJe reviens vers vous concernant votre projet Quiz Room Amiens (${c.prix}€).\n\nAvez-vous pu en discuter ?\n\nÀ bientôt !`;
    navigator.clipboard.writeText(texte).then(() => alert("Script copié !"));
}

// Drag & Drop
['new', 'progress', 'urgent', 'won', 'lost'].forEach(s => {
    const el = document.getElementById(s);
    if (el) {
        new Sortable(el, { group: 'crm', animation: 150, onEnd: async (e) => {
            const id = e.item.getAttribute('data-id');
            await _supabase.from('clients').update({ status: e.to.id }).eq('id', id);
            loadData();
        }});
    }
});

// Import CSV
async function handleCSV(event) {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
        const rows = e.target.result.split('\n').slice(1);
        const toInsert = rows.map(row => {
            const cols = row.match(/(".*?"|[^",\r\n]+)(?=\s*,|\s*$|\r|\n)/g) || [];
            if (cols.length < 5) return null;
            const clean = (v) => v ? v.replace(/"/g, '').trim() : "";
            return {
                entreprise: clean(cols[0]),
                contact: clean(cols[1]),
                email: clean(cols[2]),
                tel: clean(cols[3]),
                prix: parseFloat(clean(cols[11]).replace('€','').replace(/\s/g,'').replace(',','.')) || 0,
                status: 'new',
                dateR: getNextRelanceDate(0),
                infos: clean(cols[13]),
                dateC: new Date().toISOString().split('T')[0]
            };
        }).filter(x => x);
        await _supabase.from('clients').insert(toInsert);
        loadData();
    };
    reader.readAsText(file);
}

loadData();
