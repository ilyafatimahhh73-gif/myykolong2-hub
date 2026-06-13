import { collection, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { createPaginator } from "./pagination.js";

// Cache for residents so we don't re-fetch on filter change
let cachedResidents = [];

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
        // UI Loading State
        runBtn.disabled = true;
        runBtn.innerHTML = '<i data-lucide="loader" class="spin"></i> Executing AI Engine...';
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">Fetching and analyzing data...</td></tr>';

        // Fetch data
        const residentsRef = collection(db, "residents");
        const snapshot = await getDocs(residentsRef);
        
        const residentsData = [];
        snapshot.forEach(doc => {
            residentsData.push({ id: doc.id, ...doc.data() });
        });

        // 1. Math Engine & Categorization with XAI Generation
        const processedResidents = residentsData.map(resident => {
            const income = parseFloat(resident.income) || 0;
            const dependents = parseInt(resident.dependents) || 0;
            
            // Calculate Per Capita Income (avoid division by zero guard clause)
            const perCapita = income / (dependents > 0 ? dependents : 1);
            
            let bracket = '';
            let priorityGroup = false;
            let xaiLog = '';

            // Categorization
            if (perCapita < 1169) {
                bracket = "B40 - Hardcore Poor";
                priorityGroup = true;
                xaiLog = `Assigned to Hardcore Poor due to per capita income of RM ${perCapita.toFixed(0)} under the RM 1169 threshold.`;
            } else if (perCapita <= 4850) {
                bracket = "B40 - Low Income";
                xaiLog = `Assigned to Low Income due to per capita income of RM ${perCapita.toFixed(0)} under the RM 4850 threshold.`;
            } else if (perCapita <= 10959) {
                bracket = "M40 - Middle Income";
                xaiLog = `Assigned to Middle Income due to per capita income of RM ${perCapita.toFixed(0)} under the RM 10959 threshold.`;
            } else {
                bracket = "T20 - High Income";
                xaiLog = `Assigned to High Income due to per capita income of RM ${perCapita.toFixed(0)} exceeding the RM 10959 threshold.`;
            }

            // Accessibility Priority Override
            if (resident.oku === 'Ya') {
                priorityGroup = true;
                xaiLog += " Forcefully overridden to High Priority due to OKU status (Accessibility Priority Override).";
            }

            return {
                ...resident,
                perCapita: perCapita,
                bracket: bracket,
                isPriority: priorityGroup,
                xaiLog: xaiLog
            };
        });

        // 2. Sorting Logic
        processedResidents.sort((a, b) => {
            // Primary: Push OKU and Hardcore Poor to top
            if (a.isPriority && !b.isPriority) return -1;
            if (!a.isPriority && b.isPriority) return 1;

            // Secondary: Lowest Per Capita Income first
            return a.perCapita - b.perCapita;
        });

        // Cache the sorted array for local filtering
        cachedResidents = processedResidents;

        // 3. Save to welfareDrafts collection as a single transaction
        const targetCategory = targetSelect ? targetSelect.value : "General Welfare";
        
        const draftRecord = {
            targetCategory: targetCategory,
            status: "Pending Approval",
            createdAt: new Date().toISOString(),
            createdBy: "Setiausaha",
            recipients: processedResidents.map(r => ({
                id: r.id,
                name: r.name || null,
                ic: r.ic || null,
                income: r.income || null,
                dependents: r.dependents || null,
                oku: r.oku || null,
                perCapita: r.perCapita,
                bracket: r.bracket,
                isPriority: r.isPriority,
                xaiLog: r.xaiLog
            }))
        };

        const draftsRef = collection(db, "welfareDrafts");
        await addDoc(draftsRef, draftRecord);

        alert(`Success: Phase 1 execution complete! AI Draft for ${targetCategory} successfully triggered and sent to Ketua Kampung for verification.`);

        // Render initially with current filter
        renderEligibilityTable(filterSelect.value);

        // Setup filter listener (only once)
        if (!filterSelect.dataset.listenerAttached) {
            filterSelect.addEventListener('change', (e) => {
                renderEligibilityTable(e.target.value);
            });
            filterSelect.dataset.listenerAttached = 'true';
        }

    } catch (error) {
        console.error("Error analyzing eligibility:", error);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #dc2626; padding: 2rem;">Error: ${error.message}</td></tr>`;
    } finally {
        // Reset button UI
        runBtn.disabled = false;
        runBtn.innerHTML = '<i data-lucide="play"></i> Run Eligibility Analysis';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

// 3. DOM Rendering & Filtering
function renderEligibilityTable(filterType) {
    const tbody = document.getElementById('eligibilityTableBody');
    if (!tbody) return;

    let filtered = [...cachedResidents];

    // Apply Filter
    if (filterType === 'B40 Only') {
        filtered = filtered.filter(r => r.bracket.includes('B40'));
    } else if (filterType === 'OKU Priority') {
        filtered = filtered.filter(r => r.oku === 'Ya');
    }

    // Reset to the first page whenever the filter (or underlying data) changes
    getEligibilityPaginator().update(filtered, { resetLimit: true });
}

// Render a paginated slice of the eligibility table
function renderEligibilityRows(visible) {
    const tbody = document.getElementById('eligibilityTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (visible.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 2rem;">No residents match this filter.</td></tr>';
        return;
    }

    visible.forEach((resident, index) => {
        const tr = document.createElement('tr');
        tr.style.transition = "background-color 0.2s ease";
        tr.onmouseover = () => tr.style.backgroundColor = "#f8fafc";
        tr.onmouseout = () => tr.style.backgroundColor = "transparent";
        
        // Priority Badge with Icons
        let priorityBadge = '';
        if (resident.isPriority) {
            priorityBadge = `
                <div style="display: inline-flex; align-items: center; gap: 0.35rem; background-color: #fee2e2; color: #ef4444; padding: 0.35rem 0.75rem; border-radius: 999px; font-size: 0.75rem; font-weight: 700;">
                    <i data-lucide="alert-circle" style="width: 14px; height: 14px;"></i> High Priority
                </div>
            `;
        } else {
            priorityBadge = `
                <div style="display: inline-flex; align-items: center; gap: 0.35rem; color: #94a3b8; font-size: 0.85rem; font-weight: 500; padding: 0.35rem 0.75rem;">
                    <i data-lucide="check-circle" style="width: 14px; height: 14px; opacity: 0.7;"></i> Standard
                </div>
            `;
        }

        // Bracket Badge Colors
        let bracketStyle = 'background: #e2e8f0; color: #334155;';
        if (resident.bracket.includes('Hardcore Poor')) {
            bracketStyle = 'background: #ef4444; color: white;';
        } else if (resident.bracket.includes('B40')) {
            bracketStyle = 'background: #fef08a; color: #854d0e;';
        } else if (resident.bracket.includes('M40')) {
            bracketStyle = 'background: #dbeafe; color: #1e40af;';
        } else if (resident.bracket.includes('T20')) {
            bracketStyle = 'background: #dcfce3; color: #166534;';
        }

        tr.innerHTML = `
            <td style="font-weight: 700; color: #475569; font-size: 1rem;">#${index + 1}</td>
            <td style="font-weight: 600; color: #0f172a;">
                ${resident.name || '-'} 
                ${resident.oku === 'Ya' ? '<span title="OKU" style="margin-left: 0.5rem; background: #6366f1; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem;">OKU</span>' : ''}
            </td>
            <td style="color: #64748b; font-family: monospace; font-size: 0.9rem;">${resident.ic || '-'}</td>
            <td style="font-weight: 600; color: #0f172a;">RM ${resident.perCapita.toFixed(2)}</td>
            <td><span style="display: inline-block; padding: 0.25rem 0.75rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; ${bracketStyle}">${resident.bracket}</span></td>
            <td>${priorityBadge}</td>
        `;
        tbody.appendChild(tr);
    });

    // Re-initialize Lucide icons for the new dynamic HTML
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}
