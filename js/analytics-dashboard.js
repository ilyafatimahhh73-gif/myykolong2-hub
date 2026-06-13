import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { requireAuth, setupLogoutButton, updateUserDisplay } from "./auth.js";
import { runEligibilityAnalysis } from "./eligibility.js";
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

document.addEventListener("DOMContentLoaded", async () => {
    try {
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
        console.warn("Lucide icons failed to load:", e);
    }

    const runBtn = document.getElementById('runAnalysisBtn');
    if (runBtn) {
        runBtn.addEventListener('click', runEligibilityAnalysis);
    }

    const user = await requireAuth();
    updateUserDisplay(user);
    setupLogoutButton();

    // Chart.js Default styling overriding
    if (typeof Chart !== 'undefined') {
        Chart.defaults.font.family = "'Inter', sans-serif";
        Chart.defaults.color = '#64748b';
    }

    let lineChart, pieChart, barChart;

    // Pagination for the Early Warning (at-risk families) list
    const atRiskPaginator = createPaginator({
        controlsEl: document.getElementById('warningPagination'),
        renderFn: renderWarningCards,
        itemLabel: 'at-risk families'
    });

    // Real-time listener for Analytics
    const residentsRef = collection(db, "residents");
    onSnapshot(residentsRef, (snapshot) => {
        let total = 0;
        let b40 = 0;
        let m40 = 0;
        let t20 = 0;
        
        let totalIncomeSum = 0;
        let atRiskCount = 0;
        
        // Income buckets
        const incomeBuckets = [0, 0, 0, 0, 0, 0]; // <2k, 2-3k, 3-5k, 5-7k, 7-10k, >10k
        
        const atRiskResidents = [];

        snapshot.forEach(doc => {
            total++;
            const data = doc.data();
            data.id = doc.id;
            const income = getHouseholdIncome(data);
            const dependents = parseInt(data.dependents) || 0;
            const perCapita = dependents > 0 ? income / (dependents + 1) : income;
            
            totalIncomeSum += income;
            
            // Categorize
            if (income <= 4850) b40++;
            else if (income <= 10970) m40++;
            else t20++;
            
            // Calculate At-Risk (B40 with low per capita or many dependents)
            const isB40 = income <= 4850;
            const isAtRisk = isB40 && (perCapita <= 800 || dependents >= 4);
            if (isAtRisk) {
                atRiskCount++;
                atRiskResidents.push({ ...data, income, perCapita, dependents });
            }
            
            // Buckets
            if (income < 2000) incomeBuckets[0]++;
            else if (income < 3000) incomeBuckets[1]++;
            else if (income < 5000) incomeBuckets[2]++;
            else if (income < 7000) incomeBuckets[3]++;
            else if (income < 10000) incomeBuckets[4]++;
            else incomeBuckets[5]++;
        });

        // 1. Update KPIs
        const aAvgIncome = document.getElementById('a-avg-income');
        const aAtRisk = document.getElementById('a-at-risk');
        
        if (aAvgIncome) {
            const avg = total > 0 ? (totalIncomeSum / total) : 0;
            aAvgIncome.textContent = `RM ${avg.toFixed(0)}`;
        }
        if (aAtRisk) {
            aAtRisk.textContent = atRiskCount;
        }

        // 2. Render Early Warning List (sorted by perCapita ascending = highest risk first, paginated)
        atRiskResidents.sort((a, b) => a.perCapita - b.perCapita);
        atRiskPaginator.update(atRiskResidents);

        // 2. Update Charts if Chart is loaded
        if (typeof Chart !== 'undefined' && total > 0) {
            
            const b40Pct = ((b40 / total) * 100).toFixed(1);
            const m40Pct = ((m40 / total) * 100).toFixed(1);
            const t20Pct = ((t20 / total) * 100).toFixed(1);
            
            // Pie Chart
            const ctxPie = document.getElementById('pieChart').getContext('2d');
            if (pieChart) pieChart.destroy();
            pieChart = new Chart(ctxPie, {
                type: 'pie',
                data: {
                    labels: [`B40: ${b40Pct}%`, `M40: ${m40Pct}%`, `T20: ${t20Pct}%`],
                    datasets: [{
                        data: [b40, m40, t20],
                        backgroundColor: ['#ef4444', '#f59e0b', '#10b981'],
                        borderWidth: 2,
                        borderColor: '#ffffff',
                        hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20 } }
                    }
                }
            });

            // Bar Chart
            const ctxBar = document.getElementById('barChart').getContext('2d');
            if (barChart) barChart.destroy();
            const maxVal = Math.max(...incomeBuckets) || 10;
            barChart = new Chart(ctxBar, {
                type: 'bar',
                data: {
                    labels: ['< RM2000', 'RM2000-3000', 'RM3000-5000', 'RM5000-7000', 'RM7000-10000', '> RM10000'],
                    datasets: [{
                        label: 'Households',
                        data: incomeBuckets,
                        backgroundColor: '#3b82f6',
                        borderRadius: 4,
                        barPercentage: 0.8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: Math.ceil(maxVal * 1.2),
                            ticks: { stepSize: Math.ceil(maxVal / 5) },
                            grid: { borderDash: [4, 4] },
                            title: { display: true, text: 'Households' }
                        },
                        x: { grid: { display: false } }
                    }
                }
            });
            
            // Line Chart (Static mock since we lack historical DB snapshots, but we keep it functional)
            const ctxLine = document.getElementById('lineChart').getContext('2d');
            if (!lineChart) {
                lineChart = new Chart(ctxLine, {
                    type: 'line',
                    data: {
                        labels: ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'],
                        datasets: [
                            { label: 'B40', data: [42, 40, 38, 35, 32, 30], borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderWidth: 2, tension: 0.3, fill: false, pointRadius: 4 },
                            { label: 'M40', data: [40, 41, 42, 44, 46, 48], borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderWidth: 2, tension: 0.3, fill: false, pointRadius: 4 },
                            { label: 'T20', data: [18, 19, 20, 21, 22, 22], borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 2, tension: 0.3, fill: false, pointRadius: 4 }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20 } } },
                        scales: { y: { beginAtZero: true, max: 60, ticks: { stepSize: 15 }, grid: { borderDash: [4, 4] }, title: { display: true, text: 'Percentage (%)' } }, x: { grid: { display: false } } }
                    }
                });
            }
        }

    }, (error) => {
        console.error("Analytics DB Error:", error);
    });

    // Render a paginated slice of the at-risk families warning list
    function renderWarningCards(visible) {
        const warningList = document.getElementById('warningList');
        if (!warningList) return;

        if (visible.length === 0) {
            warningList.innerHTML = `<div style="text-align:center; color:#22c55e; padding:2rem; font-weight:600;">
                ✅ No at-risk families detected. All households are within safe income thresholds.
            </div>`;
            return;
        }

        warningList.innerHTML = '';
        visible.forEach(r => {
            const isHighRisk = r.perCapita <= 500 || r.dependents >= 5;
            const priorityClass = isHighRisk ? 'badge-priority-high' : 'badge-priority-medium';
            const priorityLabel = isHighRisk ? 'high priority' : 'medium priority';

            let riskFactors = [];
            if (r.perCapita <= 800) riskFactors.push(`Low per capita income (RM ${r.perCapita.toFixed(0)}/person)`);
            if (r.dependents >= 4) riskFactors.push(`High dependents (${r.dependents})`);
            if (r.oku === 'Ya') riskFactors.push('OKU member in household');

            warningList.innerHTML += `
                <div class="warning-card">
                    <div class="warning-info">
                        <div class="warning-title-row">
                            <h4>${r.name || '-'}</h4>
                            <span class="${priorityClass}">${priorityLabel}</span>
                        </div>
                        <div class="warning-detail-row">
                            <strong>Risk Factor:</strong> ${riskFactors.join('; ') || 'Low income household'}
                        </div>
                        <div class="warning-detail-row">
                            <strong>Current Income:</strong> RM ${r.income.toLocaleString()}
                            <span class="trend-badge">
                                <i data-lucide="trending-down"></i> B40 bracket
                            </span>
                        </div>
                    </div>
                    <div class="warning-icon">
                        <i data-lucide="activity"></i>
                    </div>
                </div>
            `;
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
});
