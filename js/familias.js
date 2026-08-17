import { getFirestore, collection, getDocs, doc, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

let allMembers = [];
let currentFilter = 'all'; // all | activas | inactivas
let currentMemberForMove = null;

// --- Helpers ---
function removeAccents(str) {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function isActiveMember(m) {
    return !m.isLessActive;
}

function isAdmin() {
    return window.currentUserRole?.nivel === 'admin';
}

// Clave de familia: manual (m.familia) o primer apellido normalizado
function familyKeyOf(m) {
    if (m.familia) return m.familia;
    const before = (m.nombre || '').split(',')[0].trim();
    return removeAccents(before.split(/\s+/)[0] || before);
}

// Nombre de la familia: apellido(s) del primer integrante (antes de la coma)
function displayNameOf(members) {
    const before = (members[0].nombre || '').split(',')[0].trim();
    return before || members[0].nombre;
}

// --- Data ---
async function loadData() {
    try {
        const querySnapshot = await getDocs(collection(db, "miembros"));
        allMembers = [];
        querySnapshot.forEach((doc) => {
            allMembers.push({ id: doc.id, ...doc.data() });
        });
        renderAll();
    } catch (e) {
        console.error("Error cargando datos:", e);
    }
}

function buildFamilies() {
    const map = new Map();
    allMembers.forEach(m => {
        const key = familyKeyOf(m);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(m);
    });

    return [...map.entries()].map(([key, members]) => {
        const activos = members.filter(isActiveMember).length;
        return {
            key,
            name: displayNameOf(members),
            members,
            activos,
            menosActivos: members.length - activos,
            status: activos > 0 ? 'activa' : 'inactiva'
        };
    }).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function getFilteredFamilies() {
    let families = buildFamilies();

    if (currentFilter === 'activas') {
        families = families.filter(f => f.status === 'activa');
    } else if (currentFilter === 'inactivas') {
        families = families.filter(f => f.status === 'inactiva');
    }

    const searchRaw = document.getElementById('familySearch')?.value || '';
    const searchTerms = removeAccents(searchRaw).split(' ').filter(t => t.length > 0);
    if (searchTerms.length > 0) {
        families = families.filter(f => {
            const famText = removeAccents(f.name);
            const membersText = f.members.map(m => removeAccents(m.nombre)).join(' ');
            const fullText = `${famText} ${membersText}`;
            return searchTerms.every(term => fullText.includes(term));
        });
    }

    return families;
}

// --- Rendering ---
function renderAll() {
    renderStats();
    renderFamilies();
}

function renderStats() {
    const families = buildFamilies();
    const activas = families.filter(f => f.status === 'activa').length;
    const inactivas = families.length - activas;
    const miembrosActivos = allMembers.filter(isActiveMember).length;

    document.getElementById('statFamilias').textContent = families.length;
    document.getElementById('statActivas').textContent = activas;
    document.getElementById('statInactivas').textContent = inactivas;
    document.getElementById('statMiembrosActivos').textContent = miembrosActivos;
}

function getOrgClass(org) {
    const map = {
        'Soc. Socorro': 'tag-ss',
        'Quórum Élderes': 'tag-qe',
        'HHJJ': 'tag-hhjj',
        'MMJJ': 'tag-mmjj',
        'Primaria': 'tag-primaria'
    };
    return map[org] || '';
}

function renderFamilies() {
    const grid = document.getElementById('familiesGrid');
    grid.innerHTML = '';

    const families = getFilteredFamilies();
    const counter = document.getElementById('familyCount');
    if (counter) counter.textContent = families.length;

    if (families.length === 0) {
        grid.innerHTML = '<div class="card" style="grid-column:1/-1; text-align:center; color:var(--text-muted);">Sin familias para mostrar.</div>';
        return;
    }

    const admin = isAdmin();

    families.forEach(f => {
        const card = document.createElement('div');
        card.className = 'card family-card';
        card.innerHTML = `
            <div class="family-header">
                <div>
                    <h3 class="family-name">${f.name}</h3>
                    <span class="count-badge">${f.members.length} ${f.members.length === 1 ? 'integrante' : 'integrantes'}</span>
                </div>
                <span class="badge ${f.status === 'activa' ? 'badge-activa' : 'badge-inactiva'}">${f.status === 'activa' ? 'Activa' : 'Inactiva'}</span>
            </div>
            <div class="family-stats">
                <span class="dot dot-activo"></span> Activos: <strong>${f.activos}</strong>
                <span class="dot dot-menos"></span> Menos activos: <strong>${f.menosActivos}</strong>
            </div>
            <div class="family-members">
                ${f.members.map(m => `
                    <div class="member-row ${m.isLessActive ? 'member-less' : ''}">
                        <div class="member-row-info">
                            <span class="member-name">${m.nombre}</span>
                            <span class="tag ${getOrgClass(m.organizacion)}">${m.organizacion || '—'}</span>
                            <span class="member-state">${m.isLessActive ? 'Menos activo' : 'Activo'}</span>
                        </div>
                        ${admin ? `
                            <div style="display:flex; align-items:center; gap:0.5rem; flex-shrink:0;">
                                <label class="checkbox-wrapper" title="Marcar como menos activo">
                                    <input type="checkbox" ${m.isLessActive ? 'checked' : ''} onchange="window.toggleLessActive('${m.id}', this.checked)">
                                    Menos activo
                                </label>
                                <button class="btn-move" onclick="openMoveModal('${m.id}')" title="Mover de familia">⇄</button>
                            </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        `;
        grid.appendChild(card);
    });
}

// --- Filtros ---
window.filterFamilies = (filter) => {
    currentFilter = filter;
    const buttons = document.querySelectorAll('#familyFilters .btn');
    buttons.forEach(b => b.classList.remove('btn-primary'));
    if (event && event.target && event.target.tagName === 'BUTTON') {
        event.target.classList.add('btn-primary');
    }
    renderAll();
};

window.renderFamilies = renderFamilies;

// --- Marcar menos activo ---
window.toggleLessActive = async (id, value) => {
    const memberRef = doc(db, "miembros", id);
    await updateDoc(memberRef, { isLessActive: value });
    const m = allMembers.find(member => member.id === id);
    if (m) m.isLessActive = value;
    renderAll();
};

// --- Mover / Separar ---
window.openMoveModal = (memberId) => {
    const member = allMembers.find(m => m.id === memberId);
    if (!member) return;

    currentMemberForMove = member;
    document.getElementById('moveMemberName').textContent = member.nombre;

    const currentKey = familyKeyOf(member);
    const families = buildFamilies();

    const select = document.getElementById('moveTarget');
    select.innerHTML = families
        .filter(f => f.key !== currentKey)
        .map(f => `<option value="${f.key}">${f.name}</option>`)
        .join('');

    const hasManual = !!member.familia;
    const revertBtn = document.getElementById('btnRevert');
    revertBtn.style.display = hasManual ? 'inline-block' : 'none';

    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('moveModal').style.display = 'block';
};

window.confirmMove = async () => {
    if (!currentMemberForMove) return;
    const target = document.getElementById('moveTarget').value;
    if (!target) return;

    const memberRef = doc(db, "miembros", currentMemberForMove.id);
    await updateDoc(memberRef, { familia: target });
    const m = allMembers.find(x => x.id === currentMemberForMove.id);
    if (m) m.familia = target;
    closeModal();
    renderAll();
};

window.revertMember = async () => {
    if (!currentMemberForMove) return;
    const memberRef = doc(db, "miembros", currentMemberForMove.id);
    await updateDoc(memberRef, { familia: deleteField() });
    const m = allMembers.find(x => x.id === currentMemberForMove.id);
    if (m) delete m.familia;
    closeModal();
    renderAll();
};

window.closeModal = () => {
    document.getElementById('modalOverlay').style.display = 'none';
    document.getElementById('moveModal').style.display = 'none';
    currentMemberForMove = null;
};

// --- Exportar CSV ---
window.exportFamiliesCSV = () => {
    const families = getFilteredFamilies();
    const rows = ['Familia,Nombre,Sexo,Edad,Fecha de nacimiento,Organizacion,Estado'];

    families.forEach(f => {
        f.members.forEach(m => {
            const nombre = /,/.test(m.nombre) ? `"${m.nombre}"` : m.nombre;
            rows.push([
                f.name,
                nombre,
                m.sexo || '',
                m.edad ?? '',
                m.fechaNacimiento || '',
                m.organizacion || '',
                m.isLessActive ? 'Menos activo' : 'Activo'
            ].join(','));
        });
    });

    const blob = new Blob(["\uFEFF" + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'familias.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('familySearch');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderFamilies();
        });
    }

    const checkAuth = setInterval(() => {
        if (window.currentUserRole) {
            clearInterval(checkAuth);
            loadData();
        }
    }, 100);
});