import { Chess } from 'chess.js';

// Piece base values (centipawns)
const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

// Piece-square tables for positional evaluation
const PAWN_TABLE = [
  [0,  0,  0,  0,  0,  0,  0,  0],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [10, 10, 20, 30, 30, 20, 10, 10],
  [5,  5, 10, 25, 25, 10,  5,  5],
  [0,  0,  0, 20, 20,  0,  0,  0],
  [5, -5,-10,  0,  0,-10, -5,  5],
  [5, 10, 10,-20,-20, 10, 10,  5],
  [0,  0,  0,  0,  0,  0,  0,  0],
];

const KNIGHT_TABLE = [
  [-50,-40,-30,-30,-30,-30,-40,-50],
  [-40,-20,  0,  0,  0,  0,-20,-40],
  [-30,  0, 10, 15, 15, 10,  0,-30],
  [-30,  5, 15, 20, 20, 15,  5,-30],
  [-30,  0, 15, 20, 20, 15,  0,-30],
  [-30,  5, 10, 15, 15, 10,  5,-30],
  [-40,-20,  0,  5,  5,  0,-20,-40],
  [-50,-40,-30,-30,-30,-30,-40,-50],
];

const BISHOP_TABLE = [
  [-20,-10,-10,-10,-10,-10,-10,-20],
  [-10,  0,  0,  0,  0,  0,  0,-10],
  [-10,  0,  5, 10, 10,  5,  0,-10],
  [-10,  5,  5, 10, 10,  5,  5,-10],
  [-10,  0, 10, 10, 10, 10,  0,-10],
  [-10, 10, 10, 10, 10, 10, 10,-10],
  [-10,  5,  0,  0,  0,  0,  5,-10],
  [-20,-10,-10,-10,-10,-10,-10,-20],
];

const ROOK_TABLE = [
  [0,  0,  0,  0,  0,  0,  0,  0],
  [5, 10, 10, 10, 10, 10, 10,  5],
  [-5,  0,  0,  0,  0,  0,  0, -5],
  [-5,  0,  0,  0,  0,  0,  0, -5],
  [-5,  0,  0,  0,  0,  0,  0, -5],
  [-5,  0,  0,  0,  0,  0,  0, -5],
  [-5,  0,  0,  0,  0,  0,  0, -5],
  [0,  0,  0,  5,  5,  0,  0,  0],
];

const QUEEN_TABLE = [
  [-20,-10,-10, -5, -5,-10,-10,-20],
  [-10,  0,  0,  0,  0,  0,  0,-10],
  [-10,  0,  5,  5,  5,  5,  0,-10],
  [-5,  0,  5,  5,  5,  5,  0, -5],
  [0,  0,  5,  5,  5,  5,  0, -5],
  [-10,  5,  5,  5,  5,  5,  0,-10],
  [-10,  0,  5,  0,  0,  0,  0,-10],
  [-20,-10,-10, -5, -5,-10,-10,-20],
];

const KING_MIDDLE_TABLE = [
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-20,-30,-30,-40,-40,-30,-30,-20],
  [-10,-20,-20,-20,-20,-20,-20,-10],
  [20, 20,  0,  0,  0,  0, 20, 20],
  [20, 30, 10,  0,  0, 10, 30, 20],
];

function getPieceSquareValue(type: string, row: number, col: number, isWhite: boolean): number {
  const tableRow = isWhite ? (7 - row) : row;
  switch (type) {
    case 'p': return PAWN_TABLE[tableRow][col];
    case 'n': return KNIGHT_TABLE[tableRow][col];
    case 'b': return BISHOP_TABLE[tableRow][col];
    case 'r': return ROOK_TABLE[tableRow][col];
    case 'q': return QUEEN_TABLE[tableRow][col];
    case 'k': return KING_MIDDLE_TABLE[tableRow][col];
    default: return 0;
  }
}

function evaluateBoard(game: Chess): number {
  if (game.isCheckmate()) {
    return game.turn() === 'w' ? -99999 : 99999;
  }
  if (game.isDraw() || game.isStalemate()) return 0;

  let score = 0;
  const board = game.board();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (!piece) continue;
      const isWhite = piece.color === 'w';
      const pieceVal = PIECE_VALUES[piece.type] ?? 0;
      const posVal = getPieceSquareValue(piece.type, row, col, isWhite);
      const total = pieceVal + posVal;
      score += isWhite ? total : -total;
    }
  }
  return score;
}

function orderMoves(game: Chess): string[] {
  const moves = game.moves({ verbose: true }) as any[];
  const scored = moves.map(m => {
    let score = 0;
    if (m.captured) score += (PIECE_VALUES[m.captured] ?? 0) - (PIECE_VALUES[m.piece] ?? 0) / 10;
    if (m.flags?.includes('k') || m.flags?.includes('q')) score += 50;
    return { san: m.san, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map(m => m.san);
}

function minimax(
  game: Chess,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean
): number {
  if (depth === 0 || game.isGameOver()) {
    return evaluateBoard(game);
  }

  const moves = depth >= 2 ? orderMoves(game) : game.moves();

  if (maximizing) {
    let best = -Infinity;
    for (const move of moves) {
      game.move(move);
      const val = minimax(game, depth - 1, alpha, beta, false);
      game.undo();
      best = Math.max(best, val);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of moves) {
      game.move(move);
      const val = minimax(game, depth - 1, alpha, beta, true);
      game.undo();
      best = Math.min(best, val);
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

export function getBestMove(game: Chess, difficulty: 'easy' | 'medium' | 'hard'): string {
  const moves = game.moves();
  if (moves.length === 0) return '';

  if (difficulty === 'easy') {
    if (Math.random() < 0.65) {
      return moves[Math.floor(Math.random() * moves.length)];
    }
    const captures = (game.moves({ verbose: true }) as any[]).filter(m => m.captured);
    if (captures.length > 0) {
      return captures[Math.floor(Math.random() * captures.length)].san;
    }
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const depth = difficulty === 'medium' ? 2 : 3;
  const isMaximizing = game.turn() === 'w';

  const orderedMoves = orderMoves(game);
  let bestMove = orderedMoves[0];
  let bestValue = isMaximizing ? -Infinity : Infinity;

  for (const move of orderedMoves) {
    game.move(move);
    const value = minimax(game, depth - 1, -Infinity, Infinity, !isMaximizing);
    game.undo();

    if (isMaximizing ? value > bestValue : value < bestValue) {
      bestValue = value;
      bestMove = move;
    }
  }

  if (difficulty === 'medium' && Math.random() < 0.12) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  return bestMove || moves[0];
}
