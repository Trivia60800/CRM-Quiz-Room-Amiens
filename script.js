// CONFIGURATION
const CONFIG = {
    URL: 'https://sdtgzlrwsrmhsvoztdat.supabase.co',
    ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkdGd6bHJ3c3JtaHN2b3p0ZGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxODgwMjksImV4cCI6MjA4Nzc2NDAyOX0.DZYgBhijp71scgO1fTAte5e536WsDaMb9zTFE_eoa8k',
    AUTH_PASS: "AMIENS2026"
};

const _supabase = supabase.createClient(CONFIG.URL, CONFIG.ANON_KEY);

// AUTH SIMPLE
(function() {
    if (sessionStorage.getItem('qr_amiens_auth') !== 'ok') {
        const mdp = prompt("Accès restreint :");
        if (mdp === CONFIG.AUTH_PASS) sessionStorage.setItem('qr_amiens_auth', 'ok');
        else window.location.reload();
    }
})();

let clients = [];
let currentId = null;

// HELPERS DATES
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
    return addBusinessDays(new Date(), steps[count] || 15);
}

// RELANCE AVEC NOTE
async function doRelance(id, e) {
    if (e) e.stopPropagation();
    const c = clients.find(x => x.id === id);
    
    const moyen = prompt("Moyen de relance :\n1: Mail, 2: Tel, 3: SMS, 4: Autre", "1");
    if (!moyen) return;

    const notesRelance = prompt("Note sur l'échange (optionnel) :");
    const labels = {"1":"Mail","2":"Tel","3":"SMS","4":"Autre"};
    
    const n = (c.nbRelances || 0) + 1;
    const dateJ = new Date().toLocaleDateString('fr-FR', {day:'2-digit', month:'2-digit'});
    let log = `[${dateJ}] Relance par ${labels[moyen] || 'Autre'}`;
    if(notesRelance) log += ` : ${notesRelance}`;
    
    const nouvelleNote = `${log}\n${c.infos || ''}`;

    await _supabase.from('clients').update({ 
        status: 'progress', 
        nbRelances: n,
        dateR: getNextRelanceDate(n-1),
        infos: nouvelleNote
    }).eq('id', id);

    loadData();
}

// CHARGEMENT
async function loadData() {
    try {
        const { data, error } = await _supabase.from('clients').select('*').order('id', { ascending: false });
        if (error) throw error;
        clients = data || [];
        refreshUI();
    } catch (e) {
        console.error("Erreur Supabase :", e);
    }
}

function refreshUI() {
    const today = new Date().toISOString().split('T')[0];
    const search = document.getElementById('searchBar').value.toLowerCase();

    const sections = ['new', 'progress', 'urgent', 'won', 'lost'];
    sections.forEach(status => {
        const container = document.getElementById(status);
        if (!container) return;
        container.innerHTML = '';
        
        const filtered = clients.filter(c => {
            const matches = c.entreprise.toLowerCase().includes(search) || (c.contact && c.contact.toLowerCase().includes(search));
            // Logique visuelle : si c'est en retard, on l'affiche dans Urgent même si son statut BDD est 'new'
            if (status === 'urgent') {
                return matches && (c.status === 'urgent' || (c.dateR && c.dateR <= today && c.status !== 'won' && c.status !== 'lost'));
            }
            if (status === 'new' || status === 'progress') {
                // On ne l'affiche ici que s'il n'est PAS en retard (sinon il est dans urgent)
                return matches && c.status === status && (!c.dateR || c.dateR > today);
            }
            return matches && c.status === status;
        });

        document.getElementById(`cnt-${status}`).innerText = filtered.length;

        filtered.forEach(c => {
            const isOverdue = c.dateR && c.dateR <= today;
            
            const card = document.createElement('div');
            card.className = `card ${isOverdue && c.status !== 'won' ? 'border-l-4 border-rose-500' : ''}`;
            card.setAttribute('data-id', c.id);
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <span class="text-[9px] font-black text-slate-400 uppercase bg-slate-100 px-2 py-1 rounded">${c.entreprise}</span>
                    <span class="text-sm font-black text-indigo-600">${c.prix || 0}€</span>
                </div>
                <div class="text-sm font-bold text-slate-800 mt-2">${c.contact || 'N/C'}</div>
                <div class="mt-4 flex items-center justify-between">
                    <div class="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">R : ${c.nbRelances || 0}</div>
                    <div class="text-[9px] font-bold ${isOverdue ? 'text-rose-500 animate-pulse' : 'text-slate-400'}">
                        ${isOverdue ? 'À RELANCER' : (c.dateR || '--')}
                    </div>
                </div>
                <div class="actions">
                    <button onclick="copyRelanceScript(${c.id}, event)" class="flex-1 bg-slate-800 text-white text-[9px] font-bold py-2 rounded-lg uppercase">Script</button>
                    <button onclick="doRelance(${c.id}, event)" class="flex-1 bg-indigo-600 text-white text-[9px] font-bold py-2 rounded-lg uppercase">Relancé</button>
                </div>
            `;
            card.onclick = () => openEditModal(c.id);
            container.appendChild(card);
        });
    });
    updateStats();
}

// CRUD
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

async function updateStatus(id, stat) {
    await _supabase.from('clients').update({ status: stat }).eq('id', id);
    loadData();
}

// AUTRES FONCTIONS (Modales, Stats, Sortable...)
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

function openAddModal() { currentId = null; document.getElementById('clientForm').reset(); document.getElementById('modal').classList.remove('hidden'); }
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
    document.getElementById('statConv').innerText = total > 0 ? Math.round((cWon/total)*100) + "%" : "0%";
}

function copyRelanceScript(id, e) {
    e.stopPropagation();
    const c = clients.find(x => x.id === id);
    const texte = `Bonjour ${c.contact || c.entreprise},\n\nJe reviens vers vous concernant votre projet Quiz Room Amiens (${c.prix}€).\n\nAvez-vous pu en discuter ?\n\nÀ bientôt !`;
    navigator.clipboard.writeText(texte).then(() => alert("Copié !"));
}

// Drag and drop
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
            
            const formatDate = (d) => {
                if (!d || d === "" || d === '""') return null;
                const p = d.split('/');
                return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : null;
            };

            return {
                entreprise: clean(cols[0]),
                contact: clean(cols[1]),
                email: clean(cols[2]),
                tel: clean(cols[3]),
                prix: parseFloat(clean(cols[11]).replace('€','').replace(/\s/g,'').replace(',','.')) || 0,
                status: clean(cols[10]).includes('Annulé') ? 'lost' : 'new',
                dateE: formatDate(clean(cols[5])),
                dateR: formatDate(clean(cols[7])),
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
