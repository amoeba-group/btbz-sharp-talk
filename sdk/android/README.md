# ShopTalk Android SDK 0.2.0

고객사 코틀린 앱 안에 ShopTalk 상담 화면을 넣는 Android 라이브러리(AAR).
웹과 **같은 위젯**을 WebView로 띄우고, 앱과 위젯은 브리지 메시지만 주고받는다
(계약: `docs/guide/모바일SDK연동가이드_Mobile-SDK.ko.md`, 베트남어 통합 가이드:
`docs/guide/GUIDE-261016-Mobile-SDK-0.2.vi.md`, 설계: `docs/plan/PLN-261015-Go2Joy-Kotlin-SDK-0.2.md`).

- 모듈: `:shoptalk` (라이브러리 → AAR) · `:shoptalk-compose` (선택, Compose 래퍼) · `:sample` (검증용 앱, 전달물 아님)
- minSdk 21 · compileSdk 35 · **Kotlin 2.2.0** · JDK 17 · AGP 8.5.2 / Gradle 8.7
- `:shoptalk`의 선언 의존성은 **최저 버전**(fragment-ktx 1.3.6, core-ktx 1.6.0, lifecycle-runtime-ktx 2.3.1, kotlin-stdlib 2.1.0)이다.
  이 값이 POM에 그대로 실려 호스트 앱의 더 높은 버전이 유지되고 `compileSdk`도 강제되지 않는다. **최신 버전으로 올리지 말 것**
  (core 1.15는 `compileSdk 35` 요구). 올리려면 TCR-261016 §11 방식으로 최저 버전 실기 검증부터 다시 한다.
  Compose는 `:shoptalk-compose`에만 있다(fragment-compose 1.8.5).

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

## 전달 (Maven 형식 폴더)

```bash
./gradlew deliveryZip
# → dist/maven/                              AAR + POM + Gradle 모듈 메타데이터 + 소스 jar + 파일별 체크섬(.sha256 등)
# → dist/shoptalk-android-<shoptalk.version>-maven.zip   고객에게 보낼 단일 파일
sha256sum dist/shoptalk-android-0.2.0-maven.zip         # 이 값을 메시지로 함께 전달
```

`shoptalk.version`은 `gradle.properties` 한 곳에서 올린다. 고객은 zip을 repo의 `third_party/shoptalk-maven`에 풀거나 사내 Artifactory/Nexus에
폴더째 올리고, 앱에서는 `implementation("site.amoeba.shoptalk:shoptalk-android:0.2.0")` 한 줄만 쓴다(Compose는 `shoptalk-compose`).
설치 방법·최소 버전 표·AAR 직접 전달 대안은 `docs/guide/GUIDE-261016-Mobile-SDK-0.2.vi.md` §1.

- **AAR만 필요한 고객**(저장소 추가 불가): `dist/maven/site/amoeba/shoptalk/shoptalk-android/0.2.0/shoptalk-android-0.2.0.aar`을 보내고,
  가이드 §1.3의 **최저 버전 표**를 함께 준다. AAR에는 POM이 없어 고객 앱이 androidx를 직접 가져야 한다.
- 소스 모듈로 넣고 싶은 앱은 `:shoptalk`(와 `:shoptalk-compose`) 디렉터리를 `include`하면 된다.
- **AAR·zip·secret·서명 해시는 리포에 커밋하지 않는다**(`dist/`는 gitignore).
- 릴리스 전 필수 검증: ①`:shoptalk:testReleaseUnitTest` ②고객 환경을 흉내 낸 소비 앱(최저 androidx·`compileSdk 34`·한 줄 의존성)으로 빌드와 실행
  ③13개 프로토콜 시나리오. 방법과 결과는 TCR-261016 §11.

## 호스트 앱 통합 (요약)

```kotlin
// Maven 폴더를 저장소로 추가한 뒤 (가이드 §1.2). androidx는 POM이 최저 버전만 선언한다.
dependencies {
    implementation("site.amoeba.shoptalk:shoptalk-android:0.2.0")
}
```

```kotlin
// onCreate: 처음 한 번만 Fragment를 넣는다 (commit은 비동기이므로 바로 뒤에 findFragmentByTag를 하지 말 것)
if (savedInstanceState == null) {
    supportFragmentManager.commit {
        replace(R.id.container, ShopTalkChatFragment.newInstance(
            ShopTalkConfig(
                widgetUrl = "https://shoptalk.amoeba.site/widget/",
                shop = "https://www.go2joy.vn",   // 테넌트 조회 키(tenants.shop_domain). 앱 도메인이 아님
                agent = "hotel-admin",
                locale = "vi",
            )
        ), "chat")
    }
}

// onResumeFragments: 매번 붙인다. Activity가 재생성되면 새 Fragment가 생기고 provider/listener는 저장되지 않는다
// (한 번만 붙이면 다크모드 등 이후 사용자가 조용히 게스트가 된다. TCR-261016 §11).
override fun onResumeFragments() {
    super.onResumeFragments()
    (supportFragmentManager.findFragmentByTag("chat") as? ShopTalkChatFragment)?.apply {
        // 서명은 호스트 백엔드가 한다. 앱은 받아서 넘기기만 — 시크릿은 앱에 없다.
        identityProvider = ShopTalkIdentityProvider {
            ShopTalkIdentity.fromJson(api.sharpTalkIdentityJson()) // {userId, hash, attributes|claims, ...}
        }
        listener = object : ShopTalkListener {
            override fun onCloseRequest() { finish() } // 필수
            override fun onError(error: ShopTalkError) { /* 선택 */ }
        }
    }
}
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
