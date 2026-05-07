# Orange Road Simulation Game - Architecture Design

## Context

Orange Road 만화 기반의 2D 웹 시뮬레이션 게임을 설계합니다. 플레이어는 주인공 쿄우스케가 되어 AI NPC들과 상호작용하며 관계를 쌓고 스토리를 진행합니다.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Web Browser                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   PixiJS     │  │   React UI   │  │  Zustand     │         │
│  │  Game Layer  │  │   Dialog     │  │   Store      │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (Hono + Bun)                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Game API   │  │   Save API   │  │  NPC API     │         │
│  │  /game/*     │  │  /save/*     │  │  /npc/*      │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│  ┌──────────────┐  ┌──────────────┐                          │
│  │  Game State  │  │   NPC Mgr    │                          │
│  │   Service    │  │   Service    │                          │
│  └──────────────┘  └──────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              LM Studio (OpenAI Compatible API)                  │
└─────────────────────────────────────────────────────────────────┘
```

## Component Design

### 1. Frontend Structure

```
src/
├── main.tsx                 # Entry point
├── App.tsx                  # Root component
├── core/
│   ├── Game.ts              # PixiJS Application wrapper
│   ├── SceneManager.ts      # Scene management
│   └── EventBus.ts          # Event bus for communication
├── scenes/
│   ├── GameScene.ts         # Main game scene (map, player)
│   ├── DialogScene.ts       # Dialog overlay
│   └── LoadingScene.ts      # Loading screen
├── entities/
│   ├── Player.ts            # Player entity
│   ├── NPC.ts               # NPC entity
│   ├── Location.ts          # Location/Place entity
│   └── EntityManager.ts     # Entity management
├── systems/
│   ├── TimeSystem.ts        # Game time management
│   ├── MovementSystem.ts    # Pathfinding & movement
│   ├── DialogSystem.ts      # Dialog UI & interaction
│   ├── EmotionSystem.ts     # Emotion/Relationship tracking
│   └── SaveSystem.ts        # Save/Load integration
├── ui/
│   └── components/          # React UI components
│       ├── DialogBox.tsx
│       ├── StatusPanel.tsx
│       ├── TimeDisplay.tsx
│       └── Minimap.tsx
├── store/
│   └── gameStore.ts         # Zustand store
├── assets/
│   ├── sprites/             # Character sprites
│   ├── maps/                # Map tiles
│   └── backgrounds/         # Background images
└── api/
    └── client.ts            # API client
```

### 2. Backend Structure

```
src/
├── server.ts                # Hono app entry
├── routes/
│   ├── game.ts              # Game state routes
│   ├── npc.ts               # NPC interaction routes
│   └── save.ts              # Save data routes
├── services/
│   ├── GameService.ts       # Core game logic
│   ├── NPCService.ts        # NPC AI & context management
│   ├── TimeService.ts       # Time simulation
│   ├── SaveService.ts       # Persistence
│   └── EventService.ts      # Event scheduling
├── models/
│   ├── Player.ts
│   ├── NPC.ts
│   ├── Location.ts
│   ├── GameState.ts
│   └── Relationship.ts
├── ai/
│   ├── LLMClient.ts         # LM Studio API client
│   ├── PromptBuilder.ts     # NPC prompt construction
│   └── ContextManager.ts    # NPC context storage
├── data/
│   ├── characters/          # Character definitions
│   ├── locations/           # Location data
│   ├── events/              # Story events
│   └── schedules/           # NPC schedules
└── storage/
    └── SaveStorage.ts       # File-based save storage
```

## Core Data Models

### GameState
```typescript
interface GameState {
  gameTime: GameTime;        // { day: number, hour: number, minute: number }
  dayOfWeek: DayOfWeek;      // MON | TUE | ... | SUN
  player: PlayerState;
  npcs: Map<string, NPCState>;
  locations: Map<string, LocationState>;
  relationships: Map<string, RelationshipData>;
  flags: Map<string, any>;   // Story flags
}
```

### NPCState
```typescript
interface NPCState {
  id: string;
  name: string;
  locationId: string;        // Current location
  emotion: EmotionState;
  context: NPCContext;       // Conversation history & memory
  schedule: ScheduleEntry[];
  personality: PersonalityProfile;
}
```

### RelationshipData
```typescript
interface RelationshipData {
  npcId: string;
  affinity: number;          // 0-100
  emotion: string;           // Current dominant emotion
  memories: InteractionMemory[];
}
```

## API Design

### NPC Interaction Flow
```
1. Client: POST /npc/:id/talk
   { message: "안녕, 마도카" }

2. Server:
   - Load NPC context from storage
   - Build prompt with:
     * NPC personality
     * Current emotion
     * Relationship with player
     * Recent conversation history
   - Call LM Studio: /v1/chat/completions

3. Server Response:
   { response: "...", emotionUpdate: {...}, affinityChange: +5 }

4. Server: Update NPC context & save
```

### Game State Synchronization
```
Client                Server
  │                     │
  ├──── GET /game/state ──▶
  │◀──── GameState ───────┤
  │                     │
  ├─ POST /game/action ──▶ (move, talk, wait)
  │◀──── updated state ───┤
```

## Time System Design

```
Real-time   │   Game-time
─────────────────────────
1 second    │   1 minute (acceleration)
1 minute    │   1 hour

Day Cycle:
06:00 - 07:30: 아침 (등교 준비)
08:00 - 12:00: 오전 수업
12:00 - 13:00: 점심시간
13:00 - 15:30: 오후 수업
16:00 - 18:00: 방과후
18:00 - 22:00: 저녁
22:00 - 06:00: 밤
```

## NPC AI Integration

### Prompt Structure
```typescript
const buildPrompt = (npc: NPC, player: Player, input: string) => ({
  messages: [
    {
      role: "system",
      content: `당신은 ${npc.name}입니다.
성격: ${npc.personality.description}
현재 감정: ${npc.emotion.state}
${player.name}와의 관계: ${relationship.description}

대화 지침:
- 현재 감정을 반영하여 반응하세요
- 관계도에 따라 친밀도를 조절하세요
- Orange Road 원작의 캐릭터성을 유지하세요`
    },
    ...npc.context.history.slice(-10), // Last 10 messages
    {
      role: "user",
      content: input
    }
  ],
  response_format: { type: "json_object" } // Expect: {text, emotion, internalThought}
});
```

### Context Management
- Short-term: Last 10-20 messages
- Long-term: Summarized memories (significant events)
- Personality: Fixed template
- Relationship: Dynamic state

## Technical Decisions

### Why PixiJS over Phaser?
- Lower level control for custom mechanics
- Smaller bundle size
- Better integration with React overlays
- WebGL-first performance

### Why Zustand?
- Simple API
- Good TypeScript support
- No context provider hell
- Easy persistence middleware

### Why Hono + Bun?
- Fast runtime (Bun)
- Lightweight framework
- Good TypeScript support
- Easy deployment on RPi4

## File Structure Overview

```
orangeroad/
├── frontend/               # Vite + React + PixiJS
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── vite.config.ts
├── backend/                # Hono + Bun
│   ├── src/
│   ├── package.json
│   └── tsconfig.json
├── data/                   # Shared game data
│   ├── characters/
│   ├── locations/
│   └── events/
├── saves/                  # Save data storage
├── docker-compose.yml      # (Optional)
└── README.md
```

## Next Steps for Implementation

1. **Project Setup**: Initialize frontend and backend projects
2. **Core Game Loop**: PixiJS scene with player movement
3. **NPC Framework**: Basic NPC entity with AI client
4. **Dialog System**: UI overlay for conversations
5. **Time System**: Game clock implementation
6. **Save System**: Persistence layer

## Verification Plan

1. Run frontend dev server and see game scene
2. Move player character with click
3. Interact with NPC and see response from LM Studio
4. Verify time progression
5. Test save/load functionality
