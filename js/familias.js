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
        // Si algún integrante tiene nombre manual de familia, se usa ese
        const manualName = members.find(m => m.familiaNombre)?.familiaNombre;
        return {
            key,
            name: manualName || displayNameOf(members),
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

    // Resetear el formulario de nueva familia
    const newForm = document.getElementById('newFamilyForm');
    if (newForm) newForm.style.display = 'none';
    const btnNew = document.getElementById('btnNewFamily');
    if (btnNew) btnNew.textContent = '＋ Crear nueva familia';
    const newInput = document.getElementById('newFamilyName');
    if (newInput) newInput.value = '';

    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('moveModal').style.display = 'block';
};

window.confirmMove = async () => {
    if (!currentMemberForMove) return;
    const target = document.getElementById('moveTarget').value;
    if (!target) return;

    // Llevar también el nombre manual de la familia destino si lo tiene
    const families = buildFamilies();
    const targetFamily = families.find(f => f.key === target);
    const manualName = targetFamily?.members.find(m => m.familiaNombre)?.familiaNombre;

    const memberRef = doc(db, "miembros", currentMemberForMove.id);
    const data = { familia: target };
    if (manualName) data.familiaNombre = manualName;
    else data.familiaNombre = deleteField();

    await updateDoc(memberRef, data);
    const m = allMembers.find(x => x.id === currentMemberForMove.id);
    if (m) {
        m.familia = target;
        if (manualName) m.familiaNombre = manualName;
        else delete m.familiaNombre;
    }
    closeModal();
    renderAll();
};

window.toggleNewFamilyInput = () => {
    const form = document.getElementById('newFamilyForm');
    const btnNew = document.getElementById('btnNewFamily');
    const show = form.style.display === 'none';
    form.style.display = show ? 'block' : 'none';
    if (btnNew) btnNew.textContent = show ? 'Cancelar' : '＋ Crear nueva familia';
    if (show) document.getElementById('newFamilyName').focus();
};

window.createAndMove = async () => {
    if (!currentMemberForMove) return;
    const name = document.getElementById('newFamilyName').value.trim();
    if (!name) {
        alert("Escriba el nombre de la nueva familia");
        return;
    }

    // Clave única: prefijo "manual:" + nombre normalizado (evita chocar con apellidos automáticos)
    const slug = removeAccents(name).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'familia';
    let key = `manual:${slug}`;
    const existing = new Set(buildFamilies().map(f => f.key));
    let i = 2;
    while (existing.has(key)) {
        key = `manual:${slug}-${i}`;
        i++;
    }

    const memberRef = doc(db, "miembros", currentMemberForMove.id);
    await updateDoc(memberRef, { familia: key, familiaNombre: name });
    const m = allMembers.find(x => x.id === currentMemberForMove.id);
    if (m) {
        m.familia = key;
        m.familiaNombre = name;
    }
    closeModal();
    renderAll();
};

window.revertMember = async () => {
    if (!currentMemberForMove) return;
    const memberRef = doc(db, "miembros", currentMemberForMove.id);
    await updateDoc(memberRef, { familia: deleteField(), familiaNombre: deleteField() });
    const m = allMembers.find(x => x.id === currentMemberForMove.id);
    if (m) {
        delete m.familia;
        delete m.familiaNombre;
    }
    closeModal();
    renderAll();
};

window.closeModal = () => {
    document.getElementById('modalOverlay').style.display = 'none';
    document.getElementById('moveModal').style.display = 'none';
    currentMemberForMove = null;
};

// --- Exportar PDF (imprimir) ---
window.exportFamiliesPDF = () => {
    const families = getFilteredFamilies();
    const report = document.getElementById('printReport');
    if (!report) return;

    const today = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const activas = families.filter(f => f.status === 'activa').length;
    const inactivas = families.length - activas;

    let html = `
        <h1>Familias del Barrio</h1>
        <p class="print-sub">Generado el ${today}</p>
        <div class="print-summary">
            <span>Total: <strong>${families.length}</strong></span>
            <span>Activas: <strong>${activas}</strong></span>
            <span>Inactivas: <strong>${inactivas}</strong></span>
        </div>
    `;

    families.forEach(f => {
        html += `
            <div class="print-family">
                <div class="print-family-head">
                    <span class="print-family-name">${f.name}</span>
                    <span class="print-status ${f.status}">${f.status === 'activa' ? 'Activa' : 'Inactiva'}</span>
                </div>
                <ul>
                    ${f.members.map(m => `
                        <li class="${m.isLessActive ? 'less' : ''}">
                            ${m.nombre}
                            ${m.organizacion ? `<em>— ${m.organizacion}</em>` : ''}
                            ${m.isLessActive ? '<span class="print-less">(menos activo)</span>' : ''}
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    });

    report.innerHTML = html;
    report.style.display = 'block';
    window.print();
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