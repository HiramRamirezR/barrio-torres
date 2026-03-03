import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { getRoleByEmail } from "./roles.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const loginBtn = document.getElementById('btnGoogleLogin');

if (loginBtn) {
    loginBtn.addEventListener('click', () => {
        signInWithPopup(auth, provider)
            .then((result) => {
                window.location.href = 'index.html';
            }).catch((error) => {
                console.error("Error en login:", error);
                alert("Error al iniciar sesión: " + error.message);
            });
    });
}

// Global Auth State
onAuthStateChanged(auth, (user) => {
    const userProfile = document.getElementById('userProfile');
    const loginPrompt = document.getElementById('loginPrompt');
    const userName = document.getElementById('userName');
    const userImg = document.getElementById('userImg');

    if (user) {
        const userRoleInfo = getRoleByEmail(user.email);

        // Si no está en la lista de autorizados, cerrar sesión o avisar
        if (userRoleInfo.nivel === 'guest') {
            alert("Acceso no autorizado. Contacte al administrador.");
            signOut(auth);
            return;
        }

        if (userProfile) userProfile.style.display = 'flex';
        if (loginPrompt) loginPrompt.style.display = 'none';

        // Mostrar nombre + rol
        if (userName) userName.innerHTML = `${user.displayName} <br><small style="font-weight:400; color:var(--text-muted)">${userRoleInfo.rol}</small>`;
        if (userImg) userImg.src = user.photoURL;

        // Guardar info globalmente para otros scripts
        window.currentUserRole = userRoleInfo;

    } else {
        if (userProfile) userProfile.style.display = 'none';
        if (loginPrompt) loginPrompt.style.display = 'block';

        const path = window.location.pathname;
        if (path.includes('discursos.html') || path.includes('tareas.html') || (path.includes('index.html') && path !== '/')) {
            window.location.href = 'login.html';
        }
    }
});

window.handleLogout = () => {
    signOut(auth).then(() => {
        window.location.href = 'login.html';
    });
};

export { auth };
