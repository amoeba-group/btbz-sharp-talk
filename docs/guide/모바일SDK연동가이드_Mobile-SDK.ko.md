# SharpTalk 모바일 앱 연동 가이드

고객사 모바일 앱 안에 SharpTalk 상담 화면을 넣는 방법. (PLN-260820 기준)

방식은 **WebView 래퍼**입니다. 웹에서 쓰는 것과 **같은 위젯**을 앱 안에서 띄우고, 앱과 위젯이
네 종류의 메시지만 주고받습니다. 채팅 UI를 네이티브로 다시 만들지 않으므로, 웹에서 고친 것이
앱에도 그대로 반영됩니다.

## 1. 화면 열기

WebView로 아래 주소를 엽니다.

```
https://talk.example.com/widget/?embed=1&mode=app&shop=<스토어도메인>
```

> ⚠️ 언어는 URL이 아니라 **브리지 명령**으로 지정합니다(아래 `action:'locale'`) — 위젯은
> `locale` URL 파라미터를 읽지 않습니다(수동 선택 → 기기 언어 → en 순으로 자동 결정).
> 실기기 검증(SM-G991N, 2026-08-28)에서 확인된 사실이며, 이전 판의 `&locale=vi` 예시는
> 동작하지 않는 파라미터였습니다.

`mode=app`이 하는 일:

| | 웹 임베드 | `mode=app` |
|---|---|---|
| 데모 스토어프론트 | 없음 | 없음 |
| 떠 있는 런처 버튼 | 있음 | **없음** (앱의 진입 버튼을 쓰세요) |
| 대화 패널 | 닫힌 채 시작 | **열린 채 시작** |
| 닫기(X) | 패널만 닫음 | **앱에 닫아달라고 요청** |

마지막 줄이 중요합니다. 앱에서는 위젯이 화면 전체이므로, 패널만 닫으면 **빈 화면**이 남습니다.
X를 누르면 위젯이 `ivy:close-request`를 보내므로 **앱이 그 화면을 닫아야** 합니다.

## 2. 브리지 계약

### 앱 → 위젯

앱이 WebView 안에서 아래 전역 함수를 호출합니다. 인자는 **JSON 문자열**입니다.

```js
window.__shoptalkHost('{"type":"ivy:identify","user":{...}}')
```

| 메시지 | 용도 |
|---|---|
| `{type:'ivy:identify', user:{userId, hash, name?, email?, phone?}}` | 로그인한 사용자 알려주기 |
| `{type:'ivy:command', action:'open', tab:'chat'\|'orders'\|'notifications'}` | 특정 탭 열기 |
| `{type:'ivy:command', action:'locale', locale:'VI'}` | 언어 변경 |
| `{type:'ivy:command', action:'logout'}` | 로그아웃(게스트로 전환) |

> 위젯이 아직 뜨기 전에 보내도 **유실되지 않습니다.** 최대 20건까지 큐에 담았다가 준비되면
> 순서대로 처리합니다 — 앱이 화면 진입과 동시에 `identify`를 보내는 흐름이 정상입니다.

### 위젯 → 앱

| 메시지 | 앱이 해야 할 일 |
|---|---|
| `{type:'ivy:ready'}` | 준비 완료 — 여기서 `identify`를 보내면 가장 빠릅니다 |
| `{type:'ivy:close-request'}` | **상담 화면을 닫으세요** |
| `{type:'ivy:event', event:'identified', ok:true\|false}` | 신원 연동 결과(실패해도 대화는 계속 가능) |

수신 경로는 플랫폼마다 다릅니다:

| 플랫폼 | 위젯이 쓰는 채널 |
|---|---|
| React Native | `window.ReactNativeWebView.postMessage(json)` → `onMessage` |
| iOS (WKWebView) | `window.webkit.messageHandlers.shoptalk.postMessage(obj)` |
| Android | `window.ShopTalkAndroid.postMessage(json)` (JS 인터페이스 이름 고정) |

## 3. 로그인 연동

웹과 **완전히 동일**합니다(임베드 SDK 가이드 §3).

```
고객사 서버:  hash = HMAC_SHA256(embed_secret, userId)
       앱:  window.__shoptalkHost(JSON.stringify({type:'ivy:identify', user:{userId, hash}}))
```

> ⚠️ **시크릿을 앱에 넣지 마세요.** 앱 번들은 누구나 뜯어볼 수 있습니다. 서명은 반드시
> 고객사 서버에서 만들어 앱으로 내려보내야 합니다.

서명이 맞지 않으면 방문자는 **게스트로 계속 대화할 수 있습니다.** 로그인 실패가 문의 자체를
막지 않습니다.

## 4. React Native

참조 구현이 `packages/sharptalk-rn`에 있습니다. 복사하거나 경로 의존으로 쓰세요.

```tsx
import { ShopTalkChat } from '@sharptalk/react-native';

<ShopTalkChat
  widgetUrl="https://talk.example.com/widget/"
  shop="example.myshopify.com"
  locale="vi"
  user={{ userId: String(user.id), hash: hashFromYourServer }}
  onClose={() => navigation.goBack()}
/>
```

## 5. iOS (WKWebView) — 요지

```swift
let controller = WKUserContentController()
controller.add(self, name: "shoptalk")          // 위젯 → 앱
let config = WKWebViewConfiguration()
config.userContentController = controller

// 앱 → 위젯
func send(_ message: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: message)
    let json = String(data: data, encoding: .utf8)!
    let escaped = json.replacingOccurrences(of: "\\", with: "\\\\")
                      .replacingOccurrences(of: "'", with: "\\'")
    webView.evaluateJavaScript("window.__shoptalkHost && window.__shoptalkHost('\(escaped)')")
}

func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
    guard let body = m.body as? [String: Any] else { return }
    if body["type"] as? String == "ivy:close-request" { dismiss(animated: true) }
}
```

## 6. Android — Kotlin SDK (Maven 폴더, 권장)

Android는 완성된 라이브러리가 있습니다 (`sdk/android`, PLN-260827). §6-수동의 브리지·파일선택기·외부링크·키보드 처리를
라이브러리가 대신합니다. 전달물은 **Maven 형식 폴더**(`shoptalk-android-<버전>-maven.zip`: AAR + POM + Gradle 메타데이터 + 소스 + 체크섬)입니다.
자세한 설치·요구 버전·AAR 직접 전달 대안은 `GUIDE-261016-Mobile-SDK-0.2.vi.md` §1 참고.

```kotlin
// settings.gradle.kts — zip을 third_party/shoptalk-maven에 풀었거나, 사내 Artifactory/Nexus에 폴더를 올린 경우
dependencyResolutionManagement {
    repositories {
        google(); mavenCentral()
        maven { url = uri("third_party/shoptalk-maven"); content { includeGroup("site.amoeba.shoptalk") } }
    }
}
// app/build.gradle.kts — 한 줄. androidx는 POM이 최저 버전만 선언하므로 앱의 더 높은 버전이 그대로 유지된다.
dependencies { implementation("site.amoeba.shoptalk:shoptalk-android:0.2.0") }
```

> ⚠️ AAR만 받는 경우 POM이 없으므로 앱이 `fragment-ktx 1.3.6` · `core-ktx 1.6.0` · `lifecycle-runtime-ktx 2.3.1` **이상**을 직접 가져야 한다.
> "최신 버전"을 그대로 붙여 넣지 말 것: `core-ktx 1.15.0`은 `compileSdk 35`를 요구해 `compileSdk 34` 앱의 빌드가 실패하고,
> fragment 1.2.x(2020년)에서는 Fragment 생성 시 앱이 종료된다.

```kotlin
class SupportActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_support)
        if (savedInstanceState == null) {
            val chat = ShopTalkChatFragment.newInstance(
                ShopTalkConfig(widgetUrl = "https://talk.example.com/widget/", shop = "<스토어도메인>", locale = "vi")
            )
            supportFragmentManager.commit { replace(R.id.container, chat, "chat") }
        }
    }

    // 매번 여기서 붙인다: Activity가 재생성되면 새 Fragment가 만들어지고 provider/listener는 저장되지 않는 일반 필드다.
    override fun onResumeFragments() {
        super.onResumeFragments()
        (supportFragmentManager.findFragmentByTag("chat") as? ShopTalkChatFragment)?.apply {
            identityProvider = ShopTalkIdentityProvider { api.sharpTalkIdentity() } // 서명은 §3대로 서버가 한다
            listener = object : ShopTalkListener { override fun onCloseRequest() { finish() } } // 필수
        }
    }
}
```

제어는 `chat.open(ShopTalkTab.ORDERS)` · `chat.setLocale("vi")` · `chat.logout()`.
위젯이 뜨기 전에 불러도 유실되지 않습니다(라이브러리 큐 + 위젯 큐 양방향).
§7 체크리스트 중 라이브러리 책임이 아닌 것은 **시크릿을 앱에 넣지 않기**뿐입니다.

## 6-수동. Android — 직접 통합(SDK 미사용 시)

```kotlin
class ShopTalkBridge(private val onMessage: (String) -> Unit) {
    @JavascriptInterface fun postMessage(json: String) = onMessage(json)
}
webView.addJavascriptInterface(ShopTalkBridge { json -> /* close-request 처리 */ }, "ShopTalkAndroid")

// 앱 → 위젯
fun send(json: String) = webView.evaluateJavascript(
    "window.__shoptalkHost && window.__shoptalkHost(${JSONObject.quote(json)})", null)
```

⚠️ **첨부(사진 보내기)가 동작하려면 `WebChromeClient.onShowFileChooser`를 구현해야 합니다.**
구현하지 않으면 파일 선택창이 아예 뜨지 않고 **아무 반응도 없습니다** — 위젯 버그처럼 보이지만
WebView 기본 동작입니다.

```kotlin
webView.webChromeClient = object : WebChromeClient() {
    override fun onShowFileChooser(v: WebView?, cb: ValueCallback<Array<Uri>>?,
                                   params: FileChooserParams?): Boolean {
        filePathCallback = cb
        startActivityForResult(params!!.createIntent(), FILE_PICK)
        return true
    }
}
```

## 7. 반드시 챙길 것 (체크리스트)

| 항목 | 이유 |
|---|---|
| ☐ `mode=app`으로 여는가 | 안 그러면 데모 스토어프론트와 런처가 함께 뜹니다 |
| ☐ `ivy:close-request`에서 화면을 닫는가 | 안 닫으면 빈 화면이 남습니다 |
| ☐ **Android `onShowFileChooser`** | 사진 첨부가 조용히 실패합니다 |
| ☐ 외부 링크를 시스템 브라우저로 | 채팅 WebView 안에서 열리면 돌아올 길이 없습니다 |
| ☐ 키보드 회피 | 입력창이 키보드에 가립니다 |
| ☐ localStorage/DOM storage 활성화 | 세션이 유지되지 않아 방문마다 대화가 끊깁니다 |
| ☐ 시크릿이 앱에 없는가 | 번들에서 추출됩니다 |

## 8. 개발 중 확인 방법

실기기 없이 계약을 확인할 수 있는 시뮬레이터가 있습니다:

```
https://talk.example.com/widget/webview-test.html
```

네이티브 호스트를 흉내 내어 `identify`·`open`·`close-request`를 주고받습니다.
**실제 앱 검증을 대신하지는 않습니다** — WebView의 파일 선택·키보드·링크 동작은 기기에서만
확인됩니다.

## 9. Kotlin SDK 0.2.0 변경 (PLN-261015)

0.2.0은 위 계약에 아래를 **추가**합니다. 모르는 메시지는 양쪽 모두 무시하므로(NFR-M05)
AAR 0.2.0 + 구 위젯, AAR 0.1.0 + 신 위젯 모두 동작합니다. 전체 API·설계는
`sdk/android/README.md`, 베트남어 통합 가이드는 `GUIDE-261016-Mobile-SDK-0.2.vi.md`.

**⚠️ 0.1.0에서 올릴 때**: SDK가 identify JSON을 캐시해 reload마다 다시 보내던 동작을 **없앴습니다**
(서명이 만료될 수 있는 계약에서 옛 서명이 거절되기 때문). `identify()`는 한 번만 보내므로
`chat.identityProvider`를 설정하십시오.

### URL 파라미터 추가

| 파라미터 | 값 | 의미 |
|---|---|---|
| `access` | 접근 키 | 테넌트가 `widget_access`를 켠 경우(`ShopTalkConfig.accessKey`) |
| `chrome` | `native` / `widget` | `native`: 위젯 헤더를 숨기고 앱 툴바 사용 · `widget`: 위젯 헤더 강제. **파라미터가 없으면 콘솔(앱 설정)이 결정**하며, 명시한 값이 항상 우선(`ShopTalkConfig.header`, null = 파라미터 없음) |

`surface=app` 등 모르는 파라미터는 위젯이 무시합니다. `locale`은 여전히 URL에 넣지 않습니다.

### 브리지: 앱 → 위젯 (추가)

| 메시지 | 용도 |
|---|---|
| `{type:'ivy:command', action:'settings'}` | 환경설정(언어·개인정보) 패널 열기 (`openSettings()`) |
| `{type:'ivy:command', action:'end'}` | 대화 종료 — 위젯의 "종료" 버튼과 같은 동작 (`endConversation()`) |
| `{type:'ivy:command', action:'back'}` | 뒤로가기 요청 — 위젯이 `ivy:event back {handled}`로 답함 |
| `{type:'ivy:command', action:'context', context:{screen, ref?, label?, prefill?}}` | "어디서 열었는지" 칩 + 입력창 미리 채우기, 다음 메시지에 함께 전송. `context:null`이면 칩 제거 (`setContext(ctx \| null)`) |
| `{type:'ivy:identify', user:{userId, hash, ...}}` | `user`는 호스트 백엔드가 서명한 패키지를 **그대로**(SDK는 `userId`·`hash` 존재만 검사) |

### 브리지: 위젯 → 앱 (추가·확정)

| 메시지 | SDK 동작 |
|---|---|
| `{type:'ivy:event', event:'identity-expired'}` | provider를 다시 호출해 새로 서명된 identify 전송, `onIdentityExpired()` 통지 |
| `{type:'ivy:event', event:'back', handled:true\|false}` | `handled:true`면 뒤로가기 소비, `false`(또는 500ms 무응답)면 `onCloseRequest()` |
| `{type:'ivy:open-url', url, mode?}` | http/https만 허용 → `onOpenUrl(Uri)`가 true면 앱 처리, 아니면 `ACTION_VIEW` |
| `{type:'ivy:unread', count}` | `onUnread(count)` |

### Config / 리스너 추가

- `ShopTalkConfig`: `accessKey`, `header`(null·WIDGET·NATIVE), `startTab`, `attachments(camera, multiple)`,
  `errorHotline`, `allowInsecureUrl`(디버그 전용: http는 localhost·127.0.0.1·10.0.2.2만). `widgetUrl`은 https 필수.
- `ShopTalkIdentity.fromJson(raw)` / `.of(...)`, `ShopTalkIdentityProvider`(ready·reload·identity-expired마다 호출,
  null = 로그인한 사람 없음(이 기기에서 이전에 식별된 사용자가 있었다면 SDK가 위젯을 먼저 로그아웃, 아래 참조),
  예외 = `onError(IdentityProviderFailed)` 후 **아무것도 바꾸지 않음**).
- 리스너: `onIdentityExpired`, `onOpenUrl(Uri): Boolean`, `onUnread(Int)`, `onError(ShopTalkError)`
  (`LoadFailed`·`LoadTimeout`·`IdentityProviderFailed`·`BridgeMalformed`).
- 메서드: `setContext`, `openSettings`, `endConversation`, `reload`.
- 네이티브: 첨부 선택기(카메라·갤러리 다중·파일, FileProvider는 AAR 매니페스트에 포함),
  오류 화면(주 프레임 오류·HTTP ≥400·15초 `ivy:ready` 미수신 → 재시도·핫라인), WebView 라이트 고정,
  브리지는 주 프레임이 `widgetUrl`과 같은 origin일 때만 동작.
- Compose 앱은 선택 모듈 `:shoptalk-compose`의 `ShopTalkChat(...)`. 툴체인은 Kotlin 2.2.0, JDK 17.

### 호스트 앱 요구 조건 (소비 앱 시험으로 확인, TCR-261016 §7)

| 항목 | 요구 | 비고 |
|---|---|---|
| Kotlin | **2.1.0 이상** | AAR은 2.2.0으로 빌드. 2.0.x 이하는 메타데이터를 못 읽어 컴파일러가 내부 오류로 멈춤 |
| `minSdk` | **21 이상** | 낮으면 매니페스트 병합 오류. 에뮬레이터에서 Android 5.0(API 21), 6.0(API 23), 15(API 35) 실행 확인(TCR-261016 §10) |
| 기기의 Android System WebView | **Chrome 80 이상** | 위젯은 최신 웹앱입니다. 더 낮은 WebView는 페이지는 불러와도 실행하지 못하므로 15초 뒤 SDK가 "WebView 업데이트" 안내 화면을 표시합니다(6개 언어) |
| 앱의 JVM 타깃 | 11 또는 17 | 둘 다 확인 |
| AGP | 8.5.2, 8.10.1 확인 | AAR은 AGP·compileSdk 최소값을 요구하지 않음 |
| 호스트 Activity | `FragmentActivity`(`AppCompatActivity` 포함) | Android Studio의 기본 Compose 템플릿(`ComponentActivity`)은 불가: `ShopTalkChat`이 원인과 해결(상위 클래스 변경, AppCompat 테마)을 담은 예외를 즉시 던짐 |
| Java 코드 | 사용 가능 | `ShopTalkConfig`·`ShopTalkContext`·`ShopTalkAttachments`에 `@JvmOverloads` |

### 사용자 전환 시 자동 로그아웃

WebView는 앱을 다시 열어도 채팅 세션을 유지하고, 서버는 그 세션을 나중에 식별한 사람에게 묶습니다. 앱이 `logout()` 없이 다른 사람을
식별하면 새 사용자가 이전 사용자의 대화를 보게 됩니다(에뮬레이터에서 재현, TCR-261016 §8·§9). 그래서 SDK는 마지막으로 식별된
`userId`의 SHA-256 지문을 위젯·상점별로 앱 전용 `SharedPreferences`에 저장하고(원본 `userId`는 저장하지 않음),
다음 신원이 다르거나 사용자가 있었던 뒤 provider가 `null`을 주면 `logout`을 **먼저** 보낸 뒤 `identify`합니다.

- 지문은 위젯이 `identified ok`로 확인한 **뒤에만** 새 사용자로 바뀝니다. 그 사이에는 `reset`("주인 불명, 다음 identify 전에 세션을 버린다")이며,
  앱 종료·명령 유실·서명 거절이 있어도 불필요한 로그아웃이 한 번 늘 뿐 대화가 노출되지 않습니다.
- 같은 사람이 다시 열면 대화를 유지합니다. 아무도 식별된 적 없으면 게스트 대화를 건드리지 않습니다.
- 앱이 자체 로그인 세션을 지우는 곳에서 `chat.logout()`을 호출하는 것은 여전히 권장됩니다(SDK는 다음 식별 때 작동, `logout()`은 즉시).

### 기타 변경

- 화면 회전·다크 모드·글꼴 크기로 Activity가 다시 만들어져도 컨텍스트 칩이 복원됩니다(미리 채우기 문구는 제외).
- `ShopTalkListener.onReady`는 한 번 로드에 한 번만 호출됩니다(위젯은 훅 여러 곳에서 알리지만 SDK가 중복을 거릅니다).
- 오류 화면의 재시도 버튼은 호스트 앱 테마의 `colorAccent`를 따릅니다(없으면 플랫폼 기본 버튼).
