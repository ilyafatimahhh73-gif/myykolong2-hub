import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { setupLogoutButton, updateUserDisplay } from "./auth.js";
import { protectPage, applyNavVisibility, applyCachedNavVisibility } from "./authGuard.js";
import { ADMIN_ROLES } from "./login.js";

// Apply the last-known role's nav filter immediately, before protectPage()
// resolves, so the navbar is already correct on first paint.
applyCachedNavVisibility();

function getHouseholdIncome(resident) {
    let total = parseFloat(resident.income) || 0;
    if (resident.familyMembers && resident.familyMembers.length > 0) {
        resident.familyMembers.forEach(m => {
            total += parseFloat(m.income) || 0;
        });
    }
    return total;
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
        console.warn("Lucide icons failed to load:", e);
    }

    // Staff only - Residents are redirected to signin.html
    const { user, role } = await protectPage(ADMIN_ROLES);
    updateUserDisplay(user);
    setupLogoutButton();

    // Only Ketua Kampung can see the "Staff Accounts" panel
    if (role !== "Ketua Kampung") {
        const staffPanel = document.getElementById('staff-accounts-panel');
        if (staffPanel) staffPanel.remove();
    }

    // Hide nav tabs the user's role isn't allowed to open
    applyNavVisibility(role);

    // Tab Switching Logic
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-tab');
            
            // Update buttons
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update contents
            tabContents.forEach(c => c.classList.remove('active'));
            document.getElementById(targetId).classList.add('active');
        });
    });

    // Real-time listener for Admin
    const residentsRef = collection(db, "residents");
    onSnapshot(residentsRef, (snapshot) => {
        let total = 0;
        let b40 = 0;
        let m40 = 0;
        let t20 = 0;

        snapshot.forEach(doc => {
            total++;
            const data = doc.data();
            const income = getHouseholdIncome(data);
            
            if (income <= 4850) b40++;
            else if (income <= 10970) m40++;
            else t20++;
        });

        const adminTotalRecords = document.getElementById('admin-total-records');
        const adminB40 = document.getElementById('admin-b40');
        const adminM40 = document.getElementById('admin-m40');
        const adminT20 = document.getElementById('admin-t20');

        if (adminTotalRecords) adminTotalRecords.textContent = total;
        if (adminB40) adminB40.textContent = b40;
        if (adminM40) adminM40.textContent = m40;
        if (adminT20) adminT20.textContent = t20;

    }, (error) => {
        console.error("Admin DB Error:", error);
    });
});
