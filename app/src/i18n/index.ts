/**
 * 다국어 지원 (i18n)
 *
 * 브라우저 언어 설정에 따라 자동 선택, 미지원 언어는 영어 폴백.
 * t('key') 함수로 번역 문자열을 가져온다.
 */

export type Locale = 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'pt' | 'hi' | 'ar' | 'fr' | 'de'

type Messages = Record<string, string>

const en: Messages = {
  'app.loading': 'Loading…',
  'app.title': 'ClipRelay',

  // Login
  'login.subtitle': 'Sign in with NIP-46',
  'login.tab.qr': 'QR Code',
  'login.tab.bunker': 'bunker URL',
  'login.qr.hint': 'Scan QR with a bunker app like Amber',
  'login.qr.copy_uri': 'Copy URI',
  'login.qr.waiting': 'Waiting for bunker…',
  'login.connecting': 'Connecting…',
  'login.bunker.placeholder': 'bunker://<pubkey>?relay=wss://...',
  'login.bunker.connect': 'Connect',
  'login.tab.amber': 'Amber',
  'login.amber.hint': 'Sign in with Amber signer app',
  'login.amber.connect': 'Connect with Amber',
  'login.retry': 'Retry',
  'login.error.timeout': 'Connection timed out. Please try again.',
  'login.error.default': 'Connection failed.',

  // Main
  'main.relays': 'Write Relays',
  'main.relays.empty': 'kind:10002 not found — Please configure relays in your Nostr client.',
  'main.blossom': 'Blossom Servers',
  'main.blossom.empty': 'kind:10063 not found — File sync disabled',
  'main.history': 'History',
  'main.logout': 'Logout',
  'main.perm.section': 'Permissions Required',
  'main.perm.notification.label': 'Notification Permission',
  'main.perm.notification.desc': 'Required to show incoming and persistent notifications.',
  'main.perm.notification.btn': 'Allow',
  'main.perm.battery.label': 'Battery Optimization',
  'main.perm.battery.desc': 'Required to keep the subscription running in the background.',
  'main.perm.battery.btn': 'Configure',

  // History
  'history.title': 'History',
  'history.clear': 'Clear All',
  'history.empty': 'No history yet.',
  'history.copied': 'copied',

  // Toast
  'toast.clipboard.text': 'Text copied',
  'toast.clipboard.image': 'Image copied',
  'toast.encrypt.start': 'Encrypting…',
  'toast.encrypt.ok': 'Encrypted',
  'toast.encrypt.fail': 'Encryption failed',
  'toast.broadcast.start': 'Broadcasting…',
  'toast.relay.ok': 'OK',
  'toast.relay.fail': 'Failed',
  'toast.received': 'Event received',
  'toast.decrypt.start': 'Decrypting…',
  'toast.decrypt.ok': 'Decrypted',
  'toast.decrypt.fail': 'Decryption failed',
  'toast.clipboard.updated': 'Clipboard updated',

  // Notification (Android)
  'notification.received.tap': 'Clipboard event received. Tap to copy.',
}

const ko: Messages = {
  'app.loading': '불러오는 중…',

  'login.subtitle': 'NIP-46으로 로그인',
  'login.tab.qr': 'QR 코드',
  'login.tab.bunker': 'bunker URL',
  'login.qr.hint': 'Amber 등 벙커 앱으로 QR을 스캔하세요',
  'login.qr.copy_uri': 'URI 직접 복사',
  'login.qr.waiting': '벙커 응답 대기 중…',
  'login.connecting': '연결 중…',
  'login.bunker.connect': '연결',
  'login.tab.amber': 'Amber',
  'login.amber.hint': 'Amber 서명 앱으로 로그인합니다',
  'login.amber.connect': 'Amber로 로그인',
  'login.retry': '다시 시도',
  'login.error.timeout': '연결 대기 시간이 초과됐습니다. 다시 시도해 주세요.',
  'login.error.default': '연결에 실패했습니다.',

  'main.relays': '쓰기 릴레이',
  'main.relays.empty': 'kind:10002 없음 — Nostr 클라이언트에서 릴레이를 설정해 주세요.',
  'main.blossom': 'Blossom 서버',
  'main.blossom.empty': 'kind:10063 없음 — 파일 동기화 비활성',
  'main.history': '히스토리',
  'main.logout': '로그아웃',
  'main.perm.section': '권한 설정 필요',
  'main.perm.notification.label': '알림 권한',
  'main.perm.notification.desc': '수신 알림 및 상시 알림을 표시하려면 필요합니다.',
  'main.perm.notification.btn': '허용하기',
  'main.perm.battery.label': '배터리 최적화 해제',
  'main.perm.battery.desc': '백그라운드에서 구독을 끊김 없이 유지하려면 필요합니다.',
  'main.perm.battery.btn': '설정하기',

  'history.title': '히스토리',
  'history.clear': '전체 삭제',
  'history.empty': '아직 히스토리가 없습니다.',
  'history.copied': '복사됨',

  'toast.clipboard.text': '텍스트 복사됨',
  'toast.clipboard.image': '이미지 복사됨',
  'toast.encrypt.start': '암호화 중…',
  'toast.encrypt.ok': '암호화 완료',
  'toast.encrypt.fail': '암호화 실패',
  'toast.broadcast.start': '릴레이 전송 중…',
  'toast.relay.ok': '성공',
  'toast.relay.fail': '실패',
  'toast.received': '이벤트 수신',
  'toast.decrypt.start': '복호화 중…',
  'toast.decrypt.ok': '복호화 완료',
  'toast.decrypt.fail': '복호화 실패',
  'toast.clipboard.updated': '클립보드 갱신 완료',

  'notification.received.tap': '클립보드 이벤트를 수신했습니다. 탭하여 복사하세요.',
}

const ja: Messages = {
  'app.loading': '読み込み中…',

  'login.subtitle': 'NIP-46でログイン',
  'login.tab.qr': 'QRコード',
  'login.tab.bunker': 'bunker URL',
  'login.qr.hint': 'Amberなどのバンカーアプリでスキャン',
  'login.qr.copy_uri': 'URIをコピー',
  'login.qr.waiting': 'バンカー応答待ち…',
  'login.connecting': '接続中…',
  'login.bunker.connect': '接続',
  'login.tab.amber': 'Amber',
  'login.amber.hint': 'Amber署名アプリでログイン',
  'login.amber.connect': 'Amberでログイン',
  'login.retry': '再試行',
  'login.error.timeout': '接続がタイムアウトしました。もう一度お試しください。',
  'login.error.default': '接続に失敗しました。',

  'main.relays': '書き込みリレー',
  'main.relays.empty': 'kind:10002なし — Nostrクライアントでリレーを設定してください。',
  'main.blossom': 'Blossomサーバー',
  'main.blossom.empty': 'kind:10063なし — ファイル同期無効',
  'main.history': '履歴',
  'main.logout': 'ログアウト',
  'main.perm.section': '権限の設定が必要',
  'main.perm.notification.label': '通知の権限',
  'main.perm.notification.desc': '受信通知と常時通知を表示するために必要です。',
  'main.perm.notification.btn': '許可する',
  'main.perm.battery.label': 'バッテリー最適化の除外',
  'main.perm.battery.desc': 'バックグラウンドでの購読を維持するために必要です。',
  'main.perm.battery.btn': '設定する',

  'history.title': '履歴',
  'history.clear': '全削除',
  'history.empty': '履歴はまだありません。',
  'history.copied': 'コピー済み',

  'toast.clipboard.text': 'テキストをコピー',
  'toast.clipboard.image': '画像をコピー',
  'toast.encrypt.start': '暗号化中…',
  'toast.encrypt.ok': '暗号化完了',
  'toast.encrypt.fail': '暗号化失敗',
  'toast.broadcast.start': 'リレーに送信中…',
  'toast.relay.ok': '成功',
  'toast.relay.fail': '失敗',
  'toast.received': 'イベント受信',
  'toast.decrypt.start': '復号化中…',
  'toast.decrypt.ok': '復号化完了',
  'toast.decrypt.fail': '復号化失敗',
  'toast.clipboard.updated': 'クリップボード更新',

  'notification.received.tap': 'クリップボードイベントを受信しました。タップしてコピー。',
}

const zh: Messages = {
  'app.loading': '加载中…',

  'login.subtitle': '使用 NIP-46 登录',
  'login.tab.qr': '二维码',
  'login.tab.bunker': 'bunker URL',
  'login.qr.hint': '使用 Amber 等签名器扫描二维码',
  'login.qr.copy_uri': '复制 URI',
  'login.qr.waiting': '等待签名器响应…',
  'login.connecting': '连接中…',
  'login.bunker.connect': '连接',
  'login.retry': '重试',
  'login.error.timeout': '连接超时，请重试。',
  'login.error.default': '连接失败。',

  'main.relays': '写入中继',
  'main.relays.empty': '未找到 kind:10002 — 请在 Nostr 客户端中配置中继。',
  'main.blossom': 'Blossom 服务器',
  'main.blossom.empty': '未找到 kind:10063 — 文件同步已禁用',
  'main.history': '历史',
  'main.perm.section': '需要权限设置',
  'main.perm.notification.label': '通知权限',
  'main.perm.notification.desc': '显示接收通知和常驻通知所必需。',
  'main.perm.notification.btn': '允许',
  'main.perm.battery.label': '关闭电池优化',
  'main.perm.battery.desc': '在后台保持订阅连接所必需。',
  'main.perm.battery.btn': '去设置',

  'history.title': '历史',
  'history.clear': '全部删除',
  'history.empty': '暂无历史记录。',
  'history.copied': '已复制',

  'toast.clipboard.text': '文本已复制',
  'toast.clipboard.image': '图片已复制',
  'toast.encrypt.start': '加密中…',
  'toast.encrypt.ok': '加密完成',
  'toast.encrypt.fail': '加密失败',
  'toast.broadcast.start': '广播中…',
  'toast.relay.ok': '成功',
  'toast.relay.fail': '失败',
  'toast.received': '收到事件',
  'toast.decrypt.start': '解密中…',
  'toast.decrypt.ok': '解密完成',
  'toast.decrypt.fail': '解密失败',
  'toast.clipboard.updated': '剪贴板已更新',

  'notification.received.tap': '收到剪贴板事件。点击以复制。',
}

const es: Messages = {
  'app.loading': 'Cargando…',

  'login.subtitle': 'Iniciar sesión con NIP-46',
  'login.tab.qr': 'Código QR',
  'login.tab.bunker': 'URL bunker',
  'login.qr.hint': 'Escanea el QR con una app bunker como Amber',
  'login.qr.copy_uri': 'Copiar URI',
  'login.qr.waiting': 'Esperando respuesta del bunker…',
  'login.connecting': 'Conectando…',
  'login.bunker.connect': 'Conectar',
  'login.retry': 'Reintentar',
  'login.error.timeout': 'Tiempo de conexión agotado. Inténtalo de nuevo.',
  'login.error.default': 'Error de conexión.',

  'main.relays': 'Relays de escritura',
  'main.relays.empty': 'kind:10002 no encontrado — Configura relays en tu cliente Nostr.',
  'main.blossom': 'Servidores Blossom',
  'main.blossom.empty': 'kind:10063 no encontrado — Sincronización de archivos desactivada',
  'main.history': 'Historial',
  'main.perm.section': 'Permisos requeridos',
  'main.perm.notification.label': 'Permiso de notificaciones',
  'main.perm.notification.desc': 'Necesario para mostrar notificaciones entrantes y persistentes.',
  'main.perm.notification.btn': 'Permitir',
  'main.perm.battery.label': 'Optimización de batería',
  'main.perm.battery.desc': 'Necesario para mantener la suscripción activa en segundo plano.',
  'main.perm.battery.btn': 'Configurar',

  'history.title': 'Historial',
  'history.clear': 'Borrar todo',
  'history.empty': 'Aún no hay historial.',
  'history.copied': 'copiado',

  'toast.clipboard.text': 'Texto copiado',
  'toast.clipboard.image': 'Imagen copiada',
  'toast.encrypt.start': 'Cifrando…',
  'toast.encrypt.ok': 'Cifrado',
  'toast.encrypt.fail': 'Cifrado fallido',
  'toast.broadcast.start': 'Transmitiendo…',
  'toast.relay.ok': 'OK',
  'toast.relay.fail': 'Falló',
  'toast.received': 'Evento recibido',
  'toast.decrypt.start': 'Descifrando…',
  'toast.decrypt.ok': 'Descifrado',
  'toast.decrypt.fail': 'Descifrado fallido',
  'toast.clipboard.updated': 'Portapapeles actualizado',

  'notification.received.tap': 'Evento del portapapeles recibido. Toca para copiar.',
}

const pt: Messages = {
  'app.loading': 'Carregando…',

  'login.subtitle': 'Entrar com NIP-46',
  'login.tab.qr': 'Código QR',
  'login.tab.bunker': 'URL bunker',
  'login.qr.hint': 'Escaneie o QR com um app bunker como Amber',
  'login.qr.copy_uri': 'Copiar URI',
  'login.qr.waiting': 'Aguardando resposta do bunker…',
  'login.connecting': 'Conectando…',
  'login.bunker.connect': 'Conectar',
  'login.retry': 'Tentar novamente',
  'login.error.timeout': 'Tempo de conexão esgotado. Tente novamente.',
  'login.error.default': 'Falha na conexão.',

  'main.relays': 'Relays de escrita',
  'main.relays.empty': 'kind:10002 não encontrado — Configure relays no seu cliente Nostr.',
  'main.blossom': 'Servidores Blossom',
  'main.blossom.empty': 'kind:10063 não encontrado — Sincronização de arquivos desativada',
  'main.history': 'Histórico',
  'main.perm.section': 'Permissões necessárias',
  'main.perm.notification.label': 'Permissão de notificações',
  'main.perm.notification.desc': 'Necessário para exibir notificações recebidas e persistentes.',
  'main.perm.notification.btn': 'Permitir',
  'main.perm.battery.label': 'Otimização de bateria',
  'main.perm.battery.desc': 'Necessário para manter a assinatura ativa em segundo plano.',
  'main.perm.battery.btn': 'Configurar',

  'history.title': 'Histórico',
  'history.clear': 'Limpar tudo',
  'history.empty': 'Nenhum histórico ainda.',
  'history.copied': 'copiado',

  'toast.clipboard.text': 'Texto copiado',
  'toast.clipboard.image': 'Imagem copiada',
  'toast.encrypt.start': 'Criptografando…',
  'toast.encrypt.ok': 'Criptografado',
  'toast.encrypt.fail': 'Falha na criptografia',
  'toast.broadcast.start': 'Transmitindo…',
  'toast.relay.ok': 'OK',
  'toast.relay.fail': 'Falhou',
  'toast.received': 'Evento recebido',
  'toast.decrypt.start': 'Descriptografando…',
  'toast.decrypt.ok': 'Descriptografado',
  'toast.decrypt.fail': 'Falha na descriptografia',
  'toast.clipboard.updated': 'Área de transferência atualizada',

  'notification.received.tap': 'Evento da área de transferência recebido. Toque para copiar.',
}

const hi: Messages = {
  'app.loading': 'लोड हो रहा है…',

  'login.subtitle': 'NIP-46 से लॉगिन करें',
  'login.tab.qr': 'QR कोड',
  'login.tab.bunker': 'bunker URL',
  'login.qr.hint': 'Amber जैसे बंकर ऐप से QR स्कैन करें',
  'login.qr.copy_uri': 'URI कॉपी करें',
  'login.qr.waiting': 'बंकर प्रतिक्रिया की प्रतीक्षा…',
  'login.connecting': 'कनेक्ट हो रहा है…',
  'login.bunker.connect': 'कनेक्ट',
  'login.retry': 'पुनः प्रयास',
  'login.error.timeout': 'कनेक्शन टाइमआउट। कृपया पुनः प्रयास करें।',
  'login.error.default': 'कनेक्शन विफल।',

  'main.relays': 'राइट रिले',
  'main.relays.empty': 'kind:10002 नहीं मिला — कृपया अपने Nostr क्लाइंट में रिले कॉन्फ़िगर करें।',
  'main.blossom': 'Blossom सर्वर',
  'main.blossom.empty': 'kind:10063 नहीं मिला — फ़ाइल सिंक अक्षम',
  'main.history': 'इतिहास',
  'main.perm.section': 'अनुमतियाँ आवश्यक',
  'main.perm.notification.label': 'सूचना अनुमति',
  'main.perm.notification.desc': 'प्राप्त और स्थायी सूचनाएं दिखाने के लिए आवश्यक है।',
  'main.perm.notification.btn': 'अनुमति दें',
  'main.perm.battery.label': 'बैटरी ऑप्टिमाइज़ेशन',
  'main.perm.battery.desc': 'बैकग्राउंड में सदस्यता बनाए रखने के लिए आवश्यक है।',
  'main.perm.battery.btn': 'सेट करें',

  'history.title': 'इतिहास',
  'history.clear': 'सब हटाएं',
  'history.empty': 'अभी तक कोई इतिहास नहीं।',
  'history.copied': 'कॉपी हुआ',

  'toast.clipboard.text': 'टेक्स्ट कॉपी हुआ',
  'toast.clipboard.image': 'इमेज कॉपी हुई',
  'toast.encrypt.start': 'एन्क्रिप्ट हो रहा है…',
  'toast.encrypt.ok': 'एन्क्रिप्ट हुआ',
  'toast.encrypt.fail': 'एन्क्रिप्शन विफल',
  'toast.broadcast.start': 'प्रसारण हो रहा है…',
  'toast.relay.ok': 'सफल',
  'toast.relay.fail': 'विफल',
  'toast.received': 'इवेंट प्राप्त',
  'toast.decrypt.start': 'डिक्रिप्ट हो रहा है…',
  'toast.decrypt.ok': 'डिक्रिप्ट हुआ',
  'toast.decrypt.fail': 'डिक्रिप्शन विफल',
  'toast.clipboard.updated': 'क्लिपबोर्ड अपडेट हुआ',

  'notification.received.tap': 'क्लिपबोर्ड इवेंट प्राप्त। कॉपी करने के लिए टैप करें।',
}

const ar: Messages = {
  'app.loading': 'جارٍ التحميل…',

  'login.subtitle': 'تسجيل الدخول عبر NIP-46',
  'login.tab.qr': 'رمز QR',
  'login.tab.bunker': 'رابط bunker',
  'login.qr.hint': 'امسح رمز QR بتطبيق bunker مثل Amber',
  'login.qr.copy_uri': 'نسخ URI',
  'login.qr.waiting': 'في انتظار استجابة البنكر…',
  'login.connecting': 'جارٍ الاتصال…',
  'login.bunker.connect': 'اتصال',
  'login.retry': 'إعادة المحاولة',
  'login.error.timeout': 'انتهت مهلة الاتصال. يرجى المحاولة مرة أخرى.',
  'login.error.default': 'فشل الاتصال.',

  'main.relays': 'مرحلات الكتابة',
  'main.relays.empty': 'لم يتم العثور على kind:10002 — يرجى تكوين المرحلات في عميل Nostr.',
  'main.blossom': 'خوادم Blossom',
  'main.blossom.empty': 'لم يتم العثور على kind:10063 — مزامنة الملفات معطلة',
  'main.history': 'السجل',
  'main.perm.section': 'الأذونات مطلوبة',
  'main.perm.notification.label': 'إذن الإشعارات',
  'main.perm.notification.desc': 'مطلوب لعرض الإشعارات الواردة والدائمة.',
  'main.perm.notification.btn': 'سماح',
  'main.perm.battery.label': 'تحسين البطارية',
  'main.perm.battery.desc': 'مطلوب للحفاظ على الاشتراك نشطًا في الخلفية.',
  'main.perm.battery.btn': 'ضبط',

  'history.title': 'السجل',
  'history.clear': 'حذف الكل',
  'history.empty': 'لا يوجد سجل بعد.',
  'history.copied': 'تم النسخ',

  'toast.clipboard.text': 'تم نسخ النص',
  'toast.clipboard.image': 'تم نسخ الصورة',
  'toast.encrypt.start': 'جارٍ التشفير…',
  'toast.encrypt.ok': 'تم التشفير',
  'toast.encrypt.fail': 'فشل التشفير',
  'toast.broadcast.start': 'جارٍ البث…',
  'toast.relay.ok': 'نجح',
  'toast.relay.fail': 'فشل',
  'toast.received': 'تم استلام حدث',
  'toast.decrypt.start': 'جارٍ فك التشفير…',
  'toast.decrypt.ok': 'تم فك التشفير',
  'toast.decrypt.fail': 'فشل فك التشفير',
  'toast.clipboard.updated': 'تم تحديث الحافظة',

  'notification.received.tap': 'تم استلام حدث الحافظة. انقر للنسخ.',
}

const fr: Messages = {
  'app.loading': 'Chargement…',

  'login.subtitle': 'Se connecter avec NIP-46',
  'login.tab.qr': 'Code QR',
  'login.tab.bunker': 'URL bunker',
  'login.qr.hint': 'Scannez le QR avec une app bunker comme Amber',
  'login.qr.copy_uri': 'Copier l\'URI',
  'login.qr.waiting': 'En attente du bunker…',
  'login.connecting': 'Connexion…',
  'login.bunker.connect': 'Connecter',
  'login.retry': 'Réessayer',
  'login.error.timeout': 'Délai de connexion dépassé. Veuillez réessayer.',
  'login.error.default': 'Échec de la connexion.',

  'main.relays': 'Relais d\'écriture',
  'main.relays.empty': 'kind:10002 introuvable — Configurez les relais dans votre client Nostr.',
  'main.blossom': 'Serveurs Blossom',
  'main.blossom.empty': 'kind:10063 introuvable — Synchronisation désactivée',
  'main.history': 'Historique',
  'main.perm.section': 'Autorisations requises',
  'main.perm.notification.label': 'Autorisation de notifications',
  'main.perm.notification.desc': 'Nécessaire pour afficher les notifications entrantes et persistantes.',
  'main.perm.notification.btn': 'Autoriser',
  'main.perm.battery.label': 'Optimisation de la batterie',
  'main.perm.battery.desc': 'Nécessaire pour maintenir l\'abonnement actif en arrière-plan.',
  'main.perm.battery.btn': 'Configurer',

  'history.title': 'Historique',
  'history.clear': 'Tout supprimer',
  'history.empty': 'Aucun historique.',
  'history.copied': 'copié',

  'toast.clipboard.text': 'Texte copié',
  'toast.clipboard.image': 'Image copiée',
  'toast.encrypt.start': 'Chiffrement…',
  'toast.encrypt.ok': 'Chiffré',
  'toast.encrypt.fail': 'Échec du chiffrement',
  'toast.broadcast.start': 'Diffusion…',
  'toast.relay.ok': 'OK',
  'toast.relay.fail': 'Échoué',
  'toast.received': 'Événement reçu',
  'toast.decrypt.start': 'Déchiffrement…',
  'toast.decrypt.ok': 'Déchiffré',
  'toast.decrypt.fail': 'Échec du déchiffrement',
  'toast.clipboard.updated': 'Presse-papiers mis à jour',

  'notification.received.tap': 'Événement du presse-papiers reçu. Appuyez pour copier.',
}

const de: Messages = {
  'app.loading': 'Laden…',

  'login.subtitle': 'Mit NIP-46 anmelden',
  'login.tab.qr': 'QR-Code',
  'login.tab.bunker': 'Bunker-URL',
  'login.qr.hint': 'QR mit einer Bunker-App wie Amber scannen',
  'login.qr.copy_uri': 'URI kopieren',
  'login.qr.waiting': 'Warte auf Bunker…',
  'login.connecting': 'Verbinden…',
  'login.bunker.connect': 'Verbinden',
  'login.retry': 'Erneut versuchen',
  'login.error.timeout': 'Verbindungszeitüberschreitung. Bitte erneut versuchen.',
  'login.error.default': 'Verbindung fehlgeschlagen.',

  'main.relays': 'Schreib-Relays',
  'main.relays.empty': 'kind:10002 nicht gefunden — Bitte Relays in Ihrem Nostr-Client konfigurieren.',
  'main.blossom': 'Blossom-Server',
  'main.blossom.empty': 'kind:10063 nicht gefunden — Dateisynchronisierung deaktiviert',
  'main.history': 'Verlauf',
  'main.perm.section': 'Berechtigungen erforderlich',
  'main.perm.notification.label': 'Benachrichtigungsberechtigung',
  'main.perm.notification.desc': 'Erforderlich für eingehende und dauerhafte Benachrichtigungen.',
  'main.perm.notification.btn': 'Erlauben',
  'main.perm.battery.label': 'Akkuoptimierung',
  'main.perm.battery.desc': 'Erforderlich, um die Verbindung im Hintergrund aufrechtzuerhalten.',
  'main.perm.battery.btn': 'Konfigurieren',

  'history.title': 'Verlauf',
  'history.clear': 'Alle löschen',
  'history.empty': 'Noch kein Verlauf.',
  'history.copied': 'kopiert',

  'toast.clipboard.text': 'Text kopiert',
  'toast.clipboard.image': 'Bild kopiert',
  'toast.encrypt.start': 'Verschlüsselung…',
  'toast.encrypt.ok': 'Verschlüsselt',
  'toast.encrypt.fail': 'Verschlüsselung fehlgeschlagen',
  'toast.broadcast.start': 'Senden…',
  'toast.relay.ok': 'OK',
  'toast.relay.fail': 'Fehlgeschlagen',
  'toast.received': 'Ereignis empfangen',
  'toast.decrypt.start': 'Entschlüsselung…',
  'toast.decrypt.ok': 'Entschlüsselt',
  'toast.decrypt.fail': 'Entschlüsselung fehlgeschlagen',
  'toast.clipboard.updated': 'Zwischenablage aktualisiert',

  'notification.received.tap': 'Zwischenablage-Ereignis empfangen. Tippen zum Kopieren.',
}

const locales: Record<Locale, Messages> = { en, ko, ja, zh, es, pt, hi, ar, fr, de }

function detectLocale(): Locale {
  const lang = navigator.language.split('-')[0]
  if (lang in locales) return lang as Locale
  return 'en'
}

let current: Locale = detectLocale()
let messages: Messages = locales[current]

export function setLocale(locale: Locale): void {
  current = locale
  messages = locales[locale]
}

export function getLocale(): Locale {
  return current
}

export function t(key: string): string {
  return messages[key] ?? locales.en[key] ?? key
}
