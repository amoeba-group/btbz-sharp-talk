# REQ-261023 — go2joy HA UAT: 동의 안내 생략 · 이름 인사말 · 칩 언어 · 세션 제목에 고객/고객사

- 요청(2026-10-23): `https://go2joy-ha-uat.go2joy.io/homepage`(Go2Joy Hotel Admin UAT, 이하 HA)의 SharpTalk 위젯에서
  1. **Privacy notice가 나오면 안 된다** — HA 로그인 사용자는 이미 HA 약관으로 동의했다.
  2. **첫 환영 인사말에 HA 로그인 사용자 이름**이 나와야 한다.
  3. 언어를 **영어로 선택했는데 버튼(칩)이 베트남어**로 나온다.
  4. 등록 고객이 어떤 대화 세션을 썼는지 **세션 제목에 고객 이름 / 고객사 이름**을 표기해야 한다.
- 조사 기준: main `479cbaa3` · 스테이징(`shoptalk.amoeba.site`, go2joy=tenant 4) · Orca 내장 브라우저에 열린 HA UAT 실측(2026-10-23 14:07 KST)
- 관련: GUIDE-261021/261022 HA Identify v1.1~v1.3 · PLN-261022(기업고객·대화 연속성, #689) · PLN-261019(언어 선택 준수)

## 1. AS-IS (실측)

### 1.1 HA가 보내는 것
HA 페이지의 `window.SHARPTALK_WIDGET_CONFIG.user`와 큐(`SharpTalk.q`)에서 그대로 읽은 값입니다(값 일부 생략).
```json
{ "userId": "laquan10", "hash": "testing", "name": "ADMIN123", "email": "maihien…@go2joy.vn", "phone": "",
  "attributes": { "hotel_id": "4118", "hotel_name": "Lá Hotel Quận 10", "province": "Hồ Chí Minh",
                  "region": "Hồ Chí Minh", "role": "Quản lý",
                  "hotel_code": "…", "hotel_group_id": "", "user_id": "laquan10", "user_sn": 5626, "district": "Quận 1" } }
```
- `hash`가 HMAC이 아니라 **문자열 `"testing"`** → `POST /public/embed/identify` **401**(E5048). API 로그: `identify rejected — signature mismatch (tenant 4, user la***10)` 오늘 3회.
- 허용 키(5개) 외 키 5개, `region`에 성 이름(`Hồ Chí Minh`)을 넣음 — 서명을 붙여도 지금 형태로는 불일치가 납니다(SharpTalk은 허용 키 5개만으로 서명을 다시 계산).
- 위젯은 `locale=en`으로 열렸고 헤더 언어 표시도 EN.

### 1.2 그래서 보이는 것
| 증상 | 직접 원인 |
|---|---|
| ① Privacy notice + Accept/Decline | identify 401 → 세션이 게스트로 남음. `host_terms` 동의는 **서명 검증된** identify에서만 기록(`embed.service.ts` 158-167) |
| ① 서명 없는 identify 수용 장치도 꺼짐 | `EMBED_UNSIGNED_IDENTIFY_TENANT_IDS` 스테이징 미설정. 켜도 claimed 세션은 동의를 받지 않음(설계상) |
| ② 인사말에 이름 없음 | 이름은 검증 세션에서만 위젯에 반영(`useSessionProfile`). claimed 응답의 `customerName`은 위젯이 버림(`useEmbedCommands`) |
| ② 인사말 문구 자체 | 에이전트 `hotel-partner`(id 10) 인사말이 `firstVisit`를 덮고, 이 문구는 `{name}` 치환 대상이 아님(이름이 있을 때는 테넌트 `loginGreeting`으로 바뀌는데 go2joy는 비어 있음 → 기본 문구). 스테이징 데이터에 `Dear Hotel (name}` 오타도 있음 |
| ③ EN 선택인데 칩 VI | 칩 데이터는 EN/KO/VI 모두 있음(정상). 서버가 `en`을 "선호 없음"으로 보고 테넌트 기본 `vi`로 세션을 만듦(`resolveLanguage`) — 최근 go2joy 세션 `language=VI`. 칩은 서버가 `session.language`로 고르고, 위젯 캐시 키에 언어가 없어 전환 후에도 그대로. iframe `?locale=en`은 위젯이 읽지 않음 |
| ④ 세션 제목 | 라이브챗 목록 제목 = 별칭 → 고객 이름 → claimed 이름 → `Session xxxxxx`. **고객사(호텔) 이름은 제목에 없음**(배지·툴팁만) |

### 1.3 이미 되는 것 (10/23 스테이징 E2E)
올바르게 서명한 identify는 고객(`b2b_contact`)·고객사(`hotel:{id}`)·담당자 연결·host_terms 동의·헤더 이름까지 정상(REQ 범위 밖, 직전 확인).

## 2. TO-BE
| # | 기대 |
|---|---|
| T1 | HA 로그인 사용자의 위젯에는 Privacy notice가 나오지 않는다(HA 약관 동의로 기록) |
| T2 | 첫 환영 인사말에 HA 사용자 이름이 들어간다(예: `Dear ADMIN123, I'm Joydesk…`) |
| T3 | HA에서 영어를 고르면 인사말·칩·AI 답변이 모두 영어. 대화 중 언어를 바꾸면 칩도 즉시 바뀐다 |
| T4 | 라이브챗 세션 제목 = `고객 이름 / 고객사 이름`(예: `ADMIN123 / Lá Hotel Quận 10`) — 목록과 대화 헤더 모두 |

## 3. 갭 분석
| # | 갭 | 누가 | 비고 |
|---|---|---|---|
| G-a | **서명 미구현**(`hash:"testing"`), 허용 외 키, `region` 값 | **Go2Joy** | 가이드 v1.3 §5 그대로 하면 T1·T2·T4가 SharpTalk 변경 없이도 대부분 충족 |
| G-b | 서명 없는(claimed) 로그인에 대한 동의·이름 처리 | SharpTalk | UAT를 Go2Joy 서명 완료 전에 진행하려면 필요. **보안 경계 결정 필요(§5)** |
| G-c | 위젯이 claimed 이름을 버림 | SharpTalk | 버그성 |
| G-d | 에이전트 인사말이 `{name}`을 치환하지 않음 | SharpTalk | 이름 있을 때 테넌트 loginGreeting으로만 전환 |
| G-e | 호스트가 지정한 `en`을 "선호 없음"으로 처리 / iframe `locale` 무시 / 칩 캐시 키에 언어 없음 | SharpTalk | 버그 3건 |
| G-f | 세션 제목에 고객사 이름 없음 | SharpTalk | 표시 변경 |

## 4. 사용자 흐름 (TO-BE)
```
HA 로그인 ─▶ HA 서버 서명 ─▶ FE identify(locale=en) ─▶ SharpTalk 검증
                                      │                    ├─ 고객·고객사 저장, host_terms 동의 → 배너 없음
                                      │                    └─ 이름 → 헤더 + 인사말 {name}
                                      └─ 언어 en 고정 → 칩·답변 EN
상담원 콘솔: 세션 목록 "ADMIN123 / Lá Hotel Quận 10"
```

## 5. 제약·결정 사항
- **동의를 서명 없는 값으로 처리할지**: 동의 기록은 법적 근거라 지금은 "서명 검증된 HA 로그인"만 인정합니다. 서명 없는 identify는 누구나 브라우저에서 만들 수 있습니다. 다만 배너 생략의 효과는 그 브라우저 자신에게만 미치고, 고객·고객사 레코드와 이전 대화 열람은 계속 서명 전용으로 두면 타인 사칭 위험은 없습니다.
- 고객·고객사 저장은 서명 전용 유지(사칭으로 다른 호텔 대화 열람 방지, PLN-261022 §3.1).
- 프로덕션은 서명 전용(Go2Joy 서명 완료가 오픈 조건).
