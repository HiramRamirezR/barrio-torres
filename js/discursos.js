import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit, doc, updateDoc, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { auth } from "./auth.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let allMembers = [];
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
                const adminButtons = document.querySelectorAll('button[onclick*="openImportModal"], button[onclick*="deduplicateMembers"], button[onclick*="markSuggestedAsLessActive"], button[onclick*="nextSuggestion"]');
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

        skippedSuggestions = new Set(); // Reset skipped on reload
        updateUI();
    } catch (e) {
        console.error("Error cargando datos:", e);
    }
}

function updateUI() {
    renderTable();
    renderRecent();
    calculateSuggestion();
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
                <button class="btn btn" onclick="window.prepareRecord('${m.id}', '${m.nombre}')" style="font-size:0.75rem; border:1px solid #ddd">
                    ${m.lastDate ? 'Editar' : 'Asignar'}
                </button>
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

window.prepareRecord = (id, name) => {
    window.currentRecordingId = id;
    const member = allMembers.find(m => m.id === id);

    document.getElementById('recordMemberName').textContent = name;

    // Fill with existing data if editing
    if (member && member.lastDate) {
        document.getElementById('discursoDate').value = member.lastDate;
        document.getElementById('discursoTopic').value = member.lastTopic || '';
    } else {
        document.getElementById('discursoDate').value = '';
        document.getElementById('discursoTopic').value = '';
    }

    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('recordModal').style.display = 'block';
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
    document.getElementById('importModal').style.display = 'none';
};

window.saveDiscurso = async () => {
    const date = document.getElementById('discursoDate').value;
    const topic = document.getElementById('discursoTopic').value;

    if (!date || !topic) {
        alert("Por favor complete fecha y tema");
        return;
    }

    const memberRef = doc(db, "miembros", window.currentRecordingId);
    await updateDoc(memberRef, {
        lastDate: date,
        lastTopic: topic
    });

    closeModal();
    loadData(); // Reload
};

window.openImportModal = () => {
    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('importModal').style.display = 'block';
};

window.processImport = async () => {
    const text = document.getElementById('csvData').value;
    const lines = text.split('\n');
    let count = 0;

    const btn = event.target;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Importando... (Esto puede tardar)";

    // Función para separar por comas respetando comillas
    const parseCSVLine = (line) => {
        const result = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(cur.trim());
                cur = '';
            } else {
                cur += char;
            }
        }
        result.push(cur.trim());
        return result;
    };

    for (let line of lines) {
        if (!line.trim()) continue;

        const parts = parseCSVLine(line);
        // Formato esperado: Nombre, Sexo, Edad, Fecha de Nacimiento
        if (parts.length >= 3) {
            let nombre = parts[0].replace(/^"|"$/g, ''); // Quitar comillas si quedaron
            const sexo = parts[1].toUpperCase();
            const edad = parseInt(parts[2]);
            const fechaNac = parts[3] ? parts[3].replace(/^"|"$/g, '') : '';

            const org = determineOrganization(sexo, edad);

            if (nombre && org) {
                await addDoc(collection(db, "miembros"), {
                    nombre,
                    sexo,
                    edad,
                    fechaNacimiento: fechaNac,
                    organizacion: org,
                    isLessActive: false,
                    skip: false,
                    lastDate: null,
                    lastTopic: null
                });
                count++;
            }
        }
    }

    btn.disabled = false;
    btn.textContent = originalText;
    alert(`Se importaron ${count} miembros exitosamente.`);
    closeModal();
    loadData();
};

window.deduplicateMembers = async () => {
    if (!confirm("¿Desea eliminar los miembros duplicados? Esto dejará solo un registro por cada nombre y fecha de nacimiento.")) return;

    const btn = event.target;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Limpiando...";

    const seen = new Set();
    let deletedCount = 0;

    // Usamos un for...of para manejar la asincronía de deleteDoc
    for (const m of allMembers) {
        const key = `${m.nombre}-${m.fechaNacimiento}`.toLowerCase();
        if (seen.has(key)) {
            const { deleteDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
            await deleteDoc(doc(db, "miembros", m.id));
            deletedCount++;
        } else {
            seen.add(key);
        }
    }

    btn.disabled = false;
    btn.textContent = originalText;
    alert(`Limpieza terminada. Se eliminaron ${deletedCount} duplicados.`);
    loadData();
};

function determineOrganization(sexo, edad) {
    if (edad >= 18) {
        return (sexo === 'V') ? 'Quórum Élderes' : 'Soc. Socorro';
    } else if (edad >= 11) {
        return (sexo === 'V') ? 'HHJJ' : 'MMJJ';
    } else if (edad >= 0) {
        return 'Primaria';
    }
    return 'Desconocido';
}

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
