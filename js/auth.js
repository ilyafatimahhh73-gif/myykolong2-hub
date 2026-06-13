// Auth Utilities for MyKolong2 Hub
// Shared across all protected pages

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { auth } from "./firebase-config.js";

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
 * Redirect to dashboard.html if user IS already logged in.
 * Call this on auth pages (signin, signup) so logged-in users skip them.
 */
export function redirectIfLoggedIn() {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            window.location.href = "dashboard.html";
        }
    });
}

/**
 * Sign out the current user and redirect to signin.html
 */
export async function logoutUser() {
    try {
        await signOut(auth);
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
