// ==UserScript==
// @name         Steam 探索队列自动完成
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  自动完成 Steam 探索队列
// @author       zero
// @match        https://store.steampowered.com/*
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    // 注册油猴扩展菜单命令
    GM_registerMenuCommand("开始自动探索", _exec, "S");

    function _exec() {
        var appids, 
            running = true, 
            queueNumber, 
            progressDialog = ShowAlertDialog('探索中', $J('<div/>').append($J('<div/>', {'class': 'waiting_dialog_throbber'}) ).append( $J('<div/>', {'id': 'progressContainer'}).text('获取进度...') ), '停止').done(abort);

        // ... 其余代码保持不变 ...
        function abort(){
            running = false;
            progressDialog.Dismiss();
        }

        function retry(){
            abort();
            ShowConfirmDialog('错误', '是否重试?', '重试', '放弃').done(_exec)
        }

        function clearApp(){
            if(!running)
                return;
            showProgress();
            var appid = appids.shift();
            !appid ? generateQueue() : $J.post( appids.length ? '/app/' + appid : '/explore/next/', {sessionid: g_sessionID, appid_to_clear_from_queue: appid} ).done(clearApp).fail(retry); 
        }

        function generateQueue(){
            running && $J.post('/explore/generatenewdiscoveryqueue', {sessionid: g_sessionID, queuetype: 0}).done(beginQueue).fail(retry);
        }

        function beginQueue(){
            if(!running)
                return;
            $J.get('/explore/').done(function(htmlText){
                var cardInfo = htmlText.match(/<div class="subtext">\D+(\d)\D+<\/div>/);
                if( !cardInfo ){
                    abort();
                    ShowAlertDialog('完成','已完成全部3轮探索队列');
                    return;
                }
                var matchedAppids = htmlText.match(/0,\s+(\[.*\])/);
                if( !matchedAppids ){
                    retry();
                    return;
                }
                appids = JSON.parse(matchedAppids[1]);
                queueNumber = cardInfo[1];
                appids.length == 0 ? generateQueue() : clearApp();
                showProgress();
            })
        }

        function showProgress(){
            $J('#progressContainer').html( '<br>剩余' + queueNumber + '个待探索队列, 当前队列剩余' + appids.length + '个待探索游戏' );
        }

        beginQueue();
    }
})();
