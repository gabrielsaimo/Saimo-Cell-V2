import * as Network from 'expo-network';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useConnectStore, initConnectStore, DiscoveredTv, TvState, PhoneAudioMode } from '../stores/connectStore';

const CONNECT_CHANNEL_ID = 'saimo-connect-channel';
const CONNECT_NOTIF_ID = 'saimo-connect-ongoing';

async function setupConnectNotificationChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync(CONNECT_CHANNEL_ID, {
        name: 'Saimo Connect',
        description: 'Mantém o controle remoto e conexão com a TV Box em segundo plano',
        importance: Notifications.AndroidImportance.LOW,
        sound: null,
        enableVibrate: false,
        showBadge: false,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    } catch (_e) {}
  }
}

async function showConnectNotification(tvName: string): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await setupConnectNotificationChannel();
      await Notifications.scheduleNotificationAsync({
        identifier: CONNECT_NOTIF_ID,
        content: {
          title: `📺 Conectado a ${tvName}`,
          body: 'Saimo Connect ativo · Toque para abrir o controle remoto',
          data: { type: 'connect' },
          sticky: true,
          autoDismiss: false,
          color: '#6366F1',
          priority: Notifications.AndroidNotificationPriority.LOW,
        } as any,
        trigger: null,
      });
    } catch (_e) {}
  }
}

async function hideConnectNotification(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Notifications.dismissNotificationAsync(CONNECT_NOTIF_ID);
    } catch (_e) {}
  }
}

class SaimoConnectService {
  private ws: WebSocket | null = null;
  private pingInterval: any = null;
  private reconnectTimer: any = null;
  private autoScanInterval: any = null;
  private watchdogTimer: any = null;
  private currentIp: string | null = null;
  private currentPin: string | null = null;
  private lastKnownIp: string | null = null;
  private isScanning = false;
  private userExplicitlyDisconnected = false;
  private autoConnect = true;
  private lastActivity = Date.now();
  private initialized = false;

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

    // Monitora o ciclo de vida do aplicativo (bloqueio de tela / segundo plano)
    AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        // Celular desbloqueado ou app retornou para primeiro plano:
        // Se a conexão caiu em segundo plano, reconecta imediatamente!
        if (!this.isConnected() && !this.userExplicitlyDisconnected) {
          this.reconnect();
        }
      } else if (nextState === 'background') {
        // Tela apagada ou app em segundo plano:
        // Envia ping preventivo para manter o socket TCP acordado
        if (this.isConnected()) {
          this.sendPing();
        }
      }
    });
  }

  /** Inicialização completa ao abrir o aplicativo: carrega dados e auto-conecta */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      await initConnectStore();
      const store = useConnectStore.getState();
      const lastTv = store.discoveredTvs[0];
      if (lastTv?.ip) {
        this.lastKnownIp = lastTv.ip;
      }

      // Inicia auto-conexão imediata e silenciosa
      this.startAutoConnect(lastTv?.ip);

      // Verificação periódica em segundo plano (a cada 12 segundos)
      if (this.autoScanInterval) clearInterval(this.autoScanInterval);
      this.autoScanInterval = setInterval(() => {
        if (!this.isConnected() && !this.userExplicitlyDisconnected && this.autoConnect) {
          const target = this.currentIp || this.lastKnownIp;
          if (target) {
            this.probeIp(target, 600).then((tv) => {
              if (tv && !this.isConnected() && !this.userExplicitlyDisconnected) {
                this.connect(tv.ip);
              }
            });
          } else {
            this.discoverTvs();
          }
        }
      }, 12000);
    } catch (_e) {}
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && useConnectStore.getState().status === 'connected';
  }

  /** Inicia processo de conexão automática sem intervenção do usuário */
  async startAutoConnect(preferredIp?: string): Promise<void> {
    this.userExplicitlyDisconnected = false;
    this.autoConnect = true;

    if (this.isConnected()) return;

    if (preferredIp) {
      this.lastKnownIp = preferredIp;
      const tv = await this.probeIp(preferredIp, 600);
      if (tv && !this.isConnected() && !this.userExplicitlyDisconnected) {
        this.connect(tv.ip);
        return;
      }
    }

    // Se o IP preferido não respondeu ou não existe, dispara busca na sub-rede
    await this.discoverTvs();
  }

  /** Varredura da rede local para encontrar aparelhos com Saimo TV */
  async discoverTvs(): Promise<DiscoveredTv[]> {
    if (this.isScanning) return useConnectStore.getState().discoveredTvs;
    this.isScanning = true;
    useConnectStore.getState().setStatus(this.isConnected() ? 'connected' : 'discovering');

    const foundTvs: DiscoveredTv[] = [];

    try {
      // 1. Tenta primeiro as TVs já conhecidas no cache
      const known = useConnectStore.getState().discoveredTvs;
      for (const tv of known) {
        const ok = await this.probeIp(tv.ip, 600);
        if (ok) {
          foundTvs.push(ok);
          // Se autoConnect estiver ligado e não estiver conectado, conecta na hora!
          if (this.autoConnect && !this.isConnected() && !this.userExplicitlyDisconnected) {
            this.connect(ok.ip);
            return foundTvs;
          }
        }
      }

      if (this.isConnected()) {
        return foundTvs;
      }

      // 2. Descobre IP local deste celular para varrer a sub-rede
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

          // Executa em lotes paralelos de 32 para varredura veloz
          const BATCH_SIZE = 32;
          for (let i = 0; i < ips.length; i += BATCH_SIZE) {
            if (this.isConnected()) break;

            const batch = ips.slice(i, i + BATCH_SIZE);
            const promises = batch.map((ip) => this.probeIp(ip, 650));
            const results = await Promise.all(promises);
            for (const r of results) {
              if (r && !foundTvs.some((t) => t.id === r.id)) {
                foundTvs.push(r);
                useConnectStore.getState().addDiscoveredTv(r);
                // Conecta automaticamente na primeira TV que responder!
                if (this.autoConnect && !this.isConnected() && !this.userExplicitlyDisconnected) {
                  this.connect(r.ip);
                  break;
                }
              }
            }
          }
        }
      }
    } catch (_e) {
    } finally {
      this.isScanning = false;
      if (!this.isConnected() && useConnectStore.getState().status === 'discovering') {
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentIp === ip) {
      return;
    }

    this.disconnectInternal();
    this.currentIp = ip;
    this.lastKnownIp = ip;
    this.currentPin = pin || null;
    this.userExplicitlyDisconnected = false;
    this.autoConnect = true;

    useConnectStore.getState().setStatus('connecting');

    const wsUrl = `ws://${ip}:8999/ws`;
    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        const store = useConnectStore.getState();
        // Handshake inicial obrigatório
        const helloMsg = {
          t: 'hello',
          cid: store.cid,
          name: store.phoneName,
          pin: this.currentPin || undefined,
        };
        ws.send(JSON.stringify(helloMsg));
        this.lastActivity = Date.now();
        this.startHeartbeat();
      };

      ws.onmessage = (event) => {
        if (this.ws !== ws) return;
        this.lastActivity = Date.now();
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg, ip);
        } catch (_e) {}
      };

      ws.onerror = (_err) => {
        if (this.ws === ws) {
          this.handleDisconnect();
        }
      };

      ws.onclose = () => {
        if (this.ws === ws) {
          this.handleDisconnect();
        }
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

        // Mostra notificação contínua no Android para manter segundo plano vivo
        showConnectNotification(tvName);

        // Se houver áudio selecionado, sincroniza
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
        this.disconnect(true);
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
        this.lastActivity = Date.now();
        break;
    }
  }

  private sendPing(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ t: 'ping' }));
      } catch (_e) {}
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    // Heartbeat regular a cada 5 segundos para manter a conexão saudável em segundo plano
    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, 5000);

    // Watchdog: se não receber resposta em 15 segundos, força reconexão
    this.watchdogTimer = setInterval(() => {
      if (this.isConnected() && Date.now() - this.lastActivity > 15000) {
        this.handleDisconnect();
      }
    }, 5000);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private handleDisconnect(): void {
    this.stopHeartbeat();
    hideConnectNotification();
    useConnectStore.getState().setStatus('disconnected');

    if (!this.userExplicitlyDisconnected && this.autoConnect) {
      this.scheduleReconnect();
    }
  }

  /** Agenda reconexão automática resiliente com backoff curto */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isConnected() && !this.userExplicitlyDisconnected && this.autoConnect) {
        this.reconnect();
      }
    }, 2000);
  }

  /** Tenta reconectar imediatamente à última TV ou busca na rede */
  reconnect(): void {
    if (this.isConnected()) return;
    const target = this.currentIp || this.lastKnownIp;
    if (target) {
      this.connect(target, this.currentPin || undefined);
    } else {
      this.discoverTvs();
    }
  }

  private disconnectInternal(): void {
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
  }

  /** Desconecta explicitamente a pedido do usuário */
  disconnect(userInitiated = true): void {
    if (userInitiated) {
      this.userExplicitlyDisconnected = true;
      this.autoConnect = false;
    }
    this.disconnectInternal();
    hideConnectNotification();
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

  // Comandos auxiliares de conveniência
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

  requestSync(): void {
    this.sendCommand({ t: 'sync' });
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
