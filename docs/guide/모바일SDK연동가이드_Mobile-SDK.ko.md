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
| `{type:'ivy:identify', user:{userId, hash, name?, email?, phone?, claims?}}` | 로그인한 사용자 알려주기 (`claims` = v2 호텔·역할 컨텍스트 — 임베드 가이드 §3.4, 해시는 `userId\|hotelSn\|role\|iat` 서명) |
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
| `{type:'ivy:open-url', url, mode}` | **시스템 브라우저로 `url`을 여세요** (파트너 포털 로그인/가입 카드, https만). RN 패키지는 `Linking.openURL`로 처리합니다; Android/iOS 네이티브는 추후 |

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

## 6. Android — Kotlin SDK (AAR, 권장)

Android는 완성된 라이브러리가 있습니다 (`sdk/android`, PLN-260827). AAR 파일을 받아
`libs/`에 넣으면 아래가 전부입니다 — §6-수동의 브리지·파일선택기·외부링크·키보드 처리를
라이브러리가 대신합니다.

```kotlin
dependencies {
    implementation(files("libs/shoptalk-android-0.1.0.aar"))
    implementation("androidx.core:core-ktx:1.15.0")        // 이미 있다면 생략
    implementation("androidx.fragment:fragment-ktx:1.8.5")  // 이미 있다면 생략
}
```

```kotlin
val chat = ShopTalkChatFragment.newInstance(
    ShopTalkConfig(widgetUrl = "https://talk.example.com/widget/", shop = "<스토어도메인>", locale = "vi")
)
chat.identify(ShopTalkUser(userId = uid, hash = serverSignedHash)) // hash는 §3대로 서버 서명
chat.listener = object : ShopTalkListener {
    override fun onCloseRequest() { supportFragmentManager.popBackStack() } // 필수
}
supportFragmentManager.commit { replace(R.id.container, chat) }
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
