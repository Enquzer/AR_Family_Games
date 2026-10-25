/** Reconnecting WebSocket client with a tiny outbox. */
export class NetClient extends EventTarget {
  constructor({ room = 'HOME', role = 'host', name = 'Controller' } = {}) {
    super();
    this.room = room;
    this.role = role;
    this.name = name;
    this.ws = null;
    this.connected = false;
    this.closedByUser = false;
    this.backoff = 600;
    this.outbox = [];
    this.lastError = null;
    this.id = null;
  }

  connect() {
    this.closedByUser = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.#scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.connected = true;
      this.backoff = 600;
      this.lastError = null;
      this.send({ t: 'hello', room: this.room, role: this.role, name: this.name });
      for (const msg of this.outbox.splice(0)) this.send(msg);
      this.dispatchEvent(new CustomEvent('status', { detail: { connected: true } }));
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        this.id = msg.id;
        this.room = msg.room;
      }
      this.dispatchEvent(new CustomEvent('msg', { detail: msg }));
    });
    ws.addEventListener('close', (ev) => {
      this.connected = false;
      this.dispatchEvent(new CustomEvent('status', { detail: { connected: false, code: ev.code } }));
      if (!this.closedByUser) this.#scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      this.lastError = 'Connection failed';
    });
  }

  #scheduleReconnect() {
    setTimeout(() => {
      if (!this.closedByUser) this.connect();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 1.6, 5000);
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    if (msg.t !== 'poses') {
      this.outbox.push(msg);
      if (this.outbox.length > 40) this.outbox.shift();
    }
    return false;
  }

  close() {
    this.closedByUser = true;
    this.ws?.close(1000, 'bye');
  }
}
