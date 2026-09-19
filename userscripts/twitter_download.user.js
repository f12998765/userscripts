// ==UserScript==
// @name         X/Twitter 媒体下载
// @version      0.0.1
// @description  下载 X/Twitter 图片、视频、GIF，视频可转换为 GIF（10fps 流畅，最长 20 秒，自适应分辨率）
// @license      MIT
// @match        https://twitter.com/*
// @match        https://x.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=twitter.com
// @connect      twitter.com
// @connect      x.com
// @connect      pbs.twimg.com
// @connect      video.twimg.com
// @connect      cdn.jsdelivr.net
// @grant        GM_xmlhttpRequest
// @require      https://cdn.jsdelivr.net/npm/gif.js.optimized@1.0.1/dist/gif.js
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
    const MAX_DURATION = 20;           // 最长转换秒数，10fps 下总帧数 200
    const FRAME_BUDGET = 200;          // 总帧数上限

    // ============================================================
    //  Worker 脚本加载（绕过 CSP：GM 拉取 → Blob URL）
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

        // 修复：去掉缩略图扩展名，生成正确的 video.twimg.com 地址
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
    //  下载
    // ============================================================
    const downloadBlob = async (url) => {
        try {
            const res = await gmFetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36' },
                responseType: 'blob',
                timeout: 60000
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const { ext } = getMediaInfo(url);
            const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm' };
            const mime = mimeMap[ext.toLowerCase()] || blob.type || 'application/octet-stream';
            return blob.type === mime ? blob : blob.slice(0, blob.size, mime);
        } catch (e) {
            console.error('[TMD] 下载失败:', url, e);
            return null;
        }
    };

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
    //  自适应 GIF 参数（固定 10fps，最长 20 秒，自适应分辨率）
    // ============================================================
    const autoGifParams = (duration, srcWidth) => {
        const fps = 10; // 固定 10fps，保证人眼流畅
        let maxWidth;

        if (duration <= 2)       maxWidth = 480;
        else if (duration <= 5)  maxWidth = 400;
        else if (duration <= 10) maxWidth = 320;
        else if (duration <= 15) maxWidth = 280;
        else                     maxWidth = 240;

        const quality = 30; // 最大压缩
        const totalFrames = Math.min(FRAME_BUDGET, Math.round(fps * duration));

        return {
            fps,
            width: Math.min(maxWidth, srcWidth),
            quality,
            totalFrames
        };
    };

    // ============================================================
    //  视频 → GIF（gif.js.optimized 编码）
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

            return new Promise((resolve, reject) => {
                const gif = new GIFClass({
                    workers: 2,
                    quality: params.quality,
                    width: params.width,
                    height: dstH,
                    workerScript,
                    repeat: 0,
                    background: '#fff'
                });

                gif.on('progress', (p) => {
                    if (onProgress) onProgress(0.5 + p * 0.5);
                });

                gif.on('finished', (blob) => {
                    console.log(`[TMD] GIF 完成: ${(blob.size / 1024).toFixed(1)} KB`);
                    resolve(blob);
                });

                gif.on('error', (err) => {
                    reject(err);
                });

                const addFrames = async () => {
                    for (let i = 0; i < params.totalFrames; i++) {
                        const t = Math.min(i * frameInterval, duration - 0.001);
                        video.currentTime = t;
                        await new Promise(res => {
                            const handler = () => { video.removeEventListener('seeked', handler); res(); };
                            video.addEventListener('seeked', handler);
                        });

                        ctx.drawImage(video, 0, 0, params.width, dstH);
                        gif.addFrame(ctx, { copy: true, delay: Math.round(1000 / params.fps) });

                        if (onProgress) onProgress((i + 1) / params.totalFrames * 0.5);
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

            // ---- 主下载按钮 ----
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

            // ---- GIF 按钮（仅有视频/GIF 时显示） ----
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
                    const blobs = (await Promise.all(targets.map(t => downloadBlob(t.url)))).filter(Boolean);
                    if (blobs.length !== targets.length) throw new Error('部分媒体下载失败');

                    for (let i = 0; i < blobs.length; i++) {
                        const gifBlob = await convertToGif(blobs[i], (p) => {
                            if (gifBtn) gifBtn.title = `GIF 转换中 ${Math.round(p * 100)}%`;
                        });
                        triggerSave(gifBlob, generateFilename(el, 'gif', i + 1, 'gif'));
                        if (blobs.length > 1) await new Promise(r => setTimeout(r, 500));
                    }

                    setStatus(btnGif, 'completed');
                    setTimeout(() => setStatus(btnGif, 'download'), 2000);
                } catch (err) {
                    console.error('[TMD] GIF 失败:', err);
                    alert('GIF 转换失败：' + err.message);
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
