Ext.define("user-story-ancestor-grid", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },

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
            xtype: 'tabpanel',
            itemId: 'filterAndProjectsPanel',
            stateful: true,
            stateId: 'tranche-report-filter-and-projects-panel',
            header: false,
            collapsible: true,
            animCollapse: false,
            cls: 'blue-tabs',
            activeTab: 0,
            plain: true,
            tabBar: {
                margin: '0 0 0 100'
            },
            autoRender: true,
            minTabWidth: 140,
            items: [
                {
                    title: 'Filters',
                    html: '',
                    itemId: 'filtersTab',
                    padding: 5,
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
                        },
                    ]
                },
                {
                    title: 'Projects',
                    itemId: 'projectsTab',
                    padding: 10,
                }
            ]
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

        this.collapseBtn = Ext.widget('rallybutton', {
            text: this.down('#filterAndProjectsPanel').getCollapsed() ? 'Expand Filters and Projects' : 'Collapse',
            floating: true,
            shadow: false,
            height: 21,
            handler: (btn) => {
                this.down('#filterAndProjectsPanel').toggleCollapse();
                this.onResize();
                if (btn.getText() === 'Collapse') {
                    btn.setText('Expand Filters and Projects');
                }
                else {
                    btn.setText('Collapse');
                }
            }
        });

        this.collapseBtn.showBy(this.down('#filterAndProjectsPanel'), 'tl-tl', [0, 3]);
        this.addProjectPicker();

        this.ancestorFilterPlugin = Ext.create('Utils.AncestorPiAppFilter', {
            ptype: 'UtilsAncestorPiAppFilter',
            pluginId: 'ancestorFilterPlugin',
            settingsConfig: {},
            whiteListFields: ['Tags', 'Milestones', 'c_EnterpriseApprovalEA', 'c_EAEpic', 'DisplayColor'],
            filtersHidden: false,
            displayMultiLevelFilter: true,
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
                                select: () => {
                                    this.filtersChange(this.ancestorFilterPlugin.getMultiLevelFilters());
                                },
                                change: this.filtersChange
                            });

                            this.updateFilterTabText(plugin.getMultiLevelFilters());
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
    filtersChange: function (filters) {
        this.updateFilterTabText(filters);
        this._buildGridboardStore();
    },
    initializeApp: function () {
        this.portfolioItemTypeDefs = _.map(this.portfolioItemTypes, function (p) { return p.getData(); });
        this._buildGridboardStore();
    },
    getFeatureName: function () {
        return this.getFeatureTypePath().replace('PortfolioItem/', '');
    },
    getFeatureTypePath: function () {
        return this.portfolioItemTypeDefs[0].TypePath;
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
    getFilters: async function (status) {
        this.setLoading('Loading Filters');
        let filters = this.getQueryFilter();
        let ancestorAndMultiFilters = await this.ancestorFilterPlugin.getAllFiltersForType(this.getModelName(), true).catch((e) => {
            this.showError(e, 'Failed while loading filters');
            this.setLoading(false);
            status.cancelLoad = true;
        });
        let timeboxScope = this.getContext().getTimeboxScope();
        if (timeboxScope) {
            filters.push(timeboxScope.getQueryFilter());
        }

        if (ancestorAndMultiFilters) {
            filters = filters.concat(ancestorAndMultiFilters);
        }

        if (this.useSpecificProjects() && !this.searchAllProjects()) {
            if (!this.projectRefs) {
                await this.loadProjects();
                if (status.cancelLoad) {
                    return [];
                }
            }
            filters.push({
                property: 'Project',
                operator: 'in',
                value: this.projectRefs
            });
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
        this.updateProjectTabText();
        this.setLoading(true);
        let status = this.cancelPreviousLoad();
        this.projectPicker = this.down('#projectPicker');
        this.down('#grid-area').removeAll();
        let filters = await this.getFilters(status);
        if (status.cancelLoad) {
            return;
        }
        let dataContext = this.getContext().getDataContext();
        if (this.searchAllProjects()) {
            dataContext.project = null;
            if (this.useSpecificProjects()) {
                Rally.ui.notify.Notifier.showWarning({ message: 'Specific projects are selected from the project picker, but scoping is set to "Any Project". Defaulting to any project.' });
            }
        }
        else if (this.useSpecificProjects()) {
            dataContext.project = null;
            dataContext.projectScopeUp = false;
            dataContext.projectScopeDown = false;
        }

        this.setLoading('Loading Artifacts');
        Ext.create('Rally.data.wsapi.TreeStoreBuilder').build({
            models: this.getModelNames(),
            enableHierarchy: true,
            fetch: [this.getFeatureName(), 'ObjectID', 'c_Tranche'],
            context: dataContext,
            enablePostGet: true,
            remoteSort: true,
            filters
        }).then({
            success: function (store) {
                if (status.cancelLoad) {
                    return;
                }
                this._addGridboard(store, filters, dataContext, status);
            },
            failure: this.showError,
            scope: this
        });
    },
    cancelPreviousLoad: function () {
        if (this.globalStatus) {
            this.globalStatus.cancelLoad = true;
        }

        let newStatus = { cancelLoad: false };
        this.globalStatus = newStatus;
        return newStatus;
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
        this.setLoading(false);
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

            var filters = [{
                property: filterProperty,
                operator: 'in',
                value: featureOids
            }];
            this.logger.log('type', type, filters.toString());

            promises.push(this.fetchWsapiRecords({
                model: type,
                fetch: ['FormattedID', 'Name', 'Parent', 'ObjectID', 'c_Tranche'],
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

    updateStories: function (store, node, records, operation, status) {
        this.logger.log('updateStories', records, operation);

        if (!records || records.length === 0 || records[0].get('_type') !== 'hierarchicalrequirement') {
            this.setLoading(false);
            return;
        }
        if (status.cancelLoad) {
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
                    if (status.cancelLoad) {
                        return;
                    }
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
    _addGridboard: function (store, filters, dataContext, status) {
        for (var i = 1; i < this.portfolioItemTypeDefs.length; i++) {
            var name = this.portfolioItemTypeDefs[i].Name.toLowerCase();
            store.model.addField({ name: name, type: 'auto', defaultValue: null });
        }
        store.on('load', function (store, node, records, operation) {
            this.updateStories(store, node, records, operation, status);
        }, this);
        store.on('error', function (e) {
            status.cancelLoad = true;
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
        }, {
            ptype: 'rallygridboardactionsmenu',
            headerPosition: 'right',
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
        }, {
            ptype: 'rallygridboardfieldpicker',
            headerPosition: 'right',
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
        }];
    },

    async _getSpecificProjectList() {
        let projects = this.projectPicker.getValue();

        if (this.down('#includeChildProjectsCheckbox').getValue()) {
            projects = await this._getAllChildProjects(projects);
        }

        this.projects = _.map(projects, (p) => {
            return p.get('ObjectID');
        });

        this.projectRefs = _.map(projects, (p) => {
            return p.get('_ref');
        });
    },

    async _getAllChildProjects(allRoots = [], fetch = ['Name', 'Children', 'ObjectID']) {
        if (!allRoots.length) { return []; }

        const promises = allRoots.map(r => this._wrap(r.getCollection('Children', { fetch, limit: Infinity }).load()));
        const children = _.flatten(await Promise.all(promises));
        const decendents = await this._getAllChildProjects(children, fetch);
        const removeDupes = {};
        let finalResponse = _.flatten([...decendents, ...allRoots, ...children]);

        // eslint-disable-next-line no-return-assign
        finalResponse.forEach(s => removeDupes[s.get('_ref')] = s);
        finalResponse = Object.values(removeDupes);
        return finalResponse;
    },

    async _getAllParentProjects(p) {
        let projectStore = Ext.create('Rally.data.wsapi.Store', {
            model: 'Project',
            fetch: ['Name', 'ObjectID', 'Parent'],
            filters: [{ property: 'ObjectID', value: p.get('Parent').ObjectID }],
            limit: 1,
            pageSize: 1,
            autoLoad: false
        });

        let results = await projectStore.load();
        if (results && results.length) {
            if (results[0].get('Parent')) {
                let parents = await this._getAllParentProjects(results[0]);
                return [p].concat(parents);
            }
            return [p, results[0]];
        }
        return [p];
    },

    async _wrap(deferred) {
        if (!deferred || !_.isFunction(deferred.then)) {
            return Promise.reject(new Error('Wrap cannot process this type of data into a ECMA promise'));
        }
        return new Promise((resolve, reject) => {
            deferred.then({
                success(...args) {
                    resolve(...args);
                },
                failure(error) {
                    reject(error);
                }
            });
        });
    },

    addProjectPicker: function () {
        this.down('#projectsTab').add(
            {
                xtype: 'component',
                html: `If you require a report spanning across multiple project hierarchies, use this project picker to specify where the data will be pulled from. If blank, app will respect user's current project scoping.`
            },
            {
                xtype: 'customagilepillpicker',
                itemId: 'projectPicker',
                hidden: false,
                statefulKey: this.getContext().getScopedStateId('tranche-report-project-picker'),
                defaultToRecentTimeboxes: false,
                listeners: {
                    recordremoved: this.showApplyProjectsBtn,
                    scope: this
                },
                pickerCfg: {
                    xtype: 'customagilemultiselectproject',
                    width: 350,
                    margin: '10 0 0 0',
                    listeners: {
                        blur: this.showApplyProjectsBtn,
                        scope: this
                    }
                }
            },
            {
                xtype: 'rallycheckboxfield',
                itemId: 'includeChildProjectsCheckbox',
                fieldLabel: 'Show work from child projects',
                stateful: true,
                stateId: this.getContext().getScopedStateId('tranche-report-scope-down-checkbox'),
                stateEvents: ['change'],
                labelWidth: 200,
                listeners: {
                    scope: this,
                    change: this.showApplyProjectsBtn
                }
            },
            {
                xtype: 'rallybutton',
                itemId: 'applyProjectsBtn',
                text: 'Apply',
                margin: '10 0 0 0',
                hidden: true,
                handler: function (btn) {
                    btn.hide();
                    this.projectListChange();
                }.bind(this)
            }
        );
    },

    showApplyProjectsBtn: function () {
        this.down('#applyProjectsBtn') && this.down('#applyProjectsBtn').show();
    },

    updateFilterTabText: function (filters) {
        var totalFilters = 0;
        _.each(filters, function (filter) {
            totalFilters += filter.length;
        });

        var titleText = totalFilters ? `FILTERS (${totalFilters})` : 'FILTERS';
        var tab = this.down('#filterAndProjectsPanel').child('#filtersTab');

        if (tab) { tab.setTitle(titleText); }
    },

    updateProjectTabText: function () {
        let picker = this.down('#projectPicker');
        totalProjects = picker.getValue().length;

        var titleText = totalProjects ? `PROJECTS (${totalProjects})` : 'PROJECTS';
        var tab = this.down('#filterAndProjectsPanel').child('#projectsTab');

        if (tab) { tab.setTitle(titleText); }
    },

    async loadProjects() {
        this.setLoading('Loading Project List...');

        if (this.useSpecificProjects()) {
            await this._getSpecificProjectList();
        }
    },

    async projectListChange() {
        await this.loadProjects();
        this._buildGridboardStore();
    },


    useSpecificProjects() {
        return !!this.projectPicker.getValue().length;
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

        let dataContext = this.getContext().getDataContext();
        if (this.searchAllProjects()) {
            dataContext.project = null;
        }
        else if (this.useSpecificProjects()) {
            dataContext.project = null;
            dataContext.projectScopeUp = false;
            dataContext.projectScopeDown = false;
        }

        var fetch = _.pluck(additionalFields, 'dataIndex');
        fetch = fetch.concat(['ObjectID', 'DisplayName', 'FirstName', 'LastName', 'c_Tranche']);
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
            limit: 'Infinity',
            context: dataContext
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
        var filters = [];

        if (oids.length) {
            filters.push({
                property: 'WorkProduct.ObjectID',
                operator: 'in',
                value: oids
            });
        }

        fetch.push('WorkProduct');
        this.fetchWsapiRecords({
            model: 'Task',
            fetch: fetch,
            filters: filters,
            limit: 'Infinity',
            enablePostGet: true,
            context: { project: null }
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
            fetchList = _.map(standardColumns, function (c) { return c.dataIndex }),
            derivedColumns = this.getDerivedColumns();

        if (!_.contains(headers, 'Tranche')) {
            headers.push('Tranche');
        }
        if (!_.contains(fetchList, 'c_Tranche')) {
            fetchList.push('c_Tranche');
        }

        this.logger.log('getExportCSV', headers, fetchList);

        Ext.Array.each(derivedColumns, function (d) {
            if (d.text !== 'Tranche') {
                headers.push(d.text);
            }
        });

        var csv = [headers];

        for (var i = 0; i < records.length; i++) {
            let row = [],
                record = records[i];

            for (var j = 0; j < fetchList.length; j++) {
                var val = "";
                if (fetchList[j] === 'c_Tranche') {
                    val = (record.get('Feature') && record.get('Feature').c_Tranche) || '';
                }
                else {
                    val = CustomAgile.ui.renderer.RecordFieldRendererFactory.getFieldDisplayValue(record, fetchList[j], '; ');
                }
                row.push(val || "");
            }

            Ext.Array.each(derivedColumns, function (d) {
                if (d.text !== 'Tranche') {
                    var ancestor = record.get(d.ancestorName);
                    if (ancestor) {
                        row.push(Ext.String.format("{0}: {1}", ancestor.FormattedID, ancestor.Name));
                    } else {
                        row.push("");
                    }
                }
            });

            // row = _.map(row, function (v) { return Ext.String.format("\"{0}\"", v.toString().replace(/"/g, "\"\"")); });
            csv.push(row);
        }
        return csv = Papa.unparse(csv);
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
        var cols = [{
            xtype: 'tranchetemplatecolumn',
            text: 'Tranche'
        }];

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

    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings) {
        this.logger.log('onSettingsUpdate', settings);
        this._buildGridboardStore();
    },

    setLoading(msg) {
        this.down('#grid-area').setLoading(msg);
    },

    showError(msg, defaultMsg) {
        Rally.ui.notify.Notifier.showError({ message: this.parseError(msg, defaultMsg) });
        this.setLoading(false);
    },

    parseError(e, defaultMessage) {
        defaultMessage = defaultMessage || 'An error occurred while loading the report';

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
});
