// vad-processor.js — AudioWorkletProcessor
// 在音频线程里做：RMS 检测、环形缓冲、VAD 自动断句 / 按键录音(PTT)
const SR = sampleRate;

class VADProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = 'auto';          // 'auto' | 'ptt'
    this.startThr = 0.015;       // 开始说话阈值(RMS)
    this.endThr = 0.010;         // 结束说话阈值
    this.holdMs = 120;           // 超过阈值持续多久判定“开始说话”
    this.silenceMs = 700;        // 静音多久判定“说完了”
    this.prerollMs = 400;        // 语音前保留的缓冲
    this.maxMs = 12000;          // 单句最长
    this.minMs = 250;            // 最短有效语音
    this.inputGain = 1.0;        // 输入增益

    this.ringLen = Math.floor(12000 / 1000 * SR); // 12s 环形缓冲
    this.ring = new Float32Array(this.ringLen);
    this.ringPos = 0;
    this.totalFrames = 0;

    this.speaking = false;
    this.onsetFrame = 0;
    this.speakFrames = 0;
    this.silenceFrames = 0;

    this.pttOn = false;
    this.pttBuffer = [];

    this.port.onmessage = (e) => {
      const d = e.data;
      if (!d) return;
      switch (d.cmd) {
        case 'set_mode':
          this.mode = d.mode;
          break;
        case 'set_params':
          Object.assign(this, d.params || {});
          break;
        case 'ptt_start':
          this.mode = 'ptt'; this.pttOn = true; this.pttBuffer = [];
          this.port.postMessage({ type: 'state', state: 'ptt_recording' });
          break;
        case 'ptt_stop': {
          this.pttOn = false;
          const buf = this.pttBuffer.slice();
          this.pttBuffer = [];
          if (buf.length >= Math.floor(this.minMs / 1000 * SR)) {
            this.postUtterance(buf);
          } else {
            this.port.postMessage({ type: 'state', state: 'ptt_too_short' });
          }
          this.port.postMessage({ type: 'state', state: 'idle' });
          break;
        }
      }
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const n = ch.length;

    // 写入环形缓冲
    for (let i = 0; i < n; i++) {
      this.ring[this.ringPos] = ch[i];
      this.ringPos = (this.ringPos + 1) % this.ringLen;
    }
    this.totalFrames += n;

    // RMS（带输入增益）
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = ch[i] * this.inputGain;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / n);
    this.port.postMessage({ type: 'rms', rms });

    if (this.mode === 'auto') this.autoStep(rms, n);
    else if (this.mode === 'ptt' && this.pttOn) {
      const cap = Math.floor(this.maxMs / 1000 * SR);
      for (let i = 0; i < n && this.pttBuffer.length < cap; i++) {
        this.pttBuffer.push(ch[i] * this.inputGain);
      }
    }
    return true;
  }

  autoStep(rms, n) {
    const holdF = Math.floor(this.holdMs / 1000 * SR);
    const silenceF = Math.floor(this.silenceMs / 1000 * SR);
    const maxF = Math.floor(this.maxMs / 1000 * SR);

    if (!this.speaking) {
      if (rms > this.startThr) {
        this.speakFrames += n;
        if (this.speakFrames >= holdF) {
          this.speaking = true;
          this.onsetFrame = this.totalFrames;
          this.speakFrames = 0;
          this.silenceFrames = 0;
          this.port.postMessage({ type: 'state', state: 'speaking' });
        }
      } else {
        this.speakFrames = 0;
      }
    } else {
      this.speakFrames += n;
      if (rms < this.endThr) this.silenceFrames += n;
      else this.silenceFrames = 0;

      if (this.silenceFrames >= silenceF || this.speakFrames >= maxF) {
        const prerollF = Math.floor(this.prerollMs / 1000 * SR);
        const start = Math.max(0, this.onsetFrame - prerollF);
        const end = this.totalFrames - this.silenceFrames; // 去掉尾部静音
        this.speaking = false;
        this.speakFrames = 0;
        this.silenceFrames = 0;
        if (end - start >= Math.floor(this.minMs / 1000 * SR)) {
          this.postUtterance(this.extractRing(start, Math.max(start, end)));
        }
        this.port.postMessage({ type: 'state', state: 'idle' });
      }
    }
  }

  extractRing(fromFrame, toFrame) {
    const len = Math.min(toFrame - fromFrame, this.ringLen);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const idx = ((fromFrame + i) % this.ringLen + this.ringLen) % this.ringLen;
      out[i] = this.ring[idx] * this.inputGain;
    }
    return out;
  }

  postUtterance(samples) {
    if (!samples || samples.length === 0) return;
    // 转成 transferable buffer 发送
    const buf = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength);
    this.port.postMessage({ type: 'utterance', samples: buf, sampleRate: SR }, [buf]);
  }
}

registerProcessor('vad-processor', VADProcessor);
