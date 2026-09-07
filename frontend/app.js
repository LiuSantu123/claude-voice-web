// codex-voice-web 前端逻辑（左设置 / 右对话）
(() => {
  'use strict';

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const micSel = $('micSel'), spkSel = $('spkSel'), refreshDev = $('refreshDev'), devHint = $('devHint');
  const modeAuto = $('modeAuto'), modePtt = $('modePtt');
  const pttModeSel = $('pttModeSel');
  const keyHold = $('keyHold'), keyStart = $('keyStart'), keyStop = $('keyStop');
  const keyHoldReset = $('keyHoldReset'), keyStartReset = $('keyStartReset'), keyStopReset = $('keyStopReset');
  const holdKeyRow = $('holdKeyRow'), toggleKeyRow = $('toggleKeyRow'), pttHint = $('pttHint');
  const talkBtn = $('talkBtn');
  const inputGain = $('inputGain'), outputVol = $('outputVol');
  const igVal = $('igVal'), ovVal = $('ovVal');
  const sensSel = $('sensSel'), silenceSel = $('silenceSel');
  const voiceSel = $('voiceSel'), rateSel = $('rateSel'), pitchSel = $('pitchSel'), testVoiceBtn = $('testVoice');
  const inMeter = $('inMeter'), outMeter = $('outMeter');
  const transcript = $('transcript'), statusEl = $('status');
  const thinkingEl = $('thinking'), thinkingText = $('thinkingText');
  const startBtn = $('startBtn'), stopBtn = $('stopBtn');
  const previewToggle = $('previewToggle'), previewBox = $('previewBox'), previewText = $('previewText');
  const previewSend = $('previewSend'), previewRedo = $('previewRedo'), previewCancel = $('previewCancel');
  const convIdLabel = $('convIdLabel'), newConv = $('newConv');
  const copyConvId = $('copyConvId'), resumeBtn = $('resumeBtn'), exportMd = $('exportMd');
  const showActivity = $('showActivity');

  // ---------- 音色库 ----------
  const VOICES = [
    ['zh-CN-XiaoxiaoNeural', '晓晓（普通话·女声）'],
    ['zh-CN-XiaoyiNeural', '晓伊（普通话·女声）'],
    ['zh-CN-YunxiNeural', '云希（普通话·阳光男声）'],
    ['zh-CN-YunyangNeural', '云扬（普通话·新闻男声）'],
    ['zh-CN-YunjianNeural', '云健（普通话·浑厚男声）'],
    ['zh-CN-YunxiaNeural', '云夏（普通话·童声）'],
    ['zh-CN-liaoning-XiaobeiNeural', '晓北（东北话·女声）'],
    ['zh-CN-shaanxi-XiaoniNeural', '晓妮（陕西话·女声）'],
    ['zh-HK-HiuMaanNeural', '曉曼（粤语·女声）'],
    ['zh-TW-HsiaoChenNeural', '曉臻（台湾·女声）'],
    ['en-US-AriaNeural', 'Aria（英文·女声）'],
    ['en-US-GuyNeural', 'Guy（英文·男声）'],
    ['ja-JP-NanamiNeural', 'Nanami（日文·女声）'],
  ];

  // ---------- 状态 ----------
  let actx = null, workletNode = null, outGain = null, analyser = null, outLevel = null;
  let audioEl = null;
  let stream = null;
  let mediaRecorder = null, recChunks = [], recStartTime = 0, pttRecording = false;
  let running = false, busy = false, abortSpeech = false;
  let phase = 'idle';            // idle | stt | chat | tts
  let gen = 0;                   // 代次计数：防止旧请求收尾覆盖新请求
  let history = [];              // [{user, assistant}]
  let previewEnabled = true;     // 发送前预览开关
  let previewResolve = null;     // 预览等待回调
  let convThreadId = '';         // 当前 Codex 会话 thread_id
  let showOps = true;            // 是否展示 Codex 思考/操作
  let activityBox = null, currentCmdRow = null, reasoningRow = null;

  // 键位
  let pttMode = 'toggle';        // hold | toggle
  let holdKeyCode = 'Space';
  let startKeyCode = 'F8';
  let stopKeyCode = 'F9';
  let capturingTarget = null;    // 'hold' | 'start' | 'stop'
  let lastCaptureTime = 0;

  // ---------- 工具 ----------
  function log(msg, cls) {
    const div = document.createElement('div');
    div.className = 'sys ' + (cls || '');
    div.textContent = '[系统] ' + msg;
    transcript.appendChild(div);
    transcript.scrollTop = transcript.scrollHeight;
  }
  function addMsg(role, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    const b = document.createElement('b');
    b.textContent = role === 'user' ? '🎙 你' : '🤖 Codex';
    div.appendChild(b);
    const p = document.createElement('p');
    p.textContent = text;
    div.appendChild(p);
    transcript.appendChild(div);
    transcript.scrollTop = transcript.scrollHeight;
  }
  function setStatus(s) { statusEl.textContent = s; }
  function idleStatus() { setStatus(running ? '👂 ' + modeLabel() : '已停止'); }
  function modeLabel() {
    if (!modeAuto.checked) return '按键模式（按开始键录音）';
    return '聆听中…（请说话）';
  }
  function setThinking(label) {
    if (label) { thinkingText.textContent = label; thinkingEl.style.display = 'flex'; }
    else thinkingEl.style.display = 'none';
  }

  function encodeWav(f32, sampleRate) {
    const n = f32.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE');
    ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, n * 2, true);
    let off = 44;
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
    return buf;
  }

  function splitSentences(text) {
    return text.replace(/\r?\n/g, '。')
      .split(/(?<=[。！？!?；;])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async function fetchJson(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
    return r.json();
  }

  // ---------- 设备 ----------
  async function loadDevices(keepSel = true) {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const mics = devs.filter((d) => d.kind === 'audioinput');
    const spks = devs.filter((d) => d.kind === 'audiooutput');
    const micVal = keepSel ? micSel.value : '';
    const spkVal = keepSel ? spkSel.value : '';
    micSel.innerHTML = '';
    mics.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || ('麦克风 ' + (i + 1));
      micSel.appendChild(o);
    });
    spkSel.innerHTML = '';
    spks.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || ('扬声器 ' + (i + 1));
      spkSel.appendChild(o);
    });
    if (keepSel) {
      if (micVal && [...micSel.options].some((o) => o.value === micVal)) micSel.value = micVal;
      if (spkVal && [...spkSel.options].some((o) => o.value === spkVal)) spkSel.value = spkVal;
    }
    devHint.textContent = `识别到 ${mics.length} 个麦克风 / ${spks.length} 个扬声器` +
      (mics.length <= 1 ? '（授权麦克风后自动刷新，可点🔄）' : '');
  }

  async function applySink() {
    if (!audioEl || !audioEl.setSinkId) return;
    try { await audioEl.setSinkId(spkSel.value); }
    catch (e) { console.warn('setSinkId 失败:', e); }
  }

  // ---------- 输出链路（懒初始化）----------
  async function ensureOutput() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') await actx.resume();
    if (audioEl) return;
    audioEl = document.createElement('audio');
    const src = actx.createMediaElementSource(audioEl);
    outGain = actx.createGain();
    outGain.gain.value = parseFloat(outputVol.value);
    analyser = actx.createAnalyser();
    analyser.fftSize = 512;
    outLevel = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    analyser.connect(outGain);
    outGain.connect(actx.destination);
    applySink();
    (function meterLoop() {
      if (analyser) {
        analyser.getByteTimeDomainData(outLevel);
        let peak = 0;
        for (let i = 0; i < outLevel.length; i++) {
          const v = Math.abs((outLevel[i] - 128) / 128);
          if (v > peak) peak = v;
        }
        outMeter.value = Math.min(100, Math.round(peak * 200));
      }
      requestAnimationFrame(meterLoop);
    })();
  }

  // ---------- 麦克风 / VAD 工作节点 ----------
  async function initAudio() {
    await ensureOutput();
    const devId = micSel.value;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      audio: devId ? { deviceId: { exact: devId } } : true,
    });
    await loadDevices(true); // 授权后浏览器才暴露设备标签/完整列表

    if (!workletNode) {
      await actx.audioWorklet.addModule('vad-processor.js');
      workletNode = new AudioWorkletNode(actx, 'vad-processor');
      workletNode.port.onmessage = onWorkletMessage;
      // 关键：必须接一个“静音输出”，否则 Chrome/Edge 可能不调用 process()，
      // 导致 VAD/录音停摆。增益为 0 可保证无声（无回声/啸叫）。
      const muteGain = actx.createGain();
      muteGain.gain.value = 0;
      workletNode.connect(muteGain);
      muteGain.connect(actx.destination);
    }
    const micSource = actx.createMediaStreamSource(stream);
    micSource.connect(workletNode);

    // PTT 用 MediaRecorder（最稳，不依赖 AudioWorklet 缓冲）
    mediaRecorder = null;
    recChunks = [];
    pushParams();
    workletNode.port.postMessage({ cmd: 'set_mode', mode: modeAuto.checked ? 'auto' : 'ptt' });
  }

  function pushParams() {
    if (!workletNode) return;
    let s = 0.015, e = 0.010;
    if (sensSel.value === 'low') { s = 0.03; e = 0.02; }
    if (sensSel.value === 'high') { s = 0.008; e = 0.005; }
    let silence = 700;
    if (silenceSel.value === 'short') silence = 450;
    if (silenceSel.value === 'long') silence = 1100;
    workletNode.port.postMessage({
      cmd: 'set_params',
      params: { startThr: s, endThr: e, silenceMs: silence, inputGain: parseFloat(inputGain.value) },
    });
  }

  // ---------- Worklet 消息（自动模式用）----------
  function onWorkletMessage(e) {
    const d = e.data;
    if (!d) return;
    if (d.type === 'rms') {
      inMeter.value = Math.min(100, Math.round(d.rms * 5000));
      return;
    }
    if (d.type === 'state') {
      if (d.state === 'speaking') setStatus('🎤 正在听你说话…');
      else if (d.state === 'ptt_recording') setStatus('🔴 录音中…');
      else if (d.state === 'idle') {
        if (phase === 'tts') setStatus('🔊 朗读回复中…');
        else if (busy) setStatus('⏳ 处理中…');
        else idleStatus();
      }
      return;
    }
    if (d.type === 'utterance') {
      handleUtterance(new Float32Array(d.samples), d.sampleRate || 48000);
    }
  }

  // ---------- 核心处理：音频 blob → 转写 → Codex → 朗读 ----------
  async function handleUtteranceBlob(blob) {
    if (phase === 'tts') interruptSpeech();
    if (phase === 'stt' || phase === 'chat' || phase === 'preview') { log('上一句还在处理中，请稍候再发送。', 'warn'); return; }
    const myGen = ++gen;
    busy = true;
    try {
      phase = 'stt';
      setThinking('识别中…');
      setStatus('⏳ 识别中…');
      const r = await fetch('/api/transcribe', { method: 'POST', body: blob });
      if (!r.ok) throw new Error('转写失败 HTTP ' + r.status);
      const j = await r.json();
      let text = (j.text || '').trim();
      if (!text) { log('没听清，请再说一遍。', 'warn'); return; }

      // 发送前预览（可修改）
      if (previewEnabled) {
        phase = 'preview';
        setThinking(null);
        setStatus('🔎 请确认/修改识别内容');
        const reviewed = await waitForPreview(text);
        if (reviewed === '__REDO__') { log('请重新说一遍。'); return; }
        if (!reviewed) { log('已取消发送。'); return; }
        text = reviewed;
      }
      addMsg('user', text);

      phase = 'chat';
      setThinking('💭 Codex 思考中…');
      setStatus('💭 Codex 思考中…');
      let reply = '';
      try {
        const res = await chatStream(text);
        reply = (res.reply || '').trim();
        if (res.thread_id) {
          convThreadId = res.thread_id;
          convIdLabel.textContent = '会话 ' + convThreadId.slice(0, 8);
        }
      } catch (err) {
        log('流式对话失败，改用普通模式: ' + err.message, 'warn');
        const cj = await fetchJson('/api/chat', { text, history, thread_id: convThreadId });
        if (cj.thread_id) {
          convThreadId = cj.thread_id;
          convIdLabel.textContent = '会话 ' + convThreadId.slice(0, 8);
        }
        reply = (cj.reply || '').trim();
      }
      if (!reply) { log('Codex 没有返回内容。', 'warn'); return; }
      addMsg('assistant', reply);
      history.push({ user: text, assistant: reply });
      if (history.length > 20) history = history.slice(-20);

      phase = 'tts';
      setThinking('🔊 朗读中…');
      setStatus('🔊 朗读回复中…');
      abortSpeech = false;
      for (const s of splitSentences(reply)) {
        if (abortSpeech || gen !== myGen) break;
        const r2 = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ttsParams(s)),
        });
        if (!r2.ok) { log('TTS 失败: HTTP ' + r2.status, 'err'); break; }
        const b = await r2.blob();
        if (abortSpeech || gen !== myGen) break;
        await playBlob(b);
      }
    } catch (err) {
      log('处理出错: ' + err.message, 'err');
    } finally {
      if (gen === myGen) {
        busy = false;
        phase = 'idle';
        setThinking(null);
        idleStatus();
      }
    }
  }

  async function handleUtterance(f32, sampleRate) {
    await handleUtteranceBlob(new Blob([encodeWav(f32, sampleRate)], { type: 'audio/wav' }));
  }

  // ---------- 流式对话：实时展示 Codex 思考与操作 ----------
  function scrollTranscript() { transcript.scrollTop = transcript.scrollHeight; }
  function addActivityBlock() {
    const details = document.createElement('details');
    details.className = 'activity';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = '🛠 Codex 实际操作';
    details.appendChild(summary);
    const box = document.createElement('div');
    details.appendChild(box);
    transcript.appendChild(details);
    scrollTranscript();
    return box;
  }
  function addActRow(box, cls, text) {
    const row = document.createElement('div');
    row.className = 'act-row ' + cls;
    row.textContent = text;
    box.appendChild(row);
    scrollTranscript();
    return row;
  }
  function onCodexEvent(ev) {
    if (!showOps) return;
    const t = ev.type;
    if (t === 'turn.started') {
      activityBox = addActivityBlock();
      setThinking('💭 Codex 思考中…');
    } else if (t === 'item.started') {
      const it = ev.item || {};
      if (it.type === 'command_execution') {
        if (!activityBox) activityBox = addActivityBlock();
        currentCmdRow = addActRow(activityBox, 'cmd', '⚙️ ' + it.command);
        setThinking('⚙️ 正在执行: ' + it.command);
      } else if (it.type === 'reasoning') {
        if (!activityBox) activityBox = addActivityBlock();
        reasoningRow = addActRow(activityBox, 'think', '🧠 思考中…');
      }
    } else if (t === 'item.completed') {
      const it = ev.item || {};
      if (it.type === 'command_execution') {
        if (currentCmdRow) {
          const ok = it.exit_code === 0;
          currentCmdRow.classList.add(ok ? 'done' : 'err');
          currentCmdRow.textContent = '⚙️ ' + it.command + (ok ? '  ✅' : '  ❌(' + it.exit_code + ')');
          currentCmdRow = null;
          if (it.aggregated_output) {
            const pre = document.createElement('pre');
            pre.className = 'act-out';
            pre.textContent = String(it.aggregated_output).slice(0, 3000);
            (activityBox || transcript).appendChild(pre);
            scrollTranscript();
          }
        }
        setThinking('💭 Codex 思考中…');
      } else if (it.type === 'reasoning') {
        if (reasoningRow && it.text) reasoningRow.textContent = '🧠 ' + it.text;
      }
    } else if (t === 'turn.completed') {
      setThinking(null);
      if (activityBox && ev.usage) {
        const u = ev.usage;
        addActRow(activityBox, 'meta',
          'ⓘ tokens: in=' + (u.input_tokens || 0) + ' out=' + (u.output_tokens || 0) +
          ' reasoning=' + (u.reasoning_output_tokens || 0));
      }
    }
  }
  async function chatStream(text) {
    const r = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, history, thread_id: convThreadId }),
    });
    if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let reply = '';
    let tid = convThreadId;
    activityBox = null; currentCmdRow = null; reasoningRow = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
        if (!ev || !ev.type) continue;
        if (ev.type === 'thread.started' && ev.thread_id) tid = ev.thread_id;
        if (ev.type === 'item.completed' && ev.item && ev.item.type === 'agent_message') reply = ev.item.text || '';
        if (ev.type === 'final_reply' && ev.reply) reply = ev.reply;
        onCodexEvent(ev);
      }
    }
    return { reply, thread_id: tid };
  }

  function ttsParams(text) {
    return { text, voice: voiceSel.value, rate: rateSel.value, pitch: pitchSel.value, volume: '+0%' };
  }

  function playBlob(blob) {
    return new Promise((resolve) => {
      if (!audioEl) { resolve(); return; }
      if (audioEl.src) URL.revokeObjectURL(audioEl.src);
      audioEl.src = URL.createObjectURL(blob);
      audioEl.onended = () => resolve();
      audioEl.onerror = () => resolve();
      audioEl.play().catch(() => resolve());
      setTimeout(() => resolve(), 30000);
    });
  }

  function interruptSpeech() {
    abortSpeech = true;
    if (audioEl) { audioEl.pause(); audioEl.removeAttribute('src'); }
  }

  // ---------- 发送前预览 ----------
  function waitForPreview(text) {
    return new Promise((resolve) => {
      previewText.value = text;
      previewBox.style.display = 'block';
      previewResolve = resolve;
      previewText.focus();
    });
  }
  function hidePreview() {
    previewBox.style.display = 'none';
    previewResolve = null;
  }
  // 关键：先保存回调再隐藏并调用，否则 hidePreview 会把 previewResolve 置空导致 TypeError
  function resolvePreview(value) {
    const r = previewResolve;
    if (!r) return;
    previewResolve = null;
    hidePreview();
    r(value);
  }

  // ---------- PTT（MediaRecorder）----------
  function pickMime() {
    const cs = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const c of cs) if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    return '';
  }

  function pttStartRec() {
    if (modeAuto.checked) return;
    if (!running) { log('请先点“开始对话”。', 'warn'); return; }
    if (phase === 'tts') { interruptSpeech(); busy = false; }
    if (phase === 'stt' || phase === 'chat' || phase === 'preview') { log('请先确认/取消当前内容，再开始录音。', 'warn'); return; }
    if (!window.MediaRecorder) { log('当前浏览器不支持录音（MediaRecorder）。', 'err'); return; }
    if (mediaRecorder && mediaRecorder.state === 'recording') return; // 已在录音
    recChunks = [];
    recStartTime = Date.now();
    try {
      mediaRecorder = new MediaRecorder(stream, { mimeType: pickMime() });
    } catch (err) {
      try { mediaRecorder = new MediaRecorder(stream); } catch (e2) {
        log('无法创建录音器: ' + e2.message, 'err'); return;
      }
    }
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const secs = ((Date.now() - recStartTime) / 1000).toFixed(1);
      const blob = new Blob(recChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      pttRecording = false;
      talkBtn.classList.remove('active');
      if (!recChunks.length) { log('没有采集到音频，请检查麦克风。', 'err'); return; }
      log(`录音结束（${secs}s，${(blob.size/1024).toFixed(0)}KB），发送识别…`);
      handleUtteranceBlob(blob);
    };
    mediaRecorder.start();
    pttRecording = true;
    talkBtn.classList.add('active');
    if (pttMode === 'toggle') setStatus('🔴 录音中…（按“结束键”或再点按钮发送）');
    else setStatus('🔴 录音中…（松开 ' + keyName(holdKeyCode) + ' 发送）');
  }

  function pttStopRec() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try { mediaRecorder.stop(); } catch (err) { log('停止录音失败: ' + err.message, 'err'); }
    } else {
      pttRecording = false;
      talkBtn.classList.remove('active');
    }
  }

  function toggleRec() {
    if (pttRecording) pttStopRec(); else pttStartRec();
  }

  // ---------- 键位 ----------
  function keyName(code) {
    const map = {
      Space: '空格', ControlLeft: '左Ctrl', ControlRight: '右Ctrl',
      ShiftLeft: '左Shift', ShiftRight: '右Shift', AltLeft: '左Alt', AltRight: '右Alt',
      Enter: '回车', Tab: 'Tab', Backspace: '退格', CapsLock: '大写锁',
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    };
    if (map[code]) return map[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('F') && code.length <= 3) return code;
    return code;
  }
  function getKey(t) { return t === 'hold' ? holdKeyCode : t === 'start' ? startKeyCode : stopKeyCode; }
  function setKey(t, code) { if (t === 'hold') holdKeyCode = code; else if (t === 'start') startKeyCode = code; else stopKeyCode = code; }
  function keyBtn(t) { return t === 'hold' ? keyHold : t === 'start' ? keyStart : keyStop; }
  function keyLabel(t) { return t === 'hold' ? '说话键' : t === 'start' ? '开始录音键' : '结束并发送键'; }
  function refreshKeyBtn(t) { const b = keyBtn(t); b.textContent = keyName(getKey(t)); b.classList.remove('capturing'); }
  function startCapture(t) {
    capturingTarget = t;
    const b = keyBtn(t);
    b.textContent = '请按键…';
    b.classList.add('capturing');
    setTimeout(() => { if (capturingTarget === t) { capturingTarget = null; refreshKeyBtn(t); log('键位设置已取消（超时）。'); } }, 6000);
  }

  // ---------- 开始 / 停止 ----------
  async function start() {
    try {
      await initAudio();
      running = true; busy = false; abortSpeech = false; phase = 'idle'; pttRecording = false;
      startBtn.disabled = true; stopBtn.disabled = false;
      talkBtn.style.display = modeAuto.checked ? 'none' : 'flex';
      talkBtn.classList.remove('active');
      idleStatus();
      setThinking(null);
      if (modeAuto.checked) log('对话已开始（自动模式）：直接说话，静音自动断句。');
      else log('对话已开始（按键模式）：' + (pttMode === 'toggle' ? `按 ${keyName(startKeyCode)} 开始录音，按 ${keyName(stopKeyCode)} 发送。` : `按住 ${keyName(holdKeyCode)} 说话，松开发送。`));
    } catch (err) {
      log('启动失败: ' + err.message + '（请检查麦克风权限）', 'err');
    }
  }

  function stop() {
    if (previewResolve) { const r = previewResolve; previewResolve = null; hidePreview(); r(null); }
    gen++;
    if (mediaRecorder && mediaRecorder.state === 'recording') { try { mediaRecorder.stop(); } catch (e) {} }
    mediaRecorder = null;
    running = false; busy = false; abortSpeech = true; phase = 'idle'; pttRecording = false;
    if (audioEl) { audioEl.pause(); audioEl.removeAttribute('src'); }
    startBtn.disabled = false; stopBtn.disabled = true;
    talkBtn.style.display = 'none';
    talkBtn.classList.remove('active');
    setThinking(null);
    setStatus('已停止');
    log('对话已停止。');
  }

  // ---------- 事件 ----------
  startBtn.onclick = start;
  stopBtn.onclick = stop;
  refreshDev.onclick = () => loadDevices(true).then(() => log('已刷新设备列表。'));
  micSel.onchange = () => { if (running) { stop(); start(); } };
  spkSel.onchange = applySink;

  modeAuto.onchange = () => {
    const auto = modeAuto.checked;
    talkBtn.style.display = (!auto && running) ? 'flex' : 'none';
    if (workletNode) workletNode.port.postMessage({ cmd: 'set_mode', mode: auto ? 'auto' : 'ptt' });
    if (running) log(auto ? '已切换为自动模式。' : '已切换为按键模式。');
    idleStatus();
  };
  modePtt.onchange = () => modeAuto.onchange();

  pttModeSel.onchange = () => {
    pttMode = pttModeSel.value;
    const toggle = pttMode === 'toggle';
    holdKeyRow.style.display = toggle ? 'none' : 'block';
    toggleKeyRow.style.display = toggle ? 'block' : 'none';
    pttHint.textContent = toggle
      ? '双键模式：按“开始键”录音，说完了按“结束键”发送。点击键位按钮可自定义。'
      : '按住模式：按住“说话键”录音，松开自动发送。';
    if (running) log('录音方式已切换为：' + (toggle ? '双键切换。' : '按住说话。'));
  };

  inputGain.oninput = () => { igVal.textContent = inputGain.value; pushParams(); };
  outputVol.oninput = () => { ovVal.textContent = outputVol.value; if (outGain) outGain.gain.value = parseFloat(outputVol.value); };
  sensSel.onchange = pushParams;
  silenceSel.onchange = pushParams;

  keyHold.onclick = () => startCapture('hold');
  keyStart.onclick = () => startCapture('start');
  keyStop.onclick = () => startCapture('stop');
  keyHoldReset.onclick = () => { holdKeyCode = 'Space'; refreshKeyBtn('hold'); log('说话键已重置为：空格。'); };
  keyStartReset.onclick = () => { startKeyCode = 'F8'; refreshKeyBtn('start'); log('开始录音键已重置为：F8。'); };
  keyStopReset.onclick = () => { stopKeyCode = 'F9'; refreshKeyBtn('stop'); log('结束并发送键已重置为：F9。'); };

  // 发送前预览
  showActivity.onchange = () => {
    showOps = showActivity.checked;
    log(showOps ? '已开启：显示 Codex 思考与操作。' : '已关闭：隐藏 Codex 操作展示。');
  };

  previewToggle.onchange = () => {
    previewEnabled = previewToggle.checked;
    log(previewEnabled ? '已开启：发送前预览识别结果。' : '已关闭：发送前预览。');
  };
  previewSend.onclick = () => {
    if (!previewResolve) return;
    resolvePreview(previewText.value.trim() || null);
  };
  previewRedo.onclick = () => resolvePreview('__REDO__');
  previewCancel.onclick = () => resolvePreview(null);

  // 导出 Markdown
  exportMd.onclick = () => {
    const lines = ['# 🎙️ Codex 语音对话记录', '', `- 时间：${new Date().toLocaleString()}`,
      `- 会话 ID：${convThreadId || '（无）'}`, ''];
    if (!history.length) lines.push('（暂无对话内容）');
    history.forEach((h, i) => {
      lines.push(`## ${i + 1}`, '', `**你**：${h.user}`, '', `**Codex**：${h.assistant}`, '');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'codex-voice-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
    log('对话记录已导出为 Markdown。');
  };

  // 会话恢复 / 复制 / 新会话
  function resumeCmd() { return convThreadId ? `codex exec resume ${convThreadId}` : ''; }
  copyConvId.onclick = async () => {
    if (!convThreadId) { log('还没有会话 ID，先进行一次对话。', 'warn'); return; }
    try { await navigator.clipboard.writeText(resumeCmd()); } catch (e) {}
    log('已复制：' + resumeCmd());
  };
  resumeBtn.onclick = async () => {
    if (!convThreadId) { log('还没有会话 ID，先进行一次对话。', 'warn'); return; }
    try { await navigator.clipboard.writeText(resumeCmd()); } catch (e) {}
    log('已复制恢复命令：' + resumeCmd() + ' —— 到 WSL 终端执行即可继续这个对话。');
  };
  newConv.onclick = () => {
    convThreadId = '';
    convIdLabel.textContent = '会话：-';
    log('已开始新会话（旧会话仍可在终端用 codex exec resume 恢复）。');
  };

  testVoiceBtn.onclick = async () => {
    try {
      await ensureOutput();
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ttsParams('你好，这是当前音色的试听效果。')),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await playBlob(await r.blob());
    } catch (err) { log('试听失败: ' + err.message, 'err'); }
  };

  // 圆形按钮：按住模式=按住说话；双键模式=点击切换录音
  talkBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (pttMode === 'hold') {
      try { talkBtn.setPointerCapture(e.pointerId); } catch (err) {}
      pttStartRec();
    }
  });
  talkBtn.addEventListener('pointerup', (e) => {
    e.preventDefault();
    if (pttMode === 'hold') pttStopRec();
  });
  talkBtn.addEventListener('pointercancel', (e) => { e.preventDefault(); if (pttMode === 'hold') pttStopRec(); });
  talkBtn.addEventListener('click', (e) => { if (pttMode === 'toggle') toggleRec(); });

  // 全局键盘：热键
  document.addEventListener('keydown', (e) => {
    if (capturingTarget) {
      e.preventDefault();
      const t = capturingTarget;
      capturingTarget = null;
      if (e.code === 'Escape') { refreshKeyBtn(t); log('已取消键位设置。'); return; }
      setKey(t, e.code);
      refreshKeyBtn(t);
      lastCaptureTime = Date.now();
      log('已设置' + keyLabel(t) + '：' + keyName(e.code));
      return;
    }
    if (e.repeat) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return; // 正在输入，不触发录音
    if (ae && (ae.tagName === 'BUTTON' || ae.tagName === 'SELECT')) ae.blur();
    if (pttMode === 'hold') {
      if (e.code === holdKeyCode) { e.preventDefault(); pttStartRec(); }
    } else {
      if (e.code === startKeyCode) { e.preventDefault(); pttStartRec(); }
      else if (e.code === stopKeyCode) { e.preventDefault(); pttStopRec(); }
    }
  });
  document.addEventListener('keyup', (e) => {
    if (pttMode !== 'hold' || e.code !== holdKeyCode) return;
    if (Date.now() - lastCaptureTime < 400) return;
    pttStopRec();
  });

  // ---------- 初始化 ----------
  VOICES.forEach(([v, label]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    if (v === 'zh-CN-XiaoxiaoNeural') o.selected = true;
    voiceSel.appendChild(o);
  });
  refreshKeyBtn('hold'); refreshKeyBtn('start'); refreshKeyBtn('stop');
  pttModeSel.value = 'toggle';
  pttModeSel.onchange();

  navigator.mediaDevices.enumerateDevices()
    .then(loadDevices)
    .catch((e) => log('无法枚举设备: ' + e.message, 'err'));
  log('就绪。点“开始对话”，授权麦克风后可语音对话；左侧可调音色/语速/设备/录音键位。');
})();
