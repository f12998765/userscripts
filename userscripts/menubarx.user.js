// ==UserScript==
// @name         MenubarX WebAppList Editor
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  修改 MenubarX 的 WebAppList，支持导入导出、远程更新功能，美化界面
// @author       Your name
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
        imagesStore: 'images',
        urlKey: 'webapplist_url',
        backupKey: 'all_data_backup',
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

    // Blob 转 base64
    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // base64 转 Blob
    function base64ToBlob(base64) {
        const parts = base64.split(';base64,');
        const contentType = parts[0].split(':')[1];
        const raw = window.atob(parts[1]);
        const rawLength = raw.length;
        const uInt8Array = new Uint8Array(rawLength);

        for (let i = 0; i < rawLength; ++i) {
            uInt8Array[i] = raw.charCodeAt(i);
        }

        return new Blob([uInt8Array], { type: contentType });
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
                if (!db.objectStoreNames.contains(CONFIG.imagesStore)) {
                    db.createObjectStore(CONFIG.imagesStore);
                }
            };
            request.onsuccess = () => resolve(request.result);
        });
    }

      // =============== 数据操作函数 ===============

    // 从远程获取所有数据
    async function fetchAllData() {
        const url = getConfigUrl();
        if (!url) {
            throw new Error('请先设置获取URL！');
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
                            const data = JSON.parse(response.responseText);
                            if (!data.webAppList || !data.images) {
                                throw new Error('远程数据格式错误');
                            }
                            resolve(data);
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

    // 更新所有数据
    async function updateAllData() {
        try {
            // 获取远程数据
            const remoteData = await fetchAllData();

            // 更新 WebAppList
            await updateWebappList(JSON.stringify(remoteData.webAppList));

            // 更新图片数据
            const db = await initDatabase();
            const transaction = db.transaction([CONFIG.imagesStore], 'readwrite');
            const store = transaction.objectStore(CONFIG.imagesStore);

            // 清空现有图片数据
            await new Promise((resolve, reject) => {
                const request = store.clear();
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve();
            });

            // 恢复图片数据
            for (const item of remoteData.images) {
                const blob = base64ToBlob(item.data);
                await new Promise((resolve, reject) => {
                    const request = store.put(blob, item.key);
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => resolve();
                });
            }

            // 修复：正确统计应用数量
            let appsCount = 0;
            if (remoteData.webAppList && remoteData.webAppList.webapps) {
                appsCount = remoteData.webAppList.webapps.reduce((count, category) => {
                    return count + (category.l ? category.l.length : 0);
                }, 0);
            }

            const imagesCount = Array.isArray(remoteData.images) ? remoteData.images.length : 0;

            notify('更新成功',
                `已更新数据：\n- WebAppList: ${appsCount} 个应用\n- 图片: ${imagesCount} 个`
            );

        } catch (error) {
            notify('更新失败', error.message, true);
        }
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

            console.log('WebAppList 更新成功');
            db.close();

        } catch (error) {
            console.error('WebAppList 更新失败:', error);
            throw error;
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

    // 获取当前所有数据
    async function getCurrentAllData() {
        const webAppList = await getCurrentWebAppList();
        const db = await initDatabase();
        const transaction = db.transaction([CONFIG.imagesStore], 'readonly');
        const store = transaction.objectStore(CONFIG.imagesStore);

        const images = await new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result || []);
        });

        const keys = await new Promise((resolve, reject) => {
            const request = store.getAllKeys();
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result || []);
        });

        const imagesData = await Promise.all(
            images.map(async (blob, index) => {
                const base64 = await blobToBase64(blob);
                return {
                    key: keys[index],
                    data: base64
                };
            })
        );

        return {
            timestamp: new Date().toISOString(),
            webAppList: JSON.parse(webAppList),
            images: imagesData
        };
    }

    // 保存备份
    function saveBackup(data) {
        try {
            const backups = GM_getValue(CONFIG.backupKey, []);
            const backup = {
                data: data,
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

    // 设置URL的处理函数
    function handleSetUrl() {
        const currentUrl = getConfigUrl();
        const newUrl = prompt('请输入获取数据的URL:', currentUrl);

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

    // 导出所有数据
    async function handleExportAll() {
        try {
            const currentData = await getCurrentAllData();

            // 打印到控制台
            console.log('当前数据:', currentData);

            // 转换为 JSON 字符串并复制到剪贴板
            const jsonString = JSON.stringify(currentData);
            copyToClipboard(jsonString);

            // 修复：正确统计应用数量
            let appsCount = 0;
            if (currentData.webAppList && currentData.webAppList.webapps) {
                appsCount = currentData.webAppList.webapps.reduce((count, category) => {
                    return count + (category.l ? category.l.length : 0);
                }, 0);
            }

            const imagesCount = Array.isArray(currentData.images) ? currentData.images.length : 0;

            notify('导出成功',
                `数据已复制到剪贴板！\n- WebAppList: ${appsCount} 个应用\n- 图片: ${imagesCount} 个`
            );

        } catch (error) {
            notify('导出失败', error.message, true);
        }
    }

    // 更新处理函数
    async function handleUpdate() {
        try {
            const url = getConfigUrl();
            if (!url) {
                if (confirm('未设置获取URL，是否现在设置？')) {
                    handleSetUrl();
                }
                return;
            }

            if (!confirm('是否从远程获取并更新所有数据？')) {
                return;
            }

            // 获取当前数据作为备份
            const currentData = await getCurrentAllData();

            // 保存备份
            if (saveBackup(currentData)) {
                console.log('已保存当前数据的备份');
            }

            // 更新数据
            await updateAllData();

        } catch (error) {
            notify('更新失败', error.message, true);
        }
    }

    // 注册菜单命令
    GM_registerMenuCommand('📝 设置获取URL', handleSetUrl);
    GM_registerMenuCommand('💾 导出所有数据', handleExportAll);
    GM_registerMenuCommand('🔄 从远程更新数据', handleUpdate);

})();
