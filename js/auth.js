import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

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
        if (userProfile) userProfile.style.display = 'flex';
        if (loginPrompt) loginPrompt.style.display = 'none';
        if (userName) userName.textContent = user.displayName;
        if (userImg) userImg.src = user.photoURL;
    } else {
        if (userProfile) userProfile.style.display = 'none';
        if (loginPrompt) loginPrompt.style.display = 'block';

        // Redirect if on protected page
        const path = window.location.pathname;
        if (path.includes('discursos.html')) {
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
