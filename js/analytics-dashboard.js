import { collection, onSnapshot, getDocs } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { setupLogoutButton, updateUserDisplay } from "./auth.js";
import { protectPage, applyNavVisibility, applyCachedNavVisibility } from "./authGuard.js";
import { runEligibilityAnalysis } from "./eligibility.js";
import { createPaginator } from "./pagination.js";

applyCachedNavVisibility();

// Stores the latest residents snapshot for export functions
let reportData = null;

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

    const { user, role } = await protectPage(["Ketua Kampung", "Setiausaha"]);
    updateUserDisplay(user);
    setupLogoutButton();
    applyNavVisibility(role);

    // Welfare Eligibility Analytics is Setiausaha's responsibility - hide it for Ketua Kampung
    if (role !== "Setiausaha") {
        const eligibilityPanel = document.getElementById('welfare-eligibility-panel');
        if (eligibilityPanel) eligibilityPanel.remove();
    }

    // Show export button only for Setiausaha and wire up the dropdown
    if (role === "Setiausaha") {
        const wrapper = document.getElementById('exportDropdownWrapper');
        const toggle  = document.getElementById('exportToggle');
        const menu    = document.getElementById('exportMenu');
        const chevron = document.getElementById('exportChevron');
        if (wrapper) wrapper.style.display = 'block';

        toggle.addEventListener('click', () => {
            const open = menu.style.display === 'block';
            menu.style.display = open ? 'none' : 'block';
            if (chevron) chevron.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
        });
        document.addEventListener('click', (e) => {
            if (wrapper.contains(e.target)) return; // click inside — keep open
            menu.style.display = 'none';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        });
        document.getElementById('exportPdfBtn').addEventListener('click', exportToPDF);
        document.getElementById('exportExcelBtn').addEventListener('click', exportToExcel);
    }

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

        const allResidents = [];
        snapshot.forEach(doc => {
            total++;
            const data = doc.data();
            data.id = doc.id;
            allResidents.push(data);
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
        if (total > 0) {
            const b40Pct = ((b40 / total) * 100).toFixed(1);
            const m40Pct = ((m40 / total) * 100).toFixed(1);
            const t20    = total - b40 - m40;
            const t20Pct = ((t20 / total) * 100).toFixed(1);
            const avg    = Math.round(totalIncomeSum / total);

            // Cache for export functions
            reportData = {
                generatedAt: new Date(),
                total, b40, b40Pct, m40, m40Pct, t20, t20Pct,
                avgIncome: avg,
                atRiskCount,
                incomeBuckets,
                atRiskResidents: [...atRiskResidents],
                allResidents
            };

            const el = (id) => document.getElementById(id);
            if (el('a-b40-count')) el('a-b40-count').textContent = b40;
            if (el('a-b40-pct'))   el('a-b40-pct').textContent   = `${b40Pct}% of village`;
            if (el('a-m40-count')) el('a-m40-count').textContent = m40;
            if (el('a-m40-pct'))   el('a-m40-pct').textContent   = `${m40Pct}% of village`;
            if (el('a-avg-income')) el('a-avg-income').textContent = `RM ${avg.toLocaleString()}`;
            if (el('a-at-risk'))    el('a-at-risk').textContent    = atRiskCount;

            // Insight banner — summarise the village income profile
            const insightText = el('insightText');
            if (insightText) {
                const dominant = b40 >= m40 && b40 >= t20 ? 'B40' : m40 >= t20 ? 'M40' : 'T20';
                insightText.innerHTML = `<span>Village Snapshot:</span> ${total} households recorded — `
                    + `<strong>${b40} B40</strong> (${b40Pct}%), `
                    + `<strong>${m40} M40</strong> (${m40Pct}%), `
                    + `<strong>${t20} T20</strong> (${((t20/total)*100).toFixed(1)}%). `
                    + `Average household income: <strong>RM ${avg.toLocaleString()}/month</strong>. `
                    + `${atRiskCount} household${atRiskCount !== 1 ? 's' : ''} flagged as at-risk (B40 + per capita &lt; RM 800).`;
            }
        }

        // 2. Render Early Warning List (sorted by perCapita ascending = highest risk first, paginated)
        atRiskResidents.sort((a, b) => a.perCapita - b.perCapita);
        atRiskPaginator.update(atRiskResidents);

        // 2. Update Charts if Chart is loaded
        if (typeof Chart !== 'undefined' && total > 0) {
            
            const b40Pct = ((b40 / total) * 100).toFixed(1);
            const m40Pct = ((m40 / total) * 100).toFixed(1);
            const t20c   = total - b40 - m40;
            const t20Pct = ((t20c / total) * 100).toFixed(1);

            // Pie Chart
            const ctxPie = document.getElementById('pieChart').getContext('2d');
            if (pieChart) pieChart.destroy();
            pieChart = new Chart(ctxPie, {
                type: 'pie',
                data: {
                    labels: [`B40: ${b40Pct}%`, `M40: ${m40Pct}%`, `T20: ${t20Pct}%`],
                    datasets: [{
                        data: [b40, m40, t20c],
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
            
            // Line chart is built from draft history — see loadLineChart() below
        }

    }, (error) => {
        console.error("Analytics DB Error:", error);
    });

    // Build line chart from real draft history (one data point per month)
    async function loadLineChart() {
        if (typeof Chart === 'undefined') return;

        let labels = [], b40Data = [], m40Data = [], t20Data = [];

        try {
            // No orderBy — sort in JS to avoid requiring a Firestore composite index
            const draftsSnap = await getDocs(collection(db, "welfareDrafts"));

            // Group by YYYY-MM, keep the latest draft per month
            const byMonth = {};
            draftsSnap.forEach(docSnap => {
                const d = docSnap.data();
                if (!d.createdAt || !d.recipients) return;
                const monthKey = d.createdAt.substring(0, 7);
                if (!byMonth[monthKey] || d.createdAt > byMonth[monthKey].createdAt) {
                    byMonth[monthKey] = d;
                }
            });

            const monthKeys = Object.keys(byMonth).sort().slice(-6);

            monthKeys.forEach(key => {
                const d = byMonth[key];
                const recipients = d.recipients || [];
                const total = recipients.length;
                if (total === 0) return;

                let b40 = 0, m40 = 0, t20 = 0;
                recipients.forEach(r => {
                    if (r.bracket && r.bracket.includes('B40')) b40++;
                    else if (r.bracket && r.bracket.includes('M40')) m40++;
                    else t20++;
                });

                const [year, month] = key.split('-');
                const monthName = new Date(parseInt(year), parseInt(month) - 1, 1)
                    .toLocaleString('en-MY', { month: 'short' });
                labels.push(`${monthName} ${year}`);
                b40Data.push(parseFloat(((b40 / total) * 100).toFixed(1)));
                m40Data.push(parseFloat(((m40 / total) * 100).toFixed(1)));
                t20Data.push(parseFloat(((t20 / total) * 100).toFixed(1)));
            });
        } catch (err) {
            console.warn("Could not load draft history for line chart:", err);
        }

        // If no draft history, show a placeholder label so the chart isn't empty
        if (labels.length === 0) {
            labels = ['No analysis run yet'];
            b40Data = [null];
            m40Data = [null];
            t20Data = [null];
        }

        const ctxLine = document.getElementById('lineChart');
        if (!ctxLine) return;

        if (lineChart) lineChart.destroy();
        lineChart = new Chart(ctxLine.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'B40 (%)', data: b40Data, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)', borderWidth: 2, tension: 0.3, fill: false, pointRadius: 5, spanGaps: false },
                    { label: 'M40 (%)', data: m40Data, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)', borderWidth: 2, tension: 0.3, fill: false, pointRadius: 5, spanGaps: false },
                    { label: 'T20 (%)', data: t20Data, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', borderWidth: 2, tension: 0.3, fill: false, pointRadius: 5, spanGaps: false }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20 } },
                    tooltip: {
                        callbacks: {
                            label: ctx => ctx.parsed.y !== null ? `${ctx.dataset.label}: ${ctx.parsed.y}%` : ''
                        }
                    }
                },
                scales: {
                    y: { beginAtZero: true, max: 100, ticks: { stepSize: 20, callback: v => v + '%' }, grid: { borderDash: [4, 4] }, title: { display: true, text: 'Percentage of Households (%)' } },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    loadLineChart();

    // ── Shared: read which sections are ticked ────────────────────────────────
    function getCheckedSections() {
        return {
            kpi:  document.getElementById('chk-kpi')?.checked  ?? true,
            dist: document.getElementById('chk-dist')?.checked ?? true,
            risk: document.getElementById('chk-risk')?.checked ?? true,
            all:  document.getElementById('chk-all')?.checked  ?? true,
        };
    }

    // ── PDF Export ────────────────────────────────────────────────────────────
    function exportToPDF() {
        if (!reportData) { alert('Data is still loading. Please wait a moment and try again.'); return; }
        const sections = getCheckedSections();
        if (!sections.kpi && !sections.dist && !sections.risk && !sections.all) {
            alert('Please select at least one section to export.');
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 14;
        const now = reportData.generatedAt.toLocaleString('en-MY', { dateStyle: 'long', timeStyle: 'short' });
        const NAVY  = [15, 23, 42];
        const BLUE  = [59, 130, 246];
        const LIGHT = [248, 250, 252];

        // ── Cover header ──────────────────────────────────────────────────────
        doc.setFillColor(...NAVY);
        doc.rect(0, 0, pageW, 38, 'F');

        doc.setFillColor(...BLUE);
        doc.circle(margin + 6, 19, 6, 'F');

        doc.setFontSize(7).setTextColor(180, 200, 230).setFont('helvetica', 'normal');
        doc.text('MYKOLONG2 HUB', margin + 14, 16);
        doc.setFontSize(14).setTextColor(255, 255, 255).setFont('helvetica', 'bold');
        doc.text('Village Analytics Report', margin + 14, 24);
        doc.setFontSize(8).setTextColor(180, 200, 230).setFont('helvetica', 'normal');
        doc.text(`Generated: ${now}`, margin + 14, 31);

        doc.setFontSize(8).setTextColor(180, 200, 230);
        doc.text('CONFIDENTIAL — FOR OFFICIAL USE ONLY', pageW - margin, 31, { align: 'right' });

        let y = 48;

        // ── Section helper ────────────────────────────────────────────────────
        function section(title, subtitle) {
            if (y > pageH - 50) { doc.addPage(); y = 20; }
            doc.setFillColor(...BLUE);
            doc.rect(margin, y, 2, 5, 'F');
            doc.setFontSize(11).setTextColor(...NAVY).setFont('helvetica', 'bold');
            doc.text(title, margin + 5, y + 4);
            if (subtitle) {
                doc.setFontSize(8).setTextColor(100, 116, 139).setFont('helvetica', 'normal');
                doc.text(subtitle, margin + 5, y + 9);
                y += 14;
            } else {
                y += 10;
            }
        }

        function pageFooter() {
            const pages = doc.internal.getNumberOfPages();
            for (let i = 1; i <= pages; i++) {
                doc.setPage(i);
                doc.setDrawColor(226, 232, 240);
                doc.line(margin, pageH - 12, pageW - margin, pageH - 12);
                doc.setFontSize(7).setTextColor(148, 163, 184).setFont('helvetica', 'normal');
                doc.text('MyKolong2 Hub — Village Management System', margin, pageH - 7);
                doc.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 7, { align: 'right' });
            }
        }

        const pdfTotal = reportData.total || 1;

        // ── 1. KPI Summary ────────────────────────────────────────────────────
        if (sections.kpi) {
            section('Village Income Snapshot', `Total households in database: ${reportData.total}`);
            doc.autoTable({
                startY: y,
                head: [['Metric', 'Value', 'Share of Village']],
                body: [
                    ['B40 Households (Low Income)',   `${reportData.b40}`,   `${reportData.b40Pct}%`],
                    ['M40 Households (Middle Income)',`${reportData.m40}`,   `${reportData.m40Pct}%`],
                    ['T20 Households (High Income)',  `${reportData.t20}`,   `${reportData.t20Pct}%`],
                    ['Average Household Income',      `RM ${reportData.avgIncome.toLocaleString()}`, 'Per household / month'],
                    ['At-Risk Families',              `${reportData.atRiskCount}`, 'B40, per capita < RM 800'],
                ],
                styles: { font: 'helvetica', fontSize: 9, cellPadding: 4 },
                headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 9 },
                alternateRowStyles: { fillColor: LIGHT },
                columnStyles: { 0: { fontStyle: 'bold', cellWidth: 90 }, 1: { halign: 'center', cellWidth: 40 }, 2: { halign: 'center' } },
                margin: { left: margin, right: margin },
            });
            y = doc.lastAutoTable.finalY + 10;
        }

        // ── 2. Income Distribution ────────────────────────────────────────────
        if (sections.dist) {
            section('Income Distribution', 'Household count by monthly income range');
            const bucketLabels  = ['< RM 2,000', 'RM 2,000 – 3,000', 'RM 3,000 – 5,000', 'RM 5,000 – 7,000', 'RM 7,000 – 10,000', '> RM 10,000'];
            const bucketBracket = ['B40', 'B40', 'M40', 'M40', 'T20', 'T20'];
            doc.autoTable({
                startY: y,
                head: [['Income Range', 'Bracket', 'Households', '% of Total']],
                body: bucketLabels.map((lbl, i) => [
                    lbl, bucketBracket[i], reportData.incomeBuckets[i],
                    `${((reportData.incomeBuckets[i] / pdfTotal) * 100).toFixed(1)}%`
                ]),
                styles: { font: 'helvetica', fontSize: 9, cellPadding: 4 },
                headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 9 },
                alternateRowStyles: { fillColor: LIGHT },
                columnStyles: { 0: { cellWidth: 70 }, 2: { halign: 'center' }, 3: { halign: 'center' } },
                margin: { left: margin, right: margin },
            });
            y = doc.lastAutoTable.finalY + 10;
        }

        // ── 3. At-Risk Families ────────────────────────────────────────────────
        if (sections.risk) {
            section('At-Risk Families', 'B40 households with per-capita income below RM 800 or 4+ dependents');
            if (reportData.atRiskResidents.length === 0) {
                doc.setFontSize(9).setTextColor(34, 197, 94).setFont('helvetica', 'italic');
                doc.text('No at-risk families detected. All households are within safe thresholds.', margin, y + 5);
                y += 14;
            } else {
                doc.autoTable({
                    startY: y,
                    head: [['Name', 'IC / MyKad', 'Household Income', 'Per Capita', 'Dependents']],
                    body: reportData.atRiskResidents.map(r => [
                        r.name || '—', r.ic || '—',
                        `RM ${r.income.toLocaleString()}`,
                        `RM ${r.perCapita.toFixed(0)}`,
                        r.dependents
                    ]),
                    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 3.5 },
                    headStyles: { fillColor: [239, 68, 68], textColor: 255, fontStyle: 'bold', fontSize: 9 },
                    alternateRowStyles: { fillColor: [255, 241, 242] },
                    margin: { left: margin, right: margin },
                });
                y = doc.lastAutoTable.finalY + 10;
            }
        }

        // ── 4. All Residents ──────────────────────────────────────────────────
        if (sections.all) {
            if (y > pageH - 60) { doc.addPage(); y = 20; }
            section('Complete Household Register', `${reportData.allResidents.length} households on record`);
            const resRows = reportData.allResidents.map((r, i) => {
                const inc = getHouseholdIncome(r);
                const dep = parseInt(r.dependents) || 0;
                const pc  = dep > 0 ? inc / (dep + 1) : inc;
                let bracket = 'T20';
                if (pc < 1169) bracket = 'B40 – Hardcore Poor';
                else if (pc <= 4850)  bracket = 'B40 – Low Income';
                else if (pc <= 10959) bracket = 'M40 – Middle Income';
                return [i + 1, r.name || '—', r.ic || '—', `RM ${inc.toLocaleString()}`, `RM ${pc.toFixed(0)}`, bracket];
            });
            doc.autoTable({
                startY: y,
                head: [['#', 'Name', 'IC / MyKad', 'Hh. Income', 'Per Capita', 'Bracket']],
                body: resRows,
                styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2.5 },
                headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8 },
                alternateRowStyles: { fillColor: LIGHT },
                columnStyles: { 0: { cellWidth: 14, halign: 'center' }, 2: { font: 'courier', fontSize: 7 }, 3: { halign: 'right' }, 4: { halign: 'right' } },
                margin: { left: margin, right: margin },
            });
        }

        pageFooter();

        const dateTag = reportData.generatedAt.toISOString().substring(0, 10);
        doc.save(`MyKolong2_Analytics_Report_${dateTag}.pdf`);
    }

    // ── Excel Export ──────────────────────────────────────────────────────────
    function exportToExcel() {
        if (!reportData) { alert('Data is still loading. Please wait a moment and try again.'); return; }
        if (typeof XLSX === 'undefined') { alert('Excel library not loaded. Please refresh the page.'); return; }
        const sections = getCheckedSections();
        if (!sections.kpi && !sections.dist && !sections.risk && !sections.all) {
            alert('Please select at least one section to export.');
            return;
        }

        const wb = XLSX.utils.book_new();
        const xlTotal = reportData.total || 1;

        // Sheet 1 — KPI Summary
        if (sections.kpi) {
            const summaryRows = [
                ['MyKolong2 Hub — Village Analytics Report'],
                [`Generated: ${reportData.generatedAt.toLocaleString('en-MY')}`],
                [],
                ['Metric', 'Value', 'Share of Village'],
                ['Total Households',              reportData.total,     '100%'],
                ['B40 – Low Income Households',   reportData.b40,       `${reportData.b40Pct}%`],
                ['M40 – Middle Income Households',reportData.m40,       `${reportData.m40Pct}%`],
                ['T20 – High Income Households',  reportData.t20,       `${reportData.t20Pct}%`],
                ['Average Household Income (RM)', reportData.avgIncome, 'Per household / month'],
                ['At-Risk Families',              reportData.atRiskCount, 'B40, per capita < RM 800'],
            ];
            const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
            wsSummary['!cols'] = [{ wch: 38 }, { wch: 16 }, { wch: 22 }];
            XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
        }

        // Sheet 2 — Income Distribution
        if (sections.dist) {
            const bucketLabels = ['< RM 2,000', 'RM 2,000–3,000', 'RM 3,000–5,000', 'RM 5,000–7,000', 'RM 7,000–10,000', '> RM 10,000'];
            const distRows = [
                ['Income Range', 'Bracket', 'Households', '% of Total'],
                ...bucketLabels.map((lbl, i) => {
                    const bracket = i < 2 ? 'B40' : i < 4 ? 'M40' : 'T20';
                    return [lbl, bracket, reportData.incomeBuckets[i], parseFloat(((reportData.incomeBuckets[i] / xlTotal) * 100).toFixed(1))];
                })
            ];
            const wsDist = XLSX.utils.aoa_to_sheet(distRows);
            wsDist['!cols'] = [{ wch: 20 }, { wch: 8 }, { wch: 14 }, { wch: 12 }];
            XLSX.utils.book_append_sheet(wb, wsDist, 'Income Distribution');
        }

        // Sheet 3 — At-Risk Families
        if (sections.risk) {
            const atRiskRows = [
                ['Name', 'IC / MyKad', 'Household Income (RM)', 'Per Capita (RM)', 'Dependents', 'Risk Factors'],
                ...reportData.atRiskResidents.map(r => {
                    const factors = [];
                    if (r.perCapita <= 800) factors.push(`Low per capita (RM ${r.perCapita.toFixed(0)})`);
                    if (r.dependents >= 4)  factors.push(`High dependents (${r.dependents})`);
                    if (r.oku === 'Ya')     factors.push('OKU member');
                    return [r.name || '—', r.ic || '—', r.income, parseFloat(r.perCapita.toFixed(0)), r.dependents, factors.join('; ')];
                })
            ];
            const wsAtRisk = XLSX.utils.aoa_to_sheet(atRiskRows);
            wsAtRisk['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 40 }];
            XLSX.utils.book_append_sheet(wb, wsAtRisk, 'At-Risk Families');
        }

        // Sheet 4 — All Residents
        if (sections.all) {
            const resRows = [
                ['#', 'Name', 'IC / MyKad', 'Household Income (RM)', 'Per Capita (RM)', 'Dependents', 'Bracket', 'OKU'],
                ...reportData.allResidents.map((r, i) => {
                    const inc = getHouseholdIncome(r);
                    const dep = parseInt(r.dependents) || 0;
                    const pc  = dep > 0 ? inc / (dep + 1) : inc;
                    let bracket = 'T20 – High Income';
                    if (pc < 1169) bracket = 'B40 – Hardcore Poor';
                    else if (pc <= 4850)  bracket = 'B40 – Low Income';
                    else if (pc <= 10959) bracket = 'M40 – Middle Income';
                    return [i + 1, r.name || '—', r.ic || '—', inc, parseFloat(pc.toFixed(0)), dep, bracket, r.oku === 'Ya' ? 'Yes' : 'No'];
                })
            ];
            const wsRes = XLSX.utils.aoa_to_sheet(resRows);
            wsRes['!cols'] = [{ wch: 4 }, { wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 22 }, { wch: 6 }];
            XLSX.utils.book_append_sheet(wb, wsRes, 'All Residents');
        }

        const dateTag = reportData.generatedAt.toISOString().substring(0, 10);
        XLSX.writeFile(wb, `MyKolong2_Analytics_${dateTag}.xlsx`);
    }

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
