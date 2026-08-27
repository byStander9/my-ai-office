# My AI Office

[English README](README.md) · [개발 과정](docs/DEVELOPMENT.ko.md) · [아키텍처](docs/ARCHITECTURE.md) · [보안](docs/SECURITY.md)

My AI Office는 Codex의 작업 이벤트를 개인정보 노출을 최소화해 수집하고, 프로젝트와 기능 담당 AI의 상태를 단순한 평면 사무실로 보여주는 로컬 대시보드입니다. 프로젝트는 방, AI 작업자는 직원, 동시 협업은 같은 테이블에 모인 회의로 표현됩니다.

![공개용 데모 데이터로 실제 실행한 My AI Office](docs/screenshots/dashboard-demo.png)

아래 화면은 공개용 가상 이벤트를 로컬 API에 입력해 실제 라이브 모드로 실행한 결과입니다.

![공개용 가상 이벤트를 사용한 My AI Office 라이브 모드](docs/screenshots/dashboard-live-sanitized.png)

## 확인할 수 있는 정보

- 진행 중인 Codex 프로젝트를 한 화면의 사무실 맵으로 표시
- 메인 에이전트와 기능별 서브에이전트를 프로젝트별로 배치
- 작업 중, 협업 중, CEO 승인 대기, 대기, 오래된 상태 구분
- 1.5초 간격으로 갱신되는 최근 활동 타임라인
- 같은 프로젝트에서 둘 이상이 작업하면 협업 테이블로 자동 그룹화
- 일반 활동 중에는 프로젝트 방 위치를 고정하고 프로젝트 생명주기 변화에만 최소 재배치
- 이벤트가 없을 때 실제 이벤트와 구분되는 데모 상태 제공

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

이벤트 수집기는 허용 목록 방식으로 동작합니다. 프롬프트, 명령, 도구 입출력, 파일 내용, 자격 증명, 전체 작업 경로, 원본 세션·턴·직원·도구 실행 ID는 저장하지 않습니다. 브라우저 API도 별도의 허용 목록을 적용해 표시용 프로젝트명, 불투명 ID, 역할, 상태, 도구 이름, 시각만 반환합니다.

프로젝트 폴더명과 에이전트 역할명은 화면 표시를 위해 의도적으로 노출됩니다. 자세한 경계는 [보안 및 개인정보 보호](docs/SECURITY.md)를 확인하세요.

## 개발 검증

```powershell
npm test
npm run build
```

현재 24개 테스트가 수집기 개인정보 보호, 반복 가능한 훅 병합, 이벤트 정제, 불투명 ID, 안정적인 프로젝트 순서, 프로젝트 종료·재개, 상태 오래됨 경계, 협업 추론, localhost 전용 서버, 회전 이벤트 파일, 정적 호스팅 산출물을 검증합니다. 단계별 개발 과정과 결과는 [docs/DEVELOPMENT.ko.md](docs/DEVELOPMENT.ko.md)에 정리되어 있습니다.

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
