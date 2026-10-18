# ShopTalk Android SDK 0.2.0

고객사 코틀린 앱 안에 ShopTalk 상담 화면을 넣는 Android 라이브러리(AAR).
웹과 **같은 위젯**을 WebView로 띄우고, 앱과 위젯은 브리지 메시지만 주고받는다
(계약: `docs/guide/모바일SDK연동가이드_Mobile-SDK.ko.md`, 베트남어 통합 가이드:
`docs/guide/GUIDE-261016-Mobile-SDK-0.2.vi.md`, 설계: `docs/plan/PLN-261015-Go2Joy-Kotlin-SDK-0.2.md`).

- 모듈: `:shoptalk` (라이브러리 → AAR) · `:shoptalk-compose` (선택, Compose 래퍼) · `:sample` (검증용 앱, 전달물 아님)
- minSdk 21 · compileSdk 35 · **Kotlin 2.2.0** · JDK 17 · AGP 8.5.2 / Gradle 8.7
- `:shoptalk` 의존성은 androidx 기본군(core-ktx 1.15.0, fragment-ktx 1.8.5)뿐 — Compose는 `:shoptalk-compose`에만 있다.
  AAR에는 POM이 없으므로 **호스트 앱이 이미 가진 것만** 쓴다.

## 0.2.0 변경 요약 (0.1.0 → 0.2.0)

| 영역 | 변경 |
|---|---|
| 신원 | `ShopTalkIdentity`(백엔드가 서명한 패키지를 **그대로** 전달) + `ShopTalkIdentityProvider`(ready·reload·`identity-expired`마다 새로 요청). **identify JSON 캐시·재전송 제거** — 0.1.0에서 올리는 앱은 provider를 설정할 것. `ShopTalkUser`는 deprecated(컴파일은 됨). **사용자가 바뀌면 SDK가 먼저 위젯을 로그아웃한다**(이전 `userId`의 SHA-256만 앱 전용 SharedPreferences에 보관). provider가 `null`을 줄 때 이전 사용자가 있었다면 마찬가지 |
| 설정 | `ShopTalkConfig`에 `accessKey`, `header`(null/WIDGET/NATIVE), `startTab`, `attachments`, `errorHotline`, `allowInsecureUrl`. `widgetUrl`은 https 필수 |
| 명령 | `setContext`, `openSettings`, `endConversation`, `reload` |
| 이벤트 | `onIdentityExpired`, `onOpenUrl(Uri): Boolean`, `onUnread`, `onError(ShopTalkError)` |
| 네이티브 UX | 첨부 선택기(카메라·갤러리·파일, FileProvider), 오류 화면(재시도·핫라인, 15초 타임아웃), WebView 라이트 고정, 뒤로가기 → 위젯 `back` 명령 |
| Compose | `:shoptalk-compose` — `ShopTalkChat(...)` |
| 툴체인 | Kotlin 2.0.20 → 2.2.0, `kotlinOptions` → `compilerOptions` |

### 툴체인 메모

Kotlin Gradle 플러그인 2.2.0은 AGP 7.3.1–8.10.0, Gradle 7.6.3–8.14를 지원한다(kotlinlang.org
호환표) — 기존 **AGP 8.5.2 + Gradle 8.7 wrapper를 유지**했다(변경 불필요). 소비 앱이 Kotlin 2.2.0이면
이 AAR(2.2.0 빌드)을 그대로 쓴다. **소비 앱의 Kotlin은 2.1.0 이상이어야 한다**(2.0.21은 메타데이터를 못 읽어
컴파일러가 내부 오류로 멈춘다. 확인함, TCR-261016 §7). Compose 모듈은 Kotlin 2.x의
`org.jetbrains.kotlin.plugin.compose` 플러그인(2.2.0)을 쓴다.

## 빌드

npm 워크스페이스와 완전히 분리된 독립 Gradle 프로젝트다 (`package.json` 없음 — 두지 말 것,
루트 CI가 Node 전용이라 이 디렉터리를 인식하지 않는 것이 의도된 상태).

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"  # JDK 17+
export ANDROID_HOME="$HOME/Library/Android/sdk"

./gradlew :shoptalk:testReleaseUnitTest          # JVM 단위 테스트 (계약 커버)
./gradlew :shoptalk:assembleRelease              # → shoptalk/build/outputs/aar/shoptalk-release.aar
./gradlew :shoptalk-compose:assembleRelease      # → shoptalk-compose/build/outputs/aar/shoptalk-compose-release.aar
./gradlew :sample:installDebug                   # 실기기/에뮬레이터 검증용
```

> 2026-10-19: Android 5.0(API 21)·6.0(API 23)·15(API 35) 에뮬레이터에서 프로토콜 시나리오 13개를 모두 통과(TCR-261016 §10).
> 위젯은 Android System WebView Chrome 80 이상이 필요하며, 더 낮으면 15초 뒤 "WebView 업데이트" 안내 화면이 뜬다.
> 2026-10-16: Gradle 8.14.3 + AGP 8.5.2로 `testReleaseUnitTest`(50/50), `assembleRelease`, `lintRelease`(오류 0)를 실제로 돌렸고,
> Android 15 에뮬레이터(API 35)에서 샘플 앱으로 식별·컨텍스트·첨부 업로드·오류 화면을 확인했다
> (결과: `docs/test/TCR-261016-Go2Joy-Kotlin-App-Widget.md` §5–§6). 실기기와 API 24는 아직 확인하지 않았다.
> 로컬 개발 서버를 에뮬레이터에 연결할 때는 `adb reverse`가 IPv4만 닿으므로 `vite --host 127.0.0.1`로 띄운다.

## 전달 (AAR 직접 전달)

```bash
./gradlew :shoptalk:assembleRelease
cp shoptalk/build/outputs/aar/shoptalk-release.aar dist/shoptalk-android-0.2.0.aar
# Compose 앱이면 추가:
./gradlew :shoptalk-compose:assembleRelease
cp shoptalk-compose/build/outputs/aar/shoptalk-compose-release.aar dist/shoptalk-compose-0.2.0.aar
```

AAR과 함께 연동 가이드를 전달한다. **AAR·secret·서명 해시는 리포에 커밋하지 않는다.**
소스 모듈로 넣고 싶은 앱은 `:shoptalk`(와 `:shoptalk-compose`) 디렉터리를 `include`하면 된다.

## 호스트 앱 통합 (요약)

```kotlin
// libs/에 AAR 복사 후
dependencies {
    implementation(files("libs/shoptalk-android-0.2.0.aar"))
    implementation("androidx.core:core-ktx:1.15.0")        // 이미 있다면 생략
    implementation("androidx.fragment:fragment-ktx:1.8.5") // 이미 있다면 생략
}
```

```kotlin
val chat = ShopTalkChatFragment.newInstance(
    ShopTalkConfig(
        widgetUrl = "https://shoptalk.amoeba.site/widget/",
        shop = "https://www.go2joy.vn",   // 테넌트 조회 키(tenants.shop_domain). 앱 도메인이 아님
        agent = "hotel-admin",
        locale = "vi",
    )
)
// 서명은 호스트 백엔드가 한다. 앱은 받아서 넘기기만 — 시크릿은 앱에 없다.
chat.identityProvider = ShopTalkIdentityProvider {
    ShopTalkIdentity.fromJson(api.sharpTalkIdentityJson()) // {userId, hash, attributes|claims, ...}
}
chat.listener = object : ShopTalkListener {
    override fun onCloseRequest() { supportFragmentManager.popBackStack() } // 필수
    override fun onError(error: ShopTalkError) { /* 선택 */ }
}
supportFragmentManager.commit { replace(R.id.container, chat) }
```

## 공개 API (0.2.0)

```kotlin
data class ShopTalkConfig(
    widgetUrl: String, shop: String? = null, locale: String? = null, agent: String? = null,
    accessKey: String? = null,                 // → ?access=
    header: ShopTalkHeader? = null,            // null = chrome 파라미터 없음(콘솔이 결정) · NATIVE → chrome=native · WIDGET → chrome=widget
    startTab: ShopTalkTab? = null,             // ready 후 open 명령으로 전송
    attachments: ShopTalkAttachments = ShopTalkAttachments(camera = true, multiple = true),
    errorHotline: String? = null,              // 오류 화면의 전화 걸기
    allowInsecureUrl: Boolean = false,         // 디버그 전용: http는 localhost/127.0.0.1/10.0.2.2만
)
class ShopTalkIdentity { companion { fromJson(raw): ShopTalkIdentity; of(userId, hash, attributes?, claims?, name?, email?, phone?) } }
fun interface ShopTalkIdentityProvider { suspend fun identity(): ShopTalkIdentity? }   // null = 게스트
data class ShopTalkContext(screen: String, ref: String? = null, label: String? = null, prefill: String? = null)
sealed interface ShopTalkError { LoadFailed(code, description) · LoadTimeout · IdentityProviderFailed(cause) · BridgeMalformed }
interface ShopTalkListener { onReady() · onCloseRequest() · onIdentified(ok) · onIdentityExpired() · onOpenUrl(Uri): Boolean · onUnread(Int) · onError(ShopTalkError) }
class ShopTalkChatFragment {
    var listener: ShopTalkListener?; var identityProvider: ShopTalkIdentityProvider?
    fun identify(identity); fun open(tab); fun setLocale(locale); fun logout()
    fun setContext(context: ShopTalkContext?); fun openSettings(); fun endConversation(); fun reload()
    companion { newInstance(config); createArguments(config) }
}
// :shoptalk-compose
@Composable fun ShopTalkChat(config, identityProvider, listener, modifier = Modifier, onFragment = {})
```

`header`: 앱이 명시하면 항상 우선(`chrome=native|widget`), 지정하지 않으면(null) 위젯이
테넌트 관리자 설정(`/public/widget/app-config`)을 따른다. SDK 0.2.0은 app-config를 직접 호출하지 않는다.

신원 규칙: `ShopTalkIdentity`는 `userId`·`hash`(비어 있지 않은 문자열)만 검사하고 나머지는
**그대로** `ivy:identify.user`로 보낸다(`attributes`든 `claims`든 SDK는 해석하지 않음).
provider는 widget ready · reload · `identity-expired`마다 호출된다 — 예전 서명을 재전송하지 않는다.
`identify(identity)` 수동 호출은 **한 번만** 보낸다. provider가 null을 주면 게스트로 두고
(자동 logout 아님 — 게스트 대화 연속성 유지), 계정 전환 시에는 `logout()` 후 `reload()`.

라이브러리가 대신 처리하는 것: 첨부 선택기(카메라 `ACTION_IMAGE_CAPTURE` + FileProvider / 갤러리 다중 /
파일), 외부 링크(http·https·mailto·tel만, 그 외 스킴 차단) 시스템 열기와 `onOpenUrl` 위임,
오류 화면(주 프레임 오류·HTTP ≥400·SSL·15초 `ivy:ready` 미수신 → 재시도/핫라인),
라이트 고정(API 33+ `isAlgorithmicDarkeningAllowed=false`, 29–32 `FORCE_DARK_OFF`),
뒤로가기(위젯에 `back` 명령 → `handled`면 소비, 아니면/500ms 무응답이면 `onCloseRequest`),
키보드(adjustResize + IME 인셋), DOM storage, 위젯 준비 전 명령 큐(20건),
`setLocale`·`setContext`·`startTab`의 reload 후 재적용, 브리지는 **주 프레임 URL이 `widgetUrl`과 같은
origin(스킴·호스트·포트)일 때만** 동작.

호스트가 여전히 지켜야 하는 것:

| 항목 | 이유 |
|---|---|
| `onCloseRequest`에서 화면 닫기 | 앱에서는 위젯이 화면 전체 — 안 닫으면 빈 화면 |
| `hash`는 서버에서 서명 | 시크릿을 앱에 넣으면 번들에서 추출된다. `attributes` 서명 문자열은 `userId\nkey=value`(키 알파벳순) — `docs/guide/임베드SDK설치가이드_Embed-SDK.ko.md` §3.4 |
| 앱 매니페스트에 `CAMERA` 권한을 선언하지 말 것(또는 런타임에 허용받을 것) | 선언만 하고 미허용이면 시스템 카메라 인텐트가 SecurityException — SDK는 갤러리로 폴백하지만 카메라 항목이 동작하지 않는다 |
| minify 시 consumer rules 유지 | AAR에 포함됨(`@JavascriptInterface` keep) — 별도 조치 불요, 지우지만 말 것 |

## 확인된 것과 미확인

- 확인: 순수 Kotlin 파일(`ShopTalkConfig`/`ShopTalkIdentity`/`ShopTalkProtocol`/`UrlPolicy`/`AttachmentRules` 등)과
  JUnit 테스트 50건을 오프라인 Kotlin 컴파일러(2.0.21, Gradle 번들)로 컴파일·실행 — org.json은 로컬 shim 사용.
- 미확인: Android 의존 코드(Fragment·WebView·FileProvider·오류 화면), Gradle/AGP 빌드, `lifecycleScope`
  전이 의존성 해석, Compose 모듈, 실기기 동작. 첫 빌드와 TCR(`docs/test/`)에서 확인할 것.
