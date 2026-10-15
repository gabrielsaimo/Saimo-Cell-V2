import * as Network from 'expo-network';
import { useConnectStore, DiscoveredTv, TvState, PhoneAudioMode } from '../stores/connectStore';

class SaimoConnectService {
  private ws: WebSocket | null = null;
  private pingInterval: any = null;
  private reconnectTimer: any = null;
  private currentIp: string | null = null;
  private currentPin: string | null = null;
  private isScanning = false;

  constructor() {
    // Escuta mudanças de phoneAudioMode na store para sincronizar com a TV
    useConnectStore.subscribe((state, prevState) => {
      if (state.phoneAudioMode !== prevState.phoneAudioMode && this.isConnected()) {
        this.sendCommand({
          t: 'phoneAudio',
          src: state.phoneAudioMode,
        });
      }
    });
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && useConnectStore.getState().status === 'connected';
  }

  /** Varredura da rede local para encontrar aparelhos com Saimo TV */
  async discoverTvs(): Promise<DiscoveredTv[]> {
    if (this.isScanning) return useConnectStore.getState().discoveredTvs;
    this.isScanning = true;
    useConnectStore.getState().setStatus(this.isConnected() ? 'connected' : 'discovering');

    const foundTvs: DiscoveredTv[] = [];

    try {
      // 1. Tenta primeiro as TVs já conhecidas (último IP)
      const known = useConnectStore.getState().discoveredTvs;
      for (const tv of known) {
        const ok = await this.probeIp(tv.ip, 600);
        if (ok) {
          foundTvs.push(ok);
        }
      }

      // 2. Descobre IP local deste celular
      const localIp = await Network.getIpAddressAsync().catch(() => null);
      if (localIp && localIp.includes('.')) {
        const parts = localIp.split('.');
        if (parts.length === 4) {
          const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
          const currentHost = parseInt(parts[3], 10);

          // Gera lista de IPs para varrer (1..254)
          const ips: string[] = [];
          for (let i = 1; i <= 254; i++) {
            if (i !== currentHost) {
              ips.push(`${subnet}.${i}`);
            }
          }

          // Executa em lotes paralelos de 32
          const BATCH_SIZE = 32;
          for (let i = 0; i < ips.length; i += BATCH_SIZE) {
            const batch = ips.slice(i, i + BATCH_SIZE);
            const promises = batch.map((ip) => this.probeIp(ip, 750));
            const results = await Promise.all(promises);
            for (const r of results) {
              if (r && !foundTvs.some((t) => t.id === r.id)) {
                foundTvs.push(r);
                useConnectStore.getState().addDiscoveredTv(r);
              }
            }
          }
        }
      }
    } catch (_e) {
    } finally {
      this.isScanning = false;
      if (!this.isConnected()) {
        useConnectStore.getState().setStatus('disconnected');
      }
    }

    return foundTvs;
  }

  /** Testa se um IP específico é uma Saimo TV respondendo em /info */
  async probeIp(ip: string, timeoutMs = 800): Promise<DiscoveredTv | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(`http://${ip}:8999/info`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (resp.ok) {
        const data = await resp.json();
        if (data && data.app === 'saimo-tv') {
          const tv: DiscoveredTv = {
            id: data.id || ip,
            name: data.name || `Saimo TV (${ip})`,
            ip,
            port: data.port || 8999,
            version: data.version,
            lastSeen: Date.now(),
          };
          useConnectStore.getState().addDiscoveredTv(tv);
          return tv;
        }
      }
    } catch (_e) {
      clearTimeout(timer);
    }
    return null;
  }

  /** Conecta a uma TV pelo IP (e opcionalmente código PIN) */
  connect(ip: string, pin?: string): void {
    this.disconnect();
    this.currentIp = ip;
    this.currentPin = pin || null;

    useConnectStore.getState().setStatus('connecting');

    const wsUrl = `ws://${ip}:8999/ws`;
    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        const store = useConnectStore.getState();
        // Handshake inicial obrigatório
        const helloMsg = {
          t: 'hello',
          cid: store.cid,
          name: store.phoneName,
          pin: this.currentPin || undefined,
        };
        ws.send(JSON.stringify(helloMsg));
        this.startHeartbeat();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg, ip);
        } catch (_e) {}
      };

      ws.onerror = (_err) => {
        this.handleDisconnect();
      };

      ws.onclose = () => {
        this.handleDisconnect();
      };
    } catch (_e) {
      this.handleDisconnect();
    }
  }

  private handleMessage(msg: any, ip: string): void {
    const store = useConnectStore.getState();

    switch (msg.t) {
      case 'welcome': {
        store.setStatus('connected');
        const tvName = msg.tv?.name || `Saimo TV (${ip})`;
        const tvId = msg.tv?.id || ip;
        store.setConnectedTv({
          id: tvId,
          name: tvName,
          ip,
          port: 8999,
          lastSeen: Date.now(),
        });
        // Informa se este celular já está com áudio selecionado
        if (store.phoneAudioMode !== 'none') {
          this.sendCommand({ t: 'phoneAudio', src: store.phoneAudioMode });
        }
        break;
      }
      case 'pending': {
        store.setStatus('pending');
        break;
      }
      case 'denied': {
        store.setStatus('disconnected');
        this.disconnect();
        break;
      }
      case 'state': {
        store.setTvState(msg as TvState);
        break;
      }
      case 'textRequest': {
        store.setTextRequest({
          hint: msg.hint || 'Buscar',
          value: msg.value || '',
        });
        break;
      }
      case 'textDone': {
        store.setTextRequest(null);
        break;
      }
      case 'pong':
        break;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ t: 'ping' }));
      }
    }, 10000);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private handleDisconnect(): void {
    this.stopHeartbeat();
    useConnectStore.getState().setStatus('disconnected');
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_e) {}
      this.ws = null;
    }
    useConnectStore.getState().setStatus('disconnected');
    useConnectStore.getState().setTvState(null);
  }

  /** Envia um comando JSON para a TV Box */
  sendCommand(cmd: object): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(cmd));
        return true;
      } catch (_e) {}
    }
    return false;
  }

  // Comandos auxiliares de alta conveniência
  tuneChannel(channel: string, screen?: number): void {
    this.sendCommand({
      t: 'tune',
      channel,
      screen: screen !== undefined ? screen : undefined,
    });
  }

  toggleMultiTela(on: boolean): void {
    this.sendCommand({ t: 'multi', on });
  }

  setActiveScreen(idx: number): void {
    this.sendCommand({ t: 'activeScreen', idx });
  }

  setTvAudio(src: '0' | '1' | 'mute'): void {
    this.sendCommand({ t: 'tvAudio', src });
  }

  setPhoneAudio(src: PhoneAudioMode): void {
    useConnectStore.getState().setPhoneAudioMode(src);
    this.sendCommand({ t: 'phoneAudio', src });
  }

  trocarFonte(delta: number): void {
    this.sendCommand({ t: 'fonte', delta });
  }

  sendKey(
    code:
      | 'UP'
      | 'DOWN'
      | 'LEFT'
      | 'RIGHT'
      | 'OK'
      | 'BACK'
      | 'HOME'
      | 'MENU'
      | 'CH_UP'
      | 'CH_DOWN'
      | '0'
      | '1'
      | '2'
      | '3'
      | '4'
      | '5'
      | '6'
      | '7'
      | '8'
      | '9'
  ): void {
    this.sendCommand({ t: 'key', code });
  }

  setVolume(delta?: number, set?: number, mute?: boolean): void {
    this.sendCommand({ t: 'volume', delta, set, mute });
  }

  playVod(
    key: string,
    temporada?: number,
    episodio?: number,
    fonte?: number,
    extra?: {
      url?: string;
      title?: string;
      poster?: string;
      letter?: string;
      year?: string;
      isSeries?: boolean;
      startTime?: number;
    }
  ): void {
    this.sendCommand({ t: 'playVod', key, temporada, episodio, fonte, ...extra });
  }

  playMedia(
    url: string,
    title?: string,
    poster?: string,
    startTime?: number,
    extra?: object
  ): void {
    this.sendCommand({ t: 'playMedia', url, title, poster, startTime, ...extra });
  }

  playPause(): void {
    this.sendCommand({ t: 'playPause' });
  }

  seek(ms: number, delta?: number): void {
    this.sendCommand({ t: 'seek', ms, delta });
  }

  sendText(value: string): void {
    this.sendCommand({ t: 'text', value });
  }
}

export const saimoConnect = new SaimoConnectService();
