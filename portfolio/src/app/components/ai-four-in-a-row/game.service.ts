import { Injectable } from '@angular/core';

export type CellValue = 0 | 1 | 2;
export type Board = CellValue[][];

export interface GameState {
  board: Board;
  currentPlayer: 1 | 2;
  winner: 1 | 2 | 'draw' | null;
  winningCells: [number, number][];
  gameOver: boolean;
}

export interface PlayerStats {
  name: string;
  wins: number;
  losses: number;
  draws: number;
}

@Injectable({ providedIn: 'root' })
export class GameService {
  readonly ROWS = 6;
  readonly COLS = 7;

  createInitialState(): GameState {
    return {
      board: this.createEmptyBoard(),
      currentPlayer: (Math.random() < 0.5 ? 1 : 2) as 1 | 2,
      winner: null,
      winningCells: [],
      gameOver: false,
    };
  }

  createEmptyBoard(): Board {
    return Array.from({ length: this.ROWS }, () =>
      Array(this.COLS).fill(0) as CellValue[]
    );
  }

  getLowestEmptyRow(board: Board, col: number): number {
    for (let row = this.ROWS - 1; row >= 0; row--) {
      if (board[row][col] === 0) return row;
    }
    return -1;
  }

  isColumnPlayable(board: Board, col: number): boolean {
    return board[0][col] === 0;
  }

  dropPiece(
    state: GameState,
    col: number
  ): { newState: GameState; landedRow: number } | null {
    if (state.gameOver) return null;
    const row = this.getLowestEmptyRow(state.board, col);
    if (row === -1) return null;

    const newBoard = state.board.map(r => [...r]) as Board;
    newBoard[row][col] = state.currentPlayer;

    const { winner, winningCells } = this.checkWinner(newBoard, row, col, state.currentPlayer);
    const isDraw = !winner && this.isDraw(newBoard);

    const newState: GameState = {
      board: newBoard,
      currentPlayer: state.currentPlayer === 1 ? 2 : 1,
      winner: winner ?? (isDraw ? 'draw' : null),
      winningCells,
      gameOver: winner !== null || isDraw,
    };

    return { newState, landedRow: row };
  }

  checkWinner(
    board: Board,
    lastRow: number,
    lastCol: number,
    player: 1 | 2
  ): { winner: 1 | 2 | null; winningCells: [number, number][] } {
    const directions: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1]];

    for (const [dr, dc] of directions) {
      const cells: [number, number][] = [[lastRow, lastCol]];

      for (const sign of [1, -1]) {
        let r = lastRow + dr * sign;
        let c = lastCol + dc * sign;
        while (
          r >= 0 && r < this.ROWS &&
          c >= 0 && c < this.COLS &&
          board[r][c] === player
        ) {
          cells.push([r, c]);
          r += dr * sign;
          c += dc * sign;
        }
      }

      if (cells.length >= 4) {
        return { winner: player, winningCells: cells };
      }
    }

    return { winner: null, winningCells: [] };
  }

  isDraw(board: Board): boolean {
    return board[0].every(cell => cell !== 0);
  }

  createDefaultStats(name: string): PlayerStats {
    return { name, wins: 0, losses: 0, draws: 0 };
  }

  get winRatio(): (stats: PlayerStats) => string {
    return (stats: PlayerStats) => {
      const played = stats.wins + stats.losses + stats.draws;
      if (played === 0) return '—';
      return (stats.wins / played * 100).toFixed(0) + '%';
    };
  }
}
