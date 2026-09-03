import { collection, onSnapshot, getDocs, addDoc, deleteDoc, doc, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { setupLogoutButton, updateUserDisplay } from "./auth.js";
import { protectPage, applyNavVisibility, applyCachedNavVisibility } from "./authGuard.js";
import { createPaginator } from "./pagination.js";
import { evaluateEligibility, getHouseholdIncome } from "./eligibility-engine.js";

// Apply the last-known role's nav filter immediately, before protectPage()
// resolves, so the navbar is already correct on first paint.
applyCachedNavVisibility();


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

    // Ketua Kampung + Setiausaha only - matches the "Welfare" nav entry
    const { user, role } = await protectPage(["Ketua Kampung", "Setiausaha"]);
    updateUserDisplay(user);
    setupLogoutButton();
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

    // ---- Rejected Drafts ----
    loadRejectedDrafts();
});

async function rerunAnalysis(draftId, targetCategory, btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="spin" style="width:14px;height:14px;"></i> Running...';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    try {
        // Delete ALL Recalculation drafts (including this one) before creating new
        const rejectedSnap = await getDocs(
            query(collection(db, "welfareDrafts"), where("status", "==", "Recalculation"))
        );
        await Promise.all(rejectedSnap.docs.map(d => deleteDoc(doc(db, "welfareDrafts", d.id))));

        // Fetch all residents and run the eligibility engine
        const residentSnap = await getDocs(collection(db, "residents"));
        const residentsData = [];
        residentSnap.forEach(d => residentsData.push({ id: d.id, ...d.data() }));

        const PRIORITY_ORDER = { 'Very High': 0, 'High': 1, 'Medium': 2, 'Low': 3, 'None': 4 };
        const analysisTimestamp = new Date().toISOString();

        const processed = residentsData.map(resident => {
            const evalResult = evaluateEligibility(resident);
            const householdIncome = (parseFloat(resident.income) || 0) +
                (resident.familyMembers || []).reduce((s, m) => s + (parseFloat(m.income) || 0), 0);
            const dependents = parseInt(resident.dependents) || 0;
            const perCapita = householdIncome / (dependents > 0 ? dependents + 1 : 1);
            let bracket = 'T20 - High Income';
            if (perCapita < 1169)       bracket = 'B40 - Hardcore Poor';
            else if (perCapita <= 4850)  bracket = 'B40 - Low Income';
            else if (perCapita <= 10959) bracket = 'M40 - Middle Income';
            return {
                ...resident, householdIncome, perCapita, bracket,
                isPriority: evalResult.status === 'Eligible',
                eligibilityStatus: evalResult.status,
                eligibilityPriority: evalResult.priority,
                xaiLog: evalResult.reason,
                analysisTimestamp
            };
        });

        processed.sort((a, b) => {
            const pa = PRIORITY_ORDER[a.eligibilityPriority] ?? 4;
            const pb = PRIORITY_ORDER[b.eligibilityPriority] ?? 4;
            return pa !== pb ? pa - pb : a.perCapita - b.perCapita;
        });

        // Save new draft — onSnapshot will remove the card automatically
        await addDoc(collection(db, "welfareDrafts"), {
            targetCategory,
            status: "Pending Approval",
            createdAt: analysisTimestamp,
            createdBy: "Setiausaha",
            recipientICs: processed.map(r => r.ic).filter(Boolean),
            recipients: processed.map(r => ({
                id: r.id,
                name: r.name || null,
                ic: r.ic || null,
                income: r.householdIncome,
                dependents: r.dependents ?? null,
                oku: r.oku || null,
                perCapita: r.perCapita,
                bracket: r.bracket,
                isPriority: r.isPriority,
                eligibilityStatus: r.eligibilityStatus,
                eligibilityPriority: r.eligibilityPriority,
                xaiLog: r.xaiLog
            }))
        });

        showToast('New draft sent to Ketua Kampung for approval.');

    } catch (err) {
        console.error('Re-run failed:', err);
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="rotate-ccw" style="width:14px;height:14px;"></i> Re-run Analysis';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        alert('Re-run failed: ' + err.message);
    }
}

function showToast(msg) {
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);background:#0f172a;color:white;padding:0.75rem 1.5rem;border-radius:8px;font-size:0.875rem;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.2);';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

function loadRejectedDrafts() {
    const container = document.getElementById('rejectedDraftsContainer');
    if (!container) return;

    const q = query(collection(db, "welfareDrafts"), where("status", "==", "Recalculation"));

    onSnapshot(q, (snap) => {
        if (snap.empty) {
            container.innerHTML = `
                <div style="text-align:center;color:#94a3b8;padding:2rem;">
                    <i data-lucide="check-circle" style="width:32px;height:32px;margin-bottom:0.5rem;opacity:0.4;display:block;margin-inline:auto;"></i>
                    No rejected drafts. All submitted drafts have been approved.
                </div>`;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            return;
        }

        container.innerHTML = '';

        snap.forEach(docSnap => {
            const d = docSnap.data();
            const createdDate = d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
            const updatedDate = d.updatedAt ? new Date(d.updatedAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
            const recipientCount = d.recipients?.length || 0;

            const card = document.createElement('div');
            card.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:1.1rem 1.25rem;border:1px solid #fca5a5;border-left:4px solid #ef4444;border-radius:8px;background:#fff;margin-bottom:0.75rem;gap:1rem;flex-wrap:wrap;';
            card.innerHTML = `
                <div>
                    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.3rem;">
                        <i data-lucide="x-circle" style="width:15px;height:15px;color:#ef4444;"></i>
                        <span style="font-weight:700;color:#0f172a;font-size:0.95rem;">${d.targetCategory || 'General Welfare'}</span>
                        <span style="background:#fee2e2;color:#ef4444;padding:2px 8px;border-radius:999px;font-size:0.7rem;font-weight:700;">Rejected</span>
                    </div>
                    <p style="margin:0;font-size:0.8rem;color:#64748b;">
                        Created by ${d.createdBy || 'Setiausaha'} on ${createdDate} &bull; ${recipientCount} households &bull; Rejected on ${updatedDate}
                    </p>
                </div>
                <button class="rerun-btn" style="display:inline-flex;align-items:center;gap:0.4rem;background:#0f172a;color:white;padding:0.5rem 1rem;border-radius:8px;font-size:0.8rem;font-weight:600;cursor:pointer;border:none;white-space:nowrap;">
                    <i data-lucide="rotate-ccw" style="width:14px;height:14px;"></i> Re-run Analysis
                </button>
            `;

            const btn = card.querySelector('.rerun-btn');
            btn.addEventListener('click', () => rerunAnalysis(docSnap.id, d.targetCategory || 'General Welfare', btn));

            container.appendChild(card);
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();

    }, (err) => {
        console.error('Failed to load rejected drafts:', err);
        container.innerHTML = `<div style="color:#ef4444;padding:1rem;font-size:0.875rem;">Could not load rejected drafts: ${err.message}</div>`;
    });
}
