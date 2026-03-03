export const USUARIOS_AUTORIZADOS = {
    "hiram.j.ramirez@gmail.com": { nombre: "Hiram Ramirez", rol: "Obispo", nivel: "admin", color: "#4f46e5" },
    "consejero1.mock@gmail.com": { nombre: "Primer Consejero", rol: "1er Consejero", nivel: "user", color: "#0891b2" },
    "consejero2.mock@gmail.com": { nombre: "Segundo Consejero", rol: "2do Consejero", nivel: "user", color: "#059669" },
    "secretario.mock@gmail.com": { nombre: "Secretario de Barrio", rol: "Secretario", nivel: "user", color: "#d97706" },
    "ginyita@gmail.com": { nombre: "Secretario Auxiliar", rol: "Secretario Auxiliar", nivel: "user", color: "#7c3aed" }
};

export function getRoleByEmail(email) {
    return USUARIOS_AUTORIZADOS[email] || { rol: "Invitado", nivel: "guest" };
}
