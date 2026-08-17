import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let allMembers = [];
let currentFilter = 'all';
let hideLessActive = false;

function removeAccents(str) {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('memberSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderTable(e.target.value);
        });
    }

    // Esperar a que el rol esté definido
    const checkAuth = setInterval(() => {
        if (window.currentUserRole) {
            clearInterval(checkAuth);
            loadData();

            const isAdmin = window.currentUserRole.nivel === 'admin';
            if (!isAdmin) {
                document.querySelectorAll('button[onclick*="openImportModal"], button[onclick*="deduplicateMembers"]')
                    .forEach(btn => btn.style.display = 'none');
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
        renderTable();
    } catch (e) {
        console.error("Error cargando datos:", e);
    }
}

function renderTable(search = '') {
    const tbody = document.getElementById('membersBody');
    tbody.innerHTML = '';

    let filtered = [...allMembers];

    if (hideLessActive) {
        filtered = filtered.filter(m => !m.isLessActive);
    }

    if (currentFilter !== 'all') {
        filtered = filtered.filter(m => m.organizacion === currentFilter);
    }

    const searchRaw = search || document.getElementById('memberSearch')?.value || '';
    const searchTerms = removeAccents(searchRaw).split(' ').filter(t => t.length > 0);

    if (searchTerms.length > 0) {
        filtered = filtered.filter(m => {
            const nombreClean = removeAccents(m.nombre);
            return searchTerms.every(term => nombreClean.includes(term));
        });
    }

    const sortBy = document.getElementById('sortMembers')?.value || 'nombre';
    filtered.sort((a, b) => {
        if (sortBy === 'nombre') {
            return a.nombre.localeCompare(b.nombre);
        } else if (sortBy === 'edad') {
            return (a.edad || 0) - (b.edad || 0);
        }
        return 0;
    });

    const counter = document.getElementById('memberCount');
    if (counter) counter.textContent = filtered.length;

    const isAdmin = window.currentUserRole?.nivel === 'admin';

    filtered.forEach(m => {
        const tr = document.createElement('tr');
        if (m.isLessActive) tr.style.opacity = '0.5';

        tr.innerHTML = `
            <td data-label="Miembro">
                <div style="font-weight:600">${m.nombre}</div>
                <div style="font-size:0.65rem; color:var(--text-muted)">🎂 ${m.fechaNacimiento || 'Sin fecha'}</div>
            </td>
            <td data-label="Org."><span class="tag ${getOrgClass(m.organizacion)}">${m.organizacion || '—'}</span></td>
            <td data-label="Edad">${m.edad || '--'}</td>
            <td data-label="Estado"><span class="tag" style="background:${m.isLessActive ? '#fee2e2' : '#dcfce7'}; color:${m.isLessActive ? '#991b1b' : '#166534'};">${m.isLessActive ? 'Menos activo' : 'Activo'}</span></td>
            ${isAdmin ? `
            <td data-label="Acción">
                <div class="checkbox-wrapper">
                    <input type="checkbox" ${m.isLessActive ? 'checked' : ''} onchange="window.toggleStatus('${m.id}', 'isLessActive', this.checked)">
                    Menos Activo
                </div>
                <div class="checkbox-wrapper">
                    <input type="checkbox" ${m.skip ? 'checked' : ''} onchange="window.toggleStatus('${m.id}', 'skip', this.checked)">
                    Skip/Salud
                </div>
            </td>` : ''}
        `;
        tbody.appendChild(tr);
    });
}

window.renderTable = renderTable;

window.filterByOrg = (org) => {
    currentFilter = org;
    renderTable();
    const buttons = document.querySelectorAll('#orgFilters .btn');
    buttons.forEach(b => b.classList.remove('btn-primary'));
    if (event && event.target && event.target.tagName === 'BUTTON') {
        event.target.classList.add('btn-primary');
    }
};

window.toggleHideLessActive = (value) => {
    hideLessActive = value;
    renderTable();
};

window.toggleStatus = async (id, field, value) => {
    const memberRef = doc(db, "miembros", id);
    await updateDoc(memberRef, { [field]: value });
    const m = allMembers.find(member => member.id === id);
    if (m) m[field] = value;
    renderTable();
};

window.openImportModal = () => {
    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('importModal').style.display = 'block';
};

window.closeModal = () => {
    document.getElementById('modalOverlay').style.display = 'none';
    document.getElementById('importModal').style.display = 'none';
};

window.processImport = async () => {
    const text = document.getElementById('csvData').value;
    const lines = text.split('\n');
    let added = 0;
    let skipped = 0;

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

    // Claves de los miembros ya existentes para no duplicar ni pisar datos
    const existingKeys = new Set();
    allMembers.forEach(m => {
        existingKeys.add(`${removeAccents(m.nombre)}|${removeAccents(m.fechaNacimiento || '')}`);
    });

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
                const key = `${removeAccents(nombre)}|${removeAccents(fechaNac)}`;
                if (existingKeys.has(key)) {
                    skipped++;
                    continue;
                }
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
                existingKeys.add(key);
                added++;
            }
        }
    }

    btn.disabled = false;
    btn.textContent = originalText;
    alert(`Se importaron ${added} nuevos miembros. ${skipped} ya existían y se omitieron.`);
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