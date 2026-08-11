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
import { getSharedPool, destroySharedPool, dropRelayConnections } from '../nostr/pool'
import { startWatchdog } from '../nostr/watchdog'
import { startClipboardSubscription, type ClipboardSubscription } from '../nostr/subscribe'
import { tryLastResort, noteRecovered } from '../platform/last-resort'
import { kickSigner } from '../platform/signer'
import { logConn } from '../nostr/connlog'
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
/**
 * 죽음이 연속 관측되면 복구 수단을 단계적으로 올린다 (헬스체크 tick 단위, 15초 간격).
 *
 * restartAll(구독만 재생성)은 pool 안의 relay 객체를 그대로 재사용하는데, nostr-tools의
 * relay.connect()는 기존 connectionPromise가 있으면 (영영 안 끝나는 것이어도) 그걸 그대로
 * 반환한다. 슬립 도중 CONNECTING 상태로 얼어붙은 소켓이 하나라도 pool에 남으면 이후의
 * 모든 재구독이 소켓 생성조차 없이 조용히 매달린다 — 실측: 앱 이틀 방치 후 OS 소켓 0개,
 * 헬스체크는 돌지만 접속 시도 자체가 안 생김. 그래서:
 *
 *   tick 1     restartAll        — 구독만 재생성 (릴레이가 CLOSED 보낸 정상 케이스용)
 *   tick 2~3   forceReconnect    — 소켓을 버리고 pool 맵에서도 제거 (좀비/웨지 소켓 퇴거)
 *   tick 4+    hardReset         — pool 객체 자체를 파괴하고 새로 만든다 (라이브러리가
 *                                  어떤 상태로 꼬였든 여기는 못 살아남는다)
 */
const FORCE_RECONNECT_AFTER_TICKS = 2
const HARD_RESET_AFTER_TICKS = 4
/**
 * hardReset조차 소용없는 죽음(예: WKWebView suspend 후 페이지 소켓 채널 고장 —
 * new WebSocket이 OS 소켓 생성조차 못 함)이 이 tick 수를 넘기면 최후수단
 * (페이지 리로드 → 앱 재시작)으로 올라간다. 8 tick ≈ 2분.
 */
const LAST_RESORT_AFTER_TICKS = 8
/**
 * 생사 프로브(REQ→EOSE 왕복) 응답 대기 시간.
 * 접속 실패도 EOSE 배칭에 카운트되므로(ensureRelay 3초 타임아웃 포함) 정상 상황에선
 * 수 초 안에 결판난다. 넉넉히 8초 — 15초 헬스체크 주기 안에서 완결되는 값.
 */
const PROBE_TIMEOUT_MS = 8_000

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
  /** 헬스체크에서 연속으로 "죽음"이 관측된 횟수. 살아있으면 0으로 리셋. */
  private deadTicks: number = 0
  /** 생사 프로브 중복 실행 방지 */
  private probeInFlight: boolean = false
  /** 최후수단(오라클 체크 포함) 중복 실행 방지 */
  private lastResortInFlight: boolean = false

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
    logConn(`force reconnect: ${reason}`)
    // 클립보드 소켓을 못 믿는 상황이면 signer 소켓도 못 믿는다 — 같이 재생성
    kickSigner(reason)
    // 구독을 버리기 전에 진행 지점을 챙긴다 (재구독 since 계산에 쓴다)
    this.harvestProgress()
    this.clipboardSub?.close(); this.clipboardSub = null
    this.relaySubCleanup?.(); this.relaySubCleanup = null
    this.blossomSubCleanup?.(); this.blossomSubCleanup = null
    this.profileSubCleanup?.(); this.profileSubCleanup = null
    dropRelayConnections([...new Set([...this.writeRelays, ...NIP65_DISCOVERY_RELAYS])])
    this.restartAll(true)
  }

  /**
   * 최후 수단 — 공유 pool 객체를 통째로 파괴하고 처음부터 다시 만든다.
   *
   * forceReconnect는 pool.close()를 거치는데, nostr-tools 내부 상태가 꼬인 relay는
   * close 경로 자체가 온전히 동작한다는 보장이 없다 (CONNECTING 소켓 미중단,
   * 스테일 connectionPromise 잔존 등). 새 pool은 빈 맵에서 시작하므로 이전 세대의
   * 어떤 상태도 승계하지 않는다 — 이후 구독은 반드시 새 WebSocket을 만든다.
   * BunkerSigner는 자기 전용 pool을 쓰므로 영향 없다.
   */
  private hardReset(reason: string): void {
    this.lastSubRestart = Date.now()
    console.warn(`[sync] hard reset (${reason}) — destroying shared pool`)
    logConn(`hard reset: ${reason}`)
    kickSigner(reason)
    this.harvestProgress()
    this.clipboardSub?.close(); this.clipboardSub = null
    this.relaySubCleanup?.(); this.relaySubCleanup = null
    this.blossomSubCleanup?.(); this.blossomSubCleanup = null
    this.profileSubCleanup?.(); this.profileSubCleanup = null
    try {
      destroySharedPool()
    } catch (err) {
      // 파괴가 실패해도 싱글턴은 비워지므로 다음 getSharedPool()은 새 pool을 만든다
      console.error('[sync] pool destroy failed (continuing with fresh pool):', err)
    }
    this.restartAll(true)
  }

  /** 클립보드 구독이 죽었으면 쿨다운(10초) 안에서 전체 재시작. 발행 중이면 건너뜀. */
  maybeRestartIfDead(): void {
    if (this.writeRelays.length === 0) return // 릴레이 디스커버리가 먼저 끝나야 함
    if (this.isPublishing) return
    const now = Date.now()
    if (now - this.lastSubRestart <= RESTART_COOLDOWN_MS) return

    if (!this.clipboardSub?.isAlive()) {
      this.escalate()
      return
    }

    // 구조 판정은 통과 — 하지만 relay.connected는 좀비 소켓(OS 소켓은 죽었는데
    // 이벤트가 JS까지 안 올라온 상태)에서 영원히 true로 얼어붙으므로,
    // 실제 REQ→EOSE 왕복으로 검증한다. 실패하면 같은 사다리로 올라간다.
    if (this.probeInFlight) return
    this.probeInFlight = true
    let probing: Promise<boolean>
    try {
      probing = this.clipboardSub.probe(PROBE_TIMEOUT_MS)
    } catch (err) {
      // 동기 예외로 probeInFlight가 true에 갇히면 헬스체크 전체가 영구 무력화된다
      this.probeInFlight = false
      console.error('[sync] probe threw synchronously — escalating:', err)
      this.escalate()
      return
    }
    void probing.then(ok => {
      this.probeInFlight = false
      if (!ok) {
        console.warn('[sync] liveness probe failed — connection is undead, escalating')
        this.escalate()
        return
      }
      if (this.deadTicks > 0) {
        logConn(`recovered after ${this.deadTicks} dead check(s)`)
      }
      this.deadTicks = 0
      noteRecovered()

      // 진짜 살아있음 — 일부 릴레이만 죽은 경우는 느린 주기로만 복구
      const status = this.clipboardSub?.getRelayStatus() ?? {}
      const dead = Object.keys(status).filter(url => !status[url])
      const nowInner = Date.now()
      if (dead.length > 0 && nowInner - this.lastRepair > REPAIR_INTERVAL_MS) {
        this.lastRepair = nowInner
        this.lastSubRestart = nowInner
        console.warn('[sync] partially dead relays — repairing:', dead)
        logConn(`repair: ${dead.length} dead relay(s)`)
        this.restartAll(true)
      }
    })
  }

  /**
   * 죽음 관측 1회분의 사다리 진행: restartAll → forceReconnect → hardReset
   * → (그래도 안 되면) 페이지 리로드/앱 재시작.
   *
   * 최후수단은 hardReset과 병행으로 발동한다 — 오라클 체크(비동기 5초)가 도는
   * 동안에도 hardReset 재시도는 계속해서, 오라클이 오프라인 판정을 내리면
   * 자연스럽게 hardReset 루프에 머문다.
   */
  private escalate(): void {
    this.deadTicks++
    if (this.deadTicks >= LAST_RESORT_AFTER_TICKS && !this.lastResortInFlight) {
      this.lastResortInFlight = true
      void tryLastResort(this.writeRelays)
        .catch(err => console.error('[sync] last resort failed:', err))
        .finally(() => { this.lastResortInFlight = false })
    }
    if (this.deadTicks >= HARD_RESET_AFTER_TICKS) {
      this.hardReset(`dead for ${this.deadTicks} checks`)
    } else if (this.deadTicks >= FORCE_RECONNECT_AFTER_TICKS) {
      this.forceReconnect(`dead for ${this.deadTicks} checks`)
    } else {
      this.lastSubRestart = Date.now()
      console.warn('[sync] subscription not alive — restarting all subscriptions')
      logConn('resubscribe: subscription dead')
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
