import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type PieceSymbol, type Square } from 'chess.js';
import { io, type Socket } from 'socket.io-client';
import {
  AlertTriangle,
  ArrowLeftRight,
  Bot,
  CheckCircle2,
  Copy,
  Crown,
  LogOut,
  RotateCcw,
  ShieldAlert,
  Shuffle,
  Undo2,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { ChessBoard, type LegalTargetInfo } from './components/ChessBoard';
import { ChessPiece } from './components/ChessPiece';
import {
  chooseComputerMove,
  getCapturedAndAdvantage,
  type BotDifficulty,
} from './utils/chessBot';
import {
  playCaptureSound,
  playCheckSound,
  playGameOverSound,
  playMoveSound,
} from './utils/sound';

type GameMode = 'computer' | 'friend';

interface MoveRecord {
  san: string;
  from: string;
  to: string;
  color: 'w' | 'b';
}

interface RoomStatePayload {
  fen: string;
  moves: MoveRecord[];
  lastMove: { from: string; to: string } | null;
  turn: 'w' | 'b';
  isCheck: boolean;
  gameOver: boolean;
  checkmate: boolean;
  draw: boolean;
  stalemate: boolean;
  winner: 'w' | 'b' | null;
  playersCount: number;
}

interface JoinedPayload extends RoomStatePayload {
  room: string;
  color: 'w' | 'b';
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function findKingSquare(chess: Chess, color: 'w' | 'b'): Square | null {
  const board = chess.board();
  const files = 'abcdefgh';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'k' && p.color === color) {
        return `${files[c]}${8 - r}` as Square;
      }
    }
  }
  return null;
}

export default function App() {
  const [mode, setMode] = useState<GameMode>('computer');
  const [difficulty, setDifficulty] = useState<BotDifficulty>('taktis');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [rulesOpen, setRulesOpen] = useState<boolean>(false);

  // Core chess state represented by FEN + history
  const [fen, setFen] = useState<string>(() => new Chess().fen());
  const [fenHistory, setFenHistory] = useState<string[]>([]);
  const [moves, setMoves] = useState<MoveRecord[]>([]);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: Square;
    to: Square;
    color: 'w' | 'b';
  } | null>(null);

  const [orientation, setOrientation] = useState<'w' | 'b'>('w');
  const [waitingBot, setWaitingBot] = useState<boolean>(false);

  // Multiplayer state
  const [roomInput, setRoomInput] = useState<string>('');
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [playerColor, setPlayerColor] = useState<'w' | 'b'>('w');
  const [playersCount, setPlayersCount] = useState<number>(0);
  const [socketConnected, setSocketConnected] = useState<boolean>(false);
  const [notice, setNotice] = useState<{ type: 'error' | 'info' | 'success'; text: string } | null>(
    null
  );
  const [copiedRoom, setCopiedRoom] = useState<boolean>(false);

  const socketRef = useRef<Socket | null>(null);
  const botTimerRef = useRef<number | null>(null);
  const moveListRef = useRef<HTMLDivElement | null>(null);
  const soundEnabledRef = useRef<boolean>(soundEnabled);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const chess = useMemo(() => new Chess(fen), [fen]);
  const turn = chess.turn();
  const isCheck = chess.isCheck();
  const isCheckmate = chess.isCheckmate();
  const isDraw = chess.isDraw();
  const isStalemate = chess.isStalemate();
  const isGameOver = chess.isGameOver();
  const checkSquare = useMemo(
    () => (isCheck ? findKingSquare(chess, turn) : null),
    [chess, isCheck, turn]
  );

  const { capturedByWhite, capturedByBlack, advantageWhite } = useMemo(
    () => getCapturedAndAdvantage(chess),
    [chess]
  );

  // Compute legal targets for the currently selected square
  const legalTargets = useMemo(() => {
    const map = new Map<Square, LegalTargetInfo>();
    if (!selectedSquare) return map;
    const verboseMoves = chess.moves({ square: selectedSquare, verbose: true });
    for (const m of verboseMoves) {
      const existing = map.get(m.to as Square);
      map.set(m.to as Square, {
        isCapture: Boolean(m.captured) || Boolean(existing?.isCapture),
        isPromotion: Boolean(m.promotion) || Boolean(existing?.isPromotion),
      });
    }
    return map;
  }, [chess, selectedSquare]);

  // Auto-scroll move sheet
  useEffect(() => {
    if (moveListRef.current) {
      moveListRef.current.scrollTop = moveListRef.current.scrollHeight;
    }
  }, [moves.length]);

  // Close rules modal on Escape
  useEffect(() => {
    if (!rulesOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRulesOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rulesOpen]);

  // Clear bot timer helper
  const clearBotTimer = useCallback(() => {
    if (botTimerRef.current !== null) {
      window.clearTimeout(botTimerRef.current);
      botTimerRef.current = null;
    }
  }, []);

  // Initialize Socket.IO client once
  useEffect(() => {
    const socket = io({
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('joined', (data: JoinedPayload) => {
      setActiveRoom(data.room);
      setPlayerColor(data.color);
      setOrientation(data.color);
      setFen(data.fen);
      setMoves(data.moves || []);
      setLastMove(data.lastMove || null);
      setPlayersCount(data.playersCount ?? 1);
      setSelectedSquare(null);
      setPendingPromotion(null);
      setNotice({
        type: 'success',
        text: `Berhasil masuk ke Room ${data.room} sebagai ${
          data.color === 'w' ? 'Putih' : 'Hitam'
        }.`,
      });
    });

    socket.on('players', (count: number) => {
      setPlayersCount(count);
    });

    socket.on('roomState', (data: RoomStatePayload) => {
      setFen(data.fen);
      setMoves(data.moves || []);
      setLastMove(data.lastMove || null);
      setPlayersCount(data.playersCount);
      setSelectedSquare(null);
      setPendingPromotion(null);
    });

    socket.on(
      'moveInfo',
      (info: {
        san: string;
        isCheck: boolean;
        gameOver: boolean;
        checkmate: boolean;
        draw: boolean;
        winner: 'w' | 'b' | null;
      }) => {
        if (info.gameOver) {
          playGameOverSound(soundEnabledRef.current, info.checkmate);
        } else if (info.isCheck) {
          playCheckSound(soundEnabledRef.current);
        } else if (info.san.includes('x')) {
          playCaptureSound(soundEnabledRef.current);
        } else {
          playMoveSound(soundEnabledRef.current);
        }
      }
    );

    socket.on('roomRestarted', (data: RoomStatePayload) => {
      setFen(data.fen);
      setMoves(data.moves || []);
      setLastMove(null);
      setSelectedSquare(null);
      setPendingPromotion(null);
      setNotice({ type: 'info', text: 'Permainan room dimulai ulang dengan warna bertukar.' });
    });

    socket.on('opponentLeft', () => {
      setNotice({ type: 'error', text: 'Lawan terputus dari room.' });
    });

    socket.on('errorMessage', (msg: string) => {
      setNotice({ type: 'error', text: msg });
    });

    return () => {
      clearBotTimer();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [clearBotTimer]);

  const startLocalGame = useCallback(() => {
    clearBotTimer();
    const fresh = new Chess();
    setFen(fresh.fen());
    setFenHistory([]);
    setMoves([]);
    setLastMove(null);
    setSelectedSquare(null);
    setPendingPromotion(null);
    setWaitingBot(false);
    setOrientation('w');
    setNotice(null);
  }, [clearBotTimer]);

  const handleModeChange = (nextMode: GameMode) => {
    if (nextMode === mode) return;
    clearBotTimer();
    if (nextMode === 'computer' && activeRoom) {
      socketRef.current?.emit('leaveRoom');
      setActiveRoom(null);
      setPlayersCount(0);
    }
    setMode(nextMode);
    if (nextMode === 'computer') {
      startLocalGame();
    } else {
      const fresh = new Chess();
      setFen(fresh.fen());
      setFenHistory([]);
      setMoves([]);
      setLastMove(null);
      setSelectedSquare(null);
      setPendingPromotion(null);
      setWaitingBot(false);
      setNotice(null);
    }
  };

  const handleNewGame = () => {
    if (mode === 'friend') {
      if (activeRoom) {
        socketRef.current?.emit('restartRoom');
      } else {
        setNotice({ type: 'info', text: 'Masukkan kode room terlebih dahulu untuk mulai bermain.' });
      }
      return;
    }
    startLocalGame();
  };

  const handleJoinRoom = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleaned = roomInput.trim().toUpperCase();
    if (!cleaned) {
      setNotice({ type: 'error', text: 'Masukkan kode room terlebih dahulu!' });
      return;
    }
    setNotice(null);
    socketRef.current?.emit('joinRoom', { room: cleaned });
  };

  const handleLeaveRoom = () => {
    socketRef.current?.emit('leaveRoom');
    setActiveRoom(null);
    setPlayersCount(0);
    const fresh = new Chess();
    setFen(fresh.fen());
    setMoves([]);
    setLastMove(null);
    setSelectedSquare(null);
    setPendingPromotion(null);
    setNotice({ type: 'info', text: 'Kamu keluar dari room.' });
  };

  const handleGenerateAndFillRoom = () => {
    const code = generateRoomCode();
    setRoomInput(code);
    setNotice(null);
  };

  const handleCopyRoomCode = async () => {
    if (!activeRoom) return;
    try {
      await navigator.clipboard.writeText(activeRoom);
      setCopiedRoom(true);
      window.setTimeout(() => setCopiedRoom(false), 1800);
    } catch {
      setNotice({ type: 'info', text: `Kode room: ${activeRoom}` });
    }
  };

  const executeLocalMove = useCallback(
    (from: Square, to: Square, promotion: 'q' | 'r' | 'b' | 'n' = 'q') => {
      const working = new Chess(fen);
      const prevFen = working.fen();
      const move = working.move({ from, to, promotion });
      if (!move) return;

      setFenHistory((prev) => [...prev, prevFen]);
      setFen(working.fen());
      setMoves((prev) => [
        ...prev,
        { san: move.san, from: move.from, to: move.to, color: move.color },
      ]);
      setLastMove({ from: move.from, to: move.to });
      setSelectedSquare(null);
      setPendingPromotion(null);

      if (working.isGameOver()) {
        playGameOverSound(soundEnabled, working.isCheckmate());
      } else if (working.isCheck()) {
        playCheckSound(soundEnabled);
      } else if (move.captured) {
        playCaptureSound(soundEnabled);
      } else {
        playMoveSound(soundEnabled);
      }

      if (!working.isGameOver() && working.turn() === 'b') {
        setWaitingBot(true);
        const currentDiff = difficulty;
        botTimerRef.current = window.setTimeout(() => {
          const botChess = new Chess(working.fen());
          if (botChess.isGameOver()) {
            setWaitingBot(false);
            return;
          }
          const botMove = chooseComputerMove(botChess, currentDiff);
          if (!botMove) {
            setWaitingBot(false);
            return;
          }
          const applied = botChess.move(botMove);
          setFen(botChess.fen());
          setMoves((prev) => [
            ...prev,
            {
              san: applied.san,
              from: applied.from,
              to: applied.to,
              color: applied.color,
            },
          ]);
          setLastMove({ from: applied.from, to: applied.to });
          setWaitingBot(false);

          if (botChess.isGameOver()) {
            playGameOverSound(soundEnabledRef.current, false);
          } else if (botChess.isCheck()) {
            playCheckSound(soundEnabledRef.current);
          } else if (applied.captured) {
            playCaptureSound(soundEnabledRef.current);
          } else {
            playMoveSound(soundEnabledRef.current);
          }
        }, 480);
      }
    },
    [difficulty, fen, soundEnabled]
  );

  const commitMove = useCallback(
    (from: Square, to: Square, promotion: 'q' | 'r' | 'b' | 'n' = 'q') => {
      if (mode === 'friend') {
        socketRef.current?.emit('makeMove', { from, to, promotion });
        setSelectedSquare(null);
        setPendingPromotion(null);
      } else {
        executeLocalMove(from, to, promotion);
      }
    },
    [executeLocalMove, mode]
  );

  const handleSquareClick = (sq: Square) => {
    if (isGameOver || waitingBot || pendingPromotion) return;

    if (mode === 'friend') {
      if (!activeRoom) return;
      if (playersCount < 2) {
        setNotice({ type: 'info', text: 'Menunggu lawan bergabung ke room...' });
        return;
      }
      if (turn !== playerColor) return;
    } else {
      if (turn !== 'w') return;
    }

    const piece = chess.get(sq);

    if (!selectedSquare) {
      if (piece && piece.color === turn) {
        setSelectedSquare(sq);
      }
      return;
    }

    if (selectedSquare === sq) {
      setSelectedSquare(null);
      return;
    }

    const target = legalTargets.get(sq);
    if (target) {
      if (target.isPromotion) {
        setPendingPromotion({ from: selectedSquare, to: sq, color: turn });
        return;
      }
      commitMove(selectedSquare, sq, 'q');
      return;
    }

    if (piece && piece.color === turn) {
      setSelectedSquare(sq);
    } else {
      setSelectedSquare(null);
    }
  };

  const handleUndo = () => {
    if (mode !== 'computer' || fenHistory.length === 0) return;
    clearBotTimer();
    const prevFen = fenHistory[fenHistory.length - 1];
    setFenHistory((prev) => prev.slice(0, -1));
    // Remove player move and bot reply (1 or 2 half-moves depending on who moved last)
    const plyCount = moves.length;
    const stepsToDrop = plyCount % 2 === 0 ? 2 : 1;
    const nextMoves = moves.slice(0, Math.max(0, plyCount - stepsToDrop));
    setMoves(nextMoves);
    const lastEntry = nextMoves[nextMoves.length - 1];
    setLastMove(lastEntry ? { from: lastEntry.from, to: lastEntry.to } : null);
    setFen(prevFen);
    setSelectedSquare(null);
    setPendingPromotion(null);
    setWaitingBot(false);
  };

  const handleFlipBoard = () => {
    setOrientation((prev) => (prev === 'w' ? 'b' : 'w'));
  };

  // Status description (explicit text + icon, never hue-only)
  const statusDisplay = useMemo(() => {
    if (mode === 'friend' && !activeRoom) {
      return {
        tone: 'neutral' as const,
        label: 'Masukkan kode room untuk bermain online.',
      };
    }
    if (mode === 'friend' && playersCount < 2) {
      return {
        tone: 'waiting' as const,
        label: `Menunggu lawan bergabung di Room ${activeRoom}...`,
      };
    }
    if (isCheckmate) {
      const winnerLabel = turn === 'w' ? 'Hitam' : 'Putih';
      return {
        tone: 'gameover' as const,
        label: `SKAKMAT! ${winnerLabel} menang!`,
      };
    }
    if (isStalemate) {
      return {
        tone: 'gameover' as const,
        label: 'PAT (Stalemate)! Permainan seri.',
      };
    }
    if (isDraw) {
      return {
        tone: 'gameover' as const,
        label: 'Permainan seri!',
      };
    }
    if (waitingBot) {
      return {
        tone: 'active' as const,
        label: 'Komputer sedang berpikir...',
      };
    }
    const turnLabel = turn === 'w' ? 'Putih' : 'Hitam';
    if (isCheck) {
      return {
        tone: 'check' as const,
        label: `SKAK! Giliran ${turnLabel}`,
      };
    }
    return {
      tone: 'active' as const,
      label: `Giliran ${turnLabel}`,
    };
  }, [activeRoom, isCheck, isCheckmate, isDraw, isStalemate, mode, playersCount, turn, waitingBot]);

  // Pair moves into rows: 1. e4 e5
  const moveRows = useMemo(() => {
    const rows: Array<{ number: number; white?: MoveRecord; black?: MoveRecord }> = [];
    for (let i = 0; i < moves.length; i += 2) {
      rows.push({
        number: Math.floor(i / 2) + 1,
        white: moves[i],
        black: moves[i + 1],
      });
    }
    return rows;
  }, [moves]);

  // Determine top & bottom player identity based on board orientation
  const topColor: 'w' | 'b' = orientation === 'w' ? 'b' : 'w';
  const bottomColor: 'w' | 'b' = orientation;

  const getPlayerTitle = (color: 'w' | 'b') => {
    if (mode === 'computer') {
      return color === 'w' ? 'Anda (Putih)' : `Komputer · ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}`;
    }
    if (!activeRoom) {
      return color === 'w' ? 'Pemain Putih' : 'Pemain Hitam';
    }
    return color === playerColor
      ? `Anda (${color === 'w' ? 'Putih' : 'Hitam'})`
      : playersCount >= 2
      ? `Lawan (${color === 'w' ? 'Putih' : 'Hitam'})`
      : 'Menunggu Lawan...';
  };

  const renderCapturedStrip = (color: 'w' | 'b') => {
    const captured = color === 'w' ? capturedByWhite : capturedByBlack;
    const capturedPieceColor: 'w' | 'b' = color === 'w' ? 'b' : 'w';
    const advantage = color === 'w' ? advantageWhite : -advantageWhite;

    return (
      <div className="flex items-center gap-1 min-h-[20px]">
        <div className="flex items-center -space-x-1">
          {captured.map((type: PieceSymbol, idx: number) => (
            <div key={`${type}-${idx}`} className="w-4 h-4">
              <ChessPiece color={capturedPieceColor} type={type} />
            </div>
          ))}
        </div>
        {advantage > 0 && (
          <span className="ml-1.5 font-mono text-xs tabular-nums text-[#E2B45A] font-medium">
            +{advantage}
          </span>
        )}
      </div>
    );
  };

  const boardDisabled =
    isGameOver ||
    waitingBot ||
    Boolean(pendingPromotion) ||
    (mode === 'friend' && (!activeRoom || playersCount < 2 || turn !== playerColor)) ||
    (mode === 'computer' && turn !== 'w');

  return (
    <div className="min-h-screen flex flex-col bg-[#11161F] text-[#F3EFE6]">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="border-b border-white/10 bg-[#141A24]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            onClick={(e) => e.preventDefault()}
            className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#F3EFE6] whitespace-nowrap shrink-0"
          >
            Chess Master
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#A8B2C1]">
            <button
              type="button"
              onClick={() => handleModeChange('computer')}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-[#F3EFE6] ${
                mode === 'computer' ? 'text-[#E2B45A] underline underline-offset-8' : ''
              }`}
            >
              Lawan Komputer
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('friend')}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-[#F3EFE6] ${
                mode === 'friend' ? 'text-[#E2B45A] underline underline-offset-8' : ''
              }`}
            >
              Multiplayer Online
            </button>
            <button
              type="button"
              onClick={() => setRulesOpen(true)}
              className="whitespace-nowrap shrink-0 transition-colors hover:text-[#F3EFE6]"
            >
              Aturan Main
            </button>
            <button
              type="button"
              onClick={() => setSoundEnabled((prev) => !prev)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors hover:text-[#F3EFE6]"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              <span>{soundEnabled ? 'Suara Aktif' : 'Suara Mati'}</span>
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleNewGame}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#E2B45A] hover:bg-[#EBBE67] text-[#14171D] text-sm font-semibold whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2B45A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#141A24]"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Game Baru</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Arena */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_390px] gap-6 lg:gap-8 items-start">
          {/* Left Column: Board Focal Anchor */}
          <section aria-label="Arena Catur" className="flex flex-col gap-3 w-full max-w-[560px] mx-auto lg:max-w-none">
            {/* Top Player Strip */}
            <div className="flex items-center justify-between gap-4 px-4 py-2.5 rounded-xl bg-[#1A212E] border border-white/10">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  aria-hidden="true"
                  className={`w-3.5 h-3.5 rounded-sm shrink-0 border ${
                    topColor === 'w'
                      ? 'bg-[#FAF5EA] border-[#251F19]'
                      : 'bg-[#1E1A17] border-[#A8B2C1]/50'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#F3EFE6] truncate">
                    {getPlayerTitle(topColor)}
                  </p>
                  {renderCapturedStrip(topColor)}
                </div>
              </div>
              <div className="shrink-0 text-xs font-medium">
                {!isGameOver && turn === topColor && (mode === 'computer' || (activeRoom && playersCount >= 2)) ? (
                  <span className="text-[#E2B45A] font-semibold whitespace-nowrap">
                    Giliran Jalan
                  </span>
                ) : (
                  <span className="text-[#7E899B] whitespace-nowrap">Menunggu</span>
                )}
              </div>
            </div>

            {/* Chessboard */}
            <ChessBoard
              fen={fen}
              orientation={orientation}
              selectedSquare={selectedSquare}
              legalTargets={legalTargets}
              lastMove={lastMove}
              checkSquare={checkSquare}
              disabled={boardDisabled}
              onSquareClick={handleSquareClick}
              pendingPromotion={pendingPromotion}
              onSelectPromotion={(piece) => {
                if (!pendingPromotion) return;
                commitMove(pendingPromotion.from, pendingPromotion.to, piece);
              }}
              onCancelPromotion={() => setPendingPromotion(null)}
            />

            {/* Bottom Player Strip */}
            <div className="flex items-center justify-between gap-4 px-4 py-2.5 rounded-xl bg-[#1A212E] border border-white/10">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  aria-hidden="true"
                  className={`w-3.5 h-3.5 rounded-sm shrink-0 border ${
                    bottomColor === 'w'
                      ? 'bg-[#FAF5EA] border-[#251F19]'
                      : 'bg-[#1E1A17] border-[#A8B2C1]/50'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#F3EFE6] truncate">
                    {getPlayerTitle(bottomColor)}
                  </p>
                  {renderCapturedStrip(bottomColor)}
                </div>
              </div>
              <div className="shrink-0 text-xs font-medium">
                {!isGameOver && turn === bottomColor && (mode === 'computer' || (activeRoom && playersCount >= 2)) ? (
                  <span className="text-[#E2B45A] font-semibold whitespace-nowrap">
                    Giliran Jalan
                  </span>
                ) : (
                  <span className="text-[#7E899B] whitespace-nowrap">Menunggu</span>
                )}
              </div>
            </div>
          </section>

          {/* Right Column: Match Controls & Algebraic Move History */}
          <aside className="flex flex-col gap-5 rounded-xl bg-[#1A212E] border border-white/10 p-5">
            {/* Mode Segmented Switcher */}
            <div>
              <label className="block text-xs font-medium text-[#A8B2C1] mb-2">
                Mode Permainan
              </label>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#11161F] border border-white/10">
                <button
                  type="button"
                  onClick={() => handleModeChange('computer')}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                    mode === 'computer'
                      ? 'bg-[#263042] text-[#F3EFE6] shadow-sm'
                      : 'text-[#8F9BAE] hover:text-[#F3EFE6]'
                  }`}
                >
                  <Bot className="w-4 h-4 shrink-0" />
                  <span>vs Komputer</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange('friend')}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                    mode === 'friend'
                      ? 'bg-[#263042] text-[#F3EFE6] shadow-sm'
                      : 'text-[#8F9BAE] hover:text-[#F3EFE6]'
                  }`}
                >
                  <Users className="w-4 h-4 shrink-0" />
                  <span>Multiplayer</span>
                </button>
              </div>
            </div>

            {/* Computer Difficulty Selector */}
            {mode === 'computer' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-[#A8B2C1]">Tingkat Kesulitan Bot</span>
                  <span className="text-xs text-[#7E899B]">Anda bermain Putih</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['santai', 'taktis', 'master'] as BotDifficulty[]).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setDifficulty(level)}
                      className={`py-2 px-3 rounded-lg text-xs font-medium capitalize border transition-colors whitespace-nowrap ${
                        difficulty === level
                          ? 'bg-[#E2B45A]/15 border-[#E2B45A]/70 text-[#E2B45A]'
                          : 'bg-[#131923] border-white/10 text-[#A8B2C1] hover:text-[#F3EFE6] hover:border-white/20'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Multiplayer Room Controls */}
            {mode === 'friend' && (
              <div className="flex flex-col gap-3 pt-1 border-t border-white/10">
                <form onSubmit={handleJoinRoom} className="flex flex-col gap-2.5 pt-2">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="room-input" className="font-medium text-[#A8B2C1]">
                      Kode Room Online
                    </label>
                    <span className="text-[#8F9BAE]">
                      {socketConnected ? 'Server Terhubung' : 'Menghubungkan...'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      id="room-input"
                      type="text"
                      maxLength={20}
                      value={roomInput}
                      onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                      placeholder="Contoh: MEJA01"
                      className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[#11161F] border border-white/15 text-sm font-mono uppercase tracking-wider text-[#F3EFE6] placeholder:text-[#637085] focus:outline-none focus:border-[#E2B45A]"
                    />
                    <button
                      type="button"
                      onClick={handleGenerateAndFillRoom}
                      title="Buat kode acak"
                      aria-label="Buat kode room acak"
                      className="px-3 py-2 rounded-lg bg-[#232B3A] hover:bg-[#2C3648] border border-white/10 text-[#D0D7E2] transition-colors"
                    >
                      <Shuffle className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 px-4 rounded-lg bg-[#E2B45A] hover:bg-[#EBBE67] text-[#14171D] text-sm font-semibold transition-colors whitespace-nowrap"
                  >
                    Gabung Room
                  </button>
                </form>

                <div className="flex items-center justify-between text-xs text-[#A8B2C1] px-1">
                  <span>
                    {activeRoom ? `Room ${activeRoom}` : 'Belum masuk room'}
                    {' · '}
                    <span className="font-mono tabular-nums text-[#F3EFE6]">
                      Pemain terhubung: {playersCount}/2
                    </span>
                  </span>
                  {activeRoom && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopyRoomCode}
                        className="inline-flex items-center gap-1 text-[#E2B45A] hover:underline whitespace-nowrap"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>{copiedRoom ? 'Tersalin' : 'Salin'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleLeaveRoom}
                        className="inline-flex items-center gap-1 text-[#A8B2C1] hover:text-[#F3EFE6] whitespace-nowrap"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Keluar</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Inline Alert / Notice */}
            {notice && (
              <div
                role="status"
                className={`flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg border text-xs leading-relaxed ${
                  notice.type === 'error'
                    ? 'bg-red-500/10 border-red-400/30 text-red-200'
                    : notice.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200'
                    : 'bg-amber-500/10 border-amber-400/30 text-amber-100'
                }`}
              >
                {notice.type === 'error' ? (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-300" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-300" />
                )}
                <span className="flex-1">{notice.text}</span>
                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  aria-label="Tutup pesan"
                  className="text-current/70 hover:text-current"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Match Status Strip */}
            <div
              className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border ${
                statusDisplay.tone === 'check'
                  ? 'bg-red-500/12 border-red-400/40 text-red-100'
                  : statusDisplay.tone === 'gameover'
                  ? 'bg-[#E2B45A]/15 border-[#E2B45A]/50 text-[#F8E7C0]'
                  : 'bg-[#141923] border-white/10 text-[#F3EFE6]'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {statusDisplay.tone === 'check' ? (
                  <ShieldAlert className="w-4 h-4 shrink-0 text-red-300" />
                ) : statusDisplay.tone === 'gameover' ? (
                  <Crown className="w-4 h-4 shrink-0 text-[#E2B45A]" />
                ) : null}
                <span className="text-sm font-semibold truncate">{statusDisplay.label}</span>
              </div>
              {isGameOver && (
                <button
                  type="button"
                  onClick={handleNewGame}
                  className="px-3 py-1.5 rounded-md bg-[#E2B45A] hover:bg-[#EBBE67] text-[#14171D] text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
                >
                  Main Lagi
                </button>
              )}
            </div>

            {/* Action Toolbar: Undo & Flip Board & Mobile Sound */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleUndo}
                disabled={mode !== 'computer' || fenHistory.length === 0}
                className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-[#232B3A] hover:bg-[#2C3648] disabled:opacity-40 disabled:pointer-events-none border border-white/10 text-xs sm:text-sm font-medium text-[#F3EFE6] whitespace-nowrap transition-colors"
              >
                <Undo2 className="w-4 h-4" />
                <span>Undo</span>
              </button>
              <button
                type="button"
                onClick={handleFlipBoard}
                className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-[#232B3A] hover:bg-[#2C3648] border border-white/10 text-xs sm:text-sm font-medium text-[#F3EFE6] whitespace-nowrap transition-colors"
              >
                <ArrowLeftRight className="w-4 h-4" />
                <span>Balik Papan</span>
              </button>
            </div>

            {/* Move History Sheet */}
            <div className="flex flex-col border-t border-white/10 pt-4">
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="text-xs font-medium text-[#A8B2C1]">Catatan Langkah</h2>
                <span className="font-mono text-xs tabular-nums text-[#7E899B]">
                  {moves.length} langkah
                </span>
              </div>

              <div
                ref={moveListRef}
                className="move-scroll h-48 overflow-y-auto rounded-lg bg-[#11161F] border border-white/10 p-2"
              >
                {moveRows.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-[#6E7A8E] text-center px-4">
                    Belum ada langkah. Klik bidak Putih untuk memulai permainan.
                  </div>
                ) : (
                  <div className="grid grid-cols-[40px_1fr_1fr] gap-y-1 text-xs font-mono tabular-nums">
                    {moveRows.map((row) => (
                      <React.Fragment key={row.number}>
                        <span className="py-1 px-2 text-[#6E7A8E]">{row.number}.</span>
                        <span className="py-1 px-2 text-[#F3EFE6] rounded bg-white/[0.02]">
                          {row.white?.san ?? ''}
                        </span>
                        <span className="py-1 px-2 text-[#C8D0DC]">
                          {row.black?.san ?? ''}
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between md:hidden">
                <button
                  type="button"
                  onClick={() => setSoundEnabled((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 text-xs text-[#A8B2C1] hover:text-[#F3EFE6]"
                >
                  {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  <span>{soundEnabled ? 'Suara Aktif' : 'Suara Mati'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRulesOpen(true)}
                  className="text-xs text-[#A8B2C1] hover:text-[#F3EFE6]"
                >
                  Aturan Main
                </button>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* Rules Modal */}
      {rulesOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Aturan Bermain Catur"
          className="fixed inset-0 z-40 flex items-center justify-center bg-[#0B0E14]/80 p-4"
          onClick={() => setRulesOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-[#1A212E] border border-white/15 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl font-bold text-[#F3EFE6]">Panduan Bermain</h2>
              <button
                type="button"
                onClick={() => setRulesOpen(false)}
                aria-label="Tutup panduan"
                className="p-1.5 rounded-lg text-[#A8B2C1] hover:text-[#F3EFE6] hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3 text-sm text-[#C8D0DC] leading-relaxed">
              <p>
                <strong className="text-[#F3EFE6]">1. Player vs Komputer:</strong> Pilih tingkat
                kesulitan (Santai, Taktis, atau Master). Klik bidak Putih lalu klik petak tujuan
                yang bertanda titik hijau. Gunakan tombol Undo untuk mengulang langkah.
              </p>
              <p>
                <strong className="text-[#F3EFE6]">2. Multiplayer Online:</strong> Pindah ke mode
                Multiplayer, masukkan kode room yang sama dengan teman Anda (atau buat kode acak),
                lalu klik Gabung Room. Pemain pertama mendapat Putih dan pemain kedua mendapat
                Hitam.
              </p>
              <p>
                <strong className="text-[#F3EFE6]">3. Aturan Standar FIDE:</strong> Mendukung
                rokade (castling), en passant, promosi pion (Menteri, Benteng, Gajah, Kuda),
                deteksi skak, skakmat, dan seri otomatis.
              </p>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setRulesOpen(false)}
                className="px-4 py-2 rounded-lg bg-[#E2B45A] hover:bg-[#EBBE67] text-[#14171D] text-sm font-semibold"
              >
                Mengerti
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
