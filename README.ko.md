# My AI Office

[English README](README.md) · [개발 과정](docs/DEVELOPMENT.ko.md) · [아키텍처](docs/ARCHITECTURE.md) · [보안](docs/SECURITY.md)

My AI Office는 Codex의 작업 이벤트를 개인정보 노출을 최소화해 수집하고, 프로젝트와 기능 담당 AI의 상태를 단순한 평면 사무실로 보여주는 로컬 대시보드입니다. 프로젝트는 방, AI 작업자는 직원, 동시 협업은 같은 테이블에 모인 회의로 표현됩니다.

![공개용 데모 데이터로 실제 실행한 My AI Office](docs/screenshots/dashboard-demo.png)

아래 화면은 공개용 가상 이벤트를 로컬 API에 입력해 실제 라이브 모드로 실행한 결과입니다.

![공개용 가상 이벤트를 사용한 My AI Office 라이브 모드](docs/screenshots/dashboard-live-sanitized.png)

## 확인할 수 있는 정보

- 진행 중인 Codex 프로젝트를 한 화면의 사무실 맵으로 표시
- 세션·지시·종료 기록뿐인 단순 채팅은 숨기고 도구·서브에이전트·승인 작업이 시작된 프로젝트만 표시
- 24시간 동안 활동이 없는 프로젝트는 숨기고 새 작업이 오면 자동 복귀
- 메인 에이전트와 기능별 서브에이전트를 프로젝트별로 배치
- 작업 중, 협업 중, CEO 승인 대기, 대기, 오래된 상태 구분
- 1.5초 간격으로 갱신되는 장기 업무 활동 요약
- 사무실 맵 선택과 독립된 우측 활동 프로젝트 선택기
- 같은 프로젝트에서 둘 이상이 작업하면 협업 테이블로 자동 그룹화
- `default` 같은 프레임워크 이름 대신 안전한 역할·도구 정보로 기능 담당 이름 표시
- 완료 직원은 15초 동안 인계 상태를 보여준 뒤 방에서 퇴장하고 완료 기록은 최근 활동에 유지
- 30분 동안 활동이 없는 직원은 유령 직원 정리 대상으로 방에서 퇴장하고 다음 이벤트에 자동 복귀
- 반복되는 도구 시작·완료 이벤트는 직원·업무 범주별 10분 흐름의 기능 활동 카드 하나로 요약
- 일반 활동 중에는 프로젝트 방 위치를 고정하고 프로젝트 생명주기 변화에만 최소 재배치
- 이벤트가 없을 때 실제 이벤트와 구분되는 데모 상태 제공
- CEO 지시, 직원별 배정, 진행 단계, 협업, 검증, 인계를 하나의 한국어 업무 흐름으로 연결
- 로컬에서 명시적으로 켠 경우에만 마스킹된 지시·협업·서브에이전트 인계 내용을 표시하고, 암호문·식별자·변환할 수 없는 영문은 한국어 안전 문구로 대체

## Windows 빠른 설치

필수 환경:

- Windows 10 또는 11
- Node.js 20 이상
- `py` 런처로 실행할 수 있는 Python 3
- 사용자 훅을 지원하는 Codex 버전

```powershell
git clone https://github.com/byStander9/my-ai-office.git
cd my-ai-office
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

설치 스크립트는 의존성 클린 설치, 전체 테스트, 빌드, 개인정보 최소화 이벤트 수집기 설치, 기존 Codex 사용자 훅과의 병합, 현재 사용자의 Windows 시작프로그램 등록을 수행합니다. 기존 훅 파일은 수정 전에 자동 백업합니다.

구체적인 지시·협업 내용 수집은 기본적으로 꺼져 있습니다. 이 PC에서 로컬 상세 기록을 명시적으로 켜려면 설치할 때 다음 옵션을 추가합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -EnableDetailedActivity
```

이후 상세 기록을 끄려면 `-DisableDetailedActivity`를 사용합니다. 두 옵션 없이 다시 설치하면 기존 선택을 유지합니다. 이미 저장된 상세 내용은 로컬 이벤트 파일이 회전되거나 데이터가 명시적으로 제거될 때까지 남습니다. 임시 실행에서는 `AI_OFFICE_CAPTURE_DETAILS=1` 환경 변수로 해당 훅 프로세스의 수집을 켤 수도 있습니다.

설치 후 Codex에서 `/hooks`를 실행하고 사용자 훅의 정확한 명령을 검토한 뒤 신뢰하세요. 훅 내용이 바뀌면 다시 검토해야 할 수 있습니다. 대시보드는 [http://127.0.0.1:4175/](http://127.0.0.1:4175/)에서 열리며, 이후 로그인할 때 터미널 창 없이 자동 실행됩니다.

## 훅 설치 없이 데모 실행

```powershell
npm ci
npm run office
```

이미 빌드한 대시보드를 터미널에서 직접 실행하려면 다음 명령을 사용합니다.

```powershell
npm run start:office
```

## 제거

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows.ps1
```

이벤트 데이터는 기본적으로 보존됩니다. 로컬 AI Office 이벤트 디렉터리까지 삭제하려는 경우에만 `-RemoveData`를 추가하세요.

## 선택 사항: 비공개 원격 확인

서버는 의도적으로 `127.0.0.1`에만 바인딩됩니다. 본인 기기 사이에서 원격으로 확인하려면 Tailscale Serve로 localhost 서비스를 Tailnet 내부에만 연결할 수 있습니다.

```powershell
tailscale serve --bg http://127.0.0.1:4175
tailscale serve status --json
tailscale funnel status --json
```

Funnel은 활성화하지 마세요. 생성된 `https://<device>.<tailnet>.ts.net/` 주소도 저장소에 커밋하지 마세요. Tailscale HTTPS 인증서를 사용하면 장치명과 Tailnet DNS 이름이 공개 인증서 투명성 기록에 포함될 수 있으므로 민감하지 않은 장치명을 먼저 사용해야 합니다.

Serve 해제:

```powershell
tailscale serve --https=443 off
```

정적 웹 호스팅은 데모 UI만 보여줄 수 있고 사용자 PC의 비공개 이벤트 파일을 읽을 수 없습니다. 실시간 상태에는 로컬 Node 서버가 필요하며, 원격 상태에는 PC와 비공개 네트워크 경로도 계속 켜져 있어야 합니다.

## 개인정보 보호 범위

이벤트 수집기는 허용 목록 방식으로 동작합니다. 기본값에서는 프롬프트, 명령, 도구 입출력, 파일 내용, 자격 증명, 전체 작업 경로, 원본 세션·턴·직원·도구 실행 ID를 저장하지 않습니다. 로컬 상세 기록을 명시적으로 켠 경우에만 사용자 지시, 허용된 협업 메시지와 배정 정보, `SubagentStop`의 최종 인계 메시지에서 짧게 마스킹한 한국어 안전 요약만 추가 저장합니다. 셸·패치 입력, 임의 도구 응답과 전체 대화 기록은 저장하지 않습니다. 브라우저 API에서는 허용 목록·마스킹을 다시 적용하고, 한국어 표시 정규화를 거쳐 암호문이나 변환하지 못한 영문 원문을 작업 설명으로 반환하지 않습니다.

마스킹은 최선의 보호 조치이지 완전한 보장을 뜻하지 않습니다. 서비스는 localhost에 유지하고, Tailscale 접근을 허용한 사람은 상세 내용도 볼 수 있다는 점에 주의하세요. 수집 필드는 [OpenAI Codex Hooks 공식 문서](https://learn.chatgpt.com/docs/hooks)를 기준으로 합니다.

프로젝트 폴더명과 에이전트 역할명은 화면 표시를 위해 의도적으로 노출됩니다. 자세한 경계는 [보안 및 개인정보 보호](docs/SECURITY.md)를 확인하세요.

## 개발 검증

```powershell
npm test
npm run build
```

현재 42개 테스트가 수집기 개인정보 보호·선택적 상세 마스킹, 한국어 지시·배정·단계·인계 연결, 지시 전환 경계 분리, 한영 혼합 명령 제거, 이전 형식 마크업 정규화, 단순 채팅·오래된 프로젝트 필터, 반복 가능한 훅 병합, 이벤트 정제, 불투명 ID, 장기 업무 활동 요약, 직원 퇴장, 안정적인 프로젝트 순서, 협업 논의, localhost 전용 서버, 회전 이벤트 파일, 정적 호스팅 산출물을 검증합니다. 단계별 개발 과정과 결과는 [docs/DEVELOPMENT.ko.md](docs/DEVELOPMENT.ko.md)에 정리되어 있습니다.

## 저장소 구성

```text
codex/                    Codex 이벤트 수집기
docs/                     아키텍처, 보안, 개발 과정, 실행 화면
scripts/                  빌드, 훅 설정, Windows 설치·제거
server/                   JSONL 리듀서와 localhost HTTP 서버
src/                      React 대시보드
tests/                    Node 테스트
worker/                   데모 전용 정적 호스팅 워커
```

## 라이선스

[MIT](LICENSE)
