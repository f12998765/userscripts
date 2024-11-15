// ==UserScript==
// @name         MenubarX WebAppList Editor
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  修改 MenubarX 的 WebAppList，支持导入导出、备份恢复功能，美化界面
// @author       kk
// @match        https://menubarx.app/search/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // 添加自定义样式
    const customStyle = `
        /* 隐藏滚动条但保持滚动功能 */
        * {
            -ms-overflow-style: none;  /* IE and Edge */
            scrollbar-width: none;     /* Firefox */
        }

        /* Webkit browsers like Chrome/Safari */
        *::-webkit-scrollbar {
            display: none;
        }
    `;

    // 创建并插入样式
    const styleElement = document.createElement('style');
    styleElement.textContent = customStyle;
    document.head.appendChild(styleElement);


    // 配置常量
    const CONFIG = {
        dbName: 'XDatabase',
        storeName: 'webapps',
        urlKey: 'webapplist_url',
        backupKey: 'webapplist_backup',
        maxBackups: 5
    };

    // =============== 工具函数 ===============

    // 通知函数
    function notify(title, text, isError = false) {
        alert(`${title}\n${text}`);

        if (isError) {
            console.error(text);
        } else {
            console.log(text);
        }
    }

    // 获取配置的URL
    function getConfigUrl() {
        return GM_getValue(CONFIG.urlKey, '');
    }

    // 设置URL
    function setConfigUrl(url) {
        GM_setValue(CONFIG.urlKey, url);
    }

    // 设置URL的处理函数
    function handleSetUrl() {
        const currentUrl = getConfigUrl();
        const newUrl = prompt('请输入获取 WebAppList 的URL:', currentUrl);

        if (newUrl === null) return; // 用户取消

        if (newUrl.trim() === '') {
            alert('URL不能为空！');
            return;
        }

        try {
            new URL(newUrl); // 验证URL格式
            setConfigUrl(newUrl.trim());
            alert('URL设置成功！');
        } catch (e) {
            alert('请输入有效的URL！');
        }
    }

    // 初始化数据库
    async function initDatabase() {
        const dbName = CONFIG.dbName;
        const storeName = CONFIG.storeName;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName);
            request.onerror = () => reject(request.error);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    const store = db.createObjectStore(storeName);
                    store.put('[]', 'webAppList');
                }
            };
            request.onsuccess = () => resolve(request.result);
        });
    }

    // 从远程获取 WebAppList 数据
    async function fetchWebAppList() {
        const url = getConfigUrl();
        if (!url) {
            throw new Error('请先设置获取 WebAppList 的URL！');
        }

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                headers: {
                    'Accept': 'application/json'
                },
                onload: function(response) {
                    try {
                        if (response.status === 200) {
                            resolve(response.responseText);
                        } else {
                            reject(new Error('HTTP Error: ' + response.status));
                        }
                    } catch (error) {
                        reject(new Error('请求失败: ' + error.message));
                    }
                },
                onerror: function(error) {
                    reject(new Error('请求失败: ' + error.message));
                }
            });
        });
    }

    // 更新 WebAppList
    async function updateWebappList(jsonString) {
        try {
            const db = await initDatabase();
            const transaction = db.transaction([CONFIG.storeName], 'readwrite');
            const store = transaction.objectStore(CONFIG.storeName);

            await new Promise((resolve, reject) => {
                const request = store.put(jsonString, 'webAppList');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve();
            });

            await new Promise((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });

            console.log('更新成功');
            db.close();

            alert('WebAppList 更新成功！');

        } catch (error) {
            console.error('更新失败:', error);
            alert('更新失败: ' + error.message);
        }
    }

    // 获取当前 WebAppList
    async function getCurrentWebAppList() {
        try {
            const db = await initDatabase();
            const transaction = db.transaction([CONFIG.storeName], 'readonly');
            const store = transaction.objectStore(CONFIG.storeName);

            const data = await new Promise((resolve, reject) => {
                const request = store.get('webAppList');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result || '[]');
            });

            db.close();
            return data;

        } catch (error) {
            console.error('读取失败:', error);
            throw error;
        }
    }

    // 复制到剪贴板
    function copyToClipboard(text) {
        try {
            GM_setClipboard(text);
            return true;
        } catch (err) {
            console.error('复制失败:', err);
            return false;
        }
    }

    // 备份管理
    function saveBackup(jsonString) {
        try {
            const backups = GM_getValue(CONFIG.backupKey, []);
            const backup = {
                data: jsonString,
                timestamp: new Date().toISOString(),
                url: getConfigUrl()
            };

            backups.unshift(backup);
            if (backups.length > CONFIG.maxBackups) {
                backups.pop();
            }

            GM_setValue(CONFIG.backupKey, backups);
            return true;
        } catch (error) {
            console.error('备份失败:', error);
            return false;
        }
    }

    // =============== 处理函数 ===============

    // 导出 WebAppList 处理函数
    async function handleExport() {
        try {
            const jsonString = await getCurrentWebAppList();

            // 打印到控制台
            console.log('当前 WebAppList:', JSON.parse(jsonString));
            console.log('WebAppList JSON 字符串:', jsonString);

            // 复制到剪贴板
            copyToClipboard(jsonString);
            notify('导出成功', 'WebAppList 已复制到剪贴板！');

        } catch (error) {
            notify('导出失败', error.message, true);
        }
    }

    // 更新处理函数增强版
    async function handleUpdate() {
        try {
            const url = getConfigUrl();
            if (!url) {
                if (confirm('未设置获取URL，是否现在设置？')) {
                    handleSetUrl();
                }
                return;
            }

            if (!confirm('是否从远程获取并更新 WebAppList？')) {
                return;
            }

            // 获取当前数据作为备份
            const currentData = await getCurrentWebAppList();

            // 获取新数据
            const jsonString = await fetchWebAppList();

            // 保存备份
            if (saveBackup(currentData)) {
                console.log('已保存当前数据的备份');
            }

            // 更新数据
            await updateWebappList(jsonString);

        } catch (error) {
            notify('更新失败', error.message, true);
        }
    }

    // 恢复备份处理函数
    async function handleRestore() {
        try {
            const backups = GM_getValue(CONFIG.backupKey, []);
            if (backups.length === 0) {
                notify('恢复失败', '没有可用的备份');
                return;
            }

            const backupList = backups.map((b, i) =>
                `${i + 1}. ${new Date(b.timestamp).toLocaleString()} (URL: ${b.url})`
            ).join('\n');

            const choice = prompt(
                `选择要恢复的备份编号 (1-${backups.length}):\n${backupList}`,
                '1'
            );

            if (!choice) return;

            const index = parseInt(choice) - 1;
            if (isNaN(index) || index < 0 || index >= backups.length) {
                notify('恢复失败', '无效的备份编号');
                return;
            }

            const backup = backups[index];
            await updateWebappList(backup.data);
            notify('恢复成功', `已恢复到 ${new Date(backup.timestamp).toLocaleString()} 的备份`);

        } catch (error) {
            notify('恢复失败', error.message, true);
        }
    }

    // 注册菜单命令
    GM_registerMenuCommand('📝 设置获取URL', handleSetUrl);
    GM_registerMenuCommand('📋 复制 WebAppList', handleExport);
    GM_registerMenuCommand('🔄 更新 WebAppList', handleUpdate);
    GM_registerMenuCommand('⏪ 恢复备份', handleRestore);

})();
