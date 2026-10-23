# SharpTalk × Go2Joy — 작업요청서 (Go2Joy 수행 작업)

> 공유 페이지(KO/EN): https://claude.ai/artifact/YXajSxYLdmHLgXnUQdVShz — 이 문서와 같은 내용입니다. `v1.1`·`v1.2`·`v1.3` 표시는 해당 판에서 추가·변경된 항목입니다. HA 연동 규격은 [가이드 v1.4](GUIDE-261024-Go2Joy-HA-Identify-v1.4.md).


| 항목 | 내용 |
|----|----|
| 수신 | Go2Joy PM · HA 개발팀(백엔드·FE) · Go2Joy 개발(Partner API) · 인프라 · 운영팀(CS) · 법무 |
| 발신 | SharpTalk (Amoeba) |
| 일자 / 버전 | 2026-10-24 · **v1.3** (v1.2 · v1.1 · v1.0 대체) |
| 기준 문서 | ① HA 연동 가이드 **v1.3** + 본 요청서 1절 변경분 → [**가이드 v1.4**](https://claude.ai/artifact/2An9WPgY9oCcs3PugiqXf8)(10/24 배포) ② 요청 사항·작업 체크리스트(G 번호, 2026-10-22) ③ Go2Joy Support Assistant API 안내 및 Partner API 공개 문서(`dev.go2joy.vn/api`, 10/23 확인)<br>**v1.0 PDF(10/20)는 폐기**합니다. 그 안의 userId 형식, region 값, 테스트 벡터 T1·T2는 더 이상 유효하지 않습니다. |
| 회신 | 작업별 완료 보고 또는 8절 회신표 — 일일 점검 채널(WR-40) |



**✅ HA(Go2Joy)가 해야 할 일 — 체크리스트** `v1.3`

규격 v1.4가 확정됐고(10/24 승인), 가이드 v1.4와 테스트 벡터를 배포했습니다. 항목별 확인 방법과 예제 코드는 [HA 연동 가이드 v1.4](https://claude.ai/artifact/2An9WPgY9oCcs3PugiqXf8) 맨 앞 체크리스트에 있습니다.

- **백엔드 (WR-01 · 02, 10/27)**: ☐ secret은 서버 환경변수에만 ☐ 로그인 세션 전용 엔드포인트 ☐ 값은 세션·DB에서 ☐ `userId = "ha:" + userSn` ☐ 속성 4개만 `hotel_id · hotel_name · province_sn · role` ☐ `province_sn` = Go2Joy provinceSn ☐ 역할 코드 + **코드표 회신** ☐ 전체 호텔이면 `role`만 ☐ NFC → 공백 정리 → trim → 120자 ☐ 빈 값 제외 ☐ HMAC-SHA256 ☐ **테스트 벡터 T1 ~ T6 일치 회신** ☐ 패키지 로그 금지
- **FE (WR-04, 10/28)**: ☐ 브라우저 조립·`hash: "testing"` 삭제 ☐ 서버 응답을 그대로 `identify` ☐ 로그인·새로고침·호텔 변경·언어 변경 시 재호출 ☐ 로그아웃·세션 만료·계정 전환·다른 탭 로그아웃 시 `logout` ☐ `locale` 유지 ☐ CSP·CORS 허용 ☐ SharpTalk 도메인을 설정값 하나로
- **UAT (WR-05, 10/29 ~ 30)**: ☐ 가이드 8절 체크리스트 통과 ☐ 북부·남부 테스트 계정
- **운영 (WR-06)**: ☐ 운영 secret ☐ 운영 도메인 `sharptalk.go2joy.vn` ☐ 운영 CSP·CORS·배포 일정 공유



**v1.2 변경 사항 (10/24)**

- 10/23 ~ 10/24 SharpTalk 배포 반영(2.1): 상담카테고리(고객이 위젯에서 Business Support / Customer Services 선택 → 선택값 × 호텔 권역으로 팀 배정), 알람센터·개인 알람 설정·배정 확인(시뮬레이터), 같은 고객·같은 호텔 대화 통합, AI 고지 문구와 약관 링크, AI 빈 답변 재시도
- go2joy 스테이징 배정 설정 현황 추가(2.3): 팀 4개, 상담원 11명(8명 초대 미수락), 규칙 4개. **South 팀 활성 0명**이라 남부 호텔 문의가 팀에 가지 않습니다
- 작업 갱신: WR-10 규칙 확정 · WR-11 초대 수락 · WR-12 상담카테고리 정의·베트남어 이름(Sales 키워드 대체) · WR-13 건너뛴 고객·규칙 밖 문의 담당자 · WR-15 **완료** · WR-31 확인 요청 · WR-19a 신규
- HA UAT 10/24 재점검: D1 ~ D9 변화 없음


## 0. 요약

- SharpTalk 1단계 기능(서명 검증, 호텔 = 기업고객, 대화 연속성, 지역 배정, 호텔 정보·객실 연동)은 **스테이징에 배포되어 동작**합니다.
- 10/23 HA UAT 점검 결과, **위젯은 임베드됐지만 서명이 없습니다**(`hash: "testing"`). HA 구현은 v1.0 PDF를 따른 것이며, v1.3 이후 바뀐 규격이 반영되지 않았습니다(2.2절). 스테이징만 임시로 서명 없는 로그인을 받고 있고, **운영에서는 거부됩니다.**
- `v1.1` 식별 패키지를 단순하게 바꿉니다. **region은 HA가 보내지 않고 SharpTalk이 산출**합니다(Partner API Province Feed의 `region` 기준). province와 role은 표시명 대신 **언어와 무관한 코드**를 씁니다. HA 서버 작업이 줄고, 지역표는 Go2Joy Partner API 한 곳에서만 관리됩니다.
- `v1.2` 배정 설정은 Go2Joy 운영팀이 콘솔에 상당 부분 입력했습니다(2.3). 남은 것은 **초대 수락**(특히 South 팀)과 **상담카테고리 이름·기본 담당자**입니다.
- **10/31 스테이징 오픈**에 필요한 것: WR-01 · 02 · 04 · 05 · 10 ~ 14 · 40.
- **운영 오픈**에 추가로 필요한 것: WR-06(HA 운영 배포) · WR-20 ~ 23 · WR-30 · 31. 가장 빠른 운영 오픈은 **11/10(화)**입니다. 운영 서버(WR-20) 수령 후 7영업일, Partner API 운영 인증(WR-23, 약 1주)이 둘 다 끝나야 합니다.

## 1. 연동 규격 변경 이력 `v1.1`

Go2Joy가 v1.0 PDF로 구현한 부분이 있어, 버전별 차이를 한 표로 정리합니다. **v1.4 열이 최종 규격**이며, SharpTalk은 10/24 가이드 v1.4와 새 테스트 벡터를 배포했습니다(S-01 완료).


<table>
<thead>
<tr>
<th>항목</th>
<th>v1.0 (10/20 PDF)</th>
<th>v1.3</th>
<th>v1.4 (본 요청서)</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>userId</code></td>
<td>로그인 ID(<code>go2joysupport</code>)</td>
<td><code>"ha:" + userSn</code></td>
<td>v1.3과 같음</td>
</tr>
<tr>
<td>서명 속성 키</td>
<td>5개: <code>hotel_id</code> · <code>hotel_name</code> · <code>province</code> · <code>region</code> · <code>role</code></td>
<td>5개(같음)</td>
<td><strong>4개</strong>: <code>hotel_id</code> · <code>hotel_name</code> · <code>province_sn</code> · <code>role</code></td>
</tr>
<tr>
<td>성·시</td>
<td><code>province</code> = 성 이름(<code>Hồ Chí Minh</code>)</td>
<td>같음</td>
<td><code>province_sn</code> = Go2Joy <code>provinceSn</code>(Province Feed <code>sn</code>, 예: Hồ Chí Minh = <code>"1"</code>)</td>
</tr>
<tr>
<td>지역</td>
<td>HA 산출 3값(north · central · south)</td>
<td>HA 산출 5코드</td>
<td><strong>보내지 않음</strong>. SharpTalk이 Province Feed <code>region</code>(1 ~ 5)으로 산출</td>
</tr>
<tr>
<td>역할</td>
<td>표시명(<code>Lễ tân</code>)</td>
<td>같음</td>
<td><strong>HA 역할 코드</strong>(화면 언어와 무관한 값). 코드표는 WR-01에서 회신</td>
</tr>
<tr>
<td>값 정규화</td>
<td>공백 정리 · trim · 120자</td>
<td>+ NFC</td>
<td>순서 고정: <strong>NFC → 공백 정리 → trim → 120자(<code>mb_substr</code>)</strong></td>
</tr>
<tr>
<td>"전체 호텔" 선택</td>
<td>규정 없음</td>
<td>재호출만 규정</td>
<td>호텔 키 3개(<code>hotel_id</code> · <code>hotel_name</code> · <code>province_sn</code>)를 빼고 <code>role</code>만 서명 → 폴백 담당자(WR-13)</td>
</tr>
<tr>
<td>빈 값</td>
<td>빈 attributes·email 제외</td>
<td>같음</td>
<td>빈 <code>name</code> · <code>email</code> · <code>phone</code>도 필드째 제외(email 빈 값·형식 오류는 400)</td>
</tr>
<tr>
<td>테스트 벡터</td>
<td>T1 · T2(옛 userId)</td>
<td>T1 ~ T5</td>
<td><strong>T1 ~ T6</strong>(T6 = 분해형 유니코드 입력). 이전 벡터는 사용하지 않음</td>
</tr>
<tr>
<td>전환 기간</td>
<td colspan="3">SharpTalk은 v1.3 형식(<code>province</code> · <code>region</code> 키)도 당분간 서명 검증을 통과시킵니다. 배정에는 v1.4 값을 우선 사용합니다. HA가 v1.4로 전환하면 종료합니다(S-02).</td>
</tr>
</tbody>
</table>


### 1.1 v1.4 식별 패키지


| 필드 | 서명 | 값 | HA 출처(예) | UAT 예 |
|----|----|----|----|----|
| `userId` | 예 | `"ha:" + userSn` | HA DB 직원 번호 | `ha:<userSn>` |
| `attributes.hotel_id` | 예 | 선택 호텔 `hotelSn`(문자열) | `profile.hotelSn` | `"1721"` |
| `attributes.hotel_name` | 예 | 호텔명 | `hotelViewList[].name` | `A In Hotel Del Luna` |
| `attributes.province_sn` | 예 | 호텔 소재 성의 `provinceSn`(문자열) | HA DB 호텔 → provinceSn | `"1"` |
| `attributes.role` | 예 | HA 역할 코드 | HA DB 역할 키 | WR-01 회신 |
| `name` · `email` · `phone` | 아니오 | 표시용. 비어 있으면 필드째 제외 | `profile.fullName` 등 | `G2J SUPPORT` |


``` tl
서명 문자열 (키 알파벳 순, 줄바꿈 \n)
ha:<userSn>
hotel_id=1721
hotel_name=A In Hotel Del Luna
province_sn=1
role=<HA 역할 코드>

hash = hex( HMAC-SHA256( key = SHARPTALK_EMBED_SECRET, message = 서명 문자열(UTF-8) ) )
```

SharpTalk의 지역 산출: Province Feed `region` `1` → `south`, `2` → `north`, `3` → `central`, `4` → `north_center`, `5` → `south_center`. 문서에 없는 `10`(마닐라)은 WR-27 회신 후 정합니다.

## 2. 현재 상태 (2026-10-24) `v1.2`

### 2.1 SharpTalk 준비 완료 (스테이징)


| 기능 | 상태 |
|----|----|
| HA 서명 identify 검증, HA 약관 동의 기록(동의 안내 생략), 위젯 첫 인사에 직원 이름 | 완료 |
| 호텔 = 기업고객, 직원 = 연락처 등록, B2B / B2C 구분, 호텔 계정 단위 대화 연속성 | 완료 |
| **상담카테고리**: \[상담원 연결\]·AI 이관 때 위젯이 상담 종류를 묻고(건너뛰기 가능), 선택값 × 호텔 권역 → 팀 × 업무 라벨로 배정 | 완료 (10/24) — 규칙·명단 일부 입력됨(2.3) |
| **알람센터**: 헤더 🔔, 배정자·규칙·상담카테고리·호텔·권역 표시, 확인/닫기 분리, 개인 설정(전체 / 내 배정 / 끄기, 소리, 데스크톱 알림, 메일) | 완료 (10/24) |
| **배정 확인**(시뮬레이터)·규칙 경고: 상담카테고리·권역·성을 넣으면 맞는 규칙·대상·건너뛴 이유, 활성 0명·업무 라벨 오용 경고 | 완료 (10/24) |
| 같은 고객·같은 호텔의 여러 세션을 한 대화방으로 통합, 이후 세션 자동 추가 | 완료 (10/23) |
| 위젯 하단 AI 고지 문구(언어별)·약관 링크, 헤더 언어·설정 버튼 노출 설정 | 완료 (10/23) |
| AI 빈 답변 1회 재시도·인계, 클라이언트 IP 위조 차단, 대화 내용 검색 | 완료 (10/23) |
| 선택 언어(vi / en)로 응답·버튼 표시, 라이브챗 대화 제목 "직원 / 호텔" | 완료 |
| Partner API로 호텔 정보·객실 유형 → 기업고객 프로필·호텔별 상품, 성 → 권역 지역표 자동 갱신(80개 성) | 완료 — 스테이징 자격증명으로 동작 |
| 성 이름 → 권역 임시 보정(HA가 성 이름을 region으로 보내는 현재 상태 대응) | 10/23 배포 |
| 콘솔 고객·상담 목록 이름 평문, 외부 AI·로그에는 마스킹 | 완료 |


### 2.2 HA UAT 점검 결과

HA UAT(`go2joy-ha-uat.go2joy.io`)의 임베드 코드(`window.sharptalkSignIn`)와 SharpTalk 스테이징 수신 로그로 확인했습니다. "근거" 열은 HA가 따른 문서입니다. `v1.2` **10/24 재점검 결과 변화 없음**(`hash: "testing"`, 로그인 ID, 허용 외 키 5개, `region`에 성 이름).


| \# | 항목 | 현재 HA | 근거 | v1.4 규격 | 영향 |
|----|----|----|----|----|----|
| D1 | 서명 | 브라우저에서 패키지 조립, `hash: "testing"` | — (v1.0부터 서버 서명) | **HA 서버**가 HMAC-SHA256 서명 후 FE에 반환 | 운영 401 |
| D2 | `userId` | 로그인 ID | v1.0 규격대로 구현 | `"ha:" + userSn`(v1.3에서 변경) | 로그인 ID 변경 시 대화 단절, 부킹 고객 ID와 충돌 가능 |
| D3 | 속성 키 | 5개 + `hotel_code` · `hotel_group_id` · `user_id` · `user_sn` · `district` | — | 4개만 | 서명 시 모르는 키 때문에 401 |
| D4 | 지역 | `region`에 성 이름 | v1.0은 3값, v1.3은 5코드 | 보내지 않음(SharpTalk 산출) | SharpTalk 임시 보정 중 |
| D5 | 성·역할 값 | 표시명(`Hồ Chí Minh`, `Lễ tân`) | v1.0 · v1.3 | `province_sn` · 역할 코드 | HA 언어 전환 시 서명 값이 바뀌어 배정·연속성이 깨질 수 있음 |
| D6 | 정규화 | FE 조립이라 해당 없음 | v1.0 PHP 예제에 NFC 없음 | NFC 필수(`intl` 확장) | 성조 문자가 분해형이면 401 |
| D7 | `locale` | `localStorage.lang` → `vi`/`en`, 변경 시 `setLocale` | 같음 | 같음 | 정상 |
| D8 | 로그아웃 | `sharptalkSignOut()` → `logout`(버튼) | 같음 | 세션 만료·계정 전환 포함 | 공용 PC에서 이전 직원 신원 잔존 가능 |
| D9 | 호텔 변경 | 재호출 확인 못 함, "전체 호텔" 규칙 없음 | — | 변경마다 재호출, 전체 호텔은 1절 규칙 | UAT에서 확인(WR-04) |


### 2.3 go2joy 스테이징 배정 설정 현황 (10/24 조회) `v1.2`

Go2Joy 운영팀이 콘솔에 입력한 값입니다. 설정 › 상담원 연결 › **배정 확인**에 상담카테고리·권역을 넣으면 같은 결과를 볼 수 있습니다.


| 항목 | 현재 |
|----|----|
| 상담카테고리(고객 노출) | `bs` Business Support · `cs` Customer Services — **베트남어 이름 없음**(베트남어 화면에도 영어로 보임) |
| 팀 | North · North Center · South · South Center |
| 상담원 11명 | 활성 3명(North 1, North Center 2) · **초대 미수락 8명**(North 2, North Center 2, South 3, South Center 1) |
| 업무 라벨 | `cs` · `sa` (그 밖에 consult · accounting · operations) |



| 규칙 | 상담카테고리 | 호텔 권역 | 대상 | 지금 결과 |
|----|----|----|----|----|
| BS_North_SA | bs | north · north_center | North 팀 × sa | 배정됨(활성 sa 1명) |
| CS_North_CS | cs | north · north_center | North 팀 × cs | 배정됨(활성 cs 1명) |
| CS_South | cs | south · south_center | South 팀 × cs | **건너뜀 — 활성 0명** |
| BS_South_SA | bs | south · south_center | South 팀 × sa | **건너뜀 — 활성 0명** |


- **North Center · South Center 팀**은 어느 규칙의 대상도 아닙니다. 중북부 호텔도 North 팀으로 갑니다. `central` 권역 규칙은 없습니다.
- 고객이 상담카테고리를 **건너뛰거나** 맞는 규칙이 없으면 기본 담당자(없으면 "전체 — 맞는 규칙 없음" 알람)로 갑니다.
- 규칙의 권역 조건은 SharpTalk이 산출한 권역을 씁니다. v1.4 전환 뒤에도 규칙은 바꿀 필요가 없습니다.

## 3. 작업 요청 목록

**P0-S** 10/31 스테이징 오픈 · **P0** 운영 오픈 · **P1** 운영 품질 · **P2** 2단계 이후. 기한은 SharpTalk 제안입니다. 어려우면 회신표(8절)에 가능한 날짜를 적어 주십시오.

### 3.1 HA 개발팀 — 백엔드


| WR | 작업 | 상세 | 완료 기준 | 우선 | 기한(제안) | 관련 |
|----|----|----|----|----|----|----|
| WR-01 | **서명 엔드포인트 구현** `v1.1` | 로그인 세션으로 호출하는 API(예: `GET /api/v1/staff/sharptalkIdentity`)가 서버에서 패키지를 만들어 서명합니다.<br>① `userId = "ha:" + userSn`<br>② 속성 4개: `hotel_id` · `hotel_name` · `province_sn` · `role`(역할 코드). `region`은 보내지 않음<br>③ "전체 호텔"이면 호텔 키 3개를 빼고 `role`만<br>④ 정규화 순서: `Normalizer::normalize($v, Normalizer::FORM_C)` → 공백 정리 → trim → `mb_substr(…, 0, 120)`. PHP `intl` 확장 필요<br>⑤ 빈 값은 attributes와 `name` · `email` · `phone` 모두 필드째 제외<br>⑥ `hash = hex(HMAC-SHA256(embed secret, 서명 문자열))`<br>⑦ 값은 브라우저가 아니라 HA 세션·DB에서 읽음 | 가이드 v1.4 테스트 벡터 **T1 ~ T6** 해시 일치 결과 + **HA 역할 코드표**(코드 · vi/en 표시명) 회신 | P0-S | 10/27(화) | G10 · D1 ~ D6 · D9 |
| WR-02 | **서명 키 결정·적용** `v1.1` | **A안(권장)**: SharpTalk이 발급한 embed secret을 HA 서버 환경변수에만 둡니다. 결정 당일 SharpTalk이 스테이징 secret을 보안 채널로 전달합니다.<br>**B안**: Go2Joy client secret을 같이 씁니다. SharpTalk에 파트너 제공 secret 입력 기능을 추가해야 합니다(S-04). 키가 유출되면 Partner API 권한까지 노출됩니다.<br>10/26까지 결정하지 못하면 스테이징은 A안으로 열고, 운영 전에 다시 결정합니다(사양·코드는 같고 secret 값만 바뀜). secret은 FE·브라우저·로그·문서에 넣지 않습니다. | 결정 회신 + 스테이징 secret 적용 | P0-S | 10/26(월) 결정 | G12 |
| WR-03 | 서명 유효기간(`ts`) | 패키지에 서명 시각을 넣어 재사용을 막을지 결정합니다. Partner API처럼 5분 만료를 적용하면 양쪽 규격을 함께 바꿉니다. | 적용 / 미적용 회신 | P1 | 11/06 | G16 |


### 3.2 HA 개발팀 — FE·배포


| WR | 작업 | 상세 | 완료 기준 | 우선 | 기한(제안) | 관련 |
|----|----|----|----|----|----|----|
| WR-04 | **임베드 수정** `v1.1` | ① `sharptalkSignIn`이 WR-01 응답을 **그대로** `identify`에 넘김(브라우저에서 조립·수정 금지)<br>② 호출 시점: 로그인 확정 시 · 새로고침 시 · **호텔 선택 변경 시(전체 호텔 포함)** · HA 언어 변경 시<br>③ `logout` 호출 시점: 로그아웃 버튼 · **세션·토큰 만료에 따른 자동 로그아웃** · 다른 계정으로 로그인하기 직전. 다른 탭에서 로그아웃한 경우도 포함(`storage` 이벤트 등)<br>④ 초기 `SHARPTALK_WIDGET_CONFIG.user`의 `hash: "testing"` 제거<br>⑤ CSP(`script-src` · `frame-src` · `connect-src`) · CORS에 SharpTalk 도메인 허용<br>⑥ SharpTalk 도메인 3곳(`embed.js` src · `widgetUrl` · `ivy:event` origin 검사)을 환경 설정값 하나로 묶어 둠(WR-06에서 운영 값으로 교체) | Network에서 `POST …/public/embed/identify` **200**(`consentState: "granted"`), 페이지에 `ivy:event` `identified {ok: true}` | P0-S | 10/28(수) | G11 · D1 · D8 · D9 |
| WR-05 | UAT 공동 점검 | 6.1절 체크리스트를 SharpTalk과 함께 실행 | 결과표 서명 | P0-S | 10/29 ~ 10/30 | G13 |
| WR-06 | **HA 운영 배포** `v1.1 신규` | ① WR-01 · WR-04를 HA 운영에 배포<br>② 운영 embed secret을 운영 환경변수에 적용. 스테이징과 다른 값이며, SharpTalk이 보안 채널로 전달(S-08)<br>③ 운영 SharpTalk 도메인으로 교체: `https://sharptalk.go2joy.vn/widget/embed.js` · `widgetUrl` · origin 검사<br>④ 운영 CSP · CORS 반영<br>⑤ HA 배포 일정을 SharpTalk에 미리 공유 | 운영 HA에서 identify 200, 스테이징 secret 패키지는 운영에서 401 | P0 | 운영 UAT 시작 전(WR-20 수령 + 4영업일) | G11 · G1 |


### 3.3 Go2Joy 운영팀(CS)


| WR | 작업 | 상세 | 완료 기준 | 우선 | 기한(제안) | 관련 |
|----|----|----|----|----|----|----|
| WR-10 | **배정 규칙 확정** `v1.1` `v1.2`<br>\[일부\] | Go2Joy 권역은 Partner API 기준 **5개**입니다(1 South · 2 North · 3 Central · 4 North Central · 5 South Center). 2.3의 규칙 4개를 확인해 주십시오.<br>① **North Center · South Center 팀**에 문의를 줄지(주려면 권역별로 규칙을 나누거나 대상 팀 추가)<br>② `central`(다낭 등) 권역의 담당 팀 — 지금은 규칙이 없어 기본 담당자로 감<br>③ 권역 대신 성 단위로 나누려면 예외 성 목록<br>④ 필리핀(권역 `10`)은 2단계 | 확정 회신(또는 콘솔에서 직접 수정 후 알림), 배정 확인에 경고 없음 | P0-S | 10/27 | G20 |
| WR-11 | **초대 수락 + 명단 보완** `v1.2`<br>\[일부\] | 초대를 받은 상담원 8명이 첫 로그인(초대 수락)을 해야 배정 대상이 됩니다. 특히 **South 팀은 활성 0명**이라 남부 호텔 문의가 팀에 가지 않습니다. 빠진 상담원이 있으면 이름 · 이메일 · 팀 · 업무 라벨(cs / sa) · 직급을 보내 주십시오 | 팀별 활성 상담원 1명 이상(배정 확인에 "활성 0명" 경고 없음) | P0-S | 10/27 | G21 |
| WR-12 | **상담카테고리 정의·베트남어 이름** `v1.2`<br>\[일부\] | Sales 키워드 대신 **고객이 위젯에서 직접 고릅니다**. Business Support / Customer Services를 각각 언제 고르는지(1 ~ 2줄)와 **베트남어 표시 이름**을 정해 주십시오. 위젯 카드에 그대로 보입니다. 더 나눌지(예: 정산 / 계약)도 결정 | 정의·베트남어 이름 회신(또는 콘솔 상담카테고리 관리에서 입력) | P0-S | 10/27 | G22 |
| WR-13 | **근무시간·부재 순서·기본 담당자** `v1.2` | 팀별 근무시간(타임존 HCM), 부재 시 순서(제안: 대체 담당자 → 팀 큐 → 오프라인 메시지). **기본 담당자**: 권역을 알 수 없을 때(**전체 호텔 선택**, 호텔 미선택, 권역 미매핑 성), **상담카테고리를 건너뛴 고객**, 맞는 규칙이 없는 문의를 받을 사람 | 회신 → SharpTalk 규칙 입력 후 미리보기 공유 | P0-S | 10/27 | G23 |
| WR-14 | **UAT 테스트 계정** | `Quản lý`(여러 호텔) 1개 + `Lễ tân`(호텔 1개) 1개. **북부·남부**를 포함해 권역이 다른 호텔 2곳 이상, 베트남어 성조가 있는 호텔명 1곳 이상 포함. `v1.2` \[일부\] 지금은 남부 Lá Hotel Quận 10 계정으로만 UAT 중 | 계정 전달(보안 채널) | P0-S | 10/27 | G13 |
| WR-15 | Notion 지식 소스 재연결<br>\[완료\] | `v1.2` HA 가이드 · FAQ · 호텔 등록 가이드 3개 소스가 10/22 다시 연결되어 동기화 정상입니다 | — | P0 | 10/30 | G30 |
| WR-16 | 지식 충돌 정리 결정 | 10/15 분류 78건(실제 수정 3, 정책 문서 2벌 3, FAQ 복제 32) 중 남길 쪽 결정 | 결정표 회신 | P1 | 11/06 | G31 |
| WR-17 | 골든 평가셋 검수 | `#Talk-4-Hotel` 44문항 정답 확인(엔진 교체·튜닝의 회귀 기준) | 검수 결과 회신 | P1 | 11/06 | G32 |
| WR-18 | 위젯 공개 범위·재개 창 확인 | 현재 기본값: 위젯은 본인 대화 + "이 호텔의 이전 문의 n건", 같은 상담원 우선 배정 24시간(고객이 상담카테고리를 고르면 규칙 우선) | 유지 / 변경 회신 | P1 | 11/06 | G14 · G15 |
| WR-19 | Zalo OA · ZNS 템플릿 | 상담원 알림을 Zalo로도 보낼 때 | 승인된 OA·템플릿 | P1 | 협의 | G24 |
| WR-19a | 상담원 알람 설정 `v1.2` | 각 상담원이 콘솔 🔔 › 설정에서 알람 범위(전체 / 내 배정만), 소리, **데스크톱 알림 허용**, 메일 수신을 정합니다. 브라우저 알림 권한을 허용해야 콘솔 탭이 가려져 있어도 알 수 있습니다 | 상담원별 설정 완료 | P1 | 10/30 | 신규 |


### 3.4 인프라 · Partner API 운영 전환


| WR | 작업 | 상세 | 완료 기준 | 우선 | 기한(제안) | 관련 |
|----|----|----|----|----|----|----|
| WR-20 | **운영 서버 + SSH + DNS + TLS** `v1.1` | `sharptalk.go2joy.vn`(10/23 현재 DNS 레코드 없음), 베트남 리전. 시범 4 vCPU / 8 GB / 80 GB, 운영 8 vCPU / 16 GB / 200 GB 이상. 일 1회 백업 저장소. **고정 공인 IP**(WR-23 화이트리스트용), **NTP 시간 동기**(Partner API `timestamp`가 5분 뒤 만료) | SSH 접속 정보 · 고정 IP 전달, DNS 응답 | P0 | 10/30 | G1 |
| WR-21 | **운영용 AI API 키(Go2Joy 명의·결제)** | 답변 LLM(Anthropic Claude 권장)과 임베딩(Voyage). 월 한도와 소진 알림 받을 담당자 | 키 전달(보안 채널) | P0 | 10/30 | G2 |
| WR-22 | 메일 발신 계정 | 담당자 알림 메일용 SMTP | 계정 전달 | P1 | 10/30 | G3 |
| WR-23 | **Partner API 운영 인증·자격증명·IP 허용** `v1.1` | 공개 문서의 운영 전환 절차는 인증 요청(약 1주) → 테스트 예약 3건(시간제·숙박·일일) → 운영 clientId · secret 발급 → 예약 3건 재확인입니다. **SharpTalk은 예약 API를 쓰지 않으므로** 예약 테스트 면제와 대체 확인(조회 API 연결 테스트)을 요청합니다. 운영 `https://partner.go2joy.vn`(한도 약 500회/분)에 SharpTalk 운영 서버 고정 IP 허용. 받으면 호텔 정보·객실·지역표 자동 갱신이 운영에서 켜집니다 | 인증 요청 접수 → 면제 여부 회신 → 자격증명 전달 · 연결 테스트 통과 | P0 | 접수 10/26 · 발급 11/02 목표 | G18 |


### 3.5 Go2Joy 개발 — Partner API 확인

Partner API 공개 문서(10/23 확인)와 스테이징 실측(10/21 ~ 10/23)이 다른 부분입니다. 회신만 필요하며, 수정 여부는 Go2Joy가 판단해 주십시오.


| WR | 확인 사항 | 문서 / 관찰 | 우선 | 관련 |
|----|----|----|----|----|
| WR-24 | Partner 스테이징과 HA UAT의 DB | 호텔 4118: Partner 객실 21개 / HA 7개, 요금·영업시간 다름. 운영은 같은 DB인가 | P1 | G19 ① |
| WR-25 | 객실 상태 코드 | 문서 `status`는 1 Available · 2 Locked뿐인데 실측에 1 · 4 · 5가 옴. 4 · 5의 의미, "승인 대기"·"임시저장" 코드 | P1 | G19 ② |
| WR-26 | 객실 수 | 문서상 `numOfRoom` 2147483647은 "확인 불가". 실측은 전부 이 값. 호텔별 총 객실 수(Number of rooms)를 줄 수 있는 필드가 있는가 | P1 | G19 ③ ⑥ |
| WR-27 | 권역 `10` `v1.1` | 문서 enum은 1 ~ 5인데 Province Feed가 마닐라 17개 시를 `10`으로 줌. 이름·의미, 앞으로 추가될 권역 값 목록. SharpTalk 지역 산출(1.1절)에 바로 영향 | P1 | G19 ⑤ |
| WR-28 | 시간제 조회 오류 | Room Type List `bookingType=1`이 `code 0`(Internal server error). 문서상 시간제는 `startTime` · `endTime` 필수라 SharpTalk 요청부터 재확인(S-09)하고, 재현될 때만 질의 | P2 | G19 ⑦ |
| WR-29 | Hotel Feed 범위·동작 | 문서상 `provinceSn` · `districtSn` 필수, `hotelSnList` 선택. HA 호텔 전체가 들어오는가(4118 없음), 일치하는 호텔이 없을 때 필터를 무시하고 전체를 반환하는 동작이 의도된 것인가 | P2 | G18 · G34 |
| — | Support Assistant API 문서 오기 | Hotel Info 경로 `getHotelnfo`(공개 문서는 `/api/v2/hotel/getHotelInfo`), Room Type Feed v1 경로에 v2 응답 예시 | P2 | G19 ⑧ |


### 3.6 법무


| WR | 작업 | 상세 | 완료 기준 | 우선 | 기한(제안) | 관련 |
|----|----|----|----|----|----|----|
| WR-30 | **개인정보·PDPL 확인** | 국외 이전 고지(수탁자 Anthropic · Voyage, 처리 지역), 영향평가(TIA) 필요 여부, 마스킹 범위, 대화 보존 기간(초안 180일), 침해 통지 절차 | 회신서 | P0 | 10/30 | G4 |
| WR-31 | **약관 URL·버전, AI 고지 문구 확인** `v1.2`<br>\[확인 요청\] | HA 로그인 사용자는 HA 약관 동의를 위젯 동의로 기록하고 동의 안내를 생략합니다. SharpTalk이 스테이징에 넣은 값: 약관 `https://go2joy.vn/vi-vn/policy?tab=terms-of-use`, 위젯 하단 고지 VI "Được tạo bởi AI, áp dụng **điều khoản dịch vụ**" / EN "Created by AI; apply **terms of service**"(굵은 부분이 약관 링크). 맞는 약관인지, **약관 버전**, 문구 승인 | 확인 회신(버전 포함) | P0 | 10/30 | G5 |


### 3.7 PM


| WR | 작업 | 상세 | 우선 | 기한(제안) | 관련 |
|----|----|----|----|----|----|
| WR-40 | **담당자·채널 확정** | PM, HA 백엔드·FE, 인프라, Partner API, 운영(CS 리드), 법무 담당자와 일일 점검 채널 | P0-S | 10/26 | G6 |
| WR-41 | 2단계 협의 일정 | B2C 예약 전·후, 예약 완료 Webhook, Go2Joy 앱·웹 임베드, HA 메뉴(iframe · SSO), 리셉션 에이전트 운영, 포인트 과금, Zalo 상담, 서비스 계약 조항 | P2 | 11월 | G40 ~ G47 · G7 |
| WR-42 | 사업자 상호·주소 필요 여부 `v1.1 신규` | v1.0에서 미결로 남은 항목입니다. **호텔 주소**는 SharpTalk이 Hotel Feed `address`로 직접 가져올 수 있어 HA가 보낼 필요가 없습니다(Feed에 없는 호텔 제외, WR-29). **사업자 등록 상호**가 콘솔에 필요하면 서명 키 추가를 2단계 규격(v1.5)으로 협의합니다. 그 전에는 보내지 않습니다(모르는 키는 401) | P2 | WR-41과 함께 | v1.0 8절 |


## 4. SharpTalk 작업 `v1.1`


| \# | 작업 | 시작 조건 | 소요 / 기한 | 우선 |
|----|----|----|----|----|
| S-01 | 가이드 v1.4 배포: 1절 규격, 변경 이력, PHP 예제(NFC 포함), 새 테스트 벡터 T1 ~ T6 `v1.3`<br>\[완료\] 10/24 — [공유 페이지](https://claude.ai/artifact/2An9WPgY9oCcs3PugiqXf8) · 저장소 `GUIDE-261024-Go2Joy-HA-Identify-v1.4` · PHP 8.3 + intl로 T1 ~ T6 교차 확인 | — | 10/26(월) | P0-S |
| S-02 | v1.4 수신: `province_sn` · 역할 코드 허용, Province Feed로 권역 산출, v1.3 키 전환 기간 허용 `v1.3`<br>\[완료\] 10/24 스테이징 — 성 번호 80개 색인, 실측(번호 → 성·권역, v1.3 값과 다르면 번호 우선, 모르는 번호 → 기본 담당자) | — | 10/27(화) 스테이징 | P0-S |
| S-03 | 스테이징 embed secret 보안 채널 전달 | WR-02 A안 | 당일 | P0-S |
| S-04 | 파트너 제공 secret 입력 기능(소규모 변경) | WR-02 B안 | 결정 후 일정 회신 | 조건부 |
| S-05 | `v1.2` 빠진 상담원 초대, 규칙 보완(중북부·중남부·central), 상담카테고리 베트남어 이름, 기본 담당자·근무시간 입력(또는 Go2Joy 입력 검토) → 배정 확인 결과 공유 | WR-10 ~ 13 | 당일 ~ 반나절 | P0-S |
| S-06 | 서명 검증 확인 후 "서명 없는 로그인 임시 허용" 종료. 성 이름 권역 보정은 전환 기간 동안 유지 | WR-01 · 04 · 05 | 당일 | P0-S |
| S-07 | Go2Joy 서버에 SharpTalk 설치(VN 프로필), go2joy 테넌트·지식·지역표·규칙 이관, 재색인, Partner 연결. 동기화는 운영 한도(약 500회/분) 안에서 실행 | WR-20 · 21 · 22 · 23 | 4일 | P0 |
| S-08 | 운영 embed secret 보안 채널 전달(스테이징과 다른 값) | WR-20 | WR-06 전 | P0 |
| S-09 | 시간제 조회 요청 재확인(`startTime` · `endTime` 포함) | — | 10/27 | P2 |
| S-10 | **secret 무중단 교체**: 교체 기간에 이전·신규 secret을 함께 허용하고, 기간이 끝나면 이전 값을 폐기. 교체 절차를 가이드에 추가 | — | 11/06 | P1 |
| S-11 | 약관 버전 입력(URL·고지 문구는 스테이징 입력 완료, 운영 이관 시 함께 옮김) | WR-31 | 당일 | P0 |
| S-12 | 지식 충돌 정리(Notion 재동기화는 확인 완료) | WR-16 | 1 ~ 2일 | P1 |


## 5. 일정과 의존 관계

``` tl
10/26(월)  WR-02 서명 키 결정 · WR-40 담당자 · WR-23 Partner 운영 인증 요청 접수
           SharpTalk: S-01 가이드 v1.4 · 테스트 벡터 배포
10/27(화)  WR-01 서명 엔드포인트 + T1~T6 · 역할 코드표 · WR-10~14 팀·명단·기준·계정
           SharpTalk: S-02 v1.4 수신 · S-03 secret 전달 · S-05 계정·규칙
10/28(수)  WR-04 FE 임베드 수정 → identify 200
10/29~30   WR-05 UAT 공동 점검 · WR-19a 상담원 알람 설정 · WR-20/21/22 운영 준비물
10/31(토)  스테이징 오픈 (HA UAT → SharpTalk 스테이징, 실제 상담원 응대)

운영 오픈 = 아래 세 가지가 모두 끝난 날
  ① WR-20 서버 수령 + S-07 설치 4일 + 운영 UAT 3일 (WR-30·31 필요)
  ② WR-23 Partner 운영 자격증명 (인증 약 1주)
  ③ WR-06 HA 운영 배포 (S-08 운영 secret 필요)
  → 전부 제안 일정대로면 가장 빠른 운영 오픈 11/10(화)
```

- 10/22 선행 기한이 지나 **10/31은 운영 오픈이 아니라 스테이징 오픈**입니다(PLN-261015 결정).
- WR-01이나 WR-04가 늦으면 스테이징은 서명 없는 임시 방식으로만 열 수 있습니다. 이 경우 실제 상담원 응대는 시작하지 않을 것을 권장합니다.
- WR-23 인증은 약 1주가 걸려 운영 일정의 주 경로입니다. 10/26에 접수해야 11/10이 가능합니다.
- `v1.2` WR-11이 늦으면 남부 호텔 문의는 기본 담당자에게만 갑니다.

## 6. 완료 판정

### 6.1 스테이징 오픈 (WR-05 체크리스트)


| 점검 | 기대 |
|----|----|
| 미로그인 상태에서 위젯 열기 | 현재와 같음: 게스트, 동의 안내 표시 |
| HA 로그인 → 위젯 열기 | identify **200**, `identified {ok: true}`, 동의 안내 없음, 인사말에 직원 이름, 콘솔 라이브챗 "검증됨" |
| 콘솔 › 고객 › 기업고객 | 호텔 1건(이름 · 성 · 권역 — 권역은 SharpTalk 산출), 연락처에 로그인 직원과 역할, 객실 유형이 호텔별 상품으로 |
| HA 언어 vi ↔ en 전환 | 서명 값이 그대로여서 같은 대화가 이어지고, 응답·버튼 언어만 바뀜 |
| 호텔 선택 변경 | 새 호텔로 기업고객·대화가 바뀜 |
| "전체 호텔" 선택 → 상담원 연결 | identify 200, 호텔 없음, WR-13 폴백 담당자에게 배정 |
| 권역 5개(north · north_center · central · south_center · south) 호텔에서 "상담원 연결" → 상담카테고리 bs / cs 각각 선택 `v1.2` | WR-10 규칙대로 팀 × 라벨 배정, 알람센터에 배정자·규칙 표시, 담당자 알람 |
| 상담카테고리 건너뛰기 `v1.2` | WR-13 기본 담당자에게 배정 |
| 콘솔 설정 › 상담원 연결 › 배정 확인 `v1.2` | 규칙 경고 없음("활성 0명" 해소) |
| 성조가 있는 호텔명(분해형 입력 포함) | 200 (NFC 정규화 확인) |
| email이 빈 직원 계정 | email 필드가 빠져 200 |
| 로그아웃 · 세션 만료 · 다른 계정으로 로그인 후 위젯 | 게스트(또는 새 계정), 이전 직원의 이름·대화 안 보임 |
| **서명 대상 값**(`userId` 또는 attributes 중 하나)을 재서명 없이 수정 | 401 E5048, `ok: false`, 게스트. `name` · `email` · `phone`은 서명 대상이 아니므로 바꿔도 200이 정상 |


통과하면 SharpTalk은 스테이징의 "서명 없는 로그인 임시 허용"을 끕니다(S-06).

### 6.2 운영 오픈


| 점검 | 기대 |
|----|----|
| 운영 HA 로그인 → 위젯(`sharptalk.go2joy.vn`) | identify 200(운영 secret), 6.1의 핵심 항목 재확인 |
| 스테이징 secret으로 서명한 패키지를 운영에 전송 | 401 (환경 분리 확인) |
| Partner API 운영 연결 | 호텔 정보 · 객실 · 지역표 갱신 성공, 오류 코드 6(서명) · 8(IP) 없음 |
| 약관 · 고지 | 동의 기록에 WR-31의 HA 약관 URL·버전이 남음 |


## 7. 참고 — Partner API 핵심 (공개 문서, 10/23)


| 항목 | 내용 | SharpTalk 반영 |
|----|----|----|
| 환경 | 스테이징 `staging-partner.go2joy.vn`(약 250회/분) · 운영 `partner.go2joy.vn`(약 500회/분) | 동기화 속도 제한 |
| 인증 | `Authorization` = hex(HMAC-SHA256(client secret, URL + "\|" + JSON 본문)), 본문에 `clientId` · `timestamp`(5분 만료), IP 화이트리스트 | WR-20 NTP · 고정 IP |
| 언어 | `Localization` 헤더 `vi` / `en`(기본 en) | 위젯 선택 언어로 조회 |
| 권역 | Province Feed `region`: 1 South · 2 North · 3 Central · 4 North Central · 5 South Center | 1.1절 산출표 |
| 호텔 → 성 | Hotel Feed `provinceSn` · `address`. Hotel Info에는 성 정보 없음 | HA가 `province_sn`을 보내는 이유(Feed 누락 호텔 대비) |
| 오류 코드 | 본문 `code` 0 서버 오류 · 1 성공 · 2 실패, error 6 서명 오류 · 8 미인가(IP) · 12 과다 호출 | 운영 모니터링 알림 |


## 8. 회신표

아래 표를 채워 일일 점검 채널로 보내 주십시오.


| WR | 우선 | 담당자 | 가능 일자 | 상태(진행 / 완료 / 보류) | 메모 |
|----|----|----|----|----|----|
| WR-01 | P0-S |  |  |  |  |
| WR-02 | P0-S |  |  |  | A안 / B안 |
| WR-03 | P1 |  |  |  |  |
| WR-04 | P0-S |  |  |  |  |
| WR-05 | P0-S |  |  |  |  |
| WR-06 | P0 |  |  |  |  |
| WR-10 | P0-S |  |  |  |  |
| WR-11 | P0-S |  |  |  |  |
| WR-12 | P0-S |  |  |  |  |
| WR-13 | P0-S |  |  |  |  |
| WR-14 | P0-S |  |  |  |  |
| WR-15 | P0 |  |  | 완료 |  |
| WR-16 | P1 |  |  |  |  |
| WR-17 | P1 |  |  |  |  |
| WR-18 | P1 |  |  |  | 유지 / 변경 |
| WR-19 | P1 |  |  |  |  |
| WR-19a | P1 |  |  |  |  |
| WR-20 | P0 |  |  |  |  |
| WR-21 | P0 |  |  |  |  |
| WR-22 | P1 |  |  |  |  |
| WR-23 | P0 |  |  |  | 예약 테스트 면제 여부 |
| WR-24 ~ 29 | P1 / P2 |  |  |  |  |
| WR-30 | P0 |  |  |  |  |
| WR-31 | P0 |  |  |  |  |
| WR-40 | P0-S |  |  |  |  |
| WR-41 | P2 |  |  |  |  |
| WR-42 | P2 |  |  |  | 필요 / 불필요 |

