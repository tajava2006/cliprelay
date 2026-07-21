/**
 * 싱크 엔진 — 클립보드 동기화의 중앙 컨트롤러
 *
 * App.tsx에 흩어져 있던 디스커버리(릴레이/Blossom/프로필) 구독, 클립보드 구독,
 * 클립보드 모니터, 헬스체크를 한 곳에 모았다.
 *
 * 외부(App.tsx)는 SyncEngine 인스턴스를 만들어 start/stop만 호출하고,
 * 변경 알림(릴레이·서버·프로필)은 콜백으로 받는다.
 */
import {
  subscribeWriteRelays, subscribeBlossomServers, subscribeProfile, NIP65_DISCOVERY_RELAYS,
} from '@cliprelay/shared'
import type { UserProfile } from '@cliprelay/shared'
import { saveWriteRelays } from '../store/relay-store'
import { saveBlossomServers } from '../store/blossom-store'
import { saveProfile } from '../store/profile-store'
import { getSharedPool, dropRelayConnections } from '../nostr/pool'
import { startWatchdog } from '../nostr/watchdog'
import { startClipboardSubscription, type ClipboardSubscription } from '../nostr/subscribe'
import { startPlatformClipboardMonitor } from '../platform/clipboard'
import { startNativeSubscription } from '../platform/android/foreground-service'
import { publishClipboard } from '../nostr/publish'
import { rgbaToPng, uploadImage } from '../blossom/upload'
import type { ClipboardMonitor } from './monitor'
import { fingerprintPng } from './fingerprint'

const HEALTH_INTERVAL_MS = 15_000
const RESTART_COOLDOWN_MS = 10_000
/**
 * 재시작 시 되돌아볼 시간(초).
 * 구독이 죽어 있던 동안 도착한 이벤트를 놓치지 않으려면 since를 과거로 당겨야 한다.
 * 이미 처리한 이벤트는 히스토리 id 대조로 걸러지므로 다시 받아도 안전하다.
 */
const RESTART_LOOKBACK_S = 300
/**
 * 일부 릴레이만 죽었을 때 복구를 시도하는 주기.
 *
 * 하나라도 살아 있으면 수신은 되므로 급하진 않지만, 그대로 두면 이중화가 조용히
 * 사라진다(끊긴 릴레이는 nostr-tools가 재연결해 주지 않는 경우가 많다).
 * 15초 헬스체크로 매번 재시도하면 kind:10002에 죽은 URL이 하나 섞여 있을 때
 * 영원히 재접속 폭풍이 되므로, 복구는 느린 주기로만 돈다.
 */
const REPAIR_INTERVAL_MS = 300_000

export interface SyncEngineOpts {
  userPubkey: string
  writeRelays: string[]
  blossomServers: string[]
  onWriteRelaysChange?: (relays: string[]) => void
  onBlossomServersChange?: (servers: string[]) => void
  onProfileChange?: (profile: UserProfile) => void
}

export class SyncEngine {
  private userPubkey: string
  private writeRelays: string[]
  private blossomServers: string[]
  private onWriteRelaysChange?: (relays: string[]) => void
  private onBlossomServersChange?: (servers: string[]) => void
  private onProfileChange?: (profile: UserProfile) => void

  private relaySubCleanup: (() => void) | null = null
  private blossomSubCleanup: (() => void) | null = null
  private profileSubCleanup: (() => void) | null = null
  private clipboardSub: ClipboardSubscription | null = null
  private monitor: ClipboardMonitor | null = null
  private healthCheckHandle: ReturnType<typeof setInterval> | null = null
  private watchdogCleanup: (() => void) | null = null

  private lastSyncedText: string = ''
  private lastSyncedImageFp: string = ''
  private isPublishing: boolean = false
  private lastSubRestart: number = 0
  private lastRepair: number = 0
  private lastEventCreatedAt: number = 0

  constructor(opts: SyncEngineOpts) {
    this.userPubkey = opts.userPubkey
    this.writeRelays = opts.writeRelays
    this.blossomServers = opts.blossomServers
    this.onWriteRelaysChange = opts.onWriteRelaysChange
    this.onBlossomServersChange = opts.onBlossomServersChange
    this.onProfileChange = opts.onProfileChange
  }

  async start(): Promise<void> {
    this.startRelayDiscovery()
    this.startBlossomDiscovery()
    this.startProfileDiscovery()
    await this.startMonitor()
    this.startHealthCheck()
    this.startWatchdog()
  }

  stop(): void {
    if (this.healthCheckHandle) { clearInterval(this.healthCheckHandle); this.healthCheckHandle = null }
    this.watchdogCleanup?.(); this.watchdogCleanup = null
    this.relaySubCleanup?.(); this.relaySubCleanup = null
    this.blossomSubCleanup?.(); this.blossomSubCleanup = null
    this.profileSubCleanup?.(); this.profileSubCleanup = null
    this.clipboardSub?.close(); this.clipboardSub = null
    this.monitor?.stop(); this.monitor = null
  }

  /**
   * 모든 구독을 즉시 재시작 (포그라운드 복귀·네트워크 복구 시)
   *
   * @param lookback 죽어 있던 동안 놓친 이벤트를 되받을지. 복구 경로에서만 true.
   *                 릴레이 목록 변경 같은 정상 재구독에서는 false여야 한다
   *                 (앱 실행 전 클립보드 이력이 뒤늦게 밀려들어오면 안 되므로).
   */
  restartAll(lookback: boolean = false): void {
    console.log('[sync] restarting all subscriptions')
    this.startRelayDiscovery()
    this.startBlossomDiscovery()
    this.startProfileDiscovery()
    this.restartClipboardSubscription(lookback)
  }

  /**
   * 소켓까지 버리고 처음부터 다시 붙는다.
   *
   * restartAll()은 구독만 다시 만들기 때문에, 소켓이 좀비(readyState=OPEN인데 죽음)면
   * 같은 죽은 소켓 위에 구독을 다시 얹게 되어 아무것도 고쳐지지 않는다.
   * 슬립 복귀·네트워크 복구처럼 "소켓 자체를 못 믿는" 상황에서는 이쪽을 쓴다.
   */
  forceReconnect(reason: string): void {
    const now = Date.now()
    if (now - this.lastSubRestart <= RESTART_COOLDOWN_MS) return
    this.lastSubRestart = now
    console.warn(`[sync] force reconnect (${reason}) — dropping sockets`)
    // 구독을 버리기 전에 진행 지점을 챙긴다 (재구독 since 계산에 쓴다)
    this.harvestProgress()
    this.clipboardSub?.close(); this.clipboardSub = null
    this.relaySubCleanup?.(); this.relaySubCleanup = null
    this.blossomSubCleanup?.(); this.blossomSubCleanup = null
    this.profileSubCleanup?.(); this.profileSubCleanup = null
    dropRelayConnections([...new Set([...this.writeRelays, ...NIP65_DISCOVERY_RELAYS])])
    this.restartAll(true)
  }

  /** 클립보드 구독이 죽었으면 쿨다운(10초) 안에서 전체 재시작. 발행 중이면 건너뜀. */
  maybeRestartIfDead(): void {
    if (this.writeRelays.length === 0) return // 릴레이 디스커버리가 먼저 끝나야 함
    if (this.isPublishing) return
    const now = Date.now()
    if (now - this.lastSubRestart <= RESTART_COOLDOWN_MS) return

    if (!this.clipboardSub?.isAlive()) {
      this.lastSubRestart = now
      console.warn('[sync] subscription not alive — restarting all subscriptions')
      this.restartAll(true)
      return
    }

    // 일부 릴레이만 죽은 경우 — 수신은 되고 있으니 느린 주기로만 복구
    const status = this.clipboardSub.getRelayStatus()
    const dead = Object.keys(status).filter(url => !status[url])
    if (dead.length > 0 && now - this.lastRepair > REPAIR_INTERVAL_MS) {
      this.lastRepair = now
      this.lastSubRestart = now
      console.warn('[sync] partially dead relays — repairing:', dead)
      this.restartAll(true)
    }
  }

  getRelayStatus(): Promise<Record<string, boolean>> {
    return Promise.resolve(this.clipboardSub?.getRelayStatus() ?? {})
  }

  /** History에서 텍스트 클릭 시 클립보드에 쓴 후 monitor에 알린다 (자기쓰기 무시용) */
  setMonitorLastKnownText(text: string): void { this.monitor?.setLastKnown(text) }
  setMonitorLastKnownImageFingerprint(fp: string): void { this.monitor?.setLastKnownImageFingerprint(fp) }

  // Android lifecycle (publish 루프)에서 사용
  getWriteRelays(): string[] { return this.writeRelays }
  getBlossomServers(): string[] { return this.blossomServers }
  getIsPublishing(): boolean { return this.isPublishing }
  setIsPublishing(v: boolean): void { this.isPublishing = v }
  getLastSyncedText(): string { return this.lastSyncedText }
  setLastSyncedText(v: string): void { this.lastSyncedText = v }
  getLastSyncedImageFp(): string { return this.lastSyncedImageFp }
  setLastSyncedImageFp(v: string): void { this.lastSyncedImageFp = v }

  private startRelayDiscovery(): void {
    this.relaySubCleanup?.()
    this.relaySubCleanup = subscribeWriteRelays(this.userPubkey, relays => {
      void saveWriteRelays(relays)
      const changed = !(this.writeRelays.length === relays.length && this.writeRelays.every((r, i) => r === relays[i]))
      this.writeRelays = relays
      if (changed) this.onWriteRelaysChange?.(relays)
      // write 릴레이 변경 시 Blossom·프로필·클립보드 구독도 새 릴레이로 재생성
      this.startBlossomDiscovery()
      this.startProfileDiscovery()
      this.restartClipboardSubscription()
      // Android: 네이티브 OkHttp 구독을 새 릴레이로 재시작
      void startNativeSubscription(relays, this.userPubkey).catch(err => console.warn('[native-sub] relay change restart failed:', err))
    }, getSharedPool())
  }

  private startBlossomDiscovery(): void {
    this.blossomSubCleanup?.()
    this.blossomSubCleanup = subscribeBlossomServers(this.userPubkey, this.writeRelays, servers => {
      void saveBlossomServers(servers)
      this.blossomServers = servers
      this.onBlossomServersChange?.(servers)
    }, getSharedPool())
  }

  private startProfileDiscovery(): void {
    this.profileSubCleanup?.()
    this.profileSubCleanup = subscribeProfile(this.userPubkey, this.writeRelays, profile => {
      void saveProfile(profile)
      this.onProfileChange?.(profile)
    }, getSharedPool())
  }

  /** 구독을 버리기 전에 "어디까지 받았는지"를 엔진 쪽에 옮겨 둔다 */
  private harvestProgress(): void {
    if (!this.clipboardSub) return
    this.lastEventCreatedAt = Math.max(this.lastEventCreatedAt, this.clipboardSub.getLastEventCreatedAt())
  }

  private restartClipboardSubscription(lookback: boolean = false): void {
    this.harvestProgress()

    // 복구 재시작이면 죽어 있던 동안 놓친 이벤트를 받으려고 since를 과거로 당긴다.
    // 이미 처리한 이벤트는 히스토리 id 대조로 걸러지므로 중복 적용은 안 된다.
    const nowSec = Math.floor(Date.now() / 1000)
    const since = lookback
      ? Math.max(this.lastEventCreatedAt + 1, nowSec - RESTART_LOOKBACK_S)
      : nowSec

    this.clipboardSub?.close()
    this.clipboardSub = startClipboardSubscription(
      this.userPubkey,
      this.writeRelays,
      text => {
        this.monitor?.setLastKnown(text)
        this.lastSyncedText = text
      },
      (fp, pngBytes) => {
        this.monitor?.setLastKnownImageFingerprint(fp)
        this.lastSyncedImageFp = fingerprintPng(pngBytes)
      },
      since,
    )
  }

  private async startMonitor(): Promise<void> {
    this.monitor?.stop()
    this.monitor = await startPlatformClipboardMonitor(
      (text: string) => {
        void publishClipboard(
          { type: 'text', content: text },
          this.writeRelays,
        ).catch(err => console.error('[monitor] text publish failed:', err))
      },
      (rgba: Uint8Array, width: number, height: number) => {
        void (async () => {
          const servers = this.blossomServers
          if (servers.length === 0) {
            console.warn('[monitor] no Blossom servers — skipping image publish')
            return
          }
          try {
            const pngBytes = await rgbaToPng(rgba, width, height)
            const payload = await uploadImage(pngBytes, servers)
            await publishClipboard(payload, this.writeRelays)
          } catch (err) {
            console.error('[monitor] image publish failed:', err)
          }
        })()
      },
    )
    // 수신한 텍스트를 클립보드에 썼을 때 재발행 루프 방지
    this.restartClipboardSubscription()
  }

  private startHealthCheck(): void {
    if (this.healthCheckHandle) clearInterval(this.healthCheckHandle)
    // 15초 주기 — 살아있는 릴레이 구독이 하나도 없으면 전체 재시작
    this.healthCheckHandle = setInterval(() => this.maybeRestartIfDead(), HEALTH_INTERVAL_MS)
  }

  /**
   * 슬립 복귀·네트워크 복구 감지 → 소켓째 재연결.
   *
   * 헬스체크(15초)만으로는 부족하다. 좀비 소켓은 relay.connected가 계속 true라서
   * 구조 판정으로도 살아있는 걸로 보이고, 슬립 중에는 타이머 자체가 안 돌기 때문이다.
   * "잠들었다 깨어났다"는 사실을 직접 감지해서 무조건 새로 붙는 게 유일하게 확실하다.
   */
  private startWatchdog(): void {
    this.watchdogCleanup?.()
    this.watchdogCleanup = startWatchdog({
      onWake: driftMs => this.forceReconnect(`wake after ${Math.round(driftMs / 1000)}s`),
      onOnline: () => this.forceReconnect('network online'),
    })
  }
}
