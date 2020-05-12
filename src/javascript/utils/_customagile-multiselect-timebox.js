Ext.define('CustomAgile.ui.picker.MultiSelectTimebox', {
    extend: 'Rally.ui.picker.MultiObjectPicker',
    alias: 'widget.customagilemultiselecttimebox',

    config: {
        remoteFilter: true,
        maxLength: 100,
        projects: null,
        pickerCfg: {
            cls: 'multiselect-timebox-picker',
            minWidth: 350
        },
        width: 150,
        enableGrouping: false,
        toggleOnClick: true,
        timeboxStartDateField: '',
        timeboxEndDateField: ''
    },

    initComponent() {
        Rally.ui.list.PagingToolbar.prototype.emptyMsg = 'No timeboxes';

        this.callParent(arguments);
    },

    triggerBlur() {
        const { picker } = this;

        if (picker && picker.isVisible()) {
            this.collapse();
            this.callParent(arguments);
        }
    },

    getMatchedTextHtml(recordData) {
        return `<div class="timebox-name">${recordData.Name}</div>`;
    },

    resetFilters() {
        // TODO: do we need this for remote filter?
        // this.store.setFilter(this.getBaseFilter());
    },

    setValueBasedOnState(values = []) {
        const items = Ext.isString(values) ? values.split(',') : Ext.Array.from(values);

        if (!_.isEmpty(items) && this.store && this.store.isLoading()) {
            this.store.on('load', () => {
                this._selectValues(items);
            }, this, { single: true });
        } else {
            this._selectValues(items);
        }

        if (this.isExpanded) {
            this._onListRefresh();
            this._groupSelectedRecords();
        }

        this.fireEvent('stateapplied', this, this.selectedValues.getRange(), null);
    },

    setDefaultValue(items) {
        this._selectValues(items);

        this.fireEvent('defaultapplied', this, this.selectedValues.getRange(), null);
    },

    // eslint-disable-next-line consistent-return
    getTimeboxOidsInScope(selectedTimeboxes, callbackFn, scope) {
        if (selectedTimeboxes.length > 0) {
            let config = {
                model: Ext.identityFn(this.modelType),
                filters: this._getTimeboxFilters(selectedTimeboxes),
                fetch: ['Name', this.timeboxStartDateField, this.timeboxEndDateField, 'ObjectID'],
                autoLoad: true,
                listeners: {
                    load: (store, sharedTimeboxesInScope) => {
                        Ext.callback(callbackFn, scope, [sharedTimeboxesInScope]);
                    }
                }
            };
            if (this.projects) {
                config.filters = config.filters.and({ property: 'Project.ObjectID', operator: 'in', value: this.projects });
                config.context = {
                    project: null
                };
            }
            Ext.create('Rally.data.wsapi.Store', config);
        } else {
            Ext.callback(callbackFn, scope, [[]]);
        }
    },

    _getTimeboxFilters(records) {
        let filters = [];
        let foundSharedSchedule = {};

        _.each(records, (record) => {
            let key = `${record.get('Name')}-${record.get(this.timeboxStartDateField)}-${record.get(this.timeboxEndDateField)}`;
            if (!foundSharedSchedule[key]) {
                foundSharedSchedule[key] = true;
                let filterByTimebox = Rally.data.wsapi.Filter.and([
                    {
                        property: 'Name',
                        value: record.get('Name')
                    },
                    {
                        property: this.timeboxStartDateField,
                        value: record.get(this.timeboxStartDateField)
                    },
                    {
                        property: this.timeboxEndDateField,
                        value: record.get(this.timeboxEndDateField)
                    }
                ]);
                filters.push(filterByTimebox);
            }
        });
        return Rally.data.wsapi.Filter.or(filters);
    },

    /**
     * @override
     * Add support for specifying a store config option
     */
    createStore() {
        if (!this.store) {
            let storeBuilder = Ext.create('Rally.data.DataStoreBuilder');
            let storeConfig = Ext.merge({ model: this.modelType, requester: this }, this.storeConfig);

            return storeBuilder.build(storeConfig).then({
                success(store) {
                    this.store = store;
                    this.relayEvents(this.store, ['datachanged']);
                },
                scope: this
            });
        }
        return Promise.resolve(this.store);
    },

    /**
    * @override
    * Set buffer on keyup event for remote filtering to work
    * Add listener to inputtextchanged for local filtering
    */
    _initInputEvents() {
        if (!this.rendered) {
            this.on('afterrender', this._initInputEvents, this, { single: true });
            return;
        }

        this.on('expand', this.refreshView, this);
        this.on('inputtextchanged', this._onInputTextChanged, this);
        this.mon(this.inputEl, 'keydown', this._onInputKeyDown, this);
        this.mon(this.inputEl, 'keyup', this.validate, this);
        this.mon(this.inputEl, 'keyup', this._onInputKeyUp, this, { buffer: 700 });
    },

    _onInputTextChanged() {
        this.store.clearFilter();
        this.store.filter({
            anyMatch: true, exactMatch: false, property: 'Name', value: this.getInputTextValue()
        });
        this.store.load();
    },

    /**
     * @override
     * Filter store if search field cleared
     */
    _onInputKeyUp(event) {
        this._setAppropriateEmptyText();

        // allow shift but disregard other modifiers
        if (event.shiftKey || !Rally.util.Event.isModifierKey(event)) {
            this.fireEvent('inputtextchanged', this.getInputTextValue());
        }
        if (this.getInputTextValue() === '') {
            if (this.store.filters) {
                this.store.filters.clear();
            }
            this.store.load();
        }
    },

    /**
    * @override
    * Wire up listeners for select and deselect instead of itemclick
    */
    _createList() {
        this.listCfg.pageSize = 10;
        let listCfg = Ext.apply({
            store: this.store,
            tpl: this._getListTpl(),
            createPagingToolbar: Ext.bind(this._createPagingToolbar, this)
        }, this.listCfg);

        this.list = Ext.create(this.listType, listCfg);

        this.mon(this.list, {
            refresh: this._onListRefresh,
            select: this.onListItemSelect,
            deselect: this.onListItemDeselect,
            scope: this
        });

        const pagingToolbar = this.getList().down('rallylistpagingtoolbar');
        pagingToolbar.onLoad();

        return this.list;
    },

    /**
     * @override
     * New signaure for onListItemSelect since wired up to select on the list
     */
    onListItemSelect(list, record) {
        this.select(record);
        this._selectRowCheckbox(record.get(this.recordKey));
        this._groupRecordsAndScroll(this._getRecordValue());
        this.refreshView();
        this.fireEvent('select', this, record, this.getValue());
        this._fireSelectionChange();
    },

    /**
     * @override
     * Find record in selectedValues mixedcollection and remove the record to be removed
     * New signaure for onListItemDeselect since wired up to deselect on the list
     */
    onListItemDeselect(list, record) {
        let foundRecord = null;

        const key = this._getKey(record);
        this.selectedValues.each((r) => {
            if (r.get('_ref') === key) {
                foundRecord = r;
            }
        });
        if (foundRecord) {
            this.selectedValues.remove(foundRecord);
        }
        this._syncSelection();
        this._deselectRowCheckbox(record.get(this.recordKey));
        this._groupRecordsAndScroll(this._getRecordValue());
        this.fireEvent('deselect', this, record, this.getValue());
        this._fireSelectionChange();
    },

    /**
    * @override
    * Fix for bug where sometimes the itemEl is not there
    */
    _deselectRowCheckbox(recordId) {
        if (this._getOptionCheckbox(recordId)) {
            this._getOptionCheckbox(recordId).removeCls('rui-picker-cb-checked');
        }
    },

    /**
    * @override
    */
    _onStoreLoaded() {
        this._syncSelection();

        this.callParent(arguments);
    },

    _createPagingToolbar() {
        return Ext.widget('rallylistpagingtoolbar', {
            store: this.store,
            border: false,
            layout: {
                align: 'middle'
            }
        });
    }
});