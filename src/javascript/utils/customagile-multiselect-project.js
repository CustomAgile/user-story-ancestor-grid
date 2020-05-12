Ext.define('CustomAgile.ui.picker.MultiSelectProject', {
    extend: 'CustomAgile.ui.picker.MultiSelectTimebox',
    alias: 'widget.customagilemultiselectproject',
    requires: [
        'CustomAgile.ui.picker.MultiSelectTimebox'
    ],

    config: {
        modelType: 'Project',
        emptyText: 'Search projects...',
        storeConfig: {
            autoLoad: true,
            limit: 10,
            pageSize: 10,
            remoteSort: true,
            remoteFilter: true,
            fetch: ['ObjectID', 'Name'],
            sorters: [{ property: 'Name', direction: 'ASC' }],
            context: { project: null }
        }
    },

    /**
     * @override
     * override no data message
     */
    initComponent() {
        this.callParent(arguments);

        Rally.ui.list.PagingToolbar.prototype.emptyMsg = `No ${this.modelType}s`;
    },

    getFilter() {
        let projects = this.getValue();

        return {
            property: 'Project',
            operator: 'in',
            value: _.map(projects, p => p.get('_ref'))
        };
    },

    getLookbackFilter() {
        let projects = this.getValue();

        return {
            property: 'Project',
            operator: 'in',
            value: _.map(projects, p => p.get('ObjectID'))
        };
    }
});
