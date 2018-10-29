// ==UserScript==
// @name         v2ex filter
// @version      0.1
// @author        xizero
// @description  眼不见，心不烦
// @include        *://*.v2ex.com/*
// @require  https://cdnjs.cloudflare.com/ajax/libs/jquery/3.1.1/jquery.min.js
// ==/UserScript==


(function() {
    'use strict';
    var list = ["内推", "招聘", "校招", "学历", "求职", "社招", "offer", "实习", "内推", "应届"]
    for (var i in list) {
        $(".item:contains('" + list[i] + "')").hide();
    }
})();
