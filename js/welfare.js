import { collection, doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { requireAuth, setupLogoutButton, updateUserDisplay } from "./auth.js";
import { applyNavVisibility } from "./authGuard.js";
import { createPaginator } from "./pagination.js";

function getHouseholdIncome(resident) {
    let total = parseFloat(resident.income) || 0;
    if (resident.familyMembers && resident.familyMembers.length > 0) {
        resident.familyMembers.forEach(m => {
            total += parseFloat(m.income) || 0;
        });
    }
    return total;
}

/** Evaluate eligibility — inlined from residents.js to avoid loading the full module */
function evaluateEligibility(resident) {
    const householdIncome = getHouseholdIncome(resident);
    const category = householdIncome <= 4850 ? 'B40' : householdIncome <= 10970 ? 'M40' : 'T20';
    const dependents = resident.dependents || 0;
    const perCapita = dependents > 0 ? householdIncome / (dependents + 1) : householdIncome;

    let hasOku = resident.oku === 'Ya';
    let hasElderly = parseInt(resident.age) >= 60;
    if (resident.familyMembers) {
        resident.familyMembers.forEach(m => {
            if (m.oku === 'Ya') hasOku = true;
            if (parseInt(m.age) >= 60) hasElderly = true;
        });
    }

    if (category === 'B40') {
        if (perCapita <= 500 || dependents >= 5)
            return { status: 'Eligible', priority: 'Very High' };
        else if (hasOku || hasElderly)
            return { status: 'Eligible', priority: 'High' };
        else
            return { status: 'Eligible', priority: 'Medium' };
    } else if (category === 'M40') {
        if ((perCapita <= 800 && dependents >= 3) || hasOku || hasElderly)
            return { status: 'Eligible', priority: 'Low' };
        else
            return { status: 'Not Eligible', priority: 'None' };
    } else {
        return { status: 'Not Eligible', priority: 'None' };
    }
}


function calculatePriorityScore(resident, householdIncome, dependents) {
    let score = 0;
    const perCapita = dependents > 0 ? householdIncome / (dependents + 1) : householdIncome;
    
    // Per Capita Baseline (max 70 points)
    if (perCapita <= 500) score += 70;
    else if (perCapita <= 800) score += 50;
    else if (perCapita <= 1200) score += 30;
    else if (perCapita <= 2500) score += 10;
    
    // Dependents weight (max 15 points)
    score += Math.min(dependents * 3, 15);
    
    // Vulnerabilities (max 15 points)
    let hasOku = resident.oku === 'Ya';
    let hasElderly = resident.age >= 60;
    if (resident.familyMembers) {
        resident.familyMembers.forEach(m => {
            if (m.oku === 'Ya') hasOku = true;
            if (m.age >= 60) hasElderly = true;
        });
    }
    
    if (hasOku) score += 10;
    if (hasElderly) score += 5;
    
    return Math.min(score, 100);
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
    const wB40 = document.getElementById('w-b40');
    const wB40Sub = document.getElementById('w-b40-sub');
    const wM40 = document.getElementById('w-m40');
    const wM40Sub = document.getElementById('w-m40-sub');
    const wT20 = document.getElementById('w-t20');
    const wT20Sub = document.getElementById('w-t20-sub');
    const wHighRisk = document.getElementById('w-high-risk');
    const wEligible = document.getElementById('w-eligible');
    
    const badgeB40Count = document.getElementById('badge-b40-count');
    const badgeM40Count = document.getElementById('badge-m40-count');
    const badgeT20Count = document.getElementById('badge-t20-count');
    
    const tbody = document.getElementById('welfareTableBody');
    const priorityListWrapper = document.getElementById('priorityListWrapper');

    // Local cache of the latest computed dataset (re-filtered/paginated on tab/page changes)
    let residentsData = [];

    // Pagination
    const welfarePaginator = createPaginator({
        controlsEl: document.getElementById('welfarePagination'),
        renderFn: renderWelfareRows,
        itemLabel: 'households'
    });

    function renderWelfareTable(resetPagination = false) {
        const activeTab = document.querySelector('.filter-tab.active');
        const filter = activeTab ? activeTab.getAttribute('data-filter') : 'all';
        const filtered = filter === 'all'
            ? residentsData
            : residentsData.filter(r => r.category === filter);

        welfarePaginator.update(filtered, { resetLimit: resetPagination });
    }

    // Simple Tab Filtering Logic
    const tabs = document.querySelectorAll('.filter-tab');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderWelfareTable(true);
        });
    });

    // Real-time listener
    const residentsRef = collection(db, "residents");
    onSnapshot(residentsRef, (snapshot) => {
        let total = 0;
        let b40 = 0;
        let m40 = 0;
        let t20 = 0;
        let highRiskCount = 0;
        let eligibleCount = 0;

        residentsData = [];

        snapshot.forEach(doc => {
            total++;
            const r = doc.data();
            r.id = doc.id;
            
            const householdIncome = getHouseholdIncome(r);
            r.householdIncome = householdIncome;
            
            const eligibility = evaluateEligibility(r);
            r.eligibility = eligibility;
            
            let cat = 't20';
            if (householdIncome <= 4850) { b40++; cat = 'b40'; }
            else if (householdIncome <= 10970) { m40++; cat = 'm40'; }
            else { t20++; }
            r.category = cat;
            
            r.priorityScore = calculatePriorityScore(r, householdIncome, r.dependents || 0);
            
            if (r.priorityScore >= 80) highRiskCount++;
            if (eligibility.status === 'Eligible') eligibleCount++;
            
            residentsData.push(r);
        });

        // Update KPIs
        if (wB40 && total > 0) {
            wB40.textContent = b40;
            wB40Sub.textContent = `${((b40 / total) * 100).toFixed(1)}% of total`;
            wM40.textContent = m40;
            wM40Sub.textContent = `${((m40 / total) * 100).toFixed(1)}% of total`;
            wT20.textContent = t20;
            wT20Sub.textContent = `${((t20 / total) * 100).toFixed(1)}% of total`;
            wHighRisk.textContent = highRiskCount;
            wEligible.textContent = eligibleCount;
            
            if (badgeB40Count) badgeB40Count.textContent = `${b40} households`;
            if (badgeM40Count) badgeM40Count.textContent = `${m40} households`;
            if (badgeT20Count) badgeT20Count.textContent = `${t20} households`;
        }

        // Sort residents by priority score
        residentsData.sort((a, b) => b.priorityScore - a.priorityScore);

        // Render Table (filtered by active tab + paginated)
        renderWelfareTable();
        
        // Render Priority List (Top 3)
        if (priorityListWrapper) {
            priorityListWrapper.innerHTML = '';
            const topResidents = residentsData.slice(0, 3);
            
            if (topResidents.length === 0) {
                priorityListWrapper.innerHTML = '<div style="text-align: center; color: #94a3b8; padding: 2rem;">No residents available.</div>';
            } else {
                topResidents.forEach((r, index) => {
                    let riskLabel = 'low risk';
                    let riskColorClass = 'badge-t20';
                    if (r.priorityScore >= 80) { riskLabel = 'high risk'; riskColorClass = 'badge-b40'; }
                    else if (r.priorityScore >= 50) { riskLabel = 'medium risk'; riskColorClass = 'badge-m40'; }
                    
                    priorityListWrapper.innerHTML += `
                        <div class="priority-card">
                            <div class="priority-card-left">
                                <div class="rank-circle">${index + 1}</div>
                                <div class="priority-info">
                                    <h4>${r.name || '-'}</h4>
                                    <p>${r.dependents || 0} dependents &bull; RM ${r.householdIncome.toLocaleString()}/month</p>
                                </div>
                            </div>
                            <div class="priority-card-right">
                                <div class="priority-badges">
                                    <span class="badge badge-${r.category}">${r.category.toUpperCase()}</span>
                                    <span class="badge ${riskColorClass}">${riskLabel}</span>
                                </div>
                                <div class="score-display">
                                    <span class="score-label">Priority Score</span>
                                    <span class="score-value">${r.priorityScore}</span>
                                </div>
                            </div>
                        </div>
                    `;
                });
            }
        }

    }, (error) => {
        console.error("Welfare DB Error:", error);
    });

    // Render the welfare table body for a paginated slice of residentsData
    function renderWelfareRows(visible) {
        if (!tbody) return;

        tbody.innerHTML = '';
        if (visible.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #94a3b8; padding: 2rem;">No residents found.</td></tr>';
            return;
        }

        visible.forEach(r => {
            const perCapita = r.dependents > 0 ? r.householdIncome / (r.dependents + 1) : r.householdIncome;
            const catLabel = r.category.toUpperCase();

            let riskLabel = 'low';
            let riskColorClass = 'badge-t20';
            if (r.priorityScore >= 80) { riskLabel = 'high'; riskColorClass = 'badge-b40'; }
            else if (r.priorityScore >= 50) { riskLabel = 'medium'; riskColorClass = 'badge-m40'; }

            const tr = document.createElement('tr');
            tr.setAttribute('data-category', r.category);
            tr.innerHTML = `
                <td class="font-medium">${r.name || '-'}</td>
                <td><span class="badge badge-${r.category}">${catLabel}</span></td>
                <td>${r.householdIncome.toLocaleString()}</td>
                <td>RM ${perCapita.toFixed(0)}</td>
                <td>${r.dependents || 0}</td>
                <td><span class="badge ${riskColorClass}" style="background-color: transparent;">${riskLabel}</span></td>
                <td>
                    <div class="trend-cell trend-stable">
                        <i data-lucide="dollar-sign"></i> Stable
                    </div>
                </td>
                <td>
                    <div class="priority-cell">
                        <div class="priority-bar-bg"><div class="priority-bar-fill" style="width: ${r.priorityScore}%;"></div></div>
                        <span class="priority-score">${r.priorityScore}</span>
                    </div>
                </td>
                <td><span class="badge badge-outline ${r.eligibility.status === 'Eligible' ? 'eligible' : 'not-eligible'}">${r.eligibility.status}</span></td>
            `;
            tbody.appendChild(tr);
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
});
