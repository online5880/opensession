# 테스트 가이드

**[영어](TESTING.md) | [한국어](TESTING.ko.md)**

## 1) 로컬 테스트 구성

프로젝트 루트에서 다음 명령을 실행합니다:

- `npm test` — 단위/호환성 테스트 실행 (`test/*.test.js`)
- `npm run e2e` — E2E 스모크 테스트 실행 (`e2e/*.test.js`)
- `npm run lint` — 런타임 JS 파일 구문 검사

## 2) 실행 환경

- Node.js 18 이상
- 네트워크는 원칙적으로 필수가 아닙니다. 테스트는 외부 Supabase를 직접 호출하지 않습니다.
- 외부 호출이 필요한 별도 스크립트를 직접 실행하지 않는 한 테스트는 임시 파일과 모킹(mock) 기반으로 동작합니다.

## 3) 단위/호환성 테스트

`npm test`는 다음 파일을 실행합니다:

- `test/cli-compatibility.test.js` — CLI 도움말/호환성 플래그 확인
- `test/config-secrets.test.js` — 비밀값 암호화 저장 및 복호화 동작 확인
- `test/idempotency.test.js` — 재시도 안전성을 위한 idempotency 유틸 동작 확인
- `test/supabase-append-event.test.js` — Supabase append 동작과 충돌 처리 검증

### 기대 동작

- 실패 시 비정상 종료 코드(0 이 아닌 값) 발생
- 성공 시 표준 Node 테스트 결과가 출력되고 `0` 종료 코드로 종료

## 4) E2E 테스트

`npm run e2e`는 다음 파일을 실행합니다:

- `e2e/cli-e2e.test.js` — 임시 HOME를 이용한 CLI 기본 경로/명령 검증
- `e2e/viewer-e2e.test.js` — 읽기 전용 뷰어 시작 후 `/health` 응답 검증

### 참고

- 뷰어 E2E는 임시 포트를 자동으로 할당해 실행합니다.
- 로컬 환경 부하가 큰 경우 간헐적으로 실패할 수 있으므로 재실행으로 다수 해결됩니다.

## 5) 권장 검증 순서

변경 후 아래 순서로 실행합니다:

1. `npm run lint`
2. `npm test`
3. `npm run e2e`

세 단계가 모두 통과하면 PR 단계의 기본 검증을 통과한 것으로 봅니다.

## 6) 관련 문서

- [README.md](README.md)
- [README.ko.md](README.ko.md)
