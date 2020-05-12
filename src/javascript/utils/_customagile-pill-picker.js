Ext.define('Customagile.ui.PillPicker', {
    extend: 'Ext.Container',
    alias: 'widget.customagilepillpicker',

    /**
     * @cfg {Object} config for the MultiObjectPicker
     */
    pickerCfg: null,

    /**
     * @cfg {Boolean} true to show pills
     */
    showPills: true,

    /**
    * @cfg {String} Unique string to persist selected items
    */
    statefulKey: null,

    /**
     * @cfg {Boolean} true if omitting same timebox name/dates
     */
    sharedSchedules: false,

    /**
   * @cfg {Boolean} true to set picker to most recent 5 timeboxes if no selections restored from state
   */
    defaultToRecentTimeboxes: true,

    initComponent() {
        let selectedItems = [];
        this.recordsToAdd = [];

        this.picker = Ext.ComponentManager.create(this.pickerCfg);
        this.mon(this.picker, 'selectionchange', this._onSelectionChange, this);
        this.mon(this.picker, 'select', this._onItemSelect, this);
        this.mon(this.picker, 'deselect', this._onItemDeselect, this);
        this.mon(this.picker, 'expand', this._onInitialExpand, this, { single: true });

        this.items = this._createItems();

        if (this.statefulKey) {
            selectedItems = JSON.parse(localStorage.getItem(this.statefulKey));
        }

        if (selectedItems && selectedItems.length > 0) {
            Ext.create('Rally.data.wsapi.RefsToRecords').convert(selectedItems, { requester: this }).then({
                success: (timeboxes) => {
                    if (this.sharedSchedules) {
                        this.picker.getTimeboxOidsInScope(timeboxes, (recordsToAdd) => {
                            this.recordsToAdd = recordsToAdd;
                            if (recordsToAdd && recordsToAdd.length > 0) {
                                this.picker.setValueBasedOnState(recordsToAdd);
                                this._addPills(recordsToAdd);
                                this.saveStateLocal(recordsToAdd);
                            } else {
                                this._setDefaults();
                            }
                        }, this);
                    } else {
                        this.recordsToAdd = timeboxes;
                        this.picker.setValueBasedOnState(timeboxes);
                        this._addPills(timeboxes);
                        this.saveStateLocal(timeboxes);
                    }
                },
                scope: this
            });
        } else {
            if (this.sharedSchedules) {
                const records = this.picker.store.getRange(0, 9);
                if (this.defaultToRecentTimeboxes) {
                    this.recordsToAdd = records;
                    this.picker.setDefaultValue(records);
                } else {
                    this.recordsToAdd = [];
                    this.picker.setValueBasedOnState([]);
                }
            } else {
                this.picker.createStore().then({
                    success: () => {
                        this.mon(this.picker, 'datachanged', this._onInitialDataChanged, this, { single: true });
                    },
                    scope: this
                });
            }
        }

        this.callParent(arguments);
        if (this.sharedSchedules) {
            this._addPills(this.recordsToAdd);
        }
    },

    getValue() {
        const { picker } = this;
        if (picker) {
            return picker.getValue();
        }

        return [];
    },

    getFilter() {
        return this.picker && this.picker.getFilter();
    },

    getLookbackFilter() {
        return this.picker && this.picker.getLookbackFilter();
    },

    saveStateLocal(records) {
        if (this.statefulKey) {
            try {
                localStorage.setItem(this.statefulKey, JSON.stringify(_.invoke(records, 'get', '_ref')));
            } catch (e) {
                // noop
            }
        }
    },

    _onInitialDataChanged() {
        this._setDefaults();
    },

    _setDefaults() {
        if (this.recordsToAdd.length === 0) {
            if (this.defaultToRecentTimeboxes) {
                Ext.create('Rally.data.wsapi.Store', {
                    model: 'Release',
                    autoLoad: true,
                    limit: 4,
                    pageSize: 4,
                    remoteSort: true,
                    remoteFilter: true,
                    fetch: ['ObjectID', 'Name', 'ReleaseStartDate', 'ReleaseDate'],
                    sorters: [{ property: 'ReleaseDate', direction: 'DESC' }],
                    filters: [{ property: 'ReleaseStartDate', operator: '<', value: new Date() }],
                    context: {
                        project: Rally.getApp().getContext().getProjectRef(),
                        projectScopeUp: false,
                        projectScopeDown: false
                    },
                    listeners: {
                        scope: this,
                        load: function (store, data, success) {
                            if (success) {
                                this.picker.setDefaultValue(data);
                                this._addPills(data);
                            }
                            else {
                                this.picker.setDefaultValue([]);
                            }
                        }
                    }
                });
            } else {
                this.picker.setValueBasedOnState([]);
            }
        }
    },

    _onInitialExpand() {
        if (this.picker.getList()) {
            this.picker.getList().pagingToolbar.onLoad();
            this.picker.getList().refresh();
        }
    },

    _addPills(records) {
        let recordsForPills = records;
        if (!this.showPills) {
            return;
        }
        if (this.sharedSchedules) {
            let foundRecords = {};
            recordsForPills = _.filter(records, (record) => {
                let key = `${record.get('Name')}-${record.get(this.startDateFieldName)}-${record.get(this.endDateFieldName)}`;
                if (!foundRecords[key]) {
                    foundRecords[key] = true;
                    return true;
                }
                return false;
            });
        }

        const pills = _.map(recordsForPills, record => ({
            xtype: 'component',
            flex: 1,
            itemId: `pill-id-${record.getId()}`,
            renderTpl: '<span class="tagPill">{Name}<span class="icon-cancel"></span></span>',
            renderData: record.getData(),
            renderSelectors: {
                tagPill: '.tagPill',
                removePillEl: '.icon-cancel'
            },
            listeners: {
                click: {
                    element: 'tagPill',
                    fn: (e) => {
                        e.preventDefault();
                        this._onRemovePillClick(record);
                    },
                    scope: this
                }
            }
        }), this);
        const newPills = _.filter(pills, cmp => _.isEmpty(this.down(`#${cmp.itemId}`)), this);

        if (newPills.length > 0) {
            this.down('#pillContainer').add(newPills);
        }
    },

    _createItems() {
        return [
            this.picker,
            {
                itemId: 'pillContainer',
                xtype: 'container',
                cls: 'pill-select-container',
                margin: '10 0 0 0',
                layout: {
                    type: 'table',
                    columns: 3
                }
            }
        ];
    },

    _removePills() {
        _.each(this.down('#pillContainer').items.getRange(), (cmp) => {
            cmp.destroy();
        });
    },

    _removePill(record) {
        let pillEl = this.down(`#pill-id-${record.getId()}`);
        if (pillEl) {
            pillEl.destroy();
        }
    },

    _onSelectionChange(cmp, records) {
        Ext.suspendLayouts();
        this._removePills();
        this._addPills(records);
        Ext.resumeLayouts(true);
        this.saveStateLocal(records);
    },

    _onItemSelect(cmp, record) {
        this._addPills(Ext.Array.from(record));
    },

    _onItemDeselect(cmp, record) {
        this._removePill(record);
    },

    _findSharedSchedules(record) {
        const selectedValues = this.picker.selectedValues.getRange();
        const key = `${record.get('Name')}-${record.get(this.startDateFieldName)}-${record.get(this.endDateFieldName)}`;
        return _.filter(selectedValues, (timebox) => {
            const timeboxKey = `${timebox.get('Name')}-${timebox.get(this.startDateFieldName)}-${timebox.get(this.endDateFieldName)}`;
            return timeboxKey === key;
        });
    },

    _onRemovePillClick(record) {
        if (this.sharedSchedules) {
            const recordsToRemove = this._findSharedSchedules(record);
            _.each(recordsToRemove, (r) => {
                this.picker.onListItemDeselect(null, r);
                this._removePill(r);
            });
        } else {
            this.picker.onListItemDeselect(null, record);
            this._removePill(record);
        }

        this.saveStateLocal(this.picker.selectedValues.getRange());
        this.fireEvent('recordremoved', this.picker.selectedValues, record, this.picker);
    }
});