import { Chess, type Move, type PieceSymbol } from 'chess.js';

export type BotDifficulty = 'santai' | 'taktis' | 'master';

const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

const PAWN_PST = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];

const KNIGHT_PST = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];

const BISHOP_PST = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];

const CENTER_PST = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];

function getPieceSquareBonus(type: PieceSymbol, color: 'w' | 'b', row: number, col: number): number {
  const idx = color === 'w' ? row * 8 + col : (7 - row) * 8 + col;
  switch (type) {
    case 'p':
      return PAWN_PST[idx] ?? 0;
    case 'n':
      return KNIGHT_PST[idx] ?? 0;
    case 'b':
      return BISHOP_PST[idx] ?? 0;
    case 'r':
      return CENTER_PST[idx] ?? 0;
    default:
      return 0;
  }
}

function evaluateBoard(chess: Chess): number {
  if (chess.isCheckmate()) {
    return chess.turn() === 'w' ? -99999 : 99999;
  }
  if (chess.isDraw()) {
    return 0;
  }

  const board = chess.board();
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const value = PIECE_VALUES[piece.type] + getPieceSquareBonus(piece.type, piece.color, r, c);
      score += piece.color === 'w' ? value : -value;
    }
  }

  return score;
}

function orderMoves(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => {
    const scoreA =
      (a.captured ? PIECE_VALUES[a.captured] * 10 : 0) +
      (a.promotion ? 800 : 0) +
      (a.san.includes('+') ? 50 : 0);
    const scoreB =
      (b.captured ? PIECE_VALUES[b.captured] * 10 : 0) +
      (b.promotion ? 800 : 0) +
      (b.san.includes('+') ? 50 : 0);
    return scoreB - scoreA;
  });
}

function minimax(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  maximizingWhite: boolean
): number {
  if (depth === 0 || chess.isGameOver()) {
    return evaluateBoard(chess);
  }

  const moves = orderMoves(chess.moves({ verbose: true }));
  if (maximizingWhite) {
    let best = -Infinity;
    for (const move of moves) {
      chess.move(move);
      const val = minimax(chess, depth - 1, alpha, beta, false);
      chess.undo();
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of moves) {
      chess.move(move);
      const val = minimax(chess, depth - 1, alpha, beta, true);
      chess.undo();
      if (val < best) best = val;
      if (best < beta) beta = best;
      if (beta <= alpha) break;
    }
    return best;
  }
}

export function chooseComputerMove(chess: Chess, difficulty: BotDifficulty): Move | null {
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;

  if (difficulty === 'santai') {
    const captures = moves.filter((m) => m.captured);
    if (captures.length > 0 && Math.random() < 0.65) {
      return captures[Math.floor(Math.random() * captures.length)];
    }
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const isWhiteTurn = chess.turn() === 'w';
  const depth = difficulty === 'master' ? 2 : 1;
  const ordered = orderMoves(moves);

  let bestMove = ordered[0];
  let bestScore = isWhiteTurn ? -Infinity : Infinity;
  const tiedMoves: Move[] = [];

  for (const move of ordered) {
    chess.move(move);
    const score = minimax(chess, depth - 1, -Infinity, Infinity, !isWhiteTurn);
    chess.undo();

    if (isWhiteTurn) {
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
        tiedMoves.length = 0;
        tiedMoves.push(move);
      } else if (score === bestScore) {
        tiedMoves.push(move);
      }
    } else {
      if (score < bestScore) {
        bestScore = score;
        bestMove = move;
        tiedMoves.length = 0;
        tiedMoves.push(move);
      } else if (score === bestScore) {
        tiedMoves.push(move);
      }
    }
  }

  if (tiedMoves.length > 1) {
    return tiedMoves[Math.floor(Math.random() * tiedMoves.length)];
  }
  return bestMove;
}

export function getCapturedAndAdvantage(chess: Chess): {
  capturedByWhite: PieceSymbol[];
  capturedByBlack: PieceSymbol[];
  advantageWhite: number;
} {
  const initialCounts: Record<PieceSymbol, number> = {
    p: 8,
    n: 2,
    b: 2,
    r: 2,
    q: 1,
    k: 1,
  };

  const currentWhite: Record<PieceSymbol, number> = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
  const currentBlack: Record<PieceSymbol, number> = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };

  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      if (piece.color === 'w') currentWhite[piece.type]++;
      else currentBlack[piece.type]++;
    }
  }

  const order: PieceSymbol[] = ['q', 'r', 'b', 'n', 'p'];
  const capturedByWhite: PieceSymbol[] = [];
  const capturedByBlack: PieceSymbol[] = [];

  let whiteMaterial = 0;
  let blackMaterial = 0;

  for (const type of order) {
    const missingBlack = Math.max(0, initialCounts[type] - currentBlack[type]);
    for (let i = 0; i < missingBlack; i++) capturedByWhite.push(type);

    const missingWhite = Math.max(0, initialCounts[type] - currentWhite[type]);
    for (let i = 0; i < missingWhite; i++) capturedByBlack.push(type);

    const unit = PIECE_VALUES[type] / 100;
    whiteMaterial += currentWhite[type] * unit;
    blackMaterial += currentBlack[type] * unit;
  }

  return {
    capturedByWhite,
    capturedByBlack,
    advantageWhite: Math.round(whiteMaterial - blackMaterial),
  };
}
