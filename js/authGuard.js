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
//   residents.html       -> protectPage(["Setiausaha"])
//   inventory.html       -> protectPage(["Setiausaha", "Bendahari"])
//   analytics.html       -> protectPage(["Ketua Kampung", "Setiausaha"])
//   approval.html        -> protectPage(["Ketua Kampung"])
//   register_staff.html  -> protectPage(["Ketua Kampung"])
//   resident-portal.html -> protectPage(["Resident"])
//
// ---- Nav filtering ---------------------------------------------------------
// On pages with the shared staff navbar (dashboard/residents/welfare/
// inventory/analytics/admin/transparency), call applyNavVisibility(role)
// after resolving the role to hide nav-center links the role can't open:
//
//   applyNavVisibility(role);
// ---------------------------------------------------------------------------

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

// Pages each role is allowed to see in the main navbar (.nav-center).
// Pages not listed here for a role are removed from the nav on that page.
const ROLE_NAV_PAGES = {
    "Ketua Kampung": ["dashboard.html", "welfare.html", "analytics.html", "admin.html", "transparency.html"],
    "Setiausaha": ["dashboard.html", "residents.html", "welfare.html", "inventory.html", "analytics.html", "admin.html", "transparency.html"],
    "Bendahari": ["dashboard.html", "inventory.html", "admin.html", "transparency.html"],
    "Resident": []
};

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

            resolve({ user, role });
        });
    });
}

/**
 * Hide/remove top-nav links the given role isn't allowed to visit.
 * Call after protectPage()/getDoc() has resolved the user's role.
 *
 * @param {string} role - the signed-in user's role
 */
export function applyNavVisibility(role) {
    const allowedPages = ROLE_NAV_PAGES[role] || [];
    const currentPage = window.location.pathname.split("/").pop() || "dashboard.html";

    document.querySelectorAll(".nav-center .nav-link").forEach((link) => {
        let href = link.getAttribute("href");
        if (href === "#") href = currentPage; // active link on its own page
        if (!allowedPages.includes(href)) {
            link.remove();
        }
    });
}
