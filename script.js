const CONFIG = {
    URL: 'https://sdtgzlrwsrmhsvoztdat.supabase.co',
    ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkdGd6bHJ3c3JtaHN2b3p0ZGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxODgwMjksImV4cCI6MjA4Nzc2NDAyOX0.DZYgBhijp71scgO1fTAte5e536WsDaMb9zTFE_eoa8k',
    AUTH_PASS: "AMIENS2026"
};

const _supabase = supabase.createClient(CONFIG.URL, CONFIG.ANON_KEY);

// AUTHENTICATION
(function() {
    if (sessionStorage.getItem('qr_amiens_auth') !== 'ok') {
        const mdp = prompt("Accès restreint - Code :");
        if (mdp === CONFIG.AUTH_PASS) {
            sessionStorage.setItem('qr_amiens_auth', 'ok');
        } else {
            alert("Code incorrect");
            window.location.reload();
        }
    }
})();

let clients = [];
let currentId = null;

// UTILS
const formatDateToDB = (d) => {
    if (!d || d.trim() === "" || d === '""') return null;
    const parts = d.replace(/"/g, '').split('/');
    if (parts.length !== 3) return null;
    return `${parts[2]}-${parts[1]}-${parts[0]}`; // DD/MM/YYYY -> YYYY-MM-DD
};

function addBusinessDays(date, days) {
    let result = new Date(date);
    let added = 0;
    while (added < days) {
        result.setDate(result.getDate() + 1);
        if (result.getDay() !== 0 && result.getDay() !== 6) added++;
    }
    return result.toISOString().split('T')[0];
}

// RELANCE
async function doRelance(id, e) {
    if (e) e.stopPropagation();
    const c = clients.find(x => x.id === id);
    const moyen = prompt("Moyen : 1:Mail, 2:Tel, 3:SMS, 4:Autre", "1");
    if (!moyen) return;
    const note = prompt("Note (optionnel) :");
    
    const labels = {"1":"Mail","2":"Tel","3":"SMS","4":"Autre"};
    const n = (c.nbRelances || 0) + 1;
    const steps = [3, 5, 10];
    const nextR = addBusinessDays(new Date(), steps[n-1] || 15);
    
    const dateJ = new Date().toLocaleDateString('fr-FR');
    const log = `[${dateJ}] Relance ${labels[moyen]}${note ? ' : '+note : ''}`;
    const newInfos = `${log}\n${c.infos || ''}`;

    const { error } = await _supabase.from('clients').update({
        status: 'progress',
        nbRelances: n,
        dateR: nextR,
        infos: newInfos
    }).eq('id', id);

    if (error) console.error(error);
    loadData();
}

// AFFICHAGE
async function loadData() {
    const { data, error } = await _supabase.from('clients').select('*').order('id', { ascending: false });
    if (error) return console.error("Erreur de chargement:", error);
    clients = data || [];
    refreshUI();
}

function refreshUI() {
    const today = new Date().toISOString().split('T')[0];
    const search = document.getElementById('searchBar').value.toLowerCase();
    const columns = ['new', 'progress', 'urgent', 'won', 'lost'];

    columns.forEach(col => {
        const el = document.getElementById(col);
        if (!el) return;
        el.innerHTML = '';

        const filtered = clients.filter(c => {
            const matchSearch = c.entreprise.toLowerCase().includes(search) || (c.contact && c.contact.toLowerCase().includes(search));
            if (!matchSearch) return false;

            // Logique de colonne
            const isOverdue = c.dateR && c.dateR <= today && c.status !== 'won' && c.status !== 'lost';
            if (col === 'urgent') return isOverdue || c.status === 'urgent';
            if (col === 'new' || col === 'progress') return c.status === col && !isOverdue;
            return c.status === col;
        });

        document.getElementById(`cnt-${col}`).innerText = filtered.length;

        filtered.forEach(c => {
            const card = document.createElement('div');
            card.className = 'card';
            card.setAttribute('data-id', c.id);
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <span class="text-[9px] font-black text-slate-400 uppercase bg-slate-100 px-2 py-1 rounded">${c.entreprise}</span>
                    <span class="text-sm font-black text-indigo-600">${c.prix || 0}€</span>
                </div>
                <div class="text-sm font-bold text-slate-800 mt-2">${c.contact || ''}</div>
                <div class="mt-4 flex items-center justify-between">
                    <div class="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">R : ${c.nbRelances || 0}</div>
                    <div class="text-[9px] font-bold ${c.dateR && c.dateR <= today ? 'text-rose-500 animate-pulse' : 'text-slate-400'}">
                        ${c.dateR || '--'}
                    </div>
                </div>
                <div class="actions">
                    <button onclick="copyRelanceScript(${c.id}, event)" class="flex-1 bg-slate-800 text-white text-[9px] font-bold py-2 rounded-lg">SCRIPT</button>
                    <button onclick="doRelance(${c.id}, event)" class="flex-1 bg-indigo-600 text-white text-[9px] font-bold py-2 rounded-lg text-center">RELANCÉ</button>
                </div>
            `;
            card.onclick = () => openEditModal(c.id);
            el.appendChild(card);
        });
    });
    updateStats();
}

// CSV IMPORT
async function handleCSV(event) {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
        const rows = e.target.result.split('\n').slice(1);
        const toInsert = rows.map(row => {
            const cols = row.match(/(".*?"|[^",\r\n]+)(?=\s*,|\s*$|\r|\n)/g) || [];
            if (cols.length < 12) return null;
            const clean = (v) => v ? v.replace(/"/g, '').trim() : "";
            
            return {
                entreprise: clean(cols[0]),
                contact: clean(cols[1]),
                email: clean(cols[2]),
                tel: clean(cols[3]),
                prix: parseFloat(clean(cols[11]).replace('€','').replace(/\s/g,'').replace(',','.')) || 0,
                status: clean(cols[10]).includes('Annulé') ? 'lost' : 'new',
                dateE: formatDateToDB(clean(cols[5])),
                dateR: formatDateToDB(clean(cols[7])),
                infos: clean(cols[13]),
                dateC: new Date().toISOString().split('T')[0]
            };
        }).filter(x => x);

        const { error } = await _supabase.from('clients').insert(toInsert);
        if (error) alert("Erreur d'insertion CSV: " + error.message);
        else loadData();
    };
    reader.readAsText(file);
}

// MODAL & STATS
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
    if (currentId) await _supabase.from('clients').update(data).eq('id', currentId);
    else { data.status = 'new'; data.dateC = new Date().toISOString().split('T')[0]; await _supabase.from('clients').insert([data]); }
    closeModal();
    loadData();
}

async function deleteClient() {
    if(confirm("Supprimer ?")) { await _supabase.from('clients').delete().eq('id', currentId); closeModal(); loadData(); }
}

function updateStats() {
    let p = 0, w = 0, cw = 0, cl = 0;
    clients.forEach(c => {
        const val = parseFloat(c.prix) || 0;
        if(c.status === 'won') { w += val; cw++; }
        else if(c.status === 'lost') cl++;
        else p += val;
    });
    document.getElementById('statPending').innerText = p.toLocaleString() + "€";
    document.getElementById('statWon').innerText = w.toLocaleString() + "€";
    document.getElementById('statConv').innerText = (cw + cl) > 0 ? Math.round((cw/(cw+cl))*100)+"%" : "0%";
}

function copyRelanceScript(id, e) {
    e.stopPropagation();
    const c = clients.find(x => x.id === id);
    const t = `Bonjour ${c.contact || c.entreprise}, je reviens vers vous pour Quiz Room Amiens (${c.prix}€). Avez-vous pu décider ?`;
    navigator.clipboard.writeText(t).then(() => alert("Copié"));
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

loadData();
