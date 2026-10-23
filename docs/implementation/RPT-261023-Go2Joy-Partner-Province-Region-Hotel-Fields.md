# RPT-261023 — Go2Joy Partner: 성·권역 자동 갱신 + 권역 교정 + 호텔·객실 누락 필드

- 근거: [REQ](../analysis/REQ-261023-Go2Joy-Partner-Province-Region-Hotel-Fields.md) · [PLN](../plan/PLN-261023-Go2Joy-Partner-Province-Region-Hotel-Fields.md)(D1~D4 권장안 승인 2026-10-23) · [TCR](../test/TCR-261023-Go2Joy-Partner-Province-Region-Hotel-Fields.md)
- 계기: Go2Joy **Support Assistant API** 문서(<https://dev.go2joy.vn/api-integration-document-support-assistant-api>) 대조 — 사용자 인증은 추가 없음(사용자·역할 API 부재 → HA 서명 identify 유지), 호텔 정보 3건 추가

## 1. 변경
| # | 내용 |
|---|---|
| H1-a | Province Feed → `handoff_config.provinceRegions` 병합(같은 성 API 값·철자, 없는 항목 유지, 빈 목록·실패 미저장, AI 설정 행 없으면 미생성) + `provinceRegionsSyncedAt`·`provinceRegionsSource`. 일일 스윕(호텔 동기화 앞, 같은 env 주기) + `GET /companies/province-regions` · `POST /companies/province-regions/sync`(CUSTOMER_MANAGE, 감사 `go2joy.province_regions_synced`). 권역 10 → `region_10` |
| H1-b | `storedIdentityAttributes`: 권역이 아닌 region(`isRegionValue` 거짓)이 지역표 성과 같으면 성으로 보고 권역 교정, province 비면 채움, 출처 `province_in_region`. embed는 그런 region이 오면 지역표를 읽음 |
| H1-c | `CompanyService.fillRegion` — identify·프로필 수정 시 권역이 비면 성으로 채움. `backfill-company-regions`(dry-run 기본, `--apply`) |
| H2 | `CompanyPartnerInfo.cancelBeforeHours`·`rightNowTonight` → 호텔 상세 "지금/오늘 밤"·"취소 시한", 라이브챗 호텔 카드 "취소: 예약 n시간 전까지" |
| H3 | 객실 `attributes.views`(v2 `viewList`) → 상품 객실 상세 "전망". 빈 시설 행 제거 |
| 화면 | 설정 › 플랫폼 연동 › Go2Joy Partner 카드: "지역표: N개 성 · 시각 갱신 (Go2Joy)/수동 등록" + [지역표 갱신](CUSTOMER 권한자만). i18n 6개 언어 |
| 문서 | GUIDE-261022 G18(운영 전환 예약 3건 절차 적용 여부)·G19 ⑤~⑧(권역 10 이름, numOfRoom, 시간제 code 0, 문서 오기) |

### 파일
- API: `go2joy/province-region.mapper.ts`(+spec) · `go2joy/province-region-sync.service.ts`(+spec) · `go2joy/go2joy.module.ts` · `go2joy/scheduled-hotel-sync.service.ts` · `go2joy/room-type.mapper.ts`(+spec) · `company/company.controller.ts` · `company/company.service.ts`(+spec) · `company/company.module.ts` · `company/entity/company.entity.ts`(JSON 타입) · `embed/identity-attributes.ts`(+spec) · `embed/embed.service.ts`(+spec) · `ai-engine/entity/tenant-ai-config.entity.ts`(JSON 타입) · `database/backfill-company-regions.ts`
- types: `packages/types/src/common/region.ts` `isRegionValue`
- Web: `settings/Go2JoyPartnerCard.tsx`(신규) · `settings/ConnectedPlatformCard.tsx`(body/extraActions) · `settings/SettingsPlatformsPage.tsx` · `customers/{customers.service,customers.hooks,CompanyDetailModal}` · `live-chat/{HotelCard,live-chat.service}` · `products/{ProductDetailModal,products.service}` · locales customers/livechat/products × 6

## 2. 테스트
- 로컬: API jest 252 suites / 2,547 통과 · typecheck api·web · `i18n:check` complete · 실제 부팅(DB_SYNCHRONIZE=false) + 새 경로 401
- CI: PR #710 `typecheck · test · build` pass(2m45s)
- 스테이징(2026-10-23 17:14~17:17 KST, go2joy tenant 4):

| TCR | 결과 |
|---|---|
| I1·I2 | 동기화 전 `63개 · 출처 없음` → [지역표 갱신] API `total 80 · added 17 · changed 0 · kept 0`(정적표 63개는 피드와 동일) → 카드 "지역표: 80개 성 · 10/23 5:14:51 PM 갱신 (Go2Joy)" 확인. handoff 키 `sla·routingRules·assigneeUserIds` 유지 |
| I3 | 보정 dry-run `company 4 (hotel:4118) '' → south` 1건 → `--apply` 1건 |
| I4 | HA UAT(Lá Hotel Quận 10) 위젯 재접속 → identify 로그 `region province_in_region`, 새 세션 20821 `{region: south, province: Hồ Chí Minh}` |
| I5 | 4118 [동기화] → `cancelBeforeHours 1`, `rightNowTonight 0–6`; 상세 모달 "지금/오늘 밤 0–6시 (숙박)"·"취소 시한 예약 시각 1시간 전까지"·헤더 "남부" |
| I6 | 라이브챗 대화 887 호텔 카드 "취소: 예약 1시간 전까지" |
| I7 | 객실 21개 중 전망 있는 4개(예: Junior Room `Window (Non-view) · City`, Phòng Đơn `Garden`) — API 응답 확인 |

## 3. 배포 상태
| 환경 | 상태 |
|---|---|
| PR | #710 → main `68c42bb6` (squash) |
| 스테이징 | 배포 `68c42bb6`(10/23 17:13 KST), healthy·부팅 로그·새 경로 401. SQL 없음. 지역표 갱신·보정 `--apply` 완료 |
| 프로덕션 | 배포 `68c42bb6`(10/23 17:19 KST) — 백업 `~/backups/sharptalk-production/20261023-1918-pre-261023-partner-region`(서버 시각), SQL 없음, check-migrations OK, healthy·부팅 로그·새 경로 401. 보정 dry-run **0건**(고객사 0) → `--apply` 생략. 프로덕션은 Partner 자격증명 0건·**지역표(`provinceRegions`) 미설정 테넌트뿐** → H1-a·H2·H3 무동작, H1-b·c도 지역표가 생길 때까지 무동작 = 동작 불변 |

## 4. 남은 것 / 주의
- 권역 `10` 이름(G19⑤) 회신 후 카탈로그 코드·번역 추가 — 그때까지 규칙·담당 지역에서 `region_10` 그대로.
- [AI 설정 › 인계]를 지역표 갱신 전에 열어 둔 화면에서 저장하면 그 시점 지역표로 덮일 수 있음 → 다음 일일 동기화가 복구(E3).
- 스테이징 go2joy 규칙(North-1)은 권역 배정을 쓰지 않아 지금 배정 결과는 바뀌지 않음. 권역 배정 규칙을 켜면 `hồ_chí_minh`였던 HA 세션이 남부 담당자에게 감.
- 실시간 판매 현황(Room Type List v2, H4)은 AI 근거 답변 후속에서 설계.
