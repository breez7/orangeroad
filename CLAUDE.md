# Orange Road Game - Claude Code Guidelines

## Project Context

Orange Road 만화 기반 2D 웹 시뮬레이션 게임 개발 프로젝트입니다. AI NPC들이 자신만의 context와 기억을 가지고 살아움직이는 연애/생활 시뮬레이션 게임입니다.

## Important: Always Reference Requirements & Design

모든 개발 작업을 시작하기 전에 반드시 다음 문서들을 참조하세요:

- **요구사항**: `requirements.md` - 프로젝트의 전체 요구사항
- **설계**: `DESIGN.md` - 아키텍처 설계

코드를 작성할 때:
1. 먼저 관련 요구사항(FR-XXX)을 확인하세요
2. 설계 문서의 해당 섹션을 참조하세요
3. 설계와 다른 접근이 필요하다면 먼저 설계를 업데이트하세요

## MANDATORY: Developer & Evaluator Agent Feedback Loop

**중요**: 모든 구현 작업은 다음 프로세스를 **강제**로 따라야 합니다:

```
1. Developer Agent 구현
2. Evaluator Agent 평가
3. 피드백 반영
4. 퀄리티가 만족스러울 때까지 2-3 반복 (최소 N회)
```

### 프로세스 상세

#### 1. 구현 전 (Pre-Implementation)
- 요구사항 확인
- 설계 문서 확인
- 구현 범위 정의

#### 2. Developer Agent 사용
```bash
Agent: developer
- 구현할 기능/컴포넌트 설명
- 관련 요구사항 참조
- 설계 문서의 해당 섹션 참조
```

#### 3. Evaluator Agent 사용
Developer Agent가 코드를 작성한 후, **반드시** Evaluator Agent로 검토:
```bash
Agent: code-reviewer (evaluator)
- 작성된 코드 검토
- 요구사항 충족 여부 확인
- 설계와 일치 여부 확인
- 개선점 제시
```

#### 4. 피드백 반영 및 반복
- Evaluator의 피드백을 반영하여 코드 수정
- **퀄리티가 충분히 좋아질 때까지** 2-3회 이상 반복
- 최소 반복 횟수: 3회 (또는 퀄리티 만족 시)

### GitHub Issue Comment 활용

**강제사항**: 모든 개발 과정은 GitHub Issue 댓글에 상세히 기록해야 합니다:

```markdown
## 개발 완료 보고

### 구현 내용
- 구현한 기능/파일 목록
- 주요 변경사항

### Evaluator 피드백 1차
- 피드백 내용
- 반영 여부

### Evaluator 피드백 2차
- 피드백 내용
- 반영 여부

### 최종 수정사항
- 반영된 수정 내용
- 개선된 점

### 검증 결과
- [ ] 요구사항 충족
- [ ] 설계 일치
- [ ] 동작 확인
```

### 사용 예시

```
User: "PixiJS로 GameScene을 구현해줘"

Claude:
1. requirements.md와 DESIGN.md 확인
2. Developer Agent에 작업 지시
3. Evaluator Agent로 코드 검토 (1차)
4. 피드백 반영
5. Evaluator Agent로 재검토 (2차)
6. 피드백 반영
7. Evaluator Agent로 최종 검토 (3차)
8. GitHub Issue에 모든 과정 기록
9. 최종 코드 완성
```

## Technical Stack

- **Frontend**: React + Vite + PixiJS + Tailwind CSS + Zustand
- **Backend**: Hono + Bun
- **AI**: LM Studio (OpenAI Compatible API)
- **Deploy**: Raspberry Pi 4

## File Structure

```
orangeroad/
├── frontend/   # PixiJS 게임 + React UI
├── backend/    # Hono API 서버
├── data/       # 캐릭터/장소/이벤트 데이터
├── saves/      # 세이브 데이터
├── requirements.md    # 요구사항 문서
├── DESIGN.md          # 아키텍처 설계
└── CLAUDE.md          # 이 파일
```

## Development Guidelines

1. **TypeScript First**: 모든 코드는 TypeScript로 작성
2. **Component-First**: 가능한 작은 컴포넌트 단위로 개발
3. **Test-Driven 본능**: 중요한 로직은 테스트 고려
4. **Documentation**: 복잡한 로직에는 주석 필수
5. **Design Consistency**: 설계 문서와의 일관성 유지

## Code Review Checklist

모든 PR/변경은 다음을 확인해야 합니다:
- [ ] 요구사항 충족 (FR-XXX)
- [ ] 설계 문서와 일치
- [ ] TypeScript 에러 없음
- [ ] 동작 확인 (dev server)
- [ ] Evaluator Agent 승인 (최소 3회 피드백 루프)
- [ ] GitHub Issue에 상세 기록

## AI Integration Notes

- LM Studio는 OpenAI 호환 API 제공
- 엔드포인트: `/v1/chat/completions`
- 각 NPC는 독립적인 context 유지
- 감정 상태가 대화에 반영되어야 함

## Quality Standards

GOTY 수준의 재미를 목표로 합니다:
- 매끄러운 60fps
- 직관적인 UI/UX
- 살아있는 NPC AI
- 몰입감 있는 스토리

## Developer Agent Template

```
당신은 Orange Road 게임 개발자입니다.

## 작업: [작업 내용]

## 참고 문서
- 요구사항: requirements.md의 FR-XXX
- 설계: DESIGN.md의 [섹션]

## 구현 요구사항
1. [구현 상세]

## 완료 조건
- [조건 목록]
```

## Evaluator Agent Template

```
당신은 Orange Road 게임 코드 리뷰어입니다.

## 검토할 코드
[코드 또는 파일 경로]

## 검토 항목
1. 요구사항 충족 여부 (FR-XXX)
2. 설계 문서 일치 여부
3. 코드 품질
4. 타입 안전성
5. 성능 고려사항
6. 개선 제안
```
