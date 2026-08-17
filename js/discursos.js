import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit, doc, updateDoc, where, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { auth } from "./auth.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let allMembers = [];
let allDiscursos = [];
let currentFilter = 'all';
let hideLessActive = false;
let showOnlyParticipants = false;
let skippedSuggestions = new Set();

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadData();

    // UI Setup
    const searchInput = document.getElementById('memberSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderTable(e.target.value);
        });
    }

    // Esperar a que el rol esté definido
    const checkRole = setInterval(() => {
        if (window.currentUserRole) {
            clearInterval(checkRole);
            const isAdmin = window.currentUserRole.nivel === 'admin';

            // Ocultar botones de administración si no es admin
            if (!isAdmin) {
                const adminButtons = document.querySelectorAll('button[onclick*="markSuggestedAsLessActive"], button[onclick*="nextSuggestion"]');
                adminButtons.forEach(btn => btn.style.display = 'none');

                // También el botón de registrar discurso en la sugerencia
                const regBtn = document.querySelector('.btn-record');
                if (regBtn) regBtn.style.display = 'none';
            }
        }
    }, 100);
});

async function loadData() {
    try {
        const querySnapshot = await getDocs(collection(db, "miembros"));
        allMembers = [];
        querySnapshot.forEach((doc) => {
            allMembers.push({ id: doc.id, ...doc.data() });
        });

        const discursosSnapshot = await getDocs(collection(db, "discursos"));
        allDiscursos = [];
        discursosSnapshot.forEach((doc) => {
            allDiscursos.push({ id: doc.id, ...doc.data() });
        });

        await migrateHistory();

        skippedSuggestions = new Set(); // Reset skipped on reload
        updateUI();
    } catch (e) {
        console.error("Error cargando datos:", e);
    }
}

function updateUI() {
    renderTable();
    renderRecent();
    renderChart();
    renderRanking();
    calculateSuggestion();
}

// --- Histórico de discursos ---
// Migra los lastDate/lastTopic existentes a la colección "discursos" (idempotente)
async function migrateHistory() {
    const hasRecord = new Set(allDiscursos.map(d => d.miembroId));
    for (const m of allMembers) {
        if (m.lastDate && !m.migratedDiscursos && !hasRecord.has(m.id)) {
            const ref = await addDoc(collection(db, "discursos"), {
                miembroId: m.id,
                nombre: m.nombre,
                fecha: m.lastDate,
                tema: m.lastTopic || ''
            });
            await updateDoc(doc(db, "miembros", m.id), { migratedDiscursos: true });
            allDiscursos.push({ id: ref.id, miembroId: m.id, nombre: m.nombre, fecha: m.lastDate, tema: m.lastTopic || '' });
        }
    }
}

function discursosCount(memberId) {
    return allDiscursos.filter(d => d.miembroId === memberId).length;
}

function discursosOf(memberId) {
    return allDiscursos
        .filter(d => d.miembroId === memberId)
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

function isElegible(m) {
    return !m.isLessActive && !m.skip && m.organizacion !== 'Primaria';
}

function hasSpoken(m) {
    return discursosCount(m.id) > 0 || !!m.lastDate;
}

// Helper para evitar discrepancia de 1 día por zonas horarias
function formatDate(dateString) {
    if (!dateString) return '---';
    const parts = dateString.split('-'); // Espera YYYY-MM-DD
    if (parts.length !== 3) return dateString;
    const [year, month, day] = parts;
    return `${day}/${month}/${year}`;
}

function removeAccents(str) {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// --- Algorithm: Suggestions ---
function calculateSuggestion() {
    // Filter active, not skipped by flags AND not skipped by "Ver otra" button
    const pool = allMembers.filter(m =>
        !m.isLessActive &&
        !m.skip &&
        m.organizacion !== 'Primaria' &&
        !skippedSuggestions.has(m.id)
    );

    if (pool.length === 0) {
        if (skippedSuggestions.size > 0) {
            // If we ran out because of skipping, reset and try again
            skippedSuggestions.clear();
            return calculateSuggestion();
        }
        document.getElementById('suggestedName').textContent = "No hay candidatos";
        document.getElementById('suggestedReason').textContent = "Asegúrese de tener miembros activos fuera de Primaria.";
        return;
    }

    // Prioritize those who have NEVER spoken
    let candidates = pool.filter(m => !m.lastDate);

    if (candidates.length === 0) {
        // Sort by oldest date
        candidates = [...pool].sort((a, b) => {
            const dateA = a.lastDate ? new Date(a.lastDate) : new Date(0);
            const dateB = b.lastDate ? new Date(b.lastDate) : new Date(0);
            return dateA - dateB;
        });
    } else {
        // Randomize from those who never spoke
        candidates = candidates.sort(() => Math.random() - 0.5);
    }

    const suggested = candidates[0];
    const edadText = suggested.edad ? ` • ${suggested.edad} años` : '';

    document.getElementById('suggestedName').textContent = suggested.nombre;
    document.getElementById('suggestedReason').textContent = suggested.lastDate
        ? `Última vez: ${formatDate(suggested.lastDate)} (${suggested.organizacion}${edadText})`
        : `¡Nunca ha discursado en el sistema! (${suggested.organizacion}${edadText})`;

    window.currentSuggestedId = suggested.id;
    window.currentSuggestedName = suggested.nombre;
}

// --- Table Rendering ---
function renderTable(search = '') {
    const tbody = document.getElementById('membersBody');
    tbody.innerHTML = '';

    let filtered = [...allMembers];

    // Toggle: Hide less active
    if (hideLessActive) {
        filtered = filtered.filter(m => !m.isLessActive);
    }

    // Toggle: Show only participants (with lastDate)
    if (showOnlyParticipants) {
        filtered = filtered.filter(m => m.lastDate);
    }

    // Filter by Org
    if (currentFilter !== 'all') {
        filtered = filtered.filter(m => m.organizacion === currentFilter);
    }

    // Filter by Search (Name or Topic) - Multi-word support
    const searchRaw = search || document.getElementById('memberSearch')?.value || '';
    const searchTerms = removeAccents(searchRaw).split(' ').filter(t => t.length > 0);

    if (searchTerms.length > 0) {
        filtered = filtered.filter(m => {
            const nombreClean = removeAccents(m.nombre);
            const temaClean = removeAccents(m.lastTopic || '');
            const fullText = `${nombreClean} ${temaClean}`;

            // Revisa que TODOS los términos de búsqueda existan en algún lugar del texto
            return searchTerms.every(term => fullText.includes(term));
        });
    }

    // Sorting
    const sortBy = document.getElementById('sortMembers')?.value || 'nombre';
    filtered.sort((a, b) => {
        if (sortBy === 'nombre') {
            return a.nombre.localeCompare(b.nombre);
        } else if (sortBy === 'fecha_asc') {
            const dateA = a.lastDate ? new Date(a.lastDate) : new Date(0);
            const dateB = b.lastDate ? new Date(b.lastDate) : new Date(0);
            return dateA - dateB;
        } else if (sortBy === 'fecha_desc') {
            const dateA = a.lastDate ? new Date(a.lastDate) : new Date(0);
            const dateB = b.lastDate ? new Date(b.lastDate) : new Date(0);
            return dateB - dateA;
        } else if (sortBy === 'edad') {
            return (a.edad || 0) - (b.edad || 0);
        }
        return 0;
    });

    // Update Counter
    const counter = document.getElementById('memberCount');
    if (counter) counter.textContent = filtered.length;

    filtered.forEach(m => {
        const tr = document.createElement('div'); // Cambiado a div para manejo de clases si fuera necesario, o mantener tr
        const isAdmin = window.currentUserRole?.nivel === 'admin';

        const actionHtml = isAdmin ? `
            <td data-label="Acción">
                <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                    <button class="btn btn" onclick="window.prepareRecord('${m.id}', '${m.nombre}')" style="font-size:0.75rem; border:1px solid #ddd">
                        ${m.lastDate ? 'Editar' : 'Asignar'}
                    </button>
                    ${m.lastDate ? `<button class="btn btn" onclick="window.prepareRecord('${m.id}', '${m.nombre}', 'new')" style="font-size:0.75rem; border:1px solid #ddd" title="Agregar nuevo discurso">＋ Nuevo</button>` : ''}
                </div>
            </td>
            <td data-label="Estado">
                <div class="checkbox-wrapper">
                    <input type="checkbox" ${m.isLessActive ? 'checked' : ''} onchange="window.toggleStatus('${m.id}', 'isLessActive', this.checked)">
                    Menos Activo
                </div>
                <div class="checkbox-wrapper">
                    <input type="checkbox" ${m.skip ? 'checked' : ''} onchange="window.toggleStatus('${m.id}', 'skip', this.checked)">
                    Skip/Salud
                </div>
            </td>
        ` : `
            <td data-label="Acción">---</td>
            <td data-label="Estado">---</td>
        `;

        const trElement = document.createElement('tr');
        if (m.isLessActive) trElement.style.opacity = '0.5';

        trElement.innerHTML = `
            <td data-label="Miembro">
                <div style="font-weight:600">${m.nombre}</div>
                <div style="font-size:0.65rem; color:var(--text-muted)">🎂 ${m.fechaNacimiento || 'Sin fecha'}</div>
            </td>
            <td data-label="Org."><span class="tag ${getOrgClass(m.organizacion)}">${m.organizacion}</span></td>
            <td data-label="Edad">${m.edad || '--'}</td>
            <td data-label="Última Fecha">${formatDate(m.lastDate)}</td>
            <td data-label="Tema">${m.lastTopic || '---'}</td>
            <td data-label="# Discursos">${discursosCount(m.id)}</td>
            ${actionHtml}
        `;
        tbody.appendChild(trElement);
    });
}

// --- Recent Speakers ---
function renderRecent() {
    const list = document.getElementById('recentSpeakersList');
    list.innerHTML = '';

    // Sort by most recent
    const recent = allMembers
        .filter(m => m.lastDate)
        .sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate))
        .slice(0, 8);

    if (recent.length === 0) {
        list.innerHTML = '<div style="color:var(--text-muted); padding: 1rem;">Aún no hay registros de discursos.</div>';
        return;
    }

    recent.forEach(m => {
        const card = document.createElement('div');
        card.className = 'recent-card';
        card.innerHTML = `
            <div class="avatar">${m.nombre.charAt(0)}</div>
            <h4>${m.nombre}</h4>
            <span>${formatDate(m.lastDate)}</span>
            <div style="font-size:0.65rem; color:var(--accent); font-weight:600; margin-top:0.25rem;">${m.lastTopic || ''}</div>
        `;
        list.appendChild(card);
    });
}

// --- Progress Chart (Donut SVG) ---
function renderChart() {
    const pool = allMembers.filter(isElegible);
    const spoke = pool.filter(hasSpoken).length;
    const pending = pool.length - spoke;
    const total = pool.length;

    const spokePct = total > 0 ? Math.round((spoke / total) * 100) : 0;
    const pendingPct = total > 0 ? Math.round((pending / total) * 100) : 0;

    const chartEl = document.getElementById('progressChart');
    if (!chartEl) return;

    const radius = 80;
    const circumference = 2 * Math.PI * radius;
    const gap = 6;
    const spokeLen = total > 0 ? (spoke / total) * circumference : 0;
    const pendLen = total > 0 ? (pending / total) * circumference : 0;
    const spokeSeg = Math.max(spokeLen - (spoke > 0 ? gap : 0), 0);
    const pendSeg = Math.max(pendLen - (pending > 0 ? gap : 0), 0);

    chartEl.innerHTML = `
        <div class="donut-wrap">
            <svg viewBox="0 0 200 200" class="donut">
                <circle class="donut-bg" cx="100" cy="100" r="${radius}"/>
                <circle class="donut-seg donut-spoke" cx="100" cy="100" r="${radius}"
                    stroke-dasharray="${spokeSeg} ${circumference}"
                    transform="rotate(-90 100 100)"/>
                <circle class="donut-seg donut-pending" cx="100" cy="100" r="${radius}"
                    stroke-dasharray="${pendSeg} ${circumference}"
                    stroke-dashoffset="${-(spokeLen + gap)}"
                    transform="rotate(-90 100 100)"/>
                <text x="100" y="94" text-anchor="middle" class="donut-pct">${spokePct}%</text>
                <text x="100" y="116" text-anchor="middle" class="donut-label">ya discursaron</text>
            </svg>
            <div class="donut-legend">
                <div class="legend-item"><span class="dot" style="background:#10b981"></span> Ya discursó: <strong>${spoke}</strong> (${spokePct}%)</div>
                <div class="legend-item"><span class="dot" style="background:#e2e8f0"></span> Pendiente: <strong>${pending}</strong> (${pendingPct}%)</div>
                <div class="legend-item"><span class="dot" style="background:#94a3b8"></span> Total elegible: <strong>${total}</strong></div>
            </div>
        </div>
    `;
}

// --- History / Ranking ---
function renderRanking() {
    const pool = allMembers.filter(isElegible);

    const spoke = pool.filter(hasSpoken)
        .sort((a, b) => discursosCount(b.id) - discursosCount(a.id) || a.nombre.localeCompare(b.nombre));
    const pending = pool.filter(m => !hasSpoken(m))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));

    const maxCount = spoke.length > 0 ? discursosCount(spoke[0].id) : 1;

    renderRankingList('rankingSpoke', spoke, maxCount, true);
    renderRankingList('rankingPending', pending, 1, false);
}

function renderRankingList(containerId, list, maxCount, withBar) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';

    if (list.length === 0) {
        el.innerHTML = '<div style="color:var(--text-muted); font-size:0.875rem;">Sin resultados.</div>';
        return;
    }

    const listWrap = document.createElement('div');
    listWrap.className = 'ranking-list';
    list.forEach(m => {
        const count = discursosCount(m.id);
        const pct = withBar && maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
        const row = document.createElement('div');
        row.className = 'ranking-item';
        row.innerHTML = `
            <div class="ranking-info">
                <span class="ranking-name" onclick="window.openHistoryModal('${m.id}')">${m.nombre}</span>
                <span class="ranking-count">${count} ${count === 1 ? 'discurso' : 'discursos'}</span>
            </div>
            ${withBar ? `<div class="ranking-bar"><div style="width:${pct}%"></div></div>` : ''}
        `;
        listWrap.appendChild(row);
    });
    el.appendChild(listWrap);
}

window.openHistoryModal = (id) => {
    const member = allMembers.find(m => m.id === id);
    if (!member) return;

    window.currentHistoryMemberId = id;
    document.getElementById('historyMemberName').textContent = member.nombre;

    const btnAdd = document.getElementById('btnHistoryAdd');
    if (btnAdd) btnAdd.style.display = window.currentUserRole?.nivel === 'admin' ? 'inline-block' : 'none';

    const form = document.getElementById('historyAddForm');
    if (form) form.style.display = 'none';

    renderHistoryList();

    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('historyModal').style.display = 'block';
};

function renderHistoryList() {
    const listEl = document.getElementById('historyList');
    listEl.innerHTML = '';

    const discursos = discursosOf(window.currentHistoryMemberId);
    if (discursos.length === 0) {
        listEl.innerHTML = '<div style="color:var(--text-muted); font-size:0.875rem; padding:1.5rem 0; text-align:center;">Este miembro aún no tiene discursos registrados.</div>';
    } else {
        const isAdmin = window.currentUserRole?.nivel === 'admin';
        discursos.forEach(d => {
            const item = document.createElement('div');
            item.className = 'history-item';
            item.innerHTML = `
                <div>
                    <div style="font-weight:600; font-size:0.875rem;">${formatDate(d.fecha)}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted);">${d.tema || '---'}</div>
                </div>
                ${isAdmin ? `<button onclick="window.deleteDiscurso('${d.id}')" title="Eliminar discurso" style="background:#fee2e2; color:#ef4444; border:none; width:26px; height:26px; border-radius:6px; cursor:pointer; font-size:0.9rem; flex-shrink:0;">×</button>` : ''}
            `;
            listEl.appendChild(item);
        });
    }
}

window.deleteDiscurso = async (discursoId) => {
    const id = window.currentHistoryMemberId;
    if (!id) return;

    const entry = allDiscursos.find(d => d.miembroId === id && d.id === discursoId);
    if (!entry) return;

    if (!confirm(`¿Eliminar el discurso del ${formatDate(entry.fecha)}?`)) return;

    // Eliminar de Firestore
    if (discursoId) {
        await deleteDoc(doc(db, "discursos", discursoId));
    } else {
        const q = query(collection(db, "discursos"), where("miembroId", "==", id), where("fecha", "==", entry.fecha));
        const snap = await getDocs(q);
        if (!snap.empty) await deleteDoc(doc(db, "discursos", snap.docs[0].id));
    }

    // Quitar del arreglo local
    allDiscursos = allDiscursos.filter(d => d !== entry);

    // Recalcular el último discurso del miembro
    const member = allMembers.find(m => m.id === id);
    const remaining = discursosOf(id);
    const newest = remaining[0];
    const memberRef = doc(db, "miembros", id);
    await updateDoc(memberRef, {
        lastDate: newest ? newest.fecha : null,
        lastTopic: newest ? (newest.tema || '') : ''
    });
    if (member) {
        member.lastDate = newest ? newest.fecha : null;
        member.lastTopic = newest ? (newest.tema || '') : null;
    }

    renderHistoryList();
    renderRecent();
    renderChart();
    renderRanking();
    renderTable();
};

window.toggleHistoryAddForm = () => {
    const form = document.getElementById('historyAddForm');
    const btnAdd = document.getElementById('btnHistoryAdd');
    const show = form.style.display === 'none';
    form.style.display = show ? 'block' : 'none';
    if (btnAdd) btnAdd.textContent = show ? 'Cancelar' : '＋ Agregar discurso';

    if (show) {
        const d = new Date();
        document.getElementById('historyDiscursoDate').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        document.getElementById('historyDiscursoTopic').value = '';
    }
};

window.saveHistoryDiscurso = async () => {
    const id = window.currentHistoryMemberId;
    if (!id) return;

    const date = document.getElementById('historyDiscursoDate').value;
    const topic = document.getElementById('historyDiscursoTopic').value;
    if (!date || !topic) {
        alert("Por favor complete fecha y tema");
        return;
    }

    const memberRef = doc(db, "miembros", id);
    const member = allMembers.find(m => m.id === id);

    await updateDoc(memberRef, { lastDate: date, lastTopic: topic, migratedDiscursos: true });
    const discursoRef = await addDoc(collection(db, "discursos"), {
        miembroId: id,
        nombre: member?.nombre || '',
        fecha: date,
        tema: topic
    });

    allDiscursos.push({ id: discursoRef.id, miembroId: id, nombre: member?.nombre || '', fecha: date, tema: topic });
    if (member) { member.lastDate = date; member.lastTopic = topic; }

    document.getElementById('historyAddForm').style.display = 'none';
    const btnAdd = document.getElementById('btnHistoryAdd');
    if (btnAdd) btnAdd.textContent = '＋ Agregar discurso';

    renderHistoryList();
    renderRecent();
    renderChart();
    renderRanking();
    renderTable();
};

// --- Global Actions (exposed to window) ---
window.filterByOrg = (org) => {
    currentFilter = org;
    renderTable();
    // Update active button styles
    const buttons = document.querySelectorAll('#orgFilters .btn');
    buttons.forEach(b => b.classList.remove('btn-primary'));
    // If we have an event from a button click, highlight it
    if (event && event.target && event.target.tagName === 'BUTTON') {
        event.target.classList.add('btn-primary');
    }
};

window.toggleHideLessActive = (value) => {
    hideLessActive = value;
    renderTable();
};

window.renderTable = renderTable;

window.toggleShowOnlyParticipants = (value) => {
    showOnlyParticipants = value;
    renderTable();
};

window.toggleStatus = async (id, field, value) => {
    const memberRef = doc(db, "miembros", id);
    await updateDoc(memberRef, { [field]: value });
    const m = allMembers.find(member => member.id === id);
    if (m) m[field] = value;
    updateUI();
};

window.prepareRecord = (id, name, mode = null) => {
    window.currentRecordingId = id;
    const member = allMembers.find(m => m.id === id);

    document.getElementById('recordMemberName').textContent = name;

    const hasLast = !!(member && member.lastDate);
    const toggle = document.getElementById('recordModeToggle');
    if (toggle) toggle.style.display = hasLast ? 'flex' : 'none';

    setRecordMode(mode === 'new' ? 'new' : (hasLast ? 'edit' : 'new'));

    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('recordModal').style.display = 'block';
};

window.setRecordMode = (mode) => {
    window.recordMode = mode;
    const btnEdit = document.getElementById('btnModeEdit');
    const btnNew = document.getElementById('btnModeNew');
    if (btnEdit) btnEdit.className = mode === 'edit' ? 'btn btn-primary' : 'btn';
    if (btnNew) btnNew.className = mode === 'new' ? 'btn btn-primary' : 'btn';

    const member = allMembers.find(m => m.id === window.currentRecordingId);
    const dateInput = document.getElementById('discursoDate');
    const topicInput = document.getElementById('discursoTopic');

    if (mode === 'edit' && member && member.lastDate) {
        dateInput.value = member.lastDate;
        topicInput.value = member.lastTopic || '';
    } else {
        const d = new Date();
        dateInput.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        topicInput.value = '';
    }
};

window.openRecordModal = () => {
    if (window.currentSuggestedId) {
        window.prepareRecord(window.currentSuggestedId, window.currentSuggestedName);
    }
};

window.markSuggestedAsLessActive = async () => {
    if (!window.currentSuggestedId) return;
    if (!confirm(`¿Desea marcar a ${window.currentSuggestedName} como Menos Activo y buscar otra sugerencia?`)) return;

    const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const memberRef = doc(db, "miembros", window.currentSuggestedId);

    await updateDoc(memberRef, { isLessActive: true });

    // Local Update
    const m = allMembers.find(member => member.id === window.currentSuggestedId);
    if (m) m.isLessActive = true;

    // Refresh
    updateUI();
};

window.nextSuggestion = () => {
    if (window.currentSuggestedId) {
        skippedSuggestions.add(window.currentSuggestedId);
        calculateSuggestion();
    }
};

window.closeModal = () => {
    document.getElementById('modalOverlay').style.display = 'none';
    document.getElementById('recordModal').style.display = 'none';
    document.getElementById('historyModal').style.display = 'none';
};

window.saveDiscurso = async () => {
    const date = document.getElementById('discursoDate').value;
    const topic = document.getElementById('discursoTopic').value;

    if (!date || !topic) {
        alert("Por favor complete fecha y tema");
        return;
    }

    const memberRef = doc(db, "miembros", window.currentRecordingId);
    const member = allMembers.find(m => m.id === window.currentRecordingId);

    if (window.recordMode === 'new') {
        // Nuevo discurso: siempre crea un registro nuevo
        await updateDoc(memberRef, {
            lastDate: date,
            lastTopic: topic,
            migratedDiscursos: true
        });
        await addDoc(collection(db, "discursos"), {
            miembroId: window.currentRecordingId,
            nombre: member?.nombre || '',
            fecha: date,
            tema: topic
        });
    } else {
        // Editar el último discurso registrado (evita duplicados al editar)
        const entry = allDiscursos.find(d => d.miembroId === window.currentRecordingId && d.fecha === member.lastDate)
            || discursosOf(window.currentRecordingId)[0];
        if (entry) {
            await updateDoc(doc(db, "discursos", entry.id), { fecha: date, tema: topic });
            entry.fecha = date;
            entry.tema = topic;
        }
        await updateDoc(memberRef, { lastDate: date, lastTopic: topic });
    }

    closeModal();
    loadData(); // Reload
};

function getOrgClass(org) {
    const classes = {
        'Soc. Socorro': 'tag-ss',
        'Quórum Élderes': 'tag-qe',
        'HHJJ': 'tag-hhjj',
        'MMJJ': 'tag-mmjj',
        'Primaria': 'tag-primaria'
    };
    return classes[org] || '';
}
