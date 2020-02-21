Ext.define('CArABU.technicalservices.TrancheTemplateColumn', {
    extend: 'Ext.grid.column.Template',
    alias: ['widget.tranchetemplatecolumn'],

    align: 'right',

    initComponent: function () {
        var me = this;

        me.tpl = new Ext.XTemplate('<tpl><div style="text-align:right;">{[this.getTrancheString(values)]}</div></tpl>', {
            getTrancheString: function (values) {
                return values.c_Tranche || '';
            }

        });
        // me.hasCustomRenderer = true;
        me.callParent(arguments);
    },
    getValue: function () {
        return values[this.dataIndex] || 0;
    },
    defaultRenderer: function (value, meta, record) {
        var data = Ext.apply({}, record.get('Feature')); //, record.getAssociatedData());
        return this.tpl.apply(data);
    }
});