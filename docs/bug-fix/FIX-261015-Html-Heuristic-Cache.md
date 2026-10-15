# FIX-261015 HTML이 브라우저 휴리스틱 캐시로 남아 새 페이지 대신 콘솔 홈이 열림

## 증상
`https://shoptalk.amoeba.site/manual/go2joy`를 열면 Go2Joy 문서 목록 대신 콘솔 홈으로 이동했다(사용자 보고, 2026-10-15 #646 배포 직후). curl·헤드리스 브라우저로는 정상(301 → `/manual/go2joy/` 200, 문서 목록)이었다.

## 원인 (로그 근거)
- 스테이징 web 컨테이너 접근 로그: 사용자 Chrome 154가 08:36:09에 `GET /manual/go2joy` → 301을 받은 뒤, **`/manual/go2joy/` 요청을 서버로 보내지 않았다.** 브라우저 캐시에서 응답을 꺼냈다는 뜻이다.
- 배포 전에는 `/manual/go2joy/`가 없어 SPA 폴백으로 콘솔 `index.html`(200)이 나갔다. 이 URL은 배포 전 진행 안내 메시지에 이미 적혀 있었다.
- web nginx는 HTML에 `Cache-Control`을 붙이지 않는다. 그러면 브라우저가 `Last-Modified`로 신선도를 추정해(휴리스틱 캐시) 재검증 없이 재사용한다. 캐시된 SPA 껍데기가 알 수 없는 경로라 홈으로 라우팅했다.
- 같은 원인으로 콘솔도 배포 직후 이전 `index.html`(이전 해시 자산 참조)을 쓸 수 있었다(잠재 결함).

## 수정
`docker/staging/nginx.web.conf`, `docker/self-hosted/nginx.web.conf`
- `map $sent_http_content_type $html_cache_control` — `text/html`이면 `no-cache`, 그 외는 빈 값(헤더 없음).
- 서버 블록에 `add_header Cache-Control $html_cache_control always;` — 서버 수준이라 기존 보안 헤더와 함께 상속되고, `/assets/`(자체 `add_header`가 있는 location)는 기존 1년 immutable 그대로.

## 검증
- 로컬 `nginx:1.27-alpine`에 같은 설정: `/manual/go2joy` 301·`/manual/go2joy/`·`/live-chat`(SPA) → `Cache-Control: no-cache`, 이미지 → 헤더 없음, `/assets/*.js` → `public, immutable` 유지, 보안 헤더 유지.
- 스테이징 배포 후 같은 4경로 헤더 확인(RPT/PR 본문).

## 사용자 조치
이미 캐시된 브라우저는 한 번 강력 새로고침(⌘⇧R / Ctrl+F5)하거나 `/manual/go2joy/index.html`로 열면 된다. 이후 방문은 매번 서버에 재검증하므로 재발하지 않는다.

## 예방 패턴
- **새 경로를 배포 전에 안내하지 않는다.** 없는 경로는 SPA 폴백 200을 돌려주고, 그 응답이 캐시된다.
- 정적 HTML을 내보내는 nginx는 HTML에 `Cache-Control: no-cache`를 명시한다(해시 자산만 장기 캐시).
- "curl은 정상인데 사용자만 다르다"면 접근 로그에서 **뒤따라야 할 요청이 빠졌는지** 본다. 빠졌다면 브라우저 캐시다.
