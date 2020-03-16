// ==UserScript==
// @name         gitlab tree
// @version      0.3
// @author        xizero
// @description  gitlab tree
// @include        *://gitlab.*.com/*
// @require  https://cdn.jsdelivr.net/npm/vue@2.5.17/dist/vue.min.js
// ==/UserScript==

(function () {
    'use strict';
    if (!$("body").attr("data-find-file")) {
        return;
    }
    var page = $("body").attr("data-page");
    if (!(page == "projects:show" || page == "projects:tree:show" || page == "projects:blob:show")) {
        return;
    }
    var project_id,
        repository_ref,
        apiRepoTree,
        originUrl,
        rep,
        repname;

    var initVariables = function () {
        rep = $("body").attr("data-find-file").replace("find_file", "blob");
        project_id = $('#project_id').val() || $('#search_project_id').val();
        repository_ref = $('#repository_ref').val();
        repname = $("body").attr("data-project");
        originUrl = window.location.origin;
        var apiRootUrl = originUrl + '/api/v4/projects/';
        apiRepoTree = apiRootUrl + project_id + '/repository/tree';
    }

    function getChildren(model) {
        $.ajaxSettings.async = false;
        if (!("children" in model)) {
            Vue.set(model, 'children', [])
            Vue.set(model, 'open', true)
            $.get(apiRepoTree, {
                id: project_id,
                path: model.path,
                ref_name: repository_ref
            }).done(function (r) {
                model.children = r;
            });
        }
        return model;
    }
    function get(childrens, dis, i) {
        if (i > dis.length - 1) {
            return [];
        }
        for (var j in childrens) {
            if (childrens[j].name == dis[i] && childrens[j].type == "tree") {
                childrens[j] = getChildren(childrens[j]);
                if (childrens[j].children.length != 0) {
                    childrens[j].children = get(childrens[j].children, dis, i + 1);
                }
                break;
            }
        }
        return childrens;
    }
    var initPath = function (data) {
        var path = sessionStorage.getItem("show");
        sessionStorage.removeItem("show");
        if (path == null) {
            return data;
        }
        var dis = path.split('/');
        if (dis == null || dis.length == 1) {
            return;
        }
        data.children = get(data.children, dis, 0);
        return data;
    }

    function initCss() {
        $(document.body).append(
            `<style>
                #tree,#tree ul{
                    padding: 0 0 0 1rem;
                    margin: 0;
                    list-style-type: none;
                }
                #tree li,#tree ul li{
                    cursor: pointer;
                    user-select:none;
                    min-width: 320px;
                }
                .mname:hover{
                    background:#db3b21;
                    color:#FFF;
                }
                ul#tree{
                    width :20%;
                    height:94%;
                    overflow :auto;
                    position: fixed;
                    top: auto;
                    left: 50px;
                }
            </style>`
        );
    }

    function createElement() {
        $("#content-body").parent().append(
            `<ul id="tree">
                <item
                class="item"
                :model="treeData">
                </item>
            </ul>`
        );
        $("#content-body").css({ "width": "80%", "float": "right" });
        $(".alert-wrapper").css({ "width": "80%", "float": "right" });
    }
    createElement();

    Vue.component('item', {
        template: `  <li>
                        <div
                        class="mname"
                        :class="{bold: isFolder}"
                        @click="toggle">
                        <span v-if="isFolder">{{ model.open ? '📂' : '📁' }}</span>
                        <span v-else>📄</span>
                        {{ model.name }}
                        </div>
                        <ul v-show="model.open" v-if="isFolder">
                        <item
                            class="item"
                            v-for="(model, index) in model.children"
                            :key="index"
                            :model="model">
                        </item>
                        </ul>
                    </li>`,
        props: {
            model: Object
        },
        computed: {
            isFolder: function () {
                return this.model.type == "tree"
            }
        },
        methods: {
            toggle: function () {
                if (this.isFolder) {
                    if (!("children" in this.model)) {
                        var _this = this;
                        $.get(apiRepoTree, {
                            id: project_id,
                            path: this.model.path,
                            ref_name: repository_ref
                        }).done(function (r) {
                            if (r.length == 1 && r[0].type == "tree") {
                                _this.model.name = _this.model.name + "/" + r[0].name;
                                _this.model.path = r[0].path
                            } else {
                                Vue.set(_this.model, 'children', [])
                                Vue.set(_this.model, 'open', true)
                                _this.model.children = r;
                            }
                        });
                    } else {
                        this.model.open = !this.model.open;
                    }
                } else {
                    var href = rep + "/" + this.model.path;
                    sessionStorage.setItem("show", this.model.path);
                    window.location.href = href;
                }
            }
        }
    })
    new Vue({
        el: '#tree',
        data: {
            treeData: {}
        },
        mounted: function () {
            initVariables();
            $.ajaxSettings.async = false;
            this.treeData = {
                name: repname,
                type: "tree",
                children: [],
                open: true
            }
            var _this = this;
            $.get(apiRepoTree, {
                id: project_id,
                ref_name: repository_ref
            })
                .done(function (result) {
                    _this.treeData.children = result;
                    sessionStorage.setItem("data", JSON.stringify(_this.treeData));
                });
            this.treeData = initPath(this.treeData);
            initCss();
        }
    })

})();
