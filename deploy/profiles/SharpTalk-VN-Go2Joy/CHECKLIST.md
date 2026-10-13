# SharpTalk-VN-Go2Joy — 세팅 체크리스트

가이드: `docs/guide/GUIDE-260913-SharpTalk-VN-Go2Joy-Staging.md` (절 번호는 그 문서 기준)

## 결정 (값을 적고 secrets 파일에 반영)
- [ ] 호스트·클라우드·리전(베트남 내): 
- [ ] 도메인(한 오리진): talk-vn.<DOMAIN> → 
- [ ] TLS 종단 방식: 
- [ ] 백업 저장소(국내): 
- [ ] 요금제(starter 유지 / growth / custom): 
- [ ] 현지 법무·DPO 연락처: 
- [ ] 보존 기간(처리방침과 동일): 

## 선행 코드 갭 (별도 REQ) — 프로덕션 전 필수
- [ ] G1/G2 테넌트 기본 언어 vi
- [ ] G3 핸드오프 타임존 목록 Asia/Ho_Chi_Minh
- [ ] G6 베트남 전화 PII 패턴
- [ ] G7 AI 국외이전 고지 문구
- [ ] G10 INCIDENT-RESPONSE PDPD 행
- [ ] (G11) 시드 KB 제거 — §6에서 삭제로 우회

## 설치 (§1~§4)
- [ ] 서버 사양·UTC·Docker 24+·egress 허용
- [ ] `cp deploy/profiles/SharpTalk-VN-Go2Joy/.env.SharpTalk-VN-Go2Joy.example docker/self-hosted/.env.self-hosted` → `<DOMAIN>` 치환
- [ ] `bash scripts/gen-secrets.sh` → 붙여넣기
- [ ] `bash scripts/deploy-self-hosted.sh --check` 통과 (번들 설치: `--bundle . --dry-run`; 런북 §3~§4)
- [ ] 시드 env(`SEED_TENANT_SLUG/NAME/DOMAIN`, `SEED_ADMIN_EMAIL`, `SEED_MASTER_EMAIL`) 채움 — Amoeba 테넌트·계정이 생기지 않게
- [ ] `bash scripts/deploy-self-hosted.sh` → 헬스 ok
- [ ] `SEED_ON_BOOT=false`로 변경 → API 재생성
- [ ] Basic §9 스모크

## 어드민 초기화 (§5)
- [ ] AI 엔진 등록·활성
- [ ] 테넌트 go2joy 생성(도메인 app.go2joy.vn 가정), 요금제·제공 메뉴·애드온
- [ ] master/director 초대
- [ ] 시드 테넌트 확인: 위 시드 env를 썼다면 `go2joy`만 존재, 아니면 `ivyusa` 정지/삭제

## 테넌트 이관 (§6)
- [ ] 타임존 Asia/Ho_Chi_Minh → 설정 12항목 수동 입력(스냅샷 대조)
- [ ] 위젯 문구 vi/en
- [ ] 커스텀 위젯 패키지 가져오기 → 사용함
- [ ] KB: 카테고리 → 일괄등록 → Notion 재연결·동기화 → 재색인 확인 → 시드 KB 삭제
- [ ] 자격증명 재입력(Notion·Haravan·AmoebaTalk) → 연결 테스트 → 동기화 1회 건수 확인
- [ ] 임베드 오리진·시크릿 재발급 → Kotlin SDK 설정 갱신
- [ ] 핸드오프(ICT), 개인정보 URL·동의 버전, AI 설정

## 베트남 커스터마이징 (§7)
- [ ] PDPD 동의·국외이전 고지 문구 확정
- [ ] 국외이전 영향평가 서류, PROCESSOR-REGISTER 갱신
- [ ] vi 원어민 검수
- [ ] 모바일 SDK 실기기 스모크, Zalo E2E

## 운영 (§8)
- [ ] 백업 타이머(`docker/self-hosted/ops/`)·암호화 키 보관·`BACKUP_KEEP_DAYS`, 복원 리허설 분기 1회(`restore-drill-self-hosted.sh`) 캘린더
- [ ] 런북 `RUNBOOK-261013-Go2Joy-SelfHosted.md` 검토 + 연락처(§10.4) 채움 + CRED_ENC_KEY 보관자 2인 지정(§12)
- [ ] 모니터링(health·디스크·Notion 동기화·허브 폴링)
