// authGuard.js — MyKolong2 Hub
// Reusable route guard for protected pages. Confirms the visitor is signed
// in AND holds one of the roles permitted for this page; otherwise sends
// them back to signin.html.
//
// ---- HTML usage -----------------------------------------------------------
// Paste this near the top of the page's <script type="module"> block,
// before any code that reads/writes Firestore:
//
//   <script type="module">
//     import { protectPage } from "./js/authGuard.js";
//     const { user, role } = await protectPage(["Ketua Kampung"]);
//     // ...rest of the page's logic — `user` and `role` are available here
//   </script>
//
// Per-page allowed roles for this app:
//   dashboard.html       -> protectPage(ADMIN_ROLES)  [Ketua Kampung, Setiausaha, Bendahari]
//   residents.html       -> protectPage(["Setiausaha"])
//   welfare.html          -> protectPage(["Ketua Kampung", "Setiausaha"])
//   inventory.html       -> protectPage(["Setiausaha", "Bendahari"])
//   analytics.html       -> protectPage(["Ketua Kampung", "Setiausaha"])
//   admin.html            -> protectPage(ADMIN_ROLES)
//   approval.html        -> protectPage(["Ketua Kampung"])
//   register_staff.html  -> protectPage(["Ketua Kampung"])
//   transparency.html     -> requireAuth() — open to all roles incl. Resident
//   resident-portal.html -> protectPage(["Resident"])
//   profile.html          -> protectPage(["Resident"])
//   notifications.html    -> protectPage(["Resident"])
//
// ---- Nav filtering ---------------------------------------------------------
// Every page above shares the same navbar markup (same links, same order,
// only the "active" class differs). The role lookup is async, so two calls
// are used together to avoid any visible flash of the wrong nav links:
//
//   applyCachedNavVisibility();           // run FIRST, synchronously, using
//                                          // the role cached from the last
//                                          // protectPage() call (if any)
//   const { user, role } = await protectPage([...]);
//   applyNavVisibility(role);             // re-apply with the verified role
// ---------------------------------------------------------------------------

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

// Pages each role is allowed to see in the main navbar (.nav-center).
// Pages not listed here for a role are removed from the nav on that page.
const ROLE_NAV_PAGES = {
    "Ketua Kampung": ["dashboard.html", "welfare.html", "analytics.html", "approval.html", "admin.html", "transparency.html"],
    "Setiausaha": ["dashboard.html", "residents.html", "welfare.html", "inventory.html", "analytics.html", "admin.html", "transparency.html"],
    "Bendahari": ["dashboard.html", "inventory.html", "admin.html", "transparency.html"],
    "Resident": ["resident-portal.html", "profile.html", "notifications.html", "transparency.html"]
};

// Last verified role, cached so the nav can be filtered instantly on the
// next page load without waiting for the Firestore round trip.
const NAV_ROLE_KEY = "mk2hub_navRole";

/**
 * Verify the visitor is signed in and authorized for this page.
 * Redirects to signin.html and never resolves if either check fails.
 *
 * @param {string[]} allowedRoles - roles permitted to view this page
 * @returns {Promise<{user: object, role: string}>}
 */
export function protectPage(allowedRoles) {
    return new Promise((resolve) => {
        onAuthStateChanged(auth, async (user) => {
            // Not signed in at all
            if (!user) {
                window.location.href = "signin.html";
                return;
            }

            // Look up this user's role
            const userSnap = await getDoc(doc(db, "users", user.uid));
            const role = userSnap.exists() ? userSnap.data().role : null;

            // Signed in, but missing profile or wrong role for this page
            if (!role || !allowedRoles.includes(role)) {
                window.location.href = "signin.html";
                return;
            }

            cacheNavRole(role);
            resolve({ user, role });
        });
    });
}

/**
 * Hide/remove top-nav links the given role isn't allowed to visit.
 *
 * @param {string} role - the signed-in user's role
 */
export function applyNavVisibility(role) {
    const allowedPages = ROLE_NAV_PAGES[role] || [];

    document.querySelectorAll(".nav-center .nav-link").forEach((link) => {
        const href = link.getAttribute("href");
        if (!allowedPages.includes(href)) {
            link.remove();
        }
    });
}

/**
 * Apply nav filtering immediately using the role cached from the last
 * protectPage() call, so the navbar renders correctly on first paint
 * (no blank/fade while the role is re-verified). Call this BEFORE
 * protectPage() resolves; protectPage() + applyNavVisibility(role) still
 * run afterwards to confirm/correct it with the verified role.
 */
export function applyCachedNavVisibility() {
    const cachedRole = sessionStorage.getItem(NAV_ROLE_KEY);
    if (cachedRole) applyNavVisibility(cachedRole);
}

/** Cache the verified role so the next page load can filter the nav instantly. */
export function cacheNavRole(role) {
    if (role) sessionStorage.setItem(NAV_ROLE_KEY, role);
}

/** Clear the cached role, e.g. on logout. */
export function clearCachedRole() {
    sessionStorage.removeItem(NAV_ROLE_KEY);
}
