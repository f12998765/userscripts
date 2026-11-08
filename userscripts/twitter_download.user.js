// ==UserScript==
// @name         X/Twitter 媒体下载
// @version      0.1.1
// @description  下载 X/Twitter 图片、视频、GIF，视频可转换为 GIF（10fps 流畅，最长 20 秒，自适应分辨率），GIF 转换进度以右下角圆环显示；图片右键菜单增加「复制图片」
// @license      MIT
// @match        https://twitter.com/*
// @match        https://x.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=twitter.com
// @connect      twitter.com
// @connect      x.com
// @connect      pbs.twimg.com
// @connect      video.twimg.com
// @connect      cdn.jsdelivr.net
// @connect      raw.githubusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @require      https://cdn.jsdelivr.net/npm/gif.js.optimized@1.0.1/dist/gif.js
// @require      https://raw.githubusercontent.com/f12998765/widgets/refs/heads/main/RingProgress.js
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*jshint esversion: 11 */

(function () {
    "use strict";

    // ============================================================
    //  常量
    // ============================================================
    const WORKER_URL = 'https://cdn.jsdelivr.net/npm/gif.js.optimized@1.0.1/dist/gif.worker.js';
    const MAX_DURATION = 20;
    const FRAME_BUDGET = 200;
    const GIF_TIMEOUT = 180000;
    const SEEK_TIMEOUT = 3000;

    // ============================================================
    //  进度圆环（右侧往上）
    // ============================================================
    const RING_SIZE = 110;
    const RING_RIGHT = 24;      // 距右侧
    const RING_BOTTOM = 120;    // 距底部（往上至少 100px）

    const ringStyle = document.createElement('style');
    ringStyle.textContent = `
        .tmd-ring .grp-btn {
            left: auto !important;
            top: auto !important;
            right: ${RING_RIGHT}px !important;
            bottom: ${RING_BOTTOM}px !important;
            transform: none !important;
            pointer-events: none;
            opacity: 0;
            transition: opacity .3s ease;
            z-index: 2147483646;
        }
        .tmd-ring.tmd-ring-visible .grp-btn {
            opacity: 1;
        }
        .tmd-ring .grp-btn:hover {
            transform: none !important;
        }
    `;
    document.head.appendChild(ringStyle);

    const ringWrapper = document.createElement('div');
    ringWrapper.className = 'tmd-ring';
    document.documentElement.appendChild(ringWrapper);

    let ringProgress = null;
    function initRing() {
        if (ringProgress) return ringProgress;
        ringProgress = new RingProgress({
            size: RING_SIZE,
            duration: 300,
            hold: 0,
            autoStart: false
        });
        if (ringProgress.btn && ringProgress.btn.parentNode) {
            ringWrapper.appendChild(ringProgress.btn);
        }
        return ringProgress;
    }

    function showRing() {
        ringWrapper.classList.add('tmd-ring-visible');
    }
    function hideRing() {
        ringWrapper.classList.remove('tmd-ring-visible');
    }
    function setRingProgress(p) {
        if (!ringProgress) initRing();
        const clamped = Math.max(0, Math.min(1, p));
        ringProgress.set(clamped);
    }
    function ringComplete(delay = 800) {
        setRingProgress(1);
        setTimeout(() => {
            hideRing();
            setTimeout(() => setRingProgress(0), 300);
        }, delay);
    }
    function ringFail(delay = 1000) {
        setRingProgress(0);
        setTimeout(() => hideRing(), delay);
    }

    // ============================================================
    //  Promise 超时包装
    // ============================================================
    const withTimeout = (promise, ms, msg) =>
        Promise.race([
            promise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(msg || '操作超时')), ms)
            )
        ]);

    // ============================================================
    //  Worker 脚本加载
    // ============================================================
    let workerBlobUrl = null;
    let workerLoading = null;

    const getWorkerUrl = () => {
        if (workerBlobUrl) return Promise.resolve(workerBlobUrl);
        if (workerLoading) return workerLoading;

        workerLoading = new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: WORKER_URL,
                timeout: 30000,
                onload: (res) => {
                    if (res.status < 200 || res.status >= 300) {
                        reject(new Error(`Worker 加载失败: ${res.status}`));
                        return;
                    }
                    workerBlobUrl = URL.createObjectURL(
                        new Blob([res.responseText], { type: 'application/javascript' })
                    );
                    resolve(workerBlobUrl);
                },
                onerror: () => reject(new Error('Worker 网络请求失败')),
                ontimeout: () => reject(new Error('Worker 加载超时'))
            });
        }).catch((e) => {
            workerLoading = null;
            workerBlobUrl = null;
            throw e;
        });

        return workerLoading;
    };

    // ============================================================
    //  文件名
    // ============================================================
    const generateFilename = (el, type, index, ext) => {
        const base = `{userId}-{postId}-{mediaType}{index}`
            .replace(/{userId}/g, el.userId)
            .replace(/{userName}/g, el.userName)
            .replace(/{postId}/g, el.postId)
            .replace(/{postTime}/g, el.postTime
                ? new Date(el.postTime).toISOString().replace(/[-:T]/g, '').slice(0, 14)
                : 'unknown')
            .replace(/{mediaType}/g, type)
            .replace(/{index}/g, index);
        return `${base}.${ext}`;
    };

    // ============================================================
    //  GM_xmlhttpRequest 封装
    // ============================================================
    const gmFetch = (url, opts = {}) =>
        new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: opts.method || 'GET',
                url,
                headers: opts.headers || {},
                responseType: opts.responseType,
                timeout: opts.timeout || 30000,
                onload: (res) => resolve({
                    ok: res.status >= 200 && res.status < 300,
                    status: res.status,
                    response: res.response,
                    json: () => Promise.resolve(res.response),
                    blob: () => Promise.resolve(
                        res.response instanceof Blob ? res.response : new Blob([res.response])
                    )
                }),
                onerror: (e) => reject(new Error(`请求失败: ${e.statusText || '网络错误'}`)),
                onabort: () => reject(new Error('已中止')),
                ontimeout: () => reject(new Error('超时'))
            });
        });

    // ============================================================
    //  X API
    // ============================================================
    const getCookie = (name) =>
        Object.fromEntries(
            document.cookie.split(';')
                .filter(n => n.includes('='))
                .map(n => n.split('=').map(s => s.trim()))
        )[name];

    const apiHeaders = () => {
        const h = {
            'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            'x-csrf-token': getCookie('ct0'),
            'x-twitter-client-language': 'zh-cn',
            'x-twitter-active-user': 'yes',
            'content-type': 'application/json'
        };
        const gt = getCookie('gt');
        if (gt) h['x-guest-token'] = gt;
        else h['x-twitter-auth-type'] = 'OAuth2Session';
        return h;
    };

    const fetchTweetDetail = async (postId) => {
        const QID = 'zAz9764BcLZOJ0JU2wrd1A';
        const features = {
            creator_subscriptions_tweet_preview_api_enabled: true,
            premium_content_api_read_enabled: false,
            communities_web_enable_tweet_community_results_fetch: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,
            articles_preview_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: true,
            tweet_awards_web_tipping_enabled: false,
            freedom_of_speech_not_reach_fetch_enabled: true,
            standardized_nudges_misinfo: true,
            tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
            longform_notetweets_rich_text_read_enabled: true,
            longform_notetweets_inline_media_enabled: true,
            responsive_web_graphql_timeline_navigation_enabled: true,
            responsive_web_enhance_cards_enabled: false
        };
        const fieldToggles = {
            withArticleRichContentState: true,
            withArticlePlainText: false,
            withGrokAnalyze: false,
            withDisallowedReplyControls: false
        };
        const vars = { tweetId: postId, withCommunity: false, includePromotedContent: false, withVoice: false };
        const url = `https://x.com/i/api/graphql/${QID}/TweetResultByRestId`
            + `?variables=${encodeURIComponent(JSON.stringify(vars))}`
            + `&features=${encodeURIComponent(JSON.stringify(features))}`
            + `&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;
        const res = await gmFetch(url, { headers: apiHeaders(), responseType: 'json' });
        if (!res.ok) throw new Error(`推文详情获取失败: ${res.status}`);
        return res.json();
    };

    // ============================================================
    //  DOM 提取
    // ============================================================
    const getMainTweetUrl = (cell) => {
        const t = cell.querySelector('article[data-testid="tweet"] a[href*="/status/"][role="link"] time');
        if (t?.parentElement) return t.parentElement.href;
        return cell.querySelector('article[data-testid="tweet"] a[href*="/status/"]')?.href || '';
    };

    const getMediaInfo = (url) => {
        if (url.includes('pbs.twimg.com/media/')) {
            const m = url.match(/format=([a-zA-Z0-9]+)/);
            return { ext: m ? m[1] : 'jpg', typeLabel: 'img' };
        }
        if (url.includes('video.twimg.com/')) {
            let ext = 'mp4';
            if (!url.includes('/tweet_video/')) {
                const m = url.split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
                if (m) ext = m[1];
            }
            return { ext, typeLabel: url.includes('/tweet_video/') ? 'gif' : 'video' };
        }
        return { ext: 'jpg', typeLabel: 'img' };
    };

    const getMediaElements = (cell) => {
        const images = Array.from(cell.querySelectorAll("img[src^='https://pbs.twimg.com/media/']"))
            .filter(img =>
                !img.closest("div[tabindex='0'][role='link']") &&
                !img.closest("div[data-testid='previewInterstitial']") &&
                !img.closest("div[data-testid='videoPlayer']")
            );

        const videos = [], gifs = [];

        cell.querySelectorAll('video').forEach(v => {
            if (v.closest("div[tabindex='0'][role='link']")) return;
            if (!v.closest("div[data-testid='videoPlayer']")) return;
            if (v.src?.startsWith('https://video.twimg.com/tweet_video')) gifs.push(v);
            else if (v.poster?.match(/\/(ext_tw_video_thumb|amplify_tw_video_thumb|amplify_video_thumb|media)\//))
                videos.push(v);
        });

        cell.querySelectorAll('img[src]').forEach(img => {
            if (img.closest("div[tabindex='0'][role='link']")) return;
            if (!img.closest("div[data-testid='previewInterstitial']") &&
                !img.closest("div[data-testid='videoPlayer']")) return;
            if (img.src.startsWith('https://pbs.twimg.com/tweet_video_thumb/')) gifs.push(img);
            else if (/\/ext_tw_video_thumb\/|\/amplify_tw_video_thumb\/|\/amplify_video_thumb\/|\/media\//.test(img.src))
                videos.push(img);
        });

        return { images, videos, gifs };
    };

    const getFilenameElements = (url, cell) => {
        const m = url.match(/^https?:\/\/(?:twitter\.com|x\.com)\/([^\/]+)\/status\/(\d+)/);
        if (!m) return null;

        const nameEl = cell.querySelector("div[data-testid='User-Name'] div[dir='ltr'] span");
        const timeEl = cell.querySelector("article[data-testid='tweet'] a[href*='/status/'][role='link'] time");

        let userName = 'unknown';
        if (nameEl) {
            userName = '';
            nameEl.querySelectorAll('*').forEach(el => {
                userName += el.nodeName === 'IMG' ? el.alt : (el.nodeName === 'SPAN' ? el.textContent : '');
            });
            userName = userName.trim() || 'unknown';
        }

        return {
            userId: m[1],
            userName,
            postId: m[2],
            postTime: timeEl?.getAttribute('datetime') || null
        };
    };

    const collectMediaURLs = async (cell, el) => {
        const { images, videos, gifs } = getMediaElements(cell);

        const imageURLs = images.map(img =>
            img.src.includes('name=') ? img.src.replace(/name=.*/i, 'name=4096x4096') : img.src
        );

        const gifURLs = gifs.map(g => {
            if (g.src.startsWith('https://pbs.twimg.com/tweet_video_thumb/')) {
                const id = g.src.split('?')[0].split('/').pop().replace(/\.[^.]+$/, '');
                return `https://video.twimg.com/tweet_video/${id}.mp4`;
            }
            return g.src;
        });

        let videoURLs = [];
        if (videos.length > 0) {
            try {
                const res = await fetchTweetDetail(el.postId);
                const result = res?.data?.tweetResult?.result;
                if (result) {
                    const obj = result.tweet || result;
                    const entities = obj.extended_entities || obj.legacy?.extended_entities;
                    if (entities?.media) {
                        videoURLs = entities.media
                            .filter(m => m.type === 'video' && m.video_info?.variants)
                            .map(m => m.video_info.variants
                                .filter(v => v.content_type === 'video/mp4')
                                .reduce((a, b) => (a.bitrate > b.bitrate ? a : b), m.video_info.variants[0])?.url)
                            .filter(Boolean);
                    }
                }
            } catch (e) {
                console.warn('[TMD] 视频地址获取失败:', e);
            }
        }

        return { imageURLs, gifURLs, videoURLs };
    };

    // ============================================================
    //  下载（不接收进度回调，仅用于下载）
    // ============================================================
    const MIME_MAP = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm'
    };

    const downloadBlob = (url) => new Promise((resolve) => {
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
            },
            responseType: 'blob',
            timeout: 120000,
            onload: (res) => {
                if (res.status < 200 || res.status >= 300) {
                    console.error('[TMD] 下载失败:', url, res.status);
                    resolve(null);
                    return;
                }
                let blob = res.response;
                if (!(blob instanceof Blob)) blob = new Blob([blob]);
                const { ext } = getMediaInfo(url);
                const mime = MIME_MAP[ext.toLowerCase()] || blob.type || 'application/octet-stream';
                if (blob.type !== mime) blob = blob.slice(0, blob.size, mime);
                resolve(blob);
            },
            onerror: (e) => {
                console.error('[TMD] 下载错误:', url, e);
                resolve(null);
            },
            ontimeout: () => {
                console.error('[TMD] 下载超时:', url);
                resolve(null);
            },
            onabort: () => resolve(null)
        });
    });

    const triggerSave = (blob, filename) => {
        const a = document.createElement('a');
        a.download = filename;
        a.href = URL.createObjectURL(blob);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    // ============================================================
    //  自适应 GIF 参数
    // ============================================================
    const autoGifParams = (duration, srcWidth) => {
        const fps = 10;
        let maxWidth;

        if (duration <= 2)       maxWidth = 480;
        else if (duration <= 5)  maxWidth = 400;
        else if (duration <= 10) maxWidth = 320;
        else if (duration <= 15) maxWidth = 280;
        else                     maxWidth = 240;

        const quality = 30;
        const totalFrames = Math.min(FRAME_BUDGET, Math.round(fps * duration));

        return {
            fps,
            width: Math.min(maxWidth, srcWidth),
            quality,
            totalFrames
        };
    };

    // ============================================================
    //  视频 → GIF（进度仅反映转换阶段）
    // ============================================================
    const convertToGif = async (videoBlob, onProgress) => {
        const workerScript = await getWorkerUrl();

        const videoUrl = URL.createObjectURL(videoBlob);
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.src = videoUrl;

        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('视频加载超时')), 15000);
                video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
                video.onerror = () => { clearTimeout(timer); reject(new Error('视频加载失败')); };
            });

            const rawDuration = video.duration;
            if (!isFinite(rawDuration) || rawDuration <= 0) throw new Error('无法获取视频时长');

            const duration = Math.min(rawDuration, MAX_DURATION);
            if (rawDuration > MAX_DURATION) {
                console.warn(`[TMD] 视频时长 ${rawDuration.toFixed(1)}s 超过 ${MAX_DURATION}s，仅转换前 ${MAX_DURATION}s`);
            }

            const params = autoGifParams(duration, video.videoWidth);
            const frameInterval = duration / params.totalFrames;
            const dstH = Math.round(params.width * video.videoHeight / video.videoWidth);

            console.log(`[TMD] GIF: ${duration.toFixed(1)}s, ${params.fps}fps, ${params.width}x${dstH}, ${params.totalFrames}帧`);

            const canvas = document.createElement('canvas');
            canvas.width = params.width;
            canvas.height = dstH;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            const GIFClass = window.GIF || GIF;
            if (!GIFClass) throw new Error('GIF 库未正确加载');

            return await new Promise((resolve, reject) => {
                const gif = new GIFClass({
                    workers: 2,
                    quality: params.quality,
                    width: params.width,
                    height: dstH,
                    workerScript,
                    repeat: 0,
                    background: '#fff'
                });

                // 编码阶段占整体 60%~100%
                gif.on('progress', (p) => {
                    if (onProgress) onProgress(0.6 + p * 0.4);
                });

                gif.on('finished', (blob) => {
                    console.log(`[TMD] GIF 完成: ${(blob.size / 1024).toFixed(1)} KB`);
                    if (onProgress) onProgress(1);
                    resolve(blob);
                });

                gif.on('error', (err) => {
                    reject(err instanceof Error ? err : new Error(String(err)));
                });

                const seekTo = (time) => new Promise((resolve) => {
                    const timer = setTimeout(() => {
                        video.removeEventListener('seeked', handler);
                        console.warn('[TMD] seek 超时，跳过该帧');
                        resolve(false);
                    }, SEEK_TIMEOUT);

                    const handler = () => {
                        clearTimeout(timer);
                        video.removeEventListener('seeked', handler);
                        resolve(true);
                    };

                    video.addEventListener('seeked', handler);
                    try {
                        video.currentTime = time;
                    } catch (e) {
                        clearTimeout(timer);
                        video.removeEventListener('seeked', handler);
                        resolve(false);
                    }
                });

                const addFrames = async () => {
                    for (let i = 0; i < params.totalFrames; i++) {
                        const t = Math.min(i * frameInterval, duration - 0.001);
                        await seekTo(t);

                        try {
                            ctx.drawImage(video, 0, 0, params.width, dstH);
                            gif.addFrame(ctx, { copy: true, delay: Math.round(1000 / params.fps) });
                        } catch (e) {
                            console.warn('[TMD] 抽帧失败，跳过:', e);
                        }

                        // 抽帧阶段占整体 0%~60%
                        if (onProgress) onProgress((i + 1) / params.totalFrames * 0.6);
                    }
                    gif.render();
                };

                addFrames().catch(reject);
            });

        } finally {
            URL.revokeObjectURL(videoUrl);
        }
    };

    // ============================================================
    //  按钮状态
    // ============================================================
    const setStatus = (btn, cls) => {
        btn.classList.remove('download', 'loading', 'failed', 'completed');
        if (cls) btn.classList.add(cls);
    };

    // ============================================================
    //  【新增】复制图片 —— 追加到 X 的图片右键菜单
    // ============================================================
    const IMG_COPY = {
        menuItemText: '复制图片',
        // X 原生「复制照片链接」项的 testid，用它定位菜单
        anchorTestId: 'copyPhotoLinkContextMenuItem',
        attrInjected: 'data-tmd-img-copy',
        pendingUrl: null,      // 已升级为最高分辨率
        originalUrl: null,     // 页面上的原始地址（高清版失败时回退用）
        observer: null
    };

    // ---- 把 X 的缩略图地址升级为最高分辨率 ----
    // X 的图片 URL 形如 https://pbs.twimg.com/media/XXX?format=jpg&name=360x360
    // name= 参数只是 CDN 的缩放提示，可以安全替换为 4096x4096
    const upgradeImageUrl = (url) => {
        if (!url) return url;
        // 只处理 X 媒体图，其它站点的图片原样返回
        if (!/^https?:\/\/pbs\.twimg\.com\/media\//.test(url)) return url;

        const qIndex = url.indexOf('?');
        const base = qIndex < 0 ? url : url.slice(0, qIndex);
        const query = qIndex < 0 ? '' : url.slice(qIndex + 1);

        // 无查询串：补上 format 与尺寸
        if (!query) {
            const ext = (base.match(/\.([a-z0-9]+)$/i) || [])[1] || 'jpg';
            return `${base}?format=${ext}&name=4096x4096`;
        }

        // 有查询串：替换或追加 name 参数
        const params = query.split('&').filter(Boolean);
        const idx = params.findIndex(p => /^name=/i.test(p));
        if (idx >= 0) params[idx] = 'name=4096x4096';
        else params.push('name=4096x4096');

        return `${base}?${params.join('&')}`;
    };

    // ---- 右键命中图片时记录地址 ----
    const resolveImageUrl = (target) => {
        if (!target || !target.closest) return null;

        // 普通 <img>
        if (target.tagName === 'IMG') {
            return (target.currentSrc || target.src || '').trim() || null;
        }
        const img = target.closest('img');
        if (img) return (img.currentSrc || img.src || '').trim() || null;

        // background-image 伪图片
        const bgEl = target.closest('div[style*="background-image"], a[style*="background-image"]');
        if (bgEl) {
            const m = getComputedStyle(bgEl).backgroundImage.match(/url\(["']?(.+?)["']?\)/);
            if (m) return m[1].trim();
        }
        return null;
    };

    const onImgContextMenu = (e) => {
        const url = resolveImageUrl(e.target);
        if (url) {
            const httpsUrl = url.replace(/^http:/, 'https:');
            IMG_COPY.originalUrl = httpsUrl;
            IMG_COPY.pendingUrl = upgradeImageUrl(httpsUrl);
        }
    };

    // ---- URL 转 PNG Blob（CORS 重新加载，规避 canvas 污染） ----
    const urlToPngBlob = async (url) => {
        if (!url) throw new Error('没有图片地址');
        url = url.replace(/^http:/, 'https:');

        const load = (useCors, src) => new Promise((resolve, reject) => {
            const im = new Image();
            if (useCors) im.crossOrigin = 'anonymous';
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error(useCors ? 'CORS 拒绝' : '图片加载失败'));
            im.src = src;
        });

        // 优先带 CORS 加载；失败再回退（回退后 canvas 可能被污染）
        // 再失败则退回原始地址（某些图不存在 4096 尺寸）
        const original = IMG_COPY.originalUrl;
        let im;
        try {
            im = await load(true, url);
        } catch (e1) {
            if (original && original !== url) {
                try { im = await load(true, original); }
                catch { im = await load(false, original); }
            } else {
                im = await load(false, url);
            }
        }

        const canvas = document.createElement('canvas');
        canvas.width = im.naturalWidth;
        canvas.height = im.naturalHeight;
        if (!canvas.width || !canvas.height) throw new Error('图片尺寸为 0（可能未加载完成）');

        canvas.getContext('2d').drawImage(im, 0, 0);

        const png = await new Promise((resolve, reject) => {
            try {
                canvas.toBlob(
                    b => b ? resolve(b) : reject(new Error('canvas 被污染，无法导出')),
                    'image/png'
                );
            } catch (e) {
                reject(e);
            }
        });
        return { png, width: canvas.width, height: canvas.height };
    };

    const copyImageToClipboard = async (url) => {
        const { png, width, height } = await urlToPngBlob(url);

        // 优先用 Clipboard API 写图片（保留 PNG 原始质量）
        if (navigator.clipboard && window.ClipboardItem) {
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': png })
            ]);
            return { width, height, bytes: png.size, mode: 'clipboard-api' };
        }

        // 兜底：GM_setClipboard 只能写文本，退化为复制图片地址
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(url, 'text');
            return { width, height, bytes: png.size, mode: 'url-fallback' };
        }
        throw new Error('当前环境不支持复制图片');
    };

    // ---- 轻提示 ----
    const toast = (text, isError) => {
        const el = document.createElement('div');
        el.textContent = text;
        el.style.cssText = `
            position: fixed; left: 50%; bottom: 80px; transform: translateX(-50%);
            z-index: 2147483647; pointer-events: none;
            background: ${isError ? '#f4212e' : '#0f1419'}; color: #fff;
            padding: 10px 18px; border-radius: 8px;
            font: 14px/1.3 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.25);
            opacity: 0; transition: opacity .18s ease;
        `;
        document.documentElement.appendChild(el);
        requestAnimationFrame(() => { el.style.opacity = '1'; });
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 250);
        }, isError ? 2600 : 1400);
    };

    // ---- 复制动作 ----
    const doCopyImage = async (closeMenu) => {
        const url = IMG_COPY.pendingUrl;
        if (closeMenu) closeMenu();
        try {
            const r = await copyImageToClipboard(url);
            toast(r.mode === 'url-fallback'
                ? '环境不支持复制图片，已复制图片地址'
                : `图片已复制 ${r.width}×${r.height}`);
            console.log('[TMD] 复制图片成功:', r, url);
        } catch (err) {
            console.warn('[TMD] 复制图片失败:', err, url);
            toast('复制图片失败：' + err.message, true);
        }
    };

    // ---- 把菜单项插入 X 的图片右键菜单 ----
    const injectMenuItem = () => {
        const anchor = document.querySelector(
            `[data-testid="${IMG_COPY.anchorTestId}"]`
        );
        if (!anchor) return;

        // 直接取原生项的父容器（即 div[data-testid=Dropdown]），保证同层同序
        const container = anchor.parentElement;
        if (!container) return;

        // 去重：容器里已有就跳过
        if (container.querySelector(`[${IMG_COPY.attrInjected}]`)) return;

        // X 会复用 DOM 节点：清掉遗留在其它位置的旧项，避免累积
        document.querySelectorAll(`[${IMG_COPY.attrInjected}]`).forEach(el => el.remove());

        // 克隆原生项，完全复用 X 的样式与结构
        const nativeItem = anchor.cloneNode(true);
        nativeItem.removeAttribute('data-testid');

        // 清掉 X 的 React 事件绑定痕迹
        nativeItem.querySelectorAll('[data-testid]').forEach(n => n.removeAttribute('data-testid'));

        // 替换文字：只改最内层的 span，保留排版结构
        const spans = nativeItem.querySelectorAll('span');
        if (spans.length) {
            spans[spans.length - 1].textContent = IMG_COPY.menuItemText;
        } else {
            nativeItem.textContent = IMG_COPY.menuItemText;
        }

        // 移除可能残留的图标（原生项本就无图标，这里防御性处理）
        nativeItem.querySelectorAll('svg').forEach(s => s.remove());

        nativeItem.setAttribute(IMG_COPY.attrInjected, '1');
        nativeItem.setAttribute('role', 'menuitem');
        nativeItem.setAttribute('tabindex', '0');

        // 点击处理：捕获阶段拦截，避免触达 X 的 React 处理器。
        // 只绑 click —— 同时绑 mouseup 会在真实点击时触发两次。
        let fired = false;
        nativeItem.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (fired) return;
            fired = true;
            // 关闭 X 的菜单：点一下 body 让它自己收走
            document.body.click();
            doCopyImage();
        }, true);

        // 插到原生项前面（与 Chrome 原生菜单一致：自定义项在系统项之前）
        container.insertBefore(nativeItem, anchor);
    };

    // ---- 监听菜单出现 ----
    const startImgCopy = () => {
        document.addEventListener('contextmenu', onImgContextMenu, true);

        // 右键后经微任务立即尝试注入（菜单若已在 DOM 里则马上补）
        document.addEventListener('contextmenu', () => {
            queueMicrotask(injectMenuItem);
        }, true);

        IMG_COPY.observer = new MutationObserver((mutations) => {
            // 只在新增节点时同步注入，避免任何延迟
            for (const m of mutations) {
                if (m.addedNodes.length) {
                    injectMenuItem();
                    return;
                }
            }
        });
        IMG_COPY.observer.observe(document.body, { childList: true, subtree: true });
    };

    startImgCopy();

    // ============================================================
    //  创建按钮
    // ============================================================
    const createButtons = (cell) => {
        try {
            const group = cell.querySelector('div[role="group"]:last-of-type, ul.tweet-actions, ul.tweet-detail-actions');
            if (!group) return;

            const shareBtn = Array.from(
                group.querySelectorAll(':scope>div>div, li.tweet-action-item>a, li.tweet-detail-action-item>a')
            ).pop()?.parentNode;
            if (!shareBtn) return;

            // ---- 主下载按钮（图片/视频下载，不用进度环） ----
            const btnDown = shareBtn.cloneNode(true);
            btnDown.classList.add('tmd-down', 'download');
            const btnEl = btnDown.querySelector('button');
            if (btnEl) { btnEl.removeAttribute('disabled'); btnEl.title = '下载图片和视频'; }
            btnDown.querySelector('svg').innerHTML = `
                <g class="download"><path d="M12 16 17.7 10.3 16.29 8.88 13 12.18 V2.59 h-2 v9.59 L7.7 8.88 6.29 10.3 Z M21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" fill="currentColor"/></g>
                <g class="loading"><circle cx="12" cy="12" r="10" fill="none" stroke="#1DA1F2" stroke-width="4" opacity="0.4"/><path d="M12,2 a10,10 0 0 1 10,10" fill="none" stroke="#1DA1F2" stroke-width="4" stroke-linecap="round"/></g>
                <g class="failed"><circle cx="12" cy="12" r="11" fill="#f33" stroke="currentColor" stroke-width="2" opacity="0.8"/><path d="M14,5 a1,1 0 0 0 -4,0 l0.5,9.5 a1.5,1.5 0 0 0 3,0 z M12,17 a2,2 0 0 0 0,4 a2,2 0 0 0 0,-4" fill="#fff"/></g>
                <g class="completed"><path d="M21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z M 7 10 l 3 4 q 1 1 2 0 l 8 -11 l -1.65 -1.2 l -7.35 10.1063 l -2.355 -3.14" fill="rgba(29, 161, 242, 1)"/></g>`;

            btnDown.onclick = async () => {
                if (btnDown.classList.contains('loading')) return;
                setStatus(btnDown, 'loading');

                const el = getFilenameElements(getMainTweetUrl(cell), cell);
                if (!el) { alert('无法获取推文信息'); setStatus(btnDown, 'download'); return; }

                const media = await collectMediaURLs(cell, el);
                const all = [...media.imageURLs, ...media.gifURLs, ...media.videoURLs];
                if (!all.length) { alert('这条推文里没有可下载的媒体'); setStatus(btnDown, 'download'); return; }

                let ok = 0;
                for (let i = 0; i < all.length; i++) {
                    const blob = await downloadBlob(all[i]);
                    if (!blob) continue;
                    const info = getMediaInfo(all[i]);
                    triggerSave(blob, generateFilename(el, info.typeLabel, i + 1, info.ext));
                    ok++;
                    if (all.length > 1) await new Promise(r => setTimeout(r, 400));
                }

                setStatus(btnDown, ok ? 'completed' : 'failed');
                setTimeout(() => setStatus(btnDown, 'download'), ok ? 2000 : 3000);
            };

            group.insertBefore(btnDown, shareBtn.nextSibling);

            // ---- GIF 按钮（仅有视频/GIF 时显示，进度环只反映转换） ----
            const { gifs, videos } = getMediaElements(cell);
            if (!gifs.length && !videos.length) return;

            const btnGif = btnDown.cloneNode(true);
            btnGif.classList.remove('tmd-down');
            btnGif.classList.add('tmd-gif', 'download');
            const gifBtn = btnGif.querySelector('button');
            if (gifBtn) { gifBtn.removeAttribute('disabled'); gifBtn.title = '转换为 GIF 下载（10fps，最长20秒）'; }
            btnGif.querySelector('svg').innerHTML = `
                <g class="download"><rect x="2" y="6.5" width="20" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="12" y="15" text-anchor="middle" font-size="7" font-weight="bold" font-family="Arial" fill="currentColor">GIF</text></g>
                <g class="loading"><circle cx="12" cy="12" r="10" fill="none" stroke="#1DA1F2" stroke-width="4" opacity="0.4"/><path d="M12,2 a10,10 0 0 1 10,10" fill="none" stroke="#1DA1F2" stroke-width="4" stroke-linecap="round"/></g>
                <g class="failed"><circle cx="12" cy="12" r="11" fill="#f33" stroke="currentColor" stroke-width="2" opacity="0.8"/><path d="M14,5 a1,1 0 0 0 -4,0 l0.5,9.5 a1.5,1.5 0 0 0 3,0 z M12,17 a2,2 0 0 0 0,4 a2,2 0 0 0 0,-4" fill="#fff"/></g>
                <g class="completed"><path d="M21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z M 7 10 l 3 4 q 1 1 2 0 l 8 -11 l -1.65 -1.2 l -7.35 10.1063 l -2.355 -3.14" fill="rgba(29, 161, 242, 1)"/></g>`;

            btnGif.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (btnGif.classList.contains('loading')) return;
                setStatus(btnGif, 'loading');

                const el = getFilenameElements(getMainTweetUrl(cell), cell);
                if (!el) { alert('无法获取推文信息'); setStatus(btnGif, 'download'); return; }

                const media = await collectMediaURLs(cell, el);
                const targets = [
                    ...media.gifURLs.map(u => ({ url: u, kind: 'gif' })),
                    ...media.videoURLs.map(u => ({ url: u, kind: 'video' }))
                ];
                if (!targets.length) { alert('这条推文里没有 GIF 或视频'); setStatus(btnGif, 'download'); return; }

                try {
                    initRing();
                    setRingProgress(0);
                    showRing();

                    // ---------- 阶段一：下载（不显示进度，进度保持 0） ----------
                    const blobs = [];
                    for (let i = 0; i < targets.length; i++) {
                        const b = await downloadBlob(targets[i].url);
                        if (b) {
                            blobs.push(b);
                        } else {
                            console.warn('[TMD] 跳过下载失败的媒体:', targets[i].url);
                        }
                    }
                    if (!blobs.length) throw new Error('所有媒体下载失败');

                    // ---------- 阶段二：转换（0~100%，进度环只反映转换） ----------
                    for (let i = 0; i < blobs.length; i++) {
                        const gifBlob = await withTimeout(
                            convertToGif(blobs[i], (p) => {
                                // 多文件时按整体折算
                                const overall = (i + p) / blobs.length;
                                setRingProgress(overall);
                            }),
                            GIF_TIMEOUT,
                            'GIF 转换超时'
                        );
                        triggerSave(gifBlob, generateFilename(el, 'gif', i + 1, 'gif'));
                        if (blobs.length > 1) await new Promise(r => setTimeout(r, 500));
                    }

                    ringComplete(900);
                    setStatus(btnGif, 'completed');
                    setTimeout(() => setStatus(btnGif, 'download'), 2000);
                } catch (err) {
                    console.error('[TMD] GIF 失败:', err);
                    alert('GIF 转换失败：' + err.message);
                    ringFail(1200);
                    setStatus(btnGif, 'failed');
                    setTimeout(() => setStatus(btnGif, 'download'), 3000);
                }
            };

            group.insertBefore(btnGif, btnDown.nextSibling);
        } catch (e) {
            console.warn('[TMD] 创建按钮时出错:', e);
        }
    };

    // ============================================================
    //  CSS
    // ============================================================
    const css = `
    .tmd-down, .tmd-gif { margin-left: 2px !important; order: 99; display: inline-grid; }
    .tmd-down:hover svg, .tmd-gif:hover svg { color: rgba(29, 161, 242, 1.0); }
    .tmd-down:hover div:first-child:not(:last-child), .tmd-gif:hover div:first-child:not(:last-child) { background-color: rgba(29, 161, 242, 0.1); }
    .tmd-down g, .tmd-gif g { display: none; }
    .tmd-down.download g.download, .tmd-down.loading g.loading, .tmd-down.failed g.failed, .tmd-down.completed g.completed,
    .tmd-gif.download g.download, .tmd-gif.loading g.loading, .tmd-gif.failed g.failed, .tmd-gif.completed g.completed { display: unset; }
    .tmd-down.loading svg g.loading, .tmd-gif.loading svg g.loading { animation: spin 1s linear infinite !important; transform-box: fill-box; transform-origin: center; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    /* ---- 右键菜单：去掉过渡/动画，加快弹出 ---- */
    [role="menu"], [role="menu"] *, [role="menuitem"], [role="menuitem"] * {
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        animation-duration: 0s !important;
        animation-delay: 0s !important;
    }
    `;
    const style = document.createElement('style');
    style.id = 'twdlcss';
    style.textContent = css;
    document.head.appendChild(style);

    // ============================================================
    //  主循环
    // ============================================================
    const process = () => {
        document.querySelectorAll('[data-testid="cellInnerDiv"]').forEach(cell => {
            if (!cell.querySelector('article[data-testid="tweet"]')) return;
            if (!getFilenameElements(getMainTweetUrl(cell), cell)) return;
            const { images, videos, gifs } = getMediaElements(cell);
            if (!cell.querySelector('.tmd-down') && (images.length + videos.length + gifs.length) > 0)
                createButtons(cell);
        });
    };

    let timer = null;
    const debounced = () => { clearTimeout(timer); timer = setTimeout(process, 100); };

    new MutationObserver(debounced).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('load', debounced);
    window.addEventListener('popstate', debounced);
    window.addEventListener('hashchange', debounced);

})();