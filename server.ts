import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { Chess } from 'chess.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MoveEntry {
  san: string;
  from: string;
  to: string;
  color: 'w' | 'b';
}

interface RoomGame {
  chess: Chess;
  players: string[];
  moves: MoveEntry[];
  lastMove: { from: string; to: string } | null;
}

const rooms = new Map<string, RoomGame>();

function getGameStatusPayload(game: RoomGame) {
  const { chess } = game;
  const turn = chess.turn();
  const gameOver = chess.isGameOver();
  const checkmate = chess.isCheckmate();
  const draw = chess.isDraw();
  const stalemate = chess.isStalemate();
  const isCheck = chess.isCheck();
  const winner: 'w' | 'b' | null = checkmate ? (turn === 'w' ? 'b' : 'w') : null;

  return {
    fen: chess.fen(),
    moves: game.moves,
    lastMove: game.lastMove,
    turn,
    isCheck,
    gameOver,
    checkmate,
    draw,
    stalemate,
    winner,
    playersCount: game.players.length,
  };
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: '*',
    },
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  const leaveCurrentRoom = (socketId: string, currentRoom: string | undefined, socketLeave: (room: string) => void) => {
    if (!currentRoom) return;
    const game = rooms.get(currentRoom);
    if (!game) return;

    const wasPlayer = game.players.includes(socketId);
    if (!wasPlayer) return;

    game.players = game.players.filter((id) => id !== socketId);
    socketLeave(currentRoom);

    io.to(currentRoom).emit('players', game.players.length);
    if (game.players.length > 0) {
      io.to(currentRoom).emit('opponentLeft');
      io.to(currentRoom).emit('roomState', getGameStatusPayload(game));
    } else {
      rooms.delete(currentRoom);
    }
  };

  io.on('connection', (socket) => {
    socket.on('joinRoom', ({ room }: { room?: string }) => {
      const normalizedRoom = String(room || '').trim().toUpperCase();
      if (!normalizedRoom || normalizedRoom.length > 20 || !/^[A-Z0-9_-]+$/.test(normalizedRoom)) {
        socket.emit('errorMessage', 'Kode room tidak valid (gunakan 1–20 huruf/angka).');
        return;
      }

      const prevRoom = socket.data.room as string | undefined;
      if (prevRoom && prevRoom !== normalizedRoom) {
        leaveCurrentRoom(socket.id, prevRoom, (r) => socket.leave(r));
        socket.data.room = undefined;
      }

      let game = rooms.get(normalizedRoom);
      if (!game) {
        game = {
          chess: new Chess(),
          players: [],
          moves: [],
          lastMove: null,
        };
        rooms.set(normalizedRoom, game);
      }

      if (game.players.includes(socket.id)) {
        const playerIndex = game.players.indexOf(socket.id);
        const color = playerIndex === 0 ? 'w' : 'b';
        socket.emit('joined', {
          room: normalizedRoom,
          color,
          ...getGameStatusPayload(game),
        });
        return;
      }

      if (game.players.length >= 2) {
        socket.emit('errorMessage', 'Room sudah penuh! (Maksimal 2 pemain)');
        return;
      }

      game.players.push(socket.id);
      socket.join(normalizedRoom);
      socket.data.room = normalizedRoom;

      const assignedColor = game.players.length === 1 ? 'w' : 'b';
      const statePayload = getGameStatusPayload(game);

      socket.emit('joined', {
        room: normalizedRoom,
        color: assignedColor,
        ...statePayload,
      });

      io.to(normalizedRoom).emit('players', game.players.length);
      io.to(normalizedRoom).emit('position', statePayload.fen);
      io.to(normalizedRoom).emit('roomState', statePayload);
    });

    socket.on('leaveRoom', () => {
      const currentRoom = socket.data.room as string | undefined;
      leaveCurrentRoom(socket.id, currentRoom, (r) => socket.leave(r));
      socket.data.room = undefined;
    });

    socket.on(
      'makeMove',
      ({ from, to, promotion }: { from: string; to: string; promotion?: string }) => {
        const room = socket.data.room as string | undefined;
        if (!room) return;
        const game = rooms.get(room);
        if (!game || !game.players.includes(socket.id)) return;

        const turn = game.chess.turn();
        const playerIndex = game.players.indexOf(socket.id);
        const playerColor = playerIndex === 0 ? 'w' : 'b';
        if (turn !== playerColor) {
          socket.emit('errorMessage', 'Belum giliran kamu.');
          return;
        }

        try {
          const move = game.chess.move({
            from,
            to,
            promotion: promotion || 'q',
          });

          if (!move) {
            socket.emit('errorMessage', 'Langkah tidak valid.');
            return;
          }

          game.lastMove = { from: move.from, to: move.to };
          game.moves.push({
            san: move.san,
            from: move.from,
            to: move.to,
            color: move.color,
          });

          const statePayload = getGameStatusPayload(game);

          io.to(room).emit('position', statePayload.fen);
          io.to(room).emit('roomState', statePayload);
          io.to(room).emit('moveInfo', {
            san: move.san,
            from: move.from,
            to: move.to,
            turn: statePayload.turn,
            isCheck: statePayload.isCheck,
            gameOver: statePayload.gameOver,
            checkmate: statePayload.checkmate,
            draw: statePayload.draw,
            winner: statePayload.winner,
          });
        } catch {
          socket.emit('errorMessage', 'Langkah tidak valid.');
        }
      }
    );

    socket.on('restartRoom', () => {
      const room = socket.data.room as string | undefined;
      if (!room) return;
      const game = rooms.get(room);
      if (!game || !game.players.includes(socket.id)) return;

      game.chess.reset();
      game.moves = [];
      game.lastMove = null;

      // Swap colors on rematch so both players get to play White
      if (game.players.length === 2) {
        game.players.reverse();
      }

      const statePayload = getGameStatusPayload(game);
      game.players.forEach((playerId, index) => {
        const color = index === 0 ? 'w' : 'b';
        io.to(playerId).emit('joined', {
          room,
          color,
          ...statePayload,
        });
      });

      io.to(room).emit('roomRestarted', statePayload);
    });

    socket.on('disconnect', () => {
      const currentRoom = socket.data.room as string | undefined;
      leaveCurrentRoom(socket.id, currentRoom, (r) => socket.leave(r));
      socket.data.room = undefined;
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Chess Master server berjalan di http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Gagal menjalankan server:', err);
  process.exit(1);
});
