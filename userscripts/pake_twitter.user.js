// ==UserScript==
// @name         Pake 风格 Twitter 精简
// @namespace    https://github.com/tw93/Pake
// @version      1.0.0
// @description  还原 Pake 原始 Twitter 样式，仅将时间线宽度固定为 800px
// @author       Pake (tw93) / 油猴提取
// @match        https://twitter.com/*
// @match        https://x.com/*
// @match        https://mobile.twitter.com/*
// @match        https://mobile.x.com/*
// @grant        GM_addStyle
// @run-at       document-start
// @license      GPL-3.0
// ==/UserScript==

(function () {
  'use strict';

  const css = `
    /* ========== 隐藏推广推文 & 各类入口 ========== */
    #react-root [data-testid="placementTracking"] article,
    #react-root a[href*="quick_promote_web"],
    #react-root a[href*="/lists"][role="link"][aria-label],
    #react-root a[href*="/i/communitynotes"][role="link"][aria-label],
    #react-root a[role="link"][aria-label="Communities"],
    #react-root a[role="link"][aria-label="Premium"],
    #react-root a[role="link"][aria-label="SuperGrok"],
    #react-root a[href*="/i/verified-orgs-signup"][role="link"][aria-label] {
      display: none !important;
    }

    /* ========== 隐藏抽屉 ========== */
    #react-root [data-testid="DMDrawer"],
    #react-root [data-testid="GrokDrawer"],
    #react-root [data-testid="chat-drawer-root"],
    #root > main > footer.justify-center.ease-in {
      visibility: hidden !important;
    }

    /* ========== 时间线主体微调 ========== */
    #react-root [data-testid="primaryColumn"] > div > div {
      position: relative !important;
    }

    /* ========== 彻底隐藏右侧栏 ========== */
    #react-root [data-testid="sidebarColumn"] {
      visibility: hidden !important;
      width: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      z-index: 1 !important;
    }

    /* ========== 桌面端布局（Pake 原始 + 时间线 800px） ========== */
    @media only screen and (min-width: 1000px) {
      #react-root main[role="main"] {
        align-items: center !important;
        overflow-x: clip !important;
      }

      #react-root [data-testid="primaryColumn"] {
        width: 800px !important;
        max-width: 800px !important;
        margin: 0 auto !important;
      }

      #react-root [data-testid="primaryColumn"] > div > div:last-child,
      #react-root [data-testid="primaryColumn"] > div > div:last-child div {
        max-width: unset !important;
      }

      #react-root div[aria-label][role="group"][id^="id__"] {
        margin-right: 81px !important;
      }

      /* 左侧导航固定 */
      #react-root header[role="banner"] {
        position: fixed !important;
        left: 0 !important;
      }

      #react-root header[role="banner"] > div > div > div {
        justify-content: center !important;
        padding-top: 0;
        overflow-x: hidden;
      }

      #react-root form[role="search"] > div:nth-child(1) > div {
        background-color: transparent !important;
      }

      #react-root h1[role="heading"] {
        padding-top: 4px !important;
      }

      /* 导航标签：悬停显示（Pake 原始） */
      #react-root header[role="banner"]
        nav[role="navigation"]
        *
        div[dir="auto"]:not([aria-label])
        > span,
      #react-root [data-testid="SideNav_AccountSwitcher_Button"] > div:not(:first-child) {
        display: inline-block !important;
        opacity: 0 !important;
        transition: 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
      }

      #react-root header[role="banner"]
        nav[role="navigation"]:hover
        *
        div[dir="auto"]:not([aria-label])
        > span,
      #react-root [data-testid="SideNav_AccountSwitcher_Button"]:hover > div:not(:first-child) {
        opacity: 1 !important;
      }

      #react-root header[role="banner"] nav[role="navigation"]:hover > * > div {
        backdrop-filter: blur(12px) !important;
      }

      #react-root header[role="banner"] nav[role="navigation"] > a {
        position: relative;
      }

      #react-root header[role="banner"] nav[role="navigation"] > a::before {
        content: "";
        position: absolute;
        top: 0px;
        right: -40px;
        bottom: 0px;
        left: 0px;
      }

      #react-root [data-testid="SideNav_NewTweet_Button"] {
        position: fixed !important;
        right: 16px !important;
        bottom: 24px !important;
      }
    }
  `;

  // 注入样式
  if (typeof GM_addStyle !== 'undefined') {
    GM_addStyle(css);
  } else {
    const style = document.createElement('style');
    style.textContent = css;
    document.documentElement.appendChild(style);
  }
})();
