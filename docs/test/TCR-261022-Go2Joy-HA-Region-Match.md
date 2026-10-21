# TCR-261022 — go2joy HA 1단계: 지역·성 정규화 · 유닛/라벨 담당 지역 · 지역 매칭 배정

- 근거: [PLN-261022 §2](../plan/PLN-261022-Go2Joy-HA-B2B-Identity-Continuity.md) (1-1 ~ 1-14)
- 브랜치: `session/go2joy-region-match` (main `9321406` 기준)
- 실행 일시: 2026-10-22 (로컬)

## 1. 단위 테스트
| ID | 대상 | 케이스 | 결과 |
|---|---|---|---|
| U-1 | `region.ts` `canonicalRegion` | `North Center`·`south center`·`North Central`·`south-central`·`SOUTH` → 코드, 카탈로그 5종 자기 자신, 카탈로그 밖 값은 접어서 보존, 빈 값·비문자열 → `''` | 통과 |
| U-2 | `region.ts` `provinceKey` | NFC = NFD, 공백·대소문자 무시 | 통과 |
| U-3 | `resolveRegionAssignees` | 권역 매칭, `North Center` 텍스트 매칭, 성이 권역보다 우선, NFD 성 입력, 성 담당자 없으면 권역으로, 라벨·유닛 필터 교집합, 담당자 없음 → `none`, 대상 없음 → 빈 목록, `byRegion`만으로도 그룹 | 통과 |
| U-4 | `RoutingAssigneeService.resolveDetailed` | 유닛 범위 + 라벨 필터, **라벨 범위가 유닛 범위를 확장**(HCM 소속 + north_center 백업 라벨), 성 우선·NFD, 아무도 없음 | 통과 |
| U-5 | `HandoffRouterService` | 지역 규칙이 세션 `{region, province}`를 넘기고 담당자 호출, 0명 → 다음 규칙, `byRegion`만 있는 규칙도 매칭 대상, 규칙 `regions`·세션 값 정규화 비교 | 통과 |
| U-6 | 기존 라우터 스펙 | 고정 유닛 × 라벨 그룹(resolveDetailed 호출 인자 갱신), 0명 skip, 합집합, 리졸버 없음 | 통과 |
| U-7 | `identity-attributes` | **GUIDE v1.2 테스트 벡터 T1~T5 해시 고정**, NFD는 다른 해시(정규화는 검증 뒤에만) | 통과 |
| U-8 | `storedIdentityAttributes` | NFC·권역 코드화, 성 매핑으로 권역 채움(NFC·대소문자 무시 키), 서명 권역과 매핑 불일치 → 서명 값 유지 + mismatch, 매핑 없음·미등록 성·속성 없음 | 통과 |
| U-9 | `EmbedService.identify` | 성만 서명 → 매핑으로 `south_center` 저장, NFD+`South`로 서명 → 검증 통과 후 NFC·`south` 저장, 성 없으면 매핑 조회 안 함 | 통과 |
| U-10 | `UserService` | 유닛 담당 지역 설정(이름 유지, 코드 정규화·중복 제거, 성 NFC·중복 제거, `unit.scope_changed` 감사), 빈 배열 → NULL, 생략 필드 불변, 라벨 담당 지역 설정 | 통과 |

**전체**: `packages/types` 186개 통과 · `apps/api` 241 스위트 / 2,398개 통과 · `apps/api` `tsc --noEmit`·`nest build` 통과 · `apps/web` `tsc`·`vite build` 통과 · `npm run i18n:check` 6개 언어 complete.

## 2. 로컬 통합 (API :3099 `DB_SYNCHRONIZE=false` + `sql/261022-unit-label-regions.sql` 적용, web :5199)
| ID | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| I-1 | 엔티티 변경 후 실제 부팅 | `Nest application successfully started` | 통과 |
| I-2 | `PATCH /units/:id` `regions:[north,north_center,north]`, `provinces:[Đà Nẵng(NFD), " đà  nẵng ", Hà Nội]` | `regions [north, north_center]`, `provinces [Đà Nẵng, Hà Nội]` | 통과 |
| I-3 | `PATCH /units/:id` `regions:["North Center"]` | 400 `E5003`(카탈로그 값만) | 통과 |
| I-4 | `PATCH /job-labels/:id` `regions:[south_center]` | 응답에 반영 | 통과 |
| I-5 | 라벨·팀 관리 모달 › 팀 탭 › [지역 설정] | 권역 칩 5개·성 칩·입력(자동완성), 행 아래 요약 "중남부 · 남부 / Đà Nẵng" | 통과(캡처) |
| I-6 | 설정 › 기본 › 배정 규칙 › [지역 담당자에게 배정] | 권역별 후보 수, 0명 권역 경고 "담당자 없음 → 다음 규칙", 성 담당 표시 | 통과(캡처) |
| I-7 | 서명 identify `{hotel_id, province: Đà Nẵng}`(권역 없음) → 상담원 연결 | 로그 `region map` → `match=province` 담당자 1명 | 통과 |
| I-8 | 서명 `region: "South"`(텍스트), 성 Cần Thơ(담당 없음) → 상담원 연결 | `region signed`, `region south`, `match=region` | 통과 |
| I-9 | 서명 `region: north`(담당 유닛 없음) → 상담원 연결 | `resolved to no active agent — skipped` → 다음 규칙 | 통과 |
| I-10 | 성 → 권역 SQL(`scripts/go2joy/province-regions-sql.mjs`) 트랜잭션 실행 | 63개, `Thừa Thiên Huế = north_center`, 기존 규칙 유지, 롤백 후 원상 | 통과 |

로컬 데이터(테넌트 1 배정 설정·유닛 담당 지역·임베드 시크릿·테스트 대화)는 검증 후 원래 값으로 되돌렸다.

## 3. 스테이징 통합 (배포 후)
| ID | 시나리오 | 기대 |
|---|---|---|
| S-1 | SQL 선적용 → `check-migrations.sh` | 미적용 0 |
| S-2 | 배포 후 부팅 로그·`PATCH /units/:id` 401(미인증) | 배포 확인 |
| S-3 | go2joy(테넌트 4) 성 → 권역 매핑 등록, 팀 North / North Center / South / South Center에 담당 권역 지정 | 콘솔 표시 |
| S-4 | 지역 매칭 규칙(CS) 작성 후 서명 identify(T2 south / T3 north_center / 성만 Đà Nẵng) → AI 이관·"상담원 연결" | 권역 담당 팀 배정, 로그 `match=` |
| S-5 | 테스트 후 규칙·매핑 정리(또는 Go2Joy 확정안으로 교체) | — |

## 4. 엣지 케이스 메모
- 성 매핑 키는 NFC·대소문자를 무시하고 비교한다. 지역표에 없는 성(예: 통폐합 후 신 명칭)은 권역 없음 → 폴백 규칙.
- 담당 지역이 비어 있는 유닛·라벨은 지역 매칭 후보가 되지 않는다(고정 그룹으로는 계속 사용 가능).
- 규칙 편집기에서 카탈로그 밖 저장 값은 "기타: 값 ×" 칩으로 보이며 지워야만 사라진다(조용히 버리지 않음 — 이전에는 `north/central/south` 밖 값을 불러올 때 버렸다).
