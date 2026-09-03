import { collection, getDocs, addDoc, query, where, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { createPaginator } from "./pagination.js";
import { evaluateEligibility } from "./eligibility-engine.js";

// Cache for residents so we don't re-fetch on filter change
let cachedResidents = [];

// Priority sort order (lower = higher urgency)
const PRIORITY_ORDER = { 'Very High': 0, 'High': 1, 'Medium': 2, 'Low': 3, 'None': 4 };

// Colour + icon map for priority badges
const PRIORITY_STYLE = {
    'Very High': { bg: '#fee2e2', color: '#ef4444', icon: 'flame' },
    'High':      { bg: '#ffedd5', color: '#ea580c', icon: 'alert-circle' },
    'Medium':    { bg: '#fef3c7', color: '#d97706', icon: 'alert-triangle' },
    'Low':       { bg: '#ecfccb', color: '#65a30d', icon: 'check-circle' },
    'None':      { bg: '#f1f5f9', color: '#94a3b8', icon: 'minus-circle' },
};

// Pagination (lazily created once the eligibility table exists in the DOM)
let eligibilityPaginator = null;
function getEligibilityPaginator() {
    if (!eligibilityPaginator) {
        eligibilityPaginator = createPaginator({
            controlsEl: document.getElementById('eligibilityPagination'),
            renderFn: renderEligibilityRows,
            itemLabel: 'residents'
        });
    }
    return eligibilityPaginator;
}

export async function runEligibilityAnalysis() {
    const runBtn = document.getElementById('runAnalysisBtn');
    const tbody = document.getElementById('eligibilityTableBody');
    const filterSelect = document.getElementById('eligibilityFilter');
    const targetSelect = document.getElementById('welfareTargetCategory');

    if (!runBtn || !tbody) return;

    try {
        runBtn.disabled = true;
        runBtn.innerHTML = '<i data-lucide="loader" class="spin"></i> Executing AI Engine...';
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;">Fetching and analyzing data...</td></tr>';

        const snapshot = await getDocs(collection(db, "residents"));
        const residentsData = [];
        snapshot.forEach(d => residentsData.push({ id: d.id, ...d.data() }));

        const analysisTimestamp = new Date().toISOString();

        const processedResidents = residentsData.map(resident => {
            // Full decision-tree evaluation — same engine used on notifications.html
            const evalResult = evaluateEligibility(resident);

            // Household income (head + all family member incomes)
            const householdIncome = (parseFloat(resident.income) || 0) +
                (resident.familyMembers || []).reduce((s, m) => s + (parseFloat(m.income) || 0), 0);
            const dependents = parseInt(resident.dependents) || 0;
            // Per capita divides by household size (head counts as +1)
            const perCapita = householdIncome / (dependents > 0 ? dependents + 1 : 1);

            // Bracket label — per-capita based for fine-grained display
            let bracket = 'T20 - High Income';
            if (perCapita < 1169)      bracket = 'B40 - Hardcore Poor';
            else if (perCapita <= 4850)  bracket = 'B40 - Low Income';
            else if (perCapita <= 10959) bracket = 'M40 - Middle Income';

            return {
                ...resident,
                householdIncome,
                perCapita,
                bracket,
                isPriority: evalResult.status === 'Eligible',
                eligibilityStatus: evalResult.status,
                eligibilityPriority: evalResult.priority,
                xaiLog: evalResult.reason,
                analysisTimestamp
            };
        });

        // Sort: priority level first, then lowest per-capita income
        processedResidents.sort((a, b) => {
            const pa = PRIORITY_ORDER[a.eligibilityPriority] ?? 4;
            const pb = PRIORITY_ORDER[b.eligibilityPriority] ?? 4;
            if (pa !== pb) return pa - pb;
            return a.perCapita - b.perCapita;
        });

        cachedResidents = processedResidents;

        // Remove any previously rejected drafts before saving the new one
        const rejectedSnap = await getDocs(
            query(collection(db, "welfareDrafts"), where("status", "==", "Recalculation"))
        );
        await Promise.all(rejectedSnap.docs.map(d => deleteDoc(doc(db, "welfareDrafts", d.id))));

        // Save draft to Firestore
        const targetCategory = targetSelect ? targetSelect.value : "General Welfare";
        await addDoc(collection(db, "welfareDrafts"), {
            targetCategory,
            status: "Pending Approval",
            createdAt: analysisTimestamp,
            createdBy: "Setiausaha",
            recipients: processedResidents.map(r => ({
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

        alert(`Success: AI Draft for "${targetCategory}" created and sent to Ketua Kampung for approval.`);

        renderEligibilityTable(filterSelect.value);

        if (!filterSelect.dataset.listenerAttached) {
            filterSelect.addEventListener('change', e => renderEligibilityTable(e.target.value));
            filterSelect.dataset.listenerAttached = 'true';
        }

    } catch (error) {
        console.error("Error analyzing eligibility:", error);
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#dc2626;padding:2rem;">Error: ${error.message}</td></tr>`;
    } finally {
        runBtn.disabled = false;
        runBtn.innerHTML = '<i data-lucide="play"></i> Run Eligibility Analysis';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

function renderEligibilityTable(filterType) {
    const tbody = document.getElementById('eligibilityTableBody');
    if (!tbody) return;

    let filtered = [...cachedResidents];

    if (filterType === 'Eligible Only') {
        filtered = filtered.filter(r => r.eligibilityStatus === 'Eligible');
    } else if (filterType === 'B40 Only') {
        filtered = filtered.filter(r => r.bracket.includes('B40'));
    } else if (filterType === 'OKU Priority') {
        filtered = filtered.filter(r => r.oku === 'Ya');
    }

    getEligibilityPaginator().update(filtered, { resetLimit: true });
}

function renderEligibilityRows(visible) {
    const tbody = document.getElementById('eligibilityTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (visible.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:2rem;">No residents match this filter.</td></tr>';
        return;
    }

    visible.forEach((resident, index) => {
        const tr = document.createElement('tr');
        tr.style.transition = "background-color 0.2s ease";
        tr.onmouseover = () => tr.style.backgroundColor = "#f8fafc";
        tr.onmouseout  = () => tr.style.backgroundColor = "transparent";

        // Priority badge
        const ps = PRIORITY_STYLE[resident.eligibilityPriority] || PRIORITY_STYLE['None'];
        const badgeLabel = resident.eligibilityStatus === 'Not Eligible'
            ? 'Not Eligible'
            : `${resident.eligibilityPriority} Priority`;
        const priorityBadge = `
            <div style="display:inline-flex;align-items:center;gap:0.35rem;background:${ps.bg};color:${ps.color};padding:0.35rem 0.75rem;border-radius:999px;font-size:0.75rem;font-weight:700;">
                <i data-lucide="${ps.icon}" style="width:14px;height:14px;"></i> ${badgeLabel}
            </div>`;

        // Bracket badge colour
        let bracketStyle = 'background:#e2e8f0;color:#334155;';
        if (resident.bracket.includes('Hardcore Poor')) bracketStyle = 'background:#ef4444;color:white;';
        else if (resident.bracket.includes('B40'))      bracketStyle = 'background:#fef08a;color:#854d0e;';
        else if (resident.bracket.includes('M40'))      bracketStyle = 'background:#dbeafe;color:#1e40af;';
        else if (resident.bracket.includes('T20'))      bracketStyle = 'background:#dcfce3;color:#166534;';

        tr.innerHTML = `
            <td style="font-weight:700;color:#475569;font-size:1rem;">#${index + 1}</td>
            <td style="font-weight:600;color:#0f172a;">
                ${resident.name || '-'}
                ${resident.oku === 'Ya' ? '<span title="OKU" style="margin-left:0.5rem;background:#6366f1;color:white;padding:2px 6px;border-radius:4px;font-size:0.7rem;">OKU</span>' : ''}
            </td>
            <td style="color:#64748b;font-family:monospace;font-size:0.9rem;">${resident.ic || '-'}</td>
            <td style="font-weight:600;color:#0f172a;">RM ${resident.perCapita.toFixed(2)}</td>
            <td><span style="display:inline-block;padding:0.25rem 0.75rem;border-radius:6px;font-size:0.75rem;font-weight:600;${bracketStyle}">${resident.bracket}</span></td>
            <td>${priorityBadge}</td>
            <td>
                <button class="xai-reason-btn"
                    style="display:inline-flex;align-items:center;gap:0.3rem;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;padding:0.3rem 0.7rem;font-size:0.75rem;font-weight:600;cursor:pointer;"
                    data-name="${(resident.name || '').replace(/"/g, '&quot;')}"
                    data-ic="${resident.ic || '-'}"
                    data-income="${resident.householdIncome || 0}"
                    data-dependents="${resident.dependents || 0}"
                    data-percapita="${resident.perCapita.toFixed(2)}"
                    data-bracket="${resident.bracket}"
                    data-timestamp="${resident.analysisTimestamp}"
                    data-xai="${(resident.xaiLog || '').replace(/"/g, '&quot;')}">
                    <i data-lucide="info" style="width:13px;height:13px;"></i> Reason Log
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
}
