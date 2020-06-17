Ext.define("user-story-ancestor-grid", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 5 },

    integrationHeaders: {
        name: "user-story-ancestor-grid"
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
                defaultMargins: '0 10 5 0',
            }
        }, {
            id: Utils.AncestorPiAppFilter.PANEL_RENDER_AREA_ID,
            xtype: 'container',
            layout: {
                type: 'hbox',
                align: 'middle',
                defaultMargins: '0 10 0 0',
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
            filtersHidden: false,
            visibleTab: 'HierarchicalRequirement',
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
                            this.showError(msg);
                        },
                    });
                },
            }
        });
        this.addPlugin(this.ancestorFilterPlugin);
    },

    initializeApp: function (portfolioTypes) {
        this.portfolioItemTypeDefs = _.map(this.portfolioItemTypes, function (p) { return p.getData(); });
        this._buildGridboardStore();
    },
    getFeatureName: function () {
        return this.getFeatureTypePath().replace('PortfolioItem/', '');
    },
    getFeatureTypePath: function () {
        return this.portfolioItemTypeDefs[0].TypePath;
        //return 'PortfolioItem/Feature';
    },
    getPortfolioItemTypePaths: function () {
        return _.pluck(this.portfolioItemTypeDefs, 'TypePath');
    },
    fetchPortfolioItemTypes: function () {
        return this.fetchWsapiRecords({
            model: 'TypeDefinition',
            fetch: ['TypePath', 'Ordinal', 'Name'],
            context: { workspace: this.getContext().getWorkspace()._ref },
            filters: [{
                property: 'Parent.Name',
                operator: '=',
                value: 'Portfolio Item'
            },
            {
                property: 'Creatable',
                operator: '=',
                value: 'true'
            }],
            sorters: [{
                property: 'Ordinal',
                direction: 'ASC'
            }]
        });
    },
    onTimeboxScopeChange: function () {
        this.callParent(arguments);
        this._buildGridboardStore();
    },
    getFilters: async function () {
        let filters = this.getQueryFilter();
        let ancestorAndMultiFilters = await this.ancestorFilterPlugin.getAllFiltersForType(this.getModelName(), true).catch((e) => {
            this.showError(e);
            this.setLoading(false);
            return;
        });
        let timeboxScope = this.getContext().getTimeboxScope();
        if (timeboxScope) {
            filters.push(timeboxScope.getQueryFilter());
        }

        if (ancestorAndMultiFilters) {
            filters = filters.concat(ancestorAndMultiFilters);
        }

        return filters;
    },
    getQueryFilter: function () {
        var query = this.getSetting('query');
        if (query && query.length > 0) {
            this.logger.log('getQueryFilter', Rally.data.wsapi.Filter.fromQueryString(query));
            return Rally.data.wsapi.Filter.fromQueryString(query);
        }
        return [];
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
            fetch: [this.getFeatureName(), 'ObjectID'],
            context: dataContext,
            enablePostGet: true,
            remoteSort: true,
            filters
        }).then({
            success: function (store) {
                this._addGridboard(store, filters, dataContext);
            },
            failure: this.showError,
            scope: this
        });
    },
    getModelNames: function () {
        return ['HierarchicalRequirement'];
    },
    getModelName: function () {
        return 'HierarchicalRequirement';
    },
    getFeatureAncestorHash: function () {
        if (!this.featureAncestorHash) {
            this.featureAncestorHash = {};
        }
        return this.featureAncestorHash;
    },
    setAncestors: function (records) {
        var featureHash = this.getFeatureAncestorHash(),
            featureName = this.getFeatureName();

        for (var j = 0; j < records.length; j++) {
            var record = records[j],
                feature = record.get(featureName);
            if (feature) {
                var objID = feature.ObjectID;
                var featureObj = featureHash[objID];
                for (var i = 1; i < this.portfolioItemTypeDefs.length; i++) {
                    var name = this.portfolioItemTypeDefs[i].TypePath.toLowerCase().replace('portfolioitem/', '');

                    if (featureObj && featureObj[name]) {
                        record.set(name, featureObj[name]);
                    } else {
                        record.set(name, null);
                    }
                }
            }
        }
    },

    updateFeatureHashWithWsapiRecords: function (results) {

        var hash = {},
            features = [],
            featureTypePath = this.getPortfolioItemTypePaths()[0].toLowerCase(),
            ancestorNames = _.map(this.getPortfolioItemTypePaths(), function (pi) {
                return pi.toLowerCase().replace('portfolioitem/', '');
            });

        Ext.Array.each(results, function (res) {
            Ext.Array.each(res, function (pi) {
                hash[pi.get('ObjectID')] = pi.getData();
                if (pi.get('_type') === featureTypePath) {
                    features.push(pi);
                }
            });
        });

        this.logger.log('updateFeatureHashWithWsapiRecords', ancestorNames, results);
        var featureHash = this.getFeatureAncestorHash();
        Ext.Array.each(features, function (s) {

            var parent = s.get('Parent') && s.get('Parent').ObjectID || null,
                objID = s.get('ObjectID');

            if (!featureHash[objID]) {
                featureHash[objID] = hash[objID];
                //initialize
                Ext.Array.each(ancestorNames, function (a) { featureHash[objID][a] = null; });
            }

            if (parent && featureHash[objID]) {
                do {
                    var parentObj = hash[parent] || null,
                        parentName = hash[parent] && hash[parent]._type.replace('portfolioitem/', '');

                    if (featureHash[objID]) {
                        featureHash[objID][parentName] = parentObj;
                        parent = parentObj && parentObj.Parent && parentObj.Parent.ObjectID || null;
                    }
                } while (parent !== null);
            }
        });

    },
    fetchAncestors: function (featureOids) {
        var deferred = Ext.create('Deft.Deferred');

        var promises = [];
        for (var i = 0; i < this.getPortfolioItemTypePaths().length; i++) {
            var type = this.getPortfolioItemTypePaths()[i];

            var filterProperties = ['ObjectID'];

            for (var j = 0; j < i; j++) {
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
            failure: this.showError,
            scope: this
        }).always(function () { this.setLoading(false); }, this);
        return deferred;


    },

    updateStories: function (store, node, records, operation) {
        this.logger.log('updateStories', records, operation);

        if (!records || records.length === 0 || records[0].get('_type') !== 'hierarchicalrequirement') {
            return;
        }
        var featureName = this.getFeatureName(),
            featureHash = this.getFeatureAncestorHash(),
            featureOids = [];

        Ext.Array.each(records, function (r) {
            var feature = r.get(featureName);
            if (feature && !featureHash[feature.ObjectID]) {
                if (!Ext.Array.contains(featureOids, feature.ObjectID)) {
                    featureOids.push(feature.ObjectID);
                }
            }
        }, this);
        this.logger.log('featureOids', featureOids);

        if (featureOids.length > 0) {
            this.fetchAncestors(featureOids).then({
                success: function (results) {
                    this.updateFeatureHashWithWsapiRecords(results);
                    this.setAncestors(records);
                },
                failure: this.showError,
                scope: this
            });
        } else {
            this.setAncestors(records)
        }
    },
    _addGridboard: function (store, filters, dataContext) {
        for (var i = 1; i < this.portfolioItemTypeDefs.length; i++) {
            var name = this.portfolioItemTypeDefs[i].Name.toLowerCase();
            store.model.addField({ name: name, type: 'auto', defaultValue: null });
        }
        store.on('load', this.updateStories, this);
        store.on('error', function (e) {
            this.showError(e, 'Error while loading user story store');
        }, this);

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
                    // groupString: 'c_Tranche',
                    context: dataContext,
                    enablePostGet: true
                },
                columnCfgs: this.getColumnConfigs(),
                derivedColumns: this.getDerivedColumns()
            }
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
            alwaysSelectedValues: [this.getFeatureName()],
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
                    handler: function () { this._export(false); },
                    scope: this
                }, {
                    text: 'Export Stories and Tasks...',
                    handler: this._deepExport,
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
    updateExportStories: function (records) {
        var deferred = Ext.create('Deft.Deferred');

        this.logger.log('updateExportStories', records);

        if (records.length === 0 || records[0].get('_type') !== 'hierarchicalrequirement') {
            deferred.resolve([]);
        }
        var featureName = this.getFeatureName(),
            featureHash = this.getFeatureAncestorHash(),
            featureOids = [];

        Ext.Array.each(records, function (r) {
            var feature = r.get(featureName);
            if (feature && !featureHash[feature.ObjectID]) {
                if (!Ext.Array.contains(featureOids, feature.ObjectID)) {
                    featureOids.push(feature.ObjectID);
                }

            }
        }, this);
        this.logger.log('featureOids', featureOids);

        if (featureOids.length > 0) {
            this.fetchAncestors(featureOids).then({
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
        this._export(true);
    },
    _export: async function (includeTasks) {

        var filters = await this.getExportFilters();

        var columnCfgs = this.down('rallytreegrid').columns,
            additionalFields = _.filter(columnCfgs, function (c) { return c.text !== 'Rank' && (c.xtype === 'rallyfieldcolumn' || c.xtype === "treecolumn"); }),
            derivedFields = this.getDerivedColumns(),
            columns = Ext.Array.merge(additionalFields, derivedFields);

        var fetch = _.pluck(additionalFields, 'dataIndex');
        fetch = fetch.concat(['ObjectID', 'DisplayName', 'FirstName', 'LastName']);
        if (includeTasks) {
            fetch.push('Tasks');
        }
        if (!Ext.Array.contains(fetch, this.getFeatureName())) {
            fetch.push(this.getFeatureName());
        }
        this.setLoading('Loading data to export...');
        this.logger.log('columns', columnCfgs);
        this.fetchWsapiRecords({
            model: 'HierarchicalRequirement',
            fetch: fetch,
            filters: filters,
            limit: 'Infinity'
        }).then({
            success: this.updateExportStories,
            scope: this
        }).then({
            success: function (records) {
                if (includeTasks) {
                    this._exportTasks(records, fetch, columns);
                } else {
                    var csv = this.getExportCSV(records, columns);
                    var filename = Ext.String.format("export-{0}.csv", Ext.Date.format(new Date(), "Y-m-d-h-i-s"));
                    CArABU.technicalservices.FileUtilities.saveCSVToFile(csv, filename);
                }
            },
            failure: this.showError,
            scope: this
        }).always(function () { this.setLoading(false); }, this);
    },
    _exportTasks: function (userStories, fetch, columns) {

        var oids = [];
        for (var i = 0; i < userStories.length; i++) {
            if (userStories[i].get('Tasks') && userStories[i].get('Tasks').Count) {
                oids.push(userStories[i].get('ObjectID'));
            }
        }
        var filters = Ext.Array.map(oids, function (o) {
            return {
                property: 'WorkProduct.ObjectID',
                value: o
            };
        });
        filters = Rally.data.wsapi.Filter.or(filters);

        fetch.push('WorkProduct');
        this.fetchWsapiRecords({
            model: 'Task',
            fetch: fetch,
            filters: filters,
            limit: 'Infinity',
            enablePostGet: true
        }).then({
            success: function (tasks) {
                this.logger.log('exportTasks', tasks.length);
                var taskHash = {};
                for (var j = 0; j < tasks.length; j++) {
                    if (!taskHash[tasks[j].get('WorkProduct').ObjectID]) {
                        taskHash[tasks[j].get('WorkProduct').ObjectID] = [];
                    }
                    taskHash[tasks[j].get('WorkProduct').ObjectID].push(tasks[j]);
                }

                var rows = [];
                for (var j = 0; j < userStories.length; j++) {
                    rows.push(userStories[j]);
                    var ts = taskHash[userStories[j].get('ObjectID')];
                    if (ts && ts.length > 0) {
                        rows = rows.concat(ts);
                    }
                }

                columns.push({
                    dataIndex: 'WorkProduct',
                    text: 'User Story'
                });
                var csv = this.getExportCSV(rows, columns);
                var filename = Ext.String.format("export-{0}.csv", Ext.Date.format(new Date(), "Y-m-d-h-i-s"));
                CArABU.technicalservices.FileUtilities.saveCSVToFile(csv, filename);
            },
            failure: function (msg) {
                var msg = "Unable to export tasks due to error:  " + msg
                this.showError(msg);
            },
            scope: this
        });
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

        var csv = [headers];

        for (var i = 0; i < records.length; i++) {
            var row = [],
                record = records[i];

            for (var j = 0; j < fetchList.length; j++) {
                var val = CustomAgile.ui.renderer.RecordFieldRendererFactory.getFieldDisplayValue(record, fetchList[j], '; ', true);

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

            csv.push(row);
        }
        return Papa.unparse(csv);
    },

    getColumnConfigs: function () {
        var cols = [{
            dataIndex: 'Name',
            text: 'Name'
        }, {
            dataIndex: 'ScheduleState',
            text: 'Schedule State'
        }, {
            dataIndex: this.getFeatureName(),
            text: this.getFeatureName()
        }].concat(this.getDerivedColumns());
        this.logger.log('cols', cols);
        return cols;
    },
    getDerivedColumns: function () {
        var cols = [];
        //Ext.Array.each(this.portfolioItemTypeDefs, function(p){
        for (var i = 1; i < this.portfolioItemTypeDefs.length; i++) {

            var name = this.portfolioItemTypeDefs[i].TypePath.toLowerCase().replace('portfolioitem/', '');

            cols.push({
                // dataIndex: name,
                ancestorName: name,
                xtype: 'ancestortemplatecolumn',
                text: this.portfolioItemTypeDefs[i].Name
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

    showError(msg, defaultMessage) {
        Rally.ui.notify.Notifier.showError({ message: this.parseError(msg, defaultMessage) });
    },

    parseError(e, defaultMessage) {
        defaultMessage = defaultMessage || 'An unknown error has occurred';

        if (typeof e === 'string' && e.length) {
            return e;
        }
        if (e.message && e.message.length) {
            return e.message;
        }
        if (e.exception && e.error && e.error.errors && e.error.errors.length) {
            if (e.error.errors[0].length) {
                return e.error.errors[0];
            } else {
                if (e.error && e.error.response && e.error.response.status) {
                    return `${defaultMessage} (Status ${e.error.response.status})`;
                }
            }
        }
        if (e.exceptions && e.exceptions.length && e.exceptions[0].error) {
            return e.exceptions[0].error.statusText;
        }
        return defaultMessage;
    },

    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings) {
        this.logger.log('onSettingsUpdate', settings);
        this._buildGridboardStore();
    }
});
