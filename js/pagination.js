// Reusable "load more" pagination controller for client-side rendered tables/lists.
// Shows a configurable page size (default 25) with a dropdown to switch to
// 50 / 100 / 150 / All, plus a "Load More" button to extend the current view.

const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_PAGE_SIZE_OPTIONS = [25, 50, 100, 150];

/**
 * @param {Object} opts
 * @param {HTMLElement|null} opts.controlsEl - element to render the pagination bar into
 * @param {(visibleItems: any[]) => void} opts.renderFn - renders the visible slice of items
 * @param {string} [opts.itemLabel] - label used in "Showing X of Y <itemLabel>"
 * @param {number} [opts.pageSize] - default page size / load-more increment
 * @param {number[]} [opts.pageSizeOptions] - selectable page sizes
 */
export function createPaginator({ controlsEl, renderFn, itemLabel = 'entries', pageSize = DEFAULT_PAGE_SIZE, pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS }) {
    let items = [];
    let pageSizeValue = pageSize; // number or 'all'
    let limit = pageSize;

    function renderControls() {
        if (!controlsEl) return;

        const total = items.length;
        if (total === 0) {
            controlsEl.innerHTML = '';
            return;
        }

        const shown = Math.min(limit, total);
        const hasMore = shown < total;

        controlsEl.innerHTML = `
            <div class="pagination-bar">
                <span class="pagination-info">Showing ${shown} of ${total} ${itemLabel}</span>
                <div class="pagination-actions">
                    <label class="pagination-size">
                        Show
                        <select class="pagination-size-select">
                            ${pageSizeOptions.map(n => `<option value="${n}" ${pageSizeValue === n ? 'selected' : ''}>${n}</option>`).join('')}
                            <option value="all" ${pageSizeValue === 'all' ? 'selected' : ''}>All</option>
                        </select>
                    </label>
                    ${hasMore ? `<button type="button" class="btn btn-outline btn-sm pagination-load-more">Load More</button>` : ''}
                </div>
            </div>
        `;

        controlsEl.querySelector('.pagination-size-select').addEventListener('change', (e) => {
            const val = e.target.value;
            pageSizeValue = val === 'all' ? 'all' : parseInt(val, 10);
            limit = pageSizeValue === 'all' ? items.length : pageSizeValue;
            renderAll();
        });

        const loadMoreBtn = controlsEl.querySelector('.pagination-load-more');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => {
                const step = (typeof pageSizeValue === 'number') ? pageSizeValue : pageSize;
                limit += step;
                renderAll();
            });
        }
    }

    function renderAll() {
        renderFn(items.slice(0, limit));
        renderControls();
    }

    return {
        /**
         * Update the full dataset and re-render.
         * @param {any[]} newItems
         * @param {Object} [options]
         * @param {boolean} [options.resetLimit] - reset back to the default page size (e.g. on filter change)
         */
        update(newItems, { resetLimit = false } = {}) {
            items = newItems || [];
            if (resetLimit) {
                pageSizeValue = pageSize;
                limit = pageSize;
            } else if (pageSizeValue === 'all') {
                limit = items.length;
            }
            renderAll();
        }
    };
}
