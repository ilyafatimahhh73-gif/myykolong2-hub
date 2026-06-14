// Auth Utilities for MyKolong2 Hub
// Shared across all protected pages

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { ADMIN_ROLES } from "./login.js";
import { clearCachedRole } from "./authGuard.js";

/**
 * Redirect to signin.html if user is NOT logged in.
 * Call this on every protected page (dashboard, residents, etc.)
 */
export function requireAuth() {
    return new Promise((resolve) => {
        onAuthStateChanged(auth, (user) => {
            if (!user) {
                window.location.href = "signin.html";
            } else {
                resolve(user);
            }
        });
    });
}

/**
 * Redirect to the role-appropriate dashboard if user IS already logged in.
 * Call this on auth pages (signin, signup) so logged-in users skip them.
 */
export function redirectIfLoggedIn() {
    // Only react to the auth state that's already active when the page loads.
    // Without unsubscribing, this listener would also fire (and hijack
    // navigation) when createUserWithEmailAndPassword signs the user in
    // during signup, racing the signup handler's setDoc() call.
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
        unsubscribe();

        if (!user) return;

        const userSnap = await getDoc(doc(db, "users", user.uid));
        const role = userSnap.exists() ? userSnap.data().role : null;

        if (ADMIN_ROLES.includes(role)) {
            window.location.href = "dashboard.html";
        } else if (role === "Resident") {
            window.location.href = "resident-portal.html";
        }
        // Unknown/missing role: stay put so the user isn't bounced into a loop
    });
}

/**
 * Sign out the current user and redirect to signin.html
 */
export async function logoutUser() {
    try {
        await signOut(auth);
        clearCachedRole();
        window.location.href = "signin.html";
    } catch (error) {
        console.error("Logout error:", error);
    }
}

/**
 * Setup the logout button on any page.
 * Finds the .logout-btn element and attaches the signOut handler.
 */
export function setupLogoutButton() {
    const logoutBtn = document.querySelector('.logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logoutUser();
        });
    }
}

/**
 * Update the navbar username display with the logged-in user's info.
 */
export function updateUserDisplay(user) {
    const userNameEl = document.querySelector('.user-name');
    if (userNameEl && user) {
        userNameEl.textContent = user.displayName || user.email;
    }
}
