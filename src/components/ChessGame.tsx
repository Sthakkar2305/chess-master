import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { getBestMove } from '../lib/chess-ai';
import { RotateCcw, User, Cpu, Trophy, AlertCircle, ChevronLeft, Loader2 } from 'lucide-react';

type GameMode = 'pvp' | 'pvc';
type Difficulty = 'easy' | 'medium' | 'hard';
type GamePhase = 'menu' | 'playing';

interface MoveHighlights {
  [square: string]: React.CSSProperties;
}

const DIFF_COLORS: Record<Difficulty, string> = {
  easy: '#22c55e',
  medium: '#f59e0b',
  hard: '#ef4444',
};

const DIFF_DELAY: Record<Difficulty, number> = {
  easy: 400,
  medium: 600,
  hard: 900,
};

export default function ChessGame() {
  const [game, setGame] = useState(() => new Chess());
  const [mode, setMode] = useState<GameMode>('pvc');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [phase, setPhase] = useState<GamePhase>('menu');
  const [gameOverMsg, setGameOverMsg] = useState('');
  const [moveFrom, setMoveFrom] = useState<string>('');
  const [highlights, setHighlights] = useState<MoveHighlights>({});
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [isComputerThinking, setIsComputerThinking] = useState(false);
  const [boardSize, setBoardSize] = useState(480);
  const computerMoveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameRef = useRef(game);
  gameRef.current = game;

  // Responsive board size
  useEffect(() => {
    function updateSize() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Leave room for header + info bar
      const maxFromVW = Math.min(vw - 32, 560);
      const maxFromVH = vh - 220;
      setBoardSize(Math.max(280, Math.min(maxFromVW, maxFromVH)));
    }
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Clear any pending computer move on unmount
  useEffect(() => {
    return () => {
      if (computerMoveTimer.current) clearTimeout(computerMoveTimer.current);
    };
  }, []);

  const checkGameOver = useCallback((g: Chess) => {
    if (g.isCheckmate()) {
      const winner = g.turn() === 'w' ? 'Black' : 'White';
      setGameOverMsg(`Checkmate! ${winner} wins! 🏆`);
    } else if (g.isStalemate()) {
      setGameOverMsg('Stalemate! Draw 🤝');
    } else if (g.isDraw()) {
      setGameOverMsg('Draw! 🤝');
    } else {
      setGameOverMsg('');
    }
  }, []);

  const triggerComputerMove = useCallback((currentGame: Chess, diff: Difficulty, currentMode: GameMode) => {
    if (currentMode !== 'pvc') return;
    if (currentGame.isGameOver()) return;
    if (currentGame.turn() !== 'b') return;

    if (computerMoveTimer.current) clearTimeout(computerMoveTimer.current);
    setIsComputerThinking(true);

    computerMoveTimer.current = setTimeout(() => {
      const g = gameRef.current;
      if (g.isGameOver() || g.turn() !== 'b') {
        setIsComputerThinking(false);
        return;
      }
      const bestMove = getBestMove(g, diff);
      if (!bestMove) {
        setIsComputerThinking(false);
        return;
      }

      const gameCopy = new Chess(g.fen());
      try {
        const result = gameCopy.move(bestMove);
        if (result) {
          setLastMove({ from: result.from, to: result.to });
          setGame(gameCopy);
          checkGameOver(gameCopy);
        }
      } catch (e) {
        // move failed, try fallback
        const moves = g.moves();
        if (moves.length > 0) {
          const fallback = gameCopy.move(moves[0]);
          if (fallback) {
            setLastMove({ from: fallback.from, to: fallback.to });
            setGame(gameCopy);
            checkGameOver(gameCopy);
          }
        }
      }
      setIsComputerThinking(false);
    }, DIFF_DELAY[diff]);
  }, [checkGameOver]);

  // Watch for computer's turn
  useEffect(() => {
    if (phase !== 'playing') return;
    if (mode === 'pvc' && game.turn() === 'b' && !game.isGameOver()) {
      triggerComputerMove(game, difficulty, mode);
    }
  }, [game, mode, difficulty, phase, triggerComputerMove]);

  function getMoveHighlights(square: string, currentGame: Chess): MoveHighlights | null {
    const moves = currentGame.moves({ square: square as any, verbose: true }) as any[];
    if (moves.length === 0) return null;

    const result: MoveHighlights = {};

    // Highlight selected piece
    result[square] = {
      background: 'rgba(255, 215, 0, 0.5)',
      boxShadow: 'inset 0 0 0 3px rgba(255, 165, 0, 0.8)',
    };

    // Highlight possible moves
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

  function onSquareClick(square: string) {
    // Block input when it's computer's turn in PvC or when game is over
    if (game.isGameOver()) return;
    if (mode === 'pvc' && game.turn() === 'b') return;
    if (isComputerThinking) return;

    const piece = game.get(square as any);

    // If clicking on own piece, select it
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

    // If we have a piece selected, try to move
    if (moveFrom) {
      const gameCopy = new Chess(game.fen());
      try {
        const move = gameCopy.move({ from: moveFrom, to: square, promotion: 'q' });
        if (move) {
          setLastMove({ from: move.from, to: move.to });
          setGame(gameCopy);
          setMoveFrom('');
          setHighlights({ [move.from]: { background: 'rgba(100, 200, 100, 0.35)' }, [move.to]: { background: 'rgba(100, 200, 100, 0.5)' } });
          checkGameOver(gameCopy);
          return;
        }
      } catch {
        // fall through
      }

      // Invalid move — try selecting the clicked square as new selection
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
    if (game.isGameOver()) return;
    if (mode === 'pvc' && game.turn() === 'b') return;
    if (isComputerThinking) return;
    const h = getMoveHighlights(sourceSquare, game);
    if (h) {
      setMoveFrom(sourceSquare);
      setHighlights({ ...buildLastMoveHighlight(), ...h });
    }
  }

  function onDrop(sourceSquare: string, targetSquare: string): boolean {
    if (game.isGameOver()) return false;
    if (mode === 'pvc' && game.turn() === 'b') return false;
    if (isComputerThinking) return false;

    const gameCopy = new Chess(game.fen());
    try {
      const move = gameCopy.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
      if (!move) return false;
      setLastMove({ from: move.from, to: move.to });
      setGame(gameCopy);
      setMoveFrom('');
      setHighlights({ [move.from]: { background: 'rgba(100, 200, 100, 0.35)' }, [move.to]: { background: 'rgba(100, 200, 100, 0.5)' } });
      checkGameOver(gameCopy);
      return true;
    } catch {
      setMoveFrom('');
      setHighlights(buildLastMoveHighlight());
      return false;
    }
  }

  function onPieceDragEnd() {
    if (!moveFrom) {
      setHighlights(buildLastMoveHighlight());
    }
  }

  function startNewGame() {
    if (computerMoveTimer.current) clearTimeout(computerMoveTimer.current);
    const newGame = new Chess();
    setGame(newGame);
    setGameOverMsg('');
    setMoveFrom('');
    setHighlights({});
    setLastMove(null);
    setIsComputerThinking(false);
    setPhase('playing');
  }

  function restartGame() {
    if (computerMoveTimer.current) clearTimeout(computerMoveTimer.current);
    const newGame = new Chess();
    setGame(newGame);
    setGameOverMsg('');
    setMoveFrom('');
    setHighlights({});
    setLastMove(null);
    setIsComputerThinking(false);
  }

  const turnLabel = game.turn() === 'w' ? 'White' : 'Black';
  const isPlayerTurn = mode === 'pvp' || game.turn() === 'w';

  // ─── MENU ───────────────────────────────────────────────────────────────
  if (phase === 'menu') {
    return (
      <div style={{
        minHeight: '100dvh',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{
          width: '100%',
          maxWidth: '400px',
          background: 'rgba(255,255,255,0.05)',
          backdropFilter: 'blur(20px)',
          borderRadius: '24px',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '40px 32px',
          boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
        }}>
          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <div style={{ fontSize: '64px', marginBottom: '8px' }}>♟</div>
            <h1 style={{ color: '#fff', fontSize: '32px', fontWeight: '800', margin: 0 }}>Chess Master</h1>
            <p style={{ color: 'rgba(255,255,255,0.5)', margin: '8px 0 0', fontSize: '14px' }}>
              Touch &amp; drag to move pieces
            </p>
          </div>

          {/* Game Mode */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: '10px' }}>
              Game Mode
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {(['pvc', 'pvp'] as GameMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    padding: '14px', borderRadius: '14px', border: 'none', cursor: 'pointer',
                    fontWeight: '600', fontSize: '15px', transition: 'all 0.2s',
                    background: mode === m ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(255,255,255,0.08)',
                    color: mode === m ? '#fff' : 'rgba(255,255,255,0.6)',
                    boxShadow: mode === m ? '0 4px 20px rgba(99,102,241,0.4)' : 'none',
                    transform: mode === m ? 'scale(1.02)' : 'scale(1)',
                  }}
                >
                  {m === 'pvc' ? <><Cpu size={18} /> vs AI</> : <><User size={18} /> 2 Player</>}
                </button>
              ))}
            </div>
          </div>

          {/* Difficulty */}
          {mode === 'pvc' && (
            <div style={{ marginBottom: '24px' }}>
              <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: '10px' }}>
                Difficulty
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                {(['easy', 'medium', 'hard'] as Difficulty[]).map(d => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    style={{
                      padding: '12px 8px', borderRadius: '12px', border: 'none', cursor: 'pointer',
                      fontWeight: '600', fontSize: '13px', textTransform: 'capitalize', transition: 'all 0.2s',
                      background: difficulty === d ? DIFF_COLORS[d] : 'rgba(255,255,255,0.08)',
                      color: difficulty === d ? '#fff' : 'rgba(255,255,255,0.6)',
                      boxShadow: difficulty === d ? `0 4px 15px ${DIFF_COLORS[d]}55` : 'none',
                      transform: difficulty === d ? 'scale(1.05)' : 'scale(1)',
                    }}
                  >
                    {d === 'easy' ? '😊' : d === 'medium' ? '🤔' : '😈'}{' '}{d}
                  </button>
                ))}
              </div>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', marginTop: '10px', textAlign: 'center' }}>
                {difficulty === 'easy' ? 'Random moves — great for beginners' : difficulty === 'medium' ? 'Tactical play — a fun challenge' : 'Deep strategy — very tough opponent'}
              </p>
            </div>
          )}

          {/* Start Button */}
          <button
            onClick={startNewGame}
            style={{
              width: '100%', padding: '18px', borderRadius: '16px', border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff',
              fontWeight: '800', fontSize: '18px', letterSpacing: '0.02em',
              boxShadow: '0 8px 30px rgba(99,102,241,0.5)', transition: 'all 0.2s',
            }}
            onMouseOver={e => (e.currentTarget.style.transform = 'scale(1.02)')}
            onMouseOut={e => (e.currentTarget.style.transform = 'scale(1)')}
          >
            ♟ Start Game
          </button>
        </div>
      </div>
    );
  }

  // ─── GAME BOARD ─────────────────────────────────────────────────────────
  const customSquareStyles: MoveHighlights = { ...buildLastMoveHighlight(), ...highlights };

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      userSelect: 'none',
    }}>
      {/* Header */}
      <header style={{
        width: '100%',
        background: 'rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backdropFilter: 'blur(10px)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        boxSizing: 'border-box',
      }}>
        <button
          onClick={() => {
            if (computerMoveTimer.current) clearTimeout(computerMoveTimer.current);
            setPhase('menu');
            setIsComputerThinking(false);
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '10px',
            color: 'rgba(255,255,255,0.7)', cursor: 'pointer', padding: '8px 12px',
            fontSize: '14px', fontWeight: '600',
          }}
        >
          <ChevronLeft size={16} /> Menu
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Trophy size={20} color="#f59e0b" />
          <span style={{ color: '#fff', fontWeight: '700', fontSize: '16px' }}>Chess Master</span>
        </div>

        <button
          onClick={restartGame}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: '10px', color: '#fca5a5', cursor: 'pointer', padding: '8px 12px',
            fontSize: '14px', fontWeight: '600',
          }}
        >
          <RotateCcw size={14} /> Restart
        </button>
      </header>

      {/* Status Bar */}
      <div style={{
        width: '100%',
        maxWidth: `${boardSize + 32}px`,
        padding: '10px 16px',
        boxSizing: 'border-box',
      }}>
        {/* Game over banner */}
        {gameOverMsg ? (
          <div style={{
            background: 'rgba(245,158,11,0.15)',
            border: '1px solid rgba(245,158,11,0.4)',
            borderRadius: '14px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <AlertCircle size={20} color="#f59e0b" />
            <span style={{ color: '#fde68a', fontWeight: '700', fontSize: '16px' }}>{gameOverMsg}</span>
            <button
              onClick={restartGame}
              style={{
                marginLeft: 'auto', background: '#f59e0b', border: 'none', borderRadius: '8px',
                color: '#000', fontWeight: '700', padding: '6px 12px', cursor: 'pointer', fontSize: '13px',
              }}
            >
              New Game
            </button>
          </div>
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '14px',
            padding: '10px 16px',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            {/* Turn indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%',
                background: game.turn() === 'w' ? '#fff' : '#1a1a2e',
                border: game.turn() === 'b' ? '2px solid rgba(255,255,255,0.4)' : 'none',
                boxShadow: game.turn() === 'w' ? '0 0 12px rgba(255,255,255,0.5)' : '0 0 12px rgba(99,102,241,0.5)',
                flexShrink: 0,
              }} />
              <div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Turn</div>
                <div style={{ color: '#fff', fontWeight: '700', fontSize: '15px' }}>
                  {turnLabel}
                  {isComputerThinking && ' (thinking...)'}
                </div>
              </div>
            </div>

            {/* Thinking indicator */}
            {isComputerThinking && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#a5b4fc' }}>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: '13px', fontWeight: '600' }}>AI thinking…</span>
              </div>
            )}

            {/* Mode badge */}
            <div style={{
              background: mode === 'pvc' ? `${DIFF_COLORS[difficulty]}22` : 'rgba(99,102,241,0.2)',
              border: `1px solid ${mode === 'pvc' ? DIFF_COLORS[difficulty] + '44' : 'rgba(99,102,241,0.4)'}`,
              borderRadius: '8px',
              padding: '4px 10px',
              color: mode === 'pvc' ? DIFF_COLORS[difficulty] : '#818cf8',
              fontSize: '12px',
              fontWeight: '700',
              textTransform: 'capitalize',
            }}>
              {mode === 'pvc' ? `AI · ${difficulty}` : '2 Player'}
            </div>
          </div>
        )}

        {/* Check warning */}
        {!game.isGameOver() && game.inCheck() && (
          <div style={{
            marginTop: '8px',
            background: 'rgba(239,68,68,0.15)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: '10px',
            padding: '8px 14px',
            color: '#fca5a5',
            fontWeight: '700',
            fontSize: '14px',
            textAlign: 'center',
          }}>
            ⚠️ {turnLabel} is in Check!
          </div>
        )}

        {/* Touch hint */}
        {!moveFrom && !gameOverMsg && !isComputerThinking && isPlayerTurn && (
          <div style={{
            marginTop: '6px',
            color: 'rgba(255,255,255,0.3)',
            fontSize: '12px',
            textAlign: 'center',
          }}>
            Tap a piece to see valid moves, then tap destination
          </div>
        )}
        {moveFrom && (
          <div style={{
            marginTop: '6px',
            color: '#a5b4fc',
            fontSize: '12px',
            textAlign: 'center',
            fontWeight: '600',
          }}>
            ✨ Piece selected — tap a highlighted square to move
          </div>
        )}
      </div>

      {/* Board */}
      <div style={{
        width: `${boardSize}px`,
        height: `${boardSize}px`,
        borderRadius: '16px',
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        border: '2px solid rgba(255,255,255,0.1)',
        flexShrink: 0,
        touchAction: 'none',
      }}>
        <Chessboard
          id="chess-board"
          position={game.fen()}
          onPieceDrop={onDrop}
          onSquareClick={onSquareClick}
          onPieceDragBegin={onPieceDragBegin}
          onPieceDragEnd={onPieceDragEnd}
          customSquareStyles={customSquareStyles}
          boardOrientation="white"
          animationDuration={150}
          customDarkSquareStyle={{ backgroundColor: '#312e81' }}
          customLightSquareStyle={{ backgroundColor: '#c7d2fe' }}
          arePiecesDraggable={!game.isGameOver() && !(mode === 'pvc' && game.turn() === 'b') && !isComputerThinking}
          boardWidth={boardSize}
        />
      </div>

      {/* Move history (last 8 moves) */}
      {game.history().length > 0 && (
        <div style={{
          width: '100%',
          maxWidth: `${boardSize + 32}px`,
          padding: '10px 16px',
          boxSizing: 'border-box',
        }}>
          <div style={{
            background: 'rgba(255,255,255,0.04)',
            borderRadius: '12px',
            padding: '10px 14px',
            border: '1px solid rgba(255,255,255,0.07)',
          }}>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
              Recent Moves
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {game.history().slice(-10).map((move, i) => (
                <span
                  key={i}
                  style={{
                    background: i === game.history().slice(-10).length - 1 ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)',
                    borderRadius: '6px',
                    padding: '3px 8px',
                    color: i === game.history().slice(-10).length - 1 ? '#a5b4fc' : 'rgba(255,255,255,0.5)',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    fontWeight: '600',
                  }}
                >
                  {move}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>
    </div>
  );
}
