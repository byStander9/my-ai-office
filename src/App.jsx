import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Briefcase, Buildings, CheckCircle, Clock, Code, Cpu, Database, Funnel, Handshake, MagnifyingGlass, ShieldCheck, UserCircle, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { stabilizeProjectOrder } from "./project-order.js";

const palette = ["#de8d29", "#4c7d72", "#7f6bb2", "#b65f52", "#4778a8", "#9a7744"];
const demoProjects = [
  { key: "demo-office", name: "AI 오피스 예시", status: "예시", currentDirective: { title: "프로젝트별 실시간 협업 현황을 보여주세요." }, assignments: [
    { id: "demo-assignment-1", employeeName: "화면 구현 담당", task: "대시보드 화면 구현 업무" },
    { id: "demo-assignment-2", employeeName: "품질 검증 담당", task: "화면과 동작 검증 업무" },
  ], employees: [
    { id: "demo-lead", name: "기획 리드", role: "요구사항 정리", status: "working", kind: "main" },
    { id: "demo-ui", name: "화면 구현 담당", role: "대시보드 구현", status: "working", kind: "subagent" },
    { id: "demo-qa", name: "품질 담당", role: "빌드 검증 대기", status: "online", kind: "subagent" },
  ]},
  { key: "demo-npu", name: "NPU 성능 분석 예시", status: "예시", currentDirective: { title: "동일 조건의 성능 측정 결과를 검증해주세요." }, assignments: [
    { id: "demo-assignment-3", employeeName: "리서치 담당", task: "비교 기준과 측정 조건 조사 업무" },
  ], employees: [
    { id: "demo-perf", name: "성능 분석가", role: "벤치마크 분석", status: "working", kind: "main" },
    { id: "demo-research", name: "리서처", role: "근거 교차검증", status: "meeting", kind: "subagent" },
    { id: "demo-backend", name: "백엔드 담당", role: "API 로그 확인", status: "meeting", kind: "subagent" },
  ], discussions: [
    { id: "demo-talk-1", employeeName: "리서처", message: "벤치마크 조건과 비교 기준을 먼저 맞추겠습니다." },
    { id: "demo-talk-2", employeeName: "백엔드 담당", message: "동일 조건의 API 로그를 기준으로 확인하겠습니다." },
  ]},
];
const demoEvents = [
  { id: "demo-1", projectId: "demo-office", employeeId: "demo-ui", employeeName: "화면 구현 담당", instructionTitle: "프로젝트별 실시간 협업 현황을 보여주세요.", workStage: "4단계 · 화면과 동작 검증", message: "화면 구현 담당이(가) '프로젝트별 실시간 협업 현황을 보여주세요.' 지시에 따라 4단계 · 화면과 동작 검증을 진행했습니다.", activityLabel: "화면 동작 검증", stepCount: 8, startedAt: new Date(Date.now() - 18 * 60_000).toISOString(), at: new Date(Date.now() - 48_000).toISOString(), type: "activity.summary", status: "working" },
  { id: "demo-2", projectId: "demo-office", employeeId: "demo-lead", employeeName: "기획 리드", message: "실시간 이벤트 수신 규칙을 확정했습니다.", at: new Date(Date.now() - 132_000).toISOString(), type: "directive.submitted", status: "working" },
  { id: "demo-3", projectId: "demo-npu", employeeId: "demo-perf", employeeName: "성능 분석가", message: "성능 분석가가 명령 실행·상태 점검 업무를 진행했습니다.", activityLabel: "명령 실행·상태 점검", stepCount: 12, startedAt: new Date(Date.now() - 42 * 60_000).toISOString(), at: new Date(Date.now() - 288_000).toISOString(), type: "activity.summary", status: "working" },
];

const stateLabels = {
  working: "작업 중", meeting: "협업 중", waiting_approval: "CEO 승인 대기", compacting: "맥락 정리",
  stopping: "정리 중", online: "온라인", idle: "대기", completed: "완료", offline: "오프라인", observed: "상태 확인",
  stale: "상태 오래됨",
};

function colorFor(key) {
  const index = [...key].reduce((sum, character) => sum + character.charCodeAt(0), 0) % palette.length;
  return palette[index];
}

function iconForRole(role = "") {
  if (/개발|엔지니어|백엔드|프론트|코드|builder/i.test(role)) return Code;
  if (/성능|NPU|시스템/i.test(role)) return Cpu;
  if (/데이터|DB/i.test(role)) return Database;
  if (/검증|품질|QA|review/i.test(role)) return ShieldCheck;
  if (/리서치|조사|research/i.test(role)) return MagnifyingGlass;
  return Briefcase;
}

function uiState(status) {
  if (["working", "compacting"].includes(status)) return "working";
  if (["meeting"].includes(status)) return "meeting";
  if (["waiting_approval", "stopping"].includes(status)) return "review";
  if (["offline"].includes(status)) return "idle";
  return "waiting";
}

function relativeTime(timestamp, now) {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return "시간 미상";
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 10) return "방금 전";
  if (seconds < 60) return `${seconds}초 전`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}시간 전` : `${Math.floor(hours / 24)}일 전`;
}

function activityDuration(event) {
  const durationMs = Date.parse(event.at) - Date.parse(event.startedAt);
  if (!Number.isFinite(durationMs) || durationMs < 60_000) return null;
  const minutes = Math.floor(durationMs / 60_000);
  return minutes < 60 ? `${minutes}분간` : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분간`;
}

function decorateProjects(projects) {
  return projects.map((project) => ({
    ...project,
    id: project.key,
    shortName: project.name.length > 12 ? `${project.name.slice(0, 11)}…` : project.name,
    color: colorFor(project.key),
    health: project.freshness === "stale" ? "상태 오래됨" : project.status,
    agents: (project.employees ?? []).map((employee) => {
      const status = employee.freshness === "stale" ? "stale" : employee.status;
      return { ...employee, status, state: uiState(status), icon: iconForRole(employee.role) };
    }),
  }));
}

function Agent({ agent, projectColor }) {
  const Icon = agent.icon ?? UserCircle;
  return <span className={`agent agent--${agent.state}`} title={`${agent.name} · ${agent.role}`}>
    <span className="agent__avatar" style={{ "--agent-color": projectColor }}><Icon size={20} weight="duotone" /><span className="agent__state" /></span>
    <span className="agent__copy"><strong>{agent.name}</strong><span>{stateLabels[agent.status] ?? "상태 확인 중"}</span></span>
  </span>;
}

function ProjectRoom({ project, selected, onSelect }) {
  const meetingAgents = project.agents.filter((agent) => agent.state === "meeting");
  const deskAgents = project.agents.filter((agent) => agent.state !== "meeting");
  const directiveText = selected ? project.currentDirective?.summary ?? project.currentDirective?.title : project.currentDirective?.title;
  const directiveLabel = <><b>현재 CEO 지시</b><span>{directiveText}</span></>;
  return <article className={`project-room ${selected ? "project-room--selected" : ""}`} style={{ "--room-color": project.color }}>
    <span className="project-room__door" aria-hidden="true" />
    <button className="project-room__select" onClick={() => onSelect(project.id)} type="button" aria-label={`${project.name} 프로젝트만 보기`}><span className="project-room__header"><span><strong>{project.name}</strong><small>{project.health}</small></span><span className="project-room__count"><UsersThree size={16} /> {project.agents.length}</span></span></button>
    {project.currentDirective && (selected
      ? <div className="project-room__directive project-room__directive--scroll" role="region" aria-label={`${project.name} 현재 CEO 지시 전체 내용`} tabIndex={0}>{directiveLabel}</div>
      : <button className="project-room__directive" onClick={() => onSelect(project.id)} type="button" aria-label={`${project.name} 현재 CEO 지시 전체 내용 보기`}>{directiveLabel}</button>)}
    {project.assignments?.length > 0 && <span className="project-room__assignments"><b>직원별 배정 업무</b>{project.assignments.slice(0, 3).map((assignment) => <span key={assignment.id}><strong>{assignment.employeeName}</strong>{assignment.task}</span>)}</span>}
    <span className="project-room__agents">{deskAgents.map((agent) => <Agent key={agent.id} agent={agent} projectColor={project.color} />)}</span>
    {meetingAgents.length > 0 && <span className="meeting-table"><span className="meeting-table__label"><Handshake size={15} weight="duotone" /> 협업 테이블</span><span className="meeting-table__people">{meetingAgents.map((agent) => <Agent key={agent.id} agent={agent} projectColor={project.color} />)}</span>{project.discussions?.length > 0 && <span className="meeting-table__discussion"><strong>최근 논의</strong>{project.discussions.slice(0, 3).map((discussion) => <span key={discussion.id}><b>{discussion.employeeName}</b>{discussion.message}</span>)}</span>}</span>}
  </article>;
}

export function App() {
  const [selectedProject, setSelectedProject] = useState("all");
  const [activityProject, setActivityProject] = useState("all");
  const [projects, setProjects] = useState([]);
  const [events, setEvents] = useState([]);
  const [source, setSource] = useState("connecting");
  const [freshness, setFreshness] = useState("demo");
  const [lastEventAt, setLastEventAt] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [detailCaptureEnabled, setDetailCaptureEnabled] = useState(false);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/events", { headers: { Accept: "application/json" }, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload.projects) || !Array.isArray(payload.events) || !["live", "demo"].includes(payload.mode) || !["fresh", "stale", "demo"].includes(payload.freshness)) throw new Error("Invalid snapshot");
        if (cancelled) return;
        const isDemo = payload.mode === "demo";
        const nextProjects = decorateProjects(isDemo ? demoProjects : payload.projects);
        setProjects((previousProjects) => stabilizeProjectOrder(previousProjects, nextProjects));
        setEvents(isDemo ? demoEvents : payload.events);
        setSource(isDemo ? "demo" : "live");
        setFreshness(payload.freshness);
        setLastEventAt(payload.lastEventAt ?? null);
        setDetailCaptureEnabled(payload.detailCaptureEnabled === true);
        setLastSync(Date.now());
      } catch {
        if (!cancelled) setSource("error");
      }
    };
    poll();
    const poller = window.setInterval(poll, 1_500);
    return () => { cancelled = true; window.clearInterval(clock); window.clearInterval(poller); };
  }, []);

  useEffect(() => {
    if (selectedProject !== "all" && !projects.some((project) => project.id === selectedProject)) setSelectedProject("all");
    if (activityProject !== "all" && !projects.some((project) => project.id === activityProject)) setActivityProject("all");
  }, [activityProject, projects, selectedProject]);

  const visibleProjects = selectedProject === "all" ? projects : projects.filter((project) => project.id === selectedProject);
  const visibleEvents = useMemo(() => events.filter((event) => activityProject === "all" || event.projectId === activityProject), [activityProject, events]);
  const activeAgents = visibleProjects.flatMap((project) => project.agents).filter((agent) => ["working", "meeting", "review"].includes(agent.state)).length;
  const connectionLabel = source === "live" && freshness === "stale" ? "연결됨 · 상태 오래됨" : source === "live" ? "실시간 연결" : source === "demo" ? "예시 데이터" : source === "error" ? "서버 연결 끊김" : "연결 확인 중";
  const connectionClass = source === "live" && freshness === "stale" ? "stale" : source;

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand__mark"><Buildings size={22} weight="duotone" /></span><div><strong>My AI Office</strong><span>프로젝트 운영실</span></div></div>
      <div className="topbar__status"><span className={`connection connection--${connectionClass}`}><span />{connectionLabel}</span><span className="sync-time"><ArrowClockwise size={15} /> {freshness === "stale" && lastEventAt ? `마지막 이벤트 ${relativeTime(lastEventAt, now)}` : lastSync ? relativeTime(new Date(lastSync).toISOString(), now) : "동기화 중"}</span></div>
    </header>

    <section className="toolbar" aria-label="프로젝트 선택">
      <div className="toolbar__title"><Funnel size={18} /><span>프로젝트 보기</span></div>
      <div className="project-tabs"><button className={selectedProject === "all" ? "is-active" : ""} onClick={() => setSelectedProject("all")} type="button">전체</button>{projects.map((project) => <button key={project.id} className={selectedProject === project.id ? "is-active" : ""} onClick={() => setSelectedProject(project.id)} type="button"><span style={{ background: project.color }} />{project.shortName}</button>)}</div>
    </section>

    <section className="dashboard-grid">
      <section className="office-panel" aria-labelledby="office-title">
        <div className="section-heading"><div><span className="eyebrow">실시간 업무 공간</span><h1 id="office-title">AI 직원 업무 현황</h1></div><div className="summary-pills"><span><strong>{visibleProjects.length}</strong> 프로젝트</span><span><strong>{activeAgents}</strong> 활동 중</span></div></div>
        {projects.length ? <div className={`office-map ${visibleProjects.length === 1 ? "office-map--single" : ""} ${selectedProject !== "all" ? "office-map--focused" : ""}`}>
          <div className="corridor-label"><Buildings size={15} /> 중앙 복도</div>
          <div className="rooms-grid">{visibleProjects.map((project) => <ProjectRoom key={project.id} project={project} selected={selectedProject === project.id} onSelect={setSelectedProject} />)}</div>
          <div className="office-map__legend"><span><i className="status-dot status-dot--working" />작업 중</span><span><i className="status-dot status-dot--meeting" />협업 중</span><span><i className="status-dot status-dot--waiting" />대기</span></div>
        </div> : <div className="empty-state"><WarningCircle size={32} weight="duotone" /><strong>{source === "error" ? "이벤트 서버에 연결할 수 없습니다" : "표시할 최근 Codex 프로젝트가 없습니다"}</strong><span>{source === "error" ? "로컬 AI Office 서버가 실행 중인지 확인하세요." : "도구 또는 서브에이전트 작업이 시작되면 프로젝트가 나타납니다."}</span></div>}
      </section>

      <aside className="activity-panel" aria-labelledby="activity-title">
        <div className="activity-panel__heading"><div><span className="eyebrow">지시 기반 업무 흐름</span><h2 id="activity-title">업무 활동 요약</h2></div><span className="activity-count">{visibleEvents.length}</span></div>
        <label className="activity-filter">프로젝트별 보기<select aria-label="활동 프로젝트" value={activityProject} onChange={(event) => setActivityProject(event.target.value)}><option value="all">전체 프로젝트</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        {detailCaptureEnabled && <span className="detail-capture-badge">로컬 상세 기록 켜짐</span>}
        <div className="timeline" aria-live="polite" aria-label="업무 활동 요약 전체 목록" role="region" tabIndex={0}>{visibleEvents.length ? visibleEvents.map((event) => {
          const project = projects.find((item) => item.id === event.projectId) ?? projects[0];
          const Icon = event.type === "employee.approval.waiting" || ["visual_check", "validation"].includes(event.activityCategory) ? ShieldCheck : event.activityCategory === "code_change" ? Code : event.activityCategory === "research" ? MagnifyingGlass : event.activityCategory === "coordination" || ["employee.completed", "employee.work.completed"].includes(event.type) ? Handshake : ["planning", "document_work", "environment_setup", "automation"].includes(event.activityCategory) || event.type === "directive.submitted" ? CheckCircle : Clock;
          const duration = activityDuration(event);
          const detail = event.workStage ? `${event.employeeName} · ${event.workStage}${event.stepCount > 1 ? ` · ${event.stepCount}개 세부 작업` : ""}` : event.employeeName ?? "AI 직원";
          return <article className="timeline-item" key={event.id}><span className="timeline-item__icon" style={{ "--event-color": project?.color ?? palette[0] }}><Icon size={17} weight="duotone" /></span><div><div className="timeline-item__meta"><span>{project?.shortName ?? "프로젝트"}</span><time>{duration ? `${duration} · ` : ""}{relativeTime(event.at, now)}</time></div>{event.workStage && <span className="timeline-item__stage">{event.workStage}</span>}<p>{event.message}</p>{event.detail && <blockquote className="timeline-item__detail">{event.detail}</blockquote>}<small>{detail}</small></div></article>;
        }) : <div className="timeline-empty">이 프로젝트의 최근 업무 활동이 없습니다.</div>}</div>
        <div className="activity-panel__footer"><span><Clock size={15} /> 세부 작업을 10분 흐름으로 요약</span><span>{source === "live" ? "로컬 API 연결됨" : source === "demo" ? "이벤트 파일 비어 있음 · 예시" : "재연결 시도 중"}</span></div>
      </aside>
    </section>
  </main>;
}
