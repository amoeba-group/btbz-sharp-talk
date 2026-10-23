# PLN-261023 — go2joy HA UAT: 동의 안내 생략 · 이름 인사말 · 칩 언어 · 세션 제목 고객/고객사

- 근거: [REQ-261023](../analysis/REQ-261023-Go2Joy-HA-UAT-Consent-Name-Language-Title.md)
- 상태: **승인 대기** — 승인 전 구현하지 않습니다. §1 결정 1건이 필요합니다.
- 스키마: 1건(테넌트 설정 컬럼 1개, `sql/261023-host-terms-claimed.sql`) — 결정 A를 택할 때만

## 0. 요약
| 요구 | 해결 | 누가 |
|---|---|---|
| ① 배너 생략 | Go2Joy 서명 구현(정석) + UAT 기간 서명 없는 로그인도 HA 약관 동의로 인정(테넌트 옵션, 스테이징만) | Go2Joy + SharpTalk |
| ② 인사말 이름 | 에이전트 인사말에도 `{name}` 치환, 서명 없는 로그인 이름도 위젯에 반영 | SharpTalk |
| ③ 칩 언어 | 호스트가 정한 언어를 명시 선택으로 존중, 칩 캐시 키에 언어 포함 | SharpTalk |
| ④ 세션 제목 | `고객 이름 / 고객사 이름` | SharpTalk |

## 1. 결정 필요 — 서명 없는 HA 로그인을 동의로 인정할지
| 안 | 내용 | 장단 |
|---|---|---|
| **A (권장)** | 테넌트 옵션 `host_terms_trust = signed | claimed`(기본 `signed`). go2joy **스테이징만 `claimed`** + `EMBED_UNSIGNED_IDENTIFY_TENANT_IDS=4`. 서명 없는 identify도 배너 생략·이름 표시. 고객·고객사 저장과 이전 대화 연결은 **서명 전용 그대로** | UAT를 오늘 진행 가능. 프로덕션은 서명 전용 유지. 동의 기록에 `host_terms(claimed)`로 구분 |
| B | SharpTalk 변경 없이 Go2Joy 서명 완료를 기다림(②~④만 진행) | 경계 변경 없음. 서명 전까지 UAT에서 배너가 계속 보임 |

어느 쪽이든 Go2Joy에는 G-a(서명·허용 키 5개·`region`=지역표 값)를 다시 요청합니다(§6).

## 2. 작업
### 2.1 ① 배너 생략 (안 A)
| # | 작업 | 파일 |
|---|---|---|
| 1-1 | `tenants.host_terms_trust` VARCHAR(16) NOT NULL DEFAULT 'signed' + 엔티티 + 테넌트 설정 DTO(검증 `signed|claimed`) | `sql/261023-…sql`, `tenant.entity.ts`, `tenant.request.ts` |
| 1-2 | `claimIdentity()`: `consent_source=host_terms` && `host_terms_trust=claimed` && 거절 이력 없음 → `consent_state=granted`, 감사 `consent.host_terms` metadata `{level:'claimed'}` | `embed.service.ts` |
| 1-3 | 위젯: claimed 응답의 `consentState=granted` 반영(이미 공통 경로) 확인 | `useEmbedCommands.ts` |
| 1-4 | 콘솔 설정 › 개인정보 안내: "서명 없는 로그인도 약관 동의로 인정" 체크박스(마스터, `host_terms`일 때만 보임, 경고 문구) — 6개 언어 | `apps/web/.../PrivacySettings` |
| 1-5 | 스테이징 env `EMBED_UNSIGNED_IDENTIFY_TENANT_IDS=4`, go2joy `host_terms_trust=claimed` | 운영 |

### 2.2 ② 인사말 이름
| # | 작업 |
|---|---|
| 2-1 | 위젯이 identify 응답의 `customerName`을 claimed 세션에도 반영(`setCustomerName`) — 헤더·인사말 공통 |
| 2-2 | 이름이 있을 때 인사말 선택: **에이전트 인사말에 `{name}`이 있으면 그 문구를 치환해 사용** → 없으면 테넌트 `loginGreeting` → 기본 문구. 이름이 없으면 `{name}` 토큰과 앞뒤 공백·쉼표를 지움(`Dear {name}, I'm…` → `Dear, I'm…`이 되지 않게 `Dear Hotel Partner`처럼 쓰도록 콘솔 도움말 추가) |
| 2-3 | 에이전트 인사말 편집기 도움말에 `{name}` 사용법 표시(6개 언어) |
| 2-4 | 스테이징 데이터: `hotel-partner` 인사말 `Dear Hotel (name}` 오타 → 운영자 확인 후 `Dear {name}`으로 수정 |

### 2.3 ③ 칩 언어
| # | 작업 |
|---|---|
| 3-1 | 위젯: iframe `?locale=` 를 초기 언어 1순위로 읽음(호스트 지정 > 저장값 > 브라우저) |
| 3-2 | 호스트가 지정한 언어(`locale` 설정·`setLocale`)는 **명시 선택**으로 `ensure`에 전달 → 서버가 `en`도 존중하고 `language_locked=1`(브라우저 기본 `en`은 지금처럼 "선호 없음") |
| 3-3 | 칩 쿼리 키에 언어 포함 `['scenario', token, lang]`, 언어 전환 시 무효화 |

### 2.4 ④ 세션 제목
| # | 작업 |
|---|---|
| 4-1 | API 세션 목록·대화 응답에 `companyName` 추가(세션 `company_id` → `companies.name`, 일괄 조회) |
| 4-2 | 제목 = 별칭 ‖ `이름 / 고객사`: 이름 = 고객 이름 → claimed 이름, 고객사 = `companyName` → claimed `hotel_name`. 둘 중 하나만 있으면 그것만 |
| 4-3 | claimed 세션은 지금처럼 ⚠ "미검증" 아이콘 유지 |

## 3. 화면
### 3.1 위젯 (HA, 영어 선택, 로그인 사용자)
```
┌──────────────────────────────────────┐
│ [G2J] Support center   ADMIN123  EN ✕│   ← 헤더 이름(기존 headerGreeting {name})
├──────────────────────────────────────┤
│  (Privacy notice 없음)                │   ← 배너 제거
│ 🤖 JoyBot - AI Operator              │
│ ┌──────────────────────────────────┐ │
│ │ Dear ADMIN123, I'm Joydesk, …    │ │   ← 인사말 {name}
│ └──────────────────────────────────┘ │
│ (View today's bookings) (How to check│   ← 칩 EN
│  in a guest) (Dispute a booking) …   │
├──────────────────────────────────────┤
│ [🖼] Type a message…            [➤]  │
└──────────────────────────────────────┘
```
### 3.2 라이브챗 세션 목록 / 대화 헤더
```
┌ 세션 목록 ───────────────────────────┐   ┌ 대화 헤더 ─────────────────────────────┐
│ ● A****23 / Lá Hotel Quận 10    2분  │   │ A****23 / Lá Hotel Quận 10  [Business] │
│   Session 4f2a1c · Hồ Chí Minh·South │   │ Lá Hotel Quận 10 · Quản lý · South     │
│ ● N****n V*n                   15분  │   └────────────────────────────────────────┘
│   Session 9b0e33                     │   (이름은 기존과 같이 마스킹)
└──────────────────────────────────────┘
```
### 3.3 콘솔 설정 › 개인정보 안내 (안 A)
```
동의 방식   (•) 호스트 앱 약관  ( ) 위젯 배너
            [ ] 서명 없는 로그인도 약관 동의로 인정
                ⚠ 서명 검증 전 UAT용. 고객·고객사 등록과 이전 대화 연결은 서명된 로그인에만 적용됩니다.
```

## 4. 부작용 분석
| 영역 | 영향 | 대응 |
|---|---|---|
| 다른 테넌트 | `host_terms_trust` 기본 `signed`, 언어 변경은 **호스트가 명시한 locale에만** 적용 → ivyusa 등 브라우저 기본값 흐름 불변 | 기존 `resolveLanguage` 스펙 유지 + 신규 케이스 |
| 동의 기록 | claimed 동의는 감사·세션에 구분 기록. 추후 옵션 끄면 새 세션부터 배너 | 기존 세션 소급 없음 |
| 인사말 | `{name}` 없는 에이전트 인사말은 동작 불변(이름 있으면 지금처럼 loginGreeting) | — |
| 콘솔 제목 | 마스킹 규칙 유지, 고객사명은 개인정보 아님 | — |
| 칩 캐시 | 언어별 조회 1회 추가 | 무시 가능 |

## 5. 테스트
- 단위: claimIdentity 동의(trust claimed/signed/declined) · resolveLanguage(호스트 명시 en → EN 고정, 브라우저 en → 기존) · 인사말 선택 4경우 · 제목 조합
- 스테이징: HA UAT 실화면(Orca 브라우저) — 배너 없음, `Dear ADMIN123`, EN 칩, 콘솔 제목 `… / Lá Hotel Quận 10`, VI 전환 시 칩 VI
- 프로덕션: 옵션 기본 `signed` 확인만

## 6. Go2Joy 재요청 (가이드 v1.3 §5 재확인)
1. `hash`는 HA **서버**가 embed secret으로 만든 HMAC-SHA256 hex(현재 `"testing"`).
2. `attributes`는 `hotel_id·hotel_name·province·region·role` 5개만(`hotel_code`·`user_id`·`user_sn`·`district`·`hotel_group_id` 제거).
3. `region`은 지역표 값(`South` 등) — `Hồ Chí Minh` 아님(모르면 빼면 SharpTalk이 성으로 채움).
4. 빈 `phone`은 키째 제외.

## 7. 일정
승인 후 1일: 2.2·2.3·2.4 → 2.1(안 A) → 스테이징 배포·UAT 실화면 확인 → RPT. 프로덕션은 승인 후 별도.
