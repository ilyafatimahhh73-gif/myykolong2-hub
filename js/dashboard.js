import { collection, doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { requireAuth, setupLogoutButton, updateUserDisplay } from "./auth.js";
import { applyNavVisibility } from "./authGuard.js";

function classifyIncome(income) {
    if (income <= 4850) return 'B40';
    if (income <= 10970) return 'M40';
    return 'T20';
}

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

    const user = await requireAuth();
    updateUserDisplay(user);
    setupLogoutButton();

    // Hide nav tabs the user's role isn't allowed to open
    const userSnap = await getDoc(doc(db, "users", user.uid));
    const role = userSnap.exists() ? userSnap.data().role : null;
    applyNavVisibility(role);

    // DOM Elements
    const kpiTotal = document.getElementById('kpi-total');
    const kpiTotalSub = document.getElementById('kpi-total-sub');
    const kpiB40 = document.getElementById('kpi-b40');
    const kpiB40Sub = document.getElementById('kpi-b40-sub');
    const kpiM40 = document.getElementById('kpi-m40');
    const kpiM40Sub = document.getElementById('kpi-m40-sub');
    const kpiT20 = document.getElementById('kpi-t20');
    const kpiT20Sub = document.getElementById('kpi-t20-sub');

    // Real-time listener for residents
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
            const category = classifyIncome(income);
            if (category === 'B40') b40++;
            else if (category === 'M40') m40++;
            else t20++;
        });

        // Update DOM
        if (kpiTotal) {
            kpiTotal.textContent = total;
            kpiTotalSub.textContent = `Live database count`;
            
            if (total > 0) {
                kpiB40.textContent = b40;
                kpiB40Sub.textContent = `${((b40 / total) * 100).toFixed(1)}% of total`;
                
                kpiM40.textContent = m40;
                kpiM40Sub.textContent = `${((m40 / total) * 100).toFixed(1)}% of total`;
                
                kpiT20.textContent = t20;
                kpiT20Sub.textContent = `${((t20 / total) * 100).toFixed(1)}% of total`;
            } else {
                kpiB40.textContent = 0;
                kpiM40.textContent = 0;
                kpiT20.textContent = 0;
                kpiB40Sub.textContent = '0.0% of total';
                kpiM40Sub.textContent = '0.0% of total';
                kpiT20Sub.textContent = '0.0% of total';
            }
        }
        
        // Also update system health progress bar
        const progressFill = document.querySelector('.progress-bar-fill');
        const progressText = document.querySelector('.progress-header span:last-child');
        if (progressFill && progressText) {
            // Placeholder: Assume 100% complete for now if data exists, or calculate completeness based on missing fields
            let completeRecords = 0;
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.name && data.ic && data.income !== undefined) completeRecords++;
            });
            const ratio = total > 0 ? (completeRecords / total) * 100 : 0;
            progressFill.style.width = `${ratio}%`;
            progressText.textContent = `${ratio.toFixed(0)}%`;
        }

    }, (error) => {
        console.error("Dashboard DB Error:", error);
    });
});
