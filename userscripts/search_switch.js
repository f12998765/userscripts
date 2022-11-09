// ==UserScript==
// @name         搜索引擎切换器 / Search Engine Switcher
// @namespace    http://tampermonkey.net/
// @version      0.1

// @match        *://www.baidu.com/s*
// @match        *://www.baidu.com/baidu*
// @match        *://duckduckgo.com/*
// @match        *://search.brave.com/search*
// @match        *://www.google.com/search*
// @match        *://www.google.com.hk/search*
// @match        *://weixin.sogou.com/weixin*
// @match        *://www.bing.com/search*
// @match        *://cn.bing.com/search*
// @match        *://www.zhihu.com/search*
// @match        *://search.cnki.com.cn/Search/Result*
// @match        *://www.sogou.com/web*
// @match        *://fsoufsou.com/search*
// @match        *://neeva.com/search*

// @grant        unsafeWindow
// @grant        window.onload
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-body

// @license     MIT
// ==/UserScript==

// 搜索网址配置
const urlMapping = [
    {
        name: "Google",
        searchUrl: "https://www.google.com/search?q=",
        keyName: "q",
        testUrl: /https:\/\/www.google.com\/search.*/,
    },
    {
        name: "V2ex",
        searchUrl: "https://www.google.com/search?q=site:v2ex.com%20",
        keyName: "q",
        testUrl: /https:\/\/www.google.com\/search.*/,
    },
    {
        name: "DuckDuckGo",
        searchUrl: "https://duckduckgo.com/?q=",
        keyName: "q",
        testUrl: /https:\/\/duckduckgo.com\/*/,
    },
    {
        name: "Brave",
        searchUrl: "https://search.brave.com/search?q=",
        keyName: "q",
        testUrl: /https:\/\/search.brave.com\/search.*/,
    },
    {
        name: "百度",
        searchUrl: "https://www.baidu.com/s?wd=",
        keyName: "wd",
        testUrl: /https:\/\/www.baidu.com\/s.*/,
    }
];

// JS获取url参数
function getQueryVariable(item) {
    let query = window.location.search.substring(1);
    let pairs = query.split("&");
    for (let pair of pairs) {
        let [key, value] = pair.split("=");
        if (key == item.keyName) {
            value = value.replace("site:v2ex.com", "").replace(" ", "");
            console.log(value)
            return decodeURIComponent(value);
        }
    }
    return null;
}

// 从url中获取搜索关键词
function getKeywords() {
    let keywords = "";
    let url = window.location.href;
    for (let item of urlMapping) {
        if (item.testUrl.test(url)) {
            keywords = getQueryVariable(item);
            break;
        }
    }
    console.log(keywords);
    return keywords;
}

// 适配火狐浏览器的百度搜索
const isFirefox = () => {
    if (navigator.userAgent.indexOf("Firefox") > 0) {
        console.warn("[ Firefox ] 🚀");
        urlMapping[0].searchUrl = "https://www.baidu.com/baidu?wd=";
        urlMapping[0].testUrl = /https:\/\/www.baidu.com\/baidu.*/;
    } else {
        return;
    }
};

// 适配cn.bing.com的必应域名
const cnBing = {
    name: "Bing",
    searchUrl: "https://cn.bing.com/search?q=",
    keyName: "q",
    testUrl: /https:\/\/cn.bing.com\/search.*/,
};

// 匹配到cn.bing就修改必应配置对象
if (window.location.hostname === 'cn.bing.com') {
    for (let item of urlMapping) {
        if (item.name === "Bing") {
            item = cnBing
        }
    }
}

// 添加节点
function addBox() {
    isFirefox();
    // 主元素
    const div = document.createElement("div");
    div.id = "search-app-box";
    div.style = `
    position: fixed; 
    top: 140px; 
    left: 12px; 
    width: 88px; 
    background-color: hsla(200, 40%, 96%, .8); 
    font-size: 12px; 
    border-radius: 6px; 
    z-index: 99999;`;
    document.body.insertAdjacentElement("afterbegin", div);

    // 标题
    let title = document.createElement("span");
    title.innerText = "搜索引擎";
    title.style = `
    display: block;
	color: hsla(211, 60%, 35%, .8);
    text-align: center;
    margin-top: 10px; 
    margin-bottom: 5px;
    font-size: 12px;
    font-weight: bold;
    -webkit-user-select:none;
    -moz-user-select:none;
    -ms-user-select:none;
    user-select:none;`;
    div.appendChild(title);

    // 搜索列表
    for (let index in urlMapping) {
        let item = urlMapping[index];

        // 列表样式
        let style = `
        display: block; 
		color: hsla(211, 60%, 35%, .8) !important;
        padding: 8px; 
        text-decoration: none;`;
        let defaultStyle = style + "color: hsla(211, 60%, 35%, .8) !important;";
        let hoverStyle =
            style + "background-color: hsla(211, 60%, 35%, .1);";

        // 设置搜索引擎链接
        let a = document.createElement("a");
        a.innerText = item.name;
        a.style = defaultStyle;
        a.className = "search-engine-a";
        a.href = item.searchUrl + getKeywords();

        // 鼠标移入&移出效果，相当于hover
        a.onmouseenter = function () {
            this.style = hoverStyle;
        };
        a.onmouseleave = function () {
            this.style = defaultStyle;
        };
        div.appendChild(a);
    }
}

(function () {
    "use strict";
    window.onload = addBox();
})();