import { getFirestore, collection, getDocs, doc, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

// Inicializar de forma segura para no duplicar la app
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

let allMembers = [];
let currentEditingMemberId = null;
let currentFilter = 'all';

const ORGANIZACIONES = ['Soc. Socorro', 'Quórum Élderes', 'HHJJ', 'MMJJ', 'Primaria', 'Escuela Dominical'];

const ESTRUCTURAS = {
    'Obispado': ['Obispo', '1er Consejero', '2do Consejero', 'Secretario', 'Secretario Ejecutivo'],
    'Soc. Socorro': ['Presidenta', '1ª Consejera', '2ª Consejera', 'Secretaria'],
    'Quórum Élderes': ['Presidente', '1er Consejero', '2do Consejero', 'Secretario'],
    'MMJJ': ['Presidenta', '1ª Consejera', '2ª Consejera', 'Secretaria'],
    'HHJJ': ['Presidente', '1er Consejero', '2do Consejero', 'Secretario'],
    'Primaria': ['Presidenta', '1ª Consejera', '2ª Consejera', 'Secretaria'],
    'Escuela Dominical': ['Presidente', '1er Consejero', '2do Consejero', 'Secretario']
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Esperar a que auth.js defina el rol para asegurar que la sesión esté activa
    const checkAuth = setInterval(() => {
        if (window.currentUserRole) {
            clearInterval(checkAuth);
            loadData();
        }
    }, 100);

    // Check for search input in selector
    const searchInput = document.getElementById('memberSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterMemberList(e.target.value);
        });
    }
});

async function loadData() {
    try {
        const querySnapshot = await getDocs(collection(db, "miembros"));
        allMembers = [];
        querySnapshot.forEach((doc) => {
            allMembers.push({ id: doc.id, ...doc.data() });
        });
        
        // Ensure members have llamamientos array
        allMembers.forEach(m => {
            if (!m.llamamientos) m.llamamientos = [];
        });

        renderOrganigrama();
    } catch (e) {
        console.error("Error cargando datos:", e);
    }
}

function renderOrganigrama() {
    const orgGrid = document.getElementById('organizationGrid');
    orgGrid.innerHTML = '';

    // Filter members
    const activeMembers = allMembers.filter(m => !m.isLessActive);
    
    // 1. Render Structure Grid (Organizational Slots)
    Object.keys(ESTRUCTURAS).forEach(orgName => {
        const slots = ESTRUCTURAS[orgName];
        const card = document.createElement('div');
        card.className = 'org-card';
        card.innerHTML = `<h3>${orgName}</h3>`;
        
        const slotsList = document.createElement('div');
        slotsList.className = 'slots-list';
        
        slots.forEach(pos => {
            const fullCallingName = `${pos} - ${orgName}`;
            const holder = activeMembers.find(m => m.llamamientos && m.llamamientos.includes(fullCallingName));
            
            const slot = document.createElement('div');
            slot.className = 'slot';
            
            if (holder) {
                slot.innerHTML = `
                    <span class="slot-label">${pos}</span>
                    <div style="display:flex; align-items:center; gap:0.5rem">
                        <span class="slot-value" onclick="openCallingModal('${holder.id}')" style="cursor:pointer">${holder.nombre}</span>
                        <button class="btn-del" onclick="removeCallingFromSlot('${holder.id}', '${fullCallingName}')" title="Quitar llamamiento" style="padding:0; width:18px; height:18px; font-size:10px">×</button>
                    </div>
                `;
            } else {
                slot.innerHTML = `
                    <span class="slot-label">${pos}</span>
                    <span class="slot-value empty" onclick="openMemberSelector('${fullCallingName}')">+ Asignar</span>
                `;
            }
            slotsList.appendChild(slot);
        });
        
        card.appendChild(slotsList);
        orgGrid.appendChild(card);
    });

    // Stats
    const total0 = activeMembers.filter(m => (m.llamamientos?.length || 0) === 0).length;
    const total1 = activeMembers.filter(m => (m.llamamientos?.length || 0) === 1).length;
    const totalM = activeMembers.filter(m => (m.llamamientos?.length || 0) > 1).length;

    updateStat('statNoCalling', total0);
    updateStat('statOneCalling', total1);
    updateStat('statMultipleCallings', totalM);
}

window.removeCallingFromSlot = async (memberId, callingName) => {
    if (!confirm(`¿Desea quitar el llamamiento "${callingName}"?`)) return;

    const { arrayRemove, doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const memberRef = doc(db, "miembros", memberId);

    try {
        await updateDoc(memberRef, {
            llamamientos: arrayRemove(callingName)
        });

        // Update local
        const m = allMembers.find(member => member.id === memberId);
        if (m) {
            m.llamamientos = m.llamamientos.filter(c => c !== callingName);
        }

        renderOrganigrama();
    } catch (e) {
        console.error("Error removing calling:", e);
    }
};

// Global functions for state
window.pendingCallingAssignment = null;

window.openMemberSelector = (autoAssignCalling = null) => {
    window.pendingCallingAssignment = autoAssignCalling;
    
    const list = document.getElementById('selectorMemberList');
    list.innerHTML = '';

    const activeMembers = allMembers.filter(m => !m.isLessActive);
    activeMembers.sort((a, b) => a.nombre.localeCompare(b.nombre)).forEach(m => {
        const item = document.createElement('div');
        item.className = 'selector-item';
        item.onclick = async () => {
            if (window.pendingCallingAssignment) {
                await addDirectCalling(m.id, window.pendingCallingAssignment);
            } else {
                openCallingModal(m.id);
            }
        };
        item.innerHTML = `
            <span>${m.nombre}</span>
            <span class="org">${m.organizacion}</span>
        `;
        list.appendChild(item);
    });

    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('memberSelectorModal').style.display = 'block';
};

async function addDirectCalling(memberId, callingName) {
    const { arrayUnion, doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const memberRef = doc(db, "miembros", memberId);
    
    try {
        await updateDoc(memberRef, {
            llamamientos: arrayUnion(callingName)
        });

        // Update local
        const m = allMembers.find(member => member.id === memberId);
        if (m) {
            if (!m.llamamientos) m.llamamientos = [];
            if (!m.llamamientos.includes(callingName)) m.llamamientos.push(callingName);
        }

        window.pendingCallingAssignment = null;
        closeModal();
        renderOrganigrama();
    } catch (e) {
        console.error("Error direct assign:", e);
    }
}

function updateStat(id, val) {
    const el = document.getElementById(id);
    if (el) {
        el.querySelector('.stat-value').textContent = val;
    }
}

function createMemberCard(member) {
    const div = document.createElement('div');
    div.className = 'member-card';
    div.onclick = () => openCallingModal(member.id);

    let callingsHtml = '';
    if (member.llamamientos && member.llamamientos.length > 0) {
        callingsHtml = `<div class="calling-tags">
            ${member.llamamientos.map(c => `<span class="calling-tag">${c}</span>`).join('')}
        </div>`;
    }

    div.innerHTML = `
        <div class="member-info">
            <span class="member-name">${member.nombre}</span>
            <span class="member-org">${member.organizacion}</span>
        </div>
        ${callingsHtml}
    `;
    return div;
}

// --- Modal Functions ---
window.openCallingModal = (memberId) => {
    const member = allMembers.find(m => m.id === memberId);
    if (!member) return;

    currentEditingMemberId = memberId;
    document.getElementById('modalMemberName').textContent = member.nombre;

    const list = document.getElementById('callingList');
    list.innerHTML = '';

    if (member.llamamientos && member.llamamientos.length > 0) {
        member.llamamientos.forEach(c => {
            const item = document.createElement('div');
            item.className = 'calling-item';
            item.innerHTML = `
                <span>${c}</span>
                <button class="btn-del" onclick="removeCalling('${c}')">×</button>
            `;
            list.appendChild(item);
        });
    } else {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.875rem; text-align:center;">Sin llamamientos asignados.</p>';
    }

    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('callingModal').style.display = 'block';
    document.getElementById('memberSelectorModal').style.display = 'none';
};

window.closeModal = () => {
    document.getElementById('modalOverlay').style.display = 'none';
    document.getElementById('callingModal').style.display = 'none';
    document.getElementById('memberSelectorModal').style.display = 'none';
    currentEditingMemberId = null;
};

window.addCalling = async () => {
    const input = document.getElementById('newCallingInput');
    const value = input.value.trim();

    if (!value || !currentEditingMemberId) return;

    const memberRef = doc(db, "miembros", currentEditingMemberId);
    
    try {
        await updateDoc(memberRef, {
            llamamientos: arrayUnion(value)
        });

        // Update local data
        const m = allMembers.find(member => member.id === currentEditingMemberId);
        if (m) {
            if (!m.llamamientos) m.llamamientos = [];
            m.llamamientos.push(value);
        }

        input.value = '';
        openCallingModal(currentEditingMemberId); // Refresh modal
        renderOrganigrama(); // Refresh main view
    } catch (e) {
        console.error("Error al añadir llamamiento:", e);
        alert("Error al guardar el llamamiento");
    }
};

window.removeCalling = async (value) => {
    if (!currentEditingMemberId) return;
    if (!confirm(`¿Eliminar llamamiento "${value}"?`)) return;

    const memberRef = doc(db, "miembros", currentEditingMemberId);

    try {
        await updateDoc(memberRef, {
            llamamientos: arrayRemove(value)
        });

        // Update local data
        const m = allMembers.find(member => member.id === currentEditingMemberId);
        if (m) {
            m.llamamientos = m.llamamientos.filter(c => c !== value);
        }

        openCallingModal(currentEditingMemberId);
        renderOrganigrama();
    } catch (e) {
        console.error("Error al eliminar llamamiento:", e);
    }
};

window.openMemberSelector = () => {
    const list = document.getElementById('selectorMemberList');
    list.innerHTML = '';

    const activeMembers = allMembers.filter(m => !m.isLessActive);
    activeMembers.sort((a, b) => a.nombre.localeCompare(b.nombre)).forEach(m => {
        const item = document.createElement('div');
        item.className = 'selector-item';
        item.onclick = () => openCallingModal(m.id);
        item.innerHTML = `
            <span>${m.nombre}</span>
            <span class="org">${m.organizacion}</span>
        `;
        list.appendChild(item);
    });

    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('memberSelectorModal').style.display = 'block';
    document.getElementById('callingModal').style.display = 'none';
};

window.filterMemberList = (query = '') => {
    const items = document.querySelectorAll('.selector-item');
    const q = query.toLowerCase();

    items.forEach(item => {
        const name = item.querySelector('span').textContent.toLowerCase();
        if (name.includes(q)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
};
