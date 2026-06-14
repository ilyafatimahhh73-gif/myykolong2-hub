// login.js — MyKolong2 Hub
// Authenticates a user via Firebase Auth, looks up their role in the
// "users" Firestore collection (doc ID == Auth UID, as created by the
// signup flow in index.html), and redirects to the dashboard for that role.
//
// ---- HTML usage (signin.html) -------------------------------------------
//   <script type="module">
//     import { loginAndRoute } from "./js/login.js";
//
//     document.getElementById("loginForm").addEventListener("submit", async (e) => {
//       e.preventDefault();
//       const email = document.getElementById("email").value;
//       const password = document.getElementById("password").value;
//       try {
//         await loginAndRoute(email, password);
//       } catch (err) {
//         // Show err.message in your form's error UI
//         console.error(err);
//       }
//     });
//   </script>
// ---------------------------------------------------------------------------

import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

// Roles that share the staff dashboard
const ADMIN_ROLES = ["Ketua Kampung", "Setiausaha", "Bendahari"];

/**
 * Sign in with email/password, fetch the user's role from
 * users/{uid}.role, and redirect to the matching dashboard.
 *
 * @param {string} email
 * @param {string} password
 * @throws if auth fails, the profile is missing, or the role is unrecognized
 */
export async function loginAndRoute(email, password) {
    // 1. Authenticate with Firebase Auth
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;

    // 2. Fetch this user's role from Firestore.
    //    Doc ID in "users" equals their Auth UID (set via
    //    setDoc(doc(db, "users", user.uid), {...}) on signup).
    const userSnap = await getDoc(doc(db, "users", uid));
    if (!userSnap.exists()) {
        throw new Error("No user profile found. Please contact the administrator.");
    }

    const role = userSnap.data().role;

    // 3. Redirect based on role
    if (ADMIN_ROLES.includes(role)) {
        window.location.href = "dashboard.html";
    } else if (role === "Resident") {
        window.location.href = "resident-portal.html";
    } else {
        throw new Error(`Unrecognized role "${role}". Please contact the administrator.`);
    }
}
