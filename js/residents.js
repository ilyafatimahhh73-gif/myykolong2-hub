// Residents Firestore CRUD — MyKolong2 Hub
// Handles all Create, Read, Update, Delete operations for the residents collection

import {
    collection, getDocs, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { createPaginator } from "./pagination.js";

const residentsRef = collection(db, "residents");

// ============ UTILITY ============

/** Classify income into B40/M40/T20 */
function classifyIncome(income) {
    if (income <= 4850) return 'B40';
    if (income <= 10970) return 'M40';
    return 'T20';
}

/** Get badge class for category */
function badgeClass(category) {
    return category === 'B40' ? 'badge-b40' : category === 'M40' ? 'badge-m40' : 'badge-t20';
}

/** Format number with commas */
function formatNumber(num) {
    return Number(num).toLocaleString();
}

/** Calculate total household income (head + all family members) */
function getHouseholdIncome(resident) {
    let total = parseFloat(resident.income) || 0;
    if (resident.familyMembers && resident.familyMembers.length > 0) {
        resident.familyMembers.forEach(m => {
            total += parseFloat(m.income) || 0;
        });
    }
    return total;
}

/** Evaluate Priority Level using Decision Tree */
export function evaluateEligibility(resident) {
    const householdIncome = getHouseholdIncome(resident);
    const category = classifyIncome(householdIncome);
    const dependents = resident.dependents || 0;
    const perCapita = dependents > 0 ? householdIncome / (dependents + 1) : householdIncome;

    let hasOku = resident.oku === 'Ya';
    let hasElderly = resident.age >= 60;
    if (resident.familyMembers) {
        resident.familyMembers.forEach(m => {
            if (m.oku === 'Ya') hasOku = true;
            if (m.age >= 60) hasElderly = true;
        });
    }

    if (category === 'B40') {
        if (perCapita <= 500 || dependents >= 5) {
            return { status: 'Eligible', priority: 'Very High', color: '#ef4444', bg: '#fee2e2' };
        } else if (hasOku || hasElderly) {
            return { status: 'Eligible', priority: 'High', color: '#ea580c', bg: '#ffedd5' };
        } else {
            return { status: 'Eligible', priority: 'Medium', color: '#d97706', bg: '#fef3c7' };
        }
    } else if (category === 'M40') {
        if (perCapita <= 800 && dependents >= 3) {
            if (hasOku || hasElderly) {
                return { status: 'Eligible', priority: 'Medium', color: '#d97706', bg: '#fef3c7' };
            }
            return { status: 'Eligible', priority: 'Low', color: '#65a30d', bg: '#ecfccb' };
        } else if (hasOku || hasElderly) {
            return { status: 'Eligible', priority: 'Low', color: '#65a30d', bg: '#ecfccb' };
        } else {
            return { status: 'Not Eligible', priority: 'None', color: '#64748b', bg: '#f1f5f9' };
        }
    } else {
        if (hasOku && hasElderly && dependents >= 5) {
            return { status: 'Eligible', priority: 'Low', color: '#65a30d', bg: '#ecfccb' };
        }
        return { status: 'Not Eligible', priority: 'None', color: '#64748b', bg: '#f1f5f9' };
    }
}

// ============ DOM REFERENCES ============

const tbody = document.querySelector('.data-table tbody');
const kpiTotal = document.getElementById('kpi-total');
const kpiB40 = document.getElementById('kpi-b40');
const kpiM40 = document.getElementById('kpi-m40');
const kpiT20 = document.getElementById('kpi-t20');

const addModal = document.getElementById('addResidentModal');
const viewModal = document.getElementById('viewResidentModal');
const openAddBtn = document.getElementById('openAddResidentModal');
const closeAddBtn = document.getElementById('closeAddResidentModal');
const cancelAddBtn = document.querySelector('.close-modal-btn-txt');
const closeViewBtn = document.getElementById('closeViewResidentModal');

const modalTitle = document.querySelector('#addResidentModal h2');
const modalDesc = document.querySelector('#addResidentModal p');
const submitBtn = document.querySelector('#addResidentModal button[type="submit"]');
const modalForm = document.querySelector('#addResidentModal .modal-form');

// Form field references — Head of Household
const fName = document.getElementById('f-name');
const fIc = document.getElementById('f-ic');
const fAge = document.getElementById('f-age');
const fGender = document.getElementById('f-gender');
const fMarital = document.getElementById('f-marital');
const fOccupation = document.getElementById('f-occupation');
const fIncome = document.getElementById('f-income');
const fAddress = document.getElementById('f-address');
const fPhone = document.getElementById('f-phone');
const fOku = document.getElementById('f-oku');
const fOkuType = document.getElementById('f-oku-type');

// Family members container
const familyContainer = document.getElementById('familyMembersContainer');
const addFamilyBtn = document.getElementById('addFamilyMemberBtn');
let familyMemberCount = 0;

// View modal fields
const vSub = document.getElementById('v-sub');
const vName = document.getElementById('v-name');
const vIc = document.getElementById('v-ic');
const vAge = document.getElementById('v-age');
const vGender = document.getElementById('v-gender');
const vMarital = document.getElementById('v-marital');
const vOccupation = document.getElementById('v-occupation');
const vIncome = document.getElementById('v-income');
const vDep = document.getElementById('v-dep');
const vCat = document.getElementById('v-cat');
const vPriority = document.getElementById('v-priority');
const vPhone = document.getElementById('v-phone');
const vAddress = document.getElementById('v-address');
const vOku = document.getElementById('v-oku');
const vOkuType = document.getElementById('v-oku-type');
const vVulnerabilityBanner = document.getElementById('v-vulnerability-banner');
const vFamilyMembers = document.getElementById('v-family-members');

// Search and filter
const searchInput = document.querySelector('.search-wrapper input');
const categoryFilter = document.querySelector('.filter-wrapper select');

// ============ STATE ============
let editingDocId = null; // If set, we're in edit mode
let allResidents = []; // Local cache for search/filter

// ============ PAGINATION ============
const residentsPaginator = createPaginator({
    controlsEl: document.getElementById('residentsPagination'),
    renderFn: renderTable,
    itemLabel: 'residents'
});

// ============ RENDER TABLE ============

function renderTable(residents) {
    tbody.innerHTML = '';

    if (residents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 2rem;">No residents found.</td></tr>`;
        return;
    }

    residents.forEach(r => {
        const householdIncome = getHouseholdIncome(r);
        const cat = classifyIncome(householdIncome);
        const eligibility = evaluateEligibility(r);

        const priorityBadge = eligibility.priority !== 'None'
            ? `<span style="background-color: ${eligibility.bg}; color: ${eligibility.color}; padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600;">${eligibility.priority}</span>`
            : `<span style="color: #94a3b8; font-size: 0.85rem;">-</span>`;

        const tr = document.createElement('tr');
        tr.setAttribute('data-id', r.id);
        tr.innerHTML = `
            <td class="font-medium">${r.name}</td>
            <td>${r.ic}</td>
            <td>${r.age}</td>
            <td>${formatNumber(householdIncome)}</td>
            <td>${r.dependents}</td>
            <td><span class="badge ${badgeClass(cat)}">${cat}</span></td>
            <td>${priorityBadge}</td>
            <td class="table-actions-cell">
                <button class="icon-btn view-resident-btn" data-id="${r.id}"><i data-lucide="eye"></i></button>
                <button class="icon-btn edit-resident-btn" data-id="${r.id}"><i data-lucide="edit"></i></button>
                <button class="icon-btn text-red delete-resident-btn" data-id="${r.id}"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Re-init Lucide for new icons
    lucide.createIcons();

    // Attach event listeners to new buttons
    attachRowListeners();
}

// ============ KPI UPDATE ============

function updateKPIs(residents) {
    let b40 = 0, m40 = 0, t20 = 0;
    residents.forEach(r => {
        const cat = classifyIncome(getHouseholdIncome(r));
        if (cat === 'B40') b40++;
        else if (cat === 'M40') m40++;
        else t20++;
    });
    kpiTotal.textContent = residents.length;
    kpiB40.textContent = b40;
    kpiM40.textContent = m40;
    kpiT20.textContent = t20;
}

// ============ REAL-TIME LISTENER ============

export function listenToResidents() {
    const q = query(residentsRef, orderBy("createdAt", "desc"));

    onSnapshot(q, (snapshot) => {
        allResidents = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        applyFilters();
        updateKPIs(allResidents);
    }, (error) => {
        console.error("Firestore Error:", error);
    });
}

// ============ SEARCH & FILTER ============

function applyFilters(resetPagination = false) {
    let filtered = [...allResidents];

    // Search
    const term = searchInput.value.toLowerCase().trim();
    if (term) {
        filtered = filtered.filter(r =>
            r.name.toLowerCase().includes(term) ||
            r.ic.toLowerCase().includes(term)
        );
    }

    // Category
    const catVal = categoryFilter.value;
    if (catVal !== 'All Categories') {
        filtered = filtered.filter(r => classifyIncome(r.income) === catVal);
    }

    residentsPaginator.update(filtered, { resetLimit: resetPagination });
}

if (searchInput) searchInput.addEventListener('input', () => applyFilters(true));
if (categoryFilter) categoryFilter.addEventListener('change', () => applyFilters(true));

// ============ ADD / EDIT MODAL ============

function openAddModal() {
    editingDocId = null;
    modalTitle.innerText = 'Tambah Penduduk Baru';
    modalDesc.innerText = 'Banci Penduduk Kampung — Village Census Form';
    submitBtn.innerText = 'Simpan (Save)';
    modalForm.reset();
    familyContainer.innerHTML = '';
    familyMemberCount = 0;
    addModal.classList.add('active');
}

/** Normalize gender string to match dropdown options */
function normalizeGender(raw) {
    if (!raw) return '';
    const s = String(raw).trim().toLowerCase();
    if (s.startsWith('l')) return 'Lelaki';
    if (s.startsWith('p') || s.startsWith('f') || s.startsWith('w')) return 'Perempuan';
    return raw;
}

function openEditModal(residentData) {
    editingDocId = residentData.id;
    modalTitle.innerText = 'Kemaskini Butiran Penduduk';
    modalDesc.innerText = 'Edit Resident — Update household census data';
    submitBtn.innerText = 'Kemaskini (Update)';

    fName.value = residentData.name || '';
    fIc.value = residentData.ic || '';
    fAge.value = residentData.age || '';
    fGender.value = normalizeGender(residentData.gender);
    fMarital.value = residentData.maritalStatus || '';
    fOccupation.value = residentData.occupation || '';
    fIncome.value = residentData.income || '';
    fAddress.value = residentData.address || '';
    fPhone.value = residentData.phone || '';
    fOku.value = residentData.oku || 'Tidak';
    fOkuType.value = residentData.okuType || '';

    // Populate family members
    familyContainer.innerHTML = '';
    familyMemberCount = 0;
    if (residentData.familyMembers && residentData.familyMembers.length > 0) {
        residentData.familyMembers.forEach(member => {
            addFamilyMemberCard(member);
        });
    }

    addModal.classList.add('active');
}

function closeAddModal() {
    addModal.classList.remove('active');
    editingDocId = null;
}

// ============ FAMILY MEMBER CARDS ============

function addFamilyMemberCard(data = {}) {
    familyMemberCount++;
    const num = familyMemberCount;
    const card = document.createElement('div');
    card.className = 'family-member-card';
    card.setAttribute('data-fm-index', num);
    card.innerHTML = `
        <div class="fm-header">
            <span class="fm-number">Ahli #${num}</span>
            <button type="button" class="fm-remove" onclick="this.closest('.family-member-card').remove()">✕ Buang</button>
        </div>
        <div class="fm-grid">
            <div class="form-group">
                <label>Nama</label>
                <input type="text" class="fm-name" placeholder="Full name" value="${data.name || ''}">
            </div>
            <div class="form-group">
                <label>MyKad</label>
                <input type="text" class="fm-ic" placeholder="IC Number" value="${data.ic || ''}">
            </div>
            <div class="form-group">
                <label>Umur</label>
                <input type="number" class="fm-age" placeholder="Age" value="${data.age || ''}">
            </div>
            <div class="form-group">
                <label>Jantina (L/P)</label>
                <div class="select-wrapper">
                    <select class="fm-gender">
                        <option value="">Pilih</option>
                        <option value="Lelaki" ${data.gender === 'Lelaki' ? 'selected' : ''}>Lelaki</option>
                        <option value="Perempuan" ${data.gender === 'Perempuan' ? 'selected' : ''}>Perempuan</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Pekerjaan</label>
                <input type="text" class="fm-occupation" placeholder="Occupation" value="${data.occupation || ''}">
            </div>
            <div class="form-group">
                <label>Pendapatan (RM)</label>
                <input type="number" class="fm-income" placeholder="Income" value="${data.income || ''}">
            </div>
            <div class="form-group">
                <label>Hubungan</label>
                <input type="text" class="fm-relationship" placeholder="e.g. Isteri, Anak" value="${data.relationship || ''}">
            </div>
            <div class="form-group">
                <label>No. Telefon</label>
                <input type="tel" class="fm-phone" placeholder="Phone" value="${data.phone || ''}">
            </div>
            <div class="form-group">
                <label>OKU</label>
                <div class="select-wrapper">
                    <select class="fm-oku">
                        <option value="Tidak" ${(!data.oku || data.oku === 'Tidak') ? 'selected' : ''}>Tidak</option>
                        <option value="Ya" ${data.oku === 'Ya' ? 'selected' : ''}>Ya</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Jenis OKU</label>
                <input type="text" class="fm-oku-type" placeholder="If applicable" value="${data.okuType || ''}">
            </div>
        </div>
    `;
    familyContainer.appendChild(card);
    lucide.createIcons();
}

/** Collect all family member data from the form cards */
function collectFamilyMembers() {
    const cards = familyContainer.querySelectorAll('.family-member-card');
    const members = [];
    cards.forEach(card => {
        const name = card.querySelector('.fm-name').value.trim();
        if (name) {
            members.push({
                name: name,
                ic: card.querySelector('.fm-ic').value.trim(),
                age: parseInt(card.querySelector('.fm-age').value) || 0,
                gender: card.querySelector('.fm-gender').value,
                occupation: card.querySelector('.fm-occupation').value.trim(),
                income: parseFloat(card.querySelector('.fm-income').value) || 0,
                relationship: card.querySelector('.fm-relationship').value.trim(),
                phone: card.querySelector('.fm-phone').value.trim(),
                oku: card.querySelector('.fm-oku').value,
                okuType: card.querySelector('.fm-oku-type').value.trim()
            });
        }
    });
    return members;
}

if (addFamilyBtn) addFamilyBtn.addEventListener('click', () => addFamilyMemberCard());

// ============ FORM SUBMIT ============

if (modalForm) modalForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const familyMembers = collectFamilyMembers();

    const data = {
        name: fName.value.trim(),
        ic: fIc.value.trim(),
        age: parseInt(fAge.value) || 0,
        gender: fGender.value,
        maritalStatus: fMarital.value,
        occupation: fOccupation.value.trim(),
        income: parseFloat(fIncome.value) || 0,
        address: fAddress.value.trim(),
        phone: fPhone.value.trim(),
        oku: fOku.value,
        okuType: fOku.value === 'Ya' ? fOkuType.value.trim() : '',
        dependents: familyMembers.length,
        familyMembers: familyMembers
    };

    if (!data.name || !data.ic) {
        alert('Sila isi sekurang-kurangnya Nama dan MyKad.\n(Please fill in at least Name and MyKad.)');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = editingDocId ? 'Mengemaskini...' : 'Menyimpan...';

    try {
        if (editingDocId) {
            await updateDoc(doc(db, "residents", editingDocId), data);
        } else {
            data.createdAt = new Date().toISOString();
            await addDoc(residentsRef, data);
        }
        closeAddModal();
    } catch (error) {
        console.error('Firestore error:', error);
        alert('Ralat menyimpan data. Sila cuba lagi.\n(Error saving data. Please try again.)');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = editingDocId ? 'Kemaskini (Update)' : 'Simpan (Save)';
    }
});

// ============ VIEW MODAL ============

function openViewModal(r) {
    const householdIncome = getHouseholdIncome(r);
    const cat = classifyIncome(householdIncome);
    vSub.textContent = 'Maklumat lengkap untuk ' + r.name;
    vName.textContent = r.name;
    vIc.textContent = r.ic;
    vAge.textContent = r.age || '-';
    vGender.textContent = normalizeGender(r.gender) || 'Tidak dinyatakan';
    vMarital.textContent = r.maritalStatus || 'Tidak dinyatakan';
    vOccupation.textContent = r.occupation || 'Tidak dinyatakan';

    // Show individual + total household income
    if (householdIncome !== (parseFloat(r.income) || 0)) {
        vIncome.innerHTML = `RM ${formatNumber(r.income)} <span style="color:#64748b; font-weight:400; font-size:0.85rem;">(individu)</span><br><strong style="color:#166534;">RM ${formatNumber(householdIncome)}</strong> <span style="color:#166534; font-size:0.85rem;">(jumlah isi rumah)</span>`;
    } else {
        vIncome.textContent = 'RM ' + formatNumber(r.income);
    }

    vDep.textContent = r.dependents || 0;
    vCat.innerHTML = `<span class="badge ${badgeClass(cat)}">${cat}</span>`;

    const eligibility = evaluateEligibility(r);
    vPriority.innerHTML = eligibility.priority !== 'None'
        ? `<span style="background-color: ${eligibility.bg}; color: ${eligibility.color}; padding: 0.25rem 0.65rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600;">${eligibility.priority} Priority (${eligibility.status})</span>`
        : `<span style="background-color: #f1f5f9; color: #64748b; padding: 0.25rem 0.65rem; border-radius: 4px; font-size: 0.8rem; font-weight: 500;">Stable Economic Status</span>`;

    vPhone.textContent = r.phone || 'Tidak dinyatakan';
    vAddress.textContent = r.address || 'Tidak dinyatakan';

    // OKU status
    vOku.textContent = r.oku === 'Ya' ? '✅ Ya (OKU)' : 'Tidak';
    vOkuType.textContent = r.okuType || '-';

    // Calculate vulnerability flags
    let okuCount = (r.oku === 'Ya') ? 1 : 0;
    let elderlyCount = (r.age >= 60) ? 1 : 0;
    let elderlyNames = (r.age >= 60) ? [r.name] : [];
    let okuNames = (r.oku === 'Ya') ? [r.name] : [];

    if (r.familyMembers && r.familyMembers.length > 0) {
        r.familyMembers.forEach(m => {
            if (m.oku === 'Ya') { okuCount++; okuNames.push(m.name); }
            if (m.age >= 60) { elderlyCount++; elderlyNames.push(m.name); }
        });
    }

    // Vulnerability banner
    const flags = [];
    if (okuCount > 0) flags.push(`<span style="display:inline-flex;align-items:center;gap:4px;">♿ <strong>${okuCount} OKU</strong> — ${okuNames.join(', ')}</span>`);
    if (elderlyCount > 0) flags.push(`<span style="display:inline-flex;align-items:center;gap:4px;">👴 <strong>${elderlyCount} Warga Emas (60+)</strong> — ${elderlyNames.join(', ')}</span>`);

    if (flags.length > 0) {
        vVulnerabilityBanner.style.display = 'block';
        vVulnerabilityBanner.innerHTML = `
            <div style="background: linear-gradient(135deg, #fef3c7, #fef9c3); border: 1px solid #fcd34d; border-radius: 8px; padding: 0.75rem 1rem;">
                <div style="font-weight: 600; font-size: 0.85rem; color: #92400e; margin-bottom: 0.35rem;">
                    ⚠️ Kerentanan Isi Rumah (Household Vulnerability)
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.82rem; color: #78350f;">
                    ${flags.join('')}
                </div>
            </div>
        `;
    } else {
        vVulnerabilityBanner.style.display = 'none';
    }

    // Render family members table
    if (r.familyMembers && r.familyMembers.length > 0) {
        let tableHTML = `<table class="fm-view-table">
            <thead><tr>
                <th>Bil.</th><th>Nama</th><th>Umur</th>
                <th>Jantina</th><th>Hubungan</th><th>Pekerjaan</th><th>OKU</th>
            </tr></thead><tbody>`;
        r.familyMembers.forEach((m, i) => {
            const isElderly = m.age >= 60;
            const isOku = m.oku === 'Ya';
            const rowStyle = (isElderly || isOku) ? 'background: #fffbeb;' : '';
            tableHTML += `<tr style="${rowStyle}">
                <td>${i + 1}</td>
                <td style="font-weight:500;">${m.name}${isElderly ? ' 👴' : ''}${isOku ? ' ♿' : ''}</td>
                <td>${m.age || '-'}</td>
                <td>${m.gender || '-'}</td>
                <td>${m.relationship || '-'}</td>
                <td>${m.occupation || '-'}</td>
                <td>${isOku ? '✅ Ya' + (m.okuType ? ' (' + m.okuType + ')' : '') : 'Tidak'}</td>
            </tr>`;
        });
        tableHTML += '</tbody></table>';
        vFamilyMembers.innerHTML = tableHTML;
    } else {
        vFamilyMembers.innerHTML = '<p style="color: #94a3b8; font-size: 0.85rem;">Tiada ahli keluarga direkodkan. (No family members recorded.)</p>';
    }

    viewModal.classList.add('active');
}

function closeViewModal() {
    viewModal.classList.remove('active');
}

// ============ DELETE ============

async function deleteResident(id) {
    if (!confirm('Are you sure you want to delete this resident? This action cannot be undone.')) return;
    try {
        await deleteDoc(doc(db, "residents", id));
    } catch (error) {
        console.error('Delete error:', error);
        alert('Error deleting resident.');
    }
}

// ============ ROW EVENT LISTENERS ============

function attachRowListeners() {
    // View
    document.querySelectorAll('.view-resident-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const r = allResidents.find(res => res.id === id);
            if (r) openViewModal(r);
        });
    });

    // Edit
    document.querySelectorAll('.edit-resident-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const r = allResidents.find(res => res.id === id);
            if (r) openEditModal(r);
        });
    });

    // Delete
    document.querySelectorAll('.delete-resident-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            deleteResident(id);
        });
    });
}

// ============ BUTTON WIRING ============

if (openAddBtn) openAddBtn.addEventListener('click', openAddModal);
if (closeAddBtn) closeAddBtn.addEventListener('click', closeAddModal);
if (cancelAddBtn) cancelAddBtn.addEventListener('click', closeAddModal);
if (closeViewBtn) closeViewBtn.addEventListener('click', closeViewModal);

window.addEventListener('click', (e) => {
    if (addModal && e.target === addModal) closeAddModal();
    if (viewModal && e.target === viewModal) closeViewModal();
});

// ============ EXCEL IMPORT ============

const importBtn = document.getElementById('importBtn');
const importFileInput = document.getElementById('importFileInput');

if (importBtn) importBtn.addEventListener('click', () => importFileInput.click());

if (importFileInput) importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    importBtn.disabled = true;
    importBtn.innerHTML = '<i data-lucide="loader"></i> Importing...';

    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });

        // Detect format:
        // 1) Household-linked (Household Summary + All Members sheets, e.g. KOLONG census export)
        // 2) Census (multi-sheet, each sheet = 1 household)
        // 3) Standard flat table
        const isHouseholdLinkedFormat = detectHouseholdLinkedFormat(workbook);
        const isCensusFormat = !isHouseholdLinkedFormat && detectCensusFormat(workbook);

        let imported = 0;
        let skipped = 0;
        let formatLabel = 'Standard Table';

        if (isHouseholdLinkedFormat) {
            // ===== HOUSEHOLD SUMMARY + ALL MEMBERS (LINKED) FORMAT =====
            // "Household Summary" = 1 row per household (ketua keluarga + totals)
            // "All Members" = every individual, flagged via "Ketua Isi Rumah" Ya/Tidak
            formatLabel = 'Household Summary + All Members (Linked)';

            for (const resident of extractHouseholdLinkedResidents(workbook)) {
                await addDoc(residentsRef, resident);
                imported++;
            }
        } else if (isCensusFormat) {
            // ===== BANCI PENDUDUK KAMPUNG FORMAT =====
            // Each sheet tab = one household (KARIM, NASLAN, etc.)
            formatLabel = 'Banci Penduduk Kampung (Census)';
            const skipSheets = ['sheet', 'summary', 'kir', 'template', 'blank'];

            for (const sheetName of workbook.SheetNames) {
                if (skipSheets.includes(sheetName.toLowerCase().trim())) continue;

                const sheet = workbook.Sheets[sheetName];
                const resident = extractCensusHousehold(sheet, sheetName);

                if (resident && resident.name) {
                    await addDoc(residentsRef, resident);
                    imported++;
                } else {
                    skipped++;
                }
            }
        } else {
            // ===== STANDARD FLAT TABLE FORMAT =====
            // Iterate over all sheets in case data is split across multiple tabs
            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];

                // Convert to array of arrays to find the header row dynamically
                const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                if (rawData.length === 0) {
                    skipped++;
                    continue;
                }

                // Find the row that contains 'Nama Penuh', 'Nama', or 'Name'
                let headerRowIndex = 0;
                let foundHeader = false;
                for (let i = 0; i < Math.min(10, rawData.length); i++) {
                    const rowStr = rawData[i].map(c => String(c || '')).join(' ').toLowerCase();
                    if (rowStr.includes('nama') || rowStr.includes('name')) {
                        headerRowIndex = i;
                        foundHeader = true;
                        break;
                    }
                }

                // If no identifiable header is found, skip this sheet
                if (!foundHeader) {
                    skipped++;
                    continue;
                }

                // Parse with the correct header row
                const rows = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex });

                for (const row of rows) {
                    const resident = mapFlatRow(row);
                    if (resident.name && resident.name !== 'undefined' && resident.name.trim() !== '') {
                        await addDoc(residentsRef, resident);
                        imported++;
                    }
                }
            }

            if (imported === 0) {
                alert('No valid residents found. Please check the Excel format.');
                return;
            }
        }

        alert(`Import complete!\n✅ ${imported} residents imported successfully\n⚠️ ${skipped} sheets/rows skipped\n\nFormat detected: ${formatLabel}`);

    } catch (error) {
        console.error('Import error:', error);
        alert('Error importing file: ' + error.message);
    } finally {
        importBtn.disabled = false;
        importBtn.innerHTML = '<i data-lucide="download"></i> Import';
        lucide.createIcons();
        importFileInput.value = '';
    }
});

/**
 * Detect the "Household Summary" + "All Members" linked dataset format
 * (e.g. KOLONG 2 census export). One sheet has one row per household
 * (the ketua keluarga + totals), the other lists every individual with
 * a "Ketua Isi Rumah" Ya/Tidak flag, linked via "Household ID".
 */
function detectHouseholdLinkedFormat(workbook) {
    const names = workbook.SheetNames.map(n => n.trim().toLowerCase());
    return names.includes('household summary') && names.includes('all members');
}

/**
 * Build one resident record per household: the ketua keluarga's details
 * come from "Household Summary", and every "All Members" row for that
 * household where "Ketua Isi Rumah" is not "Ya" becomes a familyMembers entry.
 */
function extractHouseholdLinkedResidents(workbook) {
    const summarySheetName = workbook.SheetNames.find(n => n.trim().toLowerCase() === 'household summary');
    const membersSheetName = workbook.SheetNames.find(n => n.trim().toLowerCase() === 'all members');

    const summaryRows = XLSX.utils.sheet_to_json(workbook.Sheets[summarySheetName]);
    const memberRows = XLSX.utils.sheet_to_json(workbook.Sheets[membersSheetName]);

    // Group dependents (everyone except the ketua) by Household ID.
    // Each row holds either a "Nama Ketua" (the household head — already
    // covered by Household Summary, so skipped here) or a "Nama Ahli"
    // (a dependent, added to familyMembers below).
    const dependentsByHousehold = {};
    memberRows.forEach(row => {
        const hhId = row['Household ID'];
        if (!hhId) return;

        const ahliName = String(row['Nama Ahli'] || '').trim();
        if (!ahliName) return; // this row is the ketua's own entry

        if (!dependentsByHousehold[hhId]) dependentsByHousehold[hhId] = [];
        dependentsByHousehold[hhId].push({
            name: ahliName,
            ic: String(row['No. Kad Pengenalan'] || '').replace(/\s/g, ''),
            age: parseInt(row['Umur']) || 0,
            gender: normalizeGender(row['Jantina']),
            occupation: '',
            income: 0,
            relationship: '',
            phone: '',
            oku: 'Tidak',
            okuType: ''
        });
    });

    // Household-level "Status OKU" gets attached to the ketua's record so
    // evaluateEligibility() picks it up as a household OKU flag, even though
    // the source data doesn't say which member specifically has the OKU status.
    return summaryRows
        .map(row => {
            const hhId = row['Household ID'];
            const familyMembers = dependentsByHousehold[hhId] || [];

            return {
                name: String(row['Nama Ketua Isi Rumah'] || '').trim(),
                ic: String(row['No. Kad Pengenalan'] || '').replace(/\s/g, ''),
                age: parseInt(row['Umur Ketua']) || 0,
                gender: normalizeGender(row['Jantina Ketua']),
                maritalStatus: String(row['Status Perkahwinan'] || '').trim(),
                occupation: String(row['Pekerjaan'] || '').trim(),
                income: parseFloat(row['Pendapatan Bulanan (RM)']) || 0,
                address: String(row['Alamat'] || '').trim(),
                phone: '',
                oku: String(row['Status OKU'] || '').trim().toLowerCase() === 'ya' ? 'Ya' : 'Tidak',
                okuType: '',
                dependents: familyMembers.length,
                familyMembers: familyMembers,
                createdAt: new Date().toISOString()
            };
        })
        .filter(r => r.name);
}

/**
 * Detect if the workbook is a Banci Penduduk Kampung census format.
 * Checks for: multiple household sheets, or "BANCI" text in first sheet.
 */
function detectCensusFormat(workbook) {
    // Check first sheet for census keywords exclusively (do not rely on sheet count)
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const cellsToCheck = ['A6', 'B6', 'C6', 'A7', 'B7', 'A8', 'B8'];
    for (const cellRef of cellsToCheck) {
        const cell = firstSheet[cellRef];
        if (cell && typeof cell.v === 'string') {
            const val = cell.v.toLowerCase();
            if (val.includes('banci') || (val.includes('penduduk') && !val.includes('senarai')) || val.includes('ketua isi rumah')) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Extract household data from a single census sheet.
 * Layout based on Banci Penduduk Kampung format:
 * - Row 10: Headers (Nama, Mykad, Umur, Status, Pekerjaan, Pendapatan, No.Telefon)
 * - Row 11: Head of household data
 * - Row 12: Address
 * - Row 15: Family members header
 * - Row 16+: Family members data
 */
function extractCensusHousehold(sheet, sheetName) {
    // Helper to read a cell value safely
    const getCell = (ref) => {
        const cell = sheet[ref];
        return cell ? cell.v : '';
    };

    // Try reading head of household from row 11 (0-indexed in some cases)
    // The format has headers in row 10, data in row 11
    // Columns: B=Nama, C=Mykad, D=Umur, E=Status, F=Pekerjaan, G=Pendapatan, H=No.Telefon

    let name = '', ic = '', age = 0, income = 0, phone = '', address = '', gender = '';

    // Try multiple row positions since formatting may vary
    for (const row of [11, 12, 10]) {
        const testName = getCell(`B${row}`);
        if (testName && typeof testName === 'string' && testName.length > 1 &&
            !testName.toLowerCase().includes('nama') && !testName.toLowerCase().includes('butiran')) {
            name = String(testName).trim();
            ic = String(getCell(`C${row}`) || '').trim();
            age = parseInt(getCell(`D${row}`)) || 0;
            income = parseFloat(String(getCell(`G${row}`) || '0').replace(/[^0-9.]/g, '')) || 0;
            phone = String(getCell(`H${row}`) || '').trim();
            break;
        }
    }

    // If no name found from cells, use the sheet tab name as fallback
    if (!name) {
        name = sheetName.trim();
    }

    // Try to read address from row 12/13
    for (const row of [12, 13]) {
        const addrLabel = String(getCell(`A${row}`) || getCell(`B${row}`) || '').toLowerCase();
        if (addrLabel.includes('alamat')) {
            address = String(getCell(`C${row}`) || getCell(`D${row}`) || '').trim();
            break;
        }
        // Also try if address is directly in the cell
        const directAddr = String(getCell(`C${row}`) || '').trim();
        if (directAddr.length > 5 && !directAddr.toLowerCase().includes('butiran')) {
            address = directAddr;
            break;
        }
    }

    // Count dependents from family members section (rows 16+)
    let dependents = 0;
    let totalFamilyIncome = 0;
    for (let row = 16; row <= 40; row++) {
        const memberName = getCell(`B${row}`);
        if (memberName && typeof memberName === 'string' && memberName.trim().length > 1) {
            dependents++;
            // Try to read family member's income and add to household total
            const memIncome = parseFloat(String(getCell(`H${row}`) || '0').replace(/[^0-9.]/g, '')) || 0;
            totalFamilyIncome += memIncome;

            // Try to detect gender from Jantina column
            if (!gender) {
                const jantina = String(getCell(`E${row}`) || '').toLowerCase().trim();
                // Use head of household's implied gender from family context
            }
        } else {
            // Stop at first empty row
            if (row > 17) break;
        }
    }

    // Total household income = head's income + family members' income
    const totalIncome = income + totalFamilyIncome;

    if (!name || name === 'undefined') return null;

    return {
        name: name,
        ic: String(ic).replace(/\s/g, ''),
        age: age,
        gender: gender || '',
        income: totalIncome > 0 ? totalIncome : income,
        dependents: dependents,
        address: address,
        phone: String(phone).replace(/\s/g, ''),
        createdAt: new Date().toISOString()
    };
}

/**
 * Map a flat table row (standard Excel format) to a resident object.
 * Uses fuzzy/partial header matching so minor column name variations still work.
 */
function mapFlatRow(row) {
    // Normalise all keys once for fast lookup
    const normalisedRow = {};
    Object.keys(row).forEach(k => {
        normalisedRow[k.toLowerCase().replace(/\s+/g, ' ').trim()] = row[k];
    });

    // Flexible getter — tries each alias, also does partial matching as fallback
    const get = (...aliases) => {
        for (const alias of aliases) {
            const key = alias.toLowerCase().trim();
            if (normalisedRow[key] !== undefined && normalisedRow[key] !== '') {
                return normalisedRow[key];
            }
        }
        // Fallback: partial match (column header contains alias or alias contains header)
        for (const alias of aliases) {
            const key = alias.toLowerCase().trim();
            const found = Object.keys(normalisedRow).find(h =>
                h.includes(key) || key.includes(h)
            );
            if (found && normalisedRow[found] !== undefined && normalisedRow[found] !== '') {
                return normalisedRow[found];
            }
        }
        return '';
    };

    // ── Gender normalisation ──────────────────────────────────────
    const rawGender = String(get('jantina', 'gender', 'sex') || '').trim();
    let gender = rawGender;
    if (/^l/i.test(rawGender)) gender = 'Lelaki';
    else if (/^p|^f|^w/i.test(rawGender)) gender = 'Perempuan';

    // ── OKU normalisation ─────────────────────────────────────────
    const rawOku = String(get('status oku', 'oku', 'oku status', 'disabled') || '').trim();
    const oku = /^y|^1|^true|^ya/i.test(rawOku) ? 'Ya' : 'Tidak';

    // ── Marital status normalisation ──────────────────────────────
    const rawMarital = String(get('status perkahwinan', 'marital status', 'maritalstatus', 'status kahwin', 'kahwin') || '').trim();

    // ── Occupation ────────────────────────────────────────────────
    const rawOccupation = String(get('pekerjaan', 'occupation', 'job', 'profession', 'kerja', 'career') || '').trim();

    // ── Income ────────────────────────────────────────────────────
    const rawIncome = String(get(
        'pendapatan sebulan (rm)', 'pendapatan sebulan', 'pendapatan',
        'income (rm)', 'income(rm)', 'monthly income', 'income',
        'household income'
    ) || '0');
    const income = parseFloat(rawIncome.replace(/[^0-9.]/g, '')) || 0;

    return {
        name:          String(get('nama penuh', 'nama', 'name', 'full name', 'fullname', 'resident name', 'head of household')),
        ic:            String(get('no. kad pengenalan', 'no kad pengenalan', 'kad pengenalan', 'no. ic', 'no ic', 'ic number', 'ic', 'nric', 'mykad')),
        age:           parseInt(get('umur', 'age')) || 0,
        gender:        gender,
        maritalStatus: rawMarital,
        occupation:    rawOccupation,
        income:        income,
        dependents:    parseInt(get('tanggungan', 'dependents', 'number of dependents', 'no of dependents', 'isi rumah')) || 0,
        address:       String(get('alamat rumah', 'alamat', 'address', 'home address', 'alamat kediaman') || ''),
        phone:         String(get('no. telefon', 'no telefon', 'telefon', 'phone', 'phone number', 'contact', 'mobile') || ''),
        oku:           oku,
        okuType:       String(get('jenis oku', 'oku type', 'okutype', 'disability type') || ''),
        familyMembers: [],
        createdAt:     new Date().toISOString()
    };
}


// ============ EXCEL EXPORT ============

const exportBtn = document.getElementById('exportBtn');

exportBtn.addEventListener('click', () => {
    if (allResidents.length === 0) {
        alert('No residents to export.');
        return;
    }

    // Prepare data for export
    const exportData = allResidents.map(r => ({
        'Name': r.name,
        'IC Number': r.ic,
        'Age': r.age,
        'Gender': r.gender ? r.gender.charAt(0).toUpperCase() + r.gender.slice(1) : '',
        'Income (RM)': r.income,
        'Dependents': r.dependents,
        'Category': classifyIncome(r.income),
        'Priority': evaluateEligibility(r).priority,
        'Address': r.address || '',
        'Phone': r.phone || ''
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Residents');

    // Auto-fit column widths
    const colWidths = Object.keys(exportData[0]).map(key => ({
        wch: Math.max(key.length, ...exportData.map(r => String(r[key]).length)) + 2
    }));
    ws['!cols'] = colWidths;

    XLSX.writeFile(wb, 'MyKolong2_Residents_' + new Date().toISOString().slice(0, 10) + '.xlsx');
});
