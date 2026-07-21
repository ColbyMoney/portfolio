import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Board } from './game.service';

export type Difficulty = 'medium' | 'hard' | 'legendary';

export interface AiMoveRequest {
  board: number[][];
  current_player: number;
  difficulty?: Difficulty;
  use_mcts?: boolean;
}

export interface AiMoveResponse {
  move: number;
  probabilities: Record<string, number>;
  value: number;
  game_over: boolean;
  winner: number | null;
}

@Injectable({ providedIn: 'root' })
export class AiService {
  /** Automatically selects Local vs Production endpoint based on hostname. */
  private readonly apiUrl = (() => {
    const host = window.location.hostname;
    if (host === 'colbymoney.com') {
      return 'https://colbymoney-atb7d9btfudefze6.centralus-01.azurewebsites.net/api/ai-four-in-a-row/get-move';
    }
    return 'http://localhost:8000/api/ai-four-in-a-row/get-move';
  })();

  constructor(private http: HttpClient) {}

  getMove(board: Board, current_player: 1 | 2, difficulty: Difficulty, useMcts = true): Observable<number> {
    const request: AiMoveRequest = {
      board: board.map(row => [...row]),
      current_player,
      difficulty,
      use_mcts: useMcts,
    };
    return this.http.post<AiMoveResponse>(this.apiUrl, request).pipe(
      map(res => res.move),
      catchError(() => of(this.fallbackMove(board)))
    );
  }

  /** Simple fallback used when the AI backend is unreachable */
  private fallbackMove(board: Board): number {
    const cols = board[0].length;
    // Prefer center columns
    const preferred = [3, 2, 4, 1, 5, 0, 6].filter(c => c < cols && board[0][c] === 0);
    if (preferred.length === 0) return -1;

    // Try to block or win — check each column for immediate win/block
    for (const col of preferred) {
      if (this.wouldWin(board, col, 2)) return col;
    }
    for (const col of preferred) {
      if (this.wouldWin(board, col, 1)) return col;
    }

    return preferred[Math.floor(Math.random() * Math.min(3, preferred.length))];
  }

  private wouldWin(board: Board, col: number, player: 1 | 2): boolean {
    const rows = board.length;
    let row = -1;
    for (let r = rows - 1; r >= 0; r--) {
      if (board[r][col] === 0) { row = r; break; }
    }
    if (row === -1) return false;

    const test = board.map(r => [...r]);
    test[row][col] = player;

    const dirs: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      let count = 1;
      for (const sign of [1, -1]) {
        let r = row + dr * sign, c = col + dc * sign;
        while (r >= 0 && r < rows && c >= 0 && c < board[0].length && test[r][c] === player) {
          count++; r += dr * sign; c += dc * sign;
        }
      }
      if (count >= 4) return true;
    }
    return false;
  }
}
