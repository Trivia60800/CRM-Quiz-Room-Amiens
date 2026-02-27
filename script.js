// ==========================================
// 1. CONFIGURATION ET SÉCURITÉ
// ==========================================
const CONFIG = {
    URL: 'https://sdtgzlrwsrmhsvoztdat.supabase.co',
    ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkdGd6bHJ3c3JtaHN2b3p0ZGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxODgwMjksImV4cCI6MjA4Nzc2NDAyOX0.DZYgBhijp71scgO1fTAte5e536WsDaMb9zTFE_eoa8k',
    AUTH_PASS: "QRAmiens"
};

const _supabase = supabase.createClient(CONFIG.URL, CONFIG.ANON_KEY);

// Système de verrouillage à l'ouverture du site
(function() {
    let access = sessionStorage.getItem('qr_amiens_auth');
    while (access !== 'ok') {
        const mdp = prompt("Accès restreint - Veuillez saisir le code secret :");
        if (mdp === null) return; 
        if (mdp === CONFIG.AUTH_PASS) {
            sessionStorage.setItem('qr_amiens_auth', 'ok');
            access = 'ok';
        } else {
            alert("Code erroné.");
        }
    }
})();

let clients = [];
let currentId = null;

// ==========================================
// 2. LOGIQUE DES DATES ET RELANCES
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
    const steps = [3, 5, 10]; // Relances à J+3, J+5, J+10
    const days = steps[count] || 15;
    return addBusinessDays(new Date(), days);
}

// ==========================================
// 3. IMPORTATION DU FICHIER GOOGLE SHEETS (CSV)
// ==========================================
async function handleCSV(event) {
    const file = event.target.files[0];
    const reader = new FileReader();
    
    reader.onload = async function(e) {
        const text = e.target.result;
        const rows = text.split('\n').slice(1); // On ignore la ligne d'en-tête
        
        const toInsert = rows.map(row => {
            // Découpe les colonnes en gérant les guillemets pour les prix (ex: "636,50€")
            const cols = row.match(/(".*?"|[^",\r\n]+)(?=\s*,|\s*$|\r|\n)/g) || [];
            if (cols.length < 5) return null;

            // Nettoyage du prix (ex: "1 105€" -> 1105)
            let prixNettoye = 0;
            if (cols[11]) {
                prixNettoye = parseFloat(cols[11].replace(/"/g, '').replace('€', '').replace(/\s/g, '').replace(',', '.')) || 0;
            }

            // Conversion des dates DD/MM/YYYY vers YYYY-MM-DD
            const formatDate = (d) => {
                if (!d || d.trim() === "" || d === '""') return null;
                const parts = d.replace(/"/g, '').split('/');
                return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : null;
            };

            return {
                entreprise: cols[0]?.replace(/"/g, '').trim() || "Inconnu", // Col 0: Entreprise
                contact: cols[1]?.replace(/"/g, '').trim() || "",         // Col 1: Contact
                email: cols[2]?.replace(/"/g, '').trim() || "",           // Col 2: Email
                tel: cols[3]?.replace(/"/g, '').trim() || "",             // Col 3: Téléphone
                prix: prixNettoye,                                        // Col 11: Prix
                status: cols[10]?.includes('Annulé') ? 'lost' : 'new',    // Col 10: Statut
                dateE: formatDate(cols[5]),                               // Col 5: Date événement
                dateR: formatDate(cols[7]),                               // Col 7: Date relance
                infos: cols[13]?.replace(/"/g, '').trim() || "",          // Col 13: Infos +
                dateC: new Date().toISOString().split('T')[0]
            };
        }).filter(x => x !== null);

        const { error } = await _supabase.from('clients').insert(toInsert);
        
        if (error) {
            alert("Erreur d'importation : " + error.message);
        } else {
            alert(toInsert.length + " clients importés avec succès !");
            loadData();
        }
    };
    reader.readAsText(file);
}

// ==========================================
// 4. CHARGEMENT ET AFFICHAGE (SUPABASE)
// ==========================================
async function loadData() {
    try {
        const { data, error } = await _supabase
            .from('clients')
            .select('*')
            .order('id', { ascending: false });

        if (error) throw error;
        clients = data || [];
        refreshUI();
    } catch (err) {
        console.error("Erreur de chargement Supabase:", err.message);
    }
}

function refreshUI() {
    const today = new Date().toISOString().split('T')[0];
    const search = document.getElementById('searchBar').value.toLowerCase();

    ['new', 'progress', 'urgent', 'won', 'lost'].forEach(status => {
        const container = document.getElementById(status);
        if (!container) return;
        container.innerHTML = '';
        
        const filtered = clients.filter(c => {
            const matchesSearch = c.entreprise.toLowerCase().includes(search) || 
                                 (c.contact && c.contact.toLowerCase().includes(search));
            return c.status === status && matchesSearch;
        });

        document.getElementById(`cnt-${status}`).innerText = filtered.length;

        filtered.forEach(c => {
            const prix = parseFloat(c.prix || 0);
            
            // Passage auto en Urgent si la date de relance est dépassée
            if (c.dateR && c.dateR <= today && (status === 'new' || status === 'progress')) {
                updateStatus(c.id, 'urgent');
            }

            const card = document.createElement('div');
            card.className = "card";
            card.setAttribute('data-id', c.id);
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <span class="text-[9px] font-black text-slate-400 uppercase bg-slate-100 px-2 py-1 rounded">${c.entreprise}</span>
                    <span class="text-sm font-black text-indigo-600">${prix}€</span>
                </div>
                <div class="text-sm font-bold text-slate-800 mt-2">${c.contact || 'N/C'}</div>
                <div class="mt-4 flex items-center justify-between">
                    <div class="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">R : ${c.nbRelances || 0}</div>
                    <div class="text-[9px] font-bold ${c.dateR <= today && status !== 'won' ? 'text-rose-500 animate-pulse' : 'text-slate-400'}">
                        <i class="fa-regular fa-clock mr-1"></i>${c.dateR || '--'}
                    </div>
                </div>
                <div class="actions">
                    <button onclick="copyRelanceScript(${c.id}, event)" class="flex-1 bg-slate-800 text-white text-[9px] font-bold py-2 rounded-lg uppercase">Script</button>
                    ${status === 'urgent' ? `<button onclick="doRelance(${c.id}, event)" class="flex-1 bg-indigo-600 text-white text-[9px] font-bold py-2 rounded-lg uppercase">Relancé</button>` : ''}
                    <button onclick="updateStatus(${c.id}, 'won', event)" class="flex-1 bg-emerald-500 text-white text-[9px] font-bold py-2 rounded-lg uppercase">Gagné</button>
                </div>
            `;
            card.onclick = () => openEditModal(c.id);
            container.appendChild(card);
        });
    });
    updateStats();
}

// ==========================================
// 5. ACTIONS ET MODALES
// ==========================================
function copyRelanceScript(id, e) {
    e.stopPropagation();
    const c = clients.find(x => x.id === id);
    const texte = `Bonjour ${c.contact},\n\nJe reviens vers vous concernant votre projet avec Quiz Room Amiens (devis de ${c.prix}€).\n\nAvez-vous pu en discuter avec vos collaborateurs ?\n\nJe reste à votre disposition.\nL'équipe Quiz Room`;
    
    navigator.clipboard.writeText(texte).then(() => {
        alert("Script de relance copié !");
    });
}

async function saveClient() {
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
    loadData();
}

async function doRelance(id, e) {
    if(e) e.stopPropagation();
    const c = clients.find(x => x.id === id);
    const n = (c.nbRelances || 0) + 1;
    await _supabase.from('clients').update({ 
        status: 'progress', 
        nbRelances: n,
        dateR: getNextRelanceDate(n)
    }).eq('id', id);
    loadData();
}

async function updateStatus(id, stat, e) {
    if(e) e.stopPropagation();
    await _supabase.from('clients').update({ status: stat }).eq('id', id);
    loadData();
}

async function deleteClient() {
    if(confirm("Supprimer ce dossier ?")) {
        await _supabase.from('clients').delete().eq('id', currentId);
        closeModal();
        loadData();
    }
}

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

function updateStats() {
    let pending = 0, won = 0, cWon = 0, cLost = 0;
    clients.forEach(c => {
        if (c.status === 'won') { won += c.prix; cWon++; }
        else if (c.status === 'lost') { cLost++; }
        else { pending += c.prix; }
    });
    document.getElementById('statPending').innerText = pending.toLocaleString() + "€";
    document.getElementById('statWon').innerText = won.toLocaleString() + "€";
    const total = cWon + cLost;
    document.getElementById('statConv').innerText = total > 0 ? Math.round((cWon / total) * 100) + "%" : "0%";
}

// Initialisation du Drag & Drop
['new', 'progress', 'urgent', 'won', 'lost'].forEach(s => {
    const el = document.getElementById(s);
    if(el) {
        new Sortable(el, { group: 'crm', animation: 150, onEnd: async (e) => {
            const id = e.item.getAttribute('data-id');
            await _supabase.from('clients').update({ status: e.to.id }).eq('id', id);
            loadData();
        }});
    }
});

loadData();
