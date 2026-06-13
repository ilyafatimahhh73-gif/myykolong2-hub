import {
    collection, getDocs, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { createPaginator } from "./pagination.js";

const inventoryRef = collection(db, "welfare_inventory");

export function initInventory() {
    const tbody = document.querySelector('.data-table tbody');
    const kpiTotal = document.getElementById('kpi-total-items');
    const kpiLowStock = document.getElementById('kpi-low-stock');
    
    const modal = document.getElementById('inventoryModal');
    const openModalBtn = document.getElementById('openAddModalBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const form = document.getElementById('inventoryForm');
    const modalTitle = document.getElementById('modalTitle');
    
    // Form fields
    const fName = document.getElementById('fName');
    const fType = document.getElementById('fType');
    const fEligibility = document.getElementById('fEligibility');
    const fQuantity = document.getElementById('fQuantity');

    let editingId = null;

    // Pagination
    const inventoryPaginator = createPaginator({
        controlsEl: document.getElementById('inventoryPagination'),
        renderFn: renderTable,
        itemLabel: 'items'
    });

    // Listen to database
    const q = query(inventoryRef, orderBy("name", "asc"));
    onSnapshot(q, (snapshot) => {
        const items = [];
        snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        inventoryPaginator.update(items);
        updateKPIs(items);
    });

    function renderTable(items) {
        tbody.innerHTML = '';
        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 2rem;">No inventory items found.</td></tr>`;
            return;
        }

        items.forEach(item => {
            const tr = document.createElement('tr');
            
            // Status logic
            let statusBadge = '';
            let isLowStock = false;
            if (item.quantity <= 0) {
                statusBadge = `<span class="badge badge-b40">Out of Stock</span>`;
                isLowStock = true;
            } else if (item.quantity <= 10) {
                statusBadge = `<span class="badge badge-m40">Low Stock</span>`;
                isLowStock = true;
            } else {
                statusBadge = `<span class="badge badge-outline eligible">Available</span>`;
            }

            const rowStyle = isLowStock ? 'background-color: #fff1f2;' : '';

            tr.innerHTML = `
                <td class="font-medium">${item.name}</td>
                <td>${item.type}</td>
                <td><span class="badge" style="background: #e2e8f0; color: #334155;">${item.eligibility}</span></td>
                <td style="font-weight: 600; ${isLowStock ? 'color: #e11d48;' : ''}">${item.quantity}</td>
                <td>${statusBadge}</td>
                <td class="table-actions-cell">
                    <button class="icon-btn edit-btn" data-id="${item.id}" title="Edit"><i data-lucide="edit"></i></button>
                    <button class="icon-btn text-red delete-btn" data-id="${item.id}" title="Delete"><i data-lucide="trash-2"></i></button>
                </td>
            `;
            
            // Attach Events
            tr.querySelector('.edit-btn').addEventListener('click', () => openModal(item));
            tr.querySelector('.delete-btn').addEventListener('click', () => deleteItem(item.id, item.name));

            tbody.appendChild(tr);
        });

        // Re-init icons for new buttons
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function updateKPIs(items) {
        kpiTotal.textContent = items.length;
        const lowStockCount = items.filter(i => i.quantity <= 10).length;
        kpiLowStock.textContent = lowStockCount;
    }

    // Modal Logic
    function openModal(item = null) {
        if (item) {
            editingId = item.id;
            modalTitle.textContent = "Edit Aid Item";
            fName.value = item.name;
            fType.value = item.type;
            fEligibility.value = item.eligibility;
            fQuantity.value = item.quantity;
        } else {
            editingId = null;
            modalTitle.textContent = "Add Aid Item";
            form.reset();
        }
        modal.classList.add('active');
    }

    function closeModal() {
        modal.classList.remove('active');
        form.reset();
        editingId = null;
    }

    openModalBtn.addEventListener('click', () => openModal());
    closeModalBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = document.getElementById('saveBtn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        const data = {
            name: fName.value.trim(),
            type: fType.value,
            eligibility: fEligibility.value,
            quantity: parseInt(fQuantity.value) || 0,
            dateUpdated: new Date().toISOString()
        };

        try {
            if (editingId) {
                await updateDoc(doc(db, "welfare_inventory", editingId), data);
            } else {
                data.dateAdded = new Date().toISOString();
                await addDoc(inventoryRef, data);
            }
            closeModal();
        } catch (error) {
            console.error("Error saving inventory item:", error);
            alert("Failed to save item: " + error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Item';
        }
    });

    async function deleteItem(id, name) {
        if (confirm(`Are you sure you want to delete "${name}" from the inventory?`)) {
            try {
                await deleteDoc(doc(db, "welfare_inventory", id));
            } catch (error) {
                console.error("Error deleting item:", error);
                alert("Failed to delete item: " + error.message);
            }
        }
    }
}
