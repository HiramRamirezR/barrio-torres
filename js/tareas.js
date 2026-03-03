import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, doc, updateDoc, deleteDoc, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { USUARIOS_AUTORIZADOS } from "./roles.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let allTasks = [];
window.currentEditingTaskId = null;

document.addEventListener('DOMContentLoaded', () => {
    // Esperar a que auth.js defina el rol
    const checkAuth = setInterval(() => {
        if (window.currentUserRole) {
            clearInterval(checkAuth);
            init();
        }
    }, 100);
});

function init() {
    setupUI();
    loadTasks();
}

function setupUI() {
    const roleInfo = window.currentUserRole;
    const adminPanel = document.getElementById('adminPanel');
    const subtitle = document.getElementById('viewSubtitle');

    if (roleInfo.nivel === 'admin') {
        adminPanel.style.display = 'block';
        subtitle.textContent = "Como Obispo, puedes asignar tareas a los miembros del obispado.";

        // Llenar select de responsables (incluyendo al propio Obispo)
        const select = document.getElementById('taskAssignee');
        const editSelect = document.getElementById('editTaskAssignee');

        Object.entries(USUARIOS_AUTORIZADOS).forEach(([email, info]) => {
            const opt = document.createElement('option');
            opt.value = info.rol; // Usamos el rol como identificador para la tarea
            opt.textContent = `${info.nombre} (${info.rol})`;

            // Pre-seleccionar al obispo para que sea más fácil asignarse tareas
            if (info.nivel === 'admin') opt.selected = true;

            select.appendChild(opt);
            if (editSelect) editSelect.appendChild(opt.cloneNode(true));
        });
    } else {
        subtitle.textContent = `Lista de tareas asignadas para: ${roleInfo.rol}`;
    }
}

function loadTasks() {
    const roleInfo = window.currentUserRole;
    const tasksRef = collection(db, "tareas");

    // Ahora TODOS ven todas las tareas ordenadas por fecha
    const q = query(tasksRef, orderBy("createdAt", "desc"));

    // Escuchar cambios en tiempo real
    onSnapshot(q, (snapshot) => {
        allTasks = [];
        snapshot.forEach((doc) => {
            allTasks.push({ id: doc.id, ...doc.data() });
        });
        renderTasks();
    });
}

function renderTasks() {
    const list = document.getElementById('tasksList');
    const pendingCountEl = document.getElementById('countPending');
    const completedCountEl = document.getElementById('countCompleted');

    list.innerHTML = '';
    let pending = 0;
    let completed = 0;

    if (allTasks.length === 0) {
        list.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 3rem;">No hay tareas asignadas.</div>';
        pendingCountEl.textContent = 0;
        completedCountEl.textContent = 0;
        return;
    }

    allTasks.forEach(task => {
        if (task.status === 'pending') pending++;
        else completed++;

        const card = document.createElement('div');
        card.className = `task-card ${task.status}`;

        // Buscar el color del responsable
        const assigneeInfo = Object.values(USUARIOS_AUTORIZADOS).find(u => u.rol === task.assignedTo);
        const taskColor = assigneeInfo ? assigneeInfo.color : '#ddd';

        if (task.status === 'pending') {
            card.style.borderLeftColor = taskColor;
        }

        const isAdmin = window.currentUserRole.nivel === 'admin';
        const isAssignedToMe = window.currentUserRole.rol === task.assignedTo;
        const showCompleteBtn = task.status === 'pending' && (isAssignedToMe || isAdmin);

        card.innerHTML = `
            <div class="task-header">
                <span class="task-title">${task.title}</span>
                ${showCompleteBtn ? `<button class="btn-complete" onclick="window.completeTask('${task.id}')">✓ Listo</button>` : ''}
                ${task.status === 'completed' ? '<span style="color:#22c55e; font-weight:700; font-size:0.8rem;">✓ COMPLETADA</span>' : ''}
            </div>
            ${task.description ? `<p class="task-desc">${task.description}</p>` : ''}
            <div class="task-meta">
                <span>👤 ${task.assignedTo}</span>
                <span>•</span>
                <span>📅 ${new Date(task.createdAt).toLocaleDateString()}</span>
            </div>
            ${isAdmin ? `
            <div class="task-actions">
                <button class="btn-action btn-edit" onclick="window.openEditModal('${task.id}')">
                    <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/></svg>
                    Editar
                </button>
                <button class="btn-action btn-delete" onclick="window.deleteTask('${task.id}')">
                    <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>
                    Eliminar
                </button>
            </div>
            ` : ''}
        `;
        list.appendChild(card);
    });

    pendingCountEl.textContent = pending;
    completedCountEl.textContent = completed;
}

window.createTask = async () => {
    const title = document.getElementById('taskTitle').value;
    const desc = document.getElementById('taskDesc').value;
    const assignee = document.getElementById('taskAssignee').value;

    if (!title) {
        alert("El título es obligatorio");
        return;
    }

    try {
        await addDoc(collection(db, "tareas"), {
            title,
            description: desc,
            assignedTo: assignee,
            status: 'pending',
            createdAt: new Date().toISOString(),
            createdBy: window.currentUserRole.rol
        });

        // Limpiar form
        document.getElementById('taskTitle').value = '';
        document.getElementById('taskDesc').value = '';
        alert("Tarea asignada correctamente");
    } catch (e) {
        console.error("Error al crear tarea:", e);
        alert("Error al guardar la tarea");
    }
};

window.completeTask = async (taskId) => {
    if (!confirm("¿Marcar esta tarea como completada?")) return;

    try {
        const taskRef = doc(db, "tareas", taskId);
        await updateDoc(taskRef, {
            status: 'completed',
            completedAt: new Date().toISOString()
        });
    } catch (e) {
        console.error("Error al completar tarea:", e);
    }
};

window.openEditModal = (taskId) => {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    window.currentEditingTaskId = taskId;
    document.getElementById('editTaskTitle').value = task.title;
    document.getElementById('editTaskDesc').value = task.description || '';
    document.getElementById('editTaskAssignee').value = task.assignedTo;

    document.getElementById('editModalOverlay').style.display = 'flex';
};

window.closeEditModal = () => {
    document.getElementById('editModalOverlay').style.display = 'none';
    window.currentEditingTaskId = null;
};

window.updateTask = async () => {
    if (!window.currentEditingTaskId) return;

    const title = document.getElementById('editTaskTitle').value;
    const desc = document.getElementById('editTaskDesc').value;
    const assignee = document.getElementById('editTaskAssignee').value;

    if (!title) {
        alert("El título es obligatorio");
        return;
    }

    try {
        const taskRef = doc(db, "tareas", window.currentEditingTaskId);
        await updateDoc(taskRef, {
            title,
            description: desc,
            assignedTo: assignee
        });
        window.closeEditModal();
        alert("Tarea actualizada correctamente");
    } catch (e) {
        console.error("Error al actualizar tarea:", e);
        alert("Error al actualizar la tarea");
    }
};

window.deleteTask = async (taskId) => {
    if (!confirm("¿Está seguro de que desea eliminar esta tarea? Esta acción no se puede deshacer.")) return;

    try {
        const taskRef = doc(db, "tareas", taskId);
        await deleteDoc(taskRef);
    } catch (e) {
        console.error("Error al eliminar tarea:", e);
        alert("Error al eliminar la tarea");
    }
};
