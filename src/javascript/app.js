Ext.define("feature-ancestor-grid", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },

    integrationHeaders: {
        name: "feature-ancestor-grid"
    },

    config: {
        defaultSettings: {
            query: ''
        }
    },

    layout: {
        type: 'vbox',
        align: 'stretch'
    },

    items: [
        {
            id: Utils.AncestorPiAppFilter.RENDER_AREA_ID,
            xtype: 'container',
            layout: {
                type: 'hbox',
                align: 'middle',
                defaultMargins: '0 10 10 0',
            }
        }, {
            id: Utils.AncestorPiAppFilter.PANEL_RENDER_AREA_ID,
            xtype: 'container',
            layout: {
                type: 'hbox',
                align: 'middle',
                defaultMargins: '0 10 10 0',
            }
        }, {
            id: 'grid-area',
            itemId: 'grid-area',
            xtype: 'container',
            flex: 1,
            type: 'vbox',
            align: 'stretch'
        }
    ],

    launch: function () {
        Rally.data.wsapi.Proxy.superclass.timeout = 180000;
        Rally.data.wsapi.batch.Proxy.superclass.timeout = 180000;
        this.down('#' + Utils.AncestorPiAppFilter.PANEL_RENDER_AREA_ID).on('resize', this.onResize, this);

        this.ancestorFilterPlugin = Ext.create('Utils.AncestorPiAppFilter', {
            ptype: 'UtilsAncestorPiAppFilter',
            pluginId: 'ancestorFilterPlugin',
            settingsConfig: {},
            whiteListFields: ['Tags', 'Milestones', 'c_EnterpriseApprovalEA'],
            filtersHidden: false,
            visibleTab: 'portfolioitem/feature',
            listeners: {
                scope: this,
                ready(plugin) {
                    Rally.data.util.PortfolioItemHelper.getPortfolioItemTypes().then({
                        scope: this,
                        success(portfolioItemTypes) {
                            this.portfolioItemTypes = _.sortBy(portfolioItemTypes, type => type.get('Ordinal'));

                            plugin.addListener({
                                scope: this,
                                select: this._buildGridboardStore,
                                change: this._buildGridboardStore
                            });

                            this.initializeApp();
                        },
                        failure(msg) {
                            this.showErrorNotification(msg);
                        },
                    });
                },
            }
        });
        this.addPlugin(this.ancestorFilterPlugin);

        // this.fetchPortfolioItemTypes().then({
        //     success: this.initializeApp,
        //     failure: this.showErrorNotification,
        //     scope: this
        // });

    },
    showErrorNotification: function (msg) {
        Rally.ui.notify.Notifier.showError({
            message: msg
        });
    },
    initializeApp: function () {
        this.portfolioItemTypeDefs = _.map(this.portfolioItemTypes, function (p) { return p.getData(); });
        this.ancestorNames = _.map(this.getPortfolioItemTypePaths(), function (pi) {
            return pi.replace(/portfolioitem\//ig, '');
        });
        this._buildGridboardStore();
    },
    getFeatureName: function () {
        return this.getFeatureTypePath().replace(/portfolioitem\//ig, '');
    },
    getFeatureTypePath: function () {
        return this.portfolioItemTypeDefs[0].TypePath;
    },
    getFeatureParentName: function () {
        return this.getFeatureParentTypePath().replace(/portfolioitem\//ig, '');
    },
    getFeatureParentTypePath: function () {
        return (this.portfolioItemTypeDefs[1] && this.portfolioItemTypeDefs[1].TypePath) || '';
    },
    getPortfolioItemTypePaths: function () {
        return _.pluck(this.portfolioItemTypeDefs, 'TypePath');
    },
    getQueryFilter: function () {
        var query = this.getSetting('query');
        if (query && query.length > 0) {
            this.logger.log('getQueryFilter', Rally.data.wsapi.Filter.fromQueryString(query));
            return Rally.data.wsapi.Filter.fromQueryString(query);
        }
        return [];
    },
    getFilters: async function () {
        let filters = this.getQueryFilter();
        let ancestorAndMultiFilters = await this.ancestorFilterPlugin.getAllFiltersForType(this.getFeatureTypePath(), true).catch((e) => {
            this.showErrorNotification(e.message || e);
            this.setLoading(false);
            return;
        });

        if (ancestorAndMultiFilters) {
            filters = filters.concat(ancestorAndMultiFilters);
        }

        return filters;
    },
    _buildGridboardStore: async function () {
        this.logger.log('_buildGridboardStore');
        this.down('#grid-area').removeAll();
        let filters = await this.getFilters();
        let dataContext = this.getContext().getDataContext();
        if (this.searchAllProjects()) {
            dataContext.project = null;
        }

        Ext.create('Rally.data.wsapi.TreeStoreBuilder').build({
            models: this.getModelNames(),
            enableHierarchy: true,
            fetch: ['Parent', 'ObjectID'],
            context: dataContext,
            enablePostGet: true,
            remoteSort: true,
            filters
        }).then({
            success: function (store) {
                this._addGridboard(store, filters, dataContext);
            },
            failure: this.showErrorNotification,
            scope: this
        });
    },
    getModelNames: function () {
        return [this.getFeatureTypePath()];
    },
    getFeatureAncestorHash: function () {
        if (!this.featureAncestorHash) {
            this.featureAncestorHash = {};
        }
        return this.featureAncestorHash;
    },
    setAncestors: function (records) {
        var featureHash = this.getFeatureAncestorHash();

        for (var j = 0; j < records.length; j++) {
            var record = records[j],
                featureParent = record.get('Parent');
            if (featureParent) {
                var objID = featureParent.ObjectID;
                var featureParentObj = featureHash[objID];
                for (var i = 1; i < this.ancestorNames.length; i++) {
                    var name = this.ancestorNames[i].toLowerCase();

                    if (featureParentObj) {
                        if (featureParentObj[name]) {
                            record.set(name, featureParentObj[name]);
                        } else {
                            record.set(name, featureParentObj);
                        }
                    } else {
                        record.set(name, null);
                    }
                }
            }
        }
    },

    updateFeatureHashWithWsapiRecords: function (results) {

        var hash = {},
            featureParents = [],
            featureParentTypePath = this.getFeatureParentTypePath().toLowerCase();

        Ext.Array.each(results, function (res) {
            Ext.Array.each(res, function (pi) {
                hash[pi.get('ObjectID')] = pi.getData();
                if (pi.get('_type').toLowerCase() === featureParentTypePath) {
                    featureParents.push(pi);
                }
            });
        });

        this.logger.log('updateFeatureHashWithWsapiRecords', this.ancestorNames, results);
        var featureHash = this.getFeatureAncestorHash();
        Ext.Array.each(featureParents, function (s) {

            var parent = s.get('Parent') && s.get('Parent').ObjectID || null,
                objID = s.get('ObjectID');

            if (!featureHash[objID]) {
                featureHash[objID] = hash[objID];
                //initialize
                Ext.Array.each(this.ancestorNames, function (a) { featureHash[objID][a.toLowerCase()] = null; });
            }

            if (parent && featureHash[objID]) {
                do {
                    var parentObj = hash[parent] || null,
                        parentName = hash[parent] && hash[parent]._type.replace(/portfolioitem\//ig, '');

                    if (featureHash[objID]) {
                        featureHash[objID][parentName] = parentObj;
                        parent = parentObj && parentObj.Parent && parentObj.Parent.ObjectID || null;
                    }
                } while (parent !== null);
            }
        });
        console.log('Feature Hash', featureHash);
    },
    fetchAncestors: function (featureOids) {
        var deferred = Ext.create('Deft.Deferred');

        var promises = [];
        for (var i = 1; i < this.getPortfolioItemTypePaths().length; i++) {
            var type = this.getPortfolioItemTypePaths()[i];

            var filterProperties = ['ObjectID'];

            for (var j = 1; j < i; j++) {
                filterProperties.unshift('Children');
            }

            var filterProperty = filterProperties.join('.');

            var filters = _.map(featureOids, function (f) {
                return {
                    property: filterProperty,
                    value: f
                }
            });
            filters = Rally.data.wsapi.Filter.or(filters);
            this.logger.log('type', type, filters.toString());

            promises.push(this.fetchWsapiRecords({
                model: type,
                fetch: ['FormattedID', 'Name', 'Parent', 'ObjectID'],
                enablePostGet: true,
                limit: Infinity,
                pageSize: 1000,
                context: { project: null },
                filters: filters
            }));
        }
        this.setLoading('Loading Ancestor data...');
        Deft.Promise.all(promises).then({
            success: function (results) {
                deferred.resolve(results);
            },
            failure: this.showErrorNotification,
            scope: this
        }).always(function () {
            this.setLoading(false);
            this.onResize();
        }, this);
        return deferred;


    },

    updateFeatures: function (store, node, records, operation) {
        this.logger.log('updateFeatures', records, operation);

        if (records.length === 0 || records[0].get('_type').toLowerCase() !== this.getFeatureTypePath().toLowerCase()) {
            console.log('Update Features method. No records found or type doesnt match');
            return;
        }
        var featureParentHash = this.getFeatureAncestorHash(),
            featureParentOids = [];

        Ext.Array.each(records, function (r) {
            var featureParent = r.get('Parent');
            if (featureParent && !featureParentHash[featureParent.ObjectID]) {
                if (!Ext.Array.contains(featureParentOids, featureParent.ObjectID)) {
                    featureParentOids.push(featureParent.ObjectID);
                }
            }
        }, this);
        this.logger.log('featureParentOids', featureParentOids);

        if (featureParentOids.length > 0) {
            this.fetchAncestors(featureParentOids).then({
                success: function (results) {
                    this.updateFeatureHashWithWsapiRecords(results);
                    this.setAncestors(records);
                },
                failure: this.showErrorNotification,
                scope: this
            });
        } else {
            this.setAncestors(records);
        }
    },
    _addGridboard: function (store, filters, dataContext) {
        for (var i = 1; i < this.ancestorNames.length; i++) {
            var name = this.ancestorNames[i].toLowerCase();
            store.model.addField({ name: name, type: 'auto', defaultValue: null });
        }
        store.on('load', this.updateFeatures, this);
        let gridArea = this.down('#grid-area');

        gridArea.add({
            xtype: 'rallygridboard',
            context: this.getContext(),
            modelNames: this.getModelNames(),
            height: gridArea.getHeight(),
            toggleState: 'grid',
            plugins: this.getGridPlugins(),
            stateful: false,
            gridConfig: {
                store: store,
                storeConfig: {
                    filters,
                    context: dataContext,
                    enablePostGet: true
                },
                columnCfgs: this.getColumnConfigs(),
                derivedColumns: this.getDerivedColumns()
            },
            height: this.getHeight()
        });
    },
    getGridPlugins: function () {
        return [{
            ptype: 'rallygridboardaddnew'
        },
        {
            ptype: 'rallygridboardfieldpicker',
            headerPosition: 'left',
            modelNames: this.getModelNames(),
            stateful: true,
            margin: '3 3 3 25',
            stateId: this.getContext().getScopedStateId('ancestor-columns-1')
        }, {
            ptype: 'rallygridboardinlinefiltercontrol',
            inlineFilterButtonConfig: {
                stateful: true,
                stateId: this.getContext().getScopedStateId('ancestor-filters-old-filter'),
                modelNames: this.getModelNames(),
                margin: 3,
                hidden: true,
                inlineFilterPanelConfig: {
                    hidden: true,
                    quickFilterPanelConfig: {
                        defaultFields: ['Owner']
                    },
                    advancedFilterPanelConfig: {
                        advancedFilterRowsConfig: {
                            flex: 2
                        }
                    }
                }
            }
        }, {
            ptype: 'rallygridboardactionsmenu',
            menuItems: [
                {
                    text: 'Export...',
                    handler: this._export,
                    scope: this
                }
            ],
            buttonConfig: {
                margin: 3,
                iconCls: 'icon-export'
            }
        }];
    },
    getExportFilters: async function () {
        var filters = await this.getFilters();
        this.logger.log('getExportFilters', filters.toString());
        return filters;
    },
    updateExportFeatures: function (records) {
        var deferred = Ext.create('Deft.Deferred');

        this.logger.log('updateExportFeatures', records);

        if (records.length === 0 || records[0].get('_type').toLowerCase() !== this.getFeatureTypePath().toLowerCase()) {
            deferred.resolve([]);
        }

        var featureParentHash = this.getFeatureAncestorHash(),
            featureParentOids = [];

        Ext.Array.each(records, function (r) {
            var featureParent = r.get('Parent');
            if (featureParent && !featureParentHash[featureParent.ObjectID]) {
                if (!Ext.Array.contains(featureParentOids, featureParent.ObjectID)) {
                    featureParentOids.push(featureParent.ObjectID);
                }
            }
        }, this);
        this.logger.log('featureParentOids', featureParentOids);

        if (featureParentOids.length > 0) {
            this.fetchAncestors(featureParentOids).then({
                success: function (results) {
                    this.updateFeatureHashWithWsapiRecords(results);
                    this.setAncestors(records);
                    deferred.resolve(records);
                },
                failure: function (msg) {
                    deferred.reject(msg);
                },
                scope: this
            });
        } else {
            this.setAncestors(records);
            deferred.resolve(records);
        }

        return deferred;
    },
    _deepExport: function () {
        this._export();
    },
    _export: async function () {
        var filters = await this.getExportFilters();

        var columnCfgs = this.down('rallytreegrid').columns,
            additionalFields = _.filter(columnCfgs, function (c) { return c.text !== 'Rank' && (c.xtype === 'rallyfieldcolumn' || c.xtype === "treecolumn"); }),
            derivedFields = this.getDerivedColumns(),
            columns = Ext.Array.merge(additionalFields, derivedFields);

        var fetch = _.pluck(additionalFields, 'dataIndex');
        fetch.push('ObjectID');
        fetch.push('Parent');
        this.setLoading('Loading data to export...');
        this.logger.log('columns', columnCfgs);
        this.fetchWsapiRecords({
            model: this.getFeatureTypePath(),
            fetch: fetch,
            filters: filters,
            limit: 'Infinity'
        }).then({
            success: this.updateExportFeatures,
            scope: this
        }).then({
            success: function (records) {
                var csv = this.getExportCSV(records, columns);
                var filename = Ext.String.format("export-{0}.csv", Ext.Date.format(new Date(), "Y-m-d-h-i-s"));
                CArABU.technicalservices.FileUtilities.saveCSVToFile(csv, filename);
            },
            failure: this.showErrorNotification,
            scope: this
        }).always(function () { this.setLoading(false); }, this);
    },

    getExportCSV: function (records, columns) {
        var standardColumns = _.filter(columns, function (c) { return c.dataIndex || null; }),
            headers = _.map(standardColumns, function (c) { if (c.text === "ID") { return "Formatted ID"; } return c.text; }),
            fetchList = _.map(standardColumns, function (c) { return c.dataIndex; }),
            derivedColumns = this.getDerivedColumns();

        this.logger.log('getExportCSV', headers, fetchList);

        Ext.Array.each(derivedColumns, function (d) {
            headers.push(d.text);
        });

        var csv = [headers.join(',')];

        for (var i = 0; i < records.length; i++) {
            var row = [],
                record = records[i];

            for (var j = 0; j < fetchList.length; j++) {
                var val = record.get(fetchList[j]);
                if (Ext.isObject(val)) {
                    val = val.FormattedID || val._refObjectName;
                }
                row.push(val || "");
            }

            Ext.Array.each(derivedColumns, function (d) {
                var ancestor = record.get(d.ancestorName);
                if (ancestor) {
                    row.push(Ext.String.format("{0}: {1}", ancestor.FormattedID, ancestor.Name));
                } else {
                    row.push("");
                }
            });

            row = _.map(row, function (v) { return Ext.String.format("\"{0}\"", v.toString().replace(/"/g, "\"\"")); });
            csv.push(row.join(","));
        }
        return csv.join("\r\n");
    },

    getColumnConfigs: function () {
        var cols = [{
            dataIndex: 'Name',
            text: 'Name'
        }, {
            dataIndex: 'State',
            text: 'State'
        }
        ].concat(this.getDerivedColumns());
        this.logger.log('cols', cols);
        return cols;
    },
    getDerivedColumns: function () {
        var cols = [];
        for (var i = 1; i < this.ancestorNames.length; i++) {
            var name = this.ancestorNames[i];

            cols.push({
                ancestorName: name.toLowerCase(),
                xtype: 'ancestortemplatecolumn',
                text: name
            });
        }

        return cols;
    },
    fetchWsapiRecords: function (config) {
        var deferred = Ext.create('Deft.Deferred');
        Ext.create('Rally.data.wsapi.Store', config).load({
            callback: function (records, operation) {
                if (operation.wasSuccessful()) {
                    deferred.resolve(records);
                } else {
                    deferred.reject(Ext.String.format('Failed to fetch {0} records: {1}', config.model, operation && operation.error && operation.error.errors.join(',')));
                }
            }
        });
        return deferred;
    },

    onResize() {
        this.callParent(arguments);
        let gridboard = this.down('rallygridboard');
        let gridArea = this.down('#grid-area');
        if (gridArea && gridboard) {
            gridboard.setHeight(gridArea.getHeight());
        }
    },

    getOptions: function () {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },
    getSettingsFields: function () {
        return [{
            xtype: 'textarea',
            fieldLabel: 'Query Filter',
            name: 'query',
            anchor: '100%',
            cls: 'query-field',
            margin: '0 70 0 0',
            labelAlign: 'right',
            labelWidth: 100,
            plugins: [
                {
                    ptype: 'rallyhelpfield',
                    helpId: 194
                },
                'rallyfieldvalidationui'
            ],
            validateOnBlur: false,
            validateOnChange: false,
            validator: function (value) {
                try {
                    if (value) {
                        Rally.data.wsapi.Filter.fromQueryString(value);
                    }
                    return true;
                } catch (e) {
                    return e.message;
                }
            }
        }];
    },
    _launchInfo: function () {
        if (this.about_dialog) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink', {});
    },

    isExternal: function () {
        return typeof (this.getAppId()) == 'undefined';
    },

    searchAllProjects() {
        return this.ancestorFilterPlugin.getIgnoreProjectScope();
    },

    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings) {
        this.logger.log('onSettingsUpdate', settings);
        this._buildGridboardStore();
    }
});
