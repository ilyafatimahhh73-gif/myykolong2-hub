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
//   residents.html    -> protectPage(["Setiausaha"])
//   inventory.html    -> protectPage(["Setiausaha", "Bendahari"])
//   analytics.html    -> protectPage(["Ketua Kampung", "Setiausaha"])
//   approval.html     -> protectPage(["Ketua Kampung"])
//   resident-portal.html -> protectPage(["Resident"])
// ---------------------------------------------------------------------------

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

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
