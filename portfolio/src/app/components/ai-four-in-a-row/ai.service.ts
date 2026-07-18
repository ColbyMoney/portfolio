import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Board } from './game.service';

export interface AiMoveRequest {
  board: number[][];
  player: number;
}

export interface AiMoveResponse {
  column: number;
}

@Injectable({ providedIn: 'root' })
export class AiService {
  /** Automatically selects Local vs Production endpoint based on hostname. */
  private readonly apiUrl = (() => {
    const host = window.location.hostname;
    if (host === 'colbymoney.com') {
      return 'https://colbymoney.com/api/ai-four-in-a-row';
    }
    return 'https://localhost:7117/api/ai-four-in-a-row';
  })();

  constructor(private http: HttpClient) {}

  getMove(board: Board, player: 1 | 2): Observable<number> {
    const request: AiMoveRequest = {
      board: board.map(row => [...row]),
      player,
    };
    return this.http.post<AiMoveResponse>(this.apiUrl, request).pipe(
      map(res => res.column),
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
