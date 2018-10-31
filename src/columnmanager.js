import $ from './dom';
import Sortable from 'sortablejs';
import {
    linkProperties,
    debounce
} from './utils';

export default class ColumnManager {
    constructor(instance) {
        this.instance = instance;

        linkProperties(this, this.instance, [
            'options',
            'fireEvent',
            'header',
            'datamanager',
            'style',
            'wrapper',
            'rowmanager',
            'bodyScrollable',
            'bodyRenderer'
        ]);

        this.bindEvents();
    }

    renderHeader() {
        this.header.innerHTML = '<div></div>';
        this.refreshHeader();
    }

    refreshHeader() {
        const columns = this.datamanager.getColumns();

        // refresh html
        $('div', this.header).innerHTML = this.getHeaderHTML(columns);

        this.$filterRow = $('.dt-row-filter', this.header);
        if (this.$filterRow) {
            $.style(this.$filterRow, { display: 'none' });
        }
        // reset columnMap
        this.$columnMap = [];
        this.bindMoveColumn();
    }

    getHeaderHTML(columns) {
        let html = this.rowmanager.getRowHTML(columns, {
            isHeader: 1
        });
        if (this.options.inlineFilters) {
            html += this.rowmanager.getRowHTML(columns, {
                isFilter: 1
            });
        }
        return html;
    }

    bindEvents() {
        this.bindDropdown();
        this.bindResizeColumn();
        this.bindFilter();
    }

    bindDropdown() {
        let $activeDropdown;
        let activeClass = 'dt-dropdown--active';
        let toggleClass = '.dt-dropdown__toggle';

        $.on(this.header, 'click', toggleClass, (e, $button) => {
            const $dropdown = $.closest('.dt-dropdown', $button);

            if (!$dropdown.classList.contains(activeClass)) {
                deactivateDropdown();
                $dropdown.classList.add(activeClass);
                $activeDropdown = $dropdown;
            } else {
                deactivateDropdown();
            }
        });

        const deactivateDropdownOnBodyClick = (e) => {
            const selector = [toggleClass, toggleClass + ' *'].join(',');
            if (e.target.matches(selector)) return;
            deactivateDropdown();
        };
        $.on(document.body, 'click', deactivateDropdownOnBodyClick);
        this.instance.on('onDestroy', () => {
            $.off(document.body, 'click', deactivateDropdownOnBodyClick);
        });

        const dropdownItems = this.options.headerDropdown;

        $.on(this.header, 'click', '.dt-dropdown__list-item', (e, $item) => {
            const $col = $.closest('.dt-cell', $item);
            const {
                index
            } = $.data($item);
            const {
                colIndex
            } = $.data($col);
            let callback = dropdownItems[index].action;

            callback && callback.call(this.instance, this.getColumn(colIndex));
        });

        function deactivateDropdown(e) {
            $activeDropdown && $activeDropdown.classList.remove(activeClass);
            $activeDropdown = null;
        }
    }

    bindResizeColumn() {
        let isDragging = false;
        let $resizingCell, startWidth, startX;

        $.on(this.header, 'mousedown', '.dt-cell .dt-cell__resize-handle', (e, $handle) => {
            document.body.classList.add('dt-resize');
            const $cell = $handle.parentNode.parentNode;
            $resizingCell = $cell;
            const {
                colIndex
            } = $.data($resizingCell);
            const col = this.getColumn(colIndex);

            if (col && col.resizable === false) {
                return;
            }

            isDragging = true;
            startWidth = $.style($('.dt-cell__content', $resizingCell), 'width');
            startX = e.pageX;
        });

        const onMouseup = (e) => {
            document.body.classList.remove('dt-resize');
            if (!$resizingCell) return;
            isDragging = false;

            const {
                colIndex
            } = $.data($resizingCell);
            this.setColumnWidth(colIndex);
            this.style.setBodyStyle();
            $resizingCell = null;
        };
        $.on(document.body, 'mouseup', onMouseup);
        this.instance.on('onDestroy', () => {
            $.off(document.body, 'mouseup', onMouseup);
        });

        const onMouseMove = (e) => {
            if (!isDragging) return;
            const finalWidth = startWidth + (e.pageX - startX);
            const {
                colIndex
            } = $.data($resizingCell);

            if (this.getColumnMinWidth(colIndex) > finalWidth) {
                // don't resize past minWidth
                return;
            }
            this.datamanager.updateColumn(colIndex, {
                width: finalWidth
            });
            this.setColumnHeaderWidth(colIndex);
        };
        $.on(document.body, 'mousemove', onMouseMove);
        this.instance.on('onDestroy', () => {
            $.off(document.body, 'mousemove', onMouseMove);
        });
    }

    bindMoveColumn() {
        const $parent = $('.dt-row', this.header);

        this.sortable = Sortable.create($parent, {
            onEnd: (e) => {
                const {
                    oldIndex,
                    newIndex
                } = e;
                const $draggedCell = e.item;
                const {
                    colIndex
                } = $.data($draggedCell);
                if (+colIndex === newIndex) return;

                this.switchColumn(oldIndex, newIndex);
            },
            preventOnFilter: false,
            filter: '.dt-cell__resize-handle, .dt-dropdown',
            chosenClass: 'dt-cell--dragging',
            animation: 150
        });
    }

    sortColumn(colIndex, nextSortOrder) {
        this.instance.freeze();
        this.sortRows(colIndex, nextSortOrder)
            .then(() => {
                this.refreshHeader();
                return this.rowmanager.refreshRows();
            })
            .then(() => this.instance.unfreeze())
            .then(() => {
                this.fireEvent('onSortColumn', this.getColumn(colIndex));
            });
    }

    removeColumn(colIndex) {
        const removedCol = this.getColumn(colIndex);
        this.instance.freeze();
        this.datamanager.removeColumn(colIndex)
            .then(() => {
                this.refreshHeader();
                return this.rowmanager.refreshRows();
            })
            .then(() => this.instance.unfreeze())
            .then(() => {
                this.fireEvent('onRemoveColumn', removedCol);
            });
    }

    switchColumn(oldIndex, newIndex) {
        this.instance.freeze();
        this.datamanager.switchColumn(oldIndex, newIndex)
            .then(() => {
                this.refreshHeader();
                return this.rowmanager.refreshRows();
            })
            .then(() => {
                this.setColumnWidth(oldIndex);
                this.setColumnWidth(newIndex);
                this.instance.unfreeze();
            })
            .then(() => {
                this.fireEvent('onSwitchColumn',
                    this.getColumn(oldIndex), this.getColumn(newIndex)
                );
            });
    }

    toggleFilter(flag) {
        if (!this.options.inlineFilters) return;

        let showFilter;
        if (flag === undefined) {
            showFilter = !this.isFilterShown;
        } else {
            showFilter = flag;
        }

        if (showFilter) {
            $.style(this.$filterRow, { display: '' });
        } else {
            $.style(this.$filterRow, { display: 'none' });
        }

        this.isFilterShown = showFilter;
        this.style.setBodyStyle();
    }

    focusFilter(colIndex) {
        if (!this.isFilterShown) return;

        const $filterInput = $(`.dt-cell--col-${colIndex} .dt-filter`, this.$filterRow);
        $filterInput.focus();
    }

    bindFilter() {
        if (!this.options.inlineFilters) return;
        this.appliedFilters = this.appliedFilters || {};
        const handler = e => {
            this.$filterCell = $.closest('.dt-cell', e.target);
            const { colIndex } = $.data(this.$filterCell);
            const keyword = e.target.value;
            this.appliedFilters[colIndex] = keyword;
            this.applyFilter(this.appliedFilters);
        };
        $.on(this.header, 'keydown', '.dt-filter', debounce(handler, 300));
    }

    applyFilter(filters) {
        this.datamanager.filterRows(filters)
            .then(({
                rowsToShow
            }) => {
                this.rowmanager.showRows(rowsToShow);
            });
    }

    applyDefaultSortOrder() {
        // sort rows if any 1 column has a default sortOrder set
        const columnsToSort = this.getColumns().filter(col => col.sortOrder !== 'none');

        if (columnsToSort.length === 1) {
            const column = columnsToSort[0];
            this.sortColumn(column.colIndex, column.sortOrder);
        }
    }

    sortRows(colIndex, sortOrder) {
        return this.datamanager.sortRows(colIndex, sortOrder);
    }

    getColumn(colIndex) {
        return this.datamanager.getColumn(colIndex);
    }

    getColumns() {
        return this.datamanager.getColumns();
    }

    setColumnWidth(colIndex, width) {
        colIndex = +colIndex;

        let columnWidth = width || this.getColumn(colIndex).width;

        const selector = [
            `.dt-cell__content--col-${colIndex}`,
            `.dt-cell__edit--col-${colIndex}`
        ].join(', ');

        const styles = {
            width: columnWidth + 'px'
        };

        this.style.setStyle(selector, styles);
    }

    setColumnHeaderWidth(colIndex) {
        colIndex = +colIndex;
        this.$columnMap = this.$columnMap || [];
        const selector = `.dt-cell__content--header-${colIndex}`;
        const {
            width
        } = this.getColumn(colIndex);

        let $column = this.$columnMap[colIndex];
        if (!$column) {
            $column = this.header.querySelector(selector);
            this.$columnMap[colIndex] = $column;
        }

        $column.style.width = width + 'px';
    }

    getColumnMinWidth(colIndex) {
        colIndex = +colIndex;
        return this.getColumn(colIndex).minWidth || 24;
    }

    getFirstColumnIndex() {
        return this.datamanager.getColumnIndexById('_rowIndex') + 1;
    }

    getHeaderCell$(colIndex) {
        return $(`.dt-cell--header-${colIndex}`, this.header);
    }

    getLastColumnIndex() {
        return this.datamanager.getColumnCount() - 1;
    }

    getDropdownHTML() {
        const { dropdownButton, headerDropdown: dropdownItems } = this.options;

        return `
            <div class="dt-dropdown">
                <div class="dt-dropdown__toggle">${dropdownButton}</div>
                <div class="dt-dropdown__list">
                ${dropdownItems.map((d, i) => `
                    <div class="dt-dropdown__list-item" data-index="${i}">${d.label}</div>
                `).join('')}
                </div>
            </div>
      `;
    }
}
