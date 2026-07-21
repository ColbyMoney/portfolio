import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { GameService, GameState, PlayerStats, CellValue } from './game.service';
import { AiService, Difficulty } from './ai.service';

type GameMode = 'solo' | 'ai' | 'watch';

interface ModelInfo {
  id: Difficulty;
  label: string;
  tagline: string;
  mctsSims: number;
  gamesPlayed: string;
  loss: string;
  trainingTime: string;
  strengths: string[];
  fatalWeakness: string;
  howToBeat: string;
}

const MODEL_INFOS: ModelInfo[] = [
  {
    id: 'medium',
    label: 'Medium (v1)',
    tagline: 'The Apprentice',
    mctsSims: 50,
    gamesPlayed: '45,000',
    loss: '~0.05',
    trainingTime: '6 hours',
    strengths: ['Basic positional play', 'Takes obvious wins'],
    fatalWeakness: 'Struggles to block opponent forks or set up its own forks',
    howToBeat: 'Set up forks and force it to block, then capitalize on the other side',
  },
  {
    id: 'hard',
    label: 'Hard (v2)',
    tagline: 'The Journeyman',
    mctsSims: 250,
    gamesPlayed: '13,000',
    loss: '~0.77',
    trainingTime: '12 hours',
    strengths: ['Strategic outplay', 'Fast fork detection', 'Genuine positional understanding'],
    fatalWeakness: 'When this model has the first move, it does not take the optimal center column',
    howToBeat: 'Capitalize on its opening weakness before it finds its footing',
  },
  {
    id: 'legendary',
    label: 'Legendary (v3)',
    tagline: 'The Master',
    mctsSims: 250,
    gamesPlayed: '41,000',
    loss: '~0.50',
    trainingTime: '28 hours',
    strengths: [
      'Excellent positional understanding',
      'Instant fork blocking',
      'Sees all and knows all',
      'Stronger opening play than v2',
    ],
    fatalWeakness: 'The Legendary AI is inevitable and has no weakness',
    howToBeat: "Good luck!",
  },
];

interface FallingPieceState {
  player: 1 | 2;
  leftPx: number;
  topPx: number;
  sizePx: number;
  fallDistPx: number;
  durationMs: number;
}

/** Desktop and mobile layout constants — must match SCSS variables. */
const LAYOUT_DESKTOP = { cs: 76, cg: 8,  bp: 16, ph: 84 } as const;  // ph = cs+cg (1 cell above board)
const LAYOUT_MOBILE  = { cs: 44, cg: 5,  bp: 10, ph: 49 } as const;  // ph = cs+cg
const MOBILE_BP = 620;

const STORAGE_KEY_AI    = 'fourInARow_stats_ai_v1';
const STORAGE_KEY_SOLO  = 'fourInARow_stats_solo_v1';
const STORAGE_KEY_WATCH = 'fourInARow_stats_watch_v1';

@Component({
  selector: 'app-ai-four-in-a-row',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ai-four-in-a-row.component.html',
  styleUrl: './ai-four-in-a-row.component.scss',
})
export class AiFourInARowComponent implements OnInit, OnDestroy {
  readonly ROWS: number;
  readonly COLS: number;
  readonly colIndices: number[];
  readonly rowIndices: number[];

  mode         = signal<GameMode>('ai');
  gameState    = signal<GameState>({
    board: Array.from({ length: 6 }, () => Array(7).fill(0) as CellValue[]),
    currentPlayer: 1, winner: null, winningCells: [], winLines: [], gameOver: false,
  });
  player1Stats  = signal<PlayerStats>({ name: 'Player 1', wins: 0, losses: 0, draws: 0 });
  player2Stats  = signal<PlayerStats>({ name: 'AI',  wins: 0, losses: 0, draws: 0 });
  isAiThinking  = signal(false);
  useMcts       = signal(false);
  hoverCol      = signal(-1);
  fallingPiece  = signal<FallingPieceState | null>(null);
  hiddenCell    = signal<{ row: number; col: number } | null>(null);

  isWinningCell = computed(() => {
    const set = new Set(this.gameState().winningCells.map(([r, c]) => `${r},${c}`));
    return (r: number, c: number) => set.has(`${r},${c}`);
  });

  readonly modelInfos = MODEL_INFOS;
  difficulty  = signal<Difficulty>('legendary');
  difficulty1 = signal<Difficulty>('legendary');  // watch mode: red AI (player 1)
  difficulty2 = signal<Difficulty>('legendary');    // watch mode: yellow AI (player 2)

  activeModels = computed<ModelInfo[]>(() => {
    if (this.mode() === 'ai')    return MODEL_INFOS.filter(m => m.id === this.difficulty());
    if (this.mode() === 'watch') return [
      MODEL_INFOS.find(m => m.id === this.difficulty1())!,
      MODEL_INFOS.find(m => m.id === this.difficulty2())!,
    ];
    return [];
  });

  private aiSub: Subscription | null = null;
  private autoRestartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public gameService: GameService,
    private aiService: AiService,
  ) {
    this.ROWS = this.gameService.ROWS;
    this.COLS = this.gameService.COLS;
    this.colIndices = Array.from({ length: this.COLS }, (_, i) => i);
    this.rowIndices = Array.from({ length: this.ROWS }, (_, i) => i);
  }

  ngOnInit(): void {
    this.loadStats();
    this.resetGame();
  }

  ngOnDestroy(): void {
    this.aiSub?.unsubscribe();
    if (this.autoRestartTimer !== null) clearTimeout(this.autoRestartTimer);
  }

  // ── Layout helpers ───────────────────────────────────────────────────────

  private get layout() {
    return window.innerWidth <= MOBILE_BP ? LAYOUT_MOBILE : LAYOUT_DESKTOP;
  }

  /** Compute overlay position & animation data for a dropped piece. */
  private computeFp(col: number, landedRow: number, player: 1 | 2): FallingPieceState {
    const { cs, cg, bp, ph } = this.layout;
    const cu         = cs + cg;
    const ps         = Math.floor(cs * 0.9);
    const pad        = Math.floor((cs - ps) / 2);
    // Start position: piece bottom flush 1 gap above the board top edge
    const topPx      = ph - ps - cg;
    const endTopPx   = ph + bp + landedRow * cu + pad;
    const leftPx     = bp + col * cu + pad;
    const fallDistPx = endTopPx - topPx;
    const durationMs = Math.max(280, 100 + landedRow * 60);
    return { player, leftPx, topPx, sizePx: ps, fallDistPx, durationMs };
  }

  /** Left-edge pixel for the drop-preview piece above a given column. */
  getPreviewLeft(col: number): number {
    const { cs, cg, bp } = this.layout;
    return bp + col * (cs + cg) + Math.floor((cs - Math.floor(cs * 0.9)) / 2);
  }

  getPreviewSize(): number {
    return Math.floor(this.layout.cs * 0.9);
  }

  /** Top-edge px for the drop-preview piece — one cell above the board top edge. */
  getPreviewTop(): number {
    const { cs, cg, ph } = this.layout;
    return ph - Math.floor(cs * 0.9) - cg;
  }

  /**
   * Returns one SVG line descriptor per winning connect-4 group,
   * connecting the centres of the first and last cells in each group.
   */
  getWinLines(): { x1: number; y1: number; x2: number; y2: number; length: number }[] {
    const winLines = this.gameState().winLines;
    if (!winLines || winLines.length === 0) return [];
    const { cs, cg, bp, ph } = this.layout;
    const cu   = cs + cg;
    const half = cs / 2;
    return winLines.map(cells => {
      const sorted = [...cells].sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
      const [r1, c1] = sorted[0];
      const [r2, c2] = sorted[sorted.length - 1];
      const x1 = bp + c1 * cu + half;
      const y1 = ph + bp + r1 * cu + half;
      const x2 = bp + c2 * cu + half;
      const y2 = ph + bp + r2 * cu + half;
      const length = Math.ceil(Math.hypot(x2 - x1, y2 - y1)) + 10;
      return { x1, y1, x2, y2, length };
    });
  }

  // ── Single hit-area interaction ──────────────────────────────────────────

  /** Called on every mousemove over the transparent hit-area that covers the board. */
  onHitAreaMouseMove(event: MouseEvent): void {
    if (!this.isInteractiveCheck()) { this.hoverCol.set(-1); return; }
    this.hoverCol.set(this.colFromX(event.offsetX));
  }

  onHitAreaMouseLeave(): void {
    this.hoverCol.set(-1);
  }

  onHitAreaClick(event: MouseEvent): void {
    if (!this.isInteractiveCheck()) return;
    const col = this.colFromX(event.offsetX);
    if (col < 0 || !this.gameService.isColumnPlayable(this.gameState().board, col)) return;
    this.playColumn(col);
  }

  private colFromX(offsetX: number): number {
    const { cs, cg, bp } = this.layout;
    const col = Math.floor((offsetX - bp) / (cs + cg));
    return col >= 0 && col < this.COLS ? col : -1;
  }

  // ── Game actions ─────────────────────────────────────────────────────────

  setMode(m: GameMode): void {
    this.saveStats();
    this.mode.set(m);
    this.loadStats();
    this.resetGame();
  }

  resetGame(): void {
    this.aiSub?.unsubscribe();
    this.aiSub = null;
    if (this.autoRestartTimer !== null) {
      clearTimeout(this.autoRestartTimer);
      this.autoRestartTimer = null;
    }
    this.fallingPiece.set(null);
    this.hiddenCell.set(null);
    this.isAiThinking.set(false);
    this.hoverCol.set(-1);
    const state = this.gameService.createInitialState();
    this.gameState.set(state);
    if (this.mode() === 'ai' && state.currentPlayer === 2) {
      this.scheduleAiMove(900);
    } else if (this.mode() === 'watch') {
      this.scheduleAiMove(900, state.currentPlayer as 1 | 2);
    }
  }

  resetScores(): void {
    const p1Name = this.mode() === 'watch' ? 'AI Red' : 'Player 1';
    const p2Name = this.mode() === 'ai' ? 'AI' : this.mode() === 'watch' ? 'AI Yellow' : 'Player 2';
    this.player1Stats.set({ name: p1Name, wins: 0, losses: 0, draws: 0 });
    this.player2Stats.set({ name: p2Name, wins: 0, losses: 0, draws: 0 });
    this.saveStats();
  }

  setDifficulty(d: Difficulty): void  { this.difficulty.set(d);  this.resetGame(); }
  setDifficulty1(d: Difficulty): void { this.difficulty1.set(d); this.resetGame(); }
  setDifficulty2(d: Difficulty): void { this.difficulty2.set(d); this.resetGame(); }

  toggleMcts(): void { this.useMcts.update(v => !v); }

  // ── Template helpers ─────────────────────────────────────────────────────

  getCellValue(r: number, c: number): 0 | 1 | 2 {
    return this.gameState().board[r][c];
  }

  isCellHidden(r: number, c: number): boolean {
    const h = this.hiddenCell();
    return h !== null && h.row === r && h.col === c;
  }

  isHoverCol(c: number): boolean {
    return this.hoverCol() === c && this.isInteractiveCheck();
  }

  isBlocked(): boolean {
    const col = this.hoverCol();
    return this.isInteractiveCheck() && col >= 0
      && !this.gameService.isColumnPlayable(this.gameState().board, col);
  }

  winRatio(stats: PlayerStats): string {
    const played = stats.wins + stats.losses + stats.draws;
    return played === 0 ? '—' : (stats.wins / played * 100).toFixed(0) + '%';
  }

  gamesPlayed(stats: PlayerStats): number {
    return stats.wins + stats.losses + stats.draws;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private isInteractiveCheck(): boolean {
    const s = this.gameState();
    return !s.gameOver
      && !this.isAiThinking()
      && this.fallingPiece() === null
      && !(this.mode() === 'ai' && s.currentPlayer === 2)
      && this.mode() !== 'watch';
  }

  private playColumn(col: number): void {
    const playerBeforeDrop = this.gameState().currentPlayer;
    const result = this.gameService.dropPiece(this.gameState(), col);
    if (!result) return;

    const fp = this.computeFp(col, result.landedRow, playerBeforeDrop);
    this.fallingPiece.set(fp);
    this.hiddenCell.set({ row: result.landedRow, col });
    this.gameState.set(result.newState);

    const clearAt = fp.durationMs + 40;

    setTimeout(() => {
      this.fallingPiece.set(null);
      this.hiddenCell.set(null);
    }, clearAt);

    if (result.newState.gameOver) {
      setTimeout(() => this.handleGameOver(result.newState), clearAt + 80);
    } else if (this.mode() === 'ai' && result.newState.currentPlayer === 2) {
      this.scheduleAiMove(clearAt + 120);
    } else if (this.mode() === 'watch') {
      this.scheduleAiMove(clearAt + 120, result.newState.currentPlayer as 1 | 2);
    }
  }

  private scheduleAiMove(delay: number, player: 1 | 2 = 2): void {
    const diff: Difficulty = this.mode() === 'watch'
      ? (player === 1 ? this.difficulty1() : this.difficulty2())
      : this.difficulty();
      console.log(`Scheduling AI move for player ${player} (difficulty: ${diff}) in ${delay}ms`);
    this.isAiThinking.set(true);
    setTimeout(() => {
      this.aiSub = this.aiService
        .getMove(this.gameState().board, player, diff, this.useMcts())
        .subscribe(col => {
          this.isAiThinking.set(false);
          if (col < 0 || col >= this.COLS) return;
          if (!this.gameService.isColumnPlayable(this.gameState().board, col)) return;
          this.playColumn(col);
        });
    }, delay);
  }

  private handleGameOver(state: GameState): void {
    if (state.winner === 'draw') {
      this.player1Stats.update(s => ({ ...s, draws: s.draws + 1 }));
      this.player2Stats.update(s => ({ ...s, draws: s.draws + 1 }));
    } else if (state.winner === 1) {
      this.player1Stats.update(s => ({ ...s, wins: s.wins + 1 }));
      this.player2Stats.update(s => ({ ...s, losses: s.losses + 1 }));
    } else if (state.winner === 2) {
      this.player2Stats.update(s => ({ ...s, wins: s.wins + 1 }));
      this.player1Stats.update(s => ({ ...s, losses: s.losses + 1 }));
    }
    this.saveStats();
    if (this.mode() === 'watch') {
      this.autoRestartTimer = setTimeout(() => {
        this.autoRestartTimer = null;
        this.resetGame();
      }, 2500);
    }
  }

  private saveStats(): void {
    const key = this.mode() === 'ai' ? STORAGE_KEY_AI : this.mode() === 'watch' ? STORAGE_KEY_WATCH : STORAGE_KEY_SOLO;
    try {
      localStorage.setItem(key, JSON.stringify({ p1: this.player1Stats(), p2: this.player2Stats() }));
    } catch { /* ignore */ }
  }

  private loadStats(): void {
    const key    = this.mode() === 'ai' ? STORAGE_KEY_AI : this.mode() === 'watch' ? STORAGE_KEY_WATCH : STORAGE_KEY_SOLO;
    const p1Name = this.mode() === 'watch' ? 'AI Red' : 'Player 1';
    const p2Name = this.mode() === 'ai' ? 'AI' : this.mode() === 'watch' ? 'AI Yellow' : 'Player 2';
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        this.player1Stats.set({ name: p1Name, wins: 0, losses: 0, draws: 0 });
        this.player2Stats.set({ name: p2Name, wins: 0, losses: 0, draws: 0 });
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed?.p1) this.player1Stats.set({ ...parsed.p1, name: p1Name });
      if (parsed?.p2) this.player2Stats.set({ ...parsed.p2, name: p2Name });
    } catch { /* ignore */ }
  }
}
