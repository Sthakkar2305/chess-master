import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Chess, Move } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { RotateCcw, User, Cpu, Trophy, AlertCircle, ChevronLeft, Loader2, Undo2, Save, FolderOpen, Wifi } from 'lucide-react';
import Peer, { DataConnection } from 'peerjs';

type GameMode = 'pvp' | 'pvc' | 'p2p';
type PlayerColor = 'w' | 'b';
type GamePhase = 'menu' | 'playing' | 'matching';
type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

interface MoveHighlights {
  [square: string]: React.CSSProperties;
}

interface SavedGame {
  pgn: string;
  mode: GameMode;
  difficulty: Difficulty;
  playerColor: PlayerColor;
  undoLeft: number;
  savedAt: string;
}

const SAVE_KEY = 'chess-master-saved-game-v2';
const MAX_UNDOS = 3;

const DIFF_COLORS: Record<Difficulty, string> = {
  easy: '#2f8f46',
  medium: '#b07d2c',
  hard: '#b33b32',
  expert: '#6f1d1b',
};

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

const PIECE_GLYPHS: Record<string, string> = {
  wp: '\u2659', wn: '\u2658', wb: '\u2657', wr: '\u2656', wq: '\u2655', wk: '\u2654',
  bp: '\u265f', bn: '\u265e', bb: '\u265d', br: '\u265c', bq: '\u265b', bk: '\u265a',
};

function cloneGame(source: Chess): Chess {
  const copy = new Chess();
  const pgn = source.pgn();
  if (pgn) copy.loadPgn(pgn);
  return copy;
}

function getLastMove(game: Chess): { from: string; to: string } | null {
  const history = game.history({ verbose: true }) as Move[];
  const last = history[history.length - 1];
  return last ? { from: last.from, to: last.to } : null;
}

function getCapturedPieces(game: Chess): Record<PlayerColor, string[]> {
  const captured: Record<PlayerColor, string[]> = { w: [], b: [] };
  const history = game.history({ verbose: true }) as Move[];

  for (const move of history) {
    if (!move.captured) continue;
    const capturedColor: PlayerColor = move.color === 'w' ? 'b' : 'w';
    captured[capturedColor].push(`${capturedColor}${move.captured}`);
  }

  return captured;
}

function CapturedTray({ color, pieces, label }: { color: PlayerColor; pieces: string[]; label: string; }) {
  return (
    <div style={{
      width: 'calc(100% - 28px)', maxWidth: '632px', minHeight: '42px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
      padding: '8px 10px', background: 'rgba(23, 14, 9, 0.72)',
      border: '2px solid rgba(139, 90, 43, 0.3)', borderRadius: '6px',
      boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)', marginBottom: '4px', marginTop: '4px',
    }}>
      <span style={{ color: '#d9a066', fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '3px', minHeight: '22px' }}>
        {pieces.length === 0 ? (
          <span style={{ color: 'rgba(217,160,102,0.4)', fontSize: '11px', fontWeight: 600 }}>None</span>
        ) : pieces.map((piece, index) => (
          <span key={`${piece}-${index}`} title={`${color === 'w' ? 'White' : 'Black'} captured piece`}
            style={{
              color: color === 'w' ? '#f3e5d8' : '#000',
              textShadow: color === 'w' ? '0 1px 2px #000' : '0 1px 0 rgba(255,255,255,0.4)',
              fontSize: piece[1] === 'p' ? '18px' : '21px', lineHeight: 1,
            }}>
            {PIECE_GLYPHS[piece]}
          </span>
        ))}
      </div>
    </div>
  );
}

// Background AI worker reference
let aiWorker: Worker | null = null;
let msgIdCounter = 0;
const aiResolvers = new Map<number, (move: string) => void>();

export default function ChessGame() {
  const [game, setGame] = useState(() => new Chess());
  const [mode, setMode] = useState<GameMode>('pvc');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [playerColor, setPlayerColor] = useState<PlayerColor>('w');
  const [phase, setPhase] = useState<GamePhase>('menu');
  const [roomCode, setRoomCode] = useState('');
  const [inRoomCode, setInRoomCode] = useState('');
  const [peer, setPeer] = useState<Peer | null>(null);
  const [connection, setConnection] = useState<DataConnection | null>(null);
  
  const [gameOverMsg, setGameOverMsg] = useState('');
  const [moveFrom, setMoveFrom] = useState<string>('');
  const [highlights, setHighlights] = useState<MoveHighlights>({});
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [isComputerThinking, setIsComputerThinking] = useState(false);
  const [boardSize, setBoardSize] = useState(480);
  const [undoLeft, setUndoLeft] = useState(MAX_UNDOS);
  const [savedAt, setSavedAt] = useState<string>('');
  const gameRef = useRef(game);
  gameRef.current = game;

  const computerColor: PlayerColor = playerColor === 'w' ? 'b' : 'w';
  const topColor: PlayerColor = playerColor === 'w' ? 'b' : 'w';
  const bottomColor: PlayerColor = playerColor;
  
  const capturedPieces = useMemo(() => getCapturedPieces(game), [game]);
  const history = useMemo(() => game.history(), [game]);

  const isHumanTurn = useCallback((g: Chess = game) => {
    if (mode === 'pvc') return g.turn() === playerColor;
    if (mode === 'p2p') return g.turn() === playerColor;
    return true; // pvp both human
  }, [game, mode, playerColor]);

  useEffect(() => {
    function updateSize() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const maxFromVW = Math.min(vw - 28, 600);
      const maxFromVH = vh - 220;
      setBoardSize(Math.max(280, Math.min(maxFromVW, maxFromVH)));
    }
    updateSize();
    window.addEventListener('resize', updateSize, { passive: true });
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVE_KEY);
      if (saved) {
        setSavedAt(JSON.parse(saved).savedAt || '');
      }
    } catch { setSavedAt(''); }
    
    // Initialize AI WebWorker
    aiWorker = new Worker(new URL('../lib/chessWorker.ts', import.meta.url), { type: 'module' });
    aiWorker.onmessage = (e) => {
      const { id, move } = e.data;
      if (aiResolvers.has(id)) {
        aiResolvers.get(id)!(move);
        aiResolvers.delete(id);
      }
    };
    
    // PeerJS initialization & cleanup is handled during matching
    return () => {
      aiWorker?.terminate();
      if (peer) peer.destroy();
    };
  }, []);

  const checkGameOver = useCallback((g: Chess) => {
    if (g.isCheckmate()) {
      const winner = g.turn() === 'w' ? 'Black' : 'White';
      setGameOverMsg(`Checkmate. ${winner} wins.`);
    } else if (g.isStalemate()) {
      setGameOverMsg('Stalemate. Draw.');
    } else if (g.isDraw()) {
      setGameOverMsg('Draw.');
    } else {
      setGameOverMsg('');
    }
  }, []);

  const triggerComputerMove = useCallback(async (currentGame: Chess, diff: Difficulty, currentMode: GameMode, currentComputerColor: PlayerColor) => {
    if (currentMode !== 'pvc') return;
    if (currentGame.isGameOver()) return;
    if (currentGame.turn() !== currentComputerColor) return;

    setIsComputerThinking(true);
    
    const id = ++msgIdCounter;
    const move = await new Promise<string>((resolve) => {
      aiResolvers.set(id, resolve);
      aiWorker?.postMessage({ id, fen: currentGame.fen(), difficulty: diff });
    });

    const g = gameRef.current;
    if (g.isGameOver() || g.turn() !== currentComputerColor || currentMode !== 'pvc') {
      setIsComputerThinking(false);
      return;
    }

    const gameCopy = cloneGame(g);
    try {
      const result = gameCopy.move(move);
      if (result) {
        setLastMove({ from: result.from, to: result.to });
        setGame(gameCopy);
        checkGameOver(gameCopy);
      }
    } catch {
      // fallback
      const moves = gameCopy.moves();
      if(moves.length > 0) {
        const fb = gameCopy.move(moves[0]);
        if(fb) {
          setLastMove({ from: fb.from, to: fb.to });
          setGame(gameCopy);
          checkGameOver(gameCopy);
        }
      }
    }
    setIsComputerThinking(false);
  }, [checkGameOver]);

  useEffect(() => {
    if (phase !== 'playing') return;
    if (mode === 'pvc' && game.turn() === computerColor && !game.isGameOver()) {
      triggerComputerMove(game, difficulty, mode, computerColor);
    }
  }, [game, mode, difficulty, phase, computerColor, triggerComputerMove]);

  // PeerJS Connection Handler
  const handleConnection = useCallback((conn: DataConnection, isHost: boolean) => {
    setConnection(conn);
    
    conn.on('open', () => {
      if (isHost) {
        setPhase('playing');
        const newGame = new Chess();
        setGame(newGame);
        setGameOverMsg('');
        setLastMove(null);
      }
    });

    conn.on('data', (data: any) => {
      if (data.type === 'move') {
        const g = cloneGame(gameRef.current);
        const res = g.move(data.move);
        if (res) {
          setLastMove({ from: res.from, to: res.to });
          setGame(g);
          checkGameOver(g);
        }
      } else if (data.type === 'restart') {
        const newGame = new Chess();
        setGame(newGame);
        setGameOverMsg('');
        setLastMove(null);
        setMoveFrom('');
        setHighlights({});
      }
    });

    conn.on('close', () => {
      alert('Opponent disconnected');
      setPhase('menu');
      setConnection(null);
    });
    
    conn.on('error', (err) => {
      console.error(err);
    });
  }, [checkGameOver]);

  const createRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const newPeer = new Peer(newRoomId);
    setPeer(newPeer);
    
    newPeer.on('open', (id) => {
      setRoomCode(id);
      setInRoomCode(id);
      setPlayerColor('w'); // Host is white
    });
    
    newPeer.on('connection', (conn) => {
      handleConnection(conn, true);
    });

    newPeer.on('error', (err) => {
      alert('Error creating room. It may be in use: ' + err.message);
      setPhase('menu');
    });
  };

  const joinRoom = (roomId: string) => {
    if (!roomId) return;
    const newPeer = new Peer();
    setPeer(newPeer);
    
    newPeer.on('open', () => {
      const conn = newPeer.connect(roomId);
      conn.on('open', () => {
        setInRoomCode(roomId);
        setPlayerColor('b'); // Joiner is black
        setPhase('playing');
        const newGame = new Chess();
        setGame(newGame);
        setGameOverMsg('');
        setLastMove(null);
      });
      handleConnection(conn, false);
    });

    newPeer.on('error', (err) => {
      alert('Error joining room: ' + err.message);
      setPhase('menu');
    });
  };

  function getMoveHighlights(square: string, currentGame: Chess): MoveHighlights | null {
    const moves = currentGame.moves({ square: square as any, verbose: true }) as any[];
    if (moves.length === 0) return null;
    const result: MoveHighlights = {};
    result[square] = { background: 'rgba(255, 215, 0, 0.5)' };
    moves.forEach((move) => {
      const isCapture = !!currentGame.get(move.to as any);
      result[move.to] = {
        background: isCapture
          ? 'radial-gradient(circle, rgba(220,38,38,0.6) 65%, transparent 65%)'
          : 'radial-gradient(circle, rgba(99,102,241,0.5) 28%, transparent 28%)',
        cursor: 'pointer',
      };
    });
    return result;
  }

  function buildLastMoveHighlight(): MoveHighlights {
    if (!lastMove) return {};
    return {
      [lastMove.from]: { background: 'rgba(100, 200, 100, 0.35)' },
      [lastMove.to]: { background: 'rgba(100, 200, 100, 0.5)' },
    };
  }

  function applyMove(sourceSquare: string, targetSquare: string, isPromotion: boolean): boolean {
    const gameCopy = cloneGame(game);
    try {
      const move = gameCopy.move(isPromotion ? { from: sourceSquare, to: targetSquare, promotion: 'q' } : { from: sourceSquare, to: targetSquare });
      if (!move) return false;
      
      setLastMove({ from: move.from, to: move.to });
      setGame(gameCopy);
      setMoveFrom('');
      setHighlights({ [move.from]: { background: 'rgba(100, 200, 100, 0.35)' }, [move.to]: { background: 'rgba(100, 200, 100, 0.5)' } });
      checkGameOver(gameCopy);
      
      if (mode === 'p2p' && connection) {
        connection.send({ type: 'move', move: move.san });
      }
      return true;
    } catch {
      return false;
    }
  }

  function onSquareClick(square: string) {
    if (game.isGameOver() || !isHumanTurn(game) || isComputerThinking) return;
    const piece = game.get(square as any);

    if (piece && piece.color === game.turn()) {
      const h = getMoveHighlights(square, game);
      if (h) {
        setMoveFrom(square);
        setHighlights({ ...buildLastMoveHighlight(), ...h });
      } else {
        setMoveFrom('');
        setHighlights(buildLastMoveHighlight());
      }
      return;
    }

    if (moveFrom) {
      const sourcePiece = game.get(moveFrom as any);
      const isPromotion = sourcePiece && sourcePiece.type === 'p' && (square[1] === '8' || square[1] === '1');
      if (applyMove(moveFrom, square, !!isPromotion)) return;

      if (piece && piece.color === game.turn()) {
        const h = getMoveHighlights(square, game);
        if (h) {
          setMoveFrom(square);
          setHighlights({ ...buildLastMoveHighlight(), ...h });
          return;
        }
      }
      setMoveFrom('');
      setHighlights(buildLastMoveHighlight());
    }
  }

  function onPieceDragBegin(_piece: string, sourceSquare: string) {
    if (game.isGameOver() || !isHumanTurn(game) || isComputerThinking) return;
    const h = getMoveHighlights(sourceSquare, game);
    if (h) {
      setMoveFrom(sourceSquare);
      setHighlights({ ...buildLastMoveHighlight(), ...h });
    }
  }

  function onDrop(sourceSquare: string, targetSquare: string): boolean {
    if (game.isGameOver() || !isHumanTurn(game) || isComputerThinking) return false;
    const piece = game.get(sourceSquare as any);
    const isPromotion = piece && piece.type === 'p' && (targetSquare[1] === '8' || targetSquare[1] === '1');
    const success = applyMove(sourceSquare, targetSquare, !!isPromotion);
    if (!success) {
      setMoveFrom('');
      setHighlights(buildLastMoveHighlight());
    }
    return success;
  }

  function onPieceDragEnd() {
    if (!moveFrom) setHighlights(buildLastMoveHighlight());
  }

  function startNewGame() {
    if (mode === 'p2p') {
      setPhase('matching');
      return;
    }
    setIsComputerThinking(false);
    const newGame = new Chess();
    setGame(newGame);
    setGameOverMsg('');
    setMoveFrom('');
    setHighlights({});
    setLastMove(null);
    setUndoLeft(MAX_UNDOS);
    setPhase('playing');
  }

  function restartGame() {
    setIsComputerThinking(false);
    if (mode === 'p2p' && connection) {
      connection.send({ type: 'restart' });
    }
    const newGame = new Chess();
    setGame(newGame);
    setGameOverMsg('');
    setMoveFrom('');
    setHighlights({});
    setLastMove(null);
    setUndoLeft(MAX_UNDOS);
  }

  function undoComputerTurn() {
    if (mode !== 'pvc' || undoLeft <= 0 || history.length === 0 || isComputerThinking) return;

    const gameCopy = cloneGame(game);
    const movesToUndo = gameCopy.turn() === playerColor ? 2 : 1;
    for (let i = 0; i < movesToUndo; i += 1) {
      if (!gameCopy.undo()) break;
    }

    setGame(gameCopy);
    setLastMove(getLastMove(gameCopy));
    setMoveFrom('');
    setHighlights({});
    setGameOverMsg('');
    setUndoLeft((left) => Math.max(0, left - 1));
  }

  function saveGame() {
    const payload: SavedGame = {
      pgn: game.pgn(), mode, difficulty, playerColor, undoLeft, savedAt: new Date().toISOString(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    setSavedAt(payload.savedAt);
  }

  function loadSavedGame() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as SavedGame;
      const loaded = new Chess();
      if (saved.pgn) loaded.loadPgn(saved.pgn);
      setMode(saved.mode || 'pvc');
      setDifficulty(saved.difficulty || 'medium');
      setPlayerColor(saved.playerColor || 'w');
      setUndoLeft(Number.isFinite(saved.undoLeft) ? saved.undoLeft : MAX_UNDOS);
      setGame(loaded);
      setLastMove(getLastMove(loaded));
      setMoveFrom('');
      setHighlights({});
      setGameOverMsg('');
      setSavedAt(saved.savedAt || '');
      setPhase('playing');
      checkGameOver(loaded);
    } catch {
      localStorage.removeItem(SAVE_KEY);
      setSavedAt('');
    }
  }

  const turnLabel = game.turn() === 'w' ? 'White' : 'Black';
  const isPlayerTurn = isHumanTurn(game);
  const canUndo = mode === 'pvc' && undoLeft > 0 && history.length > 0 && !isComputerThinking;

  if (phase === 'matching') {
    return (
      <div style={{ minHeight: '100dvh', background: '#25160d', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px', fontFamily: 'Georgia, serif' }}>
        <div style={{ width: '100%', maxWidth: '360px', background: 'rgba(0,0,0,0.5)', padding: '24px', borderRadius: '12px', border: '1px solid #8b5a2b' }}>
          <h2 style={{ textAlign: 'center', color: '#d0a85f', marginBottom: '24px' }}>Local Multiplayer</h2>
          
          <div style={{ marginBottom: '24px', textAlign: 'center' }}>
            <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '12px' }}>Hotspot/LAN Room Options:</p>
            <button onClick={createRoom}
              style={{ width: '100%', padding: '14px', background: '#d0a85f', color: '#000', fontWeight: 'bold', fontSize: '16px', borderRadius: '8px', border: 'none', cursor: 'pointer', marginBottom: '12px' }}>
              Create Host Room
            </button>
            {roomCode && (
              <div style={{ background: '#000', padding: '12px', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', letterSpacing: '2px', border: '1px dashed #d0a85f' }}>
                Room Code: {roomCode}
                <div style={{ fontSize: '12px', letterSpacing: '0', color: '#888', marginTop: '6px' }}>Waiting for opponent to join...</div>
              </div>
            )}
          </div>
          
          <div style={{ borderTop: '1px solid #444', paddingTop: '24px' }}>
            <input type="text" placeholder="Enter Room Code" value={inRoomCode} onChange={(e)=>setInRoomCode(e.target.value.toUpperCase())}
              style={{ width: '100%', padding: '12px', background: '#111', color: '#fff', border: '1px solid #666', borderRadius: '8px', marginBottom: '12px', fontSize: '16px', textAlign: 'center', boxSizing: 'border-box' }}/>
            <button onClick={() => joinRoom(inRoomCode)}
              style={{ width: '100%', padding: '14px', background: 'rgba(255,255,255,0.1)', color: '#fff', fontWeight: 'bold', fontSize: '16px', borderRadius: '8px', border: '1px solid #666', cursor: 'pointer' }}>
              Join Exisiting Room
            </button>
          </div>
          
          <button onClick={() => setPhase('menu')} style={{ width: '100%', marginTop: '24px', background: 'transparent', color: '#888', border: 'none', cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    );
  }

  if (phase === 'menu') {
    return (
      <div style={{ minHeight: '100dvh', background: 'radial-gradient(circle at 50% 0%, rgba(139, 67, 32, 0.42), transparent 38%), linear-gradient(135deg, #1f1711 0%, #372417 54%, #18110d 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', fontFamily: 'Georgia, Cambria, serif' }}>
        <div style={{ width: '100%', maxWidth: '440px', background: 'rgba(42, 27, 18, 0.82)', borderRadius: '8px', border: '1px solid rgba(233,210,162,0.3)', padding: '32px 26px', boxShadow: '0 28px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ fontSize: '58px', marginBottom: '6px', color: '#ead7ae', textShadow: '0 3px 8px #000' }}>R</div>
            <h1 style={{ color: '#fff', fontSize: '32px', fontWeight: '800', margin: 0 }}>Chess Master</h1>
            <p style={{ color: 'rgba(255,255,255,0.5)', margin: '8px 0 0', fontSize: '14px' }}>Classic board, brilliant compute.</p>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: '10px' }}>Game Mode</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
              {(['pvc', 'pvp', 'p2p'] as GameMode[]).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    padding: '12px', borderRadius: '8px', border: '1px solid rgba(245,230,191,0.18)', cursor: 'pointer',
                    fontWeight: '600', fontSize: '15px', transition: 'all 0.2s',
                    background: mode === m ? '#d0a85f' : 'rgba(255,255,255,0.08)',
                    color: mode === m ? '#24160d' : 'rgba(255,255,255,0.6)',
                  }}>
                  {m === 'pvc' ? <><Cpu size={18} /> VS Compute</> : m === 'pvp' ? <><User size={18} /> 2 Player (Shared)</> : <><Wifi size={18}/> Local Host/Join</>}
                </button>
              ))}
            </div>
          </div>

          {mode === 'pvc' && (
            <div style={{ marginBottom: '24px' }}>
              <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: '10px' }}>Choose Your Side</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {(['w', 'b'] as PlayerColor[]).map(color => (
                  <button key={color} onClick={() => setPlayerColor(color)}
                    style={{
                      padding: '12px 8px', borderRadius: '12px', border: 'none', cursor: 'pointer',
                      fontWeight: '700', fontSize: '14px', transition: 'all 0.2s',
                      background: playerColor === color ? '#eee' : 'rgba(255,255,255,0.08)',
                      color: playerColor === color ? '#000' : 'rgba(255,255,255,0.6)',
                    }}>
                    Play {color === 'w' ? 'White \u2659' : 'Black \u265F'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === 'pvc' && (
            <div style={{ marginBottom: '24px' }}>
              <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: '10px' }}>Compute Difficulty</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {DIFFICULTIES.map(d => (
                  <button key={d} onClick={() => setDifficulty(d)}
                    style={{
                      padding: '10px 8px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                      fontWeight: '600', fontSize: '13px', textTransform: 'capitalize', transition: 'all 0.2s',
                      background: difficulty === d ? DIFF_COLORS[d] : 'rgba(255,255,255,0.08)',
                      color: difficulty === d ? '#fff' : 'rgba(255,255,255,0.6)',
                    }}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button onClick={startNewGame} style={{ width: '100%', padding: '18px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: '#d0a85f', color: '#24160d', fontWeight: '800', fontSize: '18px', boxShadow: '0 8px 30px rgba(0,0,0,0.35)' }}>
            {mode === 'p2p' ? 'Connect via LAN...' : 'Start Game'}
          </button>
          
          {mode === 'pvc' && (
            <button onClick={loadSavedGame} disabled={!savedAt} style={{ width: '100%', marginTop: '10px', padding: '12px', borderRadius: '8px', border: '1px solid rgba(245,230,191,0.22)', cursor: savedAt ? 'pointer' : 'not-allowed', background: savedAt ? 'rgba(245,230,191,0.12)' : 'rgba(245,230,191,0.05)', color: savedAt ? '#ead7ae' : 'rgba(245,230,191,0.3)', fontWeight: '700', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <FolderOpen size={16} /> Load Saved Game
            </button>
          )}
        </div>
      </div>
    );
  }

  const customSquareStyles: MoveHighlights = { ...buildLastMoveHighlight(), ...highlights };

  return (
    <div style={{ minHeight: '100dvh', background: '#1c130d', display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: 'Georgia, Cambria, serif', userSelect: 'none' }}>
      <header style={{ width: '100%', background: 'rgba(0,0,0,0.6)', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxSizing: 'border-box' }}>
        <button onClick={() => setPhase('menu')} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}><ChevronLeft size={16} /> Menu</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Trophy size={18} color="#d0a85f" /><span style={{ color: '#fff', fontWeight: '700', fontSize: '16px' }}>Chess Master</span></div>
        <button onClick={restartGame} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}><RotateCcw size={14} /> Restart</button>
      </header>

      <div style={{ width: '100%', maxWidth: `${boardSize + 32}px`, padding: '10px 16px', boxSizing: 'border-box' }}>
        {gameOverMsg ? (
          <div style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '8px', padding: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertCircle size={20} color="#f59e0b" /><span style={{ color: '#fde68a', fontWeight: '700', fontSize: '16px' }}>{gameOverMsg}</span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '10px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: game.turn() === 'w' ? '#fff' : '#111', border: game.turn() === 'b' ? '2px solid rgba(255,255,255,0.2)' : 'none', boxShadow: game.turn() === 'w' ? '0 0 10px rgba(255,255,255,0.3)' : 'none' }} />
              <div>
                <div style={{ color: '#888', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Turn</div>
                <div style={{ color: '#fff', fontWeight: '700', fontSize: '15px' }}>
                  {mode === 'pvc' && game.turn() === computerColor ? 'Compute' : turnLabel}
                  {isComputerThinking && ' (calculating...)'}
                </div>
              </div>
            </div>
            {isComputerThinking && <Loader2 size={16} color="#a5b4fc" style={{ animation: 'spin 1s linear infinite' }} />}
            <div style={{ color: '#888', fontSize: '12px', fontWeight: '700', textTransform: 'capitalize' }}>
              {mode === 'pvc' ? `Compute - ${difficulty}` : mode === 'p2p' ? `LAN (${inRoomCode})` : '2 Player'}
            </div>
          </div>
        )}
      </div>

      <CapturedTray color={topColor} pieces={capturedPieces[topColor]} label={`${topColor === 'w' ? 'White' : 'Black'} Has Lost`} />

      <div style={{
        width: `${boardSize}px`, height: `${boardSize}px`, borderRadius: '6px', overflow: 'hidden',
        boxShadow: '0 20px 50px rgba(0,0,0,0.8), 0 0 0 12px #3e2715, 0 0 0 14px #2a1608',
        border: '2px solid #1a0f07', touchAction: 'none', margin: '14px auto', background: '#3e2715',
      }}>
        <Chessboard
          position={game.fen()} onPieceDrop={onDrop} onSquareClick={onSquareClick} onPieceDragBegin={onPieceDragBegin} onPieceDragEnd={onPieceDragEnd}
          customSquareStyles={customSquareStyles} boardOrientation={playerColor === 'w' ? 'white' : 'black'} animationDuration={200}
          customDarkSquareStyle={{
            backgroundColor: '#8b5a2b',
            boxShadow: 'inset 0 0 12px rgba(0,0,0,0.3)',
          }}
          customLightSquareStyle={{
            backgroundColor: '#deb887',
            boxShadow: 'inset 0 0 8px rgba(0,0,0,0.1)',
          }}
          customBoardStyle={{ borderRadius: '0px' }}
          arePiecesDraggable={!game.isGameOver() && isHumanTurn(game) && !isComputerThinking}
          boardWidth={boardSize}
        />
      </div>

      <CapturedTray color={bottomColor} pieces={capturedPieces[bottomColor]} label={`${bottomColor === 'w' ? 'White' : 'Black'} Has Lost`} />

      <div style={{ width: '100%', maxWidth: `${boardSize + 32}px`, padding: '12px 16px', boxSizing: 'border-box', display: 'grid', gridTemplateColumns: mode === 'pvc' ? '1fr 1fr' : '1fr', gap: '10px' }}>
        {mode === 'pvc' && (
          <button onClick={undoComputerTurn} disabled={!canUndo} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: canUndo ? '#442d1c' : '#22160d', color: canUndo ? '#d0a85f' : '#555', border: '1px solid #553a25', borderRadius: '6px', cursor: canUndo ? 'pointer' : 'not-allowed', padding: '12px', fontWeight: 'bold' }}>
            <Undo2 size={16} /> Undo ({undoLeft}/3)
          </button>
        )}
        {mode === 'pvc' && (
          <button onClick={saveGame} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#442d1c', color: '#d0a85f', border: '1px solid #553a25', borderRadius: '6px', cursor: 'pointer', padding: '12px', fontWeight: 'bold' }}>
            <Save size={16} /> Save Game
          </button>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } * { -webkit-tap-highlight-color: transparent; }`}</style>
    </div>
  );
}
