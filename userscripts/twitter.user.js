// ==UserScript==
// @name         X 精简版(Minimal × Pake 合并)
// @namespace    https://github.com/typefully/minimal-twitter
// @version      1.3.1
// @description  去广告与抽屉、侧栏悬停显示文字+图标居中、时间线 800px、顶部原生固定、右上角常驻搜索栏、媒体/私信布局保护;脚本内数组配置左侧菜单显隐。纯 CSS 为主,页面加载前注入,无闪烁。
// @author       Minimal Theme (Typefully, MIT) × Pake (tw93, GPL-3.0) 合并精简
// @license      MIT
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.twitter.com/*
// @run-at       document-start
// @noframes
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  /* =====================================================
   * 配置区(按需修改,改完保存刷新即生效)
   * ===================================================== */

  // 1. 左侧栏延迟显示的秒数,0 = 立即显示(已默认关闭)
  const SIDEBAR_REVEAL_DELAY = 0;

  // 2. 左侧导航菜单显隐,把 key 填进对应数组即可
  //    可用 key:
  //      home=主页         explore=探索      notifications=通知
  //      messages=私信     grok=Grok        premium=Premium
  //      lists=列表        bookmarks=书签    jobs=工作
  //      communities=社区  articles=文章     topics=话题
  //      verifiedOrgs=认证机构               profile=个人资料
  //    规则:同一项同时出现在两个数组时,以「显示」为准
  const SHOWN_ITEMS = [];                            // 强制显示
  const HIDDEN_ITEMS = ["grok", "premium", "lists"]; // 隐藏

  // 3. 额外隐藏:没有固定 key 的杂项入口,直接写选择器
  const EXTRA_HIDDEN_SELECTORS = [
    'header[role="banner"] a[data-testid="AppTabBar_Follow_Link"]',
    'header[role="banner"] a[href*="/i/history"][role="link"]',
    'header[role="banner"] a[href*="creators/studio"][role="link"]',
    'header[role="banner"] h1[role="heading"]',
    'header[role="banner"] a[href*="/i/verified-orgs-signup"][role="link"]',
    'header[role="banner"] a[href*="supergrok"][role="link"]',
    'header[role="banner"] a[href*="/i/grok/super"][role="link"]',
    'header[role="banner"] a[href*="/settings/monetization"][role="link"]',
    'header[role="banner"] a[href*="/i/premium_sign_up"][role="link"]',
  ];

  // 4. 搜索框展开后的宽度(px)。原值 374 会压住时间线,收敛到 260
  const SEARCH_EXPANDED_WIDTH = 260;

  /* =====================================================
   * 以下为实现,一般不需要改动
   * ===================================================== */

  const SIDEBAR_SELECTORS = {
    home: '[data-testid="AppTabBar_Home_Link"]',
    explore: '[data-testid="AppTabBar_Explore_Link"]',
    notifications: '[data-testid="AppTabBar_Notifications_Link"]',
    messages: '[data-testid="AppTabBar_DirectMessage_Link"]',
    grok: 'a[href*="grok"][role="link"][aria-label]',
    premium: 'a[href*="premium"][role="link"][aria-label]',
    lists: 'a[href*="/lists"][role="link"][aria-label]',
    bookmarks: 'a[href*="bookmarks"]',
    jobs: 'a[href*="jobs"]',
    communities: 'a[href*="communities"]',
    articles: 'a[href="/compose/articles"]',
    topics: 'a[href*="topics"]',
    verifiedOrgs: 'a[href*="verified-orgs"][role="link"][aria-label]',
    profile: '[data-testid="AppTabBar_Profile_Link"]',
  };

  /* ---- 主样式 ---- */

  const css = `
    /* 1. 去广告(推广帖 / 快速推广入口) */
    [data-testid="placementTracking"] article,
    a[href*="quick_promote_web"] {
      display: none !important;
    }

    /* 2. 隐藏抽屉(DM 抽屉 / Grok 抽屉 / 聊天挂件) */
    [data-testid="DMDrawer"],
    [data-testid="chat-drawer-root"] {
      visibility: hidden !important;
    }
    [data-testid="GrokDrawer"] {
      display: none !important;
    }

    /* 3. 右侧栏整体隐藏,搜索栏单独浮出到右上角 */
    [data-testid="sidebarColumn"] {
      visibility: hidden;
      width: 0;
      margin: 0;
      padding: 0;
      z-index: 1;
    }
    @media only screen and (min-width: 1100px) {
      [data-testid="sidebarColumn"] form[role="search"] {
        visibility: visible;
        position: fixed;
        top: 12px;
        right: 16px;
        width: auto;
        z-index: 2;
      }
      [data-testid="sidebarColumn"] form[role="search"] input[role="combobox"] {
        width: 150px;
      }
      /* 展开宽度收敛,避免压住主内容(原 374px 会重叠 70px) */
      [data-testid="sidebarColumn"] form[role="search"]:focus-within {
        width: ${SEARCH_EXPANDED_WIDTH}px;
        backdrop-filter: blur(12px);
      }
      [data-testid="sidebarColumn"] form[role="search"] input:focus {
        width: 100% !important;
      }
      div[style*="left: -12px"] {
        left: unset;
      }
      div[style="left: -8px; width: 306px;"] {
        left: unset;
        width: ${SEARCH_EXPANDED_WIDTH}px;
      }
    }

    /* 4. 时间线 800px + 居中(≥988px) */
    @media only screen and (min-width: 988px) {
      main[role="main"] {
        align-items: center;
        overflow-x: clip;
      }
      [data-testid="primaryColumn"] {
        width: 800px !important;
        max-width: 800px !important;
        margin: 0 auto;
      }
      [data-testid="primaryColumn"] > div > div:last-child,
      [data-testid="primaryColumn"]
        > div
        > div:last-child
        div:not([data-testid="dm-message-list-container"] *) {
        max-width: unset;
      }
    }

    /* 5. 左侧导航:固定定位 + 图标居中 + 悬停显示文字 */
    @media only screen and (min-width: 1000px) {
      header[role="banner"] {
        align-items: flex-start;
        position: fixed;
        left: 0;
      }

      header[role="banner"] > div > div > div {
        justify-content: center !important;
        padding-top: 0;
        overflow-x: hidden;
      }

      header[role="banner"] > div > div > div > div:last-child {
        margin-bottom: 0 !important;
      }
      [data-testid="SideNav_AccountSwitcher_Button"] {
        bottom: 12px;
      }
      header[role="banner"] > div > div > div > div:first-child {
        flex-shrink: 1;
        overflow-y: auto;
      }

      /* 文字标签:默认透明占位,悬停整列时淡入 */
      header[role="banner"] nav[role="navigation"] > * > div > div + div:last-child,
      [data-testid="SideNav_AccountSwitcher_Button"] > div:not(:first-child) {
        display: inline-block;
        opacity: 0;
        transition: 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      header[role="banner"] nav[role="navigation"]:hover > * > div > div + div:last-child,
      [data-testid="SideNav_AccountSwitcher_Button"]:hover > div:not(:first-child) {
        opacity: 1;
      }
      header[role="banner"] nav[role="navigation"]:hover > * > div {
        backdrop-filter: blur(12px);
      }

      /* 悬停热区:收回到链接内部,避免撑破 overflow 容器产生横向滚动条 */
      header[role="banner"] nav[role="navigation"] > a {
        position: relative;
      }
      header[role="banner"] nav[role="navigation"] > a::before {
        content: "";
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
      }

      /* 发推按钮悬浮到右下角 */
      [data-testid="SideNav_NewTweet_Button"] {
        position: fixed;
        right: 16px;
        bottom: 24px;
      }
    }

    /* 6. 1000–1265px 中间断点:导航固定后补回占位 */
    @media only screen and (min-width: 1000px) and (max-width: 1265px) {
      body {
        padding-left: 88px;
      }
    }

    /* 7. 左侧栏:消除横向溢出(双保险) */
    header[role="banner"] > div > div > div > div:first-child {
      overflow-x: hidden !important;
      overflow-y: auto !important;
      scrollbar-width: none !important;
    }
    header[role="banner"] > div > div > div > div:first-child::-webkit-scrollbar {
      width: 0 !important;
      height: 0 !important;
      display: none !important;
    }
  `.trim().replace(/\n\s+/g, "\n");

  /* ---- 左侧栏延迟淡入(默认关闭) ---- */

  const revealCss =
    SIDEBAR_REVEAL_DELAY > 0
      ? `
      header[role="banner"] {
        opacity: 0;
        animation: mt-sidebar-reveal 0.3s ease ${SIDEBAR_REVEAL_DELAY}s forwards;
      }
      @keyframes mt-sidebar-reveal {
        to { opacity: 1; }
      }
    `.trim()
      : "";

  if (typeof GM_addStyle === "function") {
    GM_addStyle(css + "\n" + revealCss);
  } else {
    const style = document.createElement("style");
    style.textContent = css + "\n" + revealCss;
    (document.head || document.documentElement).appendChild(style);
  }

  /* ---- 左侧菜单隐藏(独立 style 标签) ---- */

  function buildSidebarHideCss() {
    const byKey = Object.keys(SIDEBAR_SELECTORS)
      .filter((key) => HIDDEN_ITEMS.includes(key) && !SHOWN_ITEMS.includes(key))
      .map((key) => `header[role="banner"] ${SIDEBAR_SELECTORS[key]} { display: none !important; }`);
    const extra = EXTRA_HIDDEN_SELECTORS.map((sel) => `${sel} { display: none !important; }`);
    return [...byKey, ...extra].join("\n");
  }

  (function applySidebarHideCss() {
    const el = document.createElement("style");
    el.id = "mt-sidebar-hide";
    el.textContent = buildSidebarHideCss();
    (document.head || document.documentElement).appendChild(el);
  })();

  /* ---- 加载期兜底:拦截侧栏异步插入的推广/订阅卡片 ---- */

  (function startPromoCardPruner() {
    const attach = () => {
      const header = document.querySelector('header[role="banner"]');
      if (!header) return false;

      const looksLikePromo = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const hasPromo = el.querySelector(
          'a[href*="premium"], a[href*="grok"], a[href*="monetization"], a[href*="verified-orgs"]'
        );
        const isNavPiece = el.querySelector(
          'nav[role="navigation"], [data-testid^="AppTabBar_"], [data-testid="SideNav_NewTweet_Button"], [data-testid="SideNav_AccountSwitcher_Button"]'
        );
        return !!hasPromo && !isNavPiece;
      };

      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (looksLikePromo(node)) {
              node.style.display = "none";
            }
          }
        }
      });
      observer.observe(header, { childList: true, subtree: true });
      return true;
    };

    if (!attach()) {
      document.addEventListener("DOMContentLoaded", attach, { once: true });
    }
  })();
})();